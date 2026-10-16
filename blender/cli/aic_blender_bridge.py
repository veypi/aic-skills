"""AIC Blender Bridge —— Blender GUI 内的 vtools/tcp v1 工具服务。

两用形态：
  - addon：install 进 Blender addons 目录后在偏好设置启用（register() 启动）
  - boot 脚本挂载：pod 的 `blender launch` 以 `blender --python boot.py` 拉起，
    boot 脚本 runpy 加载本文件并调用 start()（不动用户 Blender 配置）

协议（行分隔 JSON，单条 ≤16MiB；与 aic-pod libs/vtools/tcp.go 对偶）：
  → {"id":1,"method":"tools"}
  ← {"id":1,"tools":[{"name","description","inputSchema"}]}
  → {"id":2,"method":"call","name":"execute_code","arguments":{"code":"..."}}
  ← {"id":2,"result":{...}}                        成功
  ← {"id":2,"result":{...},"isError":true}         工具级失败（结果保留）
  ← {"id":2,"error":"main-thread-busy: ..."}       协议级失败

线程模型：socket 线程只收发；一切 bpy 调用经队列泵到主线程
（bpy.app.timers）。主线程被渲染/模态占住时，排队超时直接报
main-thread-busy —— 不把命令堆到永远。

execute_code 是有意的万能通道：会在 Blender 进程里跑任意 Python。
服务只监听 127.0.0.1；aic-pod 侧另有 exec 规则门（mcp.blender）。
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import queue
import socket
import sys
import tempfile
import threading
import time
import traceback

ADDON_VERSION = "0.1.0"
PROTOCOL = "vtools/tcp v1"
DEFAULT_PORT = 9866
MAX_LINE = 16 << 20
QUEUE_WAIT_S = 10.0  # 主线程排队上限：超时 = main-thread-busy

try:
    import bpy
except ImportError:  # selftest 等无 Blender 环境（stub 注入）
    bpy = None

# AIC_BRIDGE_SYNC=1：队列旁路，原地执行（selftest / 调试；不要在 Blender 里用）
SYNC = os.environ.get("AIC_BRIDGE_SYNC") == "1"


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
    return {
        "ok": True,
        "addon": ADDON_VERSION,
        "protocol": PROTOCOL,
        "blender": bpy.app.version_string if bpy else None,
        "file": bpy.data.filepath if bpy else None,
    }


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
    if not code:
        raise ValueError("execute_code requires 'code'")
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
            exec(compile(code, "<aic>", "exec"), g)
        except Exception:
            crashed = traceback.format_exc()
    if crashed is not None:
        return _ToolFailure(stdout=buf_out.getvalue(), stderr=buf_err.getvalue(), traceback=crashed)
    return {"stdout": buf_out.getvalue(), "stderr": buf_err.getvalue()}


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
        return {
            "mime": "image/png",
            "image_base64": base64.b64encode(data).decode("ascii"),
            "bytes": len(data),
            "max_size": max_size,
            "ms": round((time.monotonic() - started) * 1000),
        }
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# name → (fn, 是否主线程, schema)。ping/scene/object/screenshot/execute 全部要 bpy，
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
        "description": "在 Blender 主线程执行 Python（预置 bpy/math/mathutils）；异常也回传 stdout/stderr/traceback",
        "schema": {"type": "object", "properties": {"code": {"type": "string", "description": "要执行的 Python 代码"}}, "required": ["code"]},
        "fn": _t_execute_code,
    },
    {
        "name": "get_viewport_screenshot",
        "description": "截一帧 3D 视口（base64 PNG；max_size 超边自动缩放，失败回原图）",
        "schema": {"type": "object", "properties": {"max_size": {"type": "integer", "description": "最长边像素，默认 560", "default": 560}}},
        "fn": _t_screenshot,
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


def _client(conn):
    # 每连接单线程读写：读循环与应答都在本线程，无需写锁。
    try:
        rf = conn.makefile("rb")
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
                threading.Thread(target=_client, args=(conn,), daemon=True).start()

        _thread = threading.Thread(target=loop, name="aic-blender-bridge", daemon=True)
        _thread.start()
    if bpy is not None and not SYNC:
        bpy.app.timers.register(_pump, persistent=True)
    sys.modules.setdefault("aic_blender_bridge", sys.modules[__name__])
    print("AIC Blender Bridge %s listening on 127.0.0.1:%d" % (ADDON_VERSION, _port))
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
    "version": (0, 1, 0),
    "blender": (4, 0, 0),
    "description": "vtools/tcp v1 工具服务（AIC 直连通道）",
    "category": "System",
}


def register():
    start()


def unregister():
    stop()


if __name__ in ("__main__", "<run_path>"):
    start()
