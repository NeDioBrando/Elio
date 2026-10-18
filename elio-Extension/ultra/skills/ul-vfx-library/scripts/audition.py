#!/usr/bin/env python3
"""Audition harvested recipes for ONE role, side by side, in any place.

    python audition.py --lib "<lib>" --at -80,8,80 --phase 0.3 --out work/aud.lua \
        --cand Splash-01 --cand "WaterBurst|ToonLiquidAlpha,ToonLiquidColor" \
        --cand "WaterRipple@enable"

then run the payload in Studio (execute_luau --file, or loadstring from the sink)
and screenshot. Slot 0 is screen-LEFT, with a floor bar of (i+1) segments under
each slot so a candidate is never credited with its neighbour's look.

WHY THIS EXISTS. An audition tool welded to one project (a fixed stage, a named
rig, hard-coded candidate groups) cannot be used in anyone else's place. This one
takes every project fact as an argument, and it builds on the skill's own
compose.py so what is auditioned is what the engine renders.

Candidate syntax:  STEM[|layer,layer or #n][@emit|@enable][*scale]
  |layers   pick layers by name or #index (variant sheets: see the curate.py notes)
  @enable   stream it (auras, loops) instead of one Emit
  *scale    multiply the normalised size (default: every slot ~--size studs)

Every candidate is NORMALISED to about --size studs across, because packs are
authored from dot-sized to 35 studs and a side-by-side at scale 1 compares
sizes, not looks. The printed line gives the scale each slot used; carry that
number into the shipped effect.

Needs a Folder at --target (default Workspace.__VFXStage) to exist; create an
empty one. It does NOT run stage.lua, which moves the Baseplate and spawn and
must never run in a real game's place.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def parse(c: str):
    scale = 1.0
    if "*" in c:
        c, s = c.rsplit("*", 1)
        scale = float(s)
    mode = "emit"
    if "@" in c:
        c, mode = c.rsplit("@", 1)
    layers = None
    if "|" in c:
        c, ls = c.split("|", 1)
        layers = [x.strip() for x in ls.split(",") if x.strip()]
    return c.strip(), layers, mode, scale


def extent(rec: dict, layers) -> float:
    best = 0.0
    for i, L in enumerate(rec["layers"], 1):
        if layers and L["name"] not in layers and f"#{i}" not in layers:
            continue
        pr = L.get("props", {})
        try:
            size = max(k[1] for k in pr["Size"]["NumberSequence"])
        except (KeyError, TypeError, ValueError):
            size = 1.0
        try:
            sp = max(pr["Speed"]["NumberRange"])
            life = max(pr["Lifetime"]["NumberRange"])
            drag = pr.get("Drag", 0) or 0
            travel = sp * life / (1 + drag * life)
        except (KeyError, TypeError, ValueError):
            travel = 0.0
        best = max(best, size + 2 * travel)
    return max(best, 0.3)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lib", required=True)
    ap.add_argument("--cand", action="append", required=True)
    ap.add_argument("--at", default="0,8,0", help="world x,y,z of the row centre (ground level)")
    ap.add_argument("--phase", type=float, default=0.3)
    ap.add_argument("--spacing", type=float, default=11.0)
    ap.add_argument("--size", type=float, default=7.0, help="normalised size per slot, studs")
    ap.add_argument("--lift", type=float, default=2.0, help="emit height above --at")
    ap.add_argument("--target", default="Workspace.__VFXStage")
    ap.add_argument("--tint", help="r,g,b 0-255 applied to every slot")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    lib = Path(a.lib)
    rdir = lib / "recipes" if (lib / "recipes").is_dir() else lib
    x0, y0, z0 = (float(v) for v in a.at.split(","))
    cands = [parse(c) for c in a.cand]
    n = len(cands)
    mid = (n - 1) / 2
    els, tl, labels = [], [], []
    for i, (stem, layers, mode, scale) in enumerate(cands):
        rec = json.loads((rdir / f"{stem}.json").read_text(encoding="utf-8"))
        # camera looks down +Z from -Z, so world +X is screen-LEFT: slot 0 at +X
        x = x0 + (mid - i) * a.spacing
        pos = [x, y0 + a.lift, z0]
        k = round(scale * a.size / extent(rec, layers), 3)
        e = {"id": f"c{i}", "kind": "recipe", "recipe": stem, "anchor": pos, "scale": k, "centred": True}
        if layers:
            e["layers"] = layers
        if a.tint:
            e["tint"] = [int(v) / 255 for v in a.tint.split(",")]
        if mode == "enable":
            e["mode"] = "continuous"
            tl.append({"t": 0.05, "id": f"c{i}", "act": "enable", "on": True})
        else:
            tl.append({"t": 0.05, "id": f"c{i}", "act": "emit"})
        els.append(e)
        # slot marker: (i+1) small bars on the ground, counted left to right
        for j in range(i + 1):
            els.append({"id": f"m{i}_{j}", "kind": "part", "anchor": [x - 1.5 + j * 0.8, y0 + 0.15, z0 - 4.5],
                        "size": [0.5, 0.2, 0.5], "material": "Neon", "color": [1, 0, 1]})
        labels.append(f"{i}:{stem}{'|' + ','.join(layers) if layers else ''} x{k}")
    width = (n - 1) * a.spacing
    comp = {"name": "Audition", "duration": 0.05 + a.phase + 1, "elements": els, "timeline": tl,
            "camera": {"look": [x0, y0 + a.lift + 1, z0], "offset": [0, 6 + width * 0.12, -(14 + width * 0.62)],
                       "fov": 50}}
    cpath = Path(a.out).with_suffix(".json")
    cpath.write_text(json.dumps(comp), encoding="utf-8")
    r = subprocess.run([sys.executable, str(HERE / "compose.py"), str(cpath), "--lib", str(lib),
                        "--target", a.target, "--freeze", str(0.05 + a.phase), "--out", a.out],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout + r.stderr, file=sys.stderr)
        return r.returncode
    print(f"audition @{a.phase:.2f}s L->R  " + " | ".join(labels))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
