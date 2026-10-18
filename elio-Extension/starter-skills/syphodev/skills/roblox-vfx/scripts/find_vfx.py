#!/usr/bin/env python3
"""Search a harvested VFX library by what an effect IS, not by filename.

A harvested library is unusable without this. Names come from whatever the pack
author typed, and measured on a real 1813-recipe library only 29% of them say
anything at all - the rest are "Part", "78" or a texture id. The index adds two
signals the filename does not have:

  sprite shape  - read from the texture's pixels (ring / streak / star / soft),
                  cropping to ONE frame first because most are flipbook sheets.
                  This is the only signal for the long tail of texture swatches,
                  whose VALUES are deliberately neutral. 97% coverage.
  motion+timing - read from the harvested properties (one-shot, expanding,
                  glowing, high-drag, colour). 100% coverage, but says nothing
                  about what the sprite looks like.

Together: 98%. Build it with classify_lib.py, then:

    python find_vfx.py --lib DIR explosion
    python find_vfx.py --lib DIR ring expanding --layered
    python find_vfx.py --lib DIR --tag streak --tag prebaked-colour
"""
import argparse
import json
import pathlib
import re
import sys

# a query word -> the tags that should satisfy it
SYNONYM = {
    "explosion": ["is:explosion", "maybe:impact", "one-shot", "expanding"],
    "impact": ["is:impact", "maybe:impact", "one-shot"],
    "hit": ["is:impact", "maybe:impact", "one-shot"],
    "slash": ["is:slash", "maybe:slash", "streak"],
    "shockwave": ["is:shockwave", "maybe:shockwave", "ring", "expanding"],
    "ring": ["ring", "maybe:shockwave"],
    "spark": ["maybe:spark", "star"],
    "flash": ["maybe:flash", "star", "flash"],
    "smoke": ["is:smoke", "soft", "wispy"],
    "fire": ["is:fire", "colour:orange", "tex:orange"],
    "lightning": ["is:lightning", "maybe:lightning", "streak"],
    "ice": ["is:ice", "colour:cyan", "tex:cyan", "colour:blue"],
    "water": ["is:water", "colour:blue", "tex:blue"],
    "wind": ["is:wind", "streak"],
    "magic": ["is:magic", "is:energy", "glowing"],
    "energy": ["is:energy", "glowing"],
    "aura": ["is:aura", "continuous", "soft"],
    "trail": ["is:trail", "maybe:trail", "streak", "beam-or-trail"],
    "beam": ["beam-or-trail", "is:energy"],
    "glow": ["maybe:glow", "glowing", "soft"],
    "heal": ["is:heal", "colour:green"],
    "dark": ["is:dark", "colour:purple"],
}


def load(lib):
    p = pathlib.Path(lib)
    idx = p / "index.json" if p.is_dir() else p
    if not idx.is_file():
        sys.exit(f"no index at {idx} - run classify_lib.py --lib DIR first")
    return json.loads(idx.read_text(encoding="utf-8")), idx


def score(entry, words, tags_required):
    tags = set(entry["tags"])
    for t in tags_required:
        if t not in tags:
            return 0, []
    # Passing only --tag filters and no query words must not score every
    # survivor 0 and then drop them all as "no match".
    s, why = (1 if not words else 0), []
    name = (entry.get("name") or "").lower()
    for w in words:
        hit = False
        if w in name:
            s += 6
            why.append(f"name~{w}")
            hit = True
        for t in SYNONYM.get(w, [w]):
            if t in tags:
                # an explicit is: tag is worth more than a maybe: hint
                s += 5 if t.startswith("is:") else (2 if t.startswith("maybe:") else 3)
                why.append(t)
                hit = True
        if not hit:
            s -= 1
    return s, why


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="*", help="free words: explosion, ring, blue, ...")
    ap.add_argument("--lib", required=True, help="library dir (holding index.json)")
    ap.add_argument("--tag", action="append", default=[], help="require this exact tag")
    ap.add_argument("--layered", action="store_true",
                    help="only multi-layer effects - the designed ones")
    ap.add_argument("--portable", action="store_true", help="only rbxasset textures")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--dupes", action="store_true",
                    help="also show recipes that are byte-identical to another")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    idx, path = load(a.lib)
    words = [w.lower() for w in a.query]
    rows = []
    for fn, e in idx.items():
        if a.layered and e.get("layers", 1) < 2:
            continue
        if a.portable and not e.get("portable"):
            continue
        # 140 of 1813 here are the same effect shipped in two packs. Showing both
        # makes a 5-result page carry 3 real answers.
        if e.get("dupe_of") and not a.dupes:
            continue
        s, why = score(e, words, a.tag)
        if words or a.tag:
            if s <= 0:
                continue
        rows.append((s, fn, e, why))

    # layered effects first at equal score: a 5-layer effect beats a lone swatch
    rows.sort(key=lambda r: (-r[0], -r[2].get("layers", 1), r[1]))
    rows = rows[: a.limit]

    if a.json:
        print(json.dumps([{"file": f, **e, "score": s, "why": w} for s, f, e, w in rows], indent=1))
        return

    if not rows:
        print("no matches")
        return
    print(f"{len(rows)} of {len(idx)} from {path.parent}\n")
    for s, fn, e, why in rows:
        dur = f"{e['duration']}s" if e.get("duration") else "-"
        print(f"  [{s:>3}] {e['name'][:34]:34} {e['layers']}L {dur:>6}  {fn}")
        keep = [t for t in e["tags"] if not t.startswith(("maybe:", "emit-", "animated-"))]
        print(f"        {', '.join(keep[:11])}")
        if why:
            print(f"        matched: {', '.join(dict.fromkeys(why))}")


if __name__ == "__main__":
    main()
