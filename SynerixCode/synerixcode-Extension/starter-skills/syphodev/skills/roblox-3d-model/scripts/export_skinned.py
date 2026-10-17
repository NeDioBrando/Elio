"""Export a rigged creature as a Roblox-ready SKINNED glb, plus the data the
game needs to pose it.

    blender --background work/rigs/<N>/<N>_rigged.blend \
        --python tools/export_skinned.py -- <N> <outdir>

WHY THIS REPLACES export_creature_parts.py. That script turned the rig into one
BOX per bone and justified it: a skinned MeshPart has to be uploaded before
Roblox accepts bones, and the run could not verify that round trip. The upload
works. The performance argument it was really defending - no Humanoid, no
Animator, one write per frame - never required boxes at all: a Bone.Transform is
a plain property set, so twenty skinned sheep cost 380 property writes at 20Hz,
which is the same order as the BulkMoveTo the boxes needed. The boxes were
throwing away a painted, decimated, normal-baked mesh for nothing.

THE ONE THING THAT IS EASY TO GET WRONG, AND IS COMPUTED HERE RATHER THAN GUESSED:
the axis a gait angle turns about. The gait model says "swing this leg forward by
N degrees". Forward is a direction in the CREATURE's frame; Bone.Transform is
expressed in the BONE's own rest frame, and a Blender bone points along its local
+Y with a roll that is whatever the fitting produced. So a hardcoded
CFrame.Angles(rad(n),0,0) is right for some bones and silently wrong for others -
the kind of defect that reads as "the animation is a bit odd" rather than as a
bug. Instead: take the creature-frame RIGHT axis, express it in each bone's rest
basis, and emit that per bone. The pose code then turns about the axis the rig
says is right, whatever the roll.
"""
import bpy, sys, os, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
NAME, OUTDIR = argv[0], argv[1]
os.makedirs(OUTDIR, exist_ok=True)

arm = bpy.data.objects.get(NAME + "_Arm")
mesh = bpy.data.objects.get(NAME)
if arm is None or mesh is None:
    raise SystemExit(f"FATAL: expected objects {NAME} and {NAME}_Arm")

# --- refuse to export something Roblox will reject or render wrong ----------
if not any(m.type == "ARMATURE" for m in mesh.modifiers):
    raise SystemExit("FATAL: mesh has no Armature modifier - it is not skinned")
if not mesh.data.uv_layers:
    raise SystemExit("FATAL: mesh has no UV layer - it would upload untextured")

# Roblox allows at most 4 bone influences per vertex and DROPS the rest without
# a word, which reads as a limb tearing on one specific animation frame.
over = 0
for v in mesh.data.vertices:
    if len([g for g in v.groups if g.weight > 1e-4]) > 4:
        over += 1
if over:
    raise SystemExit(f"FATAL: {over} vertices have more than 4 influences")
unweighted = [v.index for v in mesh.data.vertices
              if not [g for g in v.groups if g.weight > 1e-4]]
if unweighted:
    raise SystemExit(f"FATAL: {len(unweighted)} vertices are bound to no bone")

# --- per-bone swing axis, in the bone's own rest space ----------------------
# Canonical creature frame from the rigger: +Z up, +Y nose, +X right.
RIGHT = Vector((1.0, 0.0, 0.0))
bones = []
for b in arm.data.bones:
    basis = b.matrix_local.to_3x3()
    local_right = basis.inverted() @ RIGHT
    local_right.normalize()
    bones.append({
        "name": b.name,
        "parent": b.parent.name if b.parent else None,
        "swing_axis": [round(c, 6) for c in local_right],
        "head": [round(c, 6) for c in b.head_local],
        "tail": [round(c, 6) for c in b.tail_local],
    })

# --- measured extents. NEVER type an asset bound; the exporter measures. ----
dg = bpy.context.evaluated_depsgraph_get()
ev = mesh.evaluated_get(dg)
pts = [mesh.matrix_world @ v.co for v in ev.to_mesh().vertices]
lo = [min(p[i] for p in pts) for i in range(3)]
hi = [max(p[i] for p in pts) for i in range(3)]

# --- export ----------------------------------------------------------------
for o in bpy.data.objects:
    o.select_set(o in (arm, mesh))
bpy.context.view_layer.objects.active = arm

glb = os.path.join(OUTDIR, f"{NAME}_skinned.glb")
bpy.ops.export_scene.gltf(
    filepath=glb,
    export_format="GLB",
    use_selection=True,
    export_yup=True,           # Blender +Z up -> glTF/Roblox +Y up, nose to -Z
    export_skins=True,
    export_animations=False,   # the gait is computed in game, not baked
    export_apply=False,        # applying modifiers would DESTROY the skinning
    export_texcoords=True,
    export_normals=True,
)
if not os.path.exists(glb):
    raise SystemExit("FATAL: exporter reported success but wrote no file")

report = {
    "name": NAME,
    "glb": glb,
    "glb_bytes": os.path.getsize(glb),
    "bones": bones,
    "bone_count": len(bones),
    "verts": len(mesh.data.vertices),
    "tris": len(mesh.data.polygons),
    "extent_min_canonical": [round(c, 4) for c in lo],
    "extent_max_canonical": [round(c, 4) for c in hi],
    "max_influences": 4,
}
with open(os.path.join(OUTDIR, f"{NAME}_skinned.json"), "w") as f:
    json.dump(report, f, indent=2)
print(f"SKINNED_OK {NAME} bones={len(bones)} verts={len(mesh.data.vertices)} bytes={os.path.getsize(glb)}")
