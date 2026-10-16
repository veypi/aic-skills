"""selftest for aic_blender_bridge —— 不需要真 Blender（stub bpy + SYNC 旁路）。

跑法：python3 cli/selftest.py（在技能包根目录）。
覆盖：认证握手（正确/错误/缺失/HTTP 报文首行）、协议帧收发（真实 socket
回环）、tools 目录（含 out/file/render schema）、call 成功/工具级失败/未知工具/未知
方法/坏行跳过、execute_code 的 code 与 file 两条路径、render 参数校验、ping
版本与环境字段、addon 幂等 start/stop。
"""

import json
import os
import socket
import sys
import tempfile
import threading
import types

# stub bpy：bridge 只在 ping/scene/render 里读这些字段
bpy = types.ModuleType("bpy")
bpy.app = types.SimpleNamespace(version_string="4.2.0-stub")
bpy.data = types.SimpleNamespace(filepath="")
bpy.context = types.SimpleNamespace(scene=types.SimpleNamespace(
    render=types.SimpleNamespace(engine="BLENDER_EEVEE", resolution_x=1920, resolution_y=1080),
    camera=types.SimpleNamespace(name="Camera"),
))
sys.modules["bpy"] = bpy

os.environ["AIC_BRIDGE_SYNC"] = "1"
os.environ["AIC_BLENDER_PORT"] = "0"  # 占位；实际端口用随机空闲端口
os.environ["AIC_BLENDER_TOKEN"] = "selftest-token"
TOKEN = "selftest-token"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aic_blender_bridge as bridge

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print("ok  %s" % name)
    else:
        print("FAIL %s %s" % (name, detail))
        FAILURES.append(name)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def roundtrip(port, messages, token=TOKEN):
    """一条连接：先认证首行，再顺序发多条消息，收回全部应答。"""
    conn = socket.create_connection(("127.0.0.1", port), timeout=5)
    try:
        rf = conn.makefile("rb")
        conn.sendall(json.dumps({"auth": token}).encode() + b"\n")
        ack = json.loads(rf.readline(17 << 20))
        if not ack.get("ok"):
            raise RuntimeError("auth rejected: %r" % ack)
        out = []
        for m in messages:
            conn.sendall(json.dumps(m).encode() + b"\n")
            line = rf.readline(17 << 20)
            out.append(json.loads(line))
        return out
    finally:
        conn.close()


def main():
    bridge.DEFAULT_PORT = free_port()
    os.environ.pop("AIC_BLENDER_PORT")  # 用改过的 DEFAULT_PORT
    port = bridge.start()
    check("start returns port", port == bridge.DEFAULT_PORT)
    check("start idempotent", bridge.start() == port)

    # 认证握手：错误 token / 无 auth / HTTP 报文首行一律拒绝并断连
    def raw_first_line(payload):
        conn = socket.create_connection(("127.0.0.1", port), timeout=5)
        try:
            conn.sendall(payload + b"\n")
            rf = conn.makefile("rb")
            line = rf.readline(17 << 20)
            rest = rf.readline(17 << 20)  # 拒绝后应断连：EOF
            return json.loads(line) if line else None, rest
        finally:
            conn.close()

    rep, rest = raw_first_line(json.dumps({"auth": "wrong"}).encode())
    check("wrong token rejected", rep is not None and rep.get("ok") is False and rest == b"", rep)
    rep, _ = raw_first_line(json.dumps({"id": 1, "method": "tools"}).encode())
    check("missing auth rejected", rep is not None and rep.get("ok") is False, rep)
    rep, _ = raw_first_line(b"POST / HTTP/1.1")
    check("http first line rejected", rep is not None and rep.get("ok") is False, rep)

    # tools 目录
    [rep] = roundtrip(port, [{"id": 1, "method": "tools"}])
    names = [t["name"] for t in rep.get("tools", [])]
    check("tools lists six", names == ["ping", "get_scene_info", "get_object_info", "execute_code", "get_viewport_screenshot", "render"], names)
    check("tools carry schema", all("inputSchema" in t for t in rep["tools"]))
    shot = next(t for t in rep["tools"] if t["name"] == "get_viewport_screenshot")
    check("screenshot schema carries out", "out" in shot["inputSchema"]["properties"], shot["inputSchema"])
    exec_tool = next(t for t in rep["tools"] if t["name"] == "execute_code")
    check("execute_code schema carries file", "file" in exec_tool["inputSchema"]["properties"] and "entry" in exec_tool["inputSchema"]["properties"], exec_tool["inputSchema"])
    render_props = next(t for t in rep["tools"] if t["name"] == "render")["inputSchema"]
    check("render schema carries path/camera/clip",
          render_props.get("required") == ["path"] and {"path", "camera", "clip", "res", "samples", "engine"} <= set(render_props["properties"]),
          render_props)

    # ping
    [rep] = roundtrip(port, [{"id": 2, "method": "call", "name": "ping", "arguments": {}}])
    check("ping ok", rep["result"]["ok"] and rep["result"]["addon"] == bridge.ADDON_VERSION and rep["result"]["blender"] == "4.2.0-stub", rep)
    check("ping protocol", rep["result"]["protocol"] == "vtools/tcp v1")
    check("ping env fields",
          rep["result"].get("engine") == "BLENDER_EEVEE" and rep["result"].get("resolution") == "1920x1080" and rep["result"].get("camera") == "Camera",
          rep)

    # execute_code：stdout 捕获 + 结果
    [rep] = roundtrip(port, [{"id": 3, "method": "call", "name": "execute_code", "arguments": {"code": "print('hello bridge')\nx = 1 + 1\nprint(x)"}}])
    check("execute_code stdout", rep["result"]["stdout"] == "hello bridge\n2\n", rep)
    check("execute_code not isError", not rep.get("isError"))

    # execute_code --file：脚本落盘执行；code/file 互斥
    script = os.path.join(tempfile.gettempdir(), "aic_bridge_selftest_script.py")
    with open(script, "w", encoding="utf-8") as fh:
        fh.write("print('from-file')\nprint(6 * 7)\n")
    [rep] = roundtrip(port, [{"id": 30, "method": "call", "name": "execute_code", "arguments": {"file": script}}])
    check("execute_code file", rep["result"]["stdout"] == "from-file\n42\n" and rep["result"]["source"] == script, rep)
    [rep] = roundtrip(port, [{"id": 31, "method": "call", "name": "execute_code", "arguments": {"code": "print(1)", "file": script}}])
    check("execute_code code+file rejected", rep.get("isError") is True, rep)
    [rep] = roundtrip(port, [{"id": 32, "method": "call", "name": "execute_code", "arguments": {}}])
    check("execute_code needs code or file", rep.get("isError") is True, rep)
    # --entry：载入脚本后调用指定入口（不传则只载入）
    entry_script = os.path.join(tempfile.gettempdir(), "aic_bridge_selftest_entry.py")
    with open(entry_script, "w", encoding="utf-8") as fh:
        fh.write("def build():\n    print('built')\n\n\ndef other():\n    print('other')\n")
    [rep] = roundtrip(port, [{"id": 35, "method": "call", "name": "execute_code", "arguments": {"file": entry_script, "entry": "build"}}])
    check("execute_code entry", rep["result"]["stdout"] == "built\n" and rep["result"]["entry"] == "build", rep)
    [rep] = roundtrip(port, [{"id": 36, "method": "call", "name": "execute_code", "arguments": {"file": entry_script}}])
    check("execute_code without entry loads only", rep["result"]["stdout"] == "" and rep["result"]["entry"] is None, rep)
    [rep] = roundtrip(port, [{"id": 37, "method": "call", "name": "execute_code", "arguments": {"file": entry_script, "entry": "nope"}}])
    check("execute_code bad entry rejected", rep.get("isError") is True, rep)
    [rep] = roundtrip(port, [{"id": 38, "method": "call", "name": "execute_code", "arguments": {"entry": "build"}}])
    check("execute_code entry without file rejected", rep.get("isError") is True, rep)
    # render：缺 path / 目录不存在 必须显式报错（不做静默渲染）
    [rep] = roundtrip(port, [{"id": 33, "method": "call", "name": "render", "arguments": {}}])
    check("render requires path", rep.get("isError") is True and "path" in str(rep.get("result", {})), rep)
    [rep] = roundtrip(port, [{"id": 34, "method": "call", "name": "render", "arguments": {"path": os.path.join(tempfile.gettempdir(), "no-such-dir-x", "a.png")}}])
    check("render missing dir rejected", rep.get("isError") is True, rep)

    # execute_code：异常 → isError + traceback，stdout 保留
    [rep] = roundtrip(port, [{"id": 4, "method": "call", "name": "execute_code", "arguments": {"code": "print('before')\nraise RuntimeError('boom')"}}])
    check("execute_code isError", rep.get("isError") is True, rep)
    check("execute_code traceback", "RuntimeError: boom" in rep["result"].get("traceback", ""), rep["result"])
    check("execute_code partial stdout", rep["result"]["stdout"] == "before\n")

    # 工具内部异常（get_object_info 缺 name）→ isError
    [rep] = roundtrip(port, [{"id": 5, "method": "call", "name": "get_object_info", "arguments": {}}])
    check("tool crash is isError", rep.get("isError") is True and "traceback" in rep.get("result", {}), rep)

    # 未知工具 / 未知方法 / 缺 arguments
    [rep] = roundtrip(port, [{"id": 6, "method": "call", "name": "nope", "arguments": {}}])
    check("unknown tool error", "unknown tool" in rep.get("error", ""), rep)
    [rep] = roundtrip(port, [{"id": 7, "method": "wat"}])
    check("unknown method error", "unknown method" in rep.get("error", ""), rep)
    [rep] = roundtrip(port, [{"id": 8, "method": "call", "name": "ping"}])
    check("missing arguments tolerated", rep.get("result", {}).get("ok") is True, rep)

    # 坏行跳过 + 后续正常（认证后）
    conn = socket.create_connection(("127.0.0.1", port), timeout=5)
    conn.sendall(json.dumps({"auth": TOKEN}).encode() + b"\n")
    rf = conn.makefile("rb")
    json.loads(rf.readline(17 << 20))  # auth ack
    conn.sendall(b"{not json}\n" + json.dumps({"id": 9, "method": "tools"}).encode() + b"\n")
    rep = json.loads(rf.readline(17 << 20))
    conn.close()
    check("bad line skipped, next answered", rep.get("id") == 9 and "tools" in rep, rep)

    # 超时任务丢弃（2026-10-16 review 修复回归）：关 SYNC 旁路、无 timer 泵时
    # 入队 → 超时 busy → 手动泵一轮，任务必须被跳过；对照组活任务正常执行。
    bridge.SYNC = False
    executed = []
    try:
        bridge._run_on_main(lambda: executed.append("dead"), 0.05)
        check("busy timeout raises", False)
    except bridge._Busy:
        check("busy timeout raises", True)
    ev = threading.Event()
    bridge._jobs.put((lambda: executed.append("live"), ev, {}))
    bridge._pump()
    check("timed-out job dropped, live job runs", executed == ["live"] and ev.is_set(), executed)
    bridge.SYNC = True

    bridge.stop()
    print()
    if FAILURES:
        print("FAILED: %s" % ", ".join(FAILURES))
        sys.exit(1)
    print("all pass")


if __name__ == "__main__":
    main()
