"""The lake outline. Written once, used by everything that touches water.

THREE PLACES NEED THIS SHAPE and they kept disagreeing:

  - build.lua fills it with terrain cylinders
  - the pond kit dresses its bank with rocks and bushes
  - P14 checks that nothing is standing in it

When the first two each carried their own copy of the constants they disagreed
twice in one afternoon. The bank went in at 0.43-0.49 of the pond size while the
water reached 0.51, so every rock sank. Then the builder ignored the pond's yaw
while the kit applied it, and on a lobed outline a 12 degree disagreement sinks
the props on one side and strips the bank bare on the other.

Neither fault errored, and neither was visible from directly above. Both were
found by looking at a screenshot from a low angle, which is not a verification
strategy.

build.lua cannot import Python, so it carries the only other copy - kept honest
by RING_C/RING_R/RING_N being named identically in both files and by P14, which
fails if the two ever drift apart again.
"""

from __future__ import annotations

import math

RING_C = 0.62      # ring centre, as a fraction of the pond's half-extent
RING_R = 0.40      # disc radius, as a fraction of the smaller half-extent
RING_N = 26        # discs around the ring
CORE_R = 0.80      # the filled centre, as a fraction of the smaller half-extent


def wobble(a, lobes):
    """The lobed radius multiplier at angle `a`. Two harmonics, so the outline
    is irregular rather than a flower - a lake with N identical bays reads as
    procedural, which is exactly what it is and exactly what it must not look
    like."""
    return (1.0 + 0.17 * math.sin(a * lobes + 0.7)
            + 0.09 * math.sin(a * (lobes + 2) + 2.1))


def discs(cx, cz, sx, sz, yaw=0.0, lobes=7):
    """Every (x, z, radius) disc that makes up one water body, in world space.

    `sx`/`sz` are the FULL size of the water marker, matching what the payload
    sends the builder as p[2]/p[4].
    """
    rx, rz = sx / 2.0, sz / 2.0
    lobes = max(3, int(lobes))
    yr = math.radians(yaw)
    yc, ys = math.cos(yr), math.sin(yr)
    out = []
    for i in range(RING_N):
        a = (i / RING_N) * math.pi * 2
        w = wobble(a, lobes)
        ox = math.cos(a) * rx * RING_C * w
        oz = math.sin(a) * rz * RING_C * w
        out.append((cx + ox * yc + oz * ys, cz - ox * ys + oz * yc,
                    min(rx, rz) * RING_R * w))
    out.append((cx, cz, min(rx, rz) * CORE_R))
    return out


def in_water(px, pz, ds, margin=0.0):
    """Is this point inside the water, allowing for a dry margin?"""
    for dx, dz, r in ds:
        rr = r + margin
        if (px - dx) ** 2 + (pz - dz) ** 2 < rr * rr:
            return True
    return False


def bank_point(px, pz, cx, cz, ds, margin, step=1.5, limit=60):
    """Push a point radially outward until it clears the water by `margin`.

    Rejection-sampling rather than arithmetic. The bank was first placed by
    computing where the waterline "should" be, which is how it ended up under
    the water twice: adjacent discs overlap and bulge outward between the
    sampled angles, so the true edge is always a little further out than the
    formula for a single disc says. Marching out until the point is actually
    clear cannot be wrong about that.
    """
    dx, dz = px - cx, pz - cz
    d = math.hypot(dx, dz)
    if d < 1e-6:
        return px, pz
    ux, uz = dx / d, dz / d
    for _ in range(limit):
        if not in_water(px, pz, ds, margin):
            return px, pz
        px += ux * step
        pz += uz * step
    return px, pz


# Assets that BELONG in the water. Both the scatter prune and P14 need this
# list, and they must agree: the prune stripped every lilypad off the lake the
# moment water started blocking props, and P14 - carrying its own copy of the
# exemption - reported the now-empty lake as passing.
FLOATS = ("lilypad", "boat", "buoy", "duck", "raft")


def floats(name):
    n = name.lower()
    return any(f in n for f in FLOATS)
