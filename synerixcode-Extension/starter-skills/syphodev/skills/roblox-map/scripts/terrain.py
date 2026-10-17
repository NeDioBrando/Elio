"""Organic terrain, headless: heightfield + surface materials + caves.

    python scripts/terrain.py <spec> [--out work/terrain/<name>]

WHY THIS EXISTS. For its whole life this skill built ground out of Part slabs,
and SKILL.md said in bold that "a ground plane level for more than 120 studs is
a bug". Nothing enforced it, and three maps in a row were rejected as far too
blocky and far too dead. Prose does not stop a flat map. This module makes the
ground ROBLOX SMOOTH VOXEL TERRAIN generated from a heightfield, and
checks_terrain.py FAILS a map whose ground is flat or rectangular.

THE MODEL. One heightfield on the 4-stud voxel grid, composed from LANDFORMS.
Every landform is a SHAPE (a lobed ellipse or a polyline) that yields a signed
distance `s` in studs (positive inside), a PROFILE that maps `s` to a height,
and an OP that merges it:

    smax     land that rises out of what is there (islands, plateaus, ridges)
    smin     ground cut into what is there (harbour basins, trenches)
    set      ground forced to a height with a blend band (tidal shelves)
    terrace  heights inside the shape quantised into stylised steps

A profile is a list of [s, height] control points, so a beach and a cliff are
the same shape with different numbers: a beach rises 20 studs over 60, a cliff
80 studs over 8. Coastlines are domain-warped and lobed so no edge is an arc or
a line, and every landform adds its own roughness.

PADS (flat building footprints) and PATHS (graded routes) are the only
deliberately flat ground, and both are recorded as masks so the flatness check
can tell a designed plaza from an accidental plain.

CAVES are 3D polylines with a radius. A heightfield cannot overhang, so caves
are carved in Studio (Terrain:FillBall with Air along the path); here they are
recorded, drawn on the preview and proven by checks_terrain.py.

OUTPUT (all from one spec, so the preview cannot drift from what ships):
    height.npy     float32 [nz, nx]  surface height in studs (lift NOT applied)
    material.npy   uint8   [nz, nx]  index into terrain.json "materials"
    masks.npz      pad (int16 pad id + 1, 0 = none), path (bool)
    terrain.json   grid, tides, materials, pads, paths, caves, zones, gates
    preview.png    materials + hillshade + contours + tide bands + labels
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys

import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)

VOXEL = 4.0

# Roblox Terrain materials this module may paint. Order is the on-disk index.
MATERIALS = ["Grass", "Sand", "Rock", "Ground", "Cobblestone", "Mud", "Slate",
             "LeafyGrass", "Limestone", "Basalt", "Salt", "WoodPlanks"]
MAT = {n: i for i, n in enumerate(MATERIALS)}

PREVIEW_RGB = {
    "Grass": (74, 170, 52), "Sand": (214, 196, 140), "Rock": (112, 128, 160),
    "Ground": (138, 108, 84), "Cobblestone": (126, 136, 168), "Mud": (96, 82, 70),
    "Slate": (96, 106, 136), "LeafyGrass": (58, 150, 60), "Limestone": (200, 196, 180),
    "Basalt": (70, 72, 84), "Salt": (230, 230, 226), "WoodPlanks": (130, 116, 128),
}


class TerrainError(Exception):
    pass


# --------------------------------------------------------------------------
# noise (not periodic: a map is not a tile)
# --------------------------------------------------------------------------

def _smooth(t):
    return t * t * (3 - 2 * t)


def value_noise(nz, nx, scale_cells, rng):
    scale_cells = max(scale_cells, 1.0)
    gz = int(math.ceil(nz / scale_cells)) + 2
    gx = int(math.ceil(nx / scale_cells)) + 2
    lat = rng.random((gz, gx)).astype(np.float32)
    zc = np.arange(nz, dtype=np.float32) / scale_cells
    xc = np.arange(nx, dtype=np.float32) / scale_cells
    z0, x0 = np.floor(zc).astype(int), np.floor(xc).astype(int)
    fz, fx = _smooth(zc - z0), _smooth(xc - x0)
    a = lat[z0][:, x0] * (1 - fx) + lat[z0][:, x0 + 1] * fx
    b = lat[z0 + 1][:, x0] * (1 - fx) + lat[z0 + 1][:, x0 + 1] * fx
    return a * (1 - fz)[:, None] + b * fz[:, None]


def fbm(nz, nx, scale_cells, octaves, rng, gain=0.5):
    """Roughly zero-mean, amplitude about 1."""
    out = np.zeros((nz, nx), np.float32)
    amp = total = 1.0
    total = 0.0
    s = scale_cells
    for _ in range(octaves):
        out += amp * (value_noise(nz, nx, s, rng) * 2 - 1)
        total += amp
        amp *= gain
        s = max(s / 2.0, 1.0)
    return out / total


def smax(a, b, k):
    if k <= 0:
        return np.maximum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.maximum(a, b) + h * h * k * 0.25


def smin(a, b, k):
    return -smax(-a, -b, k)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# grid
# --------------------------------------------------------------------------

class Grid:
    def __init__(self, cfg):
        size = cfg.get("size")
        if not size or len(size) != 2:
            raise TerrainError("terrain.size [width, depth] in studs is required")
        self.w, self.d = float(size[0]), float(size[1])
        if self.w % VOXEL or self.d % VOXEL:
            raise TerrainError(f"terrain.size must be multiples of {VOXEL:.0f} (the voxel grid)")
        self.nx, self.nz = int(self.w / VOXEL), int(self.d / VOXEL)
        self.x0, self.z0 = -self.w / 2.0, -self.d / 2.0
        xs = self.x0 + (np.arange(self.nx, dtype=np.float32) + 0.5) * VOXEL
        zs = self.z0 + (np.arange(self.nz, dtype=np.float32) + 0.5) * VOXEL
        self.X, self.Z = np.meshgrid(xs, zs)

    def cell_of(self, x, z):
        return (int(np.clip((z - self.z0) // VOXEL, 0, self.nz - 1)),
                int(np.clip((x - self.x0) // VOXEL, 0, self.nx - 1)))


# --------------------------------------------------------------------------
# shapes -> signed distance in studs (positive inside)
# --------------------------------------------------------------------------

def _warp(grid, amount, seed):
    if amount <= 0:
        return 0.0, 0.0
    rng = np.random.default_rng(seed)
    sc = max(amount * 2.5 / VOXEL, 4.0)
    return (fbm(grid.nz, grid.nx, sc, 4, rng) * amount,
            fbm(grid.nz, grid.nx, sc, 4, rng) * amount)


def sd_ellipse(grid, lf, seed):
    cx, cz = lf["center"]
    rad = lf["radius"]
    rx, rz = (rad, rad) if isinstance(rad, (int, float)) else rad
    yaw = math.radians(lf.get("yaw", 0.0))
    warp = lf.get("warp", 0.12 * min(rx, rz))
    wx, wz = _warp(grid, warp, seed)
    dx, dz = grid.X - cx + wx, grid.Z - cz + wz
    c, s = math.cos(yaw), math.sin(yaw)
    lx, lz = dx * c + dz * s, -dx * s + dz * c
    theta = np.arctan2(lz / rz, lx / rx)
    lobes = lf.get("lobes", 5)
    amp = lf.get("lobeAmp", 0.10)
    ph = (seed % 628) / 100.0
    lobe = 1.0 + amp * np.sin(theta * lobes + ph) + 0.5 * amp * np.sin(theta * (lobes + 2) + 2.1 * ph)
    r_ang = (rx * rz) / np.sqrt((rz * np.cos(theta)) ** 2 + (rx * np.sin(theta)) ** 2)
    d = np.sqrt((lx / rx) ** 2 + (lz / rz) ** 2) / lobe
    return (1.0 - d) * r_ang * lobe


def _segment_distance(grid, pts):
    best = np.full((grid.nz, grid.nx), np.inf, np.float32)
    tpar = np.zeros_like(best)
    seg_of = np.zeros(best.shape, np.int32)
    for i in range(len(pts) - 1):
        ax, az = pts[i]
        bx, bz = pts[i + 1]
        vx, vz = bx - ax, bz - az
        ll = vx * vx + vz * vz or 1e-6
        t = np.clip(((grid.X - ax) * vx + (grid.Z - az) * vz) / ll, 0, 1)
        px, pz = ax + t * vx, az + t * vz
        d = np.sqrt((grid.X - px) ** 2 + (grid.Z - pz) ** 2)
        closer = d < best
        best = np.where(closer, d, best)
        tpar = np.where(closer, t, tpar)
        seg_of = np.where(closer, i, seg_of)
    return best, seg_of, tpar


def sd_polyline(grid, lf, seed):
    pts = lf["points"]
    width = lf.get("width", 60.0)
    warp = lf.get("warp", 0.2 * width)
    wx, wz = _warp(grid, warp, seed)
    X0, Z0 = grid.X, grid.Z
    grid.X, grid.Z = X0 + wx, Z0 + wz
    try:
        d, _, _ = _segment_distance(grid, pts)
    finally:
        grid.X, grid.Z = X0, Z0
    return width - d


SHAPES = {"ellipse": sd_ellipse, "polyline": sd_polyline}


def profile_height(s, prof):
    prof = sorted(prof, key=lambda p: p[0])
    xs = np.array([p[0] for p in prof], np.float32)
    ys = np.array([p[1] for p in prof], np.float32)
    return np.interp(s, xs, ys).astype(np.float32)


# --------------------------------------------------------------------------
# composition
# --------------------------------------------------------------------------

def _shape_of(lf):
    if "points" in lf:
        return "polyline"
    if "center" in lf and "radius" in lf:
        return "ellipse"
    raise TerrainError(f"landform {lf.get('name', '?')} needs center+radius or points")


def compose(cfg, grid):
    seed = int(cfg.get("seed", 1))
    rng = np.random.default_rng(seed)
    floor = float(cfg.get("seaFloor", -40.0))
    h = floor + fbm(grid.nz, grid.nx, 60, 4, rng) * float(cfg.get("seaFloorRough", 6.0))
    names = []
    for i, lf in enumerate(cfg.get("landforms", [])):
        name = lf.get("name") or f"landform{i}"
        names.append(name)
        op = lf.get("op", "smax")
        s = SHAPES[_shape_of(lf)](grid, lf, seed * 7919 + i * 104729)
        if op == "terrace":
            step = float(lf.get("step", 16.0))
            sharp = float(lf.get("sharpness", 0.35))
            k = np.floor(h / step)
            frac = h / step - k
            stepped = (k + smoothstep(1.0 - sharp, 1.0, frac)) * step
            w = smoothstep(0.0, float(lf.get("blend", 24.0)), s)
            h = h * (1 - w) + stepped * w
            continue
        if "profile" not in lf:
            raise TerrainError(f"landform {name} ({op}) needs a profile [[s, height], ...]")
        lh = profile_height(s, lf["profile"])
        # OUTSIDE THE FIRST CONTROL POINT A LANDFORM DOES NOT EXIST. np.interp
        # clamps, so a mesa profile starting [0, 90] returned 90 for every
        # column on the map and `smax` lifted the entire sea to 90 studs -
        # measured on the first smoke run: 95% land, corners at 46.
        first = min(p[0] for p in lf["profile"])
        if op == "smax":
            lh = np.where(s < first, -1e4, lh)
        elif op == "smin":
            lh = np.where(s < first, 1e4, lh)
        rough = float(lf.get("rough", 4.0))
        if rough > 0:
            nrng = np.random.default_rng(seed * 31 + i)
            inland = smoothstep(0.0, float(lf.get("roughRamp", 60.0)), s)
            lh = lh + fbm(grid.nz, grid.nx, lf.get("roughScale", 18.0), 4, nrng) * rough * inland
        k = float(lf.get("blend", 10.0))
        if op == "smax":
            h = smax(h, lh, k)
        elif op == "smin":
            inside = s > -k
            h = np.where(inside, smin(h, lh, k), h)
        elif op == "set":
            w = smoothstep(0.0, k, s)
            h = h * (1 - w) + lh * w
        else:
            raise TerrainError(f"landform {name}: unknown op {op!r}")

    # soften voxel aliasing, then a small detail pass on GENTLE land only.
    # Detail noise on a cliff is meshed by Roblox at 4-stud voxels into a field
    # of tiny triangles - measured in Studio as cliffs that read as crushed
    # crystal rather than as big clean rock planes. So steep ground is smoothed
    # instead of roughened; if you want faceted cliffs, cover them with your
    # own cliff models.
    h = ndimage.gaussian_filter(h, sigma=float(cfg.get("smooth", 0.7)))
    gz_, gx_ = np.gradient(h, VOXEL)
    steep = smoothstep(28.0, 40.0, np.degrees(np.arctan(np.hypot(gx_, gz_))))
    detail = fbm(grid.nz, grid.nx, 5, 3, np.random.default_rng(seed + 99)) * float(cfg.get("detail", 1.2))
    h = h + detail * (h > float(cfg.get("tide", {}).get("low", 0.0))) * (1.0 - steep)
    smooth_cliffs = ndimage.gaussian_filter(h, sigma=float(cfg.get("cliffSmooth", 1.6)))
    h = h * (1.0 - steep) + smooth_cliffs * steep
    return h.astype(np.float32), names


def apply_pads(cfg, grid, h):
    pad = np.zeros(h.shape, np.int16)
    info = []
    for i, p in enumerate(cfg.get("pads", [])):
        cx, cz = p["center"]
        r = float(p["radius"])
        blend = float(p.get("blend", 16.0))
        d = np.sqrt((grid.X - cx) ** 2 + (grid.Z - cz) ** 2)
        inside = d <= r
        if not inside.any():
            raise TerrainError(f"pad {p.get('name', i)} lies outside the terrain")
        target = float(p["height"]) if "height" in p else float(np.median(h[inside]))
        w = 1.0 - smoothstep(r, r + blend, d)
        h[:] = h * (1 - w) + target * w
        pad[inside] = i + 1
        info.append({"name": p.get("name", f"pad{i}"), "center": [cx, cz], "radius": r,
                     "height": round(target, 2), "reason": p.get("reason", "")})
    return pad, info


def apply_paths(cfg, grid, h, max_grade_deg):
    mask = np.zeros(h.shape, bool)
    info = []
    for i, p in enumerate(cfg.get("paths", [])):
        # A ROAD IS A CURVE. Straight segments between control points rendered as
        # ruler lines across the first preview. Chaikin corner-cutting rounds every
        # bend while keeping both end points exactly where the spec put them.
        pts = [list(q) for q in p["points"]]
        for _ in range(int(p.get("smoothing", 3))):
            if len(pts) < 3:
                break
            out = [pts[0]]
            for a, b in zip(pts, pts[1:]):
                out.append([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
                out.append([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
            out.append(pts[-1])
            pts = out
        width = float(p.get("width", 12.0))
        bank = float(p.get("bank", 8.0))
        grade = math.tan(math.radians(float(p.get("maxGrade", max_grade_deg))))
        # sample the ground along the path, smooth it, then enforce the grade
        dense = []
        for a, b in zip(pts, pts[1:]):
            n = max(2, int(math.dist(a, b) / VOXEL))
            for k in range(n):
                t = k / n
                dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        dense.append(tuple(pts[-1]))
        ys = np.array([h[grid.cell_of(x, z)] for x, z in dense], np.float32)
        if "heights" in p:
            ys = np.interp(np.linspace(0, 1, len(ys)), np.linspace(0, 1, len(p["heights"])),
                           np.array(p["heights"], np.float32))
        raw_ends = (float(ys[0]), float(ys[-1]))
        ys = ndimage.uniform_filter1d(ys, size=max(3, int(40 / VOXEL)), mode="nearest")
        # PIN THE ENDS TO THE REAL GROUND. Smoothing averaged the last 40 studs of
        # a castle road across a cliff edge and pulled its end down to 142
        # while the courtyard it arrives in sits at 199 - the road cut a 57-stud
        # trench into the bailey. Every check passed; a height sample found it.
        ys[0], ys[-1] = raw_ends
        step = VOXEL
        run = step * (len(ys) - 1)
        if abs(raw_ends[1] - raw_ends[0]) > grade * run:
            raise TerrainError(
                f"path {p.get('name', i)} rises {abs(raw_ends[1] - raw_ends[0]):.0f} studs over "
                f"{run:.0f} studs of road - steeper than its {p.get('maxGrade', max_grade_deg)} degree "
                f"grade even as a straight ramp. Add switchback points.")
        # GRADE-LIMIT WITH TWO ENVELOPES, NOT AN AVERAGING LOOP. The loop that was
        # here averaged neighbours for 12 iterations; spreading a 127-stud castle
        # cliff into a ramp needs hundreds, so the road still climbed at 64
        # degrees exactly where the cliff was and T4 found the castle unreachable.
        # A is limited forward from the start (it would cut a trench), B backward
        # from the end (it would build an embankment). max(A, B) is still
        # grade-limited - the max of two Lipschitz profiles is Lipschitz - and it
        # prefers the embankment, so a road ramps UP to a cliff instead of
        # trenching into the plateau.
        g = grade * step
        A = ys.copy()
        for k in range(1, len(A)):
            A[k] = np.clip(A[k], A[k - 1] - g, A[k - 1] + g)
        B = ys.copy()
        for k in range(len(B) - 2, -1, -1):
            B[k] = np.clip(B[k], B[k + 1] - g, B[k + 1] + g)
        ys = np.maximum(A, B)
        # distance to the dense polyline and the target height at the nearest point
        d, seg, t = _segment_distance(grid, dense)
        target = ys[seg] * (1 - t) + ys[np.minimum(seg + 1, len(ys) - 1)] * t
        w = 1.0 - smoothstep(width / 2.0, width / 2.0 + bank, d)
        before = h.copy()
        h[:] = h * (1 - w) + target * w
        mask |= d <= width / 2.0
        # EARTHWORKS ARE RECORDED so T7 can refuse a road that is really a dam.
        # Grading a road straight up a 127-stud sea cliff built a 119-stud
        # embankment: walkable, proven, and absurd to look at.
        delta = h - before
        fz, fx = np.unravel_index(int(np.argmax(delta)), delta.shape)
        cz, cx = np.unravel_index(int(np.argmin(delta)), delta.shape)
        info.append({"name": p.get("name", f"path{i}"), "points": pts, "width": width,
                     "material": p.get("material", "Ground"),
                     "maxFill": round(float(delta.max()), 1),
                     "maxFillAt": [round(float(grid.X[fz, fx])), round(float(grid.Z[fz, fx]))],
                     "maxCut": round(float(-delta.min()), 1),
                     "maxCutAt": [round(float(grid.X[cz, cx])), round(float(grid.Z[cz, cx]))]})
    return mask, info


def slope_deg(h):
    gz, gx = np.gradient(h, VOXEL)
    return np.degrees(np.arctan(np.hypot(gx, gz))).astype(np.float32)


def paint(cfg, grid, h, pad, pads, path_mask, paths):
    tide = cfg.get("tide", {})
    low, high = float(tide.get("low", 28)), float(tide.get("high", 40))
    rules = cfg.get("materialRules", {})
    cliff = float(rules.get("cliffSlope", 42.0))
    beach_slope = float(rules.get("beachSlope", 22.0))
    sl = slope_deg(h)
    rng = np.random.default_rng(int(cfg.get("seed", 1)) + 5)
    patch = fbm(grid.nz, grid.nx, 22, 3, rng)

    m = np.full(h.shape, MAT["Grass"], np.uint8)
    # No LeafyGrass by default: it renders Roblox's own realistic texture, which
    # clashes with a stylised map, so every patch would read as off-style.
    if rules.get("leafyPatches"):
        m[patch > 0.42] = MAT["LeafyGrass"]
    # Dirt patches are opt-in. On by default they rendered in Studio as brown
    # mud stains scattered over every meadow. Bare earth belongs only where
    # people walk, which is what paths paint.
    if rules.get("dirtPatches"):
        m[patch < -0.55] = MAT["Ground"]
    beach = (h < high + float(rules.get("beachAbove", 5.0))) & (sl < beach_slope)
    m[beach] = MAT["Sand"]
    under = h < low - 2.0
    m[under] = MAT["Sand"]
    m[under & (h < low - float(rules.get("sandDepth", 30.0)))] = MAT["Rock"]
    m[sl >= cliff] = MAT["Rock"]
    for i, p in enumerate(cfg.get("pads", [])):
        if p.get("material"):
            m[pad == i + 1] = MAT[p["material"]]
    for zone in cfg.get("materialZones", []):
        d = np.sqrt((grid.X - zone["center"][0]) ** 2 + (grid.Z - zone["center"][1]) ** 2)
        sel = (d <= zone["radius"]) & (sl < cliff)
        if "above" in zone:
            sel &= h >= zone["above"]
        if "below" in zone:
            sel &= h <= zone["below"]
        m[sel] = MAT[zone["material"]]
    if paths:
        for p in paths:
            d, _, _ = _segment_distance(grid, p["points"])
            m[(d <= p["width"] / 2.0) & (sl < cliff)] = MAT[p["material"]]
    return m


# --------------------------------------------------------------------------
# preview
# --------------------------------------------------------------------------

def render_preview(path, grid, h, m, meta, scale=2):
    from PIL import Image, ImageDraw
    low, high = meta["tide"]["low"], meta["tide"]["high"]
    lut = np.array([PREVIEW_RGB[n] for n in MATERIALS], np.float32)
    rgb = lut[m]
    gz, gx = np.gradient(h, VOXEL)
    nrm = np.dstack([-gx, np.ones_like(h) * 1.0, -gz])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    light = np.array([-0.5, 0.75, -0.45], np.float32)
    light /= np.linalg.norm(light)
    shade = np.clip(nrm @ light, 0.25, 1.0)[..., None]
    rgb = rgb * (0.45 + 0.75 * shade)
    deep = h < low
    tidal = (h >= low) & (h < high)
    depth = np.clip((low - h) / 60.0, 0, 1)[..., None]
    water = np.array([40, 120, 200], np.float32) * (1 - depth) + np.array([14, 40, 96], np.float32) * depth
    rgb = np.where(deep[..., None], rgb * 0.25 + water * 0.75, rgb)
    rgb = np.where(tidal[..., None], rgb * 0.55 + np.array([90, 190, 200], np.float32) * 0.45, rgb)
    contour = (np.floor(h / 16.0) != np.floor(np.roll(h, 1, 0) / 16.0)) | \
              (np.floor(h / 16.0) != np.floor(np.roll(h, 1, 1) / 16.0))
    rgb[contour & (h > low)] *= 0.72
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)[::-1])  # +Z up the image
    img = img.resize((grid.nx * scale, grid.nz * scale), Image.NEAREST)
    dr = ImageDraw.Draw(img)

    def px(x, z):
        return ((x - grid.x0) / VOXEL * scale, (grid.nz - (z - grid.z0) / VOXEL) * scale)

    for p in meta["pads"]:
        cx, cz = px(*p["center"])
        r = p["radius"] / VOXEL * scale
        dr.ellipse([cx - r, cz - r, cx + r, cz + r], outline=(255, 255, 255), width=2)
    for c in meta["caves"]:
        dr.line([px(pt[0], pt[2]) for pt in c["points"]], fill=(255, 140, 20), width=4)
    for g in meta.get("tideGates", []):
        cx, cz = px(*g["center"])
        r = g["radius"] / VOXEL * scale
        dr.ellipse([cx - r, cz - r, cx + r, cz + r], outline=(255, 60, 60), width=3)
    for zn in meta["zones"]:
        cx, cz = px(*zn["center"])
        label = f"{zn['name']} [{zn.get('access', 'always')}]"
        dr.rectangle([cx - 3, cz - 3, cx + 3, cz + 3], fill=(255, 255, 0))
        dr.text((cx + 6, cz - 6), label, fill=(0, 0, 0))
        dr.text((cx + 5, cz - 7), label, fill=(255, 255, 255))
    img.save(path)


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def generate(spec, out_dir=None, preview=True):
    cfg = spec.get("terrain")
    if not cfg:
        raise TerrainError("spec has no terrain block")
    grid = Grid(cfg)
    tide = cfg.get("tide", {"low": 28, "high": 40})
    for k in ("low", "high"):
        if float(tide[k]) % VOXEL:
            raise TerrainError(f"tide.{k} must be a multiple of {VOXEL:.0f}: terrain water "
                               f"quantises to the voxel grid (SKILL.md, 'never let anything sit on y=0')")
    max_grade = float(cfg.get("maxGradeDeg", 24.0))
    h, names = compose(cfg, grid)
    pad, pads = apply_pads(cfg, grid, h)
    path_mask, paths = apply_paths(cfg, grid, h, max_grade)
    m = paint(cfg, grid, h, pad, pads, path_mask, paths)

    meta = {
        "name": spec.get("name", "map"),
        "grid": {"voxel": VOXEL, "nx": grid.nx, "nz": grid.nz, "x0": grid.x0, "z0": grid.z0},
        "tide": {"low": float(tide["low"]), "high": float(tide["high"]),
                 "periodSeconds": float(tide.get("periodSeconds", 480))},
        "seaFloor": float(cfg.get("seaFloor", -40.0)),
        "materials": MATERIALS,
        "landforms": names,
        "pads": pads,
        "paths": paths,
        "caves": cfg.get("caves", []),
        "zones": cfg.get("zones", []),
        "tideGates": cfg.get("tideGates", []),
        "spawn": cfg.get("spawn") or (spec.get("spawns") or [[0, 0, 0]])[0],
        "hash": hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:16],
        "stats": {
            "height_p5_p50_p95": [round(float(v), 1) for v in np.percentile(h, [5, 50, 95])],
            "land_fraction_high_tide": round(float((h >= tide["high"]).mean()), 3),
            "material_fraction": {MATERIALS[i]: round(float((m == i).mean()), 3)
                                  for i in range(len(MATERIALS)) if (m == i).any()},
        },
    }
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        np.save(os.path.join(out_dir, "height.npy"), h)
        np.save(os.path.join(out_dir, "material.npy"), m)
        np.savez_compressed(os.path.join(out_dir, "masks.npz"), pad=pad, path=path_mask)
        with open(os.path.join(out_dir, "terrain.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=1)
        if preview:
            render_preview(os.path.join(out_dir, "preview.png"), grid, h, m, meta)
    return {"grid": grid, "height": h, "material": m, "pad": pad, "path": path_mask, "meta": meta}


def load_output(out_dir):
    with open(os.path.join(out_dir, "terrain.json"), encoding="utf-8") as f:
        meta = json.load(f)
    masks = np.load(os.path.join(out_dir, "masks.npz"))
    return {"height": np.load(os.path.join(out_dir, "height.npy")),
            "material": np.load(os.path.join(out_dir, "material.npy")),
            "pad": masks["pad"], "path": masks["path"], "meta": meta}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Generate organic terrain from a spec's terrain block.")
    ap.add_argument("spec")
    ap.add_argument("--out")
    ap.add_argument("--no-preview", action="store_true")
    a = ap.parse_args(argv)
    with open(a.spec, encoding="utf-8") as f:
        spec = json.load(f)
    out = a.out or os.path.join(SKILL, "work", "terrain", spec.get("name", "map"))
    t = generate(spec, out, preview=not a.no_preview)
    st = t["meta"]["stats"]
    print(f"terrain {t['meta']['name']}: {t['meta']['grid']['nx']}x{t['meta']['grid']['nz']} columns, "
          f"heights p5/p50/p95 {st['height_p5_p50_p95']}, land at high tide {st['land_fraction_high_tide']:.1%}")
    print("materials:", ", ".join(f"{k} {v:.1%}" for k, v in st["material_fraction"].items()))
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
