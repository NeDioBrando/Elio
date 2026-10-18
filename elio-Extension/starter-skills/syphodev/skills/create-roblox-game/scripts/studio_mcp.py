#!/usr/bin/env python3
"""Call Roblox Studio's built-in MCP server DIRECTLY over stdio, bypassing the
Claude client's cached tool schema.

DEFECT IT EXISTS FOR (2026-09-11, 2026-09-28 twice, including a FRESH session):
the Claude client's `mcp__Roblox_Studio__execute_luau` schema has no
`datamodel_type`, but StudioMCP.exe now REQUIRES it, so every call fails with
"datamodel_type is required". Passing the field anyway is stripped by the client;
ToolSearch returns the same stale schema; a cleared session did not fix it.
The server itself advertises the field (enum Edit / Client / Server) - so talk to
it directly. Bonus: `--dm Server` / `--dm Client` reach the RUNNING game during a
playtest, which the old wisdom said was impossible.

Usage:
  studio_mcp.py list                                   # tools + studios
  studio_mcp.py luau --code 'return game.PlaceId'      # Edit datamodel
  studio_mcp.py luau --file probe.luau --dm Server     # running server
  studio_mcp.py call start_stop_play '{"is_start": true}'
  studio_mcp.py call get_console_output '{}'

studio_id is filled in automatically when exactly one Studio is open (or pass
--studio NAME_SUBSTRING). Exits 1 on any tool error, so it can gate.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys


def find_exe() -> str:
    base = os.path.expandvars(r"%LOCALAPPDATA%\Roblox\Versions")
    hits = sorted(glob.glob(os.path.join(base, "*", "StudioMCP.exe")), key=os.path.getmtime)
    if not hits:
        sys.exit("StudioMCP.exe not found under %LOCALAPPDATA%\\Roblox\\Versions")
    return hits[-1]


class Client:
    def __init__(self) -> None:
        self.p = subprocess.Popen([find_exe()], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
        self.n = 0
        self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                "clientInfo": {"name": "studio_mcp.py", "version": "1"}})
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _send(self, o: dict) -> None:
        assert self.p.stdin
        self.p.stdin.write(json.dumps(o) + "\n")
        self.p.stdin.flush()

    def rpc(self, method: str, params: dict) -> dict:
        self.n += 1
        self._send({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params})
        assert self.p.stdout
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError("StudioMCP closed the pipe")
            msg = json.loads(line)
            if msg.get("id") == self.n:
                return msg

    def tool(self, name: str, args: dict) -> tuple[bool, str]:
        r = self.rpc("tools/call", {"name": name, "arguments": args})
        if "error" in r:
            return False, json.dumps(r["error"])
        res = r["result"]
        text = "\n".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        return not res.get("isError", False), text

    def close(self) -> None:
        self.p.kill()


def studio_id(c: Client, want: str | None) -> str:
    ok, text = c.tool("list_roblox_studios", {})
    studios = json.loads(text).get("studios", []) if ok else []
    # Bringing Studio to the front (computer-use open_application) briefly
    # registers a SECOND instance with name None (measured 2026-09-28). A nameless
    # entry is never the place you mean when a named one exists.
    named = [s for s in studios if s.get("name")]
    if named:
        studios = named
    if want:
        studios = [s for s in studios if want.lower() in s["name"].lower()]
    if len(studios) != 1:
        sys.exit(f"need exactly one Studio, found {len(studios)}: {studios}")
    return studios[0]["id"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "luau", "call"])
    ap.add_argument("tool", nargs="?")
    ap.add_argument("args", nargs="?", default="{}")
    ap.add_argument("--code")
    ap.add_argument("--file")
    ap.add_argument("--dm", default="Edit", choices=["Edit", "Client", "Server"])
    ap.add_argument("--studio")
    a = ap.parse_args()
    c = Client()
    try:
        if a.cmd == "list":
            r = c.rpc("tools/list", {})
            print(" ".join(t["name"] for t in r["result"]["tools"]))
            print(c.tool("list_roblox_studios", {})[1])
            return
        sid = studio_id(c, a.studio)
        if a.cmd == "luau":
            code = a.code if a.code is not None else open(a.file, encoding="utf-8").read()
            ok, text = c.tool("execute_luau", {"code": code, "datamodel_type": a.dm, "studio_id": sid})
        else:
            args = json.loads(a.args)
            args.setdefault("studio_id", sid)
            ok, text = c.tool(a.tool, args)
        print(text)
        sys.exit(0 if ok else 1)
    finally:
        c.close()


if __name__ == "__main__":
    main()
