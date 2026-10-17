# Roblox map design, researched

Sources, all fetched 2026-08-27:

- [Map Design Guidelines](https://devforum.roblox.com/t/map-design-guidelines-make-your-maps-superior/1293781) - Roblox DevForum
- [Ruski's Tutorial #5: How to Design an Open World Map](https://devforum.roblox.com/t/ruskis-tutorial-5-how-to-design-an-open-world-map/3554962) - Roblox DevForum
- [How You Can Make Stylized Flat-Color Art](https://devforum.roblox.com/t/how-you-can-make-stylized-flat-color-art/1510773) - Roblox DevForum
- [Grow a Garden layout guide](https://deltiasgaming.com/grow-a-garden-roblox-guide-how-to-get-the-best-layout/) - Deltia's Gaming

Worth stating plainly: **neither DevForum map guide gives a single stud
measurement.** The numeric rules below are derived from what they do give, or
come from the movement profile. Do not treat them as quoted authority.

---

## Layout

**The Triangle Rule.** Every POI should be connectable to the others with
triangles. That is what guarantees more than one route to anything, which is the
"player choices" guideline stated as geometry rather than as advice.

**40 seconds between POIs.** Ruski's figure, to stop players getting
disoriented. Converted against the movement profile:

| Speed | 40 s | Practical POI spacing |
|---|---|---|
| walk 16 | 640 studs | a farm or hub map wants 120-250, i.e. 8-16 s |
| sprint 24 | 960 studs | |

640 studs is a CEILING, not a target. A farming game where you walk constantly
wants POIs far closer than the limit.

**Spheres of Interest.** Draw a circle around each POI. Where two circles
overlap is where secondary content belongs - a cabin, a campsite, a well. It
turns "where do I put the small stuff" into a construction.

**Workflow, in order:** block out POIs, draw biome borders, create the main
connecting paths, map the spheres, place the in-between locations, playtest for
travel distance, add indirect paths, mark loot.

**Defer the map shape.** Decide the POIs first; the outline is a consequence.

---

## Landmarks and readability

- A landmark must be **distinct and instantly recognisable**, and needs a
  **vertical element** to separate it from the terrain around it. This is why
  the farm map's windmill sits on a raised tier: the verticality is doing the
  work, the windmill only makes it memorable.
- **Place landmarks at corners, not mid-block.** Players slow down at turns, so
  a landmark on a corner gets looked at.
- **Give each zone its own palette.** Colour is the cheapest zone separator
  there is.
- **Main paths: broad, clearly defined, with a wide entry point.** Narrow
  entrances read as "not this way" even when they are the intended route.

## Verticality

Buys four things at once: vantage points, landmarks, cover/occlusion, and focal
points. Height advantage is a gameplay lever as well as a visual one.

## Cover and occlusion

Cover should hide information without making a player safe. The guideline is
explicit that occlusion should leave you vulnerable - a wall you can hide behind
forever is a hole in the map, not cover. Harmonise structures, layout and props
rather than leaning on one of them.

## The whiteboard test

Break out of the grid. Irregular positions, rotations and curves. A map built on
90-degree increments reads as a greybox no matter how well it is textured, so
jitter yaw on repeated pieces and bend paths rather than running them straight.

---

## The farming genre specifically

From the Grow a Garden research:

- **The fenced plot is the unit of layout**, not the open field. Six plots, each
  subdivided into four. The fence is what makes a space read as one player's.
- **A water feature with a rock border**, not a bare blue rectangle.
- **A raised backdrop with a built-in staircase** - the vertical anchor.
- **Heavily decorated outer edges**: trees, flowers, mushrooms, moss, rocks. A
  bare map edge is the clearest tell of an unfinished build.
- Organise by purpose and keep the flow attractive; efficiency and looks are not
  in tension.

---

## Lighting

For a **fully flat cartoon** look the tutorial is specific, and the values are
surprising: `Brightness` 0, `Ambient` and `OutdoorAmbient` both 255,255,255,
`GlobalShadows` off, `Technology` Voxel, `ClockTime` 8, `ExposureCompensation`
0.5-1.0, and `CastShadow` off on every part. Known unsolved issue: ambient
occlusion still appears at maximum graphics quality.

That is one specific aesthetic. For a **shaded stylised** look - which is what
the farm map uses - keep Future lighting and shadows, and use the numbers this
skill measured instead:

| Setting | Value | Why |
|---|---|---|
| Atmosphere Density | 0.10-0.14 | 0.36 turned a 300-stud map into a fog bank |
| Atmosphere Haze | 0.2-0.3 | 1.7 was unusable |
| ColorCorrection TintColor | near-white | it multiplies the WHOLE frame |
| ClockTime | 9-10 | long warm shadows, which is most of the "morning farm" read |

**`Lighting.Technology` cannot be set from plugin context** - it errors with
*lacking capability RobloxScript* and cannot even be read. Set it by hand.
Without `Future` the textured materials render noticeably flatter.


---

# Water

Sources: [Terrain API](https://create.roblox.com/docs/reference/engine/classes/Terrain),
[Terrain water physics and customization](https://devforum.roblox.com/t/terrain-water-physics-and-customization/609743).

**Use Terrain water. A transparent part is not water.** A Glass slab has no
waves, no reflection, no buoyancy and you cannot swim in it. Terrain water has
all four for free, and `Terrain:FillBlock(cframe, size, Enum.Material.Water)`
works from plugin context - verified.

Engine defaults, read live:

| Property | Default |
|---|---|
| `WaterColor` | (12, 84, 92) |
| `WaterTransparency` | 0.30 |
| `WaterReflectance` | 1.00 |
| `WaterWaveSize` | 0.15 |
| `WaterWaveSpeed` | 10 |

Defaults are tuned for deep ocean. For a farm pond: colour (58,128,122),
transparency 0.62, reflectance 0.28, wave size 0.06, wave speed 6.

**Two traps, both measured:**

1. **Terrain water cannot show through a solid part.** A pond dug into a single
   470-stud ground slab is invisible, because the slab is over it. The ground
   needs a genuine HOLE - build it from several parts around the water.
2. **Terrain is a 4-stud voxel grid, so an overlapping rock/water fill does not
   blend, it fights** - and rock wins whole voxels, which puts islands through
   the middle of a pond. The basin must END where the water BEGINS.

Known limits: wave height is capped low, customisation is global rather than
per-voxel, and there is no foam or white-cap support.

---

# Buildings

Sources: [Assemble modular environments](https://create.roblox.com/docs/tutorials/use-case-tutorials/modeling/assemble-modular-environments),
[Ruski's Tutorial #2](https://devforum.roblox.com/t/ruskis-tutorial-2-how-to-design-a-simple-house/330237).

**A house is not a box with a lid.** The clearest tell of a beginner build is a
roof flush with the wall. The roof overhangs the wall by **1-2 studs**, and the
shingle course overhangs **that** by another stud. Two overhangs.

| Element | Number |
|---|---|
| Wall thickness | **0.7 studs** |
| Roof overhang | 1-2 studs past the wall |
| Shingle course | 1 stud past the roof |
| Window sill height | referenced against a character, about bellybutton |
| Useful increments | 1, 0.5, 0.25, 0.125 |

**Modular kits use a 7.5-stud grid.** Roblox's Modern City kit sets minimum mesh
length 7.5 and every larger length divisible by 7.5, so pieces align without
overlap even when rotated. Move snap 7.5, rotate snap 45.

**Pivot consistency is "of vital importance"** - Roblox's own words - with the
pivot at the forward-most lower corner. And **move ONE mesh at a time**: a
multi-selection averages pivot points and breaks alignment. That is the same
class of bug that put 176 mesh props out by up to 16 studs.

**What separates built from extruded:** trim wherever two masses meet - corner
boards, eaves board, sills, plinth. Windows need a REVEAL, a recess with real
depth, or they read as stickers. Siding runs at one rotation; roof shakes get
offset sizes and varied rotation, because a regular grid reads as copy-paste.

Plan before building: most Roblox houses have an awkward layout, and that comes
from building before planning.

---

# Ambient motion

**TweenService cannot tween a Model.** Tween a Model's PrimaryPart and only that
part moves; the rest stays behind, with no error. Two ways round it:

1. **Weld** every part to the PrimaryPart, then tween the PrimaryPart.
2. Tween a `CFrameValue` and `PivotTo` the model on its `Changed` signal.

`scripts/luau/ambient.lua` does spin, bob, sway and pulse, driven by
CollectionService tags so nothing in the map needs to know it exists.

**Keep it slow and small.** Motion that draws the eye is not ambient. Sway
canopies, never trunks - swaying a whole tree reads as an earthquake.


---

# Working from a reference

Reference used: "Low-Poly Stylized Cottage" by oprerad (Sketchfab, CC-BY) -
visual reference only, no geometry copied.

Building from a downloaded reference image beats describing one. Six things the
reference made obvious that no amount of reasoning had:

1. **The roof is as tall as the walls.** Steep, 45-55 degrees. A shallow lid on
   a box reads as a shed, which is exactly what the earlier version was.
2. **The gable faces the front.** You look at a triangle, not a long flat wall.
3. **Half-timbering** - vertical posts and diagonal braces across the facade.
   Thin boxes, and they carry most of the character.
4. **Round and arched windows, not rectangles.** A circle in the gable apex, an
   arch below.
5. **Nothing is perfectly square.** A one-to-two degree lean is the difference
   between storybook and CAD.
6. **It meets the ground on a mound**, with planting at the base - never a hard
   edge between a flat wall and a flat floor. (The mound belongs to the MAP, not
   baked into the building asset, or the house brings its own ground and fights
   whatever it is placed on.)

**Inspect in the session that builds it.** Three renders were wasted guessing
which way a glb faces after the Y-up conversion, and a four-view turntable of
the re-imported model still showed four identical faces. Rendering the geometry
as built, before export, removes the question: what you see is exactly what the
exporter is about to write, so give a building generator a preview pass.

Blender camera aiming, since it cost a render too: a camera at yaw `y` around
the origin needs `rotation_euler = (pitch, 0, radians(180) - y)`. Using
`180 + y` points it away from the subject and renders an empty field.
