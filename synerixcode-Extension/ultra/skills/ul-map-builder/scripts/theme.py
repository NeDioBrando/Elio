"""Art direction, derived from reference images.

This is the half of a map that the prover says nothing about. A map that passes
every playability check and is built from grey boxes is a failed map.

References are used the way they can actually be used: to extract a PALETTE, a
MATERIAL SET and a LIGHTING MOOD. They are not used to infer layout, because no
image tells you whether a gap is jumpable, and a vision model that can reliably
judge "is this a revolver" cannot judge "is this deck 50 studs of slide runway".

Run:  python theme.py extract refs/*.png -o themes/my_map.json --name my_map
      python theme.py show themes/sky_citadel.json -o swatch.png
"""

from __future__ import annotations

import argparse
import colorsys
import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
THEME_DIR = os.path.join(SKILL, "themes")

# Roles a map needs filled. Everything the kits draw asks for one of these.
ROLES = ["sky", "stone_dark", "stone_mid", "stone_light",
         "accent", "accent_glow", "trim", "foliage", "soil", "timber",
         "thatch", "crop", "water"]

# What each role is made of. Material carries as much of the look as colour.
ROLE_MATERIALS = {
    "sky": "SmoothPlastic",
    "stone_dark": "Slate",
    "stone_mid": "Concrete",
    "stone_light": "Sandstone",
    "accent": "SmoothPlastic",
    "accent_glow": "Neon",
    "trim": "Metal",
    "foliage": "Grass",
    "soil": "Rock",
    "timber": "WoodPlanks",
    "thatch": "Fabric",
    "crop": "LeafyGrass",
    "water": "Glass",
}


# --------------------------------------------------------------------------
# extraction
# --------------------------------------------------------------------------

def _kmeans(px, k, iters=24, seed=0):
    rng = np.random.default_rng(seed)
    c = px[rng.choice(len(px), k, replace=False)].astype(np.float64)
    for _ in range(iters):
        d = ((px[:, None, :] - c[None, :, :]) ** 2).sum(2)
        lab = d.argmin(1)
        for i in range(k):
            m = lab == i
            if m.any():
                c[i] = px[m].mean(0)
    return c, lab


def _clusters(paths, k=9, max_side=180):
    px, ys = [], []
    for p in paths:
        im = Image.open(p).convert("RGB")
        im.thumbnail((max_side, max_side))
        a = np.asarray(im).reshape(-1, 3)
        h, w = im.size[1], im.size[0]
        yy = np.repeat(np.arange(h), w) / max(h - 1, 1)
        px.append(a)
        ys.append(yy)
    px = np.concatenate(px).astype(np.float64)
    ys = np.concatenate(ys)
    c, lab = _kmeans(px, k)
    out = []
    for i in range(k):
        m = lab == i
        if not m.any():
            continue
        rgb = c[i]
        r, g, b = (rgb / 255.0)
        hh, ss, vv = colorsys.rgb_to_hsv(r, g, b)
        out.append({
            "rgb": [int(round(v)) for v in rgb],
            "h": hh * 360.0, "s": ss, "v": vv,
            "area": float(m.mean()),
            "y": float(ys[m].mean()),      # 0 = top of frame, 1 = bottom
        })
    return sorted(out, key=lambda c: -c["area"])


def _assign(cl):
    """Give each cluster a role. Heuristics, then fill the gaps by value order.

    Deliberately simple and deliberately overridable: the point is to get a
    coherent starting palette out of a reference in one step, not to be right
    about every swatch.
    """
    pool = list(cl)
    out = {}

    def take(pred, role):
        for c in list(pool):
            if role in out:
                return
            if pred(c):
                out[role] = c
                pool.remove(c)

    # sky: bright, blue-ish, sits high in frame, covers real area
    take(lambda c: 170 <= c["h"] <= 260 and c["v"] > 0.55 and c["y"] < 0.55
         and c["area"] > 0.04, "sky")
    # foliage: green and not grey
    take(lambda c: 70 <= c["h"] <= 165 and c["s"] > 0.18, "foliage")
    # accent_glow: very saturated and very bright - the lit panels and banners
    take(lambda c: c["s"] > 0.45 and c["v"] > 0.72, "accent_glow")
    # accent: most saturated of what is left
    pool.sort(key=lambda c: -c["s"])
    take(lambda c: c["s"] > 0.25, "accent")
    # timber / soil: warm hues
    pool.sort(key=lambda c: -c["area"])
    take(lambda c: (c["h"] < 55 or c["h"] > 335) and c["s"] > 0.15 and c["v"] < 0.72, "timber")
    take(lambda c: (c["h"] < 60 or c["h"] > 330) and c["s"] > 0.10, "soil")

    # stones: the least saturated remainder, darkest to lightest
    greys = sorted(pool, key=lambda c: c["v"])
    for role in ("stone_dark", "stone_mid", "stone_light"):
        if greys:
            out[role] = greys.pop(0 if role == "stone_dark" else len(greys) // 2
                                  if role == "stone_mid" else -1)

    # fill anything still missing by shading a neighbour, so a theme is always
    # complete and the kits never have to handle a missing role
    base = out.get("stone_mid") or out.get("sky") or cl[0]
    for role in ROLES:
        if role not in out:
            out[role] = dict(base)
    return {r: out[r]["rgb"] for r in ROLES}


def _shade(rgb, f):
    if f >= 1.0:
        return [int(round(min(255, c + (255 - c) * (f - 1.0)))) for c in rgb]
    return [int(round(c * f)) for c in rgb]


def extract(paths, name="theme", k=9):
    cl = _clusters(paths, k=k)
    pal = _assign(cl)

    # keep the stone ramp genuinely separated, or everything reads as one flat
    # grey no matter how good the geometry is
    mid = pal["stone_mid"]
    if max(pal["stone_light"]) - max(pal["stone_dark"]) < 40:
        pal["stone_dark"] = _shade(mid, 0.62)
        pal["stone_light"] = _shade(mid, 1.35)

    sky = pal["sky"]
    return {
        "name": name,
        "source": [os.path.basename(p) for p in paths],
        "palette": pal,
        "materials": dict(ROLE_MATERIALS),
        "lighting": _lighting(sky, pal),
    }


def _lighting(sky, pal):
    r, g, b = [c / 255.0 for c in sky]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    bright = v > 0.6
    return {
        "ClockTime": 14.2 if bright else 18.5,
        "GeographicLatitude": 12,
        "Brightness": 2.6 if bright else 1.6,
        "Ambient": _shade(pal["stone_dark"], 0.55),
        "OutdoorAmbient": _shade(sky, 0.62),
        "EnvironmentDiffuseScale": 0.55,
        "EnvironmentSpecularScale": 0.5,
        "ShadowSoftness": 0.35,
        "Technology": "Future",
        "Atmosphere": {
            "Density": 0.36,
            "Offset": 0.1,
            "Color": _shade(sky, 1.12),
            "Decay": _shade(sky, 0.8),
            "Glare": 0.28,
            "Haze": 1.7,
        },
        "Bloom": {"Intensity": 0.55, "Size": 24, "Threshold": 0.92},
        "ColorCorrection": {
            "Brightness": 0.02, "Contrast": 0.14, "Saturation": 0.18,
            "TintColor": _shade(sky, 1.05),
        },
        "SunRays": {"Intensity": 0.06, "Spread": 0.9},
    }


# --------------------------------------------------------------------------
# swatch, so a theme can be looked at before it is built
# --------------------------------------------------------------------------

def swatch(theme, out="swatch.png", w=980, h=260):
    img = Image.new("RGB", (w, h), (20, 22, 26))
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("consola.ttf", 13)
        fb = ImageFont.truetype("consola.ttf", 20)
    except OSError:
        f = fb = ImageFont.load_default()
    d.text((16, 14), f"theme: {theme['name']}", font=fb, fill=(235, 237, 240))
    src = ", ".join(theme.get("source", []))[:110]
    d.text((16, 40), f"from {src}" if src else "hand-authored", font=f, fill=(140, 146, 156))

    pal = theme["palette"]
    # draw the standard roles the theme has, then any extra roles it defines
    roles = [r for r in ROLES if r in pal] + [r for r in pal if r not in ROLES]
    n = max(len(roles), 1)
    bw = (w - 32) // n
    for i, role in enumerate(roles):
        c = tuple(pal[role])
        x = 16 + i * bw
        d.rectangle([x, 74, x + bw - 6, 178], fill=c)
        d.text((x, 184), role, font=f, fill=(200, 204, 210))
        d.text((x, 200), theme["materials"].get(role, ""), font=f, fill=(120, 126, 136))
        d.text((x, 216), "%d,%d,%d" % c, font=f, fill=(110, 116, 126))
    lt = theme["lighting"]
    d.text((16, 238), f"ClockTime {lt['ClockTime']}  Brightness {lt['Brightness']}  "
                      f"Atmosphere density {lt['Atmosphere']['Density']} haze {lt['Atmosphere']['Haze']}",
           font=f, fill=(140, 146, 156))
    img.save(out)
    return out


def load(name_or_path):
    p = name_or_path
    if not os.path.exists(p):
        p = os.path.join(THEME_DIR, f"{name_or_path}.json")
    if not os.path.exists(p):
        raise SystemExit(f"no such theme: {name_or_path}")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build a map theme from reference images.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extract")
    e.add_argument("images", nargs="+")
    e.add_argument("--name", default="theme")
    e.add_argument("-k", type=int, default=9)
    e.add_argument("-o", "--out")
    s = sub.add_parser("show")
    s.add_argument("theme")
    s.add_argument("-o", "--out", default="swatch.png")
    a = ap.parse_args(argv)

    if a.cmd == "extract":
        paths = []
        for g in a.images:
            paths.extend(sorted(glob.glob(g)) or [g])
        paths = [p for p in paths if os.path.exists(p)]
        if not paths:
            raise SystemExit("no reference images found")
        t = extract(paths, a.name, a.k)
        out = a.out or os.path.join(THEME_DIR, f"{a.name}.json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(t, f, indent=2)
        print(f"wrote {out} from {len(paths)} reference(s)")
        for r in ROLES:
            print(f"  {r:13s} rgb{tuple(t['palette'][r])}  {t['materials'][r]}")
    else:
        print("wrote " + swatch(load(a.theme), a.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
