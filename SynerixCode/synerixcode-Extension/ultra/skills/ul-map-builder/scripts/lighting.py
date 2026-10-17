"""Lighting presets, and the Luau that applies them.

Lighting is the highest-leverage visual system in a Roblox place - the same
geometry reads as amateur or professional almost entirely on this. It is also
the easiest thing to get catastrophically wrong, which is why the numbers here
are presets rather than an invitation to guess.

SIX THINGS MEASURED IN A LIVE SESSION, ALL OF WHICH COST TIME TO LEARN:

1. ATMOSPHERE NEEDS A SKY. Roblox's own documentation states Atmosphere
   requires at least one Sky in Lighting to affect the scene. Every map this
   skill built before now shipped an Atmosphere with no Sky instance, so it was
   doing less than it appeared to. `Sky` is now part of every preset.

2. `Lighting.Technology` CANNOT BE SET OR READ from plugin context - it errors
   with "lacking capability RobloxScript". Every other Lighting property writes
   fine. The applier wraps each property in its own pcall and REPORTS what it
   could not set, rather than losing the whole pass to one property.

3. ROBLOX ATMOSPHERE IS FAR STRONGER THAN A PALETTE SUGGESTS. Density 0.36 with
   Haze 1.7, derived from a sky colour, turned a 300-stud map into a fog bank in
   which the geometry was barely visible. Outdoor presets here sit at 0.08-0.15.

4. A SATURATED ColorCorrection TintColor MULTIPLIES THE WHOLE FRAME. It must
   stay near-white unless a strong colour grade is the actual intent.

5. ColorShift_Top IS ADDITIVE, NOT A TINT. Set to a near-white (255,244,224) it
   bleached a whole textured test scene pale icy blue. Working values sit around
   (12,10,6) to (18,14,8).

6. BLUE AMBIENT TIMES BLUE ALBEDO COMPOUNDS. With a blue-tinted OutdoorAmbient,
   blue-grey stone in shade rendered as saturated navy. Keep ambient near-neutral
   and let the surface colour carry the hue.

`ExposureCompensation` is the one dial worth knowing beyond the presets: it is
photographic exposure, so a NEGATIVE value plus a raised Brightness gives the
"crispy" look developers use to kill neon glare, and a positive value lifts a
scene that reads muddy.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)


def _c(v):
    return f"Color3.fromRGB({int(v[0])}, {int(v[1])}, {int(v[2])})"


# --------------------------------------------------------------------------
# presets
# --------------------------------------------------------------------------

PRESETS = {
    # Bright stylised outdoors. The default for a cartoon game map.
    "stylised_day": {
        "note": "warm mid-morning, soft shadows, gentle haze",
        "Technology": "Future", "ClockTime": 9.6, "GeographicLatitude": 18,
        "Brightness": 2.4, "ExposureCompensation": 0.05,
        "Ambient": [58, 54, 48], "OutdoorAmbient": [124, 122, 108],
        "ColorShift_Top": [12, 10, 6], "ColorShift_Bottom": [0, 0, 0],
        "EnvironmentDiffuseScale": 0.6, "EnvironmentSpecularScale": 0.35,
        "ShadowSoftness": 0.42, "GlobalShadows": True,
        "Sky": {"SunAngularSize": 13, "MoonAngularSize": 11, "StarCount": 0,
                "CelestialBodiesShown": True},
        "Atmosphere": {"Density": 0.10, "Offset": 0.0,
                       "Color": [232, 226, 210], "Decay": [160, 168, 172],
                       "Glare": 0.12, "Haze": 0.22},
        "Bloom": {"Intensity": 0.42, "Size": 20, "Threshold": 0.95},
        "ColorCorrection": {"Brightness": 0.015, "Contrast": 0.10,
                            "Saturation": 0.14, "TintColor": [255, 252, 244]},
        "SunRays": {"Intensity": 0.05, "Spread": 0.9},
    },

    # Flat cartoon: no shading at all. The DevForum recipe, verbatim.
    # Deliberately extreme - it removes shadows entirely, so silhouette and
    # colour do all the work. Pair it with CastShadow off on every part.
    "flat_cartoon": {
        "note": "unshaded, retro, Adopt Me-ish. Needs CastShadow off on parts.",
        "Technology": "Voxel", "ClockTime": 8.0, "GeographicLatitude": 0,
        "Brightness": 0.0, "ExposureCompensation": 0.75,
        "Ambient": [255, 255, 255], "OutdoorAmbient": [255, 255, 255],
        "ColorShift_Top": [0, 0, 0], "ColorShift_Bottom": [0, 0, 0],
        "EnvironmentDiffuseScale": 0.0, "EnvironmentSpecularScale": 0.0,
        "ShadowSoftness": 1.0, "GlobalShadows": False,
        "Sky": {"SunAngularSize": 0, "StarCount": 0, "CelestialBodiesShown": False},
        "Atmosphere": {"Density": 0.0, "Offset": 0.0,
                       "Color": [255, 255, 255], "Decay": [255, 255, 255],
                       "Glare": 0.0, "Haze": 0.0},
        "Bloom": {"Intensity": 0.0, "Size": 24, "Threshold": 2.0},
        "ColorCorrection": {"Brightness": 0.0, "Contrast": 0.05,
                            "Saturation": 0.10, "TintColor": [255, 255, 255]},
        "SunRays": {"Intensity": 0.0, "Spread": 1.0},
    },

    # Golden hour. Long shadows, warm rim light, the "screenshot" preset.
    "golden_hour": {
        "note": "low warm sun, long shadows, strong rim - best for thumbnails",
        "Technology": "Future", "ClockTime": 17.1, "GeographicLatitude": 41,
        "Brightness": 2.1, "ExposureCompensation": 0.22,
        "Ambient": [46, 40, 44], "OutdoorAmbient": [116, 100, 96],
        "ColorShift_Top": [38, 22, 6], "ColorShift_Bottom": [8, 6, 14],
        "EnvironmentDiffuseScale": 0.5, "EnvironmentSpecularScale": 0.45,
        "ShadowSoftness": 0.5, "GlobalShadows": True,
        "Sky": {"SunAngularSize": 21, "StarCount": 0, "CelestialBodiesShown": True},
        "Atmosphere": {"Density": 0.15, "Offset": 0.15,
                       "Color": [255, 226, 190], "Decay": [150, 122, 128],
                       "Glare": 0.45, "Haze": 0.9},
        "Bloom": {"Intensity": 0.75, "Size": 26, "Threshold": 0.86},
        "ColorCorrection": {"Brightness": 0.0, "Contrast": 0.14,
                            "Saturation": 0.2, "TintColor": [255, 246, 232]},
        "SunRays": {"Intensity": 0.14, "Spread": 0.86},
    },

    # Flat grey daylight. Useful when you want to judge GEOMETRY, because
    # nothing is being flattered.
    "overcast": {
        "note": "neutral, unflattering, for judging form rather than mood",
        "Technology": "Future", "ClockTime": 12.0, "GeographicLatitude": 0,
        "Brightness": 1.6, "ExposureCompensation": 0.0,
        "Ambient": [92, 94, 98], "OutdoorAmbient": [148, 152, 158],
        "ColorShift_Top": [0, 0, 0], "ColorShift_Bottom": [0, 0, 0],
        "EnvironmentDiffuseScale": 0.85, "EnvironmentSpecularScale": 0.2,
        "ShadowSoftness": 1.0, "GlobalShadows": True,
        "Sky": {"SunAngularSize": 8, "StarCount": 0, "CelestialBodiesShown": False},
        "Atmosphere": {"Density": 0.20, "Offset": 0.0,
                       "Color": [212, 216, 222], "Decay": [182, 188, 196],
                       "Glare": 0.0, "Haze": 0.7},
        "Bloom": {"Intensity": 0.1, "Size": 18, "Threshold": 1.1},
        "ColorCorrection": {"Brightness": 0.0, "Contrast": 0.0,
                            "Saturation": -0.05, "TintColor": [255, 255, 255]},
        "SunRays": {"Intensity": 0.0, "Spread": 1.0},
    },

    # Night. Kept honest: a dark scene needs LIGHT SOURCES in the map, and this
    # preset alone will make an unlit map unreadable rather than atmospheric.
    "moonlit": {
        "note": "cold night. REQUIRES emissive props or PointLights in the map.",
        "Technology": "Future", "ClockTime": 0.4, "GeographicLatitude": 12,
        "Brightness": 0.9, "ExposureCompensation": 0.4,
        "Ambient": [22, 26, 40], "OutdoorAmbient": [40, 48, 72],
        "ColorShift_Top": [10, 14, 34], "ColorShift_Bottom": [0, 0, 0],
        "EnvironmentDiffuseScale": 0.35, "EnvironmentSpecularScale": 0.55,
        "ShadowSoftness": 0.6, "GlobalShadows": True,
        "Sky": {"SunAngularSize": 6, "MoonAngularSize": 16, "StarCount": 3000,
                "CelestialBodiesShown": True},
        "Atmosphere": {"Density": 0.24, "Offset": 0.0,
                       "Color": [96, 116, 156], "Decay": [40, 52, 84],
                       "Glare": 0.1, "Haze": 1.1},
        "Bloom": {"Intensity": 0.9, "Size": 28, "Threshold": 0.7},
        "ColorCorrection": {"Brightness": -0.02, "Contrast": 0.16,
                            "Saturation": -0.08, "TintColor": [206, 222, 255]},
        "SunRays": {"Intensity": 0.0, "Spread": 1.0},
    },
}

SCALARS = ("ClockTime", "GeographicLatitude", "Brightness",
           "ExposureCompensation", "EnvironmentDiffuseScale",
           "EnvironmentSpecularScale", "ShadowSoftness")
COLOURS = ("Ambient", "OutdoorAmbient", "ColorShift_Top", "ColorShift_Bottom")


def resolve(preset="stylised_day", theme=None):
    """Preset, then the theme's own lighting block on top."""
    if preset not in PRESETS:
        raise SystemExit(f"unknown preset '{preset}'. Have: {', '.join(PRESETS)}")
    cfg = json.loads(json.dumps(PRESETS[preset]))
    override = (theme or {}).get("lighting") or {}
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(cfg.get(k), dict):
            cfg[k].update(v)
        else:
            cfg[k] = v
    return cfg


def to_lua(cfg):
    L = []
    a = L.append
    a('local L = game:GetService("Lighting")')
    a('local skipped = {}')
    a('local function try(n, f) if not pcall(f) then table.insert(skipped, n) end end')
    a("")
    a("-- Technology is expected to fail from plugin context (RobloxScript "
      "capability). It is attempted anyway so the report names it.")
    a(f'try("Technology", function() L.Technology = Enum.Technology.{cfg["Technology"]} end)')
    for k in SCALARS:
        if k in cfg:
            a(f'try("{k}", function() L.{k} = {cfg[k]} end)')
    for k in COLOURS:
        if k in cfg:
            a(f'try("{k}", function() L.{k} = {_c(cfg[k])} end)')
    a(f'try("GlobalShadows", function() L.GlobalShadows = {str(cfg["GlobalShadows"]).lower()} end)')
    a("")
    a("-- CLEAR BY CLASS, NOT BY NAME. A Roblox place ships with its own Sky,")
    a("-- Atmosphere, Bloom, SunRays and DepthOfField, so an applier that only")
    a("-- deletes the instances it named itself leaves TWO of each in Lighting,")
    a("-- fighting. SKILL.md has said so since the farm map had exactly that;")
    a("-- this file was still clearing by name, so it had the defect its own")
    a("-- skill file documents.")
    a("for _, c in ipairs(L:GetChildren()) do")
    a('	if c:IsA("Sky") or c:IsA("Atmosphere") or c:IsA("PostEffect") then c:Destroy() end')
    a("end")
    a("")
    sky = cfg.get("Sky", {})
    a("-- ATMOSPHERE DOES NOTHING WITHOUT A SKY. Roblox requires at least one")
    a("-- Sky in Lighting for Atmosphere to affect the scene.")
    a('local sky = Instance.new("Sky")')
    a('sky.Name = "MapSky"')
    for k, v in sky.items():
        val = str(v).lower() if isinstance(v, bool) else v
        a(f"sky.{k} = {val}")
    a("sky.Parent = L")
    a("")
    at = cfg["Atmosphere"]
    a('local atm = Instance.new("Atmosphere")')
    a('atm.Name = "MapAtmosphere"')
    for k in ("Density", "Offset", "Glare", "Haze"):
        a(f"atm.{k} = {at[k]}")
    a(f'atm.Color = {_c(at["Color"])}')
    a(f'atm.Decay = {_c(at["Decay"])}')
    a("atm.Parent = L")
    a("")
    bl = cfg["Bloom"]
    a('local bloom = Instance.new("BloomEffect")')
    a('bloom.Name = "MapBloom"')
    a(f'bloom.Intensity = {bl["Intensity"]} bloom.Size = {bl["Size"]} '
      f'bloom.Threshold = {bl["Threshold"]}')
    a("bloom.Parent = L")
    a("")
    cc = cfg["ColorCorrection"]
    a('local cc = Instance.new("ColorCorrectionEffect")')
    a('cc.Name = "MapCC"')
    a(f'cc.Brightness = {cc["Brightness"]} cc.Contrast = {cc["Contrast"]} '
      f'cc.Saturation = {cc["Saturation"]}')
    a(f'cc.TintColor = {_c(cc["TintColor"])}')
    a("cc.Parent = L")
    a("")
    sr = cfg["SunRays"]
    a('local sr = Instance.new("SunRaysEffect")')
    a('sr.Name = "MapSunRays"')
    a(f'sr.Intensity = {sr["Intensity"]} sr.Spread = {sr["Spread"]}')
    a("sr.Parent = L")
    a("")
    a("return \"lighting applied. could not set: \" .. "
      "(#skipped > 0 and table.concat(skipped, \", \") or \"nothing\")")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Emit the Luau for a lighting preset.")
    ap.add_argument("preset", nargs="?", default="stylised_day")
    ap.add_argument("--theme")
    ap.add_argument("-o", "--out")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args(argv)
    if a.list:
        for k, v in PRESETS.items():
            print(f"  {k:14s} {v['note']}")
        return 0
    theme = None
    if a.theme:
        import theme as thememod
        theme = thememod.load(a.theme)
    text = to_lua(resolve(a.preset, theme))
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {a.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
