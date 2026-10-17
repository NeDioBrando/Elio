"""Terrain checks: the ground is organic, varied, and reachable exactly as declared.

    python scripts/checks_terrain.py --selftest

These exist because "terrain has height everywhere" was bold text in SKILL.md
for weeks while every map shipped on flat Part slabs. Each check is a property
a person reports at a glance - "it's flat", "it's blocky", "I can't get there",
"I got stuck when the tide came in" - turned into arithmetic on the heightfield.

T1 Flatness       no plain wider than 120 studs outside declared pads and paths
T2 Relief         real height range, and at least three distinct ground levels
T3 Boxiness       cliff faces must not line up with the X/Z axes (the fingerprint
                  of rectangular slabs and plateaus)
T4 Tides          every zone reachable (or not) as declared at LOW and HIGH tide,
                  and nobody is stranded when the tide comes in
T5 Caves          tunnels a character fits in, walkable grades, open to the surface
T6 Coast          both cliffs and beaches, not one monotone ring
T7 Earthworks     a road follows the land: no huge embankments or trenches
T8 Cliff cover    how much bare steep voxel cliff there is (WARN, not FAIL)
T9 Empty land     dry land has a prop nearby (INFO until the spec places props)
T10 Spawn         every spawn is on dry, gentle ground and not buried

Reachability is a directed graph on the 4-stud voxel columns: walking honours
the design slope, a drop is one-way, water is swimmable except where a TIDE GATE
blocks entry at high tide (built in Studio as an undertow volume). Everything is
computed with scipy's sparse graph search, so a 512x512 map proves in seconds.
"""

from __future__ import annotations

import math
import json
import os
import sys

import numpy as np
from scipy import ndimage
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import breadth_first_order

VOXEL = 4.0
GROUNDISH = {"arena_floor", "meadow", "yard", "ground", "high_ground", "landmark_base"}


def _cfg(spec):
    return (spec.get("terrain") or {}).get("checks", {})


def _slope_aspect(h):
    gz, gx = np.gradient(h, VOXEL)
    return np.degrees(np.arctan(np.hypot(gx, gz))), np.degrees(np.arctan2(gz, gx)) % 90.0


def _cell(meta, x, z):
    g = meta["grid"]
    return (int(np.clip((z - g["z0"]) // VOXEL, 0, g["nz"] - 1)),
            int(np.clip((x - g["x0"]) // VOXEL, 0, g["nx"] - 1)))


def _xz(meta, iz, ix):
    g = meta["grid"]
    return (round(g["x0"] + (ix + 0.5) * VOXEL), round(g["z0"] + (iz + 0.5) * VOXEL))


def _disc(meta, shape, center, radius):
    g = meta["grid"]
    zz, xx = np.mgrid[0:shape[0], 0:shape[1]]
    x = g["x0"] + (xx + 0.5) * VOXEL
    z = g["z0"] + (zz + 0.5) * VOXEL
    return (x - center[0]) ** 2 + (z - center[1]) ** 2 <= radius * radius


# --------------------------------------------------------------------------
# T1 flatness
# --------------------------------------------------------------------------

def t1_flatness(t, spec, C):
    cfg = _cfg(spec)
    h, meta = t["height"], t["meta"]
    high = meta["tide"]["high"]
    window = float(cfg.get("flatWindow", 120.0))
    tol = float(cfg.get("flatRelief", 4.0))
    max_frac = float(cfg.get("maxFlatFraction", 0.10))
    max_diam = float(cfg.get("maxFlatDiameter", 120.0))
    max_pad_frac = float(cfg.get("maxPadFraction", 0.25))

    land = h >= high + 1.0
    if land.sum() < 50:
        return C.Check("T1", "Flatness", C.FAIL, "almost no land above high tide")
    size = int(window / VOXEL) + 1
    relief = ndimage.maximum_filter(h, size=size) - ndimage.minimum_filter(h, size=size)
    designed = (t["pad"] > 0) | t["path"]
    flat = land & (relief < tol) & ~designed
    frac = flat.sum() / max(1, (land & ~designed).sum())
    lab, n = ndimage.label(flat)
    rows, worst = [], C.PASS
    if n:
        areas = ndimage.sum(flat, lab, index=np.arange(1, n + 1)) * VOXEL * VOXEL
        order = np.argsort(areas)[::-1]
        for k in order[:5]:
            diam = 2 * math.sqrt(areas[k] / math.pi)
            if diam <= max_diam:
                break
            iz, ix = [int(v) for v in ndimage.center_of_mass(flat, lab, k + 1)]
            rows.append(f"flat plain ~{diam:.0f} studs across at {_xz(meta, iz, ix)} "
                        f"(relief under {tol:.0f} studs in every {window:.0f}-stud window)")
            worst = C.FAIL
    if frac > max_frac:
        rows.append(f"{frac:.0%} of undesigned land is flat (budget {max_frac:.0%})")
        worst = C.FAIL
    pad_frac = (t["pad"] > 0).sum() / max(1, land.sum())
    if pad_frac > max_pad_frac:
        rows.append(f"pads cover {pad_frac:.0%} of the land (budget {max_pad_frac:.0%}) - "
                    f"a map made of pads is a flat map with extra steps")
        worst = C.FAIL
    for p in meta["pads"]:
        if p["radius"] > 70 and not p.get("reason"):
            rows.append(f"pad {p['name']} is {p['radius'] * 2:.0f} studs across with no stated reason")
            worst = C.FAIL
    detail = (f"{frac:.1%} of undesigned land flat, pads {pad_frac:.0%} of land"
              if worst == C.PASS else "the ground is too flat")
    return C.Check("T1", "Flatness", worst, detail, rows)


# --------------------------------------------------------------------------
# T2 relief
# --------------------------------------------------------------------------

def t2_relief(t, spec, C):
    cfg = _cfg(spec)
    h, meta = t["height"], t["meta"]
    land_mask = h >= meta["tide"]["high"] + 1.0
    land = h[land_mask]
    if land.size < 50:
        return C.Check("T2", "Relief", C.FAIL, "almost no land above high tide")
    p5, p95 = np.percentile(land, [5, 95])
    want = float(cfg.get("minRelief", 48.0))
    # A GROUND LEVEL IS A BAND OF GENTLE GROUND AT ONE HEIGHT. The first version
    # counted peaks in the histogram of ALL land heights, and failed a genuinely
    # varied island (beach, terraces, a 180-stud mesa) because a slope that rises
    # steadily has no histogram peak. What the eye reads as "levels" is where the
    # ground flattens out: beaches, shelves, terrace treads, plateau tops. So only
    # gentle columns count, and a level is a run of height bins holding enough of
    # them, separated from the next run by a gap.
    sl, _ = _slope_aspect(h)
    gentle = h[land_mask & (sl < float(cfg.get("levelSlope", 14.0)))]
    bin_w = 6.0
    need = int(cfg.get("minLevels", 3))
    levels = []
    if gentle.size:
        hist, edges = np.histogram(gentle, bins=np.arange(gentle.min(), gentle.max() + bin_w, bin_w))
        on = hist >= land.size * float(cfg.get("levelShare", 0.015))
        run = []
        for i, flag in enumerate(on):
            if flag:
                run.append(i)
            elif run:
                levels.append(round(float(edges[run[0]] + bin_w * len(run) / 2)))
                run = []
        if run:
            levels.append(round(float(edges[run[0]] + bin_w * len(run) / 2)))
    rows, worst = [], C.PASS
    if p95 - p5 < want:
        rows.append(f"land spans only {p95 - p5:.0f} studs (p5 {p5:.0f} to p95 {p95:.0f}), want {want:.0f}")
        worst = C.FAIL
    if len(levels) < need:
        rows.append(f"only {len(levels)} distinct ground level(s) {levels}, want {need} - "
                    f"the reference shots show three or four in every view")
        worst = C.FAIL
    return C.Check("T2", "Relief", worst,
                   f"land p5-p95 {p5:.0f}-{p95:.0f} studs, gentle ground levels at {levels}", rows)


# --------------------------------------------------------------------------
# T3 boxiness
# --------------------------------------------------------------------------

def t3_boxiness(t, spec, C):
    """Judge each cliff REGION, not the whole map.

    The first version averaged every steep column on the map, and a rectangular
    plateau stamped onto an organic island scored 22% - diluted below the limit
    by a coastline that was never the problem. A box is a local defect, so each
    connected steep region is judged on its own.
    """
    cfg = _cfg(spec)
    h, meta = t["height"], t["meta"]
    sl, asp = _slope_aspect(h)
    steep = (h >= meta["tide"]["low"] - 8) & (sl >= float(cfg.get("steepSlope", 35.0)))
    n = int(steep.sum())
    if n < 200:
        return C.Check("T3", "Boxiness", C.INFO, f"only {n} steep columns - nothing to judge")
    # A RECTANGLE IS FACES THAT ARE BOTH NEAR-AXIS AND CONCENTRATED, OVER A BIG
    # REGION. The second version failed an organic island on small cliff regions:
    # a short, naturally straight stretch of a round mesa has ONE aspect, and if
    # it happens to face north it is "100% axis-aligned". Direction is not
    # straightness. So: regions under `boxRegionCells` are not judged, and a
    # region fails only if most of its faces sit near an axis AND their aspects
    # (mod 90) are tightly concentrated - measured as the mean resultant length
    # of 4*aspect, which is ~1 for faces all at 0/90/180/270 and ~0 for a curve.
    lim = float(cfg.get("maxAxisAligned", 0.60))
    conc_lim = float(cfg.get("maxAspectConcentration", 0.70))
    min_cells = int(cfg.get("boxRegionCells", 150))
    near_axis = (asp < 6.0) | (asp > 84.0)
    lab, nreg = ndimage.label(steep, structure=np.ones((3, 3)))
    rows, judged = [], 0
    for k in range(1, nreg + 1):
        reg = lab == k
        cells = int(reg.sum())
        if cells < min_cells:
            continue
        judged += 1
        frac = float(near_axis[reg].mean())
        ang = np.radians(asp[reg] * 4.0)
        conc = float(np.hypot(np.cos(ang).mean(), np.sin(ang).mean()))
        if frac > lim and conc > conc_lim:
            iz, ix = [int(v) for v in ndimage.center_of_mass(reg)]
            rows.append(f"cliff region of {cells} columns near {_xz(meta, iz, ix)} is {frac:.0%} "
                        f"axis-aligned with aspect concentration {conc:.2f} - a rectangle, not a landform")
    overall = float(near_axis[steep].mean())
    detail = (f"{judged} cliff region(s) judged; map-wide {overall:.0%} of steep faces axis-aligned "
              f"(organic about 13-25%; a region over {lim:.0%} fails)")
    if rows:
        return C.Check("T3", "Boxiness", C.FAIL, detail, rows[:8])
    return C.Check("T3", "Boxiness", C.PASS, detail)


# --------------------------------------------------------------------------
# T4 tide-gated reachability
# --------------------------------------------------------------------------

def _graph(h, level, gate, high_state, prof):
    nz, nx = h.shape
    wade = prof["wade"]
    foot = h >= level - wade
    tan = math.tan(math.radians(prof["slope"]))
    climb_out = prof["climbOut"]
    fall = prof["fall"]
    ids = np.arange(nz * nx).reshape(nz, nx)
    src_all, dst_all = [], []
    for dz, dx in ((0, 1), (1, 0), (1, 1), (1, -1), (0, -1), (-1, 0), (-1, -1), (-1, 1)):
        dist = VOXEL * math.hypot(dz, dx)
        zs = slice(max(0, -dz), nz - max(0, dz))
        xs = slice(max(0, -dx), nx - max(0, dx))
        zd = slice(max(0, dz), nz - max(0, -dz))
        xd = slice(max(0, dx), nx - max(0, -dx))
        ha, hb = h[zs, xs], h[zd, xd]
        fa, fb = foot[zs, xs], foot[zd, xd]
        rise = hb - ha
        up_ok = rise <= max(tan * dist, prof["step"])
        walk = fa & fb & up_ok & (-rise <= fall)
        swim = ~fa & ~fb
        exit_ = ~fa & fb & (hb - level <= climb_out)
        enter = fa & ~fb
        ok = walk | swim | exit_ | enter
        if high_state and gate is not None:
            ok &= ~(gate[zd, xd] & ~gate[zs, xs])
        a, b = ids[zs, xs][ok], ids[zd, xd][ok]
        src_all.append(a)
        dst_all.append(b)
    src = np.concatenate(src_all)
    dst = np.concatenate(dst_all)
    g = csr_matrix((np.ones(src.size, np.int8), (src, dst)), shape=(nz * nx, nz * nx))
    return g, foot


def _frontier(h, meta, reached, target):
    """Where the reachable ground stops short of a target, and what stops it.

    "No dry ground reachable" is true and useless: the first time a castle road
    failed to reach the castle it gave no clue whether the break was a cliff, a
    cut bank or a gap. So report the reachable column nearest the target and the
    steepest rise from it into unreachable ground.
    """
    if not reached.any():
        return " (nothing reachable at all)"
    tz, tx = np.argwhere(target).mean(axis=0)
    pts = np.argwhere(reached)
    d = np.hypot(pts[:, 0] - tz, pts[:, 1] - tx)
    iz, ix = pts[int(np.argmin(d))]
    rise = 0.0
    for dz in (-1, 0, 1):
        for dx in (-1, 0, 1):
            jz, jx = iz + dz, ix + dx
            if (dz or dx) and 0 <= jz < h.shape[0] and 0 <= jx < h.shape[1] and not reached[jz, jx]:
                rise = max(rise, float(h[jz, jx] - h[iz, ix]))
    return (f" - nearest reachable ground is {float(d.min()) * VOXEL:.0f} studs short at "
            f"{_xz(meta, iz, ix)} (y={float(h[iz, ix]):.0f}), next to a {rise:.1f}-stud rise per "
            f"{VOXEL:.0f}-stud column")


def _reach(g, start):
    order = breadth_first_order(g, start, directed=True, return_predecessors=False)
    out = np.zeros(g.shape[0], bool)
    out[order] = True
    return out


def t4_tides(t, spec, C, profile):
    h, meta = t["height"], t["meta"]
    nz, nx = h.shape
    low, high = meta["tide"]["low"], meta["tide"]["high"]
    prof = {"wade": 2.0, "slope": profile.get("designMaxSlope", 45),
            "step": max(profile.get("autoStep", 2.0), profile.get("jumpApex", 6.37) * 0.8),
            "climbOut": 3.0, "fall": 120.0}
    gate = np.zeros(h.shape, bool)
    for gt in meta.get("tideGates", []):
        gate |= _disc(meta, h.shape, gt["center"], gt["radius"])
    sp = meta["spawn"]
    s_iz, s_ix = _cell(meta, sp[0], sp[2])
    start = s_iz * nx + s_ix
    rows, worst = [], C.PASS
    if h[s_iz, s_ix] < high + 1:
        return C.Check("T4", "Tides", C.FAIL, f"spawn at {sp} is under water at high tide")

    state = {}
    for name, level, is_high in (("low", low, False), ("high", high, True)):
        g, foot = _graph(h, level, gate, is_high, prof)
        fwd = _reach(g, start)
        back = _reach(g.T.tocsr(), start)
        # foot-only reach for "on foot at low tide"
        gf, _ = _graph(np.where(foot, h, -1e4), level, None, False, dict(prof, climbOut=-1e9))
        fwd_foot = _reach(gf, start)
        state[name] = (fwd.reshape(nz, nx), back.reshape(nz, nx), foot, fwd_foot.reshape(nz, nx))

    summary = []
    for zn in meta.get("zones", []):
        access = zn.get("access", "always")
        disc = _disc(meta, h.shape, zn["center"], zn["radius"])
        lo_f, _, lo_foot_mask, lo_foot = state["low"]
        hi_f, _, _, _ = state["high"]
        if access == "swim":
            ok_lo, ok_hi = (disc & lo_f).any(), (disc & hi_f).any()
            if not (ok_lo and ok_hi):
                rows.append(f"{zn['name']} (swim): reachable low={ok_lo} high={ok_hi}, want both")
                worst = C.FAIL
        elif access == "lowTideOnly":
            on_foot = (disc & lo_foot & lo_foot_mask).any()
            reach_lo = (disc & lo_f & lo_foot_mask).any()
            reach_hi = (disc & hi_f).any()
            if zn.get("lowTideOnFoot", True) and not on_foot:
                rows.append(f"{zn['name']} (lowTideOnly): cannot be WALKED to at low tide")
                worst = C.FAIL
            elif not reach_lo:
                rows.append(f"{zn['name']} (lowTideOnly): not reachable at low tide at all")
                worst = C.FAIL
            if reach_hi:
                rows.append(f"{zn['name']} (lowTideOnly): still reachable at HIGH tide - "
                            f"add or widen a tide gate on every approach")
                worst = C.FAIL
        else:
            for tide in ("low", "high"):
                fwd, _, footm, _ = state[tide]
                if not (disc & fwd & footm).any():
                    rows.append(f"{zn['name']} (always): no dry ground reachable at {tide} tide"
                                + _frontier(h, meta, fwd & footm, disc))
                    worst = C.FAIL
        summary.append(f"{zn['name']}:{access}")

    # stranding: dry ground you could reach at low tide must lead home at high tide
    lo_fwd = state["low"][0]
    hi_fwd, hi_back, hi_foot, _ = state["high"]
    stranded = lo_fwd & hi_foot & ~hi_back
    for tide in ("low", "high"):
        fwd, back, footm, _ = state[tide]
        trapped = fwd & footm & ~back
        if trapped.sum() > 6:
            lab, n = ndimage.label(trapped)
            big = np.argmax(ndimage.sum(trapped, lab, range(1, n + 1))) + 1
            iz, ix = [int(v) for v in ndimage.center_of_mass(trapped, lab, big)]
            rows.append(f"{int(trapped.sum())} column(s) reachable at {tide} tide with no way back to "
                        f"spawn, largest pocket near {_xz(meta, iz, ix)}")
            worst = C.FAIL
    if stranded.sum() > 6:
        lab, n = ndimage.label(stranded)
        big = np.argmax(ndimage.sum(stranded, lab, range(1, n + 1))) + 1
        iz, ix = [int(v) for v in ndimage.center_of_mass(stranded, lab, big)]
        rows.append(f"{int(stranded.sum())} column(s) you can walk to at low tide STRAND you when the "
                    f"tide rises, largest near {_xz(meta, iz, ix)}")
        worst = C.FAIL
    detail = (f"zones proven at both tides ({', '.join(summary)}), low {meta['tide']['low']:.0f} / "
              f"high {meta['tide']['high']:.0f}") if worst == C.PASS else "tide reachability broken"
    return C.Check("T4", "Tides", worst, detail, rows)


# --------------------------------------------------------------------------
# T5 caves
# --------------------------------------------------------------------------

def t5_caves(t, spec, C, profile):
    h, meta = t["height"], t["meta"]
    caves = meta.get("caves", [])
    if not caves:
        return C.Check("T5", "Caves", C.INFO, "no caves declared")
    need_r = profile.get("charHeight", 5.0) * 1.6
    slope = profile.get("designMaxSlope", 45)
    low, high = meta["tide"]["low"], meta["tide"]["high"]
    rows, worst = [], C.PASS
    for c in caves:
        pts, r = c["points"], float(c.get("radius", 0))
        name = c.get("name", "cave")
        if r < need_r:
            rows.append(f"{name}: radius {r:.0f} < {need_r:.0f} (a character plus headroom)")
            worst = C.FAIL
        for a, b in zip(pts, pts[1:]):
            run = math.hypot(b[0] - a[0], b[2] - a[2])
            grade = math.degrees(math.atan2(abs(b[1] - a[1]), max(run, 1e-6)))
            if grade > slope:
                rows.append(f"{name}: segment {a} -> {b} climbs at {grade:.0f} degrees (limit {slope})")
                worst = C.FAIL
        for end in (pts[0], pts[-1]):
            joins_other = any(o is not c and any(math.dist(end, q) <= float(o.get("radius", 0)) * 1.2
                                                 for q in o["points"]) for o in caves)
            iz, ix = _cell(meta, end[0], end[2])
            surf = float(h[iz, ix])
            if not joins_other and abs(end[1] - surf) > r * 1.2:
                rows.append(f"{name}: end {end} is {end[1] - surf:+.0f} studs from the surface "
                            f"({surf:.0f}) - it never opens to daylight")
                worst = C.FAIL
        # A TUNNEL NEEDS A ROOF. The first check only looked at grades and at the
        # two mouths, and passed a grotto whose middle ran under 54-stud lowland at
        # y=66-89 - a tube ABOVE the ground, i.e. an open trench - plus a harbour
        # tunnel whose first 40 studs broke the surface. A sampler found both.
        min_roof = float(_cfg(spec).get("caveMinRoof", 3.0))
        thin = []
        for a, b in zip(pts, pts[1:]):
            n = max(2, int(math.dist(a, b) / VOXEL))
            for k in range(n + 1):
                q = [a[j] + (b[j] - a[j]) * k / n for j in range(3)]
                if min(math.dist(q, pts[0]), math.dist(q, pts[-1])) < r * 2.5:
                    continue  # a mouth is shallow by definition
                iz, ix = _cell(meta, q[0], q[2])
                roof = float(h[iz, ix]) - (q[1] + r)
                if roof < min_roof:
                    thin.append((roof, [round(v) for v in q], float(h[iz, ix])))
        if thin:
            thin.sort()
            roof, q, surf = thin[0]
            rows.append(f"{name}: {len(thin)} interior sample(s) with under {min_roof:.0f} studs of roof - "
                        f"worst {roof:.1f} at {q} under ground at y={surf:.0f}"
                        + (" (the tube is ABOVE the ground there)" if roof < -r else ""))
            worst = C.FAIL
        mouth_y = min(pts[0][1], pts[-1][1])
        if c.get("access") == "lowTideOnly" and not (low - 4 <= mouth_y < high):
            rows.append(f"{name}: lowTideOnly but its lowest mouth y={mouth_y:.0f} is not between "
                        f"low {low:.0f} and high {high:.0f} tide, so the tide does not gate it")
            worst = C.FAIL
        if c.get("access", "always") == "always":
            wet = [p for p in pts if p[1] < high]
            if wet:
                rows.append(f"{name}: declared always-open but {len(wet)} point(s) sit below high tide "
                            f"and will flood")
                worst = C.FAIL if worst == C.FAIL else C.WARN
    return C.Check("T5", "Caves", worst,
                   f"{len(caves)} cave(s) walkable and open" if worst == C.PASS else "cave problems", rows)


# --------------------------------------------------------------------------
# T6 coast variety
# --------------------------------------------------------------------------

def t6_coast(t, spec, C):
    h, meta = t["height"], t["meta"]
    high = meta["tide"]["high"]
    land = h >= high
    water = ~land
    coast = land & (ndimage.binary_dilation(water) )
    n = int(coast.sum())
    if n < 40:
        return C.Check("T6", "Coast", C.INFO, "too little coastline to judge")
    sl, _ = _slope_aspect(h)
    cliff = (coast & (sl >= 40)).sum() / n
    beach = (coast & (sl <= 20)).sum() / n
    detail = f"coast is {cliff:.0%} cliff, {beach:.0%} beach over {n * VOXEL:.0f} studs"
    if cliff < 0.12 or beach < 0.12:
        return C.Check("T6", "Coast", C.WARN, detail, ["a single-character coast reads as generated"])
    return C.Check("T6", "Coast", C.PASS, detail)


# --------------------------------------------------------------------------
# slab ground (parts), used by spec.py
# --------------------------------------------------------------------------

def slab_ground(spec, min_side=64.0):
    out = []
    for p in spec.get("parts", []):
        if "kit" in p or p.get("decor"):
            continue
        roles = set(p.get("roles", []))
        size = p.get("size") or [0, 0, 0]
        if roles & GROUNDISH and size[0] >= min_side and size[2] >= min_side:
            out.append(f"{p.get('id')}: {size[0]:.0f}x{size[2]:.0f} stud slab with role "
                       f"{sorted(roles & GROUNDISH)}")
    return out


def t7_earthworks(t, spec, C):
    """A road follows the land; it is not a dam and not a canyon.

    Written after grading a castle road straight at a 127-stud sea cliff: the
    grade limit held, T4 proved the castle reachable, and the road was a
    119-stud embankment. Walkable and absurd. Route roads along the land -
    switchbacks, saddles, the long way round - instead of earthmoving.
    """
    lim = float(_cfg(spec).get("maxEarthwork", 32.0))
    paths = t["meta"].get("paths", [])
    if not paths:
        return C.Check("T7", "Earthworks", C.INFO, "no paths declared")
    rows = []
    for p in paths:
        if p.get("maxFill", 0) > lim:
            rows.append(f"{p['name']}: builds a {p['maxFill']:.0f}-stud embankment at {p['maxFillAt']} "
                        f"(limit {lim:.0f}) - route it along the land instead")
        if p.get("maxCut", 0) > lim:
            rows.append(f"{p['name']}: cuts a {p['maxCut']:.0f}-stud trench at {p['maxCutAt']} "
                        f"(limit {lim:.0f}) - route it along the land instead")
    worst_fill = max(p.get("maxFill", 0) for p in paths)
    worst_cut = max(p.get("maxCut", 0) for p in paths)
    detail = f"{len(paths)} road(s), worst fill {worst_fill:.0f} / cut {worst_cut:.0f} studs (limit {lim:.0f})"
    return C.Check("T7", "Earthworks", C.FAIL if rows else C.PASS, detail, rows)


def t8_cliff_cover(t, spec, C):
    """Steep terrain renders as a field of tiny triangles.

    Measured in Studio: Roblox meshes steep voxel terrain at 4-stud voxels, and
    no heightfield smoothing removes the result - a big cliff reads as crushed
    crystal rather than as a rock face. This skill does not make cliff models, so
    the check reports how much steep ground there is and WARNs when it is a lot.
    Cover it with your own cliff models, reshape the landforms, or accept the look.
    """
    steep = int((_slope_aspect(t["height"])[0] >= 45).sum())
    if steep > 200:
        return C.Check("T8", "Cliff cover", C.WARN,
                       f"{steep} steep columns (45 degrees or more) of bare voxel cliff",
                       ["bare voxel cliffs render as small triangles; cover them with your own "
                        "cliff models or soften the landform profiles"])
    return C.Check("T8", "Cliff cover", C.INFO, f"{steep} steep columns - little bare cliff")


SOFT_DRESSING = ("grass", "flower", "fern", "cliff")


def _prop_positions(spec):
    """(x, z) of everything standing on the land, and whether the map is dressed
    at all. Dressed means at least one part carries a `mesh` or the `prop` role;
    landmarks and structures then count as cover too. `ring` copies are expanded
    the same way spec.py does. Grass, flowers, ferns and cliffs do not count."""
    out, dressed = [], False
    for p in spec.get("parts", []):
        if "pos" not in p:
            continue
        roles = set(p.get("roles", []))
        mesh = str(p.get("mesh") or "")
        if not (mesh or roles & {"prop", "landmark", "structure"}):
            continue
        dressed |= bool(mesh) or "prop" in roles
        if any(s in mesh for s in SOFT_DRESSING):
            continue
        x, _, z = p["pos"]
        ring = int(p.get("ring", 1))
        for i in range(ring):
            r = math.radians(360.0 / ring * i)
            out.append((x * math.cos(r) + z * math.sin(r), -x * math.sin(r) + z * math.cos(r)))
    return out, dressed


def t9_empty_land(t, spec, C, cell=64.0, reach=56.0):
    """Dry walkable land must have something on it.

    P11 samples PART surfaces, so on a terrain map it saw four barrier walls and
    reported "no props at all" beside thousands of placements. This is its terrain
    form: every 64-stud cell of dry, walkable, non-pad land needs a tree, rock,
    bush or building within reach. Grass, flowers, ferns and cliffs do not count -
    a field of grass is still an empty field.

    It judges a DRESSED map: one with at least one part carrying a `mesh` or the
    `prop` role. A greybox with none is INFO, because dressing comes after the
    ground is proven; the moment props are placed, the whole island is judged."""
    props, dressed = _prop_positions(spec)
    if not dressed:
        return C.Check("T9", "Empty land", C.INFO,
                       "not dressed yet: no part carries a mesh or the prop role")
    from scipy.spatial import cKDTree
    meta = t["meta"]
    g = meta["grid"]
    h = t["height"]
    gz, gx = np.gradient(h, VOXEL)
    slope = np.degrees(np.arctan(np.hypot(gx, gz)))
    land = (h >= meta["tide"]["high"] + 1) & (slope < 35) & ~(t["pad"] > 0)
    tree = cKDTree(np.array(props))
    k = int(cell / VOXEL)
    empty, total = [], 0
    for iz in range(0, h.shape[0] - k + 1, k):
        for ix in range(0, h.shape[1] - k + 1, k):
            blk = land[iz:iz + k, ix:ix + k]
            if blk.mean() < 0.25:
                continue
            total += 1
            zz, xx = np.nonzero(blk)
            x = g["x0"] + (ix + xx.mean() + 0.5) * VOXEL
            z = g["z0"] + (iz + zz.mean() + 0.5) * VOXEL
            if not tree.query_ball_point([x, z], reach):
                empty.append((round(x), round(z)))
    frac = len(empty) / max(total, 1)
    lim = float(_cfg(spec).get("maxEmptyLand", 0.35))
    detail = f"{frac:.0%} of {total} dry land cells have no prop within {reach:.0f} studs (limit {lim:.0%})"
    return C.Check("T9", "Empty land", C.PASS if frac <= lim else C.FAIL, detail,
                   [f"bare around ({x}, {z})" for x, z in empty[:8]] if frac > lim else [])


# Measured at 11 probed points: smooth terrain's surface sits 1.9-2.3 studs
# ABOVE the heightfield (+ lift), because the top voxel is partly filled. A
# spawn whose base is at the heightfield value is buried in the ground.
SURFACE_BIAS = 2.0


def t10_spawn(t, spec, C, max_slope=20.0, max_drop=12.0):
    """A player must spawn ON the map: on dry land at high tide, on gentle ground,
    not buried in the terrain and not dropped from high above it.

    The spawns are the spec's own `spawns` (x, y, z in spec coordinates, before
    lift). The builder places a SpawnLocation at each one and the place's own
    template spawn at (0, 0.5, 0) must be removed, or it can be the only spawn
    that works. The playtest probe (luau/spawn_probe.server.lua) is the final
    proof; this is the headless half."""
    spawns = spec.get("spawns") or []
    if not spawns:
        return C.Check("T10", "Spawn", C.FAIL,
                       "no spawns: players would fall back to the place's template spawn at (0, 0.5, 0)")
    meta = t["meta"]
    g = meta["grid"]
    h = t["height"]
    slope = _slope_aspect(h)[0]
    high = meta["tide"]["high"]
    issues, ok, worst = [], [], C.PASS
    for s in spawns:
        x, y, z = s
        if not (g["x0"] <= x < g["x0"] + g["nx"] * VOXEL and g["z0"] <= z < g["z0"] + g["nz"] * VOXEL):
            issues.append(f"spawn ({x}, {z}) is outside the terrain")
            worst = C.FAIL
            continue
        iz, ix = _cell(meta, x, z)
        ground, sl = float(h[iz, ix]), float(slope[iz, ix])
        if ground < high:
            issues.append(f"spawn ({x}, {z}) is under water at high tide (ground {ground:.0f}, tide {high:.0f})")
            worst = C.FAIL
        elif sl > max_slope:
            issues.append(f"spawn ({x}, {z}) stands on {sl:.0f} degree ground (limit {max_slope:.0f})")
            worst = C.FAIL
        elif y < ground + SURFACE_BIAS:
            issues.append(f"spawn ({x}, {y}, {z}) is buried: the terrain surface there is about "
                          f"y={ground + SURFACE_BIAS:.1f}; set the spawn y to at least that")
            worst = C.FAIL
        elif y > ground + SURFACE_BIAS + max_drop:
            issues.append(f"spawn ({x}, {y}, {z}) drops {y - ground - SURFACE_BIAS:.0f} studs to the ground")
            if worst == C.PASS:
                worst = C.WARN
        else:
            ok.append(f"({x}, {z}) ground {ground:.0f}, {sl:.0f} deg")
    if issues:
        return C.Check("T10", "Spawn", worst, f"{len(issues)} spawn problem(s)", issues)
    return C.Check("T10", "Spawn", C.PASS,
                   "; ".join(ok) + " - confirm with the playtest probe")


def run(t, spec, profile, C):
    return [t1_flatness(t, spec, C), t2_relief(t, spec, C), t3_boxiness(t, spec, C),
            t4_tides(t, spec, C, profile), t5_caves(t, spec, C, profile), t6_coast(t, spec, C),
            t7_earthworks(t, spec, C), t8_cliff_cover(t, spec, C), t9_empty_land(t, spec, C),
            t10_spawn(t, spec, C)]


# --------------------------------------------------------------------------
# self-test: each check must FAIL the map it was written for
# --------------------------------------------------------------------------

def selftest():
    import terrain
    from types import SimpleNamespace

    class Chk:
        def __init__(self, cid, title, status, detail, rows=None):
            self.id, self.title, self.status, self.detail, self.rows = cid, title, status, detail, rows or []

    C = SimpleNamespace(Check=Chk, PASS="PASS", FAIL="FAIL", WARN="WARN", INFO="INFO")
    prof = {"designMaxSlope": 45, "autoStep": 2.0, "jumpApex": 6.37, "charHeight": 5.0}
    base = {"size": [1024, 1024], "seed": 4, "seaFloor": -30, "tide": {"low": 28, "high": 40}}

    flat = {"name": "flat", "terrain": dict(base, landforms=[
        {"name": "slab", "center": [0, 0], "radius": 380, "warp": 60, "rough": 0.3,
         "profile": [[-60, -20], [0, 44], [30, 60], [500, 60]]}],
        zones=[{"name": "Middle", "center": [0, 0], "radius": 40}], spawn=[0, 60, 0])}
    boxy = {"name": "boxy", "terrain": dict(base, landforms=[
        {"name": "ground", "center": [0, 0], "radius": 420, "warp": 40, "rough": 6,
         "profile": [[-60, -20], [0, 44], [60, 70], [500, 80]]}],
        zones=[{"name": "Top", "center": [0, 0], "radius": 30}], spawn=[-300, 60, -300])}
    organic = {"name": "organic", "terrain": dict(base, landforms=[
        {"name": "island", "center": [0, 0], "radius": [400, 360], "lobes": 6, "lobeAmp": 0.14,
         "rough": 10, "profile": [[-80, -20], [0, 42], [40, 52], [160, 90], [420, 150]]},
        {"name": "mesa", "center": [120, 80], "radius": 110, "rough": 6, "blend": 6,
         "profile": [[0, 90], [10, 175], [200, 185]]},
        {"name": "terr", "center": [-160, -120], "radius": 160, "op": "terrace", "step": 18}],
        paths=[{"name": "up", "points": [[-250, -250], [0, -60], [100, 40]], "width": 14, "maxGrade": 30}],
        zones=[{"name": "Beach", "center": [-330, -200], "radius": 40}], spawn=[-250, 60, -250])}

    results = {}
    for s in (flat, boxy, organic):
        t = terrain.generate(s, None, preview=False)
        if s is boxy:
            # a rectangular plateau stamped on top: the classic generated-map look
            gx, gz = np.meshgrid(np.arange(t["height"].shape[1]), np.arange(t["height"].shape[0]))
            box = (abs(gx - t["height"].shape[1] // 2) < 50) & (abs(gz - t["height"].shape[0] // 2) < 35)
            t["height"] = np.where(box, t["height"] + 70, t["height"]).astype(np.float32)
        results[s["name"]] = {c.id: c for c in run(t, s, prof, C)}

    expect = [("flat", "T1", "FAIL"), ("flat", "T2", "FAIL"), ("boxy", "T3", "FAIL"),
              ("organic", "T1", "PASS"), ("organic", "T3", "PASS"), ("organic", "T2", "PASS")]
    ok = True
    for name, cid, want in expect:
        got = results[name][cid]
        mark = "ok  " if got.status == want else "BAD "
        ok &= got.status == want
        print(f"{mark} {name:8s} {cid} want {want:4s} got {got.status:4s} {got.detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
