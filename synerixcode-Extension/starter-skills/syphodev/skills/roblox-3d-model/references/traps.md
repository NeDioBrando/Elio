# Traps

Symptom first, because that is how you meet them. Everything marked MEASURED was
reproduced while building the skill (Blender 4.3.2, Windows).

---

## 1. The normal map is perfectly flat, and nothing errored - MEASURED

**Symptom.** `normal.png` is a uniform lavender (0.502, 0.502, 1.0). The bake
operator returns `{'FINISHED'}`, the GLB is valid, every other check passes.

**Cause.** The GLB import arrived as a **triangle soup**. glTF stores normals per
corner, so the importer splits every vertex: a welded 10,242-vertex sphere came
back as **61,412 vertices**, and the skill's own test shape went **245,680 ->
40,962** after welding. Nothing is joined to anything, so:

- `Decimate/Collapse` cannot collapse across disconnected faces and under-reduces
  while reporting success
- `Smart UV Project` treats every triangle as its own island and produces
  thousands of sub-pixel islands, so the bake rasterises **no pixels at all** and
  the image keeps its neutral clear colour

**Fix.** Weld immediately after import, before anything measures or reduces:
`customdata_custom_splitnormals_clear()` then `remove_doubles(threshold=1e-5)`.
Clearing the custom normals is part of the fix, not tidying: they hold the
per-face normals that caused the split.

**Why it is worth a whole section.** Three separate wrong diagnoses came first
(operator defaults, `generated_color`, cage extrusion), because a flat map looks
exactly like a cage or selection problem. The bisect that found it swapped a
fresh-built high-poly against an imported one: fresh-high + imported-low failed,
imported-high + fresh-low passed. The **low** poly was the broken one.

---

## 2. `bpy.ops.object.bake` ignores your scene settings - MEASURED

Called from a script, the operator takes its **own property defaults** for
anything not passed explicitly, so `scene.render.bake.use_selected_to_active =
True` is silently ignored and the bake captures the low-poly's own normals: a
perfectly flat, perfectly valid map. Pass every setting as an operator argument
AND set it on the scene. `mesh_pipeline.bake_normal` does both.

(This was not the cause of trap 1, but it is real, and it produces the identical
symptom, which is why it was the first suspect.)

---

## 3. The normal map is soft and washed out - MEASURED

**Cause.** UV padding eating the texture. `island_margin` is charged **per
island**, and a generated mesh unwraps into many islands.

Measured on the test shape at 9,000 triangles, 1024px:

| `--uv-margin` | UV coverage |
|---|---|
| 0.02 | **0.29** |
| 0.003 | **0.49** |
| 0.001 | 0.51 |

0.003 is the default for that reason. Below it you buy almost nothing and start
risking bleed between islands, because the 16px bake margin expands into the gap.
`report.json` carries `uv_coverage`; under 0.25 means look at the layout before
blaming the decimation.

---

## 4. The upload fails with what looks like a permissions error

`assetType: Mesh` takes Roblox-native content only. A `.glb`/`.gltf`/`.fbx` goes
up as **`Model`**. The failure does not say "wrong type", so the next hour goes
into rotating API keys. `upload_asset.py` refuses `Mesh` up front and says why.

---

## 5. The mesh uploads and Roblox rejects it

**20,000 triangles is a hard cap per MeshPart**, enforced at upload. The working
budget is **under 10,000**: 20k is a moderation ceiling, not a performance budget,
and most of Roblox is mobile. `report.json` reports both thresholds separately.

`planar` decimation makes this easy to hit by accident: dissolve merges coplanar
faces and **ignores the triangle target completely**, so a "hard surface" run can
sail past 40k. The pipeline follows planar with a collapse pass for that reason.

---

## 6. Hi3DGen gives you no colour, and that is not a bug - MEASURED

Read from the Space's `app.py`: TRELLIS is called with `formats=["mesh"]` and is
fed the **normal** image produced by StableNormal, not the colour image. So the
GLB has **no texture, no vertex colour and no UVs**. A base-colour bake produces a
flat grey PNG that looks like a failure.

Consequences:

- `Smart UV Project` is mandatory, not cleanup
- colour must come from elsewhere: the concept image, `roblox-texture-gen`, or
  Studio's `generate_material`

---

## 7. Everything is the right shape and the wrong size

Nothing in the chain knows what a stud is. Pass `--target-studs` and state the
size as an intention; otherwise you find out when the crate fills the baseplate.
The pipeline normalises the longest axis and applies the transform **before**
duplicating, because baking across two differently-scaled objects produces
garbage that looks like a UV problem.

**Still unverified:** the exact stud-per-unit factor Roblox applies to an uploaded
GLB, and which way the model faces on import. Check both on the first real asset
and record the answer here.

---

## 8. Twenty instances in and the game starts stuttering

`CollisionFidelity` defaults to `Precise`. On a 10k-triangle mesh that is a
physics trap that shows up long after the import, when nobody connects the two.
Set `Box` or `Hull` at insert time; `references/studio-wire.lua` does.

---

## 9. ZeroGPU refuses the job at hour four

Free ZeroGPU is **300 GPU-seconds per day** against a generation of minutes. That
is a small number of meshes per day, and it fails on **throughput**, not
principle, so it surfaces mid-build rather than at setup. `HF_TOKEN` raises the
quota and buys queue priority; HF PRO ($9/mo) raises it further.

Local generation is not an alternative without a 16GB NVIDIA GPU: a card with
less VRAM, or no CUDA at all, cannot run it at all.

Note the hardware measurement trap while you are here:
`Win32_VideoController.AdapterRAM` is a uint32 and overflows at 4GB. The true
figure is `HardwareInformation.qwMemorySize` in the driver registry key.

---

## 10. Blender 4.x renamed the importers

`bpy.ops.import_scene.obj` no longer exists; it is `bpy.ops.wm.obj_import`. FBX is
still `bpy.ops.import_scene.fbx`, glTF is `bpy.ops.import_scene.gltf`. Tutorials
written for 3.x fail here with a confusing attribute error.

---

## 11. Do not install blender-mcp on the critical path

It ships built-in Hunyuan3D integration, and Hunyuan's licence excludes the UK, EU and South Korea
**including its output**. Reaching for that path silently reimports a licence
breach the model choice was made to avoid. Headless Blender is also deterministic,
where the flaky failures seen while building this skill were all live plugin connections.

---

## 12. `import PIL` fails inside Blender - MEASURED

Blender ships its **own** Python and Pillow is not in it, so anything that runs
under `blender --background --python` must do image work through `bpy`. Load with
`bpy.data.images.load()`, resize with `image.scale(w, h)`, read `image.pixels` as
flat RGBA floats. Values come back **linear, not sRGB**, and row order is
bottom-up, so only compare images that went through the same loader.

Pillow is fine in the scripts that run under the *system* Python
(`batch.py`, `concept_image.py`), which is why the contact sheet lives there.

---

## 13. A silhouette cannot tell left from right - MEASURED

`texture_bake.py --view auto` picks the projection direction by scoring
silhouettes, which removes a convention nobody verified. But a bilaterally
symmetric subject presents **mirror-image profiles**, and those can score
identically: measured on Suzanne, front and back both scored **0.967**.

On livestock the head and tail usually break the tie. When they do not, the run
sets `ambiguous_view: true` and warns, because projecting from the mirrored side
paints **the face onto the rear** - a failure that is obvious in a render and
invisible in every number. Pass `--view` explicitly to settle it.

---

## 14. Kaggle instead of ZeroGPU, and what it costs you

30 GPU-hours per **week** against ZeroGPU's 300 seconds per **day**. Same MIT
weights, same permission, so the venue is purely a throughput decision.

What it costs is indirection: Kaggle has no "run this script on a GPU" endpoint,
so `kaggle_run.py` uploads the concepts as a private **dataset**, uploads the
runner as a private **script kernel** attached to it, and pulls the outputs back.

Four ways it fails, all of them silent-ish:

- **the accelerator is off** - the kernel runs on CPU and exits at the CUDA check
- **internet is off** - the run dies minutes in, at the first weight download,
  long after it looked like it was working
- **the dataset version has not propagated** - a fresh version can take a minute
  to become attachable, so a push-then-run immediately can start with no input
- **the account is not phone-verified** - which is what gates GPU and internet on
  kernels in the first place

Do not pin torch in the kernel. Kaggle ships its own, and reinstalling the version
the Space pins drags half of CUDA with it. Install only the layers on top, and
choose the spconv wheel from the session's actual CUDA version at runtime.

---

## 15. The concept images are poor, and the model is not what you asked for - MEASURED

**Symptom.** Sixteen animals came back soft, malformed and generic: a humanoid
bee, a mangled panda-bull "cow", a pig on a grass platform under a pink sky.

**Cause.** `image.pollinations.ai` was called with `model=flux` and silently
served something else. `GET https://image.pollinations.ai/models` returns
**exactly `["sana"]`** for anonymous callers. SANA is a small fast model, and no
error is raised for asking for a model the tier does not carry.

**Fix.** Default to **FLUX.1-schnell on the official HuggingFace Space**. Measured
on the same cow prompt, the difference is not subtle: correct anatomy, four legs
planted, clean silhouette, plain background, usable first time. Apache-2.0, so
the output is clean for a commercial game (unlike FLUX.1-dev, non-commercial).

**The catch, also measured.** Anonymous callers sit at the bottom of the ZeroGPU
queue. First request 12s, **the very next one refused**: "No GPU was available
after 60s". It is priority, not a hard quota, so `concept_image.py` retries with
backoff - but a batch of sixteen anonymously is an hour of grinding with failures.
`HF_TOKEN` (free account) fixes it, and `kaggle_run.py push --mode images` avoids
the queue entirely by running schnell on your own Kaggle GPU.

---

## 16. A prettier concept image can make a WORSE mesh - MEASURED

FLUX's first output for the cow was a beautiful **flat vector illustration**. It
is the wrong input.

Hi3DGen does not read colour: StableNormal estimates a **normal map** from the
image, and TRELLIS generates geometry from that. Flat cel-shaded art carries
almost no shading gradient to estimate from. Asking instead for a **3D rendered
toy figurine, matte clay surfaces, soft studio lighting, subtle ambient
occlusion** gives the estimator the gradients it needs, and that phrasing is now
baked into `CREATURE_FRAMING`.

Judge a concept by what it gives the normal estimator, not by whether it is a
nice picture.

---

## 17. A reroll silently runs the OLD prompts - MEASURED

Pushing a new dataset version and queueing the kernel in the same breath lets the
kernel attach the **previous** version. MEASURED: a reroll of two animals came
back having regenerated all sixteen, with the previous run's manifest and the
previous run's images, and nothing anywhere said the input was stale. The bee was
still three bees.

`kaggle_run.py push` prints a warning about this, which is not the same as
handling it. Verify the dataset version is current before queueing, or push the
dataset, wait, and push the kernel separately.

Related and worse: `kernels_output` does **not** empty its destination, so files
from a previous run survive and get redistributed as if fresh. On the mesh stage
that quietly overwrites a new GLB with an old one. `fetch` now clears the landing
directory first - by emptying its CONTENTS rather than the directory itself,
because on Windows inside a cloud-synced folder (a sync client) the folder is often locked by the sync client
and `rmtree` dies with WinError 32 after already deleting everything inside.

---

## 18. hi3dgen needs xformers, and the sdpa escape hatch is a trap - MEASURED

The DENSE attention module accepts `ATTN_BACKEND` in
`{xformers, flash_attn, sdpa, naive}`, so setting `sdpa` looks like a clean way to
avoid the xformers/torch version fight.

It is not. The **SPARSE** module accepts only `{xformers, flash_attn}`, silently
ignores anything else, and then runs a bare `import xformers.ops` **at import
time**. The run dies on `ModuleNotFoundError: No module named 'xformers'` after
the full install and the multi-GB weight download.

So xformers must be installed, and pinned to the exact torch that survived the
P100 fix - unpinned, pip satisfies it by upgrading torch and undoes the fix.
Measured pairing: torch 2.5.1 needs xformers 0.0.28.post3.

---

# The Kaggle mesh run: eight attempts, in order

Recorded because every one cost ~15 minutes and every one looked like a different
problem. If you are standing this up again, read the list before you start.

| # | Died at | Cause |
|---|---|---|
| 1 | `import trellis` | The **Space** uses `trellis`/`TrellisImageTo3DPipeline`; the **repo** ships `hi3dgen`/`Hi3DGenPipeline` |
| 2 | `import xformers` | Sparse attention hard-imports it; `ATTN_BACKEND=sdpa` is silently ignored there |
| 3 | `cumm` ninja build | cumm misdetects the wheel as an editable install |
| 4 | nothing ran | **A bug in the driver script itself**: a patch inserted a `def` mid-body, so `install()` returned before the git clone |
| 5 | `cumm` ninja build | Same as 3, still undiagnosed at that point |
| 6 | `import trimesh` | numpy half-loaded: torch imported in-process *before* the numpy downgrade landed |
| 7 | every asset | `weights/BiRefNet` missing: the repo snapshots weights LOCALLY and loads by relative path |
| 8 | - | **Succeeded.** cow and pig generated; sheep hit CUDA OOM |

## 19. The Space's app.py and the repo's app.py are DIFFERENT - MEASURED

Two separate runs died on this, and it is the single most expensive assumption in
the whole exercise. Copying the HuggingFace Space's `app.py`:

- imports `trellis` and `TrellisImageTo3DPipeline`. The GitHub repo ships the
  package as **`hi3dgen`** with the class **`Hi3DGenPipeline`**.
- loads the pipeline from the HF repo id. The repo instead **snapshots three
  models into a local `./weights` folder** (`trellis-normal-v0-1`,
  `yoso-normal-v1-8-1`, `ZhengPeng7/BiRefNet`) and loads from the local path.

The second one is nastier because it looks like it worked: the pipeline loads, the
GPU spins up, weights download - and then **every asset** fails with
`weights/BiRefNet is not a local folder and is not a valid model identifier`,
which reads like a gated-repo or token problem. It is a **working directory**
problem: BiRefNet is resolved by the relative path `weights/BiRefNet`, so the
process must `chdir` to the repo root.

**Read the repo you are actually cloning, not the demo that inspired it.**

## 20. numpy half-loaded, and every subprocess check passes anyway - MEASURED

Symptom: `ImportError: cannot import name 'broadcast_to' from
'numpy.lib.stride_tricks'`, thrown from a lazy submodule import (trimesh, in this
case) long after startup.

Cause: the driver script called `import torch` in the MAIN process - inside helper
functions computing the spconv tag, the pip constraints and the xformers pin -
which also imports numpy 2.x into memory. The pip downgrade to numpy 1.26.4 then
lands on disk afterwards. The process is left holding 2.x in memory against 1.26.4
on disk.

**The part worth remembering: the import gate went GREEN.** Every check ran in a
fresh subprocess, each saw a consistent 1.26.4, and all four passed - while the
main process died. A subprocess check cannot see the parent's stale imports.

Fix: read torch's version through a subprocess probe, and keep the driver free of
torch and numpy imports until every install has finished. An AST assertion now
fails the push if any function other than `main()` imports torch, numpy or trimesh.

## 21. cumm JIT-compiles because it thinks it is an editable install - MEASURED

`cumm/__init__.py` runs a ninja build when:

```python
project_is_installed(PACKAGE_NAME) and project_is_editable(PACKAGE_NAME) and not CUMM_DISABLE_JIT
```

On Kaggle it misdetects the prebuilt `cumm-cu121` wheel as editable, tries to
compile, and fails inside `pccm`/`ccimport` - naming neither spconv, nor cumm's
install mode, nor CUDA.

Three theories were wrong first, each costing a run: a shadowing source `cumm`
(pip reported both "not installed"), a missing cp312 wheel (one exists), and
numpy 2.x (pinning to 1.26.4 changed nothing). **Reading the failing module's
source settled it in one look.** Set `CUMM_DISABLE_JIT=1` at module scope, before
anything can import cumm.

## 22. Cloning into /kaggle/working makes the weights your OUTPUT

The repo clone and the ~5GB of snapshotted weights land in `/kaggle/working`,
which IS the kernel's output directory. `fetch` then tries to download all of it,
and stalls. Clone to `/tmp` instead.

Workaround until that is fixed: `kernels_output` takes a `file_pattern`, and it is
a **regex, not a glob** - `*.glb` raises "nothing to repeat", `^[a-z]+\.glb$`
works.

## 23. VRAM is not freed between assets - MEASURED, UNFIXED

Third asset in a batch of three died with `CUDA out of memory. Tried to allocate
1.17 GiB. GPU 0 has 15.89 GiB of which 303 MiB is free`. The first two succeeded.
Nothing releases the pipeline's intermediates between iterations. Needs
`torch.cuda.empty_cache()` plus dropping references each loop, and probably
`PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`.

## 24. THE TEXTURE STAGE IS BROKEN, and its own numbers say it is fine

The most important entry in this file, because it is the failure mode the whole
skill is built to avoid and it happened anyway.

`texture_bake.py` reported `looks_projected: true`, colour variation 2.95,
alignment IoU 0.62, `alignment_trustworthy: true` - and produced a cow with **its
face smeared across its flank** and a pig that is **dark grey over most of its
body with pink down one side**.

**Every statistic measured that SOMETHING was projected. None measured whether it
landed in the right place.** A green report here means the machinery ran, not that
the texture is usable. Look at the render.

Known causes, unfixed:

1. the concept's grey background is not masked out before projecting, so
   background pixels get painted on wherever the silhouette does not line up
2. one camera cannot cover an animal - surfaces facing away or perpendicular
   receive clipped or background colour

Untried fix: mask the subject from the concept, project from two opposed cameras,
blend by facing angle.

## 25. A silhouette score dominated by FRAMING, not shape - MEASURED

Before it was fixed, `--view auto` scored a correct cow at **0.32**, with all eight
candidate views within 0.02 of each other. The mesh and its orientation were both
fine. The concept image has its own margins and a drop shadow; the probe render
has its own ortho zoom, and raw-mask IoU is dominated by that mismatch, so the
winner was chosen by noise.

Cropping each mask to its bounding box and resampling to a fixed grid makes the
score translation- and scale-invariant. Same assets afterwards: **0.62 and 0.63**.

Note the knock-on: the texture verifier had been passing this check by **list
order**, not by anything the code guaranteed. Once ties were genuine it failed,
correctly. The assertion now checks that the pick is among the tied best and that
the tie is declared.


## Studio import, no-upload route (2026-08-26)

| Symptom | Cause |
|---|---|
| MeshPart looks **hollow and see-through with dark patches** | winding was flipped during the Blender-to-Roblox axis change. `(x,y,z) -> (x,z,-y)` has determinant **+1**: it is a rotation, it preserves winding. Do not flip. Reads exactly like a texture alpha bug |
| MeshPart is **covered in black blotches** | the texture rows were flipped. Blender row 0 is the bottom and Roblox buffer row 0 is the top, but Roblox UV v also runs from the top, so the conventions **cancel**. Write the array as-is. Two wrong diagnoses came first (texture resolution, then the UV dedupe) and both were fine |
| "I need an Open Cloud key to get a mesh in" | you do not, for iteration. `AssetService:CreateMeshPartAsync` works from plugin context in edit mode with no credentials. You need a key only for a PERMANENT asset |
| Asset vanishes after saving the place | expected. `MeshContent`/`TextureContent` are `ContentSourceType.Object` with a nil `Uri`, so they are session-local. Right-click **Save to Roblox** on the MeshPart, or upload |
| `HttpService:GetAsync` assumed unavailable because `HttpEnabled` is false | that setting governs game scripts. Plugin context ignores it |
| Model sits half inside the ground | `CFrame.new(0, size.Y/2, 0)` assumes the baseplate top is at Y=0. Read it off the Baseplate instead |


## Open Cloud upload and Studio wiring (2026-08-26)

| Symptom | Cause |
|---|---|
| Model uploads and renders **completely grey**, no error anywhere | the texture was uploaded as **`Decal`**. A Decal WRAPS an image and has a different id; `MeshPart.TextureID` needs the **`Image`** asset id. Both upload types succeed and report Approved, so nothing tells you. Upload textures as `Image` |
| "I uploaded the .glb, where is my MeshId?" | a .glb uploads as a **Model**, not a Mesh. Insert the Model once with `game:GetObjects` and take the MeshPart out of it; that MeshPart carries the real `MeshId` |
| MCP `execute_luau` times out while the plugin panel says Connected / HTTP OK / MCP OK | **two Roblox Studio processes** were both connected to the one MCP server and commands landed on the stale one. Check `netstat -ano | grep <port>` for more than one ESTABLISHED client. Closing the stale Studio fixes it. `CloseMainWindow()` can take longer than a few seconds, so re-check before escalating |
| MCP dead and no way to run Luau | **Studio's command bar** needs no plugin and no bridge. **Ctrl+Enter runs, plain Enter is a newline.** |
| Command bar command does nothing | anything touching `CurrentCamera` raises a "Dangerous Command Detected" dialog first. Clear it, or keep camera calls out of automated paths |
| Plugin "connection timeout" right after work was going fine | the PLACE was closed. The plugin has no context without an open place, and the error names the plugin rather than the place |


## MCP `execute_luau` times out: work the list IN ORDER (2026-08-26)

Every one of these has actually happened, and the error text is identical in all
of them: `Studio plugin connection timeout`. It names the plugin, which is
misleading in three cases out of four.

1. **Is a place actually OPEN?** Studio sitting on its start page has no plugin
   context. This is the cheapest check and it was the real cause the first time.
2. **Is more than one Studio attached?** `netstat -ano | grep <port>` - more than
   one ESTABLISHED client means commands are landing on the stale one. Opening a
   place from the start page can spawn a SECOND Studio process. Close the stale
   one with `CloseMainWindow()`, and re-check after ~10s: it can take longer than
   a few seconds to go, which looks like a failed close.
3. **Are there orphaned MCP servers?** This is the documented fix and it works:
   kill ALL `node.exe` whose command line matches `robloxstudio-mcp`, then make
   ONE MCP tool call - the harness respawns exactly one and Studio reconnects by
   itself. **Measured 2026-08-26: there were FOUR orphans.** Killing them
   restored the bridge immediately. Do not talk yourself out of this step on the
   theory that killing the server breaks the session; it does not.
4. **Still stuck? Use Studio's COMMAND BAR.** No plugin, no bridge, same Luau.
   **Ctrl+Enter runs it; plain Enter inserts a newline.** Anything touching
   `CurrentCamera` raises a "Dangerous Command Detected" dialog that blocks
   execution until it is cleared.

The whole sequence is cheap. Steps 1 to 3 are three commands.
