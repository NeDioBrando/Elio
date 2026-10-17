#!/usr/bin/env python3
"""Copy the harvested recipes a game actually uses into that game, by role.

    python curate.py --lib "<lib>" --out <game>/vfx/recipes \
        --pick "SplashHit=WaterBurst|ToonLiquidAlpha,ToonLiquidColor" \
        --pick "PopBurst=Burst_4|Realistic*0.6" \
        --pick "SunBeam=Lava-01|#3"

then  python emit_luau.py --lib <game>/vfx/recipes <game>/src/shared/Vfx/VFXKit.luau

WHY. The skill says "harvest wide, ship narrow" and
emit_luau.py inlines EVERY recipe in the directory it is pointed at - pointed at
a library of over a thousand recipes that is megabytes of Luau and past the 200k Source cap.
So a game needs its own small recipe directory, and before this each project
built it by hand. Two things go wrong by hand, both silent:

  * a VARIANT SHEET copied whole (WaterBurst ships Toon, Realistic and Pixel
    versions of one burst, meant to be used ONE AT A TIME) stacks three art
    styles on every hit;
  * the file keeps the pack's name, so the game's call site says "Burst_4" and
    nobody can tell which role it fills.

Syntax:  NAME=STEM[|layer,layer or #n][*countmul][@burst|@loop]
  NAME      the name the game calls (VFXKit.build(NAME, ...)); the file is NAME.json
  |layers   keep only these layers (by name, or #index for duplicate names)
  *countmul multiply every burst layer's emit count (harvested counts are a
            GUESS - Rate*0.1 - so this is the knob the audition usually turns)
  @burst    make every CONTINUOUS ParticleEmitter layer a one-shot burst, count
            clamp(round(Rate * 0.25), 1, 30), original rate kept as
            "converted_from_rate". NEEDED for any effect fired by an event:
            VFXKit's handle.emit() fires ONLY burst layers, and packs often
            record their emitters as continuous (left Enabled with a Rate). In
            one real game 11 of 19 curated effects - the pop, the shockwave, the
            lightning, the sparks - emitted NOTHING on emit(), silently, while
            the audition (which fires every layer) showed them fine.
  @loop     the mirror image: make every BURST ParticleEmitter layer continuous,
            Rate = count / (mean lifetime) so the density matches one burst in
            flight. NEEDED for a persistent effect built with setEnabled(true),
            which enables only continuous layers - a slow-zone pool
            (a harvested burst ripple) never appeared under its source.

Provenance ("from", "layers_kept") is written into the copy, so a curated set
can always be traced back to the library and re-curated.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lib", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pick", action="append", required=True)
    a = ap.parse_args()
    lib = Path(a.lib)
    rdir = lib / "recipes" if (lib / "recipes").is_dir() else lib
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    bad = 0
    for pick in a.pick:
        name, spec = pick.split("=", 1)
        mul = 1.0
        as_burst = spec.endswith("@burst")
        as_loop = spec.endswith("@loop")
        if as_burst:
            spec = spec[: -len("@burst")]
        if as_loop:
            spec = spec[: -len("@loop")]
        if "*" in spec:
            spec, m = spec.rsplit("*", 1)
            mul = float(m)
        want = None
        if "|" in spec:
            spec, ls = spec.split("|", 1)
            want = [x.strip() for x in ls.split(",") if x.strip()]
        src = rdir / f"{spec.strip()}.json"
        rec = json.loads(src.read_text(encoding="utf-8"))
        keep = []
        for i, L in enumerate(rec["layers"], 1):
            if want and L["name"] not in want and f"#{i}" not in want:
                continue
            L = json.loads(json.dumps(L))
            em = L.get("emit") or {}
            if as_burst and L.get("class") == "ParticleEmitter" and em.get("mode") != "burst":
                rate = float(L["props"].get("Rate") or 0)
                em = {"mode": "burst", "count": max(1, min(30, round(rate * 0.25))),
                      "converted_from_rate": rate}
                L["emit"] = em
            if as_loop and L.get("class") == "ParticleEmitter" and em.get("mode") == "burst":
                life = L["props"].get("Lifetime", {}).get("NumberRange", [1, 1])
                mean = max(0.1, (float(life[0]) + float(life[1])) / 2)
                rate = round(max(1, em.get("count") or 1) * mul / mean, 3)
                L["props"]["Rate"] = rate
                em = {"mode": "continuous", "converted_from_count": em.get("count")}
                L["emit"] = em
            if mul != 1.0 and em.get("mode") == "burst" and em.get("count"):
                em["count"] = max(1, round(em["count"] * mul))
            keep.append(L)
        if not keep:
            print(f"REFUSED {name}: no layer of {spec} matches {want}", file=sys.stderr)
            bad += 1
            continue
        rec["name"] = name
        rec["layers"] = keep
        rec["from"] = spec.strip()
        rec["layers_kept"] = [L["name"] for L in keep]
        refs = sorted({str(L["props"].get("Texture", "")) for L in keep if L.get("props")})
        rec["texture_refs"] = [r for r in refs if r]
        (out / f"{name}.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")
        counts = [(L.get("emit") or {}).get("count") for L in keep]
        print(f"{name:22s} <- {spec.strip()} {rec['layers_kept']}" + (f" count x{mul}" if mul != 1 else "")
              + (f" burst counts {counts}" if as_burst else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
