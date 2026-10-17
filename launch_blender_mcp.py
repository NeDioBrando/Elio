#!/usr/bin/env python3
"""HTTP shim: Chrome (127.0.0.1:17617) -> blender-mcp addon TCP 9876.

synerixcode.exe cannot spawn custom MCP servers (add_server is stubbed). The
blender-mcp addon already opens a JSON socket inside Blender; a Chrome
extension cannot speak raw TCP. This stdlib-only process is the hop.

Idempotent: if the shim is already listening, a second launch exits 0.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import time
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

HTTP_HOST = os.environ.get("SYNERIXCODE_BLENDER_HTTP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("SYNERIXCODE_BLENDER_HTTP_PORT", "17617"))
BLEND_HOST = os.environ.get("BLENDER_HOST", "127.0.0.1")
BLEND_PORT = int(os.environ.get("BLENDER_PORT", "9876"))
HEALTH_URL = f"http://{HTTP_HOST}:{HTTP_PORT}/health"

_lock = threading.Lock()
_sock: socket.socket | None = None


def _json_bytes(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def already_up() -> bool:
    try:
        with urlopen(HEALTH_URL, timeout=0.6) as r:
            body = json.loads(r.read().decode("utf-8") or "{}")
        return bool(body.get("ok") or body.get("shim"))
    except (URLError, TimeoutError, OSError, ValueError):
        return False


def blender_probe() -> tuple[bool, str | None]:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1.2)
    try:
        s.connect((BLEND_HOST, BLEND_PORT))
        return True, None
    except OSError as e:
        return False, str(e)
    finally:
        try:
            s.close()
        except OSError:
            pass


def _recv_json(sock: socket.socket, timeout: float = 180.0) -> dict[str, Any]:
    sock.settimeout(timeout)
    chunks: list[bytes] = []
    while True:
        chunk = sock.recv(8192)
        if not chunk:
            if not chunks:
                raise ConnectionError("Blender closed the socket before sending data")
            break
        chunks.append(chunk)
        raw = b"".join(chunks)
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
    raise ValueError("incomplete JSON from Blender")


def blender_command(command_type: str, params: dict[str, Any] | None = None, timeout: float = 180.0) -> dict[str, Any]:
    """Send {type, params} to the addon and return the parsed response."""
    global _sock
    payload = _json_bytes({"type": command_type, "params": params or {}})
    with _lock:
        last_err: Exception | None = None
        for _attempt in range(2):
            try:
                if _sock is None:
                    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s.settimeout(8.0)
                    s.connect((BLEND_HOST, BLEND_PORT))
                    _sock = s
                assert _sock is not None
                _sock.sendall(payload)
                data = _recv_json(_sock, timeout=timeout)
                if data.get("status") == "error":
                    raise RuntimeError(data.get("message") or "Blender addon error")
                return data if isinstance(data, dict) else {"result": data}
            except (OSError, ConnectionError, ValueError, TimeoutError) as e:
                last_err = e
                try:
                    if _sock is not None:
                        _sock.close()
                except OSError:
                    pass
                _sock = None
        raise ConnectionError(
            f"Could not reach the blender-mcp addon at {BLEND_HOST}:{BLEND_PORT}: {last_err}. "
            "In Blender press N, open MCP for Blender, click Start MCP Server."
        )


_SHOT_CODE = "import bpy, json, os, hashlib, time\nFP = {fp!r}\nMAX = {mx}\nres = {{'filepath': FP}}\nwin = area = reg = None\nfor w in bpy.context.window_manager.windows:\n    for a in w.screen.areas:\n        if a.type == 'VIEW_3D' and area is None:\n            for r in a.regions:\n                if r.type == 'WINDOW': win, area, reg = w, a, r\nif area is None: raise RuntimeError('No 3D Viewport is open in Blender, so there is nothing to capture.')\nspace = area.spaces.active; rv3d = space.region_3d\nif os.path.exists(FP): os.remove(FP)\nW, H = reg.width, reg.height\ns = min(1.0, MAX / float(max(W, H)))\nW2, H2 = max(64, int(W * s)), max(64, int(H * s))\ntry:\n    import gpu\n    off = gpu.types.GPUOffScreen(W2, H2)\n    try:\n        try: off.draw_view3d(bpy.context.scene, bpy.context.view_layer, space, reg, rv3d.view_matrix, rv3d.window_matrix, do_color_management=True)\n        except TypeError: off.draw_view3d(bpy.context.scene, bpy.context.view_layer, space, reg, rv3d.view_matrix, rv3d.window_matrix)\n        with off.bind():\n            buf = gpu.state.active_framebuffer_get().read_color(0, 0, W2, H2, 4, 0, 'UBYTE')\n    finally:\n        off.free()\n    buf.dimensions = W2 * H2 * 4\n    try:\n        import numpy as np\n        px = (np.array(buf, dtype=np.float32) / 255.0)\n        px[3::4] = 1.0\n        flat = px\n    except Exception:\n        flat = [v / 255.0 for v in buf]\n        for i in range(3, len(flat), 4): flat[i] = 1.0\n    img = bpy.data.images.new('_synerixcode_shot', W2, H2, alpha=True)\n    try:\n        img.pixels.foreach_set(flat)\n        img.filepath_raw = FP; img.file_format = 'PNG'; img.save()\n    finally:\n        bpy.data.images.remove(img)\n    res['method'] = 'offscreen'\nexcept Exception as e:\n    res['offscreen_error'] = str(e)[:200]\n    with bpy.context.temp_override(window=win, area=area, region=reg):\n        try: bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)\n        except Exception: pass\n        bpy.ops.screen.screenshot_area(filepath=FP)\n    res['method'] = 'screenshot_area'\nif not os.path.isfile(FP): raise RuntimeError('Blender did not write the capture file ' + FP)\nraw = open(FP, 'rb').read()\nres['bytes'] = len(raw); res['sha1'] = hashlib.sha1(raw).hexdigest()[:12]; res['size'] = [W2, H2]\nres['taken'] = time.strftime('%H:%M:%S')\nprint('SYNERIXCODE_SHOT_JSON:' + json.dumps(res))"


def _maybe_screenshot(result: Any) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    path = result.get("filepath") or result.get("path") or result.get("file")
    if not path or not os.path.isfile(path):
        return None
    try:
        raw = Path(path).read_bytes()
    except OSError:
        return None
    import base64

    return {
        "mimeType": "image/png" if str(path).lower().endswith(".png") else "image/jpeg",
        "data": base64.b64encode(raw).decode("ascii"),
    }


def dispatch_tool(name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
    args = arguments or {}
    bare = (name or "").split("/")[-1].split(".")[-1]
    images: list[dict[str, Any]] = []

    if bare in ("get_scene_info", "blender_get_scene_info"):
        data = blender_command("get_scene_info", {})
    elif bare in ("get_object_info", "blender_get_object_info"):
        data = blender_command("get_object_info", {"name": args.get("name") or args.get("object_name") or ""})
    elif bare in ("execute_blender_code", "execute_code", "blender_execute_code"):
        data = blender_command("execute_code", {"code": args.get("code") or ""})
    elif bare in ("get_viewport_screenshot", "blender_screenshot"):
        # 1.24.14: the addon's own screenshot copies the last drawn framebuffer,
        # which is stale while Blender's window is in the background. Render the
        # 3D View off-screen from the live scene into a unique file instead.
        tmp = os.path.join(tempfile.gettempdir(), f"synerixcode_blender_shot_{os.getpid()}_{time.time_ns()}.png")
        mx = max(64, min(4096, int(args.get("max_size") or 1000)))
        data = blender_command("execute_code", {"code": _SHOT_CODE.format(fp=tmp.replace("\\", "/"), mx=mx)})
        shot = _maybe_screenshot({"filepath": tmp})
        if shot:
            images.append(shot)
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
    elif bare in ("blender_export_fbx", "export_blender_fbx"):
        filepath = str(args.get("filepath") or args.get("path") or "").strip()
        if not filepath:
            raise ValueError("blender_export_fbx needs filepath")
        obj_filter = args.get("objects")
        code = (
            "import bpy\n"
            f"fp = {filepath!r}\n"
            "bpy.ops.object.select_all(action='DESELECT')\n"
        )
        if obj_filter:
            code += (
                f"want = {list(obj_filter)!r}\n"
                "for o in bpy.data.objects:\n"
                "    if o.name in want:\n"
                "        o.select_set(True)\n"
            )
        else:
            code += "bpy.ops.object.select_all(action='SELECT')\n"
        code += (
            "bpy.ops.export_scene.fbx(\n"
            "    filepath=fp, use_selection=True, apply_scale_options='FBX_SCALE_UNITS',\n"
            "    axis_forward='-Z', axis_up='Y', apply_unit_scale=True)\n"
            "selected = [o.name for o in bpy.context.selected_objects]\n"
            "return {'filepath': fp, 'objects': selected}\n"
        )
        data = blender_command("execute_code", {"code": code})
    else:
        # Pass-through for addon commands (polyhaven, etc.)
        params = dict(args)
        params.pop("user_prompt", None)
        data = blender_command(bare, params)

    result = data.get("result", data) if isinstance(data, dict) else data
    out: dict[str, Any] = {"ok": True, "result": result}
    if images:
        out["images"] = images
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        sys.stderr.write("[blender-shim] " + (fmt % args) + "\n")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _send(self, code: int, obj: Any) -> None:
        body = _json_bytes(obj)
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/", "/health", "/status"):
            live, err = blender_probe()
            self._send(
                200,
                {
                    "ok": True,
                    "shim": True,
                    "blender": live,
                    "host": BLEND_HOST,
                    "port": BLEND_PORT,
                    "http": HTTP_PORT,
                    "error": None if live else (
                        err or "addon not listening — in Blender: N → MCP for Blender → Start MCP Server"
                    ),
                },
            )
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send(400, {"ok": False, "error": "invalid JSON"})
            return
        if not isinstance(body, dict):
            self._send(400, {"ok": False, "error": "JSON object required"})
            return
        try:
            if path in ("/command", "/cmd"):
                ctype = str(body.get("type") or body.get("command") or "")
                params = body.get("params") if isinstance(body.get("params"), dict) else {}
                if not ctype:
                    self._send(400, {"ok": False, "error": "type is required"})
                    return
                data = blender_command(ctype, params)
                result = data.get("result", data) if isinstance(data, dict) else data
                self._send(200, {"ok": True, "result": result})
                return
            if path in ("/tool", "/call"):
                name = str(body.get("name") or body.get("tool") or "")
                args = body.get("arguments") if isinstance(body.get("arguments"), dict) else body.get("params") or {}
                if not name:
                    self._send(400, {"ok": False, "error": "name is required"})
                    return
                self._send(200, dispatch_tool(name, args if isinstance(args, dict) else {}))
                return
            self._send(404, {"ok": False, "error": "not found"})
        except Exception as e:
            traceback.print_exc()
            self._send(200, {"ok": False, "error": str(e)})


def main() -> int:
    if already_up():
        print(f"or blender shim already on {HEALTH_URL}", flush=True)
        return 0
    try:
        httpd = ThreadingHTTPServer((HTTP_HOST, HTTP_PORT), Handler)
    except OSError as e:
        if already_up():
            print(f"or blender shim already on {HEALTH_URL}", flush=True)
            return 0
        print(f"could not bind {HTTP_HOST}:{HTTP_PORT}: {e}", file=sys.stderr)
        return 1
    live, err = blender_probe()
    print(
        f"or blender shim http://{HTTP_HOST}:{HTTP_PORT} -> {BLEND_HOST}:{BLEND_PORT} "
        f"(addon {'up' if live else 'down'}" + (f": {err}" if err else "") + ")",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            httpd.server_close()
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
