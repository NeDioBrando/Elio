"""Emit the resolved tree as something Studio can build.

TWO TRANSPORTS, chosen by size:

  Luau  (execute_luau)  small maps. Immediate, no file handling, and the map
                        appears in the session you are already driving.
  rbxmx (Insert from File)  large maps. Asking Studio to run 20,000
                        Instance.new calls parsed out of a multi-megabyte
                        string takes minutes and can hang the plugin thread;
                        the XML goes through Studio's native C++ deserialiser
                        instead.

Both are generated from the SAME resolved tree, so they cannot disagree.

Run:  python emit.py duel_arena --lua build.lua
      python emit.py duel_arena --rbxmx DuelArena.rbxmx
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import xml.sax.saxutils as sax

import spec as specmod

# Measured from a live Studio session 2026-08-27, not guessed.
MATERIALS = {
    "Plastic": 256, "SmoothPlastic": 272, "Neon": 288, "Wood": 512,
    "WoodPlanks": 528, "Marble": 784, "Basalt": 788, "Slate": 800,
    "CrackedLava": 804, "Concrete": 816, "Limestone": 820, "Granite": 832,
    "Pavement": 836, "Brick": 848, "Pebble": 864, "Cobblestone": 880,
    "Rock": 896, "Sandstone": 912, "CorrodedMetal": 1040, "DiamondPlate": 1056,
    "Foil": 1072, "Metal": 1088, "Grass": 1280, "LeafyGrass": 1284,
    "Sand": 1296, "Fabric": 1312, "Snow": 1328, "Mud": 1344, "Ground": 1360,
    "Asphalt": 1376, "Salt": 1392, "Ice": 1536, "Glacier": 1552,
    "Glass": 1568, "ForceField": 1584,
}

# A WedgePart's surface rises along its own local +Z, measured in Studio
# 2026-08-27 (z=-4.5 -> y=0.50 through z=+4.5 -> y=9.50, and flat across x).
# To make it rise along another local axis, rotate it and swap the X/Z extents.
RAMP_YAW = {"+z": 0.0, "+x": 90.0, "-z": 180.0, "-x": 270.0}


def _wedge_transform(b):
    """(size, extra_yaw) for a WedgePart that rises along the box's ramp axis."""
    extra = RAMP_YAW[b.ramp_axis]
    size = b.size
    if b.ramp_axis in ("+x", "-x"):
        size = (b.size[2], b.size[1], b.size[0])
    return size, extra


def _colour(b):
    c = b.meta.get("color") or [163, 162, 165]
    return tuple(int(max(0, min(255, v))) for v in c[:3])


def _material(b):
    name = b.meta.get("material", "SmoothPlastic")
    if name not in MATERIALS:
        raise specmod.SpecError(
            f"part '{b.name}' asks for material '{name}', which is not a Roblox "
            f"material. Known: {', '.join(sorted(MATERIALS))}")
    return name


# --------------------------------------------------------------------------
# Luau
# --------------------------------------------------------------------------

LUA_HEAD = """-- {name}: built from spec by roblox-map. DO NOT HAND-EDIT.
-- Regenerate with:  python emit.py {slug} --lua
-- {parts} parts, profile {profile}
local ws = game:GetService("Workspace")
local old = ws:FindFirstChild("{name}")
if old then old:Destroy() end

local root = Instance.new("Model")
root.Name = "{name}"

local function part(class, name, sx, sy, sz, x, y, z, yaw, r, g, b, mat, solid, vis)
\tlocal p = Instance.new(class)
\tp.Name = name
\tp.Size = Vector3.new(sx, sy, sz)
\tp.CFrame = CFrame.new(x, y, z) * CFrame.Angles(0, math.rad(yaw), 0)
\tp.Anchored = true
\tp.CanCollide = solid
\tp.Transparency = vis and 0 or 1
\tp.Color = Color3.fromRGB(r, g, b)
\tp.Material = Enum.Material[mat]
\tp.TopSurface = Enum.SurfaceType.Smooth
\tp.BottomSurface = Enum.SurfaceType.Smooth
\tp.Parent = root
\treturn p
end
"""

LUA_TAIL = """
root.Parent = ws
if root.PrimaryPart == nil then
\troot.PrimaryPart = root:FindFirstChildWhichIsA("BasePart")
end
return "{name}: built " .. #root:GetChildren() .. " instances"
"""


def to_lua(m, slug="map", theme=None):
    lines = [LUA_HEAD.format(name=m.name, slug=slug, parts=len(m.boxes),
                             profile=m.profile.name)]
    for b in m.boxes:
        cls = "WedgePart" if b.ramp_axis else "Part"
        size, extra = _wedge_transform(b) if b.ramp_axis else (b.size, 0.0)
        r, g, bl = _colour(b)
        yaw = (b.yaw + extra) % 360.0
        lines.append(
            f'part("{cls}", "{b.name}", {size[0]:g}, {size[1]:g}, {size[2]:g}, '
            f'{b.centre[0]:g}, {b.centre[1]:g}, {b.centre[2]:g}, {yaw:g}, '
            f'{r}, {g}, {bl}, "{_material(b)}", '
            f'{"true" if b.solid else "false"}, {"true" if b.visible else "false"})'
            + (f'  -- {", ".join(b.roles)}' if b.roles else ""))

    # A LIGHT IS PART OF THE MAP, NOT PART OF LIGHTING. `lighting.py` writes the
    # sky, the atmosphere and the grade; it has no way to put a warm source at a
    # brazier in the middle of an arena, and before this neither did the
    # emitter. A spec part may now carry "light": {...} and gets a PointLight.
    for b in m.boxes:
        lt = b.meta.get("light")
        if not lt:
            continue
        c = lt.get("Color", [255, 255, 255])
        lines.append(
            f'do local l = Instance.new("PointLight") l.Name = "{b.name}Light" '
            f'l.Brightness = {lt.get("Brightness", 1):g} '
            f'l.Range = {lt.get("Range", 30):g} '
            f'l.Color = Color3.fromRGB({int(c[0])}, {int(c[1])}, {int(c[2])}) '
            f'l.Shadows = {"true" if lt.get("Shadows", True) else "false"} '
            f'l.Parent = root:FindFirstChild("{b.name}") end')

    if m.spawns:
        lines.append("\nlocal spawns = Instance.new(\"Folder\")")
        lines.append('spawns.Name = "Spawns"')
        lines.append("spawns.Parent = root")
        for i, s in enumerate(m.spawns):
            lines.append(
                f'do local sp = Instance.new("SpawnLocation") '
                f'sp.Name = "Spawn{i + 1}" sp.Size = Vector3.new(6, 1, 6) '
                f'sp.CFrame = CFrame.new({s[0]:g}, {s[1] + 0.5:g}, {s[2]:g}) '
                f'sp.Anchored = true sp.CanCollide = false sp.Transparency = 1 '
                # Duration = 0 kills the spawn FORCEFIELD. Roblox defaults it to
                # 10, which puts a large blue bubble around every player for the
                # first ten seconds of their life. On a combat map that is both
                # wrong (ten seconds of invulnerability decides fights) and
                # visually alarming - it reads as a bug, and was reported as one.
                # Everything else here already says "invisible spawn marker":
                # Transparency 1, CanCollide false. This was the odd one out.
                f'sp.Duration = 0 '
                f'sp.Neutral = true sp.Parent = spawns end')

    # The kill plane is a tuning value, not a map value, so it is emitted as a
    # tagged marker rather than as geometry with behaviour attached.
    lines.append(
        f'\ndo local kp = Instance.new("Part") kp.Name = "KillPlane" '
        f'kp.Size = Vector3.new({_kill_plane_size(m)[0]:g}, 1, '
        f'{_kill_plane_size(m)[1]:g}) '
        f'kp.CFrame = CFrame.new(0, {m.kill_plane:g}, 0) kp.Anchored = true '
        f'kp.CanCollide = false kp.Transparency = 1 '
        f'kp:SetAttribute("RingOutOffset", {m.ring_out_y - m.kill_plane:g}) '
        f'game:GetService("CollectionService"):AddTag(kp, "KillPlane") '
        f'kp.Parent = root end')

    lines.append(LUA_TAIL.format(name=m.name))
    return "\n".join(lines)


def lighting_lua(theme):
    """The lighting rig, which carries as much of the look as the geometry.

    Flat default lighting makes good geometry look like a greybox, and an
    atmosphere plus a bloom pass costs eight instances. Volumetric Clouds are
    included because a floating map with nothing under it reads as parts in a
    void until there is weather below them.
    """
    lt = theme["lighting"]
    a = lt["Atmosphere"]
    bl = lt["Bloom"]
    cc = lt["ColorCorrection"]
    sr = lt.get("SunRays", {"Intensity": 0.05, "Spread": 0.9})

    def c3(v):
        return f"Color3.fromRGB({v[0]}, {v[1]}, {v[2]})"

    return f'''
-- lighting: theme "{theme["name"]}"
do
\tlocal L = game:GetService("Lighting")
\tL.Technology = Enum.Technology.{lt.get("Technology", "Future")}
\tL.ClockTime = {lt["ClockTime"]}
\tL.GeographicLatitude = {lt.get("GeographicLatitude", 12)}
\tL.Brightness = {lt["Brightness"]}
\tL.Ambient = {c3(lt["Ambient"])}
\tL.OutdoorAmbient = {c3(lt["OutdoorAmbient"])}
\tL.EnvironmentDiffuseScale = {lt.get("EnvironmentDiffuseScale", 0.5)}
\tL.EnvironmentSpecularScale = {lt.get("EnvironmentSpecularScale", 0.5)}
\tL.ShadowSoftness = {lt.get("ShadowSoftness", 0.35)}
\tL.GlobalShadows = true

\tfor _, n in ipairs({{"MapAtmosphere", "MapBloom", "MapCC", "MapSunRays"}}) do
\t\tlocal e = L:FindFirstChild(n)
\t\tif e then e:Destroy() end
\tend

\tlocal atm = Instance.new("Atmosphere")
\tatm.Name = "MapAtmosphere"
\tatm.Density = {a["Density"]}
\tatm.Offset = {a["Offset"]}
\tatm.Color = {c3(a["Color"])}
\tatm.Decay = {c3(a["Decay"])}
\tatm.Glare = {a["Glare"]}
\tatm.Haze = {a["Haze"]}
\tatm.Parent = L

\tlocal b = Instance.new("BloomEffect")
\tb.Name = "MapBloom"
\tb.Intensity = {bl["Intensity"]}
\tb.Size = {bl["Size"]}
\tb.Threshold = {bl["Threshold"]}
\tb.Parent = L

\tlocal cc = Instance.new("ColorCorrectionEffect")
\tcc.Name = "MapCC"
\tcc.Brightness = {cc["Brightness"]}
\tcc.Contrast = {cc["Contrast"]}
\tcc.Saturation = {cc["Saturation"]}
\tcc.TintColor = {c3(cc["TintColor"])}
\tcc.Parent = L

\tlocal sr = Instance.new("SunRaysEffect")
\tsr.Name = "MapSunRays"
\tsr.Intensity = {sr["Intensity"]}
\tsr.Spread = {sr["Spread"]}
\tsr.Parent = L

\t-- weather below the islands, so they read as floating rather than as parts
\t-- suspended in an empty void
\tlocal terrain = workspace.Terrain
\tlocal old = terrain:FindFirstChildOfClass("Clouds")
\tif old then old:Destroy() end
\tlocal cl = Instance.new("Clouds")
\tcl.Cover = 0.62
\tcl.Density = 0.55
\tcl.Color = Color3.fromRGB(255, 255, 255)
\tcl.Parent = terrain
end
'''


# --------------------------------------------------------------------------
# rbxmx
# --------------------------------------------------------------------------

def _z(v, eps=1e-12):
    """cos(90 deg) is 6.1e-17, not 0. Harmless but it makes the XML look
    broken; Studio's own float32 gives -4.4e-08 for the same cell."""
    return 0.0 if abs(v) < eps else v


def _cframe_xml(x, y, z, yaw):
    r = math.radians(yaw)
    c, s = _z(math.cos(r)), _z(math.sin(r))
    # Columns are RightVector, UpVector, +Z axis. CFrame.Angles(0, yaw, 0)
    # gives Right = (cos, 0, -sin) and +Z = (sin, 0, cos).
    return (f"<CoordinateFrame name=\"CFrame\">"
            f"<X>{x:g}</X><Y>{y:g}</Y><Z>{z:g}</Z>"
            f"<R00>{c:.9g}</R00><R01>0</R01><R02>{s:.9g}</R02>"
            f"<R10>0</R10><R11>1</R11><R12>0</R12>"
            f"<R20>{-s:.9g}</R20><R21>0</R21><R22>{c:.9g}</R22>"
            f"</CoordinateFrame>")


def to_rbxmx(m):
    out = ['<roblox version="4">']
    out.append('<Item class="Model" referent="RBX0"><Properties>'
               f'<string name="Name">{sax.escape(m.name)}</string>'
               '</Properties>')
    ref = 1
    for b in m.boxes:
        cls = "WedgePart" if b.ramp_axis else "Part"
        size, extra = _wedge_transform(b) if b.ramp_axis else (b.size, 0.0)
        r, g, bl = _colour(b)
        packed = (255 << 24) | (r << 16) | (g << 8) | bl
        yaw = (b.yaw + extra) % 360.0
        out.append(f'<Item class="{cls}" referent="RBX{ref}"><Properties>')
        out.append(f'<string name="Name">{sax.escape(b.name)}</string>')
        out.append('<bool name="Anchored">true</bool>')
        out.append(f'<bool name="CanCollide">{"true" if b.solid else "false"}</bool>')
        out.append(f'<float name="Transparency">{0 if b.visible else 1}</float>')
        out.append(f'<token name="Material">{MATERIALS[_material(b)]}</token>')
        out.append(f'<Color3uint8 name="Color3uint8">{packed}</Color3uint8>')
        out.append(f'<Vector3 name="size"><X>{size[0]:g}</X><Y>{size[1]:g}</Y>'
                   f'<Z>{size[2]:g}</Z></Vector3>')
        out.append(_cframe_xml(b.centre[0], b.centre[1], b.centre[2], yaw))
        out.append('<token name="TopSurface">0</token>')
        out.append('<token name="BottomSurface">0</token>')
        out.append('</Properties>')
        # BOTH TRANSPORTS OR NEITHER. build.lua and map.rbxmx are generated
        # from one resolved tree precisely so they cannot disagree, and a
        # light emitted by only one of them is exactly that disagreement.
        lt = b.meta.get('light')
        if lt:
            ref += 1
            lc = lt.get('Color', [255, 255, 255])
            out.append(f'<Item class="PointLight" referent="RBX{ref}"><Properties>')
            out.append(f'<string name="Name">{sax.escape(b.name)}Light</string>')
            out.append(f'<float name="Brightness">{lt.get("Brightness", 1):g}</float>')
            out.append(f'<float name="Range">{lt.get("Range", 30):g}</float>')
            out.append('<bool name="Enabled">true</bool>')
            out.append(f'<bool name="Shadows">{str(bool(lt.get("Shadows", True))).lower()}</bool>')
            # PointLight.Color IS A Color3, NOT A Color3uint8. BasePart.Color is
            # the uint8 one and the two are not interchangeable: Rojo refuses the
            # whole model with "Property type mismatch" and the map fails to
            # build, which is a hard stop rather than a cosmetic warning.
            out.append('<Color3 name="Color">'
                       f'<R>{int(lc[0]) / 255.0:g}</R>'
                       f'<G>{int(lc[1]) / 255.0:g}</G>'
                       f'<B>{int(lc[2]) / 255.0:g}</B>'
                       '</Color3>')
            out.append('</Properties></Item>')
        out.append('</Item>')
        ref += 1
    out.append('</Item></roblox>')
    return "\n".join(out)


# --------------------------------------------------------------------------

def _kill_plane_size(m):
    """THE KILL PLANE IS NOT THE PLAY VOLUME, and sizing it off `bounds` made it
    exactly the play volume - so a player launched OUT of the arena, which is
    the entire point of a ring-out, falls past the edge of the thing meant to
    kill them and keeps falling forever. On one arena map a finisher
    throws you 34 studs and `bounds` is correctly the 220-stud plaza rather than
    a padded box, which made the miss certain. Sized at three times the play
    volume plus 400 studs: it costs one part and it cannot be overshot."""
    ex = m.bounds[1][0] - m.bounds[0][0]
    ez = m.bounds[1][2] - m.bounds[0][2]
    return (max(ex * 3.0, ex + 400.0), max(ez * 3.0, ez + 400.0))


def _apply_lift(m):
    """Raise every emitted instance by `volume.lift`, and say so.

    THE y=0 EDITOR-GRID BUG, THIRD OCCURRENCE. Studio draws its editor grid at
    exactly y=0, so any surface landing there gets the grid painted across it
    and finished work looks broken. The skill's own docs say this "has shipped
    twice" and tell you to verify it after every build - but the lift was only
    ever applied by `luau/build.lua`, on the serve_map route. Both transports
    HERE emitted the spec's raw coordinates, so every map built with
    `emit.py --lua` or `emit.py --rbxmx` sat on the grid regardless of what
    `volume.lift` said.

    Measured on a farm map: it declared lift 8.0, and verify_ground found
    30 surfaces at exactly y=0.00 - all four ground slabs and every route slab.

    The lift is applied to the resolved boxes rather than inside each emitter,
    so the two transports cannot disagree about it, which is the same reason
    they are generated from one resolved tree in the first place.
    """
    # Default 8, the same as serve_map.py and build.lua: more than one 4-stud
    # terrain voxel. An explicit "lift": 0 is honoured.
    lift = float((m.source.get("volume") or {}).get("lift", 8.0) or 0.0)
    if lift == 0.0:
        return 0.0
    for b in m.boxes:
        x, y, z = b.centre
        b.centre = (x, y + lift, z)
    # AND THE SPAWNS. They were not lifted, so on any map with a non-zero lift
    # every SpawnLocation stayed at its authored height while the floor rose
    # away from it - on an 8-stud lift that is twelve spawns buried 7 studs
    # inside the plaza. An arena map with lift 0 never hit
    # it, which is exactly why it needed finding by reading rather than failing.
    m.spawns = [(x, y + lift, z) for (x, y, z) in m.spawns]
    return lift


def main(argv=None):
    ap = argparse.ArgumentParser(description="Emit a map spec for Studio.")
    ap.add_argument("spec")
    ap.add_argument("--lua", nargs="?", const="-", help="write the Luau builder")
    ap.add_argument("--rbxmx", nargs="?", const="-", help="write the rbxmx model")
    a = ap.parse_args(argv)

    m = specmod.load(a.spec)
    lift = _apply_lift(m)
    if lift:
        print(f"[emit] applied volume.lift {lift:g} - the spec is authored around "
              f"y=0 and the built map sits clear of Studio's editor grid")
    slug = os.path.splitext(os.path.basename(a.spec))[0]
    th = None
    if m.source.get("theme"):
        import theme as thememod
        th = thememod.load(m.source["theme"])
    if not a.lua and not a.rbxmx:
        a.lua = "-"
    for flag, fn in ((a.lua, lambda: to_lua(m, slug, th)), (a.rbxmx, lambda: to_rbxmx(m))):
        if not flag:
            continue
        text = fn()
        if flag == "-":
            print(text)
        else:
            with open(flag, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"wrote {flag}  ({len(text)} bytes, {len(m.boxes)} parts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
