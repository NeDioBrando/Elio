"""Draw the symbolic icons instead of generating them.

    python glyphs.py --out icons/ --size 256

WHY THIS FILE EXISTS. On a 38-icon batch, the generator handled every pictorial
noun well - a carrot, a chest, a tractor, a cow - and failed on almost every
SYMBOL. Measured: "one bold red X cross symbol" returned a scribbled starburst,
"one bold green check mark" returned a DOWN ARROW in a grey circle, "one single
red love heart" returned a games controller with a heart on it, and the star came
back as five stars scattered across the frame.

That is not bad luck and rerolling does not fix it. A close cross, a tick, a
heart, a star, a plus and a padlock are not artwork, they are GEOMETRY - and
geometry is the thing a diffusion model is worst at and a drawing routine is
perfect at. Drawing them is free, instant, deterministic, and gives a set that is
consistent by construction rather than by prompt discipline.

This also matches the split in references/ui-recipes.md section 9: functional
glyphs are a different asset class from content icons, and should be white and
tintable so one asset serves every state. `--white` does that.

THE OUTLINE IS A DILATION, NOT A STROKE. PIL's polygon outline joins badly at
sharp corners - a five-pointed star grows spikes at every point. Rendering the
silhouette as a mask and dilating it gives a uniform-width outline that follows
any shape, which is also what makes these match the generated icons, whose outline
is uniform because a person drew it that way.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SS = 4                      # supersample; the mask is downscaled at the end
OUTLINE = (35, 31, 60)
PALETTE = {
    "red": (236, 90, 76), "green": (89, 201, 60), "gold": (247, 188, 46),
    "blue": (76, 166, 232), "purple": (158, 99, 226), "grey": (183, 186, 199),
    "cream": (255, 248, 233),
}


# ------------------------------------------------------------------ shape helpers

def _bar(d, cx, cy, length, thick, angle):
    """A rounded bar through (cx, cy)."""
    a = math.radians(angle)
    dx, dy = math.cos(a) * length / 2, math.sin(a) * length / 2
    d.line([(cx - dx, cy - dy), (cx + dx, cy + dy)], fill=255,
           width=int(thick), joint="curve")
    for px, py in ((cx - dx, cy - dy), (cx + dx, cy + dy)):
        r = thick / 2
        d.ellipse([px - r, py - r, px + r, py + r], fill=255)


def _star_points(cx, cy, outer, inner, points=5, rot=-90):
    pts = []
    for i in range(points * 2):
        r = outer if i % 2 == 0 else inner
        a = math.radians(rot + i * 180 / points)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


# ------------------------------------------------------------------ the glyphs

def close(d, S):
    for angle in (45, -45):
        _bar(d, S / 2, S / 2, S * 0.52, S * 0.17, angle)


def tick(d, S):
    d.line([(S * 0.26, S * 0.53), (S * 0.44, S * 0.70), (S * 0.76, S * 0.31)],
           fill=255, width=int(S * 0.17), joint="curve")
    for px, py in ((0.26, 0.53), (0.76, 0.31)):
        r = S * 0.085
        d.ellipse([S * px - r, S * py - r, S * px + r, S * py + r], fill=255)


def plus(d, S):
    _bar(d, S / 2, S / 2, S * 0.56, S * 0.19, 0)
    _bar(d, S / 2, S / 2, S * 0.56, S * 0.19, 90)


def minus(d, S):
    _bar(d, S / 2, S / 2, S * 0.56, S * 0.19, 0)


def heart(d, S):
    r = S * 0.19
    d.ellipse([S * 0.5 - r * 2, S * 0.28 - r, S * 0.5, S * 0.28 + r], fill=255)
    d.ellipse([S * 0.5, S * 0.28 - r, S * 0.5 + r * 2, S * 0.28 + r], fill=255)
    d.polygon([(S * 0.5 - r * 2, S * 0.34), (S * 0.5 + r * 2, S * 0.34),
               (S * 0.5, S * 0.78)], fill=255)


def star(d, S):
    d.polygon(_star_points(S / 2, S * 0.52, S * 0.40, S * 0.17), fill=255)


def lock(d, S):
    # shackle: an arc drawn as a thick ring, then the lower half cut away
    w = S * 0.10
    d.arc([S * 0.30, S * 0.16, S * 0.70, S * 0.56], 180, 360,
          fill=255, width=int(w))
    d.rectangle([S * 0.30, S * 0.36, S * 0.30 + w, S * 0.50], fill=255)
    d.rectangle([S * 0.70 - w, S * 0.36, S * 0.70, S * 0.50], fill=255)
    d.rounded_rectangle([S * 0.22, S * 0.44, S * 0.78, S * 0.84],
                        radius=S * 0.09, fill=255)


def arrow(d, S):
    _bar(d, S / 2, S * 0.56, S * 0.40, S * 0.16, 90)
    d.polygon([(S * 0.5, S * 0.18), (S * 0.74, S * 0.46), (S * 0.26, S * 0.46)],
              fill=255)


GLYPHS = {
    "close": (close, "red"), "tick": (tick, "green"), "plus": (plus, "green"),
    "minus": (minus, "red"), "heart": (heart, "red"), "star": (star, "gold"),
    "lock": (lock, "gold"), "arrow": (arrow, "blue"),
}


# ------------------------------------------------------------------ rendering

def render(fn, colour, size: int, white: bool, outline_frac: float = 0.055):
    S = size * SS
    mask_img = Image.new("L", (S, S), 0)
    fn(ImageDraw.Draw(mask_img), S)
    mask = np.asarray(mask_img) > 127
    if not mask.any():
        raise ValueError("glyph drew nothing")

    # Uniform outline by dilation. A stroke-based outline mitres badly at a star's
    # points; a dilation follows any silhouette at constant width.
    t = max(1, int(S * outline_frac))
    grown = ndimage.binary_dilation(mask, ndimage.generate_binary_structure(2, 2),
                                    iterations=t)

    rgb = np.zeros((S, S, 3), np.uint8)
    fill = (255, 255, 255) if white else PALETTE[colour]
    rgb[grown] = OUTLINE if not white else (255, 255, 255)
    rgb[mask] = fill

    if not white:
        # The same top-lit shading the depth stack uses, so a drawn glyph sits
        # beside a generated icon without looking flatter than it.
        ramp = np.linspace(1.14, 0.90, S)[:, None]
        shaded = np.clip(rgb.astype(np.float32) * ramp[:, :, None], 0, 255)
        rgb = np.where(mask[:, :, None], shaded, rgb).astype(np.uint8)

    alpha = (grown * 255).astype(np.uint8)
    out = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
    return out.resize((size, size), Image.LANCZOS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--white", action="store_true",
                    help="render white so ImageColor3 can tint at runtime")
    ap.add_argument("--only", default=None)
    ap.add_argument("--sheet", default=None)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    wanted = {n.strip() for n in args.only.split(",")} if args.only else None

    made = []
    for name, (fn, colour) in GLYPHS.items():
        if wanted and name not in wanted:
            continue
        img = render(fn, colour, args.size, args.white)
        dest = out / f"{name}.png"
        img.save(dest)
        made.append(dest)
        a = np.asarray(img)[:, :, 3]
        print(f"  {name:<8} {colour:<7} coverage={float((a > 127).mean()):.3f}")

    if args.sheet and made:
        from icon_cutout import contact_sheet
        contact_sheet(made, Path(args.sheet))
        print(f"[sheet] {args.sheet}")
    print(f"\n{len(made)} glyphs -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
