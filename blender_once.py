#!/usr/bin/env python3
"""One-shot JSON round-trip to the blender-mcp addon (TCP 9876).

  blender_once.py --probe
  blender_once.py IN.json OUT.json
"""
from __future__ import annotations

import json
import os
import socket
import sys

HOST = os.environ.get("BLENDER_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLENDER_PORT", "9876"))


def probe() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2.5)
    try:
        s.connect((HOST, PORT))
        print("BLENDER_UP", flush=True)
        return 0
    except OSError:
        print("BLENDER_DOWN", flush=True)
        return 1
    finally:
        try:
            s.close()
        except OSError:
            pass


def recv_json(sock: socket.socket) -> dict:
    sock.settimeout(180.0)
    chunks: list[bytes] = []
    while True:
        chunk = sock.recv(8192)
        if not chunk:
            if not chunks:
                raise ConnectionError("Blender closed the socket")
            break
        chunks.append(chunk)
        raw = b"".join(chunks)
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
    raise ValueError("incomplete JSON from Blender")


def send_file(in_path: str, out_path: str) -> int:
    with open(in_path, "r", encoding="utf-8") as f:
        req = json.load(f)
    if not isinstance(req, dict):
        raise ValueError("request must be a JSON object")
    payload = json.dumps({"type": req.get("type") or req.get("command"), "params": req.get("params") or {}}).encode("utf-8")
    sock = socket.create_connection((HOST, PORT), 8)
    try:
        sock.sendall(payload)
        data = recv_json(sock)
    finally:
        try:
            sock.close()
        except OSError:
            pass
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print("ELIO_BLENDER_OK", flush=True)
    return 0


def main(argv: list[str]) -> int:
    if "--probe" in argv or (len(argv) == 1):
        return probe()
    if len(argv) < 3:
        print("usage: blender_once.py --probe | IN.json OUT.json", file=sys.stderr)
        return 2
    try:
        return send_file(argv[1], argv[2])
    except Exception as e:
        err = {"status": "error", "message": str(e)}
        try:
            with open(argv[2], "w", encoding="utf-8") as f:
                json.dump(err, f)
        except OSError:
            pass
        print("ELIO_BLENDER_ERR " + str(e), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
