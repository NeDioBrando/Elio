"""Render the resolved tree to a PNG, without Studio.

The plan view answers "is the layout right". This answers "does it look like
anything", which is the question the prover deliberately refuses and the one
that decides whether a map is worth building.

It exists because the Studio round trip is the slow, fragile part of the loop:
the plugin drops on every Studio restart, screenshots need the window restored,
and a 500-part map has to go over HTTP. Judging silhouette, palette and massing
needs none of that. Iterate here, build once.

Painter's algorithm with flat shading and distance fog. Not a renderer - a
proof that the massing reads.

Run:  python preview.py sky_citadel -o look.png
      python preview.py sky_citadel --eye 240 120 240 --look 0 20 0 --fov 55
"""

from __future__ import annotations

import argparse
import math
import os
import sys

from PIL import Image, ImageDraw

import spec as specmod
import theme as thememod

# Face definition: (corner indices, outward normal in local space)
FACES = [
    ((0, 1, 3, 2), (0, 0, -1)),
    ((4, 6, 7, 5), (0, 0, 1)),
    ((0, 4, 5, 1), (-1, 0, 0)),
    ((2, 3, 7, 6), (1, 0, 0)),
    ((1, 5, 7, 3), (0, 1, 0)),
    ((0, 2, 6, 4), (0, -1, 0)),
]


def corners(b):
    hx, hy, hz = b.half
    r = math.radians(b.yaw)
    c, s = math.cos(r), math.sin(r)
    out = []
    for ix in (-1, 1):
        for iy in (-1, 1):
            for iz in (-1, 1):
                lx, ly, lz = ix * hx, iy * hy, iz * hz
                out.append((b.centre[0] + lx * c + lz * s,
                            b.centre[1] + ly,
                            b.centre[2] - lx * s + lz * c))
    return out


def _norm_world(n, yaw):
    r = math.radians(yaw)
    c, s = math.cos(r), math.sin(r)
    return (n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c)


def faces_of(b):
    """Faces as (corner list, world normal). A ramp loses its top-front pair and
    gains a slope, which matters: a ramp drawn as a box is a lie in exactly the
    place a reader is looking."""
    cs = corners(b)
    out = []
    if not b.ramp_axis:
        for idx, n in FACES:
            out.append(([cs[i] for i in idx], _norm_world(n, b.yaw)))
        return out
    # Wedge: collapse the top edge on the low side of the ramp axis.
    axis, sign = b.ramp_axis[1], (1 if b.ramp_axis[0] == "+" else -1)
    hx, hy, hz = b.half
    r = math.radians(b.yaw)
    c, s = math.cos(r), math.sin(r)

    def w(lx, ly, lz):
        return (b.centre[0] + lx * c + lz * s, b.centre[1] + ly,
                b.centre[2] - lx * s + lz * c)

    lo, hi = -hz * sign, hz * sign
    if axis == "x":
        lo, hi = -hx * sign, hx * sign
        p = [w(lo, -hy, -hz), w(lo, -hy, hz), w(hi, -hy, hz), w(hi, -hy, -hz),
             w(hi, hy, hz), w(hi, hy, -hz)]
    else:
        p = [w(-hx, -hy, lo), w(hx, -hy, lo), w(hx, -hy, hi), w(-hx, -hy, hi),
             w(-hx, hy, hi), w(hx, hy, hi)]
    quads = [([p[0], p[1], p[2], p[3]], (0, -1, 0)),
             ([p[3], p[2], p[4], p[5]], (0, 1, 0)),
             ([p[0], p[1], p[5], p[4]] if axis == "x" else [p[2], p[3], p[4]], None),
             ]
    out = []
    for pts, n in quads:
        if n is None:
            n = _tri_normal(pts)
        out.append((pts, n))
    # the two side triangles
    if axis == "x":
        out.append(([p[1], p[2], p[4]], _tri_normal([p[1], p[2], p[4]])))
        out.append(([p[0], p[3], p[5]], _tri_normal([p[0], p[3], p[5]])))
    else:
        out.append(([p[0], p[3], p[4]], _tri_normal([p[0], p[3], p[4]])))
        out.append(([p[1], p[2], p[5]], _tri_normal([p[1], p[2], p[5]])))
    return out


def _tri_normal(p):
    ax, ay, az = (p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2])
    bx, by, bz = (p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2])
    n = (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)
    m = math.sqrt(sum(v * v for v in n)) or 1.0
    return (n[0] / m, n[1] / m, n[2] / m)


class Cam:
    def __init__(self, eye, look, w, h, fov=55.0, up=(0, 1, 0)):
        self.eye = eye
        f = _unit(_sub(look, eye))
        r = _unit(_cross(f, up))
        u = _cross(r, f)
        self.f, self.r, self.u = f, r, u
        self.w, self.h = w, h
        self.s = (w / 2.0) / math.tan(math.radians(fov) / 2.0)

    NEAR = 0.35

    def depth(self, p):
        return _dot(_sub(p, self.eye), self.f)

    def project(self, p):
        d = _sub(p, self.eye)
        z = _dot(d, self.f)
        if z <= self.NEAR:
            return None
        x = _dot(d, self.r) * self.s / z + self.w / 2.0
        y = -_dot(d, self.u) * self.s / z + self.h / 2.0
        return (x, y, z)

    def clip_near(self, pts):
        """Sutherland-Hodgman against the near plane.

        Dropping any face with a corner behind the camera made a 470-stud
        ground plane VANISH from every low camera angle - the map appeared to
        float in the sky, which looked like a map bug and was a renderer bug.
        Clip the polygon instead of discarding it.
        """
        out = []
        n = len(pts)
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            da, db = self.depth(a) - self.NEAR, self.depth(b) - self.NEAR
            if da >= 0:
                out.append(a)
            if (da >= 0) != (db >= 0):
                t = da / (da - db)
                out.append((a[0] + (b[0] - a[0]) * t,
                            a[1] + (b[1] - a[1]) * t,
                            a[2] + (b[2] - a[2]) * t))
        return out


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _unit(a):
    m = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / m, a[1] / m, a[2] / m)


def render(m, theme, out="look.png", w=1400, h=900, eye=None, look=None,
           fov=55.0, sun=(-0.45, -0.78, -0.44), fog=0.00042):
    pal = theme["palette"]
    sky_top = tuple(max(0, min(255, int(c * 0.80))) for c in pal["sky"])
    sky_bot = tuple(max(0, min(255, int(c * 1.16 + 30))) for c in pal["sky"])

    lo = [min(b.aabb()[0][i] for b in m.boxes) for i in range(3)]
    hi = [max(b.aabb()[1][i] for b in m.boxes) for i in range(3)]
    span = max(hi[0] - lo[0], hi[2] - lo[2])
    mid = [(lo[i] + hi[i]) / 2 for i in range(3)]
    if eye is None:
        eye = (mid[0] + span * 0.72, hi[1] + span * 0.10, mid[2] + span * 0.86)
    if look is None:
        look = (mid[0], mid[1] + (hi[1] - mid[1]) * 0.15, mid[2])

    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img, "RGBA")
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([0, y, w, y], fill=tuple(
            int(sky_top[i] + (sky_bot[i] - sky_top[i]) * (t ** 0.75)) for i in range(3)))

    cam = Cam(eye, look, w, h, fov)
    sun = _unit(sun)

    polys = []
    for b in m.boxes:
        if not b.visible:
            continue
        col = b.meta.get("color") or [163, 162, 165]
        glow = b.meta.get("themeRole") == "accent_glow" or \
            b.meta.get("material") == "Neon"
        for pts, n in faces_of(b):
            cen = [sum(p[i] for p in pts) / len(pts) for i in range(3)]
            if _dot(n, _sub(cen, cam.eye)) > 0:
                continue                       # backface
            clipped = cam.clip_near(pts)
            if len(clipped) < 3:
                continue
            pr = [cam.project(p) for p in clipped]
            if any(q is None for q in pr):
                continue
            z = sum(q[2] for q in pr) / len(pr)
            lam = max(0.0, -_dot(n, sun))
            shade = 0.30 + 0.70 * lam
            if n[1] > 0.5:
                shade = min(1.25, shade * 1.16)   # tops catch the sky
            if glow:
                shade = 1.30
            c = [max(0, min(255, int(col[i] * shade))) for i in range(3)]
            if fog:
                ff = 1.0 - math.exp(-fog * z)
                horizon = sky_bot
                c = [int(c[i] + (horizon[i] - c[i]) * ff * 0.85) for i in range(3)]
            polys.append((z, [(q[0], q[1]) for q in pr], tuple(c)))

    polys.sort(key=lambda p: -p[0])
    for _, pts, c in polys:
        d.polygon(pts, fill=c)

    img.save(out)
    return out, len(polys)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render a map spec to a PNG, no Studio.")
    ap.add_argument("spec")
    ap.add_argument("-o", "--out", default="look.png")
    ap.add_argument("--eye", nargs=3, type=float)
    ap.add_argument("--look", nargs=3, type=float)
    ap.add_argument("--fov", type=float, default=55.0)
    ap.add_argument("-W", type=int, default=1400)
    ap.add_argument("-H", type=int, default=900)
    a = ap.parse_args(argv)

    m = specmod.load(a.spec)
    th = thememod.load(m.source.get("theme", "sky_citadel"))
    path, n = render(m, th, a.out, a.W, a.H,
                     tuple(a.eye) if a.eye else None,
                     tuple(a.look) if a.look else None, a.fov)
    print(f"wrote {path}  ({n} faces from {len(m.boxes)} parts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
