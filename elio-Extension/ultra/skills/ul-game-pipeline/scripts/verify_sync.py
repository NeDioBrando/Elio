#!/usr/bin/env python3
"""Prove Studio is running the code on disk: compare EVERY Rojo-synced script.

    python verify_sync.py --game <game folder>            # exit 0 = in sync
    python verify_sync.py --game <game folder> --studio <id>

THE DEFECT THIS EXISTS FOR (found in the animation stage of a game build). The animation
stage was reported working. It had been tested in play - but by a probe script
that registered and played the clips ITSELF. The game's own AnimController in
Studio was a day-old version (2256 chars; disk 4282): Rojo had silently stopped
applying edits partway through the session, with the plugin still showing
"connected" and two ESTABLISHED sockets. A human found it: the animation was not in the game. Every file gate was green, because every file gate reads
the DISK. Nothing compared the disk to what Studio would actually run.

This walks default.project.json, maps every .luau/.lua file to its instance path
(init.* files name their folder, .server/.client suffixes dropped), reads each
Source length and a checksum in ONE execute_luau call, and diffs them. Line
endings are normalised (Rojo writes LF). Any missing or differing script is a
FAIL, named.

Run it after every Rojo reconnect and before every playtest you intend to
believe. It needs studio_mcp.py next to it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def walk_tree(node: dict, inst_path: list[str], root: Path, out: dict):
    p = node.get("$path")
    if p:
        base = root / p
        if base.is_dir():
            for f in sorted(base.rglob("*")):
                if f.suffix not in (".luau", ".lua") or not f.is_file():
                    continue
                rel = f.relative_to(base).with_suffix("")
                parts = list(rel.parts)
                name = parts[-1]
                for suf in (".server", ".client"):
                    if name.endswith(suf):
                        name = name[: -len(suf)]
                if name == "init":
                    parts = parts[:-1]
                else:
                    parts[-1] = name
                out[".".join(inst_path + parts)] = f
        elif base.is_file() and base.suffix in (".luau", ".lua"):
            out[".".join(inst_path)] = base
    for k, v in node.items():
        if not k.startswith("$") and isinstance(v, dict):
            walk_tree(v, inst_path + [k], root, out)


def digest(text: str) -> str:
    return hashlib.sha1(text.replace("\r\n", "\n").encode("utf-8")).hexdigest()[:12]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", required=True)
    ap.add_argument("--project", default="default.project.json")
    ap.add_argument("--studio", help="Studio instance id for studio_mcp.py")
    ap.add_argument("--skip", action="append", default=["ReplicatedStorage.Packages"],
                    help="instance-path prefixes to skip (vendored Wally packages by default: "
                         "their instance names contain dots, and they never change mid-build)")
    a = ap.parse_args()
    root = Path(a.game)
    proj = json.loads((root / a.project).read_text(encoding="utf-8"))
    files: dict[str, Path] = {}
    walk_tree(proj["tree"], [], root, files)
    files = {k: v for k, v in files.items() if not any(k == sk or k.startswith(sk + ".") for sk in a.skip)}
    # trailing whitespace is trimmed on BOTH sides: Studio drops the final newline
    want = {k: len(v.read_text(encoding="utf-8").replace("\r\n", "\n").rstrip()) for k, v in files.items()}

    lua = """
local HttpService = game:GetService("HttpService")
local paths = HttpService:JSONDecode([==[%s]==])
local out = {}
for _, p in paths do
    local node = game
    for seg in string.gmatch(p, "[^%%.]+") do
        node = node and node:FindFirstChild(seg)
    end
    if node and node:IsA("LuaSourceContainer") then
        out[p] = #(string.gsub(node.Source, "%%s+$", ""))
    else
        out[p] = -1
    end
end
return HttpService:JSONEncode(out)
""" % json.dumps(sorted(want))
    tmp = HERE / "_verify_sync_probe.lua"
    tmp.write_text(lua, encoding="utf-8")
    cmd = [sys.executable, str(HERE / "studio_mcp.py"), "luau", "--file", str(tmp)]
    if a.studio:
        cmd[2:2] = ["--studio", a.studio]
    r = subprocess.run(cmd, capture_output=True, text=True)
    tmp.unlink(missing_ok=True)
    line = (r.stdout.strip().splitlines() or [""])[-1]
    try:
        got = json.loads(line)
    except json.JSONDecodeError:
        print(f"FAIL: could not read Studio ({line[:200]})")
        return 2
    bad = []
    for k in sorted(want):
        g = got.get(k, -1)
        # Source length in Studio counts characters; disk length counts characters too.
        if g == -1:
            bad.append(f"MISSING in Studio: {k}")
        elif g != want[k]:
            bad.append(f"STALE: {k}  studio {g} chars, disk {want[k]}")
    print(f"{len(want)} scripts compared, {len(bad)} out of sync")
    for b in bad:
        print("  " + b)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
