---
name: roblox-vfx
description: Harvest free Creator Store VFX packs, which you have taken into your own Roblox account, into your own searchable library of portable JSON particle recipes by reading every emitter property out of Studio, then classify, find, curate and emit them as a Luau runtime module (VFXKit) that builds them on any part with scale and tint. No effects ship with this skill, only the tooling. Verified by phase-frozen edit-mode screenshots, never by a metric. Use whenever the user wants a Roblox particle effect, explosion, aura, hit effect, fire, smoke, sparks or magic effect found and wired rather than dragged in by hand, wants to build a reusable VFX library from packs they own, or asks why their ParticleEmitter is invisible, never stops, or looks nothing like it did in the pack they copied it from.
---

# Roblox VFX, headless

A VFX effect is not an asset. It is about thirty numbers per layer plus a texture
reference. That single fact decides this skill's whole architecture: recipes are
**portable JSON you own**, and the only part you do not own is the texture.

---

## Start here (cold session)

> **First time on this machine?** Read `LOCAL.md` in this folder. If it does not exist, run the
> `roblox-skills-setup` skill (or copy `LOCAL.template.md` to `LOCAL.md` and fill it in).
> `LOCAL.md` holds your paths and tool locations; it is yours and is never shared.

**This skill is a harvester, not a pack.** It ships tooling and no effects. You
build your own library, in this order:

1. **Take free VFX packs into your own Roblox account, by hand.** Find a pack on
   the Creator Store (or in Studio's Toolbox) and press its Get / Add to
   Inventory button while signed in. This step cannot be automated: `insert_asset`
   and `InsertService:LoadAsset` both refuse an asset your account does not own,
   with "User is not authorized to access Asset", **even when the listing says
   free**. Free means free to take, not free to load. (Roblox's own "Particle
   Effects" pack, `228304820`, is the one exception measured: it loads without
   being taken, which makes it the test pack.)
2. **Put the pack in a Studio place** (drag it from your inventory into
   Workspace, in any place you have open).
3. **Run the harvester** (`payload.py harvest` + `recipe_server.py`, below). The
   recipes land in YOUR library folder, outside the skill folder. The path is in
   `LOCAL.md` (`ROBLOX_VFX_LIB`).
4. **Classify, find, curate, emit** from your own library: `classify_lib.py`
   tags it, `find_vfx.py` searches it, `audition.py` compares candidates,
   `curate.py` copies the ones a game uses, `emit_luau.py` writes the
   `VFXKit` ModuleScript.

Keep your library private. Using a free pack's assets in your own game is within
the Creator Store terms; extracting their values and textures and redistributing
them as your own pack is a different act.

**Layout.** The skill and a library are separate on purpose: a library holds
extracted packs, so it lives OUTSIDE the skill directory and every script takes
`--lib` (or reads the `ROBLOX_VFX_LIB` environment variable).

```
<skill>/
  SKILL.md          this file
  LOCAL.md          your machine-specific settings (from LOCAL.template.md)
  scripts/          the tooling (below)
  scripts/luau/     codec + harvest + build bodies, assembled by payload.py
  references/       VFXKit.lua (an empty generated kit) + a worked runtime script
  work/             scratch payloads, also served over localhost

<your library folder>/     path set in LOCAL.md, outside the skill folder
  harvested/        raw intake from the harvester. Look at it, then promote.
  recipes/*.json    the recipes you kept
  compositions/     optional: timelines you author over your recipes
  index.json        search index, built by classify_lib.py
  .cache/           texture thumbnails + tag caches, all regenerable
```

**Entry points**, all `--lib`-aware:

| Command | Does |
|---|---|
| `find_vfx.py --lib DIR <words> --layered` | find effects by what they ARE |
| `payload.py build --recipe F --target PATH --out work/b.lua` | assemble a build payload |
| `recipe_server.py` | sink for harvests **and** serves `work/*.lua` over localhost |
| `verify_vfx.py --lib DIR --quiet` | defect checks; `--self-test` proves they can fail |
| `classify_lib.py --lib DIR` | (re)build `index.json`; `--sheet ring` audits labels |
| `payload.py harvest --root PATH --out work/h.lua` | harvest a pack out of Studio |

**Before touching Studio**, confirm your Studio bridge is actually live. A
connected plugin and a working one are different things. With Roblox's official
Studio MCP (recommended), run a trivial `execute_luau` (`return 1`) and take a
`screen_capture`; where this file says `capture_screenshot`, that is the official
server's `screen_capture`. With the older third-party `robloxstudio-mcp` server:

```bash
curl -s localhost:48741/health
```

`"pluginConnected": true` is the only signal that means anything there. If that
looks fine and tools still time out, see *"When the MCP is connected but every call
times out"* below.

**To build and judge effects from a library**, go to *"Previewing a harvested
recipe"*. To add packs to one, go to *"Harvesting a pack"*.

---

## The one idea this skill is built on

**Do not generate particle parameters. Retrieve them.**

Generating a good emitter from a text prompt is unverifiable offline, because
nothing outside Roblox simulates a ParticleEmitter. Retrieving an effect a human
artist already tuned is trivially verifiable and immediately correct. This is the
same T1/T2 logic that makes Creator Store audio the right answer over generated
SFX.

What makes it a skill rather than copy-paste is the layer on top:

```
free VFX pack in Studio
   -> harvest.lua (explicit property walk)  -> recipe JSON (yours, portable)
   -> tune live in Studio, harvest back     -> recipe JSON (updated)
   -> emit_luau.py                          -> VFXKit ModuleScript
   -> VFXKit.build(name, part, {scale, tint, lifetime_mul, rate_mul, offset})
```

Retrieval gives you an explosion. The transform layer gives you "that explosion,
0.6 scale, tinted green, fired at this attachment on this event".

**This skill is the harvester, not the harvest.** Using free pack assets in your
own game is within the Creator Store terms. Extracting their values and
redistributing them as your own pack is a different act, and the textures are
unambiguously someone else's work. So the skill contains the tooling and each
user builds their own library from packs in their own account.

---

## Read this first: fifteen things that will bite

**1. The MCP's generic property reader sees 18% of a ParticleEmitter.**
`get_instance_properties` and `get_class_info` both return the same nine-field
generic view: `Size`, `Rotation`, `Transparency`, `Color`, `Enabled`,
`Brightness`, Name/ClassName/Parent. **Missing: `Rate`, `Lifetime`, `Speed`,
`SpreadAngle`, `Drag`, `Acceleration`, `Texture`, `LightEmission`,
`EmissionDirection`, `Shape`, `ZOffset`, `Squash`, `FlipbookMode`,
`LockedToPart`** and more. Measured: 6 of 31 real properties. Harvest through
those tools and every recipe looks populated and is three quarters empty,
silently. **Always harvest with `execute_luau` and an explicit property walk**
(`scripts/luau/harvest.lua`). `verify_vfx.py` fails a recipe with a short
property set for exactly this reason.

**2. FIVE stock particle textures exist, and one obvious-looking path is a
trap.** This said "only three" until a real pack was harvested. The first pass
only probed `textures/particles/*.dds` and never looked in `textures/` itself,
so two live paths were being hard-failed as nonexistent. Measured by rendering
each one:

| Path | Looks like | Good for |
|---|---|---|
| `textures/particles/sparkles_main.dds` | soft 8-point star | embers, motes, magic |
| `textures/particles/fire_main.dds` | noisy orange flame | fire bodies, explosions |
| `textures/particles/smoke_main.dds` | soft round puff | smoke, dust, glow cores, auras |
| `textures/explosion.png` | puffy lit explosion cloud | blasts, impacts, cartoon fire |
| `textures/sparkle.png` | hard 8-point star, dark rim | sharp sparks, hit flashes |

**`rbxasset://textures/smoke.png` renders NOTHING** — and Roblox's own
"Particle Effects" pack (`228304820`) ships a Smoke layer pointing straight at
it. A first-party pack contains a permanently invisible emitter. So do
`textures/fire.png` and `textures/particle.png`. Everything under
`textures/particles/` other than the three above (`explosion01_*`,
`light_diffuse`, `smoke_dust`, `burst`, `slash`, `glow`, `star`,
`sparkles_bright`) is also dead.

A wrong texture path is an invisible emitter, not an exception. `verify_vfx.py`
names the three measured-dead paths explicitly rather than reporting them as
generic unknowns, because "not in the stock set" reads like a false positive
when the path came out of a Roblox pack.

**3. An Attachment under a Model or Folder has no world position.** Build targets
must be a `BasePart`. Parent an Attachment anywhere else and the emitters build
silently at the world origin: the effect "works", it is just nowhere near the
thing it belongs to. `VFXKit.build` asserts on this.

**4. A Sphere-shaped emitter on an Attachment spawns from a near-unit volume.**
There is no emitter-size property. On a character that means every particle is
born *inside* the torso and is occluded by it. To surround a character the
particles must either be big enough to overlap the silhouette or be given enough
outward speed to escape it. Use both for an aura.

**5. `capture_screenshot` needs the Studio window FOREGROUNDED, not merely
un-minimised.** A minimised window fails with *"Ensure the Studio viewport is
visible... Known Roblox bug: capture may fail if viewport renders a solid
color."* The message blames the viewport colour. It cost three wrong hypotheses
(backdrop size, `TimeScale`, an over-bright PointLight) before checking
`IsIconic`.

`IsIconic == false` is **not sufficient** — a restored-but-background window
still times out. What reliably works is maximise plus foreground:

```powershell
[W]::ShowWindow($h, 3)          # SW_MAXIMIZE
[W]::SetForegroundWindow($h)
```

The solid-colour failure is real too, so keep some sky or ground in frame rather
than filling it with one flat backdrop.

**6. `execute_luau` silently drops EVERY print if the script yields at all.**
Not just prints after a trailing wait: a script whose *first* statement is a
yielding call (`InsertService:LoadAsset`, `GetKeyframeSequenceAsync`) returns
`success: true` with an EMPTY output array, losing prints that ran long before
the return. "Keep the waits short" does not help when the yield is the work.

The fix is to stop using the return channel for anything that yields: do the
work in `task.spawn`, write progress into a `StringValue`, and read it back in a
**second** `execute_luau` call.

```lua
local sv = Instance.new("StringValue"); sv.Name = "__probe"; sv.Parent = game.ReplicatedStorage
task.spawn(function()
    ...                       -- yields freely
    sv.Value = "DONE :: " .. result
end)
return "spawned"              -- returns immediately, output intact
```

Because it is written on every iteration it also survives a script that dies
half way, which a print does not.

**7. A burst layer with `Rate > 0` bursts AND streams forever.** The commonest
authoring slip, and it reads as "the effect never stops". `VFXKit.build` forces
`Rate = 0` on any layer whose emit mode is `burst`, and the verifier fails it.

**8. Dark smoke on a dark backdrop is invisible, and that is a staging artifact,
not a bug in the effect.** Judge every effect over BOTH a light and a dark
surface before changing a value. A smoke layer was nearly deleted as "not
working" when it was reading perfectly well against the ground.

**9. Real packs parent emitters straight to a Model, where they render
nothing.** Measured on Roblox's own `228304820`: `Model 'Particles'` with three
ParticleEmitters as direct children — no Attachment, no BasePart anywhere. A
ParticleEmitter under a Model has no world position and does not draw at all.
The pack is a *bag of parts* meant to be dragged onto something, not a working
effect. So **an inserted pack looking dead in the viewport tells you nothing
about the recipes inside it**; harvest first and judge after the rebuild.
`harvest.lua` records `parent_class` and `renders_in_place: false`, and the
verifier warns rather than fails, because the values are perfectly good.

**10. Setting `CurrentCamera.CFrame` in edit mode does not stick.** Studio's own
camera controller overwrites it between `execute_luau` calls, so a rig staged at
a fixed world position is often out of frame by the time you capture. Do the
opposite: read `CurrentCamera.CFrame`, then place the rig at
`cf.Position + cf.LookVector * d` and spread it along `cf.RightVector`. Screen
order is then left-to-right in the order you place, which is what makes a
labelled contact sheet trustworthy.

---

**11. `GetFullName()` IS NOT UNIQUE, and using it as a grouping key loses
recipes silently.** Ten sibling Parts all called `Part` under one Folder return
the *same* string. Keying groups on it merges unrelated effects into one giant
recipe AND makes them overwrite each other on write. Measured on a real place:
**366 of 583 recipes vanished**, and what survived included 40- and 55-layer
"effects". Key groups on the **instance itself**, then disambiguate the recorded
path with a `#n` suffix. The sink refuses to overwrite a file whose
`source_path` differs, as a second line of defence.

**12. `PostAsync` refuses a large body, and the fallback print is invisible.** A
1447-recipe pack encodes to ~2MB and the POST throws. The `pcall` catches it,
the code falls back to chunked printing — and if the harvest is running inside
`task.spawn` (which it must be, see trap 6) those prints are dropped too. The
pack reported *"harvested 1447"* and wrote **nothing**. Post in batches of ~40,
and **return the count that reached disk, never the count that was scanned.** A
harvester that reports what it walked rather than what it saved is lying by
construction.

**13. Most pack containers are named `Part`, `Model` or a number.** 61% of
emitters in a real 3100-emitter place. Naming recipes after the nearest
container yields hundreds of files called `Part.json` — complete, verified, and
impossible to search, which is the same as not having harvested it. Climb past
generic names to the nearest ancestor a human actually named, but **never as far
as the harvest root** or the whole pack collapses into one recipe.

**14. Half of what is sold as a "VFX pack" is a TEXTURE LIBRARY.** Shape:
`Part '78'` -> `Attachment` -> `ParticleEmitter 'Images/Lightning'`, one emitter
each, hundreds of them. Single-layer recipes are **correct** here, not a grouping
bug — and the only human-meaningful name is on the **layer**, not the container.
So when the container name is junk and the recipe has one layer, name it from the
layer (`Images/Lightning` -> `Lightning`); when the layer is called `Texture`
too, fall back to the texture asset id, which is at least unique and matches back
to the image. That turned 1660 unfindable files into 1124 human-named ones.


**15. A harvested effect is tuned for the stage it was harvested against, and
`LightEmission = 1` is the trap.** It makes a ParticleEmitter quad ADDITIVE: it
adds to what is behind it instead of covering it. Most packs are shot against a
dark stage, where that reads as glow. Put the same effect over a pale
environment - white stone, snow, an overcast sky - and every quad saturates to
flat white across its whole area the moment it is drawn, because the background
already sits near the top of the range.

Measured in a pale arena map: a finisher hit put **44% of the frame at full
saturation** for a fifth of a second, blanking both fighters at the exact
instant the player needed to see the hit. Two obvious fixes did nothing, and
both were the wrong shape of fix:

| change | frame fully saturated |
|---|---|
| as harvested | 44.1% |
| flash + core quads cut 2.7x | 44.1% |
| spark count 44 -> 24, sizes cut | ~40% |
| pulse lights 9/14 -> 3.0/4.5, ranges halved | 32.5% |
| **`LightEmission` 1 -> 0.35-0.55** | **15.4%** |

Shrinking the quads could not help, because **the saturated area is set by
coverage, not by any single quad's size** - and coverage barely changed.

Two rules fall out of this:

- **Judge a wash by what it is washing.** A floor going evenly white with its
  texture gone is a light or a blend mode. A burst of quads is not even: it has
  edges and spikes. Look at the peak frame at full resolution before changing a
  number, and measure saturation (`fraction of pixels > 250`) rather than
  eyeballing brightness - a pale arena reads as 4% at rest and 44% at peak, and
  the difference between those two is the whole diagnosis.
- **Check the pulse lights against the constant ones in the same file.** One
  build shipped pulse peaks of 9 and 14 alongside constant glows of 2.2 and 3.0. That
  gap was not a decision, it came straight from the harvest. Anything above about
  4 will wash a pale scene on its own.

**16. A harvested LAYER OFFSET can be structure, and the engine scales it.**
Every layer records where its emitter's attachment sat in the pack. For most
packs that is zero or a small tuning nudge; for a BEAM pack it is the far end of
the beam. `Lava-01` layer `#1` (FireSpecs1) sits 6.25 studs out, and
`Lighting-01`'s `Lightning` layer hangs 9.9 up. The engine multiplies layer
offsets by the element's `scale`, so at depth-4 scales the embers of every fire
stream landed **15-27 studs from their own effect** - a detached clump of specks
floating over the caster, which reads as a separate bug and is not.

Two ways out, both used: select a zero-offset twin where the pack has one
(`Lava-01` `#6` is `#1` with offset 0, byte for byte), or set **`centred: true`**
on the recipe element, which builds every layer on its anchor and ignores the
harvested positions. It is opt-in, so existing compositions are unchanged. Worth
writing a small checker that fails on any selected layer more than 0.05 studs off
its anchor, for any composition set that selects layers by hand.

**17. A ring costs `segments` Neon parts, so size its segments by RADIUS.** Rings
are built as a loop of parts, not one mesh. Setting segments by
depth gave a 1.6-stud heal ring the same 66 parts as a 15-stud
shockwave; a regeneration heal that spawned a fresh ring set every beat built
2473 instances for one cast. `24 + 2.4 * radius` (capped at 64) stays smooth at
every size, and a repeating ring should be RE-CUED (show / radius / fade on the
same id) rather than rebuilt - the timeline drops finished tracks, so a later
cue takes over cleanly as long as two uses of one ring do not overlap.

**18. A composition that draws its effect with Parts is not using this skill.**
The engine CAN build Neon rings, part groups and part-segment bolts, and it is
tempting to build the "structure" of an effect (shock rings, pillars, sigils,
bolts, walls) that way and only sprinkle harvested emitters on top. That is
generating, not retrieving. One large effect set did it: 12 of 1813 library
recipes used, 1,696 part-built elements, and all of it was rejected on review. The
rebuild found a harvested effect for every one of those roles once someone
actually looked (flat shockwave textures, magic circles, tornado loops, frost
shells, aura rigs, beam ribbons, toon bolt sprites). Rules that fell out:

- **Survey before you build**: list the library's effects by pack and name
  (index.json is keyed by FILENAME - joining on the display name drops whole
  packs), audition candidates per role side by side, normalised to one size
  (packs are authored from dot-sized to 35 studs), and write the choice down as
  a role map in data.
- **Audit a candidate at SEVERAL phases.** Realistic-Explosion-01 is a white
  flash for three frames and an orange fireball after; judged at 0.3s it went
  into every element's release, and put fireballs over water auras.
- **A harvested floor wave is a FILLED disc**, where a ring was an outline:
  the same radius covers several times the screen. Size them ~1.3r, not 2r.
- **Count, and gate**: harvested elements vs parts per effect; fail the build
  on any visible part that is not an invisible carrier or a copy of the character.

**20. A tint cannot recolour a texture that carries its own colour.** Tint
multiplies the Color property; the texture multiplies after it. WaterBurst's
`ToonLiquidColor` sheet is baked blue, so "gold honey" rendered murky green and
"pink cake" stayed blue, while its grey `ToonLiquidAlpha` twin tinted perfectly.
A layer whose harvested Color is BLACK (Portal-01's `Portal`) cannot be tinted
at all. Measure each kept layer's texture (the `.cache/tex` PNG) before choosing
a tint, and keep only the grey layers of anything you recolour.

**19. A Roblox script Source must be under 200,000 characters.** Assigning a
longer string throws `Unable to assign property Source`. A shipped effect set
with many harvested recipes crosses that fast (54 recipes: 356K). Split data into
child ModuleScripts holding JSON strings and decode them lazily.

### Element kinds (engine.lua)

| kind / field | What |
|---|---|
| `beam` | one harvested **Beam layer** (`recipe`, `layer`) wired between `from`/`to` anchors (+offsets) or moving parts (`parent`/`to_parent`); `width_mul`, `tint`. Before this no harvested Beam could be used at all. |
| Beam layers **inside** a recipe | wired automatically from the `endpoints` offsets the harvester recorded (aura rigs: floor emitter + rising beams). |
| `chain` | one harvested recipe strung at `points` hosts between two anchors, `jitter` - a line drawn by the harvest's own effects (lightning bolts). |
| `centred` | recipe field: build every layer ON its anchor, ignoring harvested layer offsets (trap 16). |
| `rate_mul`, `rate_cap` | stream a harvested effect at a multiple of its OWN pack rate (`harvested_rate` survives a burst harvest), capped. |

---

## Compositions (optional, you author them)

A recipe is one harvested effect on one part. A **composition** is a timeline over
several of YOUR recipes plus simple geometry, for effects like "orb forms in the
hand, swells, pulses, releases". The skill ships the engine, not any compositions:
you write the JSON yourself, against recipes from your own library.

```jsonc
{
  "name": "my_effect",
  "title": "My Effect",                  // on-screen button label (emit_scenes.py)
  "duration": 3.0,
  "elements": [
    {"id": "core", "kind": "recipe", "recipe": "MyRecipe",   // a file name in your library
     "anchor": "A_Hand", "scale": 0.8, "layers": ["Core", "#3"]},
    {"id": "ring", "kind": "ring", "anchor": "A_Ground", "radius": 2, "segments": 32}
  ],
  "timeline": [
    {"t": 0.0, "id": "core", "act": "enable", "on": true},
    {"t": 1.2, "id": "ring", "act": "radius", "from": 1, "to": 12, "time": 0.6}
  ],
  "camera": {"look": "A_Chest", "offset": [-12, 6, -18], "fov": 50}   // edit mode only
}
```

- **Element kinds:** `recipe`, `beam`, `chain`, `ring`, `part`, `light`, `group`,
  `bolt`, `trail`, `clone`/`model` (see the kinds table below and `engine.lua`).
- **Cue acts:** `emit`, `enable`, `show`, `hide`, `destroy`, `regen`, `warp`,
  `scale`, `radius`, `fade`, `light`, `spin`, `fly`, `spiral`, `burst`,
  `stagger`, `move`. Cues take `t`, `id`, `act`, and `time` / `from` / `to` /
  `style` (an easing name) where they animate.
- **Anchors** are a name (`A_Ground`, `A_Feet`, `A_Waist`, `A_Chest`, `A_Head`,
  `A_Air`, `A_Sky`, `A_Hand`, `A_Far`) or a literal `[x, y, z]`. In play mode a
  literal is character space: x right, y up, -z forward, from the floor point
  under the character. The edit stage (`stage.lua`) builds a dummy and the same
  anchors so what you judge in edit mode is what the runtime builds.
- **Edit-mode loop:** `compose.py my_effect.json --lib <lib> --freeze 0.45 --out
  work/s.lua`, run the payload, screenshot, then repeat at other phases.
  `stage.lua` moves the Baseplate and spawn, so run it only in a scratch place.
  `compose.py my_effect.json --self-test` proves the composition checks can
  fail.
- **Shipping:** `emit_scenes.py --lib <lib> --comps <your compositions folder>
  --out-dir work` writes a `VFXScenes` ModuleScript (compositions plus their
  de-duplicated recipes) and a `VFXDemo` LocalScript with one key and button per
  composition (the first eight get keys 1-8).
- Beware trap 18: a composition that draws its effect with Parts is generating,
  not retrieving. Use the engine's part kinds for glue, and harvested recipes
  for the visible effect.


## Scale: harvest wide, ship narrow

A real harvest is bigger than you expect. One afternoon over 13 free packs
produced **1813 recipes / 2238 layers**, all verified, with one genuine failure.

**Do not emit the whole library.** `emit_luau.py` inlines every recipe into one
ModuleScript; at this size that is a projected **4.7MB** of Luau, which is not a
thing you put in a game. The library is an *archive to search*, and `VFXKit` is
the *subset you chose*. Curate to the handful an effect actually needs, then
emit.

Expect the shape of a big harvest to be: a long tail of single-layer texture
entries, a small band of genuinely layered effects (153 of 1813 here), and a
handful of Beams. The layered ones are where the craft is; the tail is a
lookup table.

## The verify loop

Nothing offline simulates particles, so the gate is Studio itself, in **edit
mode** (no Play required, confirmed working).

**Phase-frozen capture is the technique that makes this practical.** A burst
lasts under a second, so a screenshot is a coin flip. Instead: emit, `task.wait`
the exact age you want to inspect, then set `TimeScale = 0` on every emitter.
The simulation freezes and stays frozen until you set it back to 1, so the
capture lands on the phase you asked for, every time.

```lua
for _, e in ipairs(handle.emitters) do e.TimeScale = 1; e:Clear() end
handle.emit(1.0)
task.wait(0.22)                       -- the phase you want to judge
for _, e in ipairs(handle.emitters) do e.TimeScale = 0 end
-- now capture_screenshot
```

Sample at least an early phase (is the flash reading), a mid phase (is the shape
right) and a late phase (does it have a tail, or does it just stop).

**The contact sheet ranks candidates. Your eye decides.** No metric in
`verify_vfx.py` judges whether an effect looks good, and none can. What it
catches is the class of defect a still cannot show you: truncated property sets,
emitters transparent for their whole life, burst layers that stream, texture
paths that render as nothing, sequences that do not span t=0..1, portability
flags that contradict the texture refs.

On harvested recipes it also raises two **warnings that are a work queue, not
defects**: layers whose emit mode was inferred rather than recorded, and layers
the source pack had parented somewhere they could not render. Both are things
only a human can settle.

```bash
python scripts/verify_vfx.py --lib DIR --quiet     # your harvested library
python scripts/verify_vfx.py work/harvested/SomePack.json   # one file
python scripts/verify_vfx.py --self-test  # prove the checks can fail (10/10, no library needed)
```

---

## Files

| Path | What it does |
|---|---|
| `scripts/luau/codec.lua` | Typed round-trip between Roblox values and JSON. One definition, prepended to every payload. |
| `scripts/luau/harvest.lua` | Explicit property walk over a container. The only correct way to read an emitter. |
| `scripts/luau/build.lua` | Recipe to live instances in Studio, with transforms. |
| `scripts/payload.py` | Assembles codec + body + substitutions into one payload. `--sink` sets the POST target. |
| `scripts/recipe_server.py` | Localhost sink AND payload server. Harvests POST here; `GET /payload/<f>.lua` serves `work/` for `loadstring`. |
| `<library>/harvested/` | Raw intake (or `work/harvested/` if no library path is set). Harvests land here, never straight in `recipes/`. Promote by hand after looking. |
| `scripts/emit_luau.py` | Recipe JSON (`--lib DIR`) to the shippable `VFXKit` ModuleScript. |
| `scripts/verify_vfx.py` | The checks, plus the sabotage self-test. `--lib` to point at your own library, `--quiet` for failures only. |
| `scripts/classify_lib.py` | Tags a harvested library so it can be searched: fetches textures, reads motion from values and shape from pixels, writes `index.json`. `--sheet ring` to audit. |
| `scripts/find_vfx.py` | Search the index by what an effect IS. `--layered`, `--portable`, `--tag`, `--json`. |
| `references/VFXKit.lua` | GENERATED by `emit_luau.py`. The copy in the skill is an empty kit; yours holds the recipes you emit. Drop in ReplicatedStorage. |
| `references/CharacterVFX.server.lua` | Worked example: aura on spawn, impact burst on landing. |
| `scripts/compose.py`, `scripts/emit_scenes.py`, `scripts/luau/engine.lua`, `scene.lua`, `runtime.lua`, `stage.lua`, `demo_controller.lua` | The optional composition engine: timelines over recipes you author yourself (see *Compositions* below). |
| `scripts/audition.py` | Candidates for ONE role side by side in ANY place (`--at x,y,z`, empty `Workspace.__VFXStage`), normalised to one size, slot bars counted L->R. Never runs stage.lua. |
| `scripts/curate.py` | Copy the recipes a game uses into the game by role: `NAME=STEM|layers*countmul@burst|@loop`. `@burst`/`@loop` fix the harvested emit mode, because `handle.emit()` fires only burst layers and `setEnabled` only continuous ones (11 of 19 effects were silently dead in one real game). Then `emit_luau.py --lib <game>/vfx/recipes`. |
| `LOCAL.md` | Your machine-specific paths. Never shared. |

---

## Harvesting a pack

**Status: the harvester has been run end to end on a real third-party pack and
the round trip is lossless.** Measured on Roblox's own "Particle
Effects" (`228304820`): harvest -> JSON -> rebuild, then a property-by-property
diff of the rebuilt emitters against the originals — **84 of 84 values
identical** across all 31 properties x 3 layers, plus a side-by-side
phase-frozen capture that is indistinguishable. The remaining unknown is pack
*shape*, not fidelity.

### Getting the pack in front of you

**`search_assets` is a dead end. Do not spend time on it.** Through an MCP it
typically returns

```
{"errors":[{"code":0,"message":"Scope not authorized."}]}   # HTTP 403
```

against `/toolbox-service/v2/assets:search`, and renaming the API-key variable
buys nothing. A new Open Cloud key with Creator Store scope would be needed.

**You do not need one.** The endpoint Studio's own toolbox uses takes **no auth
at all**:

```bash
curl "https://apis.roblox.com/toolbox-service/v1/marketplace/10?limit=20&keyword=vfx%20pack&sortType=3"
```

```bash
curl "https://apis.roblox.com/toolbox-service/v1/items/details?assetIds=ID1,ID2"
```

`marketplace/10` returns asset IDs (10 = Model) with a `nextPageCursor`;
`items/details` returns name, creator, `createdUtc`, `categoryPath`,
`fiatProduct.isFree` and `capabilities.shouldSandbox`. That is everything
`search_assets` would have given you.

**The real blocker is insertion, not discovery.** `insert_asset` and
`InsertService:LoadAsset` both fail on an unowned Creator Store asset with
**"User is not authorized to access Asset"** — and this is true even when
`isFree: true` and `purchasable: true`. Free does not mean loadable. The asset
has to be **taken into your account first**, through the Creator Store or the
Studio toolbox, by you, by hand. No script can do that step for you.

Measured across 33 free VFX packs: exactly one loaded without being acquired —
`228304820`, the Roblox-owned one, the only result in the whole sweep with
`shouldSandbox: false`. **Sort candidates by `shouldSandbox` and expect
everything `true` to need acquiring.** So the honest first step of a real
harvest is: *take the packs into your account*, then harvest.

### The run

1. **Start the sink.** It is the real output path — chunked printing works for
   three recipes and falls over for two hundred, and a truncated recipe looks
   exactly like a valid one.

   ```bash
   python scripts/recipe_server.py          # lands in <ROBLOX_VFX_LIB>/harvested
   ```

   It lands harvests in `harvested/`, not your curated `recipes/` folder, on
   purpose. A sink pointed at `recipes/` makes thirty unlooked-at recipes
   indistinguishable from the ones you chose. Promote by hand.

2. **Assemble the payload.**

   ```bash
   python scripts/payload.py harvest --root Workspace.SomePack --out work/h.lua
   ```

3. **Run it via `loadstring`, not by pasting.** `loadstring` **is** available in
   plugin context (measured), and the sink serves `work/*.lua` over localhost,
   so payload size stops being a constraint entirely:

   ```lua
   local src = game:GetService("HttpService"):GetAsync("http://127.0.0.1:48752/payload/h.lua")
   local fn, err = loadstring(src)
   if not fn then print("COMPILE_ERROR " .. tostring(err)) return end
   return fn()
   ```

   Expect `HARVEST_POSTED recipes=N len=M`. If the sink is down it falls back to
   chunked printing and says so, so a forgotten sink is a slow path, not a
   silent truncation.

4. **Verify, then curate, then promote.**

   ```bash
   python scripts/verify_vfx.py --lib "<your library>/harvested" --quiet
   ```

5. Move the keepers from `harvested/` into `recipes/`, run
   `classify_lib.py --lib <your library>`, then `emit_luau.py --lib
   <your library>/recipes` (or `curate.py` first, for a game-sized subset).

**Harvest at the container level, never the individual emitter.** A real effect
is three or four layers (a fast bright core, a slower body, high-drag sparks, a
brief light). Index single emitters and you get a bag of parts with no memory of
what they belonged to.

### What the harvester infers, and why you must look

A pack records **no emit metadata**. It ships emitters `Enabled = false` with a
live `Rate`, which means "turn me on for a moment" — a one-shot in everything
but name, with the window nowhere in the data. So `harvest.lua` guesses:
`count = clamp(round(Rate * 0.1), 1, 250)`, and marks the layer
`"inferred": true` with `burst_window` and `harvested_rate` both kept so nothing
is silently lost. The verifier **warns** on every inferred layer.

Treat that warning as the curation queue. On `228304820`, `Rate = 1000` became
`count = 100`; whether the artist meant 40 or 400 is not recoverable from the
asset, only from looking at it.

### Pack shapes that break grouping

`containerOf` walks to the nearest `Model` or `BasePart`. Measured and predicted
failures:

| Pack shape | What goes wrong | What to do |
|---|---|---|
| **Emitters parented straight to a Model** (MEASURED on `228304820`) | grouping is right, offsets all read `[0,0,0]`, nothing renders in place | correct, not a bug. `parent_class` + `renders_in_place` are recorded; the rebuild puts them on a BasePart and they come back exactly |
| Ten unrelated effects under one Model | all collapse into one giant recipe | group by the nearest ancestor that has a sibling, or split on Attachment when a Part carries several unrelated ones |
| Emitters parented straight to a Part | offsets all read `[0,0,0]` | correct: a Part-parented emitter has no attachment offset |
| Nested Models (effect inside a prop inside a kit) | recipe named after the wrong ancestor | name from the outermost Model whose descendants are ALL vfx classes |

Only the first row has been seen for real. **Do not theorise about which one you
hit. Dump the tree and look** (`get_descendants` with a `classFilter`, or a Luau
walk printing `ClassName/Name/Parent.ClassName`). The input is fully visible.

**Beam and Trail need structure, not values.** `Attachment0`/`Attachment1` are
instance refs, recorded as `{"Ref": "<full name>"}`. Rebuilding means creating
two attachments on the target and pointing the Beam at them, so a Beam recipe
needs an `endpoints` block naming the two offsets. That block does not exist yet
because no Beam has been harvested. Add it when the first one arrives, do not
design it in advance.

**Decide texture provenance at ingest, and expect most packs to fail it.** Good
packs ship their own uploaded textures, so most harvested recipes will come back
`texture_portable: false`. That is fine for use in your own game and it is the
constraint on giving the library away. Sort by it early so the portable ones are
findable. Note that `texture_portable: true` means only *"every ref is an
`rbxasset://` path"* — it does **not** mean the paths resolve. `228304820`
harvested as portable and one of its two textures is dead.

**Curation is the part that is NOT mechanical.** Harvesting thirty recipes
yields thirty recipes, not thirty good ones. Nothing here judges taste. Capture
a preview per recipe, look at them, and delete the dross before indexing.

**If free-pack quality does not clear the bar, the skill does not die.** It
degrades to authoring and applying recipes by hand in the recipe format below.
Harvesting is the accelerator, not the foundation.

---

## When the MCP is connected but every call times out

Costs an hour if you have not seen it. `/health` says `pluginConnected: true`
and every tool call returns *"Studio plugin connection timeout"*.

**Applies to the third-party `robloxstudio-mcp` server: two copies are running.** The second one does not enter
proxy mode as intended: `listenWithRetry(app, host, 48741, 5)` succeeds on
**48742**, so it believes it is primary and never promotes. Meanwhile the Studio
plugin only ever polls **48741**. Your tools talk to one server; the plugin
talks to the other, and neither reports anything wrong.

```bash
curl -s localhost:48741/health; curl -s localhost:48742/health
```

Two `"status":"ok"` replies with only one showing `pluginConnected: true` is the
signature. Then:

1. Kill the server holding the port the plugin is on — the one your tools are
   NOT attached to. Killing yours ends the session's MCP.
2. **A raw TCP forwarder from 48741 to your port is enough**, because the plugin
   reconnects to whatever answers on 48741.
3. **The plugin will still show as disconnected.** `GET /poll` does *not*
   register an instance — only `POST /ready` does, and the plugin sends that
   once at startup. Register it yourself, using the `instanceId` its polls
   carry:

   ```bash
   curl -X POST http://localhost:<yourport>/ready \
     -H "Content-Type: application/json" \
     -d '{"instanceId":"<from the /poll query string>","role":"edit"}'
   ```

An ESTABLISHED TCP connection and a 200 on `/poll` both look healthy while the
bridge is doing nothing. `pluginConnected` in `/health` is the only signal that
means anything.

## Previewing a harvested recipe

The loop for judging one recipe out of a library. Everything here is measured;
the traps referenced are the numbered ones above.

1. **Sink up, payload assembled.** The sink also serves payloads over localhost.

   ```bash
   python scripts/recipe_server.py --out "<lib>/harvested"
   ```

   ```bash
   python scripts/payload.py build --recipe "<lib>/recipes/X.json" --target "Workspace.__VFXTarget" --out work/b.lua
   ```

2. **Stage a target RELATIVE TO THE CAMERA.** Setting `CurrentCamera.CFrame` in
   edit mode does not stick (trap 14). Read the camera, then place the part at
   `cf.Position + cf.LookVector * d`. The target must be a `BasePart` (trap 3).
   Put a mid-grey backdrop behind it but keep some sky or ground in frame, or the
   capture fails on the solid-colour bug (trap 5).

3. **Run it via `loadstring`,** not by pasting:

   ```lua
   local fn = loadstring(game:GetService("HttpService"):GetAsync("http://127.0.0.1:48752/payload/b.lua"))
   return fn()
   ```

4. **Emit, then phase-freeze, then capture.** Use the emit count the recipe
   carries, not a number you invented:

   ```lua
   for _, e in ipairs(emitters) do e.TimeScale = 1; e:Clear() end
   for _, e in ipairs(emitters) do e:Emit(e:GetAttribute("EmitCount") or 20) end
   task.wait(0.22)                                   -- the phase you want
   for _, e in ipairs(emitters) do e.TimeScale = 0 end
   ```

   Sample early / mid / late. Maximise and foreground the Studio window first
   (trap 5) — `IsIconic == false` is not enough.

**What you are looking for, beyond "does it look nice":**

- **Is the emit count sane?** Almost every harvested recipe is `emit-inferred`:
  the pack recorded no burst window, so the count is a guess from `Rate * 0.1`
  with `harvested_rate` kept beside it. A faithful recipe with an invented count
  can be five times too dense and still pass every check. **This is the single
  most likely reason a harvested effect looks wrong**, and only your eye finds it.
- **Does it read against BOTH a light and a dark surface?** (trap 8)
- **Does it stop?** A burst layer with `Rate > 0` streams forever (trap 7).

Fix by editing the recipe JSON and rebuilding — the JSON is the source of truth,
and `emit_luau.py` reads the same files, so what you tuned and what ships cannot
disagree.

## Finding anything again: classify, then search

**A harvested library is unusable without this, and that is not a small caveat.**
Names come from whatever the pack author typed. Measured on a real 1813-recipe
library, **only 29% of names say anything at all** — the rest are `Part`, `78`, or
a texture id. The harvest was complete, verified and impossible to search, which
is the same as not having it.

```bash
python scripts/classify_lib.py --lib "~/Roblox-VFX-Library"     # -> index.json
python scripts/find_vfx.py    --lib "~/Roblox-VFX-Library" ice ring --layered
```

Three signals, because no one of them is enough:

| Signal | Coverage | What only it can answer |
|---|---|---|
| **Values** — motion and timing from the harvested props | 100% | one-shot vs continuous, expanding, high-drag, glowing, colour |
| **Sprite** — shape from the texture's pixels | 97% | ring / streak / star / soft — the ONLY signal for texture swatches |
| **Name** — what the artist called it | 29% | `RasenShuriken`. Not derivable from pixels or numbers, and it outranks both |

Together: **98%**.

**Why values alone fail.** A texture-swatch entry is deliberately neutral —
white, speed 0, spread 0, size 1 — so the pack can show off the image. 1552 of
1813 recipes classified identically on values. Everything that distinguishes them
is in the pixels.

**Why the sprite pass needs the flipbook layout.** Most particle textures are
sprite **sheets**, not sprites — 1481 of 2180 layers here are `Grid4x4`. Measure
the whole image and you measure the geometry of the tiling: a 4x4 grid of rings
reads as dense, round and not hollow no matter what the frames hold. Crop to one
frame using the layout the recipe declares, and pick the frame with the most ink,
because frame 0 of a `OneShot` flipbook is usually near-empty.

**Audit the labels before you trust them.**

```bash
python scripts/classify_lib.py --lib DIR --sheet ring
```

That writes a contact sheet with each sprite's assigned tags printed under it.
Look at it. The first version of this classifier scored well and was reading
tiling geometry; the sheet is what showed it. A classifier nobody eyeballed is a
classifier that says yes.

Tags are honest about their own confidence: `is:explosion` came from a name,
`maybe:shockwave` is an inference from sprite shape, and `emit-inferred` means the
burst count was a guess. Search weights them in that order.

## Using it in a game

```lua
local VFXKit = require(game.ReplicatedStorage.VFXKit)

-- "MyAura" and "MyImpact" are recipes in YOUR emitted kit (names you chose in curate.py)
local aura = VFXKit.build("MyAura", character.HumanoidRootPart, {
    tint = Color3.fromRGB(255, 120, 40),   -- keeps the luminance ramp, swaps hue
})
aura.setEnabled(true)

local impact = VFXKit.build("MyImpact", character.HumanoidRootPart, {
    offset = Vector3.new(0, -(humanoid.HipHeight + root.Size.Y * 0.5), 0),
})
impact.emit(1.3)     -- multiplier scales particle counts and light peak
```

`opts`: `scale`, `tint`, `lifetime_mul`, `rate_mul`, `offset`, `suffix`.
`handle`: `emit(mult)`, `setEnabled(bool)`, `destroy()`.

Build twice with the same name and it replaces rather than duplicates. Use
`suffix` for a deliberately independent second instance.

**Tint keeps the luminance ramp and replaces only the hue.** A flat colour swap
destroys the bright-core-to-dark-tail arc, which is the thing that reads as fire.

---

## Recipe format

```jsonc
{
  "name": "MyImpact",
  "duration": 1.9,              // longest tail, for previews
  "texture_portable": true,     // decided at ingest, verified against refs
  "texture_refs": ["rbxasset://textures/particles/fire_main.dds"],
  "layers": [{
    "name": "Fire",
    "class": "ParticleEmitter", // or Beam, Trail, PointLight
    "offset": [0, 0, 0],        // attachment offset from the container origin
    "emit": {"mode": "burst", "count": 16},
    "props": { /* all 31, typed */ }
  }]
}
```

A **harvested** layer carries three extra fields recording where the values came
from. They are provenance, not settings, and hand-authored recipes omit them:

```jsonc
"parent_class": "Model",      // what the emitter hung off in the source pack
"renders_in_place": false,    // ...and whether it could draw there at all
"emit": {
  "mode": "burst", "count": 100,
  "inferred": true,           // NOT recorded by the pack. A guess. Look at it.
  "burst_window": 0.1,        // the guess that produced count
  "harvested_rate": 1000      // the original Rate, which burst mode zeroes
}
```

Typed values, same convention as Rojo `.model.json` so nothing has to be guessed
from a bare array: `{"NumberSequence": [[t, value, envelope], ...]}`,
`{"ColorSequence": [[t, [r, g, b]], ...]}`, `{"NumberRange": [min, max]}`,
`{"Vector3": [x, y, z]}`, `{"Enum": "NormalId.Top"}`.

`emit.mode` is one of `burst` (one-shot `:Emit(count)`), `continuous`
(streams at `Rate`), `pulse` (a light that decays from `from` over `seconds`),
`constant` (a light that stays on).

Beam and Trail `Attachment0`/`Attachment1` are instance references, not values.
They are recorded as `{"Ref": "<full name>"}` and are structure to be rebuilt,
never faked as data.

---

## Performance

- `Rate` is per second and continuous emitters cost every frame. Prefer one-shot
  `:Emit(n)` for anything event-driven.
- Set `LightInfluence = 0` on anything meant to glow, or the world's lighting
  drags it toward grey.
- `LightEmission` is free brightness. A real `PointLight` is not. A typical
  impact recipe uses exactly one, pulsed for about 0.3s.
- Long-lived large soft particles are the expensive case: heavy overdraw. Keep
  aura lifetimes under about a second for this reason.
