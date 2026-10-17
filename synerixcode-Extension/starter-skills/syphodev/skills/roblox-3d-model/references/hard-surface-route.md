# The hard-surface route: parametric GLB, not generated mesh

> **SUPERSEDED FOR EXECUTION (2026-09-27): use `kiln-route.md`.** Kiln is the
> code-authored GLB route, installed and run end to end here. This file stays for
> the reasoning (why hard surface forks) and the hex-in-material-name technique,
> which Kiln uses.

**Status: UNVERIFIED.** Everything below comes from a public write-up of an AI-built
Roblox FPS (August 2026) plus what the artefacts imply.
Nothing here was run as part of this skill. Treat it as a documented route, not
a proven one. **Check first that your account actually has the 3D/GLB mode of
Claude Design**; a 2D artboard design skill cannot do this.

## The route

1. One asset per conversation page. The source calls this "a critical step" and it is
   just context hygiene: a page carrying a rifle will drag rifle-ness into the
   next object you ask for.
2. Prompt the object. Output is parametric geometry authored as code, so it
   arrives blocky, low poly, hard edged and already inside the MeshPart budget.
3. Iterate in words. "Shrink the stock height" is a real edit here, not a reroll.
   This is the thing the generative pipeline structurally cannot do.
4. Ask for variants explicitly. Because the geometry is code, a variant set
   (bipod yes/no, compact vs long range, arctic / desert tan / blacked out) costs
   one more turn rather than another full generation. For a game that sells skins
   this is most of the value.
5. Download GLB, then Studio's own **Import 3D**.

## The one technique worth writing down: hex in the material name

A parametric GLB carries no textures, so on import the mesh is grey and whatever
is colouring it is guessing from the prompt. The fix is to make the colour
survive the file format:

> tell it to bake the hex colour into each material name

The mesh then arrives with materials named like `eye_1A1A1A`, and whatever wires
it up in Studio reads the intended colour off the name instead of inventing one.

**This does NOT transfer to the Hi3DGen path in this skill.** Hi3DGen returns a
single unsegmented mesh with no materials at all, so there are no names to write
a hex into and no per-part boundaries to apply one to. Do not try to port this
as a fix for the broken stage 4b. It is a property of code-authored geometry.

## Why Import 3D beats this skill's own tail

Stages 5 and 6 of `SKILL.md` need an Open Cloud key (`ROBLOX_API_KEY`) for the
permanent route, or the no-upload `EditableMesh` route for iteration. Studio's
Import 3D is first party and needs neither. On the hard-surface route, clicking
Import is not a downgrade, it is the shortest path with the fewest moving parts.

## The cost

Manual and serial. One download and one import per asset, no batching. That is
fine for the ten or so props an FPS needs and useless for sixteen animals, which
is exactly the line the routing table in `SKILL.md` draws.

## Adjacent trap, not about meshes

The same source generates UI icons on a **magenta** background so the background
keys out cleanly. Magenta sits close to red in chroma, so red and pink elements
in the artwork get partly keyed out along with the background. Its author hit this and
ended up removing backgrounds elsewhere instead. If you use a key colour for
generated 2D assets, measure the worst-case chroma distance against the artwork
first, and never use magenta over anything red.
