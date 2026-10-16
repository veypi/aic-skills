"""AIC Blender Bridge —— Blender GUI 内的 vtools/tcp v1 工具服务。

两用形态：
  - addon：install 进 Blender addons 目录后在偏好设置启用（register() 启动）
  - boot 脚本挂载：pod 的 `blender launch` 以 `blender --python boot.py` 拉起，
    boot 脚本 runpy 加载本文件并调用 start()（不动用户 Blender 配置）

协议（vtools/tcp v1，通用规范见 aic-pod docs/host-vtools.md §1.1；行分隔
JSON，单条 ≤16MiB；与 aic-pod libs/vtools/tcp.go 对偶）：
  → {"auth":"<token>"}                        认证首行（必需）
  ← {"ok":true}  /  {"ok":false,"error":"…"}（失败即断连）
  → {"id":1,"method":"tools"}
  ← {"id":1,"tools":[{"name","description","inputSchema"}]}
  → {"id":2,"method":"call","name":"execute_code","arguments":{"code":"..."}}
  ← {"id":2,"result":{...}}                        成功
  ← {"id":2,"result":{...},"isError":true}         工具级失败（结果保留）
  ← {"id":2,"error":"main-thread-busy: ..."}       协议级失败

线程模型：socket 线程只收发；一切 bpy 调用经队列泵到主线程
（bpy.app.timers）。主线程被渲染/模态占住时，排队超时直接报
main-thread-busy —— 不把命令堆到永远。

execute_code 是有意的万能通道：会在 Blender 进程里跑任意 Python。服务只监听
127.0.0.1 且强制认证首行——首行不是合法 auth 的连接（含浏览器页面发往
localhost 的 HTTP/WebSocket 报文）一律拒绝，aic-pod 侧另有 exec 规则门
（mcp.blender）。token 取 env AIC_BLENDER_TOKEN（pod launch 透传）→
~/.aic/blender/bridge_token（0600，O_EXCL 先建者赢，pod 与 addon 共读同一
文件）。威胁模型：防浏览器/跨用户本机进程；同 uid 恶意进程能读 token 文件，
不在此模型内。
"""

from __future__ import annotations

import base64
import contextlib
import hmac
import io
import json
import os
import queue
import secrets
import socket
import sys
import tempfile
import threading
import time
import traceback

ADDON_VERSION = "0.3.0"
PROTOCOL = "vtools/tcp v1"
DEFAULT_PORT = 9866
MAX_LINE = 16 << 20
QUEUE_WAIT_S = 10.0  # 主线程排队上限：超时 = main-thread-busy
TOKEN_ENV = "AIC_BLENDER_TOKEN"

try:
    import bpy
except ImportError:  # selftest 等无 Blender 环境（stub 注入）
    bpy = None

# AIC_BRIDGE_SYNC=1：队列旁路，原地执行（selftest / 调试；不要在 Blender 里用）
SYNC = os.environ.get("AIC_BRIDGE_SYNC") == "1"


def _token_file():
    return os.path.join(os.path.expanduser("~"), ".aic", "blender", "bridge_token")


def _resolve_token():
    """认证 token：env（pod launch 透传）→ token 文件 → 自生成写文件
    （O_EXCL 先建者赢；pod 侧读同一文件）。"""
    tok = os.environ.get(TOKEN_ENV, "").strip()
    if tok:
        return tok
    path = _token_file()
    try:
        with open(path, "r", encoding="utf-8") as f:
            tok = f.read().strip()
            if tok:
                return tok
    except OSError:
        pass
    tok = secrets.token_hex(24)
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        with open(path, "r", encoding="utf-8") as f:  # 并发创建：读赢家
            return f.read().strip()
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(tok + "\n")
    return tok


class _Busy(Exception):
    pass


class _ToolCrash(Exception):
    def __init__(self, tb):
        super().__init__("tool crashed")
        self.traceback = tb


class _ToolFailure(dict):
    """工具级失败的结果载体（协议层据此置 isError；普通 dict 结果永远是成功）。"""


# ---------------------------------------------------------------- tools

def _t_ping(_args):
    info = {
        "ok": True,
        "addon": ADDON_VERSION,
        "protocol": PROTOCOL,
        "blender": bpy.app.version_string if bpy else None,
        "file": bpy.data.filepath if bpy else None,
    }
    if bpy is not None:
        try:  # 渲染环境概览：agent 判断「现在在什么引擎/分辨率/机位」用
            sc = bpy.context.scene
            info["engine"] = sc.render.engine
            info["resolution"] = "%dx%d" % (sc.render.resolution_x, sc.render.resolution_y)
            info["camera"] = sc.camera.name if sc.camera else None
        except Exception:
            pass  # 无场景上下文时 ping 仍要能用（doctor L3 靠它）
    return info


def _t_scene_info(args):
    sc = bpy.context.scene
    limit = int(args.get("limit") or 200)
    objects = []
    for o in list(sc.objects)[:limit]:
        objects.append({
            "name": o.name,
            "type": o.type,
            "location": [round(v, 4) for v in o.location],
            "dimensions": [round(v, 4) for v in o.dimensions],
            "collection": o.users_collection[0].name if o.users_collection else None,
        })
    return {
        "scene": sc.name,
        "frame": sc.frame_current,
        "frame_range": [sc.frame_start, sc.frame_end],
        "file": bpy.data.filepath,
        "counts": {
            "objects": len(sc.objects),
            "materials": len(bpy.data.materials),
            "collections": len(bpy.data.collections),
        },
        "objects": objects,
        "truncated": len(sc.objects) > len(objects),
    }


def _t_object_info(args):
    name = args.get("name")
    o = bpy.data.objects.get(name) if name else None
    if o is None:
        raise ValueError("object not found: %r" % (name,))
    info = {
        "name": o.name,
        "type": o.type,
        "location": list(o.location),
        "rotation_euler": list(o.rotation_euler),
        "scale": list(o.scale),
        "dimensions": list(o.dimensions),
        "parent": o.parent.name if o.parent else None,
        "materials": [m.name for m in o.data.materials if m] if hasattr(o.data, "materials") else [],
        "modifiers": [m.name for m in o.modifiers] if hasattr(o, "modifiers") else [],
        "hide_viewport": o.hide_viewport,
        "hide_render": o.hide_render,
    }
    if o.type == "MESH":
        info["mesh"] = {"vertices": len(o.data.vertices), "edges": len(o.data.edges), "polygons": len(o.data.polygons)}
    return info


def _t_execute_code(args):
    code = args.get("code")
    path = (args.get("file") or "").strip()
    entry = (args.get("entry") or "").strip()
    if code and path:
        raise ValueError("execute_code: 'code' 与 'file' 二选一")
    if entry and not path:
        raise ValueError("execute_code: 'entry' 只跟 'file' 一起用")
    origin = "<aic>"
    if path:
        # 设备路径执行：长脚本先落盘（fs write），改一行只需重发路径——避开
        # shell 引号与 JSON 转义两层碎玻璃；entry 决定这次跑哪一段。
        with open(path, "r", encoding="utf-8") as fh:
            code = fh.read()
        origin = path
    if not code:
        raise ValueError("execute_code requires 'code' or 'file'")
    buf_out, buf_err = io.StringIO(), io.StringIO()
    g = {"bpy": bpy, "__name__": "__aic_exec__"}
    try:
        import math
        g["math"] = math
    except ImportError:
        pass
    try:
        import mathutils
        g["mathutils"] = mathutils
    except ImportError:
        pass
    crashed = None
    with contextlib.redirect_stdout(buf_out), contextlib.redirect_stderr(buf_err):
        try:
            exec(compile(code, origin, "exec"), g)
            if entry:
                fn = g.get(entry)
                if not callable(fn):
                    raise ValueError("entry %r 在脚本里不存在或不可调用" % entry)
                fn()
        except Exception:
            crashed = traceback.format_exc()
    if crashed is not None:
        return _ToolFailure(stdout=buf_out.getvalue(), stderr=buf_err.getvalue(), traceback=crashed)
    return {"stdout": buf_out.getvalue(), "stderr": buf_err.getvalue(), "source": origin, "entry": entry or None}


def _scale_png(path, max_size):
    """超出 max_size 时经 bpy 图像管线缩放；任何一步失败都回原图（不因压缩丢图）。"""
    with open(path, "rb") as f:
        raw = f.read()
    if not max_size or bpy is None:
        return raw
    try:
        img = bpy.data.images.load(path)
        w, h = img.size
        longest = max(w, h)
        if longest <= max_size:
            bpy.data.images.remove(img)
            return raw
        scale = max_size / float(longest)
        img.scale(max(1, round(w * scale)), max(1, round(h * scale)))
        fd, small = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        try:
            img.filepath_raw = small
            img.file_format = "PNG"
            img.save()
            with open(small, "rb") as f:
                return f.read()
        finally:
            bpy.data.images.remove(img)
            try:
                os.unlink(small)
            except OSError:
                pass
    except Exception:
        return raw


def _t_screenshot(args):
    max_size = int(args.get("max_size") or 560)
    out_path = (args.get("out") or "").strip()
    started = time.monotonic()
    wm = bpy.context.window_manager
    win, area = bpy.context.window, None
    windows = ([win] if win else []) + list(wm.windows)
    for w in windows:
        if w is None:
            continue
        for a in w.screen.areas:
            if a.type == "VIEW_3D":
                win, area = w, a
                break
        if area is not None:
            break
    if win is None or area is None:
        raise RuntimeError("no 3D viewport（GUI 会话才支持截图）")
    region = next((r for r in area.regions if r.type == "WINDOW"), None)
    fd, path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        with bpy.context.temp_override(window=win, area=area, region=region):
            try:
                bpy.ops.screen.screenshot_area(filepath=path)
            except Exception:
                bpy.ops.screen.screenshot(filepath=path)
        data = _scale_png(path, max_size)
        result = {
            "mime": "image/png",
            "bytes": len(data),
            "max_size": max_size,
            "ms": round((time.monotonic() - started) * 1000),
        }
        if out_path:
            # 落盘形态：调用端（agent）之后用 fs read 取图——host 端图片 read 走
            # image_data 进视觉通道，比把 base64 灌进 stdout 实用得多。
            with open(out_path, "wb") as fh:
                fh.write(data)
            result["path"] = out_path
            return result
        result["image_base64"] = base64.b64encode(data).decode("ascii")
        return result
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# ---------------------------------------------------------------- render

ENGINE_ALIASES = {
    "eevee": "BLENDER_EEVEE",
    "eevee_next": "BLENDER_EEVEE_NEXT",
    "cycles": "CYCLES",
    "workbench": "BLENDER_WORKBENCH",
}


def _parse_res(text, fallback):
    if not text:
        return fallback
    s = str(text).lower().replace(" ", "")
    if "x" not in s:
        raise ValueError("res 形如 1280x720：%r" % (text,))
    w, h = s.split("x", 1)
    return int(w), int(h)


def _set_samples(sc, samples):
    """按当前引擎设采样（采样数挂在 scene.cycles / scene.eevee，不在 render 上）：
    返回 (kind, 旧值) 供还原；samples 为空则返回 None。"""
    if samples is None:
        return None
    n = int(samples)
    engine = sc.render.engine
    if "CYCLES" in engine:
        old = sc.cycles.samples
        sc.cycles.samples = n
        return ("cycles", old)
    if hasattr(sc, "eevee") and hasattr(sc.eevee, "taa_render_samples"):
        old = sc.eevee.taa_render_samples
        sc.eevee.taa_render_samples = n
        return ("eevee", old)
    raise ValueError("当前引擎 %s 不支持 samples 参数" % engine)


def _restore_samples(sc, saved):
    if not saved:
        return
    kind, old = saved
    if kind == "cycles":
        sc.cycles.samples = old
    elif kind == "eevee":
        sc.eevee.taa_render_samples = old


def _scene_distances(sc, cam_location):
    """场景可见网格相对相机的 (最近, 最远) 距离（bound_box 近似）。无网格 → (None, None)。"""
    import mathutils
    near = far = None
    for o in sc.objects:
        if o.type != "MESH" or o.hide_render:
            continue
        for corner in o.bound_box:
            d = ((o.matrix_world @ mathutils.Vector(corner)) - cam_location).length
            near = d if near is None else min(near, d)
            far = d if far is None else max(far, d)
    return near, far


def _t_render(args):
    """渲一帧落盘（返回 path 等元数据，不回图）。临时改的设置——引擎/分辨率/
    采样/机位——渲染后一律还原：场景和渲染设置都是用户的。"""
    path = (args.get("path") or "").strip()
    if not path:
        raise ValueError("render requires 'path'（PNG 落盘路径）")
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        raise ValueError("输出目录不存在：%s（目录要已存在，先建好再渲）" % parent)
    sc = bpy.context.scene
    cam = sc.camera or next((o for o in sc.objects if o.type == "CAMERA"), None)
    if cam is None:
        raise RuntimeError("场景里没有相机：先用 execute_code 建一个（bpy.ops.object.camera_add(location=...)）")
    r = sc.render
    cam_args = args.get("camera") or {}
    started = time.monotonic()
    saved = {
        "engine": r.engine,
        "resolution_x": r.resolution_x,
        "resolution_y": r.resolution_y,
        "resolution_percentage": r.resolution_percentage,
        "filepath": r.filepath,
        "file_format": r.image_settings.file_format,
        "cam_location": list(cam.location),
        "cam_rotation": list(cam.rotation_euler),
        "cam_lens": cam.data.lens,
        "cam_clip_start": cam.data.clip_start,
        "cam_clip_end": cam.data.clip_end,
    }
    saved_samples = None
    result = None
    try:
        engine = (args.get("engine") or "").strip()
        if engine:
            r.engine = ENGINE_ALIASES.get(engine.lower(), engine)
        w, h = _parse_res(args.get("res"), (1280, 720))
        r.resolution_x, r.resolution_y = w, h
        r.resolution_percentage = 100
        r.image_settings.file_format = "PNG"
        r.filepath = path
        saved_samples = _set_samples(sc, args.get("samples"))
        loc, target = cam_args.get("location"), cam_args.get("target")
        if loc is not None:
            cam.location = [float(v) for v in loc]
        if cam_args.get("lens") is not None:
            cam.data.lens = float(cam_args["lens"])
        if target is not None:
            import mathutils
            direction = mathutils.Vector([float(v) for v in target]) - cam.location
            cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        clip = args.get("clip") or {}
        clip_explicit = clip.get("start") is not None or clip.get("end") is not None
        if clip.get("start") is not None:
            cam.data.clip_start = float(clip["start"])
        if clip.get("end") is not None:
            cam.data.clip_end = float(clip["end"])
        near, far = _scene_distances(sc, cam.location)
        if far is not None and not clip_explicit:
            # 自适应：只扩不缩——小模型继续用默认（盲目放大裁剪距离反而掉深度精度），
            # km 级大场景自动盖住，不再出现“远处被硬切一刀”。
            cam.data.clip_end = max(cam.data.clip_end, far * 1.05)
            if near is not None and near > 0:
                cam.data.clip_start = min(cam.data.clip_start, max(near * 0.5, 0.001))
        used_engine = r.engine
        bpy.ops.render.render(write_still=True)
        result = {
            "path": path,
            "bytes": os.path.getsize(path) if os.path.exists(path) else 0,
            "res": "%dx%d" % (w, h),
            "samples": int(args["samples"]) if args.get("samples") is not None else None,
            "engine": used_engine,
            "clip": {
                "start": round(cam.data.clip_start, 4),
                "end": round(cam.data.clip_end, 3),
                "auto": not clip_explicit,
            },
            "camera": {
                "name": cam.name,
                "location": [round(v, 4) for v in cam.location],
                "lens": round(cam.data.lens, 3),
            },
            "ms": round((time.monotonic() - started) * 1000),
        }
    finally:
        r.engine = saved["engine"]
        r.resolution_x, r.resolution_y = saved["resolution_x"], saved["resolution_y"]
        r.resolution_percentage = saved["resolution_percentage"]
        r.filepath = saved["filepath"]
        r.image_settings.file_format = saved["file_format"]
        cam.location = saved["cam_location"]
        cam.rotation_euler = saved["cam_rotation"]
        cam.data.lens = saved["cam_lens"]
        cam.data.clip_start = saved["cam_clip_start"]
        cam.data.clip_end = saved["cam_clip_end"]
        _restore_samples(sc, saved_samples)
    return result


# name → (fn, 是否主线程, schema)。ping/scene/object/screenshot/execute/render 全要 bpy，
# 即全部主线程执行；selftest 用 SYNC 旁路。
TOOLS = [
    {
        "name": "ping",
        "description": "连通握手：addon/协议/Blender 版本与当前文件",
        "schema": {"type": "object", "properties": {}},
        "fn": _t_ping,
    },
    {
        "name": "get_scene_info",
        "description": "场景概要：对象清单（名称/类型/位置/尺寸/集合）、材质与集合计数、帧范围",
        "schema": {"type": "object", "properties": {"limit": {"type": "integer", "description": "对象清单上限，默认 200", "default": 200}}},
        "fn": _t_scene_info,
    },
    {
        "name": "get_object_info",
        "description": "单对象详情：变换/尺寸/父级/材质/修改器/网格计数",
        "schema": {"type": "object", "properties": {"name": {"type": "string", "description": "对象名（bpy.data.objects 键）"}}, "required": ["name"]},
        "fn": _t_object_info,
    },
    {
        "name": "execute_code",
        "description": "在 Blender 主线程执行 Python（预置 bpy/math/mathutils）；异常也回传 stdout/stderr/traceback。长脚本先落盘再用 file 载入，避开 shell 引号与 JSON 转义",
        "schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "要执行的 Python 代码（与 file 二选一）"},
                "file": {"type": "string", "description": "设备本地脚本路径（与 code 二选一）；读该文件执行，适合长脚本与反复改"},
                "entry": {"type": "string", "description": "脚本里的入口函数名（可选，仅跟 file 用）：载入后调用它；不传就只载入"},
            },
        },
        "fn": _t_execute_code,
    },
    {
        "name": "get_viewport_screenshot",
        "description": "截一帧 3D 视口（PNG；max_size 超边自动缩放，失败回原图）。给了 out 就落盘到该路径并回 {path}，不给则回 image_base64",
        "schema": {
            "type": "object",
            "properties": {
                "max_size": {"type": "integer", "description": "最长边像素，默认 560", "default": 560},
                "out": {"type": "string", "description": "PNG 落盘路径（可选；给了就不回 base64，供调用端自行读图）"},
            },
        },
        "fn": _t_screenshot,
    },
    {
        "name": "render",
        "description": "渲一帧 PNG 落盘（只回 path 等元数据，不回 base64：调用方接着 fs read 就看图）；可选临时改引擎/分辨率/采样/机位/裁剪面，渲完还原用户的设置（相机裁剪默认按场景尺度自适应，只扩不缩）",
        "schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "输出 PNG 的设备本地路径（必填；父目录须已存在）"},
                "res": {"type": "string", "description": "分辨率 WxH，默认 1280x720（迭代用小图更快）"},
                "samples": {"type": "integer", "description": "采样数（Cycles.samples / EEVEE taa_render_samples）"},
                "engine": {"type": "string", "description": "引擎：eevee/cycles/workbench 别名或原始 engine id"},
                "camera": {
                    "type": "object",
                    "description": "临时机位（渲染后还原）：location/target/lens；target 是注视点（自动算朝向）",
                    "properties": {
                        "location": {"type": "array", "items": {"type": "number"}},
                        "target": {"type": "array", "items": {"type": "number"}},
                        "lens": {"type": "number"},
                    },
                },
                "clip": {
                    "type": "object",
                    "description": "相机裁剪面 {start,end}（可选）；给了就以它为准，不给则自适应场景尺度（只扩不缩——小模型保持默认 100m，km 级大场景自动盖住）",
                    "properties": {"start": {"type": "number"}, "end": {"type": "number"}},
                },
            },
            "required": ["path"],
        },
        "fn": _t_render,
    },
]

_BY_NAME = {t["name"]: t for t in TOOLS}


def _tools_meta():
    return [{"name": t["name"], "description": t["description"], "inputSchema": t["schema"]} for t in TOOLS]


# ------------------------------------------------------- 主线程队列泵

_jobs = queue.Queue()


def _pump():
    while True:
        try:
            fn, event, box = _jobs.get_nowait()
        except queue.Empty:
            break
        if box.get("dead"):
            continue  # 调用方已超时收到 main-thread-busy：任务丢弃，不补执行
        try:
            box["result"] = fn()
        except Exception:
            box["error"] = traceback.format_exc()
        finally:
            event.set()
    return 0.05  # timers 再注册间隔（秒）


def _run_on_main(fn, wait_s=QUEUE_WAIT_S):
    if SYNC:
        try:
            return fn()
        except Exception:
            raise _ToolCrash(traceback.format_exc())
    event = threading.Event()
    box = {}
    _jobs.put((fn, event, box))
    if not event.wait(wait_s):
        box["dead"] = True  # 超时即丢弃：pump 之后取到也不再执行（手册「不排队重发」）
        raise _Busy("主线程 %.0fs 未取走任务（渲染/模态操作占用中）" % wait_s)
    if "error" in box:
        raise _ToolCrash(box["error"])
    return box["result"]


# ------------------------------------------------------------- 协议层

def _reply_call(req):
    mid = req.get("id")
    name = req.get("name")
    args = req.get("arguments")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        return {"id": mid, "error": "arguments must be an object"}
    tool = _BY_NAME.get(name)
    if tool is None:
        return {"id": mid, "error": "unknown tool %r（可用: %s）" % (name, ", ".join(sorted(_BY_NAME)))}
    try:
        outcome = _run_on_main(lambda: tool["fn"](args))
    except _Busy as e:
        return {"id": mid, "error": "main-thread-busy: %s" % e}
    except _ToolCrash as e:
        return {"id": mid, "result": {"traceback": e.traceback}, "isError": True}
    reply = {"id": mid, "result": outcome}
    if isinstance(outcome, _ToolFailure):  # execute_code 自带失败语义
        reply["isError"] = True
    return reply


def _client(conn, token):
    # 每连接单线程读写：读循环与应答都在本线程，无需写锁。
    try:
        rf = conn.makefile("rb")
        # 认证首行（vtools/tcp v1）：{"auth": token}。不是合法 auth 的连接
        #（含浏览器发往 localhost 的 HTTP/WebSocket 报文）拒绝并断连。
        line = rf.readline(MAX_LINE + 2)
        if not line:
            return
        try:
            hello = json.loads(line)
            ok = hmac.compare_digest(str(hello.get("auth") or ""), token)
        except ValueError:
            ok = False
        if not ok:
            conn.sendall(b'{"ok":false,"error":"auth failed"}\n')
            return
        conn.sendall(b'{"ok":true}\n')
        while True:
            line = rf.readline(MAX_LINE + 2)
            if not line:
                return
            if len(line) > MAX_LINE:
                msg = {"id": None, "error": "message exceeds 16 MiB"}
                conn.sendall(json.dumps(msg).encode("utf-8") + b"\n")
                continue
            try:
                req = json.loads(line)
            except ValueError:
                continue  # 坏行不致命：跳过（无 id 可路由）
            method = req.get("method")
            if method == "tools":
                reply = {"id": req.get("id"), "tools": _tools_meta()}
            elif method == "call":
                reply = _reply_call(req)
            else:
                reply = {"id": req.get("id"), "error": "unknown method %r" % (method,)}
            raw = json.dumps(reply, ensure_ascii=False).encode("utf-8") + b"\n"
            conn.sendall(raw)
    except (ConnectionError, OSError):
        return
    finally:
        try:
            conn.close()
        except OSError:
            pass


# --------------------------------------------------------- 生命周期

_server_lock = threading.Lock()
_server = None  # socket
_thread = None
_port = 0


def port():
    """生效端口（env AIC_BLENDER_PORT 覆盖默认 9866）。"""
    raw = os.environ.get("AIC_BLENDER_PORT", "")
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    return DEFAULT_PORT


def start():
    """启动服务（幂等）。返回监听端口。"""
    global _server, _thread, _port
    with _server_lock:
        if _server is not None:
            return _port
        token = _resolve_token()
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        _port = port()
        srv.bind(("127.0.0.1", _port))
        srv.listen(8)
        srv.settimeout(1.0)
        _server = srv

        def loop():
            while True:
                try:
                    conn, _ = srv.accept()
                except socket.timeout:
                    continue
                except OSError:
                    return  # stop() 关闭了 socket
                threading.Thread(target=_client, args=(conn, token), daemon=True).start()

        _thread = threading.Thread(target=loop, name="aic-blender-bridge", daemon=True)
        _thread.start()
    if bpy is not None and not SYNC:
        bpy.app.timers.register(_pump, persistent=True)
    sys.modules.setdefault("aic_blender_bridge", sys.modules[__name__])
    print("AIC Blender Bridge %s listening on 127.0.0.1:%d（auth 首行已启用）" % (ADDON_VERSION, _port))
    return _port


def stop():
    global _server, _thread
    with _server_lock:
        srv, _server, _thread = _server, None, None
    if srv is not None:
        try:
            srv.close()
        except OSError:
            pass
    if bpy is not None:
        try:
            if bpy.app.timers.is_registered(_pump):
                bpy.app.timers.unregister(_pump)
        except Exception:
            pass


# ---- addon 接口（install 进 addons 目录后由 Blender 启用/禁用调）----

bl_info = {
    "name": "AIC Blender Bridge",
    "author": "AIC",
    "version": (0, 3, 0),
    "blender": (4, 0, 0),
    "description": "vtools/tcp v1 工具服务（AIC 直连通道，认证首行）",
    "category": "System",
}


def register():
    start()


def unregister():
    stop()


if __name__ in ("__main__", "<run_path>"):
    start()
