"""Spec loading, validation and resolution.

ONE spec resolves to ONE tree. The plan render, the prover, the Luau builder
and the rbxmx all read that same resolved tree, so the preview cannot disagree
with what ships. This is the ul-ui-builder architecture applied to geometry.

The spec declares INTENT, not just geometry. Every part names the roles it
serves and the map names which surfaces are meant to be reachable. That is what
turns the prover's question from "is this map any good", which has no answer,
into "does the built geometry match what was declared", which does.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field

from geom import Box

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)


class SpecError(Exception):
    pass


# --------------------------------------------------------------------------
# profile
# --------------------------------------------------------------------------

class Profile:
    """A movement profile with provenance. `get` unwraps {"value":..} nodes so
    callers do not care whether a number was measured or assumed, while
    `provenance` lets the report say so."""

    def __init__(self, data: dict):
        self.raw = data
        self.name = data.get("name", "unnamed")

    def get(self, path, default=None):
        node = self.raw
        for key in path.split("."):
            if not isinstance(node, dict) or key not in node:
                return default
            node = node[key]
        if isinstance(node, dict) and "value" in node:
            return node["value"]
        return node

    def provenance(self, path):
        node = self.raw
        for key in path.split("."):
            if not isinstance(node, dict) or key not in node:
                return None
            node = node[key]
        return node.get("src") if isinstance(node, dict) else None

    def ability(self, name):
        return self.raw.get("abilities", {}).get(name)

    def shipped(self, name) -> bool:
        a = self.ability(name)
        return bool(a and a.get("shipped"))

    def unshipped_abilities(self):
        return [n for n, a in self.raw.get("abilities", {}).items() if not a.get("shipped")]

    def assumed_fields(self):
        out = []

        def walk(node, prefix):
            if isinstance(node, dict):
                if node.get("src") == "assumed":
                    out.append(prefix.lstrip("."))
                for k, v in node.items():
                    if isinstance(v, dict):
                        walk(v, f"{prefix}.{k}")
        walk(self.raw, "")
        return out


def load_profile(name_or_path) -> Profile:
    path = name_or_path
    if not os.path.exists(path):
        path = os.path.join(SKILL, "profiles", f"{name_or_path}.json")
    if not os.path.exists(path):
        raise SpecError(f"no such profile: {name_or_path}")
    with open(path, encoding="utf-8") as f:
        return Profile(json.load(f))


# --------------------------------------------------------------------------
# resolved map
# --------------------------------------------------------------------------

@dataclass
class ResolvedMap:
    name: str
    profile: Profile
    boxes: list                       # list[Box]
    spawns: list                      # list[(x,y,z)]
    kill_plane: float
    ring_out_y: float
    bounds: tuple                     # ((lo),(hi)) intended play volume
    intent: dict
    anchors: dict                     # kind -> [box names]
    sightlines: dict
    source: dict = field(default_factory=dict)

    def by_name(self, name):
        for b in self.boxes:
            if b.name == name:
                return b
        return None

    def match(self, pattern):
        """Resolve a name pattern to boxes. Supports a single trailing '*'."""
        if pattern.endswith("*"):
            stem = pattern[:-1]
            return [b for b in self.boxes if b.name.startswith(stem)]
        b = self.by_name(pattern)
        return [b] if b else []

    def match_names(self, patterns):
        out = []
        for p in patterns:
            hit = self.match(p)
            if not hit:
                raise SpecError(f"intent names '{p}' but no part matches it")
            out.extend(b.name for b in hit)
        return sorted(set(out))


# --------------------------------------------------------------------------
# resolution
# --------------------------------------------------------------------------

def _rot_y(p, deg):
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    x, y, z = p
    return (x * c + z * s, y, -x * s + z * c)


REQUIRED_PART_KEYS = ("id", "size", "pos")


def resolve(spec: dict, profile: Profile | None = None, theme: dict | None = None) -> ResolvedMap:
    if profile is None:
        profile = load_profile(spec.get("profile", "default"))
    if theme is None and spec.get("theme"):
        import theme as thememod
        theme = thememod.load(spec["theme"])

    boxes: list[Box] = []
    seen = set()

    for raw in spec.get("parts", []):
        if "kit" in raw:
            if theme is None and raw["kit"] != "stairs":
                raise SpecError(
                    f"part '{raw.get('id', '?')}' uses kit '{raw['kit']}' but the "
                    f"map declares no theme. A kit has to know what it is made of.")
            boxes.extend(_resolve_kit(raw, theme, profile, seen))
            continue
        for k in REQUIRED_PART_KEYS:
            if k not in raw:
                raise SpecError(f"part {raw.get('id', '?')} is missing '{k}'")
        roles = list(raw.get("roles", []))
        if not roles:
            # P7 depends on this being impossible to forget. Fail at resolve
            # time rather than letting a purposeless part reach the prover.
            raise SpecError(
                f"part '{raw['id']}' declares no roles. Every part must say what "
                f"it is for, or it should not be in the map."
            )
        ring = int(raw.get("ring", 1))
        if ring < 1:
            raise SpecError(f"part '{raw['id']}' has ring < 1")
        step = 360.0 / ring
        # A part may name a theme role instead of a colour: the theme's palette
        # and material for that role are the defaults, and an explicit
        # "color"/"material" on the part still wins.
        role_rgb = role_mat = None
        if theme and raw.get("themeRole"):
            role_rgb = (theme.get("palette") or {}).get(raw["themeRole"])
            role_mat = (theme.get("materials") or {}).get(raw["themeRole"])
        for i in range(ring):
            deg = step * i
            pos = _rot_y(tuple(raw["pos"]), deg) if ring > 1 else tuple(raw["pos"])
            yaw = (raw.get("yaw", 0.0) + deg) % 360.0
            name = raw["id"] if ring == 1 else f"{raw['id']}{i + 1}"
            if name in seen:
                raise SpecError(f"duplicate part name '{name}'")
            seen.add(name)
            boxes.append(Box(
                name=name,
                centre=(round(pos[0], 6), round(pos[1], 6), round(pos[2], 6)),
                size=tuple(raw["size"]),
                yaw=yaw,
                ramp_axis=raw.get("ramp"),
                solid=raw.get("solid", True),
                visible=raw.get("visible", True),
                roles=roles,
                meta={
                    "shape": raw.get("shape", "block"),
                    "grounded": raw.get("grounded", None),
                    "material": raw.get("material", role_mat or "SmoothPlastic"),
                    "color": raw.get("color", list(role_rgb or [163, 162, 165])),
                    # P16 Enclosure reads this. Without it a hand-written sealed
                    # room was stuck at WARN forever no matter how sealed it
                    # was, and P16's own message ("say so explicitly if not")
                    # asked for something the spec format had no way to say.
                    # Measured on a dry run: a room with four 24-stud walls
                    # against a 6.37-stud jump apex could not score better than
                    # WARN. Declaring `"barrier": true` on a part now does.
                    "barrier": bool(raw.get("barrier", False)),
                    # Same gap as `barrier` above, found the same way. A KIT part
                    # can mark itself decorative (Ctx.part takes decor=True and
                    # defaults to it), but a hand-written part could not: the
                    # meta dict never read the key, and the setdefault below then
                    # forced it False. So a spec-authored anvil, fire pit or
                    # scenery cliff was judged as a declared DESTINATION - P3
                    # reported it "reachable but the spec never says it should
                    # be", P2 reported its 3-stud top as a floor nobody can stand
                    # on, and P6 counted the fire sitting inside its own pit as
                    # interpenetration. All three are correct about a destination
                    # and wrong about greeble. Default stays False, so no
                    # existing spec changes.
                    "decor": bool(raw.get("decor", False)),
                    # P13 wants props ringing every landmark. On a tower-defense
                    # trail a landmark INSIDE a bend is surrounded by the tower
                    # pocket, which the design requires clear - towers are the
                    # dressing there. A spec may say so, but only WITH a reason:
                    # P13 prints it, so an exemption can never be silent.
                    # (Found on a tower-defense map: two bend landmarks FAILed
                    # P13 because the check could not be told the pocket is
                    # deliberate.)
                    "dressing_exempt": raw.get("dressing_exempt"),
                    # A map may own a light source. Without this the key
                    # was silently dropped at resolve time and the emitters
                    # never saw it.
                    "light": raw.get("light"),
                    # Optional keys a hand-written part may carry, read by the
                    # builder and the design checks:
                    #   mesh / meshScale   place a cached mesh model (by name, ids
                    #                      from the asset-ids file) in this box,
                    #                      base on the box's bottom face
                    #   biome              P21 groups unique meshes by it
                    #   facing             degrees added to yaw for a door (P12)
                    #   terrainWater       fill this box as terrain water (P14)
                    #   organic / lobes    lobed outline for that water
                    #   themeRole          palette role (theme colour + material)
                    "mesh": raw.get("mesh"),
                    "meshScale": float(raw.get("meshScale", 1.0)),
                    "biome": raw.get("biome"),
                    "facing": raw.get("facing"),
                    "terrainWater": bool(raw.get("terrainWater", False)),
                    "organic": bool(raw.get("organic", False)),
                    "lobes": int(raw.get("lobes", 7)),
                    "themeRole": raw.get("themeRole"),
                    "ring": ring,
                    "ringIndex": i,
                    "ringBase": raw["id"],
                },
            ))

    for b in boxes:
        b.meta.setdefault("decor", False)
        b.meta.setdefault("shape", "block")
        b.meta.setdefault("kit", None)
        b.meta.setdefault("zone", b.name)

    boxes = _prune_scatter_collisions(boxes)

    vol = spec.get("volume", {})
    kill = float(vol.get("killPlane", -500))
    ring_out = kill + float(vol.get("ringOutOffset", 0))
    bounds = vol.get("bounds")
    if bounds is None:
        raise SpecError("volume.bounds is required: without it 'reachable but not intended' cannot be judged")
    bounds = (tuple(bounds[0]), tuple(bounds[1]))

    rm = ResolvedMap(
        name=spec.get("name", "map"),
        profile=profile,
        boxes=boxes,
        spawns=[tuple(s) for s in spec.get("spawns", [])],
        kill_plane=kill,
        ring_out_y=ring_out,
        bounds=bounds,
        intent=spec.get("intent", {}),
        anchors=spec.get("anchors", {}),
        sightlines=spec.get("sightlines", {}),
        source=spec,
    )

    if not rm.spawns:
        raise SpecError("map declares no spawns: reachability has nowhere to start")
    return rm


def _overlaps_plan(a, b, pad=0.0):
    """Footprint overlap, ignoring height entirely.

    Needed because the things a prop must not sit on are often flat: a path, a
    plaza deck, a bridge surface. A 3D test passes every one of them.
    """
    (alo, ahi), (blo, bhi) = a.aabb(), b.aabb()
    return (alo[0] - pad < bhi[0] and ahi[0] + pad > blo[0]
            and alo[2] - pad < bhi[2] and ahi[2] + pad > blo[2])


def _prune_scatter_collisions(boxes, clearance=1.0):
    """Drop scattered props that land inside something already placed.

    A scatter kit knows nothing about the rest of the map, so a treeline will
    happily put an oak through a cottage wall and a rock inside another rock.
    Placement verification caught seven of these on the farm map - each one
    overlapping by 1-2 studs, invisible in a wide shot and obvious up close.

    Only SCATTERED props are dropped, and only where they hit a NON-scattered
    part: a deliberately placed prop is never removed by this, and props
    brushing each other within `clearance` are left alone because real scatter
    should touch.
    """
    from geom import boxes_overlap

    scattered = [b for b in boxes if b.meta.get("kit") in ("mesh_scatter", "scatter")]
    fixed = [b for b in boxes if b.meta.get("kit") not in ("mesh_scatter", "scatter")]
    if not scattered or not fixed:
        return boxes

    # only solid, standable geometry blocks a prop - a ground plane does not
    blockers = [b for b in fixed
                if b.solid and b.size[1] > clearance
                and "arena_floor" not in b.roles and "meadow" not in b.roles]

    # A PATH IS A BLOCKER EVEN THOUGH IT IS FLAT. The height test above exists to
    # stop a ground plane swallowing the whole map, and a path slab is under a
    # stud thick, so paths fell through it - which is how two boulders ended up
    # sitting in the middle of a walking route. Routes are matched in PLAN and
    # ignore their thickness.
    ROUTE = {"main_route", "side_route", "hub", "spawn_plaza",
             "plaza_access", "hill_access"}
    routes = [b for b in fixed if any(r in ROUTE for r in b.roles)]

    # WATER BLOCKS PROPS TOO, and it took a screenshot to notice. A terrain
    # water marker is invisible and non-solid by design - it is a note to the
    # builder, not geometry - so neither condition above admitted it, and the
    # treeline cheerfully planted oaks and pines standing upright in the middle
    # of the lake. Nothing errored and no check complained.
    # A water marker is a box sunk BELOW the ground - the fill depth, not the
    # surface - so a tree standing in the lake never overlaps it in 3D and the
    # box test above passes it. Water has to be tested in PLAN.
    import outline
    water_discs = []
    for b in fixed:
        if b.meta.get("terrainWater"):
            water_discs += outline.discs(b.centre[0], b.centre[2],
                                         b.size[0], b.size[2], b.yaw,
                                         b.meta.get("lobes", 7))

    keep, dropped = [], 0
    for b in scattered:
        hit = (not outline.floats(b.name)
               and outline.in_water(b.centre[0], b.centre[2], water_discs,
                                    margin=max(b.size[0], b.size[2]) * 0.35))
        if not hit:
            for rt in routes:
                if _overlaps_plan(b, rt, clearance):
                    hit = True
                    break
        for o in ([] if hit else blockers):
            if boxes_overlap(b, o, clearance):
                hit = True
                break
        # ...and against props already kept. Scattering only against FIXED
        # geometry let two identical oaks land with their canopies interpenetrating
        # at the same height, which flickers. Props may brush, not merge.
        if not hit:
            for o in keep:
                if boxes_overlap(b, o, clearance * 2.0):
                    hit = True
                    break
        if hit:
            dropped += 1
        else:
            keep.append(b)
    if dropped:
        print(f"[resolve] dropped {dropped} scattered prop(s) intersecting placed geometry")
    order = {id(b): i for i, b in enumerate(boxes)}
    out = fixed + keep
    out.sort(key=lambda b: order[id(b)])
    return out


def _stairs(params, theme, name):
    """Built-in staircase: half-height treads, each extruded down to the base.

    Each tread sits at its OWN place along the run and reaches the floor, so the
    result is a staircase. Centring every step on the midpoint instead builds a
    symmetric stepped pyramid, which is a different object entirely.

    params: pos [x, y, z] (centre of the footprint at the BOTTOM), rise, run,
    width (default 10), step (default 1.5), yaw (default 0). The treads climb
    toward local +Z, so at yaw 0 the top step is at z + run/2.
    """
    try:
        x, y, z = params["pos"]
        rise, run = float(params["rise"]), float(params["run"])
    except KeyError as e:
        raise SpecError(f"stairs '{name}' needs pos, rise and run (missing {e})")
    width = float(params.get("width", 10.0))
    step = float(params.get("step", 1.5))
    yaw = float(params.get("yaw", 0.0))
    roles = list(params.get("roles") or ["surface"])
    pal = (theme or {}).get("palette") or {}
    mats = (theme or {}).get("materials") or {}
    colour = list(pal.get("stone_mid") or [163, 162, 165])
    material = mats.get("stone_mid", "SmoothPlastic")
    n = max(1, int(round(rise / step)))
    sh, sd = rise / n, run / n
    out = []
    for i in range(n):
        cz = -run / 2 + (i + 0.5) * sd
        wx, _, wz = _rot_y((0.0, 0.0, cz), yaw)
        h = sh * (i + 1)
        out.append(Box(
            name=f"{name}_step{i + 1}",
            centre=(round(x + wx, 4), round(y + h / 2, 4), round(z + wz, 4)),
            size=(width, round(h, 4), round(sd, 4)),
            yaw=yaw % 360.0,
            ramp_axis=None, solid=True, visible=True, roles=roles,
            meta={"grounded": None, "decor": False, "shape": "block",
                  "material": material, "color": colour, "themeRole": "stone_mid"},
        ))
    return out


def _resolve_kit(raw, theme, profile, seen):
    """Expand a kit declaration, honouring `ring` the same way a plain part does.

    `stairs` is built in. Any other kit name needs a `kit.py` module of
    parametric assemblies beside this file. This version of the skill does not
    ship one, so write those parts as plain boxes or as mesh placements.
    """
    kitmod = None
    if raw.get("kit") != "stairs":
        try:
            import kit as kitmod
        except ImportError:
            raise SpecError(
                f"part '{raw.get('id', '?')}' uses kit '{raw.get('kit')}', and no kit "
                f"module is installed. Only the built-in 'stairs' kit is available: "
                f"write this part as plain boxes (id, size, pos, roles) instead.")

    pid = raw.get("id")
    if not pid:
        raise SpecError("a kit part needs an 'id'")
    params = dict(raw.get("params", {}))
    roles = list(raw.get("roles", []))
    if not roles:
        raise SpecError(
            f"kit part '{pid}' declares no roles. Every part must say what it is "
            f"for, or it should not be in the map.")

    # A staircase taller than auto-step is an unclimbable ladder, so the
    # resolver refuses it rather than letting the prover discover it later.
    if raw["kit"] == "stairs":
        step = params.get("step", 1.5)
        limit = profile.get("autoStep", 2.0)
        if step > limit:
            raise SpecError(
                f"stairs '{pid}' use a {step} stud step against an auto-step of "
                f"{limit}. Every step would be an unclimbable ledge. Use "
                f"step <= {limit}.")

    ring = int(raw.get("ring", 1))
    out = []
    for i in range(ring):
        deg = (360.0 / ring) * i
        p = dict(params)
        p["roles"] = roles
        if ring > 1:
            for key in ("pos", "a", "b"):
                if key in p:
                    p[key] = list(_rot_y(tuple(p[key]), deg))
            p["yaw"] = (p.get("yaw", 0.0) + deg) % 360.0
        name = pid if ring == 1 else f"{pid}{i + 1}"
        if name in seen:
            raise SpecError(f"duplicate part name '{name}'")
        seen.add(name)
        if raw["kit"] == "stairs":
            made = _stairs(p, theme, name)
        else:
            made = kitmod.build(raw["kit"], p, theme, name, seed=raw.get("seed", 0) + i)
        for b in made:
            b.meta["kit"] = raw["kit"]
            b.meta["zone"] = name
        out.extend(made)
    return out


# Kits whose subject is organic, curved or a landmark. The skill already says
# "mesh first, parts are the exception" - this is the code that means it.
MESH_CLASS_KITS = {
    "tree": "a tree built from parts is a cylinder with a ball on top",
    "treeline": "a row of part-trees is the same mistake, repeated",
    "pine": "a cone on a stick",
    "rock": "a Ball part is a smooth grey sphere on a lawn, and cannot be squashed",
    "boulder": "as rock",
    "boulder_cluster": "as rock",
    "scatter": "scattered dressing is what the player walks past closest",
    "cottage": "a house from parts is a box with a lid - measured, three times running",
    "house": "as cottage",
    "hut": "as cottage",
    "stall": "detail that parts can only fake",
    "cart": "as stall",
    "mound": "a squashed dome is not expressible as a part at all",
}


def check_mesh_first(spec: dict) -> list[str]:
    """Report every mesh-class kit in `spec` that is being built from parts.

    WHY THIS IS A GATE AND NOT ADVICE. Measured on a shipped map: `grep -c mesh
    design/map.json` returned **zero**. 75 scatter entries, 16 trees, 7
    treelines and a cottage, every one of them parts, on a map whose own skill
    file said in bold that parts are the exception. The verdict on the result
    was that the trees and rocks looked bad, and it was right.

    Nothing caught it because nothing was looking. The prover checks that the
    map is reachable, sealed and lit - all of which a map made entirely of boxes
    passes perfectly. A rule that is only written down gets forgotten, and this
    one already was.
    """
    found: dict[str, int] = {}

    def walk(node):
        if isinstance(node, dict):
            kit = node.get("kit")
            if kit in MESH_CLASS_KITS and not node.get("mesh") and not node.get("asset"):
                found[kit] = found.get(kit, 0) + 1
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(spec)
    return [
        f"{n} x {kit!r} built from parts - {MESH_CLASS_KITS[kit]}"
        for kit, n in sorted(found.items(), key=lambda kv: -kv[1])
    ]


def load_spec(path) -> dict:
    if not os.path.exists(path):
        alt = os.path.join(SKILL, "specs", f"{path}.json")
        if os.path.exists(alt):
            path = alt
        else:
            raise SpecError(f"no such spec: {path}")
    with open(path, encoding="utf-8") as f:
        spec = json.load(f)
    # where the spec lives, so files it names (assetIdsFile, meshesFile) resolve against it
    spec["__dir__"] = os.path.dirname(os.path.abspath(path))

    # GROUND IS TERRAIN. Written 2026-09-15 after three maps in a row shipped on
    # flat Part slabs while SKILL.md said in bold that flat ground is a bug.
    # A ground-role part 64+ studs on a side is a slab; organic ground comes
    # from the terrain block (terrain.py) and is proven by checks_terrain.py.
    # A floating arena deck IS legitimately a part - say so, with a reason.
    if not spec.get("ground_is_parts"):
        import checks_terrain
        slabs = checks_terrain.slab_ground(spec)
        if slabs:
            raise SpecError(
                "GROUND IS TERRAIN, NOT SLABS. These parts are slab ground:\n  "
                + "\n  ".join(slabs)
                + "\n\nDeclare a \"terrain\" block (scripts/terrain.py) so the ground is "
                "smooth voxel terrain with real relief, proven by T1-T6.\n"
                "If a part deck really is the design (a sky arena), set "
                "\"ground_is_parts\": \"<reason>\". Silence is not a decision.")

    # A spec may opt out ONLY by saying so out loud, per entry, with a reason -
    # never by silence.
    if not spec.get("parts_are_deliberate"):
        offenders = check_mesh_first(spec)
        if offenders:
            raise SpecError(
                "MESH FIRST. These are being built from parts:\n  "
                + "\n  ".join(offenders)
                + "\n\nUse your own models, or generate them with the ul-3d-model "
                "skill (build from a downloaded REFERENCE, not from imagination), and "
                "REUSE a model you already have before making a new one.\n"
                "If parts really are right here, set \"parts_are_deliberate\" with a "
                "reason. Silence is not a decision."
            )
    return spec


def load(path) -> ResolvedMap:
    spec = load_spec(path)
    return resolve(spec)
