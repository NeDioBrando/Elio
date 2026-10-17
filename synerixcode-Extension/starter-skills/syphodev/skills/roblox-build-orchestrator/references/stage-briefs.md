# Worked briefs, one per worker

Workers start cold. They cannot see the design spec, the conversation, or each
other. Everything a worker needs has to be in the message that spawns it.

The failure this prevents is specific and expensive here: an underspecified brief
produces a worker that stops and asks, and a stop-and-ask is an intervention on
the run's counter. An agent asking whether it may fall back is an intervention
caused by your own brief being incomplete.

## The four fields

Every brief carries all four. The stop condition is the one most often left off
and the one that matters most on a clock.

| Field | What it answers | Failure if missing |
|---|---|---|
| OBJECTIVE | The one self-contained outcome | Worker solves a share of a goal it cannot see |
| OUTPUT | Exact paths and manifest shape | Manager re-reads the work in its own context |
| TOOLS | Which skill, which sources, which tier first | Worker picks a slower route |
| BOUNDARIES | Out of scope, fallback, wall-clock stop | Worker overruns, or stops to ask |

## Directory convention

Give every worker a distinct output path. Distinct paths are what make concurrent
writes safe, so this is not cosmetic.

```
build/<run-name>/
  spec/design.md              written by the manager, read by every worker
  assets/map/                 roblox-asset-map
  assets/meshes/              roblox-asset-mesh
  assets/ui/                  roblox-asset-ui
  assets/anim/                roblox-asset-anim
  assets/vfx/                 roblox-asset-vfx
  assets/sfx/                 roblox-asset-sfx
  research/<genre>.md         roblox-market-scout, one file each
  manifests/*.json            one per worker, read by the assembly thread
```

---

## roblox-asset-mesh

```
OBJECTIVE
Produce game-ready MeshParts for these six props, from the design spec at
build/run-3/spec/design.md, section "Props": sheep, fence post, gate, hay bale,
lantern, wolf.

OUTPUT
Mesh files in build/run-3/assets/meshes/.
A manifest at build/run-3/manifests/meshes.json, one entry per asset:
{"name","path","tris","bounds_studs","tier","verified","notes"}
Bounds measured by the exporter, not typed.

TOOLS
Use the roblox-3d-model skill. Attempt Tier 2 (own chain: image gen, verified 2D
mockup, image-to-3D, headless Blender decimate) first. Tier 1 fallback is the
Studio MCP generate_mesh (Cube 3D).

BOUNDARIES
Meshes only. No textures beyond what the paint step in the skill produces, no
placement, no Studio. Falling back from Tier 2 to Tier 1 is pre-authorised, do
not ask. Hard stop at 50 minutes: report what is finished and what is not rather
than overrunning. Under 1,500 tris per prop.
```

## roblox-asset-ui

```
OBJECTIVE
Build the three screens described in build/run-3/spec/design.md section "UI":
the run HUD, the flock counter, and the end-of-run summary panel.

OUTPUT
build/run-3/assets/ui/{hud,flock,summary}.model.json
The matching Luau builder and PNG mockup for each, same basenames.
A manifest at build/run-3/manifests/ui.json listing all three plus whether
rojo build passed for each.

TOOLS
Use the roblox-ui skill, one spec to all three outputs. Procedural properties for
everything except icons and 9-slice tiles.

BOUNDARIES
No Studio. No gameplay code, only the UI tree and its builder. Run rojo build on
each model.json before reporting; a file that fails to build is not done. Hard
stop at 25 minutes.
```

## roblox-asset-anim

```
OBJECTIVE
Author three R15 animations from build/run-3/spec/design.md section "Animation":
sheep idle, sheep walk, wolf lunge.

OUTPUT
build/run-3/assets/anim/<name>.json (KeyframeSequence spec)
build/run-3/assets/anim/<name>_sheet.png (contact sheet, for the manager to check)
A manifest at build/run-3/manifests/anim.json with, per animation, the spec path,
the sheet path, duration, and your own verdict on whether it reads correctly.

TOOLS
Use the roblox-animation skill. FK, not IK. R15.

BOUNDARIES
No Studio, no registering the KeyframeSequence, no uploading. Falling back to a
Creator Store search is pre-authorised if Tier 2 fails; say which you used. Hard
stop at 60 minutes. If an animation looks wrong on its contact sheet, report it as
wrong rather than passing it on.
```

## roblox-asset-vfx

```
OBJECTIVE
Assemble the effects listed in build/run-3/spec/design.md section "VFX": wolf
lunge trail, hay-bale impact burst, lantern glow (always on).

OUTPUT
build/run-3/assets/vfx/ : the emitted Luau recipe modules and the adapter that
maps each game effect name onto a recipe.
A manifest at build/run-3/manifests/vfx.json, one entry per game effect:
{"effect","recipe","persistent","started_by","notes"}
"persistent" says whether it needs setEnabled(true) (continuous) or emit()
(one-shot), and "started_by" says which call starts it.

TOOLS
Use the roblox-vfx skill and search the user's own harvested recipe library
(free Creator Store packs they harvested with the skill). No effects ship with
the pack, and nothing is hand-written.

BOUNDARIES
No Studio. If the library has nothing close, list the effect as not covered
instead of inventing one. Never claim an effect was verified visually: nothing
here can see it run. Hard stop at 30 minutes.
```

## roblox-asset-map

```
OBJECTIVE
Build the level described in build/run-3/spec/design.md section "Map" as a
proven greybox/terrain layout.

OUTPUT
build/run-3/assets/map/ : the plan PNG, the prover result, and the emitted
build.lua or .rbxmx. A manifest at build/run-3/manifests/map.json with the
prover verdict (PASS, FAIL or UNVERIFIABLE) and the measured extents.

TOOLS
Use the roblox-map skill: spec, plan, prover, greybox, terrain. Props are not
generated here; they come from the user's own models or the roblox-3d-model
skill.

BOUNDARIES
No Studio. UNVERIFIABLE is a failure result, not a pass: report it as one.
Hard stop at 60 minutes.
```

## roblox-asset-sfx

```
OBJECTIVE
Source eight sound effects listed in build/run-3/spec/design.md section "Audio".

OUTPUT
Audio files in build/run-3/assets/sfx/.
A manifest at build/run-3/manifests/sfx.json:
{"name","path","source","licence","attribution_required","tier","duration_s"}

TOOLS
Attempt Tier 2 (Freesound MCP) first. Tier 1 fallback is the Creator Store via
search_asset, which is free and pre-licensed.

BOUNDARIES
No Studio and no uploading, at all: the Open Cloud audio quota is create-only and
monthly, and the assembly thread owns it. Every file needs an established licence
or it does not ship; drop anything you cannot verify and say which. Fallback is
pre-authorised. Hard stop at 45 minutes.
```

## roblox-market-scout (one per genre, spawned in parallel)

```
OBJECTIVE
Research exactly one genre: <genre>. Assess whether a solo eight-hour build could
produce something competitive in it right now.

OUTPUT
build/run-3/research/<genre>.md, using the headings in your agent definition.
Every URL you actually opened, listed.

TOOLS
Live Roblox data first: current CCU, visit counts, last-update dates on real
comparables. Secondary commentary only where live data does not exist.

BOUNDARIES
This genre only. Do not research adjacent ones even if they look better, and do
not recommend a winner across genres; the manager does that comparison. A weak
verdict is as useful as a strong one. Hard stop at 12 minutes.
```

---

## Merging the reports

The manager reads manifests, not conversations. Two habits keep that honest:

**Check the artifact, not the claim.** A worker reporting that a mesh is 1,420
tris is a claim. The manifest plus the file is the fact. Spot-check the ones that
matter before assembly, because a wrong bound or a missing UV surfaces at assembly
time with no budget left to fix it.

**When two workers disagree, open the files.** Averaging two reports produces an
answer neither worker would defend.
