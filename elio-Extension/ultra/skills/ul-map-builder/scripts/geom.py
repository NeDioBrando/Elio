"""Geometry primitives for ul-map-builder.

Everything here is yaw-only: Roblox greybox geometry is overwhelmingly
axis-aligned or rotated about Y, and supporting arbitrary rotation would buy
nothing but a harder SAT. A box with yaw % 90 == 0 is an AABB and takes the
fast path.

Coordinate convention is Roblox's: +Y is up, sizes are full extents (not
half-extents), and a part's Position is its CENTRE.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

EPS = 1e-6


# --------------------------------------------------------------------------
# vectors (plain tuples; numpy is overkill at this scale and hurts clarity)
# --------------------------------------------------------------------------

def vadd(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vmul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vlen(a):
    return math.sqrt(vdot(a, a))


def vdist(a, b):
    return vlen(vsub(a, b))


def vnorm(a):
    n = vlen(a)
    return (0.0, 0.0, 0.0) if n < EPS else (a[0] / n, a[1] / n, a[2] / n)


def vlerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


# --------------------------------------------------------------------------
# boxes
# --------------------------------------------------------------------------

@dataclass
class Box:
    """A yaw-rotated box. `yaw` is degrees about +Y, matching Roblox's
    CFrame.Angles(0, math.rad(yaw), 0)."""

    name: str
    centre: tuple
    size: tuple
    yaw: float = 0.0
    # A wedge's top surface is a ramp rather than a flat face. `ramp_axis` is
    # the LOCAL axis the surface rises along: "+x", "-x", "+z" or "-z".
    # `None` means an ordinary box.
    ramp_axis: str | None = None
    solid: bool = True          # CanCollide
    visible: bool = True        # Transparency < 1
    roles: list = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    # -- basis ------------------------------------------------------------

    @property
    def axis_aligned(self) -> bool:
        return abs(self.yaw % 90.0) < 1e-9

    @property
    def half(self):
        return (self.size[0] / 2.0, self.size[1] / 2.0, self.size[2] / 2.0)

    def _basis(self):
        r = math.radians(self.yaw)
        c, s = math.cos(r), math.sin(r)
        # right, up, forward in world space
        return ((c, 0.0, -s), (0.0, 1.0, 0.0), (s, 0.0, c))

    def to_local(self, p):
        d = vsub(p, self.centre)
        rx, ry, rz = self._basis()
        return (vdot(d, rx), vdot(d, ry), vdot(d, rz))

    def to_world(self, p):
        rx, ry, rz = self._basis()
        return vadd(self.centre, vadd(vadd(vmul(rx, p[0]), vmul(ry, p[1])), vmul(rz, p[2])))

    # -- extents ----------------------------------------------------------

    def aabb(self):
        """World-space axis-aligned bounds. Exact for yaw%90==0, conservative
        otherwise, which is all any broadphase needs."""
        hx, hy, hz = self.half
        if self.axis_aligned:
            if abs((self.yaw / 90.0) % 2.0 - 1.0) < 1e-9:  # 90 or 270
                hx, hz = hz, hx
            return (
                (self.centre[0] - hx, self.centre[1] - hy, self.centre[2] - hz),
                (self.centre[0] + hx, self.centre[1] + hy, self.centre[2] + hz),
            )
        r = math.radians(self.yaw)
        c, s = abs(math.cos(r)), abs(math.sin(r))
        ex = hx * c + hz * s
        ez = hx * s + hz * c
        return (
            (self.centre[0] - ex, self.centre[1] - hy, self.centre[2] - ez),
            (self.centre[0] + ex, self.centre[1] + hy, self.centre[2] + ez),
        )

    @property
    def top(self):
        return self.centre[1] + self.half[1]

    @property
    def bottom(self):
        return self.centre[1] - self.half[1]

    def contains(self, p, pad=0.0) -> bool:
        lx, ly, lz = self.to_local(p)
        hx, hy, hz = self.half
        inside_box = (abs(lx) <= hx + pad + EPS
                      and abs(ly) <= hy + pad + EPS
                      and abs(lz) <= hz + pad + EPS)
        if not inside_box or self.ramp_axis is None:
            return inside_box
        # A WEDGE DOES NOT OCCUPY THE AIR ABOVE ITS SLOPE, and treating it as if
        # it does is not a conservative approximation - it is a wrong answer that
        # deletes real standable surface.
        #
        # Measured on a farm map: the ground beside a climbing road
        # is a wedge whose BOX spans from the verge up to the top of the climb.
        # The road's surface at the low end of that same segment sits inside
        # that box, so _is_top_surface rejected every road node at the foot of
        # every ramp, opened an 18-stud hole in the node graph that the union
        # step could not bridge, and reported 45 of 65 road segments unreachable
        # on a route whose surface is continuous to within 0.27 studs. Bisecting
        # showed it exactly: road alone PASSES, road plus ground FAILS, and no
        # sampling resolution helps because the nodes are rejected rather than
        # missed.
        #
        # surface_height() already models the ramp correctly. This makes
        # contains() agree with it instead of contradicting it.
        return p[1] <= self.surface_height(p[0], p[2]) + pad + EPS

    # -- walkable surface -------------------------------------------------

    def surface_height(self, x, z):
        """Height of the walkable top surface directly above (x, z), or None
        if (x, z) is outside the footprint."""
        lx, ly, lz = self.to_local((x, self.centre[1], z))
        hx, hy, hz = self.half
        if abs(lx) > hx + EPS or abs(lz) > hz + EPS:
            return None
        if self.ramp_axis is None:
            return self.top
        # Ramp: rises linearly from the bottom of the box to its top along the
        # named local axis. t runs 0 (low edge) to 1 (high edge).
        sign = 1.0 if self.ramp_axis[0] == "+" else -1.0
        coord = lx if self.ramp_axis[1] == "x" else lz
        halfspan = hx if self.ramp_axis[1] == "x" else hz
        t = (sign * coord + halfspan) / (2.0 * halfspan)
        t = min(1.0, max(0.0, t))
        return self.bottom + self.size[1] * t

    def surface_slope_deg(self):
        """Angle of the walkable surface from horizontal."""
        if self.ramp_axis is None:
            return 0.0
        span = self.size[0] if self.ramp_axis[1] == "x" else self.size[2]
        return math.degrees(math.atan2(self.size[1], span))


# --------------------------------------------------------------------------
# overlap
# --------------------------------------------------------------------------

def aabb_overlap(a: Box, b: Box, tol=0.0) -> bool:
    (alo, ahi), (blo, bhi) = a.aabb(), b.aabb()
    for i in range(3):
        if ahi[i] <= blo[i] + tol or bhi[i] <= alo[i] + tol:
            return False
    return True


def _sat_axes(a: Box, b: Box):
    ax, _, az = a._basis()
    bx, _, bz = b._basis()
    return [ax, az, bx, bz]


def boxes_overlap(a: Box, b: Box, tol=0.0) -> bool:
    """True if the two boxes interpenetrate by more than `tol`.

    Touching faces are NOT an overlap, which matters: greybox parts are meant
    to sit flush against each other.
    """
    if not aabb_overlap(a, b, tol):
        return False
    # Y is a separating axis candidate on its own (yaw-only rotation).
    if a.top <= b.bottom + tol or b.top <= a.bottom + tol:
        return False
    if a.axis_aligned and b.axis_aligned:
        return True  # AABB test above already settled X and Z
    for axis in _sat_axes(a, b):
        ra = _project_radius(a, axis)
        rb = _project_radius(b, axis)
        d = abs(vdot(vsub(b.centre, a.centre), axis))
        if d >= ra + rb - tol:
            return False
    return True


def _project_radius(box: Box, axis):
    rx, _, rz = box._basis()
    hx, _, hz = box.half
    return hx * abs(vdot(rx, axis)) + hz * abs(vdot(rz, axis))


def penetration_depth(a: Box, b: Box) -> float:
    """Smallest overlap across the separating-axis candidates. Only meaningful
    when boxes_overlap() is True."""
    if not boxes_overlap(a, b):
        return 0.0
    depths = [min(a.top, b.top) - max(a.bottom, b.bottom)]
    for axis in _sat_axes(a, b):
        ra = _project_radius(a, axis)
        rb = _project_radius(b, axis)
        d = abs(vdot(vsub(b.centre, a.centre), axis))
        depths.append(ra + rb - d)
    return max(0.0, min(depths))


# --------------------------------------------------------------------------
# raycast
# --------------------------------------------------------------------------

@dataclass
class Hit:
    box: Box
    t: float
    point: tuple


def ray_box(origin, direction, box: Box, tmax=math.inf):
    """Slab test in the box's local frame. `direction` need not be normalised;
    `t` is returned in units of `direction`."""
    o = box.to_local(origin)
    rx, ry, rz = box._basis()
    d = (vdot(direction, rx), vdot(direction, ry), vdot(direction, rz))
    h = box.half
    t0, t1 = 0.0, tmax
    for i in range(3):
        if abs(d[i]) < EPS:
            if abs(o[i]) > h[i]:
                return None
            continue
        inv = 1.0 / d[i]
        ta = (-h[i] - o[i]) * inv
        tb = (h[i] - o[i]) * inv
        if ta > tb:
            ta, tb = tb, ta
        t0 = max(t0, ta)
        t1 = min(t1, tb)
        if t0 > t1:
            return None
    if box.ramp_axis is None:
        t = t0 if t0 > EPS else t1
        if t < EPS or t > tmax:
            return None
        return Hit(box, t, vadd(origin, vmul(direction, t)))

    # A RAMP FILLS ONLY THE PART OF ITS BOX UNDER THE SLOPE. The slab test above
    # finds where the ray crosses the BOUNDING box, which for a wedge includes
    # the empty air above the incline - so a ray that never touches the wedge
    # still reported a hit.
    #
    # This is the same wrong assumption as the old contains(), and it bit in a
    # second place: _has_headroom raycasts straight up from the road surface, and
    # at the foot of every climb the ground wedge's BOX extends overhead. Every
    # road node there was rejected for having no headroom, under open sky. The
    # count scaled exactly with the rise - 0 rejections on a flat segment, 9 at a
    # 1-stud rise, 17 at 2 studs - which is what identified it.
    #
    # March the in-box span and take the first point genuinely inside the wedge.
    lo_t = max(t0, EPS)
    hi_t = min(t1, tmax)
    if hi_t <= lo_t:
        return None
    STEPS = 24
    for k in range(STEPS + 1):
        t = lo_t + (hi_t - lo_t) * (k / STEPS)
        p = vadd(origin, vmul(direction, t))
        if box.contains(p, pad=EPS):
            return Hit(box, t, p)
    return None


def raycast(origin, direction, boxes, tmax=math.inf, ignore=(), solid_only=True):
    """Nearest hit along the ray, or None."""
    best = None
    for b in boxes:
        if b.name in ignore or b is None:
            continue
        if solid_only and not b.solid:
            continue
        h = ray_box(origin, direction, b, tmax)
        if h and (best is None or h.t < best.t):
            best = h
    return best


def segment_blocked(a, b, boxes, ignore=(), pad=0.0) -> Hit | None:
    """Is the straight line a->b obstructed? `pad` shortens the segment at both
    ends so a ray starting on a surface does not hit the surface it starts on."""
    d = vsub(b, a)
    L = vlen(d)
    if L < EPS:
        return None
    u = vmul(d, 1.0 / L)
    start = vadd(a, vmul(u, pad))
    span = L - 2 * pad
    if span <= 0:
        return None
    return raycast(start, u, boxes, tmax=span, ignore=ignore)


# --------------------------------------------------------------------------
# spatial index
# --------------------------------------------------------------------------

class BoxIndex:
    """XZ grid over box footprints.

    Every surface test used to scan every box in the map. That is fine for a 14
    part greybox and quadratic for a 600 part dressed one: node extraction alone
    took 30s on a dressed sky map. Bucketing by footprint makes the same tests local.
    """

    def __init__(self, boxes, cell=16.0):
        self.cell = cell
        self.grid = {}
        self.all = list(boxes)
        for b in boxes:
            lo, hi = b.aabb()
            for cx in range(int(math.floor(lo[0] / cell)), int(math.floor(hi[0] / cell)) + 1):
                for cz in range(int(math.floor(lo[2] / cell)), int(math.floor(hi[2] / cell)) + 1):
                    self.grid.setdefault((cx, cz), []).append(b)

    def at(self, x, z):
        return self.grid.get((int(math.floor(x / self.cell)),
                              int(math.floor(z / self.cell))), ())

    def near(self, x, z, radius=0.0):
        c = self.cell
        x0, x1 = int(math.floor((x - radius) / c)), int(math.floor((x + radius) / c))
        z0, z1 = int(math.floor((z - radius) / c)), int(math.floor((z + radius) / c))
        out, seen = [], set()
        for cx in range(x0, x1 + 1):
            for cz in range(z0, z1 + 1):
                for b in self.grid.get((cx, cz), ()):
                    if id(b) not in seen:
                        seen.add(id(b))
                        out.append(b)
        return out

    def segment(self, a, b):
        """Boxes whose cells the segment a->b passes over."""
        c = self.cell
        n = max(2, int(vlen(vsub(b, a)) / c) + 2)
        out, seen = [], set()
        for i in range(n + 1):
            t = i / n
            x = a[0] + (b[0] - a[0]) * t
            z = a[2] + (b[2] - a[2]) * t
            for cx in (-1, 0, 1):
                for cz in (-1, 0, 1):
                    key = (int(math.floor(x / c)) + cx, int(math.floor(z / c)) + cz)
                    for box in self.grid.get(key, ()):
                        if id(box) not in seen:
                            seen.add(id(box))
                            out.append(box)
        return out
