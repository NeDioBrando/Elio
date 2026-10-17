"""Serve exported mesh/texture blobs to Roblox Studio over localhost.

    python scripts/serve_assets.py --dir work/serve [--port 48900]

Bound to 127.0.0.1 ONLY. Studio's plugin fetches from it with
HttpService:GetAsync, which works in plugin context even when
HttpService.HttpEnabled is false. Nothing leaves the machine and nothing is
uploaded to Roblox.
"""
from __future__ import annotations
import argparse, functools, http.server, socketserver, sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--port", type=int, default=48900)
    a = ap.parse_args()

    root = Path(a.dir).resolve()
    if not root.is_dir():
        raise SystemExit("not a directory: {}".format(root))
    blobs = sorted(p.name for p in root.glob("*.bin"))
    if not blobs:
        print("[serve] WARNING: no .bin files in {}. Run export_for_studio.py first."
              .format(root))

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", a.port), handler) as httpd:
        print("[serve] http://127.0.0.1:{}/ from {}".format(a.port, root))
        for b in blobs:
            print("[serve]   {}".format(b))
        print("[serve] Ctrl-C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[serve] stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
