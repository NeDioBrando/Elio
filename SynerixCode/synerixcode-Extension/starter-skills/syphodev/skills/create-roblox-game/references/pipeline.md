# The pipeline, stage by stage

Each stage: what it reads, what it runs, what proves it is done, and the trap
that stage is known for. Commands are relative to each skill's own directory
(`~/.claude/skills/<name>`) unless a path is given.

---

## 0. Preflight

```bash
python ~/.claude/skills/create-roblox-game/scripts/preflight.py
```

**Done when** every REQUIRED row is green. Degraded rows close one stage each and
the report names which.

**Trap:** the things no script can check are printed at the bottom - one
MCP server only, and a universe minted by hand if this run publishes. Paths and
tool locations that preflight cannot find belong in `LOCAL.md`. Two connected MCP servers is a known deadlock; two Rojo
connections duplicates every new file and kills every Knit controller.

---

## 1. Research

Use a research skill if you have one (or plain WebSearch/WebFetch), or fan out
`roblox-market-scout` across independent genre candidates (this is the safest place to rehearse fan-out - nothing it does
touches Studio).

**Done when** there is a findings file naming the genre, saying why, and citing
sources that were actually opened. Count origins, not repetitions.

**Trap:** a saturated topic is not disqualifying, but a reskin of something that
already died is. Keep the market read in your own project notes, not only in the run.

---

## 2. Design

This skill owns it. Fill `design/game.json` and each stage spec.

```bash
python ~/.claude/skills/create-roblox-game/scripts/validate.py
```

**Done when** validate passes: no TODO in any live spec, every referenced file
exists, a core loop of at least two steps, `out_of_scope` non-empty, every system
naming the state it owns.

**Trap:** every asset skill downstream does something plausible with a vague
spec. Plausible is worse than broken, because it looks finished.

---

## 3. Code

Reads `systems` and `config` from the contract.

```bash
cd <game> && aftman install && wally install
python ~/.claude/skills/roblox-code/scripts/check.py
```

**Done when** all four gates are green **on the scaffold, before game logic**,
and green again after each system lands.

**Trap:** Core modules take plain `(x, y, z)` scalars. `Vector3` and `CFrame` are
not Lune globals, so a Core module using them cannot be tested at all.

---

## 4. Map

Reads `design/map.json`.

```bash
python scripts/plan.py <name> --prove -o plan.png    # look at the PNG
python scripts/emit.py <name> --lua build.lua        # small map
python scripts/emit.py <name> --rbxmx <Name>.rbxmx   # large map
python scripts/lighting.py golden_hour --theme <theme>
```

**Done when** the prover returns PASS. **UNVERIFIABLE is not a pass** - it means
the check could not see its target, which is a failure result.

**Traps:** build from a downloaded reference image, never from imagination.
This stage proves the layout (greybox and terrain); props come from your own
models or `roblox-3d-model`, never from stacks of primitive parts. Terrain quantises to a 4-stud voxel grid, so
`volume.lift` must be a multiple of 4 and two materials must never share a voxel
band. Nothing may sit at exactly y=0 or Studio paints its editor grid across it.

---

## 5. Meshes and colour

Reads `design/meshes.json`.

```bash
python scripts/batch.py concepts --outdir <dir>   # 2D gate: verify the image FIRST
python scripts/batch.py meshes   --outdir <dir>
python scripts/batch.py orient   --outdir <dir>
python scripts/batch.py paint    --outdir <dir>
python scripts/batch.py publish  --outdir <dir>
```

**Done when** the manifest lists **measured** bounds and tri counts, all under
budget. Never a typed dimension: hand-typed bounds drifted 47% on a previous run.

**Traps:** the 2D concept gate exists because a vision model can judge an image
and cannot judge a raw mesh - it has rejected a bee that generated as three bees.
A GLB imports as a triangle soup, so weld right after import or Decimate
under-reduces while reporting success. **Colour: PAINT it, do not project it** -
`paint_texture.py` stamps colour into the UV atlas from a small JSON spec and is
exact because there is no camera to align; the concept-projection route smears
and is only for assets that need the concept's actual markings. Cached meshes
need `CanCollide` set or players walk through everything, invisibly to every
render.

---

## 6. UI

Reads `design/ui.json`.

```bash
python scripts/ui_build.py <spec>.json --out mockups --icons icons
python scripts/gen_icons_cf.py --manifest <icons>.json --out <project>/icons
```

**Done when** the PNG mockup and the `.model.json` come from the same resolved
tree, and the mockup has been looked at.

**Trap:** `ClipsDescendants` does not clip rotated frames.

---

## 7. Animation

Reads `design/animations.json`.

```bash
python scripts/anim_render.py -- spec.json out/
python scripts/to_roblox.py <clip>.json > build.lua
```

**Done when** the verification renders exist **and someone looked at them**, and
the side-by-side against the reference holds.

**Traps:** animate in FK, not IK - a KeyframeSequence is per-joint rotations, and
IK leaves limb roll free so blocky parts flip faces between frames. Match a
reference by joint angle and fraction-of-reach, never by distance.
`RegisterKeyframeSequence` gives a working ContentId with no upload. Those ids
are **session-local**, which is accepted: you right-click and save the
animations at the end, and a game testable in Studio counts as created. Not a blocker.

---

## 8. VFX

Reads `design/vfx.json`.

```bash
python scripts/find_vfx.py --lib <your harvested VFX library folder>
python scripts/emit_luau.py --lib <your recipes folder> <out>.lua
```

**Done when** every effect has phase-frozen captures that were inspected.

**Library:** the effects come from YOUR harvested library (free Creator Store VFX
packs you took into your account and harvested with `roblox-vfx`; its path is in
`roblox-vfx/LOCAL.md`). No effects ship with the pack. An empty library means
harvest a pack first.

**Traps:** harvest effects, never generate them. A "multi-layer" library recipe is
often a variant sheet, not a layered effect. Batch new effects into a fresh
session: context re-reads, not thinking, are what cost.

---

## 9. Sound

Reads `design/sfx.json`.

```bash
python scripts/find_sfx.py spec <spec>.json --out work/candidates.json
python scripts/emit_probe.py work/candidates.json --out work
# execute_luau probe.lua, then report.lua, save the return verbatim
python scripts/pick.py work/candidates.json work/report.txt --out work/manifest.json
python scripts/emit_bank.py work/manifest.json --out work
```

**Done when** roles filled equals roles requested. An unfilled role is a failure,
not a warning.

**Trap:** the toolbox's `duration` field is a claim; `Sound.TimeLength` measured
in Studio is the only thing allowed to gate.

---

## 10. Assembly

**One thread. This is the law, not a preference.**

`rojo serve`, connect exactly one Rojo session, then place the map, insert the
meshes, install the sound bank, build the UI.

**Done when** the build stamp is in Output, no duplicate ModuleScripts exist, and
every asset is where the contract says.

**Traps:** an established TCP connection is not a synced session - an unaccepted
connect prompt once blocked syncing for a whole session while everything looked
fine. `execute_luau` caches `require`, so verify through `.Source`. It also drops
all output if the script yields.

---

## 10b. Wiring - the handoff gate

```bash
python ~/.claude/skills/create-roblox-game/scripts/verify_wired.py --dir <game>
# run work/wired_probe.lua in EDIT MODE via execute_luau, save the return verbatim
python ~/.claude/skills/create-roblox-game/scripts/verify_wired.py --dir <game> --report work/wired_report.txt
```

**Done when** both passes are green. Never hand over on the static pass alone.

**Trap:** every other gate in this pipeline asks whether a stage produced its
artifact. This is the only one that asks whether the game USES it, and that is a
different question with a different answer. Measured 2026-08-31: a HUD shipped
with three empty ImageLabels because the icons were generated, cut out, rendered
into the mockup and never uploaded - `Image=""` in the emitted tree, green
everywhere else.

**Second trap, live pass only:** Rojo updates properties without necessarily
removing attributes that no longer exist in the source, so a resolved icon can
still carry its stale `PendingIcon`. The static pass cannot see that; the live
probe can.

---

## 11. Playtest

**This is a real stage with a method, not a rubber stamp.** Everything before it
runs in edit mode and therefore cannot tell you whether the game WORKS. On
2026-09-06 a build reached handover fully green with the UI at the wrong scale,
every ability rejected, weapons through the floor and four of eleven VFX called
by nothing. The first ten minutes of playing found all of it.

Do these, in order:

1. `Window > Output` BEFORE pressing play. It is the only readable channel from
   the running game - `get_playtest_output` returns `[]` while `isRunning` is
   true, and `capture_screenshot` is edit-mode only.
2. Set the Test tab's client count to **2** and play. Solo cannot land a hit, so
   combat, combos, ragdoll, the parry and every hit-triggered effect go
   untested - and solo also hides round-flow bugs.
3. Burst-capture frames (`scripts/capture_frames.ps1`) and look at EVERY
   frame. A still cannot show a swing, a blade trail or a shockwave radius.
4. Strip the tester's avatar costume before judging weapon placement - a layered
   outfit hides a 7-stud sword completely.
5. Grep the source for every VFX name in the manifest. An effect nothing calls
   is invisible, and reads as "the VFX are broken".

### The old note

**Use Studio's built-in MCP, not the third-party one** - `references/mcp.md` has
the evidence and the switch. The built-in server has working play-mode tools:
`start_stop_play`, `get_console_output`, `screen_capture`, `character_navigation`,
`user_keyboard_input`, `user_mouse_input`, and `get_studio_state` to ask which
mode Studio is actually in.

`execute_luau` runs in the Edit DataModel unless told otherwise. During Play,
`scripts/studio_mcp.py luau --dm Server` (or `--dm Client`) runs the probe in the
running game itself. Printing from game code and collecting it with
`get_console_output` is still the first channel to build: it survives a crash.

**Done when** a human has played it and reported back. Their finding is real
evidence - on a previous build the only defect that mattered came from a
playtest, because the test stage was not a faithful stand-in for a live player.

---

## 12. Publish

```bash
python ~/.claude/skills/roblox-3d-model/scripts/upload_asset.py --file <asset> --name <name>
```

**You mint the universe and place by hand, once, before the run** - the
Universes API cannot create one and an unsaved place is `placeId 0`. That is a
free intervention under the pipeline's rules, and doing it up front removes
the only hard blocker from the ending. Put the resulting ids in `game.json`
under `publish`. `ROBLOX_API_KEY` authenticates; whether it carries
`universe-places` write is testable the moment a universe exists.

**Done when** the place is published and joinable, and audio and animation assets
have been confirmed to work **in a real server** rather than only in Studio.
