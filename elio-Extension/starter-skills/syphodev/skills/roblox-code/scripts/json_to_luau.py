#!/usr/bin/env python3
"""Emit a Luau Config module from a slice of a design JSON file.

    python json_to_luau.py design/game.json --key config --out src/shared/Config/GameConfig.luau
    python json_to_luau.py design/map.json --key layout --pick size,floorY,path --out src/shared/Config/MapConfig.luau

WHY (found while building a game, 2026-09-28): the contract (`design/game.json`)
holds every tunable - tower levels, enemy stats, 20 waves, economy. Retyping
that into GameConfig.luau by hand makes two copies that drift the first time
someone rebalances, and a balance pass stops being a data edit. So Config is
GENERATED from the contract, carries a do-not-edit header naming its source,
and the next rebalance is: edit the design, re-run this, run the gates.

Output is deterministic (keys sorted) so a re-run with no change is a no-op diff,
and `--check` exits 1 if the file on disk is stale - wire it into a gate.
JSON arrays become Luau arrays (1-based), objects become tables, keys that are
not identifiers become ["key"], null becomes nil (dropped).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
RESERVED = {"and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in",
            "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while", "continue", "type"}


def lua(v, ind: int) -> str:
    pad, inner = "\t" * ind, "\t" * (ind + 1)
    if v is None:
        return "nil"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v) if isinstance(v, float) else str(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        if not v:
            return "{}"
        if all(not isinstance(x, (list, dict)) for x in v):
            return "{ " + ", ".join(lua(x, 0) for x in v) + " }"
        return "{\n" + "".join(f"{inner}{lua(x, ind + 1)},\n" for x in v) + pad + "}"
    if isinstance(v, dict):
        items = [(k, x) for k, x in sorted(v.items()) if x is not None and not str(k).startswith("_")]
        if not items:
            return "{}"
        out = []
        for k, x in items:
            key = k if IDENT.match(k) and k not in RESERVED else f"[{json.dumps(k)}]"
            out.append(f"{inner}{key} = {lua(x, ind + 1)},\n")
        return "{\n" + "".join(out) + pad + "}"
    raise TypeError(type(v))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--key", help="dotted path into the JSON, e.g. config or layout")
    ap.add_argument("--pick", help="comma list of top-level keys to keep from the slice")
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", help="module name for the header (default: out file stem)")
    ap.add_argument("--check", action="store_true", help="exit 1 if --out is stale, write nothing")
    a = ap.parse_args()

    data = json.loads(Path(a.src).read_text(encoding="utf-8"))
    for part in (a.key.split(".") if a.key else []):
        data = data[part]
    if a.pick:
        data = {k: data[k] for k in a.pick.split(",")}
    name = a.name or Path(a.out).stem
    src = Path(a.src).as_posix()
    text = (f"--!strict\n-- {name} - GENERATED from {src}"
            f"{' [' + a.key + ']' if a.key else ''} by roblox-code/scripts/json_to_luau.py.\n"
            f"-- DO NOT EDIT. Change the design file and re-run the generator.\n\n"
            f"local {name} = {lua(data, 0)}\n\nreturn {name}\n")
    out = Path(a.out)
    if a.check:
        cur = out.read_text(encoding="utf-8") if out.exists() else ""
        if cur != text:
            print(f"STALE {out} - re-run json_to_luau.py")
            return 1
        print(f"fresh {out}")
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(text.encode("utf-8"))
    print(f"wrote {out} ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
