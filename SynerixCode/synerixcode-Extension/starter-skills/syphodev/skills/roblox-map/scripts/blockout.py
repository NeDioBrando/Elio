#!/usr/bin/env python3
"""A PLAYABLE blockout, straight from a game's `design/map.json` layout.

    python blockout.py --map design/map.json --out src/workspace/Map

WHY THIS EXISTS.
The orchestrator's ordering rule is that the core loop is PLAYED before any art
is built, on placeholder geometry. That needs a map, and it needs it before the
map skill's own spec, terrain, dressing and prover pipeline has run - those
belong to the later art section. Previously there was nothing in between, so the
choice was "build the whole map early" or "play the loop with no floor", and a
previous project took the first one and then discarded five finished artifacts
when the loop turned out to be wrong.

So this emits the SMALLEST geometry a loop can be played on, from the same
`layout` block the full map is later built from: a floor, the named plots on
their ring, the centre mound, a ring path, and a collision boundary. Plain
anchored Parts, deliberately ugly, no meshes and no dressing.

THREE THINGS IT DOES THAT ARE NOT OBVIOUS:

1. It writes an `.rbxmx` under a Rojo-SOURCED path, never instances at runtime.
   Rojo owns its subtree and deletes runtime children on the next reconnect;
   measured on a previous project as 897 props vanishing and reading exactly
   like "Rojo is broken".
2. A placeholder is VISIBLY one - flat bright colours, SmoothPlastic, and every
   plot numbered by a BillboardGui - so a blockout can never be mistaken for a
   finished map, or quietly shipped as one.
3. It emits a plot manifest OUTSIDE the Rojo-sourced directory, for verification
   and the section handoff - never as a second copy of the geometry for the game
   to read. The game measures plot centres off the real Parts, because two pieces
   of code deriving the same positions independently is how a colony ends up
   growing next to its plot instead of on it. (A stray .json inside a Rojo $path
   also becomes a ModuleScript, which is its own surprise.)

The XML is built with ElementTree, never string templates: a part carrying a
child (a BillboardGui here) nests `<Item>` elements, and a flat regex rewrite of
that produces unbalanced XML. `rojo build` catches it, which is why this script
tells the caller to run it.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

# Measured from a live Studio session; Roblox serialises Material as an enum int.
MATERIAL = {"SmoothPlastic": 272, "Plastic": 256, "Grass": 1280, "Ground": 1360, "Slate": 800, "Neon": 288}

# Deliberately loud, flat and unrealistic. A blockout that looks plausible is a
# blockout somebody ships.
COLOURS = {
    "floor": (0.36, 0.42, 0.34),
    "plot": (0.55, 0.72, 0.45),
    "plotAlt": (0.48, 0.66, 0.40),
    "mound": (0.52, 0.40, 0.30),
    "path": (0.45, 0.40, 0.32),
    "boundary": (0.9, 0.2, 0.3),
    "marker": (0.30, 0.85, 0.75),
}


def sub(parent, tag, **attrs):
    return ET.SubElement(parent, tag, attrs)


def prop_bool(props, name, value):
    """An rbxmx <bool> must be the literal text `true` or `false`.

    MEASURED on a real build: a `0` written into
    `<bool name="LightInfluence">` - which is in fact a FLOAT property, so the
    numeric value was right and the TAG was wrong - parsed as valid XML and then
    killed `rojo build` with

        Malformed rbxm file: ... line 3876, column 36:
        Invalid text content: expected true or false

    a line number and no property name, exactly like the Color3uint8 and UDim2
    traps above. The guard below refuses a numeric or string value outright, so
    the failure happens at the line that writes it instead of 3800 lines later
    in a deserialiser. If you want a number, you wanted a different tag.
    """
    if not isinstance(value, bool):
        raise TypeError(
            f"prop_bool({name!r}, {value!r}): an rbxmx <bool> takes only True or "
            f"False. A numeric value here means the property is a float or a "
            f"token, not a bool - use prop_float or prop_token.")
    e = sub(props, "bool", name=name)
    e.text = "true" if value else "false"


def prop_string(props, name, value):
    e = sub(props, "string", name=name)
    e.text = value


def prop_token(props, name, value):
    e = sub(props, "token", name=name)
    e.text = str(value)


def prop_float(props, name, value):
    e = sub(props, "float", name=name)
    e.text = repr(float(value))


def prop_vector3(props, name, x, y, z):
    e = sub(props, "Vector3", name=name)
    for axis, v in (("X", x), ("Y", y), ("Z", z)):
        c = sub(e, axis)
        c.text = repr(float(v))


def prop_color3(props, name, r, g, b):
    """BasePart.Color serialises as Color3uint8: ONE packed uint32, not three
    floats. Writing it the Color3 way parses as XML and then fails Rojo's
    deserialiser with "invalid digit found in string", which points at a line
    number and not at the property - measured 2026-09-18."""
    e = sub(props, "Color3uint8", name=name)
    packed = (
        0xFF000000
        | (int(round(max(0.0, min(1.0, r)) * 255)) << 16)
        | (int(round(max(0.0, min(1.0, g)) * 255)) << 8)
        | int(round(max(0.0, min(1.0, b)) * 255))
    )
    e.text = str(packed)


def prop_color3_float(props, name, r, g, b):
    """A genuine Color3 property (TextColor3 and friends), three floats."""
    e = sub(props, "Color3", name=name)
    for axis, v in (("R", r), ("G", g), ("B", b)):
        c = sub(e, axis)
        c.text = repr(float(v))


def prop_udim2(props, name, xs: float, xo: int, ys: float, yo: int):
    """Scales are float, offsets are INT32. Rojo rejects "400.0" for an offset."""
    e = sub(props, "UDim2", name=name)
    for tag, val in (("XS", repr(float(xs))), ("XO", str(int(xo))), ("YS", repr(float(ys))), ("YO", str(int(yo)))):
        c = sub(e, tag)
        c.text = val


def prop_cframe(props, name, x, y, z, yaw: float = 0.0):
    """Axis-aligned, or rotated about Y only (`yaw` in radians).

    Yaw was added 2026-09-28 for a tower-defense TRAIL: a path between arbitrary
    waypoints cannot be axis-aligned pads without swallowing the buildable
    pockets inside every bend, which is the whole design of that map."""
    e = sub(props, "CoordinateFrame", name=name)
    for axis, v in (("X", x), ("Y", y), ("Z", z)):
        c = sub(e, axis)
        c.text = repr(float(v))
    cy, sy = math.cos(yaw), math.sin(yaw)
    for axis, v in (
        ("R00", cy), ("R01", 0), ("R02", sy),
        ("R10", 0), ("R11", 1), ("R12", 0),
        ("R20", -sy), ("R21", 0), ("R22", cy),
    ):
        c = sub(e, axis)
        c.text = repr(float(v))


_ref = [0]


def new_ref() -> str:
    _ref[0] += 1
    return f"RBX{_ref[0]}"


def part(
    parent,
    name: str,
    pos: tuple[float, float, float],
    size: tuple[float, float, float],
    colour: tuple[float, float, float],
    *,
    shape: str | None = None,
    transparency: float = 0.0,
    can_collide: bool = True,
    material: str = "SmoothPlastic",
    yaw: float = 0.0,
):
    item = ET.SubElement(parent, "Item", {"class": "Part", "referent": new_ref()})
    props = sub(item, "Properties")
    prop_string(props, "Name", name)
    prop_cframe(props, "CFrame", *pos, yaw=yaw)
    prop_vector3(props, "size", *size)
    prop_color3(props, "Color3uint8", *colour)
    prop_bool(props, "Anchored", True)
    prop_bool(props, "CanCollide", can_collide)
    prop_float(props, "Transparency", transparency)
    prop_token(props, "Material", MATERIAL[material])
    if shape == "cylinder":
        prop_token(props, "shape", 2)  # Enum.PartType.Cylinder
    elif shape == "ball":
        prop_token(props, "shape", 0)
    return item


def folder(parent, name: str):
    item = ET.SubElement(parent, "Item", {"class": "Folder", "referent": new_ref()})
    props = sub(item, "Properties")
    prop_string(props, "Name", name)
    return item


def spawn(parent, name: str, pos: tuple[float, float, float], yaw: float = 0.0):
    """`yaw` sets which way a player FACES on spawn (LookVector = (-sin, 0, -cos)).
    Measured on a tower-defense map: an unrotated spawn by the south edge put
    every player's camera staring at the boundary wall, back to the whole game."""
    item = ET.SubElement(parent, "Item", {"class": "SpawnLocation", "referent": new_ref()})
    props = sub(item, "Properties")
    prop_string(props, "Name", name)
    prop_cframe(props, "CFrame", *pos, yaw=yaw)
    prop_vector3(props, "size", 6, 1, 6)
    prop_color3(props, "Color3uint8", *COLOURS["marker"])
    prop_bool(props, "Anchored", True)
    prop_bool(props, "CanCollide", True)
    prop_bool(props, "Neutral", True)
    # A blockout spawn must NOT be a team spawn, and must not be the only one the
    # engine can find, or players pile onto a single pad.
    prop_bool(props, "AllowTeamChangeOnTouch", False)
    prop_token(props, "Material", MATERIAL["SmoothPlastic"])
    return item


def label(parent, text: str, offset_y: float):
    """A BillboardGui so a blockout part says what it is from across the map."""
    gui = ET.SubElement(parent, "Item", {"class": "BillboardGui", "referent": new_ref()})
    props = sub(gui, "Properties")
    prop_string(props, "Name", "BlockoutLabel")
    prop_bool(props, "AlwaysOnTop", True)
    # UDim2 serialises as four scalars.
    prop_udim2(props, "Size", 0.0, 400, 0.0, 120)
    off = sub(props, "Vector3", name="StudsOffset")
    for axis, v in (("X", 0), ("Y", offset_y), ("Z", 0)):
        c = sub(off, axis)
        c.text = repr(float(v))
    sz = sub(props, "float", name="MaxDistance")
    sz.text = "400"

    tl = ET.SubElement(gui, "Item", {"class": "TextLabel", "referent": new_ref()})
    tp = sub(tl, "Properties")
    prop_string(tp, "Name", "Text")
    prop_string(tp, "Text", text)
    bt = sub(tp, "float", name="BackgroundTransparency")
    bt.text = "1"
    prop_color3_float(tp, "TextColor3", 1, 1, 1)
    prop_bool(tp, "TextScaled", True)
    prop_udim2(tp, "Size", 1.0, 0, 1.0, 0)
    return gui


def build(layout: dict, name: str) -> tuple[ET.Element, dict]:
    floor_y = float(layout["floorY"])
    diameter = float(layout["diameter"])
    plots_cfg = layout["plots"]
    ring_radius = float(plots_cfg["ringRadius"])
    plot_size = float(plots_cfg["size"])
    angles = plots_cfg["angles_deg"]
    names = plots_cfg["names"]
    centre = layout["centre"]
    edge = layout["edge"]

    root = ET.Element("roblox", {"version": "4"})
    map_folder = folder(root, name)

    # --- floor -------------------------------------------------------------
    ground = folder(map_folder, "Ground")
    part(
        ground,
        "Floor",
        (0, floor_y - 2, 0),
        (diameter, 4, diameter),
        COLOURS["floor"],
        material="Ground",
    )

    # --- ring path ---------------------------------------------------------
    # Approximated with straight segments between the plot gaps. A blockout does
    # not need a curve; it needs somewhere flat to walk.
    path_radius = 40.0
    paths = folder(map_folder, "Paths")
    steps = 24
    for i in range(steps):
        a0 = 2 * math.pi * i / steps
        a1 = 2 * math.pi * (i + 1) / steps
        x0, z0 = path_radius * math.cos(a0), path_radius * math.sin(a0)
        x1, z1 = path_radius * math.cos(a1), path_radius * math.sin(a1)
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        seg = math.dist((x0, z0), (x1, z1)) + 2
        # Axis-aligned blockout: use a square pad rather than a rotated slab.
        part(paths, f"PathPad{i + 1}", (mx, floor_y + 0.1, mz), (seg + 6, 0.4, seg + 6), COLOURS["path"])

    # --- centre mound ------------------------------------------------------
    mound_radius = 22.0
    mound_top = 6.0
    mounds = folder(map_folder, "HeartrootMound")
    tiers = 3
    for i in range(tiers):
        r = mound_radius * (1 - i / (tiers + 1))
        h = mound_top * (i + 1) / tiers
        part(
            mounds,
            f"MoundTier{i + 1}",
            (0, floor_y + h / 2, 0),
            (r * 2, h, r * 2),
            COLOURS["mound"],
        )
    heart = part(
        mounds,
        "HeartrootMarker",
        (0, floor_y + mound_top + 6, 0),
        (8, 12, 8),
        COLOURS["marker"],
        material="Neon",
    )
    label(heart, "HEARTROOT (placeholder)", 8)

    # Ramps up the mound, one per 90 degrees, shallow enough to walk.
    ramp_len = 26.0
    for i, (dx, dz) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
        cx = dx * (mound_radius - 2)
        cz = dz * (mound_radius - 2)
        part(
            mounds,
            f"MoundRamp{i + 1}",
            (cx, floor_y + mound_top / 2, cz),
            (ramp_len if dx else 10, mound_top, ramp_len if dz else 10),
            COLOURS["mound"],
        )

    # --- spawns ------------------------------------------------------------
    spawns = folder(map_folder, "Spawns")
    spawn_radius = 16.0
    for i in range(len(names)):
        a = math.radians(angles[i])
        spawn(
            spawns,
            f"Spawn{i + 1}",
            (spawn_radius * math.cos(a), floor_y + mound_top + 1.0, spawn_radius * math.sin(a)),
        )

    # --- plots -------------------------------------------------------------
    plots_folder = folder(map_folder, "Plots")
    plot_records = []
    for i, plot_name in enumerate(names):
        a = math.radians(angles[i])
        cx, cz = ring_radius * math.cos(a), ring_radius * math.sin(a)
        pf = folder(plots_folder, plot_name)
        pad = part(
            pf,
            "Pad",
            (cx, floor_y + 0.25, cz),
            (plot_size, 1, plot_size),
            COLOURS["plot"] if i % 2 == 0 else COLOURS["plotAlt"],
        )
        label(pad, f"{plot_name} - unclaimed", 6)
        # A low border so the edge of a plot is obvious on foot. Non-colliding:
        # a player must be able to walk straight onto their own plot.
        border = 1.0
        for sx, sz, w, d in (
            (0, plot_size / 2, plot_size + border * 2, border),
            (0, -plot_size / 2, plot_size + border * 2, border),
            (plot_size / 2, 0, border, plot_size + border * 2),
            (-plot_size / 2, 0, border, plot_size + border * 2),
        ):
            part(
                pf,
                "Border",
                (cx + sx, floor_y + 0.9, cz + sz),
                (w, 0.6, d),
                COLOURS["mound"],
                can_collide=False,
            )
        plot_records.append(
            {
                "name": plot_name,
                "index": i + 1,
                "angle_deg": angles[i],
                "centre": {"x": round(cx, 4), "y": round(floor_y + 0.75, 4), "z": round(cz, 4)},
                "size": plot_size,
            }
        )

    # --- boundary ----------------------------------------------------------
    # The scenery ring and the collision ring are two different things, so the
    # blockout ships the COLLISION one and the art section adds the scenery.
    bounds = folder(map_folder, "Boundary")
    br = float(edge["rockWallRadius"])
    # The spec states the boundary in prose ("invisible CanCollide wall at radius
    # 112"), so pull the number out of it rather than retyping it here.
    boundary_text = str(edge.get("boundary", ""))
    found = re.search(r"radius\s+(\d+(?:\.\d+)?)", boundary_text)
    wall_r = float(found.group(1)) if found else br - 6.0
    height = 60.0
    segs = 16
    for i in range(segs):
        a = 2 * math.pi * i / segs
        x, z = wall_r * math.cos(a), wall_r * math.sin(a)
        span = 2 * math.pi * wall_r / segs + 8
        part(
            bounds,
            f"Wall{i + 1}",
            (x, floor_y + height / 2, z),
            (span, height, span),
            COLOURS["boundary"],
            transparency=0.85,
        )

    manifest = {
        "name": name,
        "floorY": floor_y,
        "plots": plot_records,
        "mound": {"radius": mound_radius, "topY": floor_y + mound_top},
        "boundaryRadius": wall_r,
        "sceneryRadius": br,
        "note": "BLOCKOUT. Placeholder parts only - replaced wholesale by the map skill in the art section.",
    }
    return root, manifest


def seg_dist(px, pz, ax, az, bx, bz) -> float:
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    return math.dist((px, pz), (ax + t * dx, az + t * dz))


def build_trail(layout: dict, name: str, sizes: dict[str, float]) -> tuple[ET.Element, dict]:
    """A tower-defense TRAIL blockout.

    Square lawn, an optional checkered blanket, the waypoint polyline as rotated
    slabs, the enemy spawn (`start`) and the defended objective (`goal`), each
    {"at": [x, z], "mesh": name}, as labelled blocks,
    landmark FOOTPRINTS as blockers, player spawns and a four-wall boundary.

    The game reads the path from `Path/Waypoints/WP<n>` parts and the blockers
    from `Blockers/*`. So the full map built later MUST keep both folders with
    the same names, or the enemies walk a path nobody can see.
    """
    floor_y = float(layout["floorY"])
    w, d = (float(v) for v in layout["size"])
    root = ET.Element("roblox", {"version": "4"})
    map_folder = folder(root, name)

    ground = folder(map_folder, "Ground")
    part(ground, "Lawn", (0, floor_y - 2, 0), (w, 4, d), (0.42, 0.66, 0.30), material="Grass")
    bl = layout.get("blanket")
    if bl:
        bx, bz = bl["centre"]
        bw, bd = bl["size"]
        sq = 10.0
        blanket = folder(ground, "Blanket")
        for i in range(int(bw // sq)):
            for j in range(int(bd // sq)):
                red = (i + j) % 2 == 0
                part(blanket, f"Check_{i}_{j}",
                     (bx - bw / 2 + sq * (i + 0.5), floor_y + 0.1, bz - bd / 2 + sq * (j + 0.5)),
                     (sq, 0.2, sq), (0.91, 0.25, 0.24) if red else (1.0, 0.96, 0.88))

    path = layout["path"]
    wps = path["waypoints"]
    width = float(path["width"])
    path_folder = folder(map_folder, "Path")
    wp_folder = folder(path_folder, "Waypoints")
    slabs = folder(path_folder, "Slabs")
    dirt = (0.79, 0.63, 0.42)
    length = 0.0
    for i, (x, z) in enumerate(wps):
        part(wp_folder, f"WP{i + 1}", (x, floor_y + 1, z), (1, 1, 1), COLOURS["marker"],
             transparency=1.0, can_collide=False)
        # a square pad at every joint, so a bend has no notch
        part(slabs, f"Joint{i + 1}", (x, floor_y + 0.25, z), (width, 0.3, width), dirt)
        if i + 1 < len(wps):
            x1, z1 = wps[i + 1]
            seg = math.dist((x, z), (x1, z1))
            length += seg
            # The slab's length runs along local X, which this yaw maps to (cos, -sin) in (x, z).
            yaw = math.atan2(-(z1 - z), x1 - x)
            part(slabs, f"Seg{i + 1}", ((x + x1) / 2, floor_y + 0.25, (z + z1) / 2),
                 (seg, 0.3, width), dirt, yaw=yaw)

    marks = folder(map_folder, "Markers")
    for key, colour in (("start", (0.45, 0.30, 0.18)), ("goal", (1.0, 0.56, 0.72))):
        spec = layout.get(key)
        if not spec:
            continue
        x, z = spec["at"]
        s = sizes.get(spec.get("mesh", ""), 16.0)
        p = part(marks, key.capitalize(), (x, floor_y + s * 0.3, z), (s * 0.7, s * 0.6, s * 0.7), colour)
        label(p, key.upper(), s * 0.4 + 2)

    blockers = folder(map_folder, "Blockers")
    clearances = {}
    band = width / 2 + float(layout.get("pathClearance", 2))
    for lm in layout.get("landmarks", []):
        x, z = lm["at"]
        s = sizes.get(lm["mesh"], 10.0) * 0.6
        p = part(blockers, lm["mesh"], (x, floor_y + s / 2, z), (s, s, s), (0.62, 0.62, 0.70))
        label(p, lm["mesh"], s / 2 + 2)
        dist = min(seg_dist(x, z, *wps[i], *wps[i + 1]) for i in range(len(wps) - 1))
        clearances[lm["mesh"]] = round(dist - s * math.sqrt(2) / 2 - band, 2)

    sp = layout.get("spawns", {})
    spawns = folder(map_folder, "Spawns")
    sx, sz = sp.get("at", [0, 0])
    n = int(sp.get("count", 1))
    for i in range(n):
        px = sx + (i - (n - 1) / 2) * 8
        # face the map centre, where the trail and the fight are
        spawn(spawns, f"Spawn{i + 1}", (px, floor_y + 0.5, sz), yaw=math.atan2(px, sz))

    bounds = folder(map_folder, "Boundary")
    h = 60.0
    for nm, pos, size in (("WallN", (0, floor_y + h / 2, d / 2 + 1), (w + 4, h, 2)),
                          ("WallS", (0, floor_y + h / 2, -d / 2 - 1), (w + 4, h, 2)),
                          ("WallE", (w / 2 + 1, floor_y + h / 2, 0), (2, h, d + 4)),
                          ("WallW", (-w / 2 - 1, floor_y + h / 2, 0), (2, h, d + 4))):
        part(bounds, nm, pos, size, COLOURS["boundary"], transparency=1.0)

    manifest = {
        "name": name, "floorY": floor_y, "plots": [],
        "pathLength": round(length, 2), "waypoints": wps,
        "landmarkClearance": clearances,
        "note": "BLOCKOUT (trail). landmarkClearance = gap from a blocker's corner to the path+clearance band; negative means it eats the path.",
    }
    return root, manifest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--map", required=True, help="design/map.json")
    ap.add_argument("--out", required=True, help="output DIRECTORY, e.g. src/workspace/Map")
    ap.add_argument("--name", default=None, help="model name (default: the map's `name`)")
    ap.add_argument("--manifest", default=None, help="where to write the plot manifest (NOT inside --out)")
    ap.add_argument("--meshes", default=None, help="design/meshes.json: blocker sizes for a trail layout")
    a = ap.parse_args()

    spec = json.loads(Path(a.map).read_text(encoding="utf-8"))
    layout = spec["layout"]
    name = a.name or spec.get("name", "Map")

    if "path" in layout and "waypoints" in layout["path"]:
        sizes: dict[str, float] = {}
        if a.meshes:
            for asset in json.loads(Path(a.meshes).read_text(encoding="utf-8")).get("assets", []):
                # meshes.json's key is `studs`. An earlier version read only
                # `stud_target`, found nothing, and silently built every
                # blocker as a 6-stud cube (a 30-stud landmark blocked 6).
                s = asset.get("studs", asset.get("stud_target"))
                if s is None:
                    raise SystemExit(f"meshes.json asset {asset.get('name')} has no `studs`")
                sizes[asset["name"]] = float(s)
        root, manifest = build_trail(layout, name, sizes)
    else:
        root, manifest = build(layout, name)

    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = Path(a.manifest) if a.manifest else out_dir.parent / "blockout_manifest.json"
    ET.indent(root, space=" ")
    xml_path = out_dir / "Blockout.rbxmx"
    xml_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=False))
    # NEVER inside --out: a .json under a Rojo $path becomes a ModuleScript. (Until
    # 2026-09-28 this wrote plots.json into --out, against this file's own docstring.)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {xml_path} ({sum(1 for _ in root.iter('Item'))} instances)")
    print(f"wrote {manifest_path} ({len(manifest['plots'])} plots)")
    print("now run `rojo build` - it is the only thing that parses this XML")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
