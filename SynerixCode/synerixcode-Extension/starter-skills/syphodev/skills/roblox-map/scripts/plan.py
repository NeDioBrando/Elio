"""Draw the map plan straight from the resolved tree.

Not a mockup and not a render: every rectangle here is the same Box the prover
measured and the emitter will build, so the picture cannot drift from what
ships. That is the whole reason the plan is drawn from data rather than
generated as an image.

Run:  python plan.py duel_arena -o plan.png
"""

from __future__ import annotations

import argparse
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

import spec as specmod

BG = (22, 24, 28)
PANEL = (28, 31, 36)
GRID = (44, 48, 55)
INK = (232, 234, 238)
DIM = (140, 146, 156)
SPAWN = (86, 204, 140)
KILL = (214, 92, 92)

# Role colouring: what a surface is FOR decides how it reads.
ROLE_COLOURS = [
    ("arena_floor", (74, 88, 112)),
    ("core_access", (150, 122, 74)),
    ("high_ground", (120, 92, 150)),
    ("recoil_prize", (196, 148, 72)),
    ("pocket", (72, 122, 130)),
    ("grapple_anchor", (108, 132, 90)),
    ("signpost", (128, 108, 88)),
]
DEFAULT_COLOUR = (96, 100, 108)


def colour_for(box):
    for role, c in ROLE_COLOURS:
        if role in box.roles:
            return c
    return DEFAULT_COLOUR


def _font(size):
    for name in ("consola.ttf", "DejaVuSansMono.ttf", "cour.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


class View:
    """Maps world units to pixels inside one panel."""

    def __init__(self, box, lo, hi, pad=28):
        self.x0, self.y0, self.x1, self.y1 = box
        w, h = (self.x1 - self.x0 - 2 * pad), (self.y1 - self.y0 - 2 * pad)
        span_u = max(hi[0] - lo[0], 1e-6)
        span_v = max(hi[1] - lo[1], 1e-6)
        self.s = min(w / span_u, h / span_v)
        self.lo, self.hi, self.pad = lo, hi, pad
        self.cx = (self.x0 + self.x1) / 2.0
        self.cy = (self.y0 + self.y1) / 2.0
        self.mu = (lo[0] + hi[0]) / 2.0
        self.mv = (lo[1] + hi[1]) / 2.0

    def pt(self, u, v):
        return (self.cx + (u - self.mu) * self.s,
                self.cy - (v - self.mv) * self.s)


def draw_plan(m, checks=None, out="plan.png", width=1720, height=980):
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img, "RGBA")
    f_h = _font(26)
    f_m = _font(15)
    f_s = _font(12)
    f_t = _font(11)

    lo, hi = m.bounds
    head = 74
    gap = 16
    left_w = int((width - 3 * gap) * 0.56)
    top_box = (gap, head, gap + left_w, height - gap)
    side_box = (gap * 2 + left_w, head, width - gap, height - gap)

    # ---- header ----------------------------------------------------------
    d.text((gap + 4, 16), f"{m.name}", font=f_h, fill=INK)
    sub = (f"{len(m.boxes)} parts   profile {m.profile.name}   "
           f"kill plane y={m.kill_plane:g}, ring-out fires at y={m.ring_out_y:g}")
    d.text((gap + 6, 48), sub, font=f_m, fill=DIM)
    if checks:
        worst = min((c.status for c in checks),
                    key=lambda s: {"FAIL": 0, "UNVERIFIABLE": 1, "WARN": 2,
                                   "PASS": 3, "INFO": 4}.get(s, 5))
        col = {"FAIL": KILL, "UNVERIFIABLE": (214, 168, 92),
               "WARN": (214, 190, 92)}.get(worst, SPAWN)
        label = f"  {worst}  "
        w = d.textlength(label, font=f_m)
        d.rectangle([width - gap - w - 8, 44, width - gap - 4, 68], fill=col)
        d.text((width - gap - w - 4, 48), label, font=f_m, fill=(18, 18, 20))

    # ---- top-down --------------------------------------------------------
    d.rectangle(list(top_box), fill=PANEL)
    v = View(top_box, (lo[0], lo[2]), (hi[0], hi[2]))
    _grid(d, v, top_box, lo[0], hi[0], lo[2], hi[2], f_t)
    d.text((top_box[0] + 10, top_box[1] + 8), "TOP-DOWN   x / z", font=f_s, fill=DIM)

    order = sorted(m.boxes, key=lambda b: b.top)
    for b in order:
        pts = _footprint(b)
        d.polygon([v.pt(px, pz) for px, pz in pts],
                  fill=colour_for(b) + (218,), outline=(16, 17, 19))
        if b.ramp_axis:
            _ramp_arrow(d, v, b)
    placed = []
    for b in sorted(order, key=lambda b: -b.size[0] * b.size[2]):
        cx, cy = v.pt(b.centre[0], b.centre[2])
        _label(d, cx, cy, b.name, f_s, INK, placed, top_box)

    for s in m.spawns:
        x, y = v.pt(s[0], s[2])
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=SPAWN)
    if m.spawns:
        d.text((top_box[0] + 10, top_box[3] - 24),
               f"{len(m.spawns)} spawns", font=f_s, fill=SPAWN)

    # ---- elevation -------------------------------------------------------
    d.rectangle(list(side_box), fill=PANEL)
    y_lo = min(lo[1], m.kill_plane) - 6
    y_hi = max(hi[1], max((b.top for b in m.boxes), default=0)) + 6
    ev = View(side_box, (lo[0], y_lo), (hi[0], y_hi))
    _grid(d, ev, side_box, lo[0], hi[0], y_lo, y_hi, f_t)
    d.text((side_box[0] + 10, side_box[1] + 8),
           "ELEVATION   x / y   (looking along +z)", font=f_s, fill=DIM)

    for b in sorted(m.boxes, key=lambda b: b.centre[2]):
        blo, bhi = b.aabb()
        p0 = ev.pt(blo[0], blo[1])
        p1 = ev.pt(bhi[0], bhi[1])
        d.rectangle([min(p0[0], p1[0]), min(p0[1], p1[1]),
                     max(p0[0], p1[0]), max(p0[1], p1[1])],
                    fill=colour_for(b) + (150,), outline=(16, 17, 19))

    for label, yv, col in ((f"ring-out  y={m.ring_out_y:g}", m.ring_out_y, KILL),
                           (f"kill plane  y={m.kill_plane:g}", m.kill_plane, (150, 70, 70))):
        py = ev.pt(lo[0], yv)[1]
        if side_box[1] < py < side_box[3]:
            d.line([side_box[0] + 6, py, side_box[2] - 6, py], fill=col, width=2)
            d.text((side_box[0] + 12, py - 15), label, font=f_t, fill=col)

    # fall annotations: the number the ring-out check turns on
    g = m.profile.get("gravity", 120.0)
    ragdoll = m.profile.get("ragdollRecovery", 0.5)
    ro = m.intent.get("ringOut") or {}
    try:
        froms = m.match_names(ro.get("from", []))
    except specmod.SpecError:
        froms = []
    seen_y = set()
    for name in froms:
        b = m.by_name(name)
        if round(b.top, 2) in seen_y:
            continue
        seen_y.add(round(b.top, 2))
        h = b.top - m.ring_out_y
        if h <= 0:
            continue
        t = math.sqrt(2.0 * h / g)
        py = ev.pt(hi[0], b.top)[1]
        # The recovery-window arithmetic is meaningless when the spec
        # declares no counterplay - the ring-out is a designed elimination,
        # not something you fly out of - and printing "-0.73s control" on a
        # map the prover has just PASSED is a plan that contradicts the
        # report drawn from the same tree.
        if (m.intent.get("ringOut") or {}).get("counterplay") == "none":
            txt = f"{name}: fall {t:.2f}s, unrecoverable by declaration"
        else:
            txt = f"{name}: fall {t:.2f}s -> {t - ragdoll:+.2f}s control"
        tw = d.textlength(txt, font=f_t)
        # Right-align inside the panel. Anchoring to the world x-bound put the
        # text past the panel edge and the numbers were clipped away.
        tx = side_box[2] - 10 - tw
        d.line([tx - 8, py, tx - 3, py], fill=(214, 168, 92), width=1)
        d.text((tx, py - 13), txt, font=f_t, fill=(214, 168, 92))

    # ---- legend ----------------------------------------------------------
    lx = side_box[0] + 12
    ly = side_box[3] - 20 - 15 * (len(ROLE_COLOURS) + 1)
    d.text((lx, ly - 18), "ROLE", font=f_s, fill=DIM)
    for role, c in ROLE_COLOURS:
        d.rectangle([lx, ly + 3, lx + 11, ly + 12], fill=c)
        d.text((lx + 18, ly), role, font=f_t, fill=DIM)
        ly += 15
    d.rectangle([lx, ly + 3, lx + 11, ly + 12], fill=DEFAULT_COLOUR)
    d.text((lx + 18, ly), "other", font=f_t, fill=DIM)

    img.save(out)
    return out


def _footprint(b):
    hx, _, hz = b.half
    r = math.radians(b.yaw)
    c, s = math.cos(r), math.sin(r)
    out = []
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        lx, lz = sx * hx, sz * hz
        out.append((b.centre[0] + lx * c + lz * s,
                    b.centre[2] - lx * s + lz * c))
    return out


def _ramp_arrow(d, v, b):
    """Point from the low edge of a ramp to its high edge."""
    axis = b.ramp_axis
    hx, _, hz = b.half
    span = hx if axis[1] == "x" else hz
    sign = 1.0 if axis[0] == "+" else -1.0
    r = math.radians(b.yaw)
    c, s = math.cos(r), math.sin(r)

    def w(lx, lz):
        return (b.centre[0] + lx * c + lz * s, b.centre[2] - lx * s + lz * c)

    if axis[1] == "x":
        a, bb = w(-sign * span * 0.8, 0), w(sign * span * 0.8, 0)
    else:
        a, bb = w(0, -sign * span * 0.8), w(0, sign * span * 0.8)
    p0, p1 = v.pt(*a), v.pt(*bb)
    d.line([p0, p1], fill=(240, 226, 190), width=2)
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    for off in (0.42, -0.42):
        d.line([p1, (p1[0] - 10 * math.cos(ang + off),
                     p1[1] - 10 * math.sin(ang + off))],
               fill=(240, 226, 190), width=2)


def _label(d, cx, cy, text, font, fill, placed=None, bounds=None):
    """Draw a label, nudging it clear of labels already placed.

    Parts stacked in plan view (a Spine over a Core, a Post on a Ledge) put
    their labels at the same pixel, and two names drawn on top of each other
    read as one corrupt word. Vertical nudging is enough because the collisions
    are always vertical stacks.
    """
    w = d.textlength(text, font=font)
    box = [cx - w / 2 - 3, cy - 8, cx + w / 2 + 3, cy + 8]
    if placed is not None:
        for _ in range(24):
            if not any(_hits(box, o) for o in placed):
                break
            box[1] += 18
            box[3] += 18
            if bounds and box[3] > bounds[3] - 4:
                box[1] = cy - 8 - (box[1] - (cy - 8))
                box[3] = box[1] + 16
        placed.append(list(box))
    d.rectangle(box, fill=(16, 17, 19, 190))
    d.text((box[0] + 3, box[1] + 1), text, font=font, fill=fill)


def _hits(a, b):
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _grid(d, v, box, u0, u1, v0, v1, font, step=None):
    span = max(u1 - u0, v1 - v0)
    step = step or (10 ** int(math.log10(span / 4)) *
                    max(1, round(span / 4 / 10 ** int(math.log10(span / 4)))))
    d.rectangle(list(box), outline=(60, 64, 72))
    u = math.ceil(u0 / step) * step
    while u <= u1:
        x = v.pt(u, v0)[0]
        d.line([x, box[1] + 1, x, box[3] - 1], fill=GRID)
        d.text((x + 3, box[3] - 15), f"{u:g}", font=font, fill=(96, 100, 108))
        u += step
    w = math.ceil(v0 / step) * step
    while w <= v1:
        y = v.pt(u0, w)[1]
        d.line([box[0] + 1, y, box[2] - 1, y], fill=GRID)
        d.text((box[0] + 4, y - 13), f"{w:g}", font=font, fill=(96, 100, 108))
        w += step


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render a map plan from its spec.")
    ap.add_argument("spec")
    ap.add_argument("-o", "--out", default="plan.png")
    ap.add_argument("--prove", action="store_true",
                    help="run the prover too and stamp the verdict on the plan")
    a = ap.parse_args(argv)
    m = specmod.load(a.spec)
    checks = None
    if a.prove:
        import prove as prv
        checks, _ = prv.run(m)
    path = draw_plan(m, checks, a.out)
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
