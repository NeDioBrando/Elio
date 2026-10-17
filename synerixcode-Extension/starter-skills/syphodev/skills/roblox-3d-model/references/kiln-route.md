# The hard-surface route, executed: Kiln

Guns, crates, lockers, vehicles, machinery, buildings, furniture. Anything with
flat faces and hard edges. **Use this, not the Hi3DGen pipeline.** It supersedes
the Claude Design route in `hard-surface-route.md` (which was never run and
needed a 3D mode your account may not have). Read that file for WHY hard surface
forks; read this one for HOW.

Kiln (github.com/matthew-kissinger/kiln, MIT, v0.8.0) is text-to-3D as code: you
write a small JavaScript program out of box/cylinder/sweep/CSG helpers, Kiln runs
it, hands back a six-view contact sheet plus structural QA, you revise, and it
exports a GLB. No GPU, no model API key, no generation quota. The program IS the
asset, so "shorten the stock" is a one-line edit and variants cost one turn.

## Status (2026-09-27)

| Step | State |
|---|---|
| install (npm, Node 22.19) | **works**, 24 s, at the folder you point `KILN_HOME` at |
| author + render + QA via CLI | **works**. Trial rifle: 14 parts, 344 tris, QA accepted, ~20 s on CPU |
| hex colour in material names survives the GLB | **works**, verified by reading the GLB |
| `kiln_to_roblox.mjs` (rotate, scale, join, tri gate) | **works**. 14 meshes -> 4, muzzle measured at -Z, 3.6 studs long |
| Studio Import 3D of the converted GLB | **UNTESTED.** Nothing has been imported into Studio yet. First run: confirm the MeshPart count (expect one per colour), that the part names carry the hex, the size, and that the front faces -Z. Then delete this row |
| colouring the MeshParts from the hex names in Studio | **UNTESTED.** Import 3D may or may not carry the base colour itself; if it arrives grey, set `MeshPart.Color` from the `_RRGGBB` suffix |

## Run it

```bash
# KILN_HOME = the folder you ran `npm install` in (set in LOCAL.md)
KILN="$KILN_HOME"
cd <asset dir>
npx --prefix $KILN kiln render gun.kiln.js --out gun.glb --views gun.png --backdrop light --json
# LOOK at gun.png. Revise the program. Repeat. Then:
node ~/.claude/skills/roblox-3d-model/scripts/kiln_to_roblox.mjs gun.glb gun_roblox.glb
# Studio: Import 3D on gun_roblox.glb
```

`--json` gives `tris`, `bounds` and a `qaReport`. `GEO_PART_SELF_INTERSECTION`
at "observe" level is normal for parts that are meant to sit inside each other (a barrel
in a shroud). Treat anything at a higher disposition than observe as real.

Before calling an unfamiliar helper: `npx --prefix $KILN kiln discover --query "<plain words>"`
then `--id <name>` for its exact contract. Examples to read for style:
`$KILN/node_modules/@kiln/engine/examples/*.kiln.js` (70+), and this skill's
`references/example-rifle.kiln.js`.

## Rules that are specific to Roblox

1. **Kiln's frame is +X forward, +Y up, metres.** Author in that frame, and let
   `kiln_to_roblox.mjs` rotate to Roblox's -Z front and scale x3.571 (1 stud = 0.28 m).
   Never pre-rotate in the program; you would rotate twice.
2. **Name every material `Label_RRGGBB`.** `gameMaterial()` returns a Three
   material; set `m.name` (see the `mat()` helper in the example). The join step
   names each output mesh after its material, so the colour is readable off the
   MeshPart name in Studio.
3. **One mesh per colour, not per part.** Kiln emits a mesh per `createPart`; the
   converter joins by material. Pass `--no-join` only when parts must move
   separately (a bolt, a trigger, a wheel) and animate them as separate MeshParts.
4. **The 20,000-triangle MeshPart cap is enforced by the converter** (exit 1).
   Hard-surface props land in the hundreds; if you hit the cap you are modelling
   detail that belongs in a texture or a decal.
5. **CPU renders judge SHAPE only.** Emissive and metal look washed out on the
   CPU sheet. Judge colour in Studio, not on the sheet.

## Kiln's own agent workspace (optional)

`npx --prefix $KILN kiln-init <dir> --harness claude` creates a workspace with
Kiln's MCP server and its own authoring skills (`kiln-author-asset`,
`kiln-refine-asset`, `kiln-qa-asset`). That route has immutable revisions and a
local viewer, but it has **not** been set up in this skill. The CLI loop above is enough
for props and keeps the pipeline in files.

## Maturity, for judging risk

Created 2026-06-23, 139 stars at the time of writing, v0.8.0 tagged without an npm release.
The docs cover Blender and Unity handoff, never Roblox, which is why the converter
exists. Pin the tag; do not install `main`.
