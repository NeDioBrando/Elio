"""Reachability: can a player actually get there, and can they get somewhere
they should not?

Deliberately NOT PathfindingService. Measured 2026-08-27 against a live Studio
edit session: ComputeAsync returned Success for a 1.5-stud step, a 3-stud step
AND a 12-stud unclimbable wall (identical 39 waypoints each time), then on a
second run returned NoPath for an empty void, a solid wall and a wide-open
doorway alike. The edit-mode navmesh lags geometry edits by more than 2s and
does not reliably rebuild. A confident pass on an unclimbable wall is the exact
failure this skill exists to prevent, so reachability is computed here from
raycasts and the movement profile instead.

THE TRI-STATE. Any envelope model is an approximation, and the two questions
this module answers want the error to point in opposite directions:

  "can I reach the Ledge?"            wants a CONSERVATIVE envelope
  "can I reach outside the map?"      wants a GENEROUS one

So both are computed. A surface is DEFINITE if the conservative envelope gets
there, MAYBE if only the generous one does, and NO if neither. Callers must not
collapse MAYBE into either neighbour.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from geom import Box, BoxIndex, raycast, segment_blocked, vadd, vdist, vsub

DEFINITE, MAYBE, NO = "definite", "maybe", "no"


@dataclass
class Node:
    x: float
    y: float
    z: float
    box: str

    @property
    def p(self):
        return (self.x, self.y, self.z)


@dataclass
class Component:
    id: int
    nodes: list = field(default_factory=list)
    boxes: set = field(default_factory=set)
    boundary: list = field(default_factory=list)


@dataclass
class ReachResult:
    status: dict                # box name -> DEFINITE / MAYBE / NO
    components: list
    node_count: int
    edges: dict                 # (from_comp, to_comp) -> [how, ...]
    unstandable: set            # boxes with a top surface but nowhere to stand
    trapped: list = field(default_factory=list)   # reachable, but no route back
    margins: dict = field(default_factory=dict)   # box -> tightest climb margin
    notes: list = field(default_factory=list)


# --------------------------------------------------------------------------
# surface extraction
# --------------------------------------------------------------------------

def extract_nodes(boxes, profile, res=4.0):
    """One node per standable patch of every top surface.

    A patch is standable when it is the topmost solid surface at that (x, z)
    AND there is at least charHeight of clear air above it. The headroom test
    is what correctly rejects the tucked-in half of a shelf slung under a deck.
    """
    char_h = profile.get("charHeight", 5.0)
    max_slope = profile.get("maxWalkSlope", 89)
    nodes = []
    unstandable = set()
    solid = [b for b in boxes if b.solid]
    index = BoxIndex(solid)

    # A dressed map is mostly greeble: crates, crenellations, banners, trim.
    # Each one is a separate walk-component, and the component graph is tested
    # pairwise, so 600 parts of decoration turned a 0.9s check into minutes.
    # A surface narrower than the character cannot be stood on in any useful
    # sense, so decorative parts below that size generate no nodes. They still
    # block rays, which is the part that matters for sightlines and clearance.
    min_stand = profile.get("charRadius", 2.0) * 2.0

    for b in boxes:
        if not b.solid:
            continue
        if b.surface_slope_deg() > max_slope:
            continue
        if b.meta.get("decor"):
            lo_, hi_ = b.aabb()
            if min(hi_[0] - lo_[0], hi_[2] - lo_[2]) < min_stand:
                continue
        lo, hi = b.aabb()
        nx = max(1, int(math.ceil((hi[0] - lo[0]) / res)))
        nz = max(1, int(math.ceil((hi[2] - lo[2]) / res)))
        found = False
        for i in range(nx):
            for j in range(nz):
                x = lo[0] + (i + 0.5) * (hi[0] - lo[0]) / nx
                z = lo[2] + (j + 0.5) * (hi[2] - lo[2]) / nz
                y = b.surface_height(x, z)
                if y is None:
                    continue
                local = index.at(x, z)
                if not _is_top_surface(x, y, z, b, local):
                    continue
                if not _has_headroom(x, y, z, b, local, char_h):
                    continue
                nodes.append(Node(x, y, z, b.name))
                found = True
        if not found:
            unstandable.add(b.name)
    return nodes, unstandable


def _is_top_surface(x, y, z, box, solid, eps=0.05):
    """Nothing else may occupy the space just above this point."""
    probe = (x, y + eps + 0.01, z)
    for o in solid:
        if o is box:
            continue
        if o.contains(probe):
            return False
    return True


def _has_headroom(x, y, z, box, solid, char_h):
    hit = raycast((x, y + 0.1, z), (0.0, 1.0, 0.0), solid,
                  tmax=char_h, ignore=(box.name,))
    return hit is None


# --------------------------------------------------------------------------
# walk connectivity
# --------------------------------------------------------------------------

def _cell(n, res):
    return (int(math.floor(n.x / res)), int(math.floor(n.z / res)))


def build_components(nodes, boxes, profile, res=4.0):
    """Union nodes that are joined by ordinary walking, then keep only the
    boundary of each component: those are the only places a jump or a climb can
    start, which is what keeps the transition search from being quadratic in
    the total node count."""
    step = profile.get("autoStep", 2.0)
    max_slope = profile.get("maxWalkSlope", 89)
    # A ramp is a CONTINUOUS surface, so the auto-step rule must not be applied
    # along it: at 4-stud sampling the duel-arena ramp rises 2.6 studs per node,
    # which read as eight unclimbable steps and split one ramp into eight
    # components. Same-box neighbours are judged on the surface slope instead.
    slope_ok = {b.name: b.surface_slope_deg() <= max_slope for b in boxes}
    parent = list(range(len(nodes)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    grid = {}
    for i, n in enumerate(nodes):
        grid.setdefault(_cell(n, res), []).append(i)

    solid = [b for b in boxes if b.solid]
    index = BoxIndex(solid)
    reach = res * 1.6
    interior = [True] * len(nodes)

    for i, n in enumerate(nodes):
        cx, cz = _cell(n, res)
        neighbours = 0
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if dx == 0 and dz == 0:
                    continue
                for j in grid.get((cx + dx, cz + dz), ()):
                    m = nodes[j]
                    if math.hypot(m.x - n.x, m.z - n.z) > reach:
                        continue
                    # Only a node you could actually WALK to counts towards
                    # being surrounded. Counting every node at any height let a
                    # platform hovering over the deck fill the deck's grid, so
                    # the deck edge beside it stopped being detected as an edge
                    # and no jump was ever tested from there.
                    if m.box == n.box:
                        if not slope_ok[n.box]:
                            continue
                    elif abs(m.y - n.y) > step:
                        continue
                    neighbours += 1
                    if segment_blocked(vadd(n.p, (0, 0.6, 0)),
                                       vadd(m.p, (0, 0.6, 0)),
                                       index.segment(n.p, m.p),
                                       ignore=(n.box, m.box), pad=0.05):
                        continue
                    union(i, j)
        # 8 in-plane neighbours means fully surrounded; fewer means an edge.
        if neighbours < 8:
            interior[i] = False

    groups = {}
    for i in range(len(nodes)):
        groups.setdefault(find(i), []).append(i)

    comps = []
    for cid, idxs in enumerate(sorted(groups.values(), key=lambda g: -len(g))):
        c = Component(id=cid)
        c.nodes = [nodes[i] for i in idxs]
        c.boxes = {nodes[i].box for i in idxs}
        c.boundary = [nodes[i] for i in idxs if not interior[i]]
        if not c.boundary:
            c.boundary = c.nodes[:]
        comps.append(c)
    return comps


# --------------------------------------------------------------------------
# movement envelopes
# --------------------------------------------------------------------------

def _jump_range(profile, dy, speed):
    """Horizontal distance available on a jump that must gain `dy`.

    Solves 0.5*g*t^2 - v0*t + dy = 0 and takes the descending root, so a jump
    that lands lower than it started gets its extra airtime counted.
    """
    g = profile.get("gravity", 120.0)
    v0 = profile.get("jumpPower", 50.0)
    disc = v0 * v0 - 2.0 * g * dy
    if disc < 0:
        return None                      # cannot gain that much height at all
    t = (v0 + math.sqrt(disc)) / g
    return speed * t


def _trajectory_clear(a, b, profile, boxes, ignore, samples=10):
    """Sample the actual parabola rather than the straight line. A jump that
    passes through a wall is not a jump."""
    g = profile.get("gravity", 120.0)
    v0 = profile.get("jumpPower", 50.0)
    dy = b[1] - a[1]
    disc = v0 * v0 - 2.0 * g * dy
    if disc < 0:
        return False
    T = (v0 + math.sqrt(disc)) / g
    prev = vadd(a, (0.0, 0.2, 0.0))
    for k in range(1, samples + 1):
        t = T * k / samples
        f = t / T
        x = a[0] + (b[0] - a[0]) * f
        z = a[2] + (b[2] - a[2]) * f
        y = a[1] + v0 * t - 0.5 * g * t * t
        cur = (x, max(y, min(a[1], b[1]) - 0.5), z)
        if segment_blocked(prev, cur, boxes, ignore=ignore, pad=0.0):
            return False
        prev = cur
    return True


def _wall_beside(node, boxes, profile, ignore):
    """Is there a climbable wall face within reach of this node?

    Probed at TWO heights, matching the game's own wall-climb high probe. One
    low probe is not enough and the duel arena is why: a player on a Ledge at
    y=-14 must climb the Deck's side face, which spans y=-12..0, so a probe at
    +1.5 passes underneath the very wall the recovery depends on.
    """
    reach = profile.get("abilities.wallClimb.reach", 3.5)
    heights = (1.5, profile.get("abilities.wallClimb.highProbeHeight", 3.0))
    for h in heights:
        origin = vadd(node.p, (0.0, h, 0.0))
        for d in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1)):
            hit = raycast(origin, d, boxes, tmax=reach, ignore=ignore)
            if hit:
                return hit.box, d
    return None, None


def _transitions(src, dst, profile, boxes, generous):
    """Every way a player might get from component `src` to component `dst`.
    Returns a list of labels, empty if there is no route."""
    ways = []
    speed = (profile.get("slideEntryCap", 32.0) if generous
             else profile.get("walkSpeed", 16.0))
    solid = [b for b in boxes if b.solid]

    climb_rise = 0.0
    if generous and profile.shipped("wallClimb"):
        climb_rise = profile.get("abilities.wallClimb.maxRise", 0.0)
    wj_rise = wj_travel = 0.0
    if generous and profile.shipped("wallJump"):
        wj_rise = profile.get("abilities.wallJump.rise", 0.0)
        wj_travel = profile.get("abilities.wallJump.travel", 0.0)

    apex = profile.get("jumpApex", 10.4)
    max_rise = apex + climb_rise + wj_rise
    # Longest hop worth testing, used purely to prune candidate pairs.
    max_span = max(_jump_range(profile, 0.0, speed) or 0.0, wj_travel)

    dst_nodes = dst.nodes
    for a in src.boundary:
        for b in dst_nodes:
            dy = b.y - a.y
            if dy > max_rise:
                continue
            flat = math.hypot(b.x - a.x, b.z - a.z)
            if flat > max_span + 1e-6:
                continue
            ig = (a.box, b.box)

            # 1. plain jump
            rng = _jump_range(profile, dy, speed)
            if rng is not None and flat <= rng + 1e-6:
                if _trajectory_clear(a.p, b.p, profile, solid, ig):
                    ways.append("jump")
                    return ways

            if not generous:
                continue

            wall, inward = _wall_beside(a, solid, profile, (a.box,))
            if wall is None:
                continue

            # 2. wall climb, then mantle over the lip.
            # You top out ON the face you climbed, so the destination must be
            # that part or something flush with its top. Without this the model
            # lets a player climb any wall and arrive anywhere nearby.
            if climb_rise and dy <= climb_rise + 1e-6:
                mantle_span = (profile.get("abilities.wallClimb.reach", 3.5)
                               + profile.get("abilities.wallClimb.mantleForward", 1.4)
                               + profile.get("charRadius", 2.0))
                mantle_rise = profile.get("abilities.wallClimb.maxMantleRise", 5.0)
                tops_out = (b.box == wall.name
                            or abs(b.y - wall.top) <= mantle_rise)
                if flat <= mantle_span and tops_out:
                    ways.append(f"wallClimb(+{dy:.1f} of {climb_rise:.1f})")
                    return ways

            # 3. climb then wall jump across.
            # A wall jump throws you AWAY from the face. Without the direction
            # test the model allowed a jump off the Ramp's side face to travel
            # 30 studs backwards over the wall and land on Post2, which is both
            # impossible and the reason a symmetric ring gave asymmetric answers.
            if wj_travel and dy <= climb_rise + wj_rise + 1e-6 and flat <= wj_travel:
                away = (-inward[0], 0.0, -inward[2])
                to_b = (b.x - a.x, 0.0, b.z - a.z)
                if flat > 1e-6 and (to_b[0] * away[0] + to_b[2] * away[2]) / flat > 0.0:
                    if not segment_blocked(vadd(a.p, (0, 2.0, 0)),
                                           vadd(b.p, (0, 1.0, 0)),
                                           solid, ignore=ig, pad=0.2):
                        ways.append("wallJump")
                        return ways
    return ways


# --------------------------------------------------------------------------
# top level
# --------------------------------------------------------------------------

def _edge_map(comps, profile, boxes, generous):
    """Every component-to-component transition. Computed in full rather than
    lazily during a flood, because the reverse direction is needed to answer
    'can you get back out' and recomputing it per query is wasteful at this
    component count."""
    edges = {}
    for src in comps:
        for dst in comps:
            if src.id == dst.id:
                continue
            ways = _transitions(src, dst, profile, boxes, generous)
            if ways:
                edges[(src.id, dst.id)] = ways
    return edges


def _flood(edges, start_ids):
    seen = set(start_ids)
    frontier = list(start_ids)
    while frontier:
        cid = frontier.pop()
        for (a, b) in edges:
            if a == cid and b not in seen:
                seen.add(b)
                frontier.append(b)
    return seen


def analyse(rmap, res=4.0):
    profile = rmap.profile
    boxes = rmap.boxes
    nodes, unstandable = extract_nodes(boxes, profile, res)
    comps = build_components(nodes, boxes, profile, res)

    # PRUNE FIRST, THEN RESOLVE SPAWNS. Components are renumbered by the prune,
    # so resolving spawn ids against the unpruned list and then flooding the
    # pruned one indexes the wrong components - on a 1000-part map that raised
    # IndexError, and on a smaller one it would have silently flooded from the
    # wrong place and reported a confident, wrong reachability.
    notes = []
    decor_names = {b.name for b in boxes if b.meta.get("decor")}
    live = [c for c in comps if not c.boxes <= decor_names]
    skipped = len(comps) - len(live)
    if skipped:
        notes.append(f"{skipped} component(s) made only of decoration were not "
                     f"analysed: decoration is never a declared destination")
    for i, c in enumerate(live):
        c.id = i
    comps = live

    # Spawn components: the component holding the node nearest each spawn.
    spawn_ids = set()
    for s in rmap.spawns:
        best, bestd = None, 1e18
        for c in comps:
            for n in c.nodes:
                d = vdist((s[0], n.y, s[2]), (n.x, n.y, n.z))
                if d < bestd:
                    best, bestd = c.id, d
        if best is None or bestd > res * 2.0:
            notes.append(f"spawn {s} has no standable surface within {res * 2:.0f} studs")
        if best is not None:
            spawn_ids.add(best)

    cons_edges = _edge_map(comps, profile, boxes, generous=False)
    gen_edges = _edge_map(comps, profile, boxes, generous=True)
    cons_ids = _flood(cons_edges, spawn_ids)
    gen_ids = _flood(gen_edges, spawn_ids)

    status = {}
    for b in boxes:
        if not b.solid:
            continue
        in_cons = any(b.name in comps[i].boxes for i in cons_ids)
        in_gen = any(b.name in comps[i].boxes for i in gen_ids)
        status[b.name] = DEFINITE if in_cons else (MAYBE if in_gen else NO)

    # A place you can enter but not leave is a trap, and it is invisible to a
    # forward-only flood fill. Re-flood from every reachable component back
    # towards a spawn.
    trapped = []
    for cid in sorted(gen_ids):
        if cid in spawn_ids:
            continue
        if not (_flood(gen_edges, {cid}) & spawn_ids):
            trapped.append(sorted(comps[cid].boxes))

    margins = _climb_margins(comps, gen_edges, profile)

    return ReachResult(
        status=status,
        components=comps,
        node_count=len(nodes),
        edges=gen_edges,
        unstandable=unstandable,
        trapped=trapped,
        margins=margins,
        notes=notes,
    )


def _climb_margins(comps, edges, profile):
    """How much of the wall-climb budget each climbing route actually spends.

    A route that uses the whole budget works in theory and fails the first time
    a player is half a stud low. MovementConfig itself says the budget is 'meant
    to be a little less than the height of a comfortable recovery', so a
    zero-margin climb is worth surfacing.
    """
    budget = profile.get("abilities.wallClimb.maxRise", 0.0)
    out = {}
    if not budget:
        return out
    for (src, dst), ways in edges.items():
        for w in ways:
            if not w.startswith("wallClimb"):
                continue
            try:
                used = float(w.split("+")[1].split(" ")[0])
            except (IndexError, ValueError):
                continue
            for name in comps[dst].boxes:
                prev = out.get(name)
                margin = budget - used
                if prev is None or margin < prev[0]:
                    out[name] = (margin, used, budget, sorted(comps[src].boxes))
    return out
