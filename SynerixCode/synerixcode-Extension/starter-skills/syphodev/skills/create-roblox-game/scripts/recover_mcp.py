#!/usr/bin/env python3
"""Diagnose and repair the Studio MCP link without a human.

Proven on 2026-08-30 against a real dead connection, recovered end to end with
no human input.

THE ROOT CAUSE, which the older "kill all, respawn one" note never explained:

The third-party `robloxstudio-mcp` is TWO halves that must agree on a port.

    half 1   a node server, spawned by the MCP client (Claude Code)
    half 2   the Studio plugin, which POLLS one port listed in its own panel

Each server instance tries to bind **3002** plus one high port (48741-ish).
When two instances exist, the second loses 3002 and takes a different high port,
and the plugin ends up pointed at whichever one it saw first. Kill that one and
the plugin polls a dead port forever, while the surviving server sits on a port
nothing is asking about. Every call then returns "Studio plugin connection
timeout", which reads like the plugin is broken when it is actually stranded.

**The Studio plugin's `MCP Server` ribbon button spawns its OWN npx server.**
That is how the duplicate appears in the first place. Never click that button to
"reconnect" - it makes the problem worse. Open its panel and use Connect.

    recover_mcp.py            # diagnose, print the verdict
    recover_mcp.py --fix      # kill duplicates so the client respawns exactly one

The server half is deterministic and this script owns it. The plugin half needs
one click on Connect in the MCP Server panel, which the agent does with
computer-use. See references/recovery.md for that half.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time

MARKER = "robloxstudio-mcp"


def ps(cmd: str) -> str:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
        capture_output=True, text=True, timeout=120,
    )
    return (out.stdout or "").strip()


def servers() -> list[dict]:
    """Every node process that is a robloxstudio-mcp server, with its ports."""
    raw = ps(
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | "
        f"Where-Object {{ $_.CommandLine -like '*{MARKER}*' }} | "
        "Select-Object ProcessId,CreationDate | ConvertTo-Json -Compress"
    )
    if not raw:
        return []
    data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]

    procs = []
    for row in data:
        pid = row["ProcessId"]
        ports_raw = ps(
            "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | "
            f"Where-Object {{ $_.OwningProcess -eq {pid} }} | "
            "Select-Object -ExpandProperty LocalPort | ConvertTo-Json -Compress"
        )
        ports: list[int] = []
        if ports_raw:
            parsed = json.loads(ports_raw)
            ports = [parsed] if isinstance(parsed, int) else list(parsed)
        procs.append({"pid": pid, "ports": sorted(set(ports))})
    return procs


def listening(port: int) -> int | None:
    raw = ps(
        f"Get-NetTCPConnection -State Listen -LocalPort {port} -ErrorAction SilentlyContinue | "
        "Select-Object -ExpandProperty OwningProcess | ConvertTo-Json -Compress"
    )
    if not raw:
        return None
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, int) else parsed[0]


def report(procs: list[dict]) -> None:
    if not procs:
        print("  no robloxstudio-mcp server running")
        return
    for p in procs:
        ports = ", ".join(str(x) for x in p["ports"]) or "none"
        print(f"  pid {p['pid']:<8} listening: {ports}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fix", action="store_true",
                    help="kill every server so the client respawns exactly one")
    a = ap.parse_args()

    print("robloxstudio-mcp servers:")
    procs = servers()
    report(procs)

    # A "serving" process is one holding a high port the plugin could poll.
    serving = [p for p in procs if any(x > 1024 and x != 3002 for x in p["ports"])]

    if not a.fix:
        print()
        if len(serving) > 1:
            print("VERDICT: more than one server is serving. This is the split-brain")
            print("state: the plugin polls one of them and the client talks to the")
            print("other. Re-run with --fix.")
            return 1
        if not procs:
            print("VERDICT: no server at all. Make any MCP tool call - the client")
            print("respawns it - then re-run this.")
            return 1
        if not serving:
            print("VERDICT: a server exists but holds no pollable port. Re-run with --fix.")
            return 1
        port = max(x for x in serving[0]["ports"] if x != 3002)
        print("VERDICT: exactly one server, healthy.")
        print(f"The plugin's MCP Server panel must be set to port {port}, then Connect.")
        print("Then PROVE it with a real execute_luau call - the panel's green dot is")
        print("not evidence, it only says the plugin thinks it connected.")
        return 0

    if not procs:
        print("\nnothing to kill.")
        return 0

    pids = " ,".join(str(p["pid"]) for p in procs)
    print(f"\nkilling all {len(procs)} server process(es) so exactly one comes back...")
    ps(f"Stop-Process -Id {pids} -Force -ErrorAction SilentlyContinue")
    time.sleep(3)

    left = servers()
    if left:
        print("  some survived:")
        report(left)
        return 1

    print("  all gone. NOW MAKE ANY MCP TOOL CALL - the client respawns the server")
    print("  on demand, and with 3002 free the new one takes both ports.")
    print("  Then re-run this script to read the port, set it in the plugin panel,")
    print("  click Connect, and prove it with execute_luau.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
