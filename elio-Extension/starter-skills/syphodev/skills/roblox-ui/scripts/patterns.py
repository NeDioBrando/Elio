"""Pattern tiles: the texture layer printed inside panels and cards.

    python patterns.py --out <dir>      # writes pattern_<name>.png for upload

WHY THIS EXISTS. UI built from shapes, colours and type alone still reads as
flat, because polished Roblox games print a PATTERN inside their surfaces: broad
diagonal sheen bands across a header, a dot grid on a frame, swirling clouds on a
store card, mottled grain on a fantasy card. It is visible in one look. The
gradient alone is not the surface.

Every tile is WHITE on transparent, so one image serves any colour: the PNG
renderer tints it and the emitted ImageLabel sets ImageColor3. All of them are
drawn here from geometry.

  sheen    3 broad diagonal light bands, STRETCHED over the surface (header bands)
  stripes  thin diagonal stripes, tiled (candy/sale bands)
  dots     a regular dot grid, tiled (frame borders)
  clouds   curling spiral clouds, tiled (store cards)
  grain    soft mottled noise, tiled (parchment-like cards)
"""
from __future__ import annotations

import argparse
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

TILE = 256
STRETCH = {"sheen"}  # drawn once across the whole surface, not tiled
NAMES = ("sheen", "stripes", "dots", "clouds", "grain")


def _sheen(n: int) -> Image.Image:
    im = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(im)
    # three bands at 45 degrees, widths and gaps tuned by eye
    for start, width, val in ((0.10, 0.14, 255), (0.30, 0.06, 200), (0.62, 0.20, 160)):
        x0 = start * n * 2 - n * 0.4
        w = width * n
        d.polygon([(x0, n), (x0 + w, n), (x0 + w + n, 0), (x0 + n, 0)], fill=val)
    return im.filter(ImageFilter.GaussianBlur(n * 0.004))


def _stripes(n: int) -> Image.Image:
    im = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(im)
    step, w = n // 8, n // 20
    for k in range(-n, 2 * n, step):  # wraps: period divides the tile
        d.polygon([(k, n), (k + w, n), (k + w + n, 0), (k + n, 0)], fill=255)
    return im


def _dots(n: int) -> Image.Image:
    im = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(im)
    step, r = n // 8, n // 64 + 1
    for y in range(step // 2, n, step):
        for x in range(step // 2, n, step):
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return im


def _spiral(d, cx, cy, r, turns, width, val, flip=1):
    pts = []
    for i in range(int(turns * 80)):
        t = i / 80 * 2 * math.pi
        rr = r * (1 - i / (turns * 80))
        pts.append((cx + flip * rr * math.cos(t), cy + rr * math.sin(t)))
    d.line(pts, fill=val, width=width, joint="curve")


def _clouds(n: int) -> Image.Image:
    """Auspicious clouds: a puff of overlapping circles drawn as ONE outline, with
    a spiral curl in its biggest lobe. Built on a 3x3 canvas so the tile wraps."""
    N = n * 3
    fill = Image.new("L", (N, N), 0)
    df = ImageDraw.Draw(fill)
    curls = []
    # (centre x, centre y, scale) of each cloud, as fractions of the tile
    motifs = [(0.28, 0.32, 0.16), (0.74, 0.74, 0.13), (0.82, 0.22, 0.08)]
    lobes = [(-1.1, 0.25, 0.75), (0.0, 0.0, 1.0), (1.05, 0.2, 0.8), (1.9, 0.45, 0.5)]
    for ox in (0, n, 2 * n):
        for oy in (0, n, 2 * n):
            for fx, fy, s in motifs:
                cx, cy, R = ox + fx * n, oy + fy * n, s * n
                for lx, ly, lr in lobes:
                    x, y, r = cx + lx * R, cy + ly * R, lr * R
                    df.ellipse([x - r, y - r, x + r, y + r], fill=255)
                curls.append((cx, cy, R * 0.72))
    w = max(3, n // 40)
    edge = fill.filter(ImageFilter.MaxFilter(2 * w + 1))
    out = Image.new("L", (N, N), 0)
    out.paste(255, mask=edge)
    out.paste(0, mask=fill)  # keep only the outline band
    d = ImageDraw.Draw(out)
    for cx, cy, r in curls:
        _spiral(d, cx, cy, r, 1.7, w, 255)
    return out.crop((n, n, 2 * n, 2 * n))


def _grain(n: int) -> Image.Image:
    rnd = random.Random(7)
    im = Image.new("L", (n, n), 0)
    px = im.load()
    for y in range(n):
        for x in range(n):
            px[x, y] = rnd.randint(0, 255)
    # blur to mottle, then stretch contrast; wrap-pad first so the tile is seamless
    pad = Image.new("L", (n * 3, n * 3))
    for i in range(3):
        for j in range(3):
            pad.paste(im, (i * n, j * n))
    pad = pad.filter(ImageFilter.GaussianBlur(n / 40)).crop((n, n, 2 * n, 2 * n))
    lo, hi = pad.getextrema()
    return pad.point(lambda v: int(max(0, (v - lo) / max(1, hi - lo) * 255 - 60) * 1.3))


MAKERS = {"sheen": _sheen, "stripes": _stripes, "dots": _dots, "clouds": _clouds, "grain": _grain}
_CACHE: dict[str, Image.Image] = {}


def tile(name: str) -> Image.Image:
    """White RGBA tile; alpha carries the pattern."""
    if name not in MAKERS:
        raise ValueError(f"unknown pattern {name!r}; have {', '.join(NAMES)}")
    if name not in _CACHE:
        a = MAKERS[name](TILE)
        im = Image.new("RGBA", (TILE, TILE), (255, 255, 255, 0))
        im.putalpha(a)
        _CACHE[name] = im
    return _CACHE[name]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for n in NAMES:
        tile(n).save(out / f"pattern_{n}.png")
    print("wrote", ", ".join(f"pattern_{n}.png" for n in NAMES))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
