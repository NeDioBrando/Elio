"""Generated icon -> a clean transparent PNG, with the checks that catch bad ones.

    python icon_cutout.py --in raw/ --out icons/ --size 256 --sheet sheet.png

WHY FLOOD FILL AND NOT A CHROMA KEY. The obvious plan is to generate on a magenta
background and key it. It does not survive contact with an icon set:

  - keyers compare Cb/Cr, not RGB, and MAGENTA SHARES THE Cr AXIS WITH RED. A
    measured worst-case chroma distance of 116 already rendered red type
    semi-transparent at a normal tolerance. An icon set is full of reds and pinks.
  - a soft drop shadow pixel is part key colour and part black, so a keyer either
    eats it or leaves a dirty halo.
  - a chroma key is a workaround for video formats with no alpha. A PNG has alpha.

A flood fill from the border is strictly better here because this icon style has a
THICK OPAQUE OUTLINE around every shape: the fill runs until it hits the outline
and stops dead, so the cut follows the artwork rather than a colour threshold.

THE TRAP THIS SCRIPT EXISTS TO AVOID, seen twice: a plain colour
threshold over the whole image kept 85% of a background once, because the backdrop
carried a colour cast off the subject. Connectivity is what fixes that - a pixel is
background because it is CONNECTED to the border, not because it is grey.

CHECKS. Every one of these is a way a generated icon looks fine as a file and is
wrong as an asset, so the report is the point, not a by-product:

  bg_fraction      how much was removed. Very low = no background found (the fill
                   leaked, or the icon fills the frame). Very high = eaten.
  touches_border   the subject runs off the edge, so it was generated cropped.
  extra_objects    components >= 15% of the largest. THIS IS THE ONE THAT MATTERS:
                   image models pluralise small nouns, and a sheet of seven
                   chickens passes every colour statistic ever written.
  holes_kept       interior background regions preserved (a gear's centre).
  salvaged         the generation held more than one object and was CROPPED to
                   the best one rather than thrown away. Always look at these.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

# Neighbour-relative tolerance for the border growth. Small on purpose: it only
# has to bridge one step of a smooth gradient, and a large value leaks through a
# thin or broken outline and eats the icon.
LOCAL_TOL = 10
# Enclosed regions are bounded by the artwork already, so they can be judged more
# loosely than the open border.
ENCLOSED_TOL_SCALE = 1.9
# Only clear an enclosed region if it is genuinely grey. This is what stops the
# pass from punching a hole through a blue gem or a red apple.
GREY_SAT = 0.22
# How far outside the main object a fragment can sit and still be considered part
# of the same icon. 0.15 of the object's own size keeps a cloud with its raindrops
# and still excludes the next cell of a 3x3 sticker grid.
CLUSTER_PAD = 0.15
# How far the crop moves from the bounding-box centre toward the ink centroid.
# 0 = geometric centring, 1 = pure centre of mass. 0.35 measurably fixes the
# top-heavy and bottom-heavy cases without pushing thin extremities out of frame.
OPTICAL_WEIGHT = 0.35
# The wall. Generous enough to contain a whole drop-shadow ramp, tight enough that
# the fill cannot reach the subject even where the outline is thin or broken.
GLOBAL_CAP = 78


def estimate_background(rgb: np.ndarray, ring: int = 6) -> np.ndarray:
    """Median of a border ring. More robust than sampling the four corners, which
    a vignette or a stray highlight in one corner throws off."""
    edge = np.concatenate([
        rgb[:ring].reshape(-1, 3), rgb[-ring:].reshape(-1, 3),
        rgb[:, :ring].reshape(-1, 3), rgb[:, -ring:].reshape(-1, 3),
    ])
    return np.median(edge, axis=0)


def cut_out(rgb: np.ndarray, tol: float, min_hole_frac: float, salvage: bool = True) -> tuple[np.ndarray, dict]:
    """Region-grow the background from the border, then sweep enclosed greys.

    A GLOBAL distance-from-background threshold is the obvious implementation and
    it fails on exactly two things, both of which SDXL produces on every batch:

      - the DROP SHADOW it draws no matter how many times the prompt says not to.
        A shadow is a smooth ramp from background grey to dark, so a global
        threshold cuts it somewhere in the middle and welds the remainder to the
        icon as a grey halo.
      - the ENCLOSED background inside a ring, a handle or a gear's teeth, which
        the border fill cannot reach and which a vignette pushes just out of
        tolerance.

    So the border pass grows NEIGHBOUR-RELATIVE (cv2.floodFill without
    FIXED_RANGE compares each candidate to the pixel it came from), which walks a
    soft gradient all the way down and still stops dead at the hard dark outline
    this icon style always has. The enclosed pass then runs at a looser tolerance,
    but ONLY on low-saturation regions, so a ring holding a grey background is
    cleared while a ring holding a blue gem is not.
    """
    h, w = rgb.shape[:2]
    bg_colour = estimate_background(rgb)
    dist0 = np.linalg.norm(rgb.astype(np.float32) - bg_colour, axis=2)

    # --- pass 1: neighbour-relative growth from every border seed, INSIDE A WALL.
    # Neighbour-relative growth on its own is too permissive: it happily climbs a
    # smooth gradient right into the subject, and a white milk bottle went from 26%
    # coverage to 4%. So pre-seed the flood mask with everything already far from
    # the background colour. cv2 treats non-zero mask pixels as boundaries, which
    # turns that into a hard wall the fill cannot cross. The fill can then follow a
    # soft shadow all the way down, and still cannot wander off into the artwork.
    img = np.ascontiguousarray(rgb[:, :, ::-1])  # cv2 wants BGR
    mask = np.zeros((h + 2, w + 2), np.uint8)
    mask[1:-1, 1:-1] = (dist0 > GLOBAL_CAP).astype(np.uint8)
    lo = up = (int(LOCAL_TOL),) * 3
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
    step = max(8, min(h, w) // 48)
    for x in range(0, w, step):
        for y in (0, h - 1):
            if not mask[y + 1, x + 1]:
                cv2.floodFill(img, mask, (x, y), 0, lo, up, flags)
    for y in range(0, h, step):
        for x in (0, w - 1):
            if not mask[y + 1, x + 1]:
                cv2.floodFill(img, mask, (x, y), 0, lo, up, flags)
    # The wall was seeded with 1; the fill paints 255. Only the painted pixels are
    # background - keeping the wall would invert the whole thing.
    bg = mask[1:-1, 1:-1] == 255

    # --- pass 2: enclosed regions, looser, greys only
    dist = dist0
    mx = rgb.max(axis=2).astype(np.float32)
    mn = rgb.min(axis=2).astype(np.float32)
    sat = (mx - mn) / np.maximum(mx, 1.0)
    candidate = (dist < tol * ENCLOSED_TOL_SCALE) & (sat < GREY_SAT) & ~bg

    lab, n = ndimage.label(candidate)
    min_hole = min_hole_frac * h * w
    holes = 0
    for i in range(1, n + 1):
        region = lab == i
        if region.sum() >= min_hole:
            bg |= region
            holes += 1

    fg = ~bg

    # Count the real objects BEFORE pruning. Image models pluralise small nouns -
    # a "red X cross" came back as a GRID OF CROSSES - so this is the check that
    # matters most on an icon set.
    flab, fn = ndimage.label(fg)
    areas = np.array([0] + [int((flab == i).sum()) for i in range(1, fn + 1)])
    extra, salvaged = 0, False
    if fn:
        biggest_i = int(areas[1:].argmax()) + 1
        biggest = areas[biggest_i]
        extra = int(((areas[1:] >= 0.15 * biggest).sum()) - 1)

        if extra > 0 and salvage:
            # SALVAGE RATHER THAN REJECT. A sheet of nine crosses still contains a
            # perfectly good cross, so keep the largest object and anything
            # clustered with it, and throw the rest of the sheet away.
            #
            # The cluster part is not optional: plenty of real icons are several
            # disconnected pieces - a cloud above separate raindrops, a lid above
            # a chest, a leaf beside an apple. Keeping ONLY the largest component
            # would decapitate those. So a component travels with the largest one
            # when its bounding box overlaps the largest box grown by CLUSTER_PAD,
            # which is tight enough that the neighbouring cell of a grid does not
            # qualify.
            keep = _cluster(flab, biggest_i, fn)
            fg = np.isin(flab, keep)
            salvaged = True
            flab, fn = ndimage.label(fg)
            areas = np.array([0] + [int((flab == i).sum()) for i in range(1, fn + 1)])
            biggest = areas[1:].max() if fn else 0
            extra = int(((areas[1:] >= 0.15 * biggest).sum()) - 1) if fn else 0

        if fn:
            keep = [i for i in range(1, fn + 1) if areas[i] >= 0.02 * biggest]
            fg = np.isin(flab, keep)

    report = {
        "bg_colour": [round(float(c), 1) for c in bg_colour],
        "bg_fraction": round(float(bg.mean()), 3),
        "extra_objects": extra,
        "holes_kept": holes,
        "salvaged": salvaged,
    }
    return fg, report


def _bbox(mask):
    ys, xs = np.where(mask)
    return ys.min(), ys.max(), xs.min(), xs.max()


def _cluster(flab, seed, n):
    """Components that belong with `seed`, by bounding-box proximity."""
    y0, y1, x0, x1 = _bbox(flab == seed)
    ph, pw = (y1 - y0) * CLUSTER_PAD, (x1 - x0) * CLUSTER_PAD
    gy0, gy1, gx0, gx1 = y0 - ph, y1 + ph, x0 - pw, x1 + pw

    keep = [seed]
    for i in range(1, n + 1):
        if i == seed:
            continue
        by0, by1, bx0, bx1 = _bbox(flab == i)
        if not (bx1 < gx0 or bx0 > gx1 or by1 < gy0 or by0 > gy1):
            keep.append(i)
    return keep


def bleed_colour(rgb: np.ndarray, fg: np.ndarray) -> np.ndarray:
    """Push the nearest opaque colour outward into the transparent region.

    Without this, downscaling blends edge pixels against whatever RGB sits under
    alpha=0 - the grey backdrop - and every icon gets a faint grey rim that only
    shows up composited over a coloured panel.
    """
    _, idx = ndimage.distance_transform_edt(~fg, return_indices=True)
    return rgb[idx[0], idx[1]]


def square_trim(fg: np.ndarray, margin: float) -> tuple[slice, slice, bool]:
    """Square crop around the subject, centred OPTICALLY rather than geometrically.

    Centring on the bounding box is what everyone writes first and it is subtly
    wrong: a heart carries its mass above the middle of its box, a barn carries it
    below, and the eye reads the MASS, not the box. Measured across this set, the
    bounding boxes were centred to 0.2% while the ink centroids were out by up to
    13.5%, which is the whole reason the icons read as sitting slightly off inside
    their cards.

    So the crop centres on a blend. All centroid would over-correct - a wheat sheaf
    with a heavy base would push its tips out of frame - so the box still leads.
    """
    ys, xs = np.where(fg)
    if not len(ys):
        raise ValueError("nothing left after cutout")
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    touches = bool(y0 == 0 or x0 == 0 or y1 == fg.shape[0] or x1 == fg.shape[1])

    box_cy, box_cx = (y0 + y1) / 2, (x0 + x1) / 2
    ink_cy, ink_cx = ys.mean(), xs.mean()
    cy = box_cy * (1 - OPTICAL_WEIGHT) + ink_cy * OPTICAL_WEIGHT
    cx = box_cx * (1 - OPTICAL_WEIGHT) + ink_cx * OPTICAL_WEIGHT

    # The square must still contain the whole subject after the shift, or optical
    # centring would crop the thing it was trying to centre.
    side = max(y1 - y0, x1 - x0)
    side = max(side,
               2 * max(abs(cy - y0), abs(y1 - cy), abs(cx - x0), abs(x1 - cx)))
    side = int(round(side * (1 + 2 * margin)))
    cy, cx = int(round(cy)), int(round(cx))
    return (slice(cy - side // 2, cy + side // 2),
            slice(cx - side // 2, cx + side // 2), touches)


def process(path: Path, out_dir: Path, size: int, tol: float, margin: float,
            salvage: bool = True) -> dict:
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im)
    fg, report = cut_out(rgb, tol, min_hole_frac=0.0008, salvage=salvage)

    rgb_bled = bleed_colour(rgb, fg)
    ys, xs, touches = square_trim(fg, margin)
    report["touches_border"] = touches

    # Pad rather than clamp, so centring survives a subject near an edge.
    pad = max(0, -min(ys.start, xs.start),
              max(ys.stop - fg.shape[0], xs.stop - fg.shape[1]))
    if pad:
        rgb_bled = np.pad(rgb_bled, ((pad, pad), (pad, pad), (0, 0)), mode="edge")
        fg = np.pad(fg, ((pad, pad), (pad, pad)))
        ys = slice(ys.start + pad, ys.stop + pad)
        xs = slice(xs.start + pad, xs.stop + pad)

    rgba = np.dstack([rgb_bled[ys, xs], (fg[ys, xs] * 255).astype(np.uint8)])
    icon = Image.fromarray(rgba, "RGBA").resize((size, size), Image.LANCZOS)

    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{path.stem}.png"
    icon.save(dest)

    a = np.asarray(icon)[:, :, 3]
    report["coverage"] = round(float((a > 127).mean()), 3)
    report["out"] = str(dest)
    return report


def verdict(r: dict) -> str:
    if r.get("error"):
        return "ERROR"
    if r["extra_objects"] > 0:
        return "REJECT multiple objects"
    if r.get("salvaged"):
        return "SALVAGED cropped to one object - LOOK at it"
    if r["bg_fraction"] < 0.15:
        return "REJECT background not separated"
    # 0.97 was tuned on SDXL, which frames tight. FLUX.1-schnell leaves far more
    # whitespace, so a perfectly good apple legitimately sits on 97.5% background
    # and got REJECTED as "eaten". COVERAGE is the honest signal because it is
    # measured AFTER the trim, so it does not care how the generator framed things.
    if r["bg_fraction"] > 0.995:
        return "REJECT subject eaten"
    # A LONG THIN DIAGONAL object legitimately fills very little of its square
    # crop - a hoe measured 0.072 and was perfectly fine. Only near-zero means the
    # cutout actually ate something.
    if r["coverage"] < 0.03:
        return "REJECT almost nothing left"
    if r["touches_border"]:
        return "WARN generated cropped"
    if not 0.15 < r["coverage"] < 0.85:
        return "WARN odd coverage"
    return "ok"


def contact_sheet(icons: list[Path], dest: Path, cell: int = 160, cols: int = 8) -> None:
    """Checkerboard ground, because an icon with a grey rim looks perfect on grey."""
    rows = (len(icons) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 18)), (245, 245, 248))
    chk = Image.new("RGB", (cell, cell), (255, 255, 255))
    px = chk.load()
    for y in range(cell):
        for x in range(cell):
            if (x // 10 + y // 10) % 2:
                px[x, y] = (214, 214, 220)

    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(icons):
        x, y = (i % cols) * cell, (i // cols) * (cell + 18)
        sheet.paste(chk, (x, y))
        im = Image.open(p).convert("RGBA").resize((cell - 16, cell - 16), Image.LANCZOS)
        sheet.paste(im, (x + 8, y + 8), im)
        d.text((x + 6, y + cell + 3), p.stem, fill=(40, 40, 50))
    sheet.save(dest)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--tol", type=float, default=42.0,
                    help="RGB distance from the estimated background colour")
    ap.add_argument("--margin", type=float, default=0.06)
    ap.add_argument("--sheet", default=None)
    ap.add_argument("--no-salvage", action="store_true",
                    help="reject a multi-object generation instead of cropping to "
                         "the best single object in it")
    args = ap.parse_args()

    src, dst = Path(args.src), Path(args.dst)
    files = sorted(p for p in src.glob("*.png"))
    if not files:
        raise SystemExit(f"no PNGs in {src}")

    reports, made = {}, []
    for p in files:
        try:
            r = process(p, dst, args.size, args.tol, args.margin, not args.no_salvage)
            made.append(Path(r["out"]))
        except Exception as exc:  # noqa: BLE001 - one bad icon must not kill a batch
            r = {"error": str(exc)}
        r["verdict"] = verdict(r)
        reports[p.stem] = r
        print(f"  {p.stem:<14} {r['verdict']:<32} "
              f"bg={r.get('bg_fraction','-')} cov={r.get('coverage','-')} "
              f"extra={r.get('extra_objects','-')}")

    (dst / "cutout_report.json").write_text(json.dumps(reports, indent=2))
    if args.sheet and made:
        contact_sheet(made, Path(args.sheet))
        print(f"[sheet] {args.sheet}")

    bad = [k for k, v in reports.items() if v["verdict"].startswith(("REJECT", "ERROR"))]
    print(f"\n{len(made)}/{len(files)} cut, {len(bad)} rejected"
          + (f": {bad}" if bad else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
