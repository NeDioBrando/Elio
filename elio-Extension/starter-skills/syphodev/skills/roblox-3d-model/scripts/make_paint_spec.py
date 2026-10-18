"""Write a first-pass paint spec from measured landmarks and the concept palette.

    blender --background --python scripts/make_paint_spec.py -- \\
        --mesh work/out/low.glb --concept work/concept.png \\
        --out work/pig.paint.json [--name pig]

WHY. Hand-authoring a spec per animal was the one step that did not scale: the
pig took axes_probe, then --describe, then three look-and-adjust passes. But
almost everything used in that hand pass is already MEASURABLE - the body axis,
which end the head is on, where the legs are, how tall the head is - and the
colours are already in the concept. This writes the spec those measurements
imply, so the human pass becomes a CHECK rather than authoring from scratch.

It will not beat a hand-tuned spec. It gets close enough that a render-and-look
is usually the only thing left.

WHICH END IS THE HEAD. The body axis is the longest horizontal one, which is
reliable. WHICH END the head is on is NOT reliably derivable from geometry, and
this is the one thing the generator cannot finish on its own.

The obvious heuristic - a head is bulky, a tail is thin, so compare the
cross-section at the two extremities - works on a pig (11.3x, correct) and FAILS
ON A COW (2.3x, and it picked the wrong end). A cow's rump out-bulks its head;
a pig's does not. Width does not separate them either, and in opposite
directions: the pig's head region is WIDER than its rump, the cow's is narrower.
Two animals, two contradictions, so the heuristic is a tiebreak at best.

So `--head-end auto` is REFUSED below --min-confidence (default 5x, chosen
because the pig cleared it at 11.3x and the wrong cow answer sat at 2.3x). Pass
`--head-end min|max` explicitly. Read it off scripts/axes_probe.py, which is one
render and unambiguous - and for a batch, `batch.py orient` renders every asset
onto ONE contact sheet so the whole set is settled in a single look.

PATTERNED ANIMALS. If the palette holds a second common cluster far from the
base in luminance - a Holstein's black on white - a deterministic scatter of
patch blobs is added. Without it the cow came out ALL WHITE: a clean model of
the wrong animal. The scatter is fixed, not random, so a set regenerates
identically; move or delete the patch stamps by hand if a specific animal needs
specific markings.

COLOUR. The k-means palette of the concept is dominated by SHADED body colour,
not albedo: the pig's most common cluster was #B48E9A, a dull mauve, while the
albedo that reads correctly in engine is nearer #F4AEC8. So the base is the
dominant cluster's HUE, with saturation lifted and value pulled most of the way
toward the brightest cluster. Calibrated against the hand-authored pig spec.
"""
from __future__ import annotations
import argparse, colorsys, json, sys
from pathlib import Path

import bpy, numpy as np

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import paint_texture as P  # noqa: E402


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mesh", required=True)
    p.add_argument("--concept", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--name", default="asset")
    p.add_argument("--clusters", type=int, default=6)
    p.add_argument("--head-end", choices=["auto", "min", "max"], default="auto",
                   help="which end of the body axis the head is on. 'auto' is a "
                        "GUESS and is refused when it is not confident.")
    p.add_argument("--min-confidence", type=float, default=5.0)
    p.add_argument("--preset", default="creature", choices=["creature", "prop"],
                   help="creature emits anatomical stamps (belly, snout, eyes). "
                        "prop emits a flat base colour and NOTHING else - see "
                        "build_prop_spec for why guessing is worse than nothing.")
    return p.parse_args(a)


# ---------------------------------------------------------------- colour
def _hex(rgb_srgb):
    return "#" + "".join("{:02X}".format(int(round(max(0.0, min(1.0, c)) * 255)))
                         for c in rgb_srgb)


def _srgb(linear):
    c = np.clip(np.asarray(linear, np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def _shift(rgb, dv=0.0, ds=0.0, dh=0.0):
    h, s, v = colorsys.rgb_to_hsv(*[float(x) for x in rgb])
    return colorsys.hsv_to_rgb((h + dh) % 1.0, max(0.0, min(1.0, s + ds)),
                               max(0.0, min(1.0, v + dv)))


def palette(concept: Path, k: int):
    """Subject-only k-means, using the flood-fill mask. A chroma test is not
    enough: a grey backdrop picks up a colour cast off the subject."""
    mask, rgb = P.subject_mask(concept, 256)
    P.check_mask(mask)
    keep = rgb[mask]

    rng = np.random.default_rng(0)
    cen = keep[rng.choice(len(keep), k, replace=False)]
    lab = np.zeros(len(keep), int)
    for _ in range(30):
        d = ((keep[:, None, :] - cen[None, :, :]) ** 2).sum(axis=2)
        lab = d.argmin(axis=1)
        for i in range(k):
            if (lab == i).any():
                cen[i] = keep[lab == i].mean(axis=0)
    shares = np.array([(lab == i).sum() for i in range(k)], float) / len(keep)
    srgb = np.array([_srgb(c) for c in cen])
    lum = srgb @ np.array([0.2126, 0.7152, 0.0722])
    return srgb, shares, lum


def choose_colours(srgb, shares, lum):
    dom_i = int(np.argmax(shares))
    dom = srgb[dom_i]
    brightest = srgb[int(np.argmax(lum))]
    darkest = srgb[int(np.argmin(lum))]

    # Lift the dominant (shaded) cluster toward albedo. See module docstring.
    h, s, v = colorsys.rgb_to_hsv(*[float(x) for x in dom])
    _, _, vb = colorsys.rgb_to_hsv(*[float(x) for x in brightest])
    base = colorsys.hsv_to_rgb(h, min(1.0, s * 1.30), v + (vb - v) * 0.70)

    # A PATTERNED animal has a second colour that is common AND far from the
    # base in luminance - a Holstein's black on white. Bands and blobs alone
    # produced an all-white cow, which is a plausible model of the wrong animal.
    base_lum = float(np.dot(base, [0.2126, 0.7152, 0.0722]))
    patch, best = None, 0.0
    for i in range(len(srgb)):
        if i == dom_i or shares[i] < 0.12:
            continue
        gap = abs(float(lum[i]) - base_lum)
        if gap > 0.25 and gap > best:
            best, patch = gap, srgb[i]

    return {
        "patch": _hex(_shift(patch, dv=+0.02)) if patch is not None else None,
        "patch_contrast": round(best, 3),
        "base": _hex(base),
        "light": _hex(_shift(base, dv=+0.06, ds=-0.05)),
        "shade": _hex(_shift(base, dv=-0.05, ds=+0.03)),
        "accent": _hex(_shift(base, dv=-0.08, ds=+0.10)),
        "dark": _hex(_shift(darkest, dv=-0.02)),
        "white": _hex(_shift(brightest, dv=+0.02, ds=-0.35)),
    }


# ---------------------------------------------------------------- geometry
def landmarks(co):
    lo, hi = co.min(axis=0), co.max(axis=0)
    span = np.where(hi - lo == 0, 1.0, hi - lo)
    n = (co - lo) / span

    up = 2                                   # Blender Z is up after stage 4
    horiz = [0, 1]
    body = horiz[int(np.argmax([span[i] for i in horiz]))]
    width = 1 - body                      # the other horizontal axis

    def cross(mask):
        if not mask.any():
            return 0.0
        s = n[mask]
        return float((s[:, width].max() - s[:, width].min()) *
                     (s[:, up].max() - s[:, up].min()))

    lowend = cross(n[:, body] < 0.08)
    highend = cross(n[:, body] > 0.92)
    head_at_zero = lowend >= highend
    ratio = (max(lowend, highend) / max(min(lowend, highend), 1e-6))

    def b(v):                                 # body coord, 0 = head
        return v if head_at_zero else 1.0 - v

    nb = b(n[:, body])
    head = n[nb < 0.22]
    info = {
        "span_studs": [round(float(v), 3) for v in span],
        "body_axis": "xyz"[body], "width_axis": "xyz"[width], "up_axis": "z",
        "head_at_axis_min": bool(head_at_zero),
        "head_end_cross_section": round(max(lowend, highend), 4),
        "tail_end_cross_section": round(min(lowend, highend), 4),
        "head_tail_ratio": round(ratio, 1),
    }
    if len(head):
        info["head_z_range"] = [round(float(head[:, up].min()), 3),
                                round(float(head[:, up].max()), 3)]
        info["head_width_range"] = [round(float(head[:, width].min()), 3),
                                    round(float(head[:, width].max()), 3)]
    nose_i = int(np.argmin(nb))
    info["nose_point"] = [round(float(v), 3) for v in n[nose_i]]
    info["nose_z"] = round(float(n[nose_i, up]), 3)

    low = n[n[:, up] < 0.05]
    info["foot_body_range"] = ([round(float(b(low[:, body]).min()), 3),
                               round(float(b(low[:, body]).max()), 3)]
                               if len(low) else None)
    ears = n[(n[:, up] > 0.90) & (nb < 0.38)]
    info["has_ears"] = bool(len(ears) > max(20, 0.004 * len(n)))
    if info["has_ears"]:
        info["ear_body"] = round(float(np.median(b(ears[:, body]))), 3)
        info["ear_z"] = round(float(np.median(ears[:, up])), 3)
    return n, body, width, up, head_at_zero, info


def build_spec(name, col, info, body, width, up, head_at_zero):
    def pt(b_, w_, h_):
        """Body/width/height in head-first coords -> the painter's x,y,z."""
        v = [0.0, 0.0, 0.0]
        v[body] = b_ if head_at_zero else 1.0 - b_
        v[width] = w_
        v[up] = h_
        return [round(x, 4) for x in v]

    def rad(b_, w_, h_):
        r = [0.0, 0.0, 0.0]
        r[body], r[width], r[up] = b_, w_, h_
        return [round(x, 4) for x in r]

    hz = info.get("head_z_range", [0.3, 0.95])
    hw = info.get("head_width_range", [0.1, 0.9])
    nose_z = info.get("nose_z", 0.72)
    head_h = max(hz[1] - hz[0], 0.15)
    side = hw[0] + (hw[1] - hw[0]) * 0.16          # just inboard of the flank
    axis_name = "xyz"[up]

    stamps = [
        {"name": "belly", "type": "band", "axis": axis_name, "max": 0.34,
         "color": col["light"], "soft": 0.20},
        {"name": "back", "type": "band", "axis": axis_name, "min": 0.86,
         "color": col["shade"], "soft": 0.14},
        {"name": "hooves", "type": "band", "axis": axis_name, "max": 0.055,
         "color": col["dark"], "soft": 0.018},
    ]

    if col.get("patch"):
        # Deterministic scatter along the body, mirrored, so a set regenerates
        # identically. Sizes and offsets are fractions of the body, not studs.
        scatter = [(0.30, 0.30, 0.55, 0.115), (0.47, 0.24, 0.72, 0.135),
                   (0.63, 0.33, 0.48, 0.100), (0.74, 0.27, 0.68, 0.120),
                   (0.20, 0.36, 0.75, 0.095), (0.55, 0.40, 0.30, 0.090),
                   (0.86, 0.31, 0.60, 0.105)]
        for i, (b_, w_, h_, r_) in enumerate(scatter):
            stamps.append({
                "name": "patch{}".format(i + 1), "type": "blob",
                "at": pt(b_, w_, h_), "r": rad(r_ * 1.15, r_ * 1.6, r_ * 1.25),
                "color": col["patch"], "soft": 0.30, "mirror": "x"})

    if info.get("has_ears"):
        stamps.append({"name": "inner_ear", "type": "blob",
                       "at": pt(info["ear_body"], side + 0.03, info["ear_z"] + 0.02),
                       "r": rad(0.10, 0.135, 0.062),
                       "color": col["accent"], "soft": 0.5, "mirror": "x"})

    facing_head = [0.0, 0.0, 0.0]
    facing_head[body] = -1.0 if head_at_zero else 1.0
    facing_side = [0.0, 0.0, 0.0]
    facing_side[width] = -1.0

    stamps += [
        {"name": "snout", "type": "blob", "at": pt(0.010, 0.5, nose_z),
         "r": rad(0.066, 0.232, head_h * 0.33),
         "color": col["accent"], "soft": 0.30,
         "facing": facing_head, "facing_min": 0.10},

        {"name": "nostril", "type": "blob", "at": pt(0.0, 0.418, nose_z),
         "r": rad(0.045, 0.042, 0.048),
         "color": col["dark"], "soft": 0.25,
         "facing": facing_head, "facing_min": 0.35, "mirror": "x"},

        {"name": "eye_white", "type": "blob",
         "at": pt(0.128, side, hz[0] + head_h * 0.72),
         "r": rad(0.062, 0.072, head_h * 0.095),
         "color": col["white"], "soft": 0.10,
         "facing": facing_side, "facing_min": 0.20, "mirror": "x"},

        {"name": "pupil", "type": "blob",
         "at": pt(0.122, side - 0.007, hz[0] + head_h * 0.71),
         "r": rad(0.036, 0.048, head_h * 0.055),
         "color": "#241C20", "soft": 0.10,
         "facing": facing_side, "facing_min": 0.20, "mirror": "x"},

        {"name": "brow", "type": "blob",
         "at": pt(0.142, side + 0.01, hz[0] + head_h * 0.82),
         "r": rad(0.048, 0.078, 0.014),
         "color": "#2A2024", "soft": 0.15,
         "facing": facing_side, "facing_min": 0.25, "mirror": "x"},
    ]

    return {
        "_generated": "make_paint_spec.py - FIRST PASS. Render it and look before trusting it.",
        "_asset": name,
        "_landmarks": info,
        "base": col["base"],
        "stamps": stamps,
    }


def build_prop_spec(name, col, info):
    """A prop gets its base colour and NO stamps. Deliberately.

    MEASURED 2026-08-31: before this existed, every asset went through
    build_spec, which is hard-coded cow anatomy - belly, back, hooves,
    inner_ear, snout, nostril, eye_white, pupil, brow. Run against a gold coin
    that produced **a coin with two googly eyes and eyebrows on its back face**,
    because the eye_white and pupil stamps are white and black and land wherever
    a cow's face would be.

    Every number was green while that happened: 453,632 texels painted, 0.43 UV
    coverage, exit 0. The stats measure that SOMETHING was painted, never that
    it belongs there. Only the render caught it.

    The trophy in the same batch looked fine, which is the more dangerous half:
    it is single-colour, so all nine anatomical stamps drew the same gold out of
    the concept palette and cancelled out. A prop escapes this bug exactly when
    it has nothing to lose - so "it looked right on the last prop" is not
    evidence that the next one will.

    Why flat rather than a cleverer guess: any band or patch placement for a
    generic prop is invention. A sword is not a coin is not a chest, and there
    is no anatomy to hang a rule on. A flat base colour is always plausible and
    never actively wrong, which is the correct default for something a human is
    told to look at anyway. **Multi-colour props need a hand-authored spec** -
    the file is generated once and is designed to be edited, so add the stamps
    you actually want and re-run paint_texture.py.
    """
    return {
        "_generated": ("make_paint_spec.py --preset prop. Flat base colour, no stamps. "
                       "Anatomical stamps are creature-only and put EYES on a coin. "
                       "For a multi-colour prop, hand-author the stamps below."),
        "_asset": name,
        "_landmarks": info,
        "_palette": {k: col[k] for k in ("base", "light", "shade", "dark")
                     if col.get(k)},
        "base": col["base"],
        "stamps": [],
    }


def main():
    a = args()
    mesh = Path(a.mesh).resolve()
    concept = Path(a.concept).resolve()
    co, _uv, _ln, tv, _tl = P.load_mesh(mesh)
    n, body, width, up, head_at_zero, info = landmarks(co)

    # A prop has no head, so the head-end gate is not just unnecessary here, it
    # is unanswerable - and before this branch existed it was silently answered
    # anyway and used to place a face.
    if a.preset == "prop":
        srgb, shares, lum = palette(concept, a.clusters)
        col = choose_colours(srgb, shares, lum)
        spec = build_prop_spec(a.name, col, info)
        out = Path(a.out).resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(spec, indent=2), encoding="utf-8")
        print("[spec] PROP: flat base {}, no anatomical stamps".format(col["base"]))
        print("[spec] hand-author stamps in the file if this prop needs more than "
              "one colour")
        print("[spec] wrote {}".format(out))
        return 0

    if a.head_end == "min":
        head_at_zero = True
    elif a.head_end == "max":
        head_at_zero = False
    elif info["head_tail_ratio"] < a.min_confidence:
        raise SystemExit(
            "[spec] REFUSING TO GUESS the head end: cross-section ratio is only "
            "{}x (need {}x). This heuristic already picked the WRONG end on the "
            "cow at 2.3x. Render scripts/axes_probe.py, look at it, and pass "
            "--head-end min or --head-end max.".format(
                info["head_tail_ratio"], a.min_confidence))
    info["head_at_axis_min"] = bool(head_at_zero)
    info["head_end_source"] = ("explicit:" + a.head_end) if a.head_end != "auto"         else "auto ({}x)".format(info["head_tail_ratio"])

    srgb, shares, lum = palette(concept, a.clusters)
    col = choose_colours(srgb, shares, lum)

    spec = build_spec(a.name, col, info, body, width, up, head_at_zero)
    out = Path(a.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(spec, indent=2), encoding="utf-8")

    print("[spec] body axis {}, head at {} end".format(
        info["body_axis"], "min" if head_at_zero else "max"))
    print("[spec] base {}  light {}  shade {}  dark {}".format(
        col["base"], col["light"], col["shade"], col["dark"]))
    print("[spec] ears: {} | patches: {}".format(
        "yes" if info.get("has_ears") else "no",
        "{} (contrast {})".format(col["patch"], col["patch_contrast"])
        if col.get("patch") else "no second colour found"))
    print("[spec] head end source: {}".format(info["head_end_source"]))
    print("[spec] wrote {}".format(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
