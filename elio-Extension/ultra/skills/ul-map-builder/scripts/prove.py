"""The prover. Nine checks against the resolved tree.

It judges nothing aesthetic, by design. The question is never "is this map any
good" but "does the built geometry match what the spec declared", which has a
right answer. Taste stays with the human; arithmetic comes here.

Run:  python prove.py duel_arena
      python prove.py ../specs/duel_arena.json --res 3 --json report.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys

import checks_design as design
import reach
import spec as specmod
from geom import raycast, segment_blocked, vadd

PASS, FAIL, WARN, UNVERIFIABLE, INFO = "PASS", "FAIL", "WARN", "UNVERIFIABLE", "INFO"
ORDER = {FAIL: 0, UNVERIFIABLE: 1, WARN: 2, PASS: 3, INFO: 4}

# Which role a shipped ability needs to find somewhere in the map.
ABILITY_ROLES = {
    "wallClimb": ("wallride",),
    "wallJump": ("wallride",),
    "slideJump": ("slide_lane", "arena_floor"),
    "trimp": ("core_access", "ramp"),
    "grapple": ("grapple_anchor",),
}


def is_decor(b):
    """Decorative geometry is REAL - it blocks rays, breaks sightlines and can
    be stood on by accident - but it is never a declared destination and it is
    expected to interpenetrate. Greeble that had to be individually declared
    would not be greeble."""
    return bool(b.meta.get("decor"))


class Check:
    def __init__(self, cid, title, status, detail, rows=None):
        self.id = cid
        self.title = title
        self.status = status
        self.detail = detail
        self.rows = rows or []

    def to_dict(self):
        return {"id": self.id, "title": self.title, "status": self.status,
                "detail": self.detail, "rows": self.rows}


# --------------------------------------------------------------------------
# P1 grounding
# --------------------------------------------------------------------------

def p1_grounding(m):
    rows, bad = [], 0
    solid = [b for b in m.boxes if b.solid]
    for b in m.boxes:
        want = b.meta.get("grounded")
        if want is None:
            continue
        lo, hi = b.aabb()
        gaps = []
        for fx in (0.25, 0.5, 0.75):
            for fz in (0.25, 0.5, 0.75):
                x = lo[0] + (hi[0] - lo[0]) * fx
                z = lo[2] + (hi[2] - lo[2]) * fz
                hit = raycast((x, b.bottom + 0.05, z), (0.0, -1.0, 0.0), solid,
                              tmax=200.0, ignore=(b.name,))
                gaps.append(hit.t - 0.05 if hit else math.inf)
        gap = min(gaps)
        touching = gap <= 0.05
        if want and not touching:
            rows.append(f"{b.name}: declared grounded but floats {gap:.2f} studs above anything")
            bad += 1
        elif (not want) and touching:
            rows.append(f"{b.name}: declared floating but rests on geometry")
            bad += 1
    if bad:
        return Check("P1", "Grounding", FAIL,
                     f"{bad} part(s) do not sit where the spec says", rows)
    return Check("P1", "Grounding", PASS,
                 "every part with a declared grounding sits as declared")


# --------------------------------------------------------------------------
# P2/P3 reachability and intent
# --------------------------------------------------------------------------

def p2_p3_reach(m, r):
    checks = []
    stand_rows = []
    decor = {b.name for b in m.boxes if is_decor(b)}

    # TRANSIT IS EXEMPT FROM P2 AS WELL AS FROM P3, and until now it was only
    # exempt from P3. SKILL.md describes `transit` as the flag that stops the
    # prover "judging its 4x4 top as a floor and complaining that nobody can
    # stand there" - which is a description of P2, not P3, and P2 never read it.
    # Found on an arena map: putting a decorative bronze capping band
    # on top of the parapet removed the parapet's headroom, so all four lips and
    # all four corner bastions - every one of them declared `transit`, none of
    # them a destination - came back as "has a top surface but no standable
    # patch on it" and held the whole map at WARN. A part nobody is meant to
    # stand on having nowhere to stand is the design working.
    try:
        skip = decor | set(m.match_names(m.intent.get("transit", [])))
    except specmod.SpecError:
        skip = decor
    struct_unstandable = sorted(r.unstandable - skip)
    if struct_unstandable:
        stand_rows = [f"{n}: has a top surface but no standable patch on it"
                      for n in struct_unstandable]
    checks.append(Check(
        "P2", "Standable surface",
        WARN if struct_unstandable else PASS,
        f"{r.node_count} nodes across {len(r.components)} walk-connected components",
        stand_rows + [f"note: {n}" for n in r.notes]))

    intent = m.intent
    try:
        want = set(m.match_names(intent.get("reachable", [])))
    except specmod.SpecError as e:
        return checks + [Check("P3", "Intent match", FAIL, str(e))]

    only_by = {}
    for pat, tech in intent.get("reachableOnlyBy", {}).items():
        for name in m.match_names([pat]):
            only_by[name] = tech

    # A part whose job is to be climbed or shot at, not stood on. Its top face
    # exists but is not a destination, so judging it as a floor produces a
    # confident complaint about a part that is doing exactly its job.
    transit = set(m.match_names(intent.get("transit", []))) if intent.get("transit") else set()

    rows, worst = [], PASS
    for b in m.boxes:
        if not b.solid or b.name in r.unstandable or b.name in transit:
            continue
        if is_decor(b):
            continue
        st = r.status.get(b.name, reach.NO)
        if b.name in want:
            if st == reach.NO:
                rows.append(f"{b.name}: intended reachable, but NO route exists")
                worst = FAIL
            elif st == reach.MAYBE:
                rows.append(f"{b.name}: intended reachable, but only via the generous envelope")
                worst = WARN if worst != FAIL else worst
        elif b.name in only_by:
            tech = only_by[b.name]
            shipped = m.profile.shipped(tech)
            if st == reach.DEFINITE:
                rows.append(f"{b.name}: meant to need '{tech}', but plain movement reaches it")
                worst = FAIL
            elif not shipped:
                rows.append(f"{b.name}: gated behind '{tech}', which is NOT in the movement "
                            f"profile - cannot be verified either way")
                worst = UNVERIFIABLE if worst not in (FAIL,) else worst
        else:
            if st == reach.DEFINITE:
                rows.append(f"{b.name}: reachable but the spec never says it should be")
                worst = FAIL
            elif st == reach.MAYBE:
                rows.append(f"{b.name}: possibly reachable and not declared")
                worst = WARN if worst == PASS else worst

    for grp in r.trapped:
        rows.append(f"{grp}: reachable, but nothing leads back to a spawn")
        worst = FAIL

    checks.append(Check("P3", "Intent match", worst,
                        "declared reachability vs computed" if rows else
                        "every surface is reachable exactly as declared", rows))

    mrows, seen_routes = [], set()
    for name, (margin, used, budget, src) in sorted(r.margins.items()):
        if margin > 0.25:
            continue
        key = (tuple(src), round(used, 2))
        if key in seen_routes:
            continue                      # one route, not one row per part it lands on
        seen_routes.add(key)
        mrows.append(f"return from {src} spends {used:.1f} of {budget:.1f} studs of "
                     f"climb budget, margin {margin:.2f}")
    checks.append(Check(
        "P2b", "Recovery margin", WARN if mrows else PASS,
        "wall-climb budget left over on the tightest return route"
        if mrows else "no return route runs the climb budget to zero", mrows))
    return checks


# --------------------------------------------------------------------------
# P4 anchors
# --------------------------------------------------------------------------

def p4_anchors(m, r):
    rows, worst = [], PASS
    solid = [b for b in m.boxes if b.solid]
    for kind, patterns in m.anchors.items():
        try:
            names = m.match_names(patterns)
        except specmod.SpecError as e:
            return Check("P4", "Anchor legitimacy", FAIL, str(e))
        ability = m.profile.ability(kind)
        rng = (ability or {}).get("range")
        shipped = m.profile.shipped(kind)
        for name in names:
            b = m.by_name(name)
            if not b.solid:
                rows.append(f"{name}: listed as a {kind} anchor but is not solid")
                worst = FAIL
                continue
            if not b.visible:
                rows.append(f"{name}: listed as a {kind} anchor but is invisible - "
                            f"players cannot see what they are aiming at")
                worst = FAIL
        # An anchor nobody can reach with the tool is decoration.
        if rng and shipped:
            nodes = [n for c in r.components for n in c.nodes]
            for name in names:
                b = m.by_name(name)
                if not any(_dist(n.p, b.centre) <= rng for n in nodes):
                    rows.append(f"{name}: no standable spot within {rng} studs of it")
                    worst = FAIL if worst != FAIL else worst
        elif rng and not shipped:
            rows.append(f"{kind}: range {rng} declared but the ability is not in the "
                        f"movement profile - anchor spacing NOT verified")
            worst = UNVERIFIABLE if worst == PASS else worst

    return Check("P4", "Anchor legitimacy", worst,
                 "every declared anchor is solid, visible and in range"
                 if worst == PASS else "anchor problems", rows)


def _dist(a, b):
    return math.dist(a, b)


# --------------------------------------------------------------------------
# P5 sightlines
# --------------------------------------------------------------------------

def p5_sightlines(m, r, sample=180, seed=7):
    cfg = m.sightlines
    if not cfg:
        return Check("P5", "Sightlines", INFO, "no sightline band declared")
    eye = m.profile.get("eyeHeight", 4.5)
    nodes = [n for c in r.components for n in c.nodes]
    if len(nodes) < 4:
        return Check("P5", "Sightlines", INFO, "too few standable nodes to sample")
    rng = random.Random(seed)
    pick = rng.sample(nodes, min(sample, len(nodes)))
    solid = [b for b in m.boxes if b.solid]
    clear = total = 0
    for i in range(len(pick)):
        for j in range(i + 1, len(pick)):
            a = vadd(pick[i].p, (0.0, eye, 0.0))
            b = vadd(pick[j].p, (0.0, eye, 0.0))
            total += 1
            if segment_blocked(a, b, solid, ignore=(pick[i].box, pick[j].box), pad=0.1) is None:
                clear += 1
    frac = clear / total if total else 0.0
    lo = cfg.get("minClearFraction", 0.0)
    hi = cfg.get("maxClearFraction", 1.0)
    detail = f"{frac:.1%} of {total} sampled pairs have a clear line (band {lo:.0%}-{hi:.0%})"
    if frac < lo:
        return Check("P5", "Sightlines", FAIL,
                     detail + " - too enclosed, cover is eating every duel")
    if frac > hi:
        return Check("P5", "Sightlines", FAIL,
                     detail + " - too open, there is nowhere to break line of sight")
    return Check("P5", "Sightlines", PASS, detail)


# --------------------------------------------------------------------------
# P6 overlap
# --------------------------------------------------------------------------

def p6_overlap(m, tol=0.01, joint=1.0):
    """Deep interpenetration is a modelling error. A SHALLOW overlap is how two
    surfaces are joined without a seam, and a bridge that butts its deck exactly
    against an island edge is only reachable by a jump. So overlaps up to
    `joint` studs are reported and not failed.

    One stud is the threshold: it is half the ~2 stud auto-step, so a player
    cannot feel it, and it is an order of magnitude smaller than a real
    modelling error. Raised beds sunk into a ground plane and paths meeting a
    plaza generated 78 overlaps of 0.55-0.60 studs on the farm map - all of them
    correct construction. The number was raised once, for that reason, and is
    not a dial to turn until a map passes."""
    from geom import boxes_overlap, penetration_depth
    rows, joints = [], []
    bs = m.boxes
    for i in range(len(bs)):
        for j in range(i + 1, len(bs)):
            if is_decor(bs[i]) or is_decor(bs[j]):
                continue
            if boxes_overlap(bs[i], bs[j], tol):
                d = penetration_depth(bs[i], bs[j])
                line = f"{bs[i].name} and {bs[j].name} overlap by {d:.2f} studs"
                (joints if d <= joint else rows).append(line)
    if rows:
        return Check("P6", "Overlap", FAIL,
                     f"{len(rows)} interpenetrating pair(s)", rows + joints)
    if joints:
        return Check("P6", "Overlap", PASS,
                     f"no interpenetration; {len(joints)} shallow joint(s) "
                     f"within the {joint} stud tolerance", joints)
    n_decor = sum(1 for b in bs if is_decor(b))
    return Check("P6", "Overlap", PASS,
                 f"no structural parts interpenetrate "
                 f"({len(bs) - n_decor} structural, {n_decor} decorative skipped)")


# --------------------------------------------------------------------------
# P7 role coverage
# --------------------------------------------------------------------------

def p7_roles(m):
    rows, worst = [], PASS
    all_roles = set()
    for b in m.boxes:
        if not is_decor(b):
            all_roles.update(b.roles)
    for ability, roles in ABILITY_ROLES.items():
        if not m.profile.shipped(ability):
            continue
        if not any(rl in all_roles for rl in roles):
            rows.append(f"{ability} is shipped but no part serves it "
                        f"(wanted a part with role {' or '.join(roles)})")
            worst = WARN
    counts = {}
    for b in m.boxes:
        if is_decor(b):
            continue
        for rl in b.roles:
            counts[rl] = counts.get(rl, 0) + 1
    rows.append("roles: " + ", ".join(f"{k}x{v}" for k, v in sorted(counts.items())))
    return Check("P7", "Role coverage", worst,
                 "every shipped movement tech has somewhere to live"
                 if worst == PASS else "a shipped tech has no home in this map", rows)


# --------------------------------------------------------------------------
# P8 symmetry
# --------------------------------------------------------------------------

def p8_symmetry(m, tol=0.05):
    """Groups congruent parts by size and checks that copies sitting at the same
    radius are EQUALLY SPACED in angle. Catches the hand-placed-and-nearly-right
    case, which is how jump pads end up scattered."""
    rows, worst = [], PASS
    groups = {}
    for b in m.boxes:
        if is_decor(b):
            continue
        # A ROUTE IS A LINE, NOT A RING. Congruent slabs laid end to end along a
        # road sit at similar distances from the origin, so the even-spacing test
        # reads three consecutive road segments as a badly spaced ring of three
        # and fails a map that is correct. Symmetry is a claim about arena
        # furniture; route surfaces are exempt.
        if {"main_route", "side_route"} & set(b.roles or []):
            continue
        key = (round(b.size[0], 3), round(b.size[1], 3), round(b.size[2], 3),
               round(b.centre[1], 3))
        groups.setdefault(key, []).append(b)
    for key, members in sorted(groups.items()):
        if len(members) < 3:
            continue
        radii = [math.hypot(b.centre[0], b.centre[2]) for b in members]
        mean_r = sum(radii) / len(radii)
        if mean_r < 1.0:
            continue
        spread = max(radii) - min(radii)
        # A ring is identified LOOSELY and then judged strictly. Requiring the
        # radii to already match before checking the angles meant a scattered
        # ring was excluded from the ring check precisely because it was
        # scattered, which is the one case the check exists for.
        if spread > 0.15 * mean_r:
            continue
        names = ", ".join(b.name for b in members)
        angles = sorted(math.degrees(math.atan2(b.centre[2], b.centre[0])) % 360.0
                        for b in members)
        gaps = [(angles[(i + 1) % len(angles)] - angles[i]) % 360.0
                for i in range(len(angles))]
        want = 360.0 / len(angles)
        bad_angle = max(abs(g - want) for g in gaps) > 1.0
        bad_radius = spread > tol
        if bad_angle or bad_radius:
            why = []
            if bad_angle:
                why.append(f"gaps {[round(g, 1) for g in gaps]}, expected {want:.1f} each")
            if bad_radius:
                why.append(f"radii {[round(x, 1) for x in radii]} differ by {spread:.2f}")
            rows.append(f"{names}: congruent parts near radius {mean_r:.1f} are not an "
                        f"even ring ({'; '.join(why)})")
            worst = FAIL
        else:
            rows.append(f"{names}: even {len(angles)}-fold ring at radius {mean_r:.1f}")
    if not rows:
        return Check("P8", "Symmetry", INFO, "no congruent ring of 3 or more parts to check")
    return Check("P8", "Symmetry", worst,
                 "every detected ring is evenly spaced" if worst == PASS
                 else "a ring of congruent parts is uneven", rows)


# --------------------------------------------------------------------------
# P9 ring-out counterplay
# --------------------------------------------------------------------------

def p9_ringout(m):
    ro = m.intent.get("ringOut")
    if not ro:
        return Check("P9", "Ring-out counterplay", INFO, "no ring-out declared")
    g = m.profile.get("gravity", 120.0)
    ragdoll = m.profile.get("ragdollRecovery", 0.5)
    need = ro.get("minWindow", 1.0)
    tech = ro.get("counterplay")
    try:
        froms = m.match_names(ro.get("from", []))
    except specmod.SpecError as e:
        return Check("P9", "Ring-out counterplay", FAIL, str(e))

    # A RING-OUT WITH NO COUNTERPLAY ASKS A DIFFERENT QUESTION, and asking the
    # recovery-window question anyway gives a confidently wrong answer.
    #
    # The window model is: you are launched, you ragdoll for `ragdollRecovery`,
    # and the fall has to last long enough that you get control back and can
    # spend your counterplay tech. That is the right question for a map with a
    # grapple or a double jump. When the spec declares `counterplay: "none"`,
    # the map is asserting the opposite - that being launched off IS the
    # elimination and nothing can save you - and the check would then demand a
    # fall LONGER than the ragdoll purely so the corpse regains control before
    # it dies. Measured on an arena map: it demanded the kill plane
    # move from y=-160 to y=-394, a 2.83 second fall, to buy back control that
    # the design says does not exist. game.json's FallKillPlaneY is a shared
    # config value and the fall is meant to be short and fatal.
    #
    # So with "none" declared, P9 checks the two things that still have right
    # answers, and it is not allowed to go quiet:
    #   1. every ring-out edge is genuinely above the ring-out height, and
    #   2. NOTHING SOLID sits between an edge and the kill plane. A fall that
    #      lands on the map's own underside decoration is not an elimination.
    # (2) is a real defect this found: a 184-stud non-decor-facing keel slab
    # hung under the plaza and would have caught anyone punted off the edge.
    if tech == "none":
        rows, worst = [], PASS
        if not froms:
            return Check("P9", "Ring-out counterplay", INFO,
                         "ring-out declares no counterplay and names no edge to "
                         "be launched off, so there is nothing to measure")
        lowest_edge = min(m.by_name(n).top for n in froms)
        for name in froms:
            b = m.by_name(name)
            if b.top - m.ring_out_y <= 0:
                rows.append(f"{name}: sits at or below the ring-out height")
                worst = FAIL
                continue
            t = math.sqrt(2.0 * (b.top - m.ring_out_y) / g)
            rows.append(f"{name}: falls {b.top - m.ring_out_y:.0f} studs to the "
                        f"ring-out at y={m.ring_out_y:.0f} in {t:.2f}s, unrecoverable "
                        f"by declaration (counterplay 'none')")
        ledges = []
        for b in m.boxes:
            if not b.solid:
                continue
            if b.top >= lowest_edge - 0.01:
                continue
            if b.top <= m.kill_plane:
                continue
            ledges.append(f"{b.name} is solid at y={b.top:.1f}, between the "
                          f"ring-out edge and the kill plane at "
                          f"y={m.kill_plane:.0f} - a launched player lands on it")
        if ledges:
            rows += ledges
            worst = FAIL
        return Check("P9", "Ring-out counterplay", worst,
                     "ring-out declares no counterplay; the fall is clear to the "
                     "kill plane and fatal by design" if worst == PASS
                     else "the fall is not clear to the kill plane", rows)

    rows, worst = [], PASS
    tightest = None
    for name in froms:
        b = m.by_name(name)
        h = b.top - m.ring_out_y
        if h <= 0:
            rows.append(f"{name}: sits at or below the ring-out height")
            worst = FAIL
            continue
        t = math.sqrt(2.0 * h / g)
        window = t - ragdoll
        if tightest is None or window < tightest[1]:
            tightest = (name, window, t, h)
        verdict = "ok" if window >= need else "TOO SHORT"
        rows.append(f"{name}: falls {h:.0f} studs to the ring-out at y={m.ring_out_y:.0f} "
                    f"in {t:.2f}s; after {ragdoll:.2f}s of ragdoll that leaves "
                    f"{window:.2f}s of control (need {need:.2f}s) - {verdict}")
        if window < need:
            worst = FAIL

    if worst == FAIL:
        t_need = need + ragdoll
        h_need = 0.5 * g * t_need * t_need
        # The constraint binds at the LOWEST ring-out edge, not the highest:
        # solve for the edge with the least fall available and every other edge
        # clears it for free. Using max() here sized the plane off the
        # Outriggers and left the Deck 0.26s short.
        top = min(m.by_name(n).top for n in froms)
        y_ro = top - h_need
        y_kill = y_ro - (m.ring_out_y - m.kill_plane)
        rows.append(f"FIX: {t_need:.2f}s of fall is needed from the LOWEST ring-out edge "
                    f"(y={top:.0f}), which is {h_need:.0f} studs, so the ring-out must fire "
                    f"at y={y_ro:.0f} and the kill plane must sit at y={y_kill:.0f} "
                    f"or lower (currently {m.kill_plane:.0f}).")
        if tech and not m.profile.shipped(tech):
            rows.append(f"NOTE: '{tech}' is the declared counterplay but is not in the "
                        f"movement profile, so this window currently buys nothing.")
        return Check("P9", "Ring-out counterplay", FAIL,
                     f"a player punted off {tightest[0]} gets {tightest[1]:.2f}s of control, "
                     f"needs {need:.2f}s", rows)
    return Check("P9", "Ring-out counterplay", PASS,
                 f"every ring-out edge leaves at least {need:.2f}s of control", rows)


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def run(m, res=4.0, terrain_out=None):
    import checks_budget
    r = reach.analyse(m, res=res)
    checks = [p1_grounding(m)]
    checks += p2_p3_reach(m, r)
    checks += [p4_anchors(m, r), p5_sightlines(m, r), p6_overlap(m),
               p7_roles(m), p8_symmetry(m), p9_ringout(m),
               design.p10_coplanar(m, Check, PASS, FAIL),
               design.p11_density(m, r, Check, PASS, FAIL, WARN, INFO),
               design.p12_entrances(m, Check, PASS, FAIL, INFO),
               design.p13_dressing(m, Check, PASS, FAIL, INFO),
               design.p14_props_in_water(m, Check, PASS, FAIL, INFO),
               design.p15_props_on_routes(m, Check, PASS, FAIL, INFO),
               design.p16_enclosure(m, r, Check, PASS, FAIL, WARN, INFO),
               checks_budget.p21_budget(m, Check, PASS, FAIL, WARN, INFO, UNVERIFIABLE)]
    # ORGANIC GROUND IS PROVEN, NOT PROMISED. A map with a terrain block gets the
    # T checks; a map without one is refused at load time if it builds its
    # ground from slabs (spec.py). See checks_terrain.py.
    if m.source.get("terrain"):
        import checks_terrain
        import terrain as terrainmod
        from types import SimpleNamespace
        t = terrainmod.generate(m.source, terrain_out, preview=bool(terrain_out))
        C = SimpleNamespace(Check=Check, PASS=PASS, FAIL=FAIL, WARN=WARN, INFO=INFO)
        checks += checks_terrain.run(t, m.source, m.profile, C)
    return checks, r


def report(m, checks, r):
    out = []
    n_decor = sum(1 for b in m.boxes if is_decor(b))
    out.append(f"MAP  {m.name}    profile {m.profile.name}    "
               f"{len(m.boxes)} parts "
               f"({len(m.boxes) - n_decor} structural / {n_decor} decorative), "
               f"{r.node_count} standable nodes")
    assumed = m.profile.assumed_fields()
    if assumed:
        out.append(f"     profile values NOT measured: {', '.join(assumed)}")
    uns = m.profile.unshipped_abilities()
    if uns:
        out.append(f"     abilities in the spec but NOT in the game: {', '.join(uns)}")
    out.append("")
    worst = PASS
    for c in sorted(checks, key=lambda c: c.id):
        if ORDER[c.status] < ORDER[worst]:
            worst = c.status
        out.append(f"[{c.status:13s}] {c.id}  {c.title}")
        out.append(f"{'':16s}{c.detail}")
        for row in c.rows:
            out.append(f"{'':18s}- {row}")
        out.append("")
    out.append(f"RESULT: {worst}")
    return "\n".join(out), worst


def main(argv=None):
    ap = argparse.ArgumentParser(description="Prove a Roblox map spec.")
    ap.add_argument("spec")
    ap.add_argument("--res", type=float, default=4.0,
                    help="surface sampling resolution in studs (default 4)")
    ap.add_argument("--json", help="also write the report as JSON")
    a = ap.parse_args(argv)

    m = specmod.load(a.spec)
    checks, r = run(m, res=a.res)
    text, worst = report(m, checks, r)
    print(text)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"map": m.name, "result": worst,
                       "checks": [c.to_dict() for c in checks]}, f, indent=2)
    return 0 if worst in (PASS, INFO) else 1


if __name__ == "__main__":
    sys.exit(main())
