#!/usr/bin/env python3
"""Decide, from what Studio measured, which candidate each role gets.

Input is report.lua's return value saved verbatim to a file:

    role,id,loaded,length
    sheep_bleat,1234,true,1.482

Three gates, in this order, and a candidate must clear all three:

    1. loaded == true    the id resolves and this place is permitted to use it
    2. length > 0        a zero-length sound is a broken asset, not a short one
    3. min_len <= length <= max_len   the role's band

Only then does the search score break the tie. A high-scoring listing that
fails a gate loses to a low-scoring one that passes, always. Rejections are
kept with their reason: on this project the record of what was rejected and why
is part of the deliverable.

    pick.py work/candidates.json work/report.txt --out work/manifest.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_report(text: str) -> dict[tuple[str, int], dict]:
    out: dict[tuple[str, int], dict] = {}
    for raw in text.splitlines():
        line = raw.strip().strip('"')
        if not line or line.startswith("NO PROBE"):
            continue
        parts = line.split(",")
        if len(parts) != 4:
            continue
        role, sid, loaded, length = parts
        try:
            out[(role, int(sid))] = {"loaded": loaded.strip() == "true", "length": float(length)}
        except ValueError:
            continue
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("candidates")
    ap.add_argument("report", help="report.lua output saved to a file")
    ap.add_argument("--out", default="work/manifest.json")
    a = ap.parse_args()

    data = json.loads(Path(a.candidates).read_text(encoding="utf-8"))
    measured = parse_report(Path(a.report).read_text(encoding="utf-8"))
    if not measured:
        raise SystemExit(
            "report file held no measurements. Run probe.lua, wait a beat, then "
            "report.lua, and save its return value verbatim."
        )

    manifest = {"name": data.get("name", "sfx"), "sounds": [], "unfilled": [], "rejected": []}

    for role in data["roles"]:
        name = role["role"]
        lo, hi = role["min_len"], role["max_len"]
        winner = None
        for cand in sorted(role["candidates"], key=lambda c: -c["score"]):
            m = measured.get((name, cand["id"]))
            if m is None:
                reason = "never probed"
            elif not m["loaded"]:
                reason = "did not load in Studio (unresolvable id, or audio this place may not use)"
            elif m["length"] <= 0:
                reason = "zero length: broken asset"
            elif not (lo <= m["length"] <= hi):
                reason = f"length {m['length']:.3f}s outside the {lo}-{hi}s band for this role"
            else:
                winner = dict(cand)
                winner["length"] = round(m["length"], 3)
                winner["length_source"] = "Sound.TimeLength, measured in Studio"
                listed = cand.get("listed_duration")
                if listed not in (None, ""):
                    listed = float(listed)
                    # A listed 0 against any real length is the common failure
                    # (measured on a genuine 0.500s sound), and on short SFX an
                    # absolute threshold would never catch it. Compare relatively.
                    lied = (listed == 0 and m["length"] > 0) or (
                        listed > 0 and abs(listed - m["length"]) / listed > 0.25
                    )
                    if lied:
                        winner["listing_was_wrong"] = (
                            f"listing said {listed}s, Studio measured {m['length']:.3f}s"
                        )
                break
            manifest["rejected"].append(
                {"role": name, "id": cand["id"], "name": cand["name"], "reason": reason}
            )

        if winner is None:
            manifest["unfilled"].append(
                {"role": name, "query": role["query"],
                 "hint": "widen the band, retry the query, or search a synonym"}
            )
            continue

        manifest["sounds"].append(
            {
                "role": name,
                "id": winner["id"],
                "name": winner["name"],
                "creator": winner["creator"],
                "length": winner["length"],
                "volume": role["volume"],
                "looped": role["looped"],
                "kind": winner["audioType"],
                "source": "Roblox Creator Store, free, inserted by id. No upload.",
                **({"listing_was_wrong": winner["listing_was_wrong"]} if "listing_was_wrong" in winner else {}),
            }
        )

    dest = Path(a.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    print(f"filled {len(manifest['sounds'])} / {len(data['roles'])} roles -> {dest}")
    for s in manifest["sounds"]:
        flag = "  <- listing lied" if "listing_was_wrong" in s else ""
        print(f"  {s['role']:<22} {s['id']:>16}  {s['length']:>6.3f}s  {s['name'][:40]}{flag}")
    for u in manifest["unfilled"]:
        print(f"  UNFILLED {u['role']:<14} {u['hint']}")
    if manifest["unfilled"]:
        print("\nan unfilled role is a FAILURE, not a warning. Do not emit a bank with holes in it.")
    return 1 if manifest["unfilled"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
