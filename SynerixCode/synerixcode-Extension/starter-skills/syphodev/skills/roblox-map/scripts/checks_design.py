"""Design checks: the things a human notices that geometry checks do not.

P1-P9 ask "is the built geometry what the spec declared". Every one of them can
pass on a map that looks obviously wrong to a person, and that is exactly what
kept happening: bare shorelines, flickering surfaces, houses whose doors face a
hedge, and fields of empty grass. Each check here started life as a correction
from a human, which is the definition of a check that should have existed.
"""

from __future__ import annotations

import math

from geom import aabb_overlap


def p10_coplanar(m, Check, PASS, FAIL, eps=0.06):
    """Two surfaces at the same height whose footprints overlap will z-fight.

    Roblox renders coplanar faces as a flickering stripe, which reads as "the
    geometry is glitchy". It is not an overlap in P6's sense - the parts can be
    nested perfectly legally - so P6 is blind to it.

    Caught on its first run: a round plaza whose deck and rim both topped out at
    y=1.20, one 92 studs across and one 95, so the exposed ring flickered.
    """
    # Walkable route surfaces are MEANT to meet at the same height - that is a
    # continuous floor, not a defect. Consecutive path segments abut and two
    # crossing paths overlap, both by construction.
    ROUTE = {"main_route", "side_route", "surface", "hub", "spawn_plaza",
             "plaza_access", "hill_access", "arena_floor", "meadow"}

    def is_route(b):
        return any(r in ROUTE for r in b.roles)

    rows = []
    bs = [b for b in m.boxes if b.visible and b.solid]
    for i in range(len(bs)):
        a = bs[i]
        for j in range(i + 1, len(bs)):
            b = bs[j]
            if abs(a.top - b.top) > eps:
                continue
            if is_route(a) and is_route(b):
                continue
            if not aabb_overlap(a, b, 0.5):
                continue
            (alo, ahi), (blo, bhi) = a.aabb(), b.aabb()
            aw, bw = ahi[0] - alo[0], bhi[0] - blo[0]
            if abs(aw - bw) < 0.5:
                continue            # identical footprints are deliberate stacking
            # A flicker needs a substantial SHARED AREA, not merely a touch.
            # Two exemptions, both ordinary construction:
            #   - a thin trim band flush with a big face (corner boards)
            #   - consecutive segments of a path abutting end to end
            ad, bd_ = ahi[2] - alo[2], bhi[2] - blo[2]
            ox = max(0.0, min(ahi[0], bhi[0]) - max(alo[0], blo[0]))
            oz = max(0.0, min(ahi[2], bhi[2]) - max(alo[2], blo[2]))
            shared = ox * oz
            smaller = min(aw * ad, bw * bd_)
            # ...and it must be big enough to SEE. A 1-stud corner board on a
            # 43-stud barn wall shares half its own tiny footprint, which passes
            # a ratio test and is invisible in game. 12 studs squared is about a
            # 3.5 stud patch - below that, nobody will ever notice.
            if smaller <= 0 or shared < smaller * 0.25 or shared < 12.0:
                continue
            rows.append(
                f"{a.name} and {b.name} share a top face at y={a.top:.2f} and "
                f"overlap ({aw:.0f} vs {bw:.0f} wide) - this flickers")
    if rows:
        return Check("P10", "Coplanar surfaces", FAIL,
                     f"{len(rows)} pair(s) will z-fight", rows[:8])
    return Check("P10", "Coplanar surfaces", PASS,
                 "no coplanar overlapping faces")


def p11_density(m, r, Check, PASS, FAIL, WARN, INFO,
                cell=36.0, max_empty=0.22, reach=26.0):
    """How much of the walkable map has nothing worth looking at.

    Roblox players have short attention spans and a bare field reads as
    unfinished. Samples the standable surface on a grid and asks, per cell,
    whether ANY prop, structure or landmark sits within `reach`.

    The first thresholds (48 stud cells, 36 stud reach, 30% budget) passed a map
    whose whole foreground still looked bare to a person. Tightened to 36/26/22%
    so the number tracks what the eye actually reports.
    """
    if not r.components:
        return Check("P11", "Empty space", INFO, "nothing standable to sample")
    if m.source.get("terrain"):
        # A terrain map is judged on the heightfield, not on boxes; sampling part
        # surfaces saw only the barrier walls and called a 3,600-prop island empty.
        return Check("P11", "Empty space", INFO, "terrain map: judged by T9 Empty land")
    interest = [b for b in m.boxes
                if b.visible and (b.meta.get("decor") or b.meta.get("mesh")
                                  or "landmark" in b.roles or "prop" in b.roles
                                  or "market" in b.roles or "cover" in b.roles)]
    if not interest:
        return Check("P11", "Empty space", WARN, "the map has no props at all")

    cells = {}
    for c in r.components:
        for n in c.nodes:
            cells.setdefault((int(n.x // cell), int(n.z // cell)), []).append(n)
    empty, total = [], 0
    for nodes in cells.values():
        total += 1
        n = nodes[len(nodes) // 2]
        near = False
        for b in interest:
            dx = b.centre[0] - n.x
            dz = b.centre[2] - n.z
            if dx * dx + dz * dz < reach * reach:
                near = True
                break
        if not near:
            empty.append((round(n.x), round(n.z)))
    frac = len(empty) / max(total, 1)
    detail = (f"{frac:.0%} of {total} sampled cells have nothing within "
              f"{reach:.0f} studs (budget {max_empty:.0%})")
    if frac > max_empty:
        return Check("P11", "Empty space", FAIL, detail,
                     [f"bare around ({x}, {z})" for x, z in empty[:8]])
    return Check("P11", "Empty space", PASS, detail)


def p12_entrances(m, Check, PASS, FAIL, INFO, max_dist=80.0, min_dot=0.40):
    """A building's door must face somewhere a player can walk from.

    A house whose entrance points into a hedge is the clearest sign a map was
    assembled rather than designed - and nothing else in this prover looks at
    ORIENTATION at all, only position.
    """
    doors = [b for b in m.boxes if b.meta.get("facing") is not None]
    if not doors:
        return Check("P12", "Entrances", INFO, "no part declares a facing")

    routes = [b for b in m.boxes
              if "main_route" in b.roles or "side_route" in b.roles
              or "hub" in b.roles or "spawn_plaza" in b.roles]
    if not routes:
        return Check("P12", "Entrances", INFO, "no routes declared to face")

    rows, worst = [], PASS
    for d in doors:
        yaw = math.radians(d.yaw + float(d.meta.get("facing") or 0.0))
        fx, fz = math.sin(yaw), math.cos(yaw)
        best, bd = None, 1e9
        for rt in routes:
            dx = rt.centre[0] - d.centre[0]
            dz = rt.centre[2] - d.centre[2]
            dist = math.hypot(dx, dz)
            if dist < bd:
                bd, best = dist, (rt.name, dx, dz, dist)
        if best is None or bd > max_dist:
            rows.append(f"{d.name}: no route within {max_dist:.0f} studs")
            worst = FAIL
            continue
        name, dx, dz, dist = best
        dot = (fx * dx + fz * dz) / max(dist, 1e-6)
        if dot < min_dot:
            want = math.degrees(math.atan2(dx, dz)) - float(d.meta.get("facing") or 0.0)
            rows.append(f"{d.name}: door faces away from its nearest route "
                        f"'{name}' ({bd:.0f} studs, alignment {dot:+.2f}) - "
                        f"set yaw to {want % 360:.0f}")
            worst = FAIL
    return Check("P12", "Entrances", worst,
                 "every declared entrance faces a walkable route"
                 if worst == PASS else "entrances pointing nowhere", rows)


def p13_dressing(m, Check, PASS, FAIL, INFO, min_props=6, band=40.0):
    """Water and landmarks need something around their edge.

    A lake with bare grass running to the waterline reads as a hole in the
    ground. The genre research is explicit that the reference farm borders its
    pond with rock and greenery - and this check exists because switching the
    pond to Terrain water silently removed the rock ring the old kit emitted,
    which nobody noticed until a human looked at it.
    """
    features = [b for b in m.boxes
                if b.meta.get("terrainWater") or "water_feature" in b.roles
                or "landmark" in b.roles]
    if not features:
        return Check("P13", "Feature dressing", INFO,
                     "no water or landmark declared")
    props = [b for b in m.boxes if b.meta.get("mesh") or b.meta.get("decor")]
    rows, worst = [], PASS
    for f in features:
        why = f.meta.get("dressing_exempt")
        if why:
            rows.append(f"{f.name}: exempt - {why}")
            continue
        lo, hi = f.aabb()
        rx = max(hi[0] - lo[0], hi[2] - lo[2]) / 2.0
        n = 0
        for p in props:
            dx = p.centre[0] - f.centre[0]
            dz = p.centre[2] - f.centre[2]
            d = math.hypot(dx, dz)
            if rx - band * 0.5 <= d <= rx + band:
                n += 1
        if n < min_props:
            rows.append(f"{f.name}: only {n} prop(s) around its edge (want "
                        f"{min_props}) - a bare shoreline reads as a hole")
            worst = FAIL
    return Check("P13", "Feature dressing", worst,
                 "every water feature and landmark has props around it"
                 if worst == PASS else "bare edges", rows)


def p14_props_in_water(m, Check, PASS, FAIL, INFO):
    """Nothing stands in the lake except the things that float.

    A tree growing out of open water is the single most obviously wrong thing a
    generated map can contain, and it survived every other check: the water
    marker is invisible and non-solid, so the overlap check, the scatter prune
    and the grounding check all correctly ignored it.
    """
    import outline

    water = [b for b in m.boxes if b.meta.get("terrainWater")]
    if not water:
        return Check("P14", "Props in water", INFO, "no water declared")

    ds = []
    for w in water:
        ds += outline.discs(w.centre[0], w.centre[2], w.size[0], w.size[2],
                            w.yaw, w.meta.get("lobes", 7))
    rows = []
    for b in m.boxes:
        if b.meta.get("terrainWater"):
            continue
        if not (b.meta.get("mesh") or b.meta.get("decor")):
            continue
        if outline.floats(b.name):
            continue
        if outline.in_water(b.centre[0], b.centre[2], ds):
            rows.append(f"{b.name} stands in open water at "
                        f"({b.centre[0]:.0f}, {b.centre[2]:.0f})")
    if rows:
        return Check("P14", "Props in water", FAIL,
                     f"{len(rows)} prop(s) standing in water", rows[:8])
    return Check("P14", "Props in water", PASS,
                 f"nothing stands in {len(water)} water body(ies)")


def p15_props_on_routes(m, Check, PASS, FAIL, INFO, clearance=0.6):
    """Nothing is standing in the middle of a path.

    A boulder parked across a walking route is the kind of thing a player walks
    into in the first ten seconds, and every existing check passed it: a path
    slab is well under a stud thick, so the scatter prune's height test excluded
    routes from being blockers at all, and the overlap check reads heights too.

    Routes are the one class of geometry that must be judged in PLAN.

    SCOPE. Only SCATTERED props count. The first version tested every part and
    reported eight failures, all of them deliberate: a plaza rim standing on its
    own deck, stair cheeks flanking the path they belong to, a barn roof
    overhanging the track past it, a plot kerb where a path meets the plot. That
    is what architecture looks like. The defect this check was written for is a
    boulder the scatter dropped in the middle of a walkway, so that is what it
    looks at - and it must be tall enough to walk into, not a flat lilypad.
    """
    ROUTE = {"main_route", "side_route", "hub", "spawn_plaza",
             "plaza_access", "hill_access"}
    routes = [b for b in m.boxes if any(r in ROUTE for r in b.roles)]
    if not routes:
        return Check("P15", "Clear routes", INFO, "no routes declared")

    rows = []
    for b in m.boxes:
        if b.meta.get("kit") not in ("mesh_scatter", "scatter"):
            continue
        if b.size[1] < 1.5:
            continue
        if any(r in ROUTE for r in b.roles):
            continue
        (blo, bhi) = b.aabb()
        for rt in routes:
            (rlo, rhi) = rt.aabb()
            ox = min(bhi[0], rhi[0]) - max(blo[0], rlo[0])
            oz = min(bhi[2], rhi[2]) - max(blo[2], rlo[2])
            if ox > clearance and oz > clearance:
                rows.append(f"{b.name} sits on route {rt.name} "
                            f"({ox:.1f} x {oz:.1f} studs of it)")
                break
    if rows:
        return Check("P15", "Clear routes", FAIL,
                     f"{len(rows)} prop(s) blocking a walking route", rows[:8])
    return Check("P15", "Clear routes", PASS,
                 f"{len(routes)} route surface(s) are walkable end to end")


def p16_enclosure(m, r, Check, PASS, FAIL, WARN, INFO, step=4.0, min_h=None):
    """The playable area is actually closed, and closed by a BARRIER.

    A boundary is the one piece of a map where "looks right" and "works" are
    different properties. A tiled cliff ring looks continuous from any angle a
    screenshot is taken from and still has a seam every segment; mesh collision
    is per-triangle, so those seams are doors. Players find them in minutes.

    So this ignores the scenery entirely and walks the perimeter of the declared
    bounds in `step` stud increments, asking one question at each point: is
    there a barrier box covering it, tall enough that a jump will not clear it.

    It also checks the other direction - that no standable surface exists
    OUTSIDE the barrier - because a boundary with the play area on the wrong
    side of it is closed and useless.
    """
    # MIN_H COMES FROM THE MOVEMENT PROFILE, NOT FROM A CONSTANT. It was 14.0,
    # a number with no provenance, in a skill whose entire premise is that
    # movement numbers are read from a profile with a `src` on every value. The
    # question the check is really asking is "can a player get over this under
    # their own power", and Roblox has no mantle, so the answer is the jump
    # apex - 6.37 studs at this game's JumpPower, against 8.16 in a default
    # profile. 14 would have called a correctly sealed waist-high parapet open,
    # and on a taller-jumping game it would have called a genuinely open map
    # sealed. The 15% margin covers jumping from a bump or the foot of a slope.
    apex = m.profile.get("jumpApex", 6.37)
    if min_h is None:
        min_h = apex * 1.15

    bars = [b for b in m.boxes if b.meta.get("barrier")]
    if not bars:
        # An open map is legitimate (a sky arena where falling off IS the
        # ring-out), but only when the spec says so, with a reason - never by
        # silence. P16 prints the reason so the exemption is never hidden.
        why = m.source.get("open_edges")
        if why:
            return Check("P16", "Enclosure", INFO, f"open edges by declaration: {why}")
        return Check("P16", "Enclosure", WARN,
                     "no barrier declared - the map is open at the edges. Most maps "
                     "want a boundary: invisible wall parts with \"barrier\": true, "
                     "one per side. For an open map set \"open_edges\": \"<reason>\".")

    (lo, hi) = m.bounds
    x0, z0, x1, z1 = lo[0], lo[2], hi[0], hi[2]

    def covered(px, pz):
        for b in bars:
            (blo, bhi) = b.aabb()
            if blo[0] <= px <= bhi[0] and blo[2] <= pz <= bhi[2]:
                if (bhi[1] - blo[1]) >= min_h:
                    return True
        return False

    gaps, total = [], 0
    edges = ([(x, z0) for x in _frange(x0, x1, step)]
             + [(x, z1) for x in _frange(x0, x1, step)]
             + [(x0, z) for z in _frange(z0, z1, step)]
             + [(x1, z) for z in _frange(z0, z1, step)])
    for px, pz in edges:
        total += 1
        if not covered(px, pz):
            gaps.append((round(px), round(pz)))

    outside = 0
    if r and r.components:
        pad = 2.0
        for c in r.components:
            for n in c.nodes:
                if (n.x < x0 - pad or n.x > x1 + pad
                        or n.z < z0 - pad or n.z > z1 + pad):
                    outside += 1

    # A BOUNDARY MUST STAND ON THE GROUND. Placed at 248 when the ground plane
    # stopped at 235, the whole ring hung 13 studs off the edge and the peaks -
    # set a further 26 studs back - stood on the baseplate far below the island.
    # Every prover check passed, because boundary scenery is decor and decor is
    # exempt from grounding.
    floating = []
    ground = [b for b in m.boxes
              if b.solid and b.visible and not b.meta.get("decor")
              and max(b.size[0], b.size[2]) > 60.0]
    # Support is the UNION of the ground slabs. Asking whether any ONE slab
    # covers the piece failed 22 segments that were sitting perfectly well
    # across the join between two - this map's ground is four slabs with a hole
    # cut for the lake, not one plane.
    def supported(px, pz):
        for g in ground:
            (glo, ghi) = g.aabb()
            if glo[0] <= px <= ghi[0] and glo[2] <= pz <= ghi[2]:
                return True
        return False

    for b in m.boxes:
        if "boundary" not in b.roles or b.meta.get("barrier"):
            continue
        cx, cz = b.centre[0], b.centre[2]
        qx, qz = b.size[0] * 0.3, b.size[2] * 0.3
        samples = [(cx, cz), (cx - qx, cz), (cx + qx, cz),
                   (cx, cz - qz), (cx, cz + qz)]
        if sum(1 for px, pz in samples if supported(px, pz)) < 3:
            floating.append(b.name)

    # The ring must be the height it was ASKED for. Scaling segments to fill
    # their span made a 63 stud cliff from a declared 30 - ScaleTo is uniform,
    # so a width fit silently sets the height too. Nothing caught it; the ring
    # simply looked like a fortress from outside and nobody was outside.
    scenery = [b for b in m.boxes
               if "boundary" in b.roles and not b.meta.get("barrier")
               and b.meta.get("mesh")]
    tall = []
    want = None
    for part in (m.source.get("parts") or []):
        if part.get("kit") == "boundary":
            want = float((part.get("params") or {}).get("height", 34.0))
    if want and scenery:
        segs = [b for b in scenery if "peak" not in b.name.lower()]
        if segs:
            got = sum(b.size[1] for b in segs) / len(segs)
            if abs(got - want) / want > 0.20:
                tall.append(f"boundary declared height {want:.0f} but the "
                            f"segments average {got:.0f} studs - ScaleTo is "
                            f"uniform, so scale from the height, not the span")

    # AND THE BARRIER IS ONLY AS TALL AS THE GROUND BESIDE IT. A 12-stud wall
    # with a 10-stud crate against it is a 2-stud wall. Written because an
    # arena map had exactly this and the box-height test above passed
    # it: the outer terrace (top y=12) butted against the parapet (top y=16), a
    # 4-stud step inside a 6.37-stud jump, so every player could hop the
    # boundary at will and walk off the map. Nothing in the prover saw it.
    # Only nodes BELOW the barrier top count - a node on top of it, or on
    # something taller than it, is not using the barrier as a step.
    hop = m.profile.get("jumpDistance.sprint", 10.5)
    breach = []
    for b in bars:
        (blo, bhi) = b.aabb()
        for c in (r.components if r else []):
            for n in c.nodes:
                if n.y >= bhi[1] - 0.5 or n.y + apex <= bhi[1]:
                    continue
                dx = max(blo[0] - n.x, 0.0, n.x - bhi[0])
                dz = max(blo[2] - n.z, 0.0, n.z - bhi[2])
                if math.hypot(dx, dz) <= hop:
                    breach.append(
                        f"{b.name} tops out at y={bhi[1]:.1f} but there is "
                        f"standable ground at y={n.y:.1f} only "
                        f"{math.hypot(dx, dz):.1f} studs away ({n.box}) - a "
                        f"{bhi[1] - n.y:.1f} stud step against a {apex:.2f} "
                        f"stud jump, so the boundary can be hopped")
                    break
            if breach and breach[-1].startswith(b.name):
                break

    rows = list(tall) + breach
    if floating:
        rows.append(f"{len(floating)} boundary piece(s) are not standing on any "
                    f"ground surface - the ring hangs off the edge "
                    f"({', '.join(floating[:3])})")
    if gaps:
        rows.append(f"{len(gaps)} of {total} perimeter samples have no barrier "
                    f"at least {min_h:.0f} studs tall")
        rows += [f"gap at ({x}, {z})" for x, z in gaps[:6]]
    if outside:
        rows.append(f"{outside} standable node(s) lie OUTSIDE the declared "
                    f"bounds - the barrier is in the wrong place")
    if rows:
        return Check("P16", "Enclosure", FAIL, "the map is not sealed", rows[:8])
    return Check("P16", "Enclosure", PASS,
                 f"perimeter sealed by {len(bars)} barrier(s) at {total} samples")


def _frange(a, b, step):
    n = max(1, int((b - a) / step))
    return [a + (b - a) * i / n for i in range(n + 1)]
