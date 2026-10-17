"""Receive Studio viewport captures over localhost and write PNGs.

    python scripts/capture_receiver.py --out <dir> [--port 8799]

WHY. Screenshots for a human need to be FILES. The MCP's capture returns an image
to the agent only, and grabbing the desktop fails whenever Studio is not the
foreground window or the PC is locked / on remote control (measured 2026-09-15:
a desktop-grab tour saved zero frames, another saved every frame one view late).
Studio's own CaptureService renders regardless, so a Luau script sets each camera,
captures, reads the pixels and POSTs them here - camera and capture live in ONE
script and cannot drift out of step.

Protocol (all POST, body = text):
    /begin?name=<file>&w=<w>&h=<h>          start an image
    /rows?name=<file>&y=<first row>         body = hex of RGB bytes for whole rows
    /end?name=<file>                        write <out>/<file>.png
"""

import argparse
import http.server
import os
import socketserver
import sys
import urllib.parse

import numpy as np
from PIL import Image

STATE = {}


def emit_lua(views_path, port):
    """luau/capture_views.lua with the views and receiver port filled in, ready for execute_luau."""
    import json
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "luau", "capture_views.lua"), encoding="utf-8") as f:
        code = f.read()
    with open(views_path, encoding="utf-8") as f:
        views = json.load(f)
    bad = [v for v in views if not {"name", "eye", "look"} <= set(v)]
    if bad:
        raise SystemExit(f"views need name, eye and look: {bad[:2]}")
    return code.replace("{port}", str(port)).replace("{views}", json.dumps(views))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--port", type=int, default=8799)
    ap.add_argument("--seconds", type=int, default=900)
    ap.add_argument("--emit-lua", metavar="VIEWS_JSON",
                    help="print the capture tour Luau for these views and exit")
    a = ap.parse_args(argv)
    if a.emit_lua:
        sys.stdout.write(emit_lua(a.emit_lua, a.port))
        return 0
    if not a.out:
        ap.error("--out is required to receive")
    os.makedirs(a.out, exist_ok=True)

    class H(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            u = urllib.parse.urlparse(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            name = q.get("name", "capture")
            msg = "ok"
            if u.path == "/begin":
                w, h = int(q["w"]), int(q["h"])
                STATE[name] = np.zeros((h, w, 3), np.uint8)
            elif u.path == "/rows":
                arr = STATE[name]
                data = np.frombuffer(bytes.fromhex(body.decode("ascii")), np.uint8)
                y = int(q["y"])
                w = arr.shape[1]
                rows = data.reshape(-1, w, 3)
                arr[y:y + rows.shape[0]] = rows
            elif u.path == "/end":
                path = os.path.join(a.out, f"{name}.png")
                Image.fromarray(STATE.pop(name)).save(path)
                msg = path
                print("wrote", path, flush=True)
            out = msg.encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *args):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", a.port), H) as srv:
        srv.timeout = 1
        import time
        end = time.time() + a.seconds
        print(f"receiving on {a.port} into {a.out}", flush=True)
        while time.time() < end:
            srv.handle_request()
    return 0


if __name__ == "__main__":
    sys.exit(main())
