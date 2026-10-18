"""Rig a generated quadruped mesh in Blender, headlessly, fitted to the geometry.

    blender --background --python tools/quadruped_rig.py -- <name> <glb> <outdir>

WHY THIS EXISTS. The generated sheep, wolf and dog are single-piece meshes with
no skeleton, and the toolchain's animation skill is R15/R6 only - there is no
quadruped rig on disk and nothing to author against. Rather than accept that
these creatures can never be animated, this builds a real armature for each one.

THE RIG IS FITTED, NOT GUESSED. A quadruped armature placed from a bounding box
alone puts the hips and shoulders in the wrong place on every animal with a
different build - a wolf is long and low, a lamb is short and leggy. So the four
leg roots come from the MESH: the lowest fifth of the geometry is clustered into
the four quadrants of the horizontal plane, and each cluster's centre is a foot.

ORIENTATION IS MEASURED TOO. These meshes do not import in a consistent frame -
measured 2026-09-09, SheepAdult and Wolf come in +Z up while SheepLamb comes in
+Y up. The up axis is the one whose bottom slice splits into four balanced
clusters, which is a fact about legs rather than an assumption about exporters.

Bone names are deliberately plain and shared across all four creatures, so one
pose spec drives any of them and the Luau side has one vocabulary:

    Root  Hips  Spine  Chest  Neck  Head  Tail
    LegFL_Upper LegFL_Lower LegFL_Foot      (and FR, BL, BR)
"""
import bpy
import bmesh
import sys
import os
import json
import math
from collections import defaultdict
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
NAME, GLB, OUTDIR = argv[0], argv[1], argv[2]
os.makedirs(OUTDIR, exist_ok=True)


def die(msg):
    print("!!! FAILED: " + msg)
    sys.exit(1)


# ---------------------------------------------------------------- import ----
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    die("no mesh in " + GLB)
obj = meshes[0]
obj.name = NAME
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
obj.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

verts = [v.co.copy() for v in obj.data.vertices]


def extent(i):
    return min(v[i] for v in verts), max(v[i] for v in verts)


# ------------------------------------------------------- measure the frame --
# Score each candidate up-axis by whether its bottom slice makes four balanced
# clusters. That is what a set of legs looks like from underneath.
best = None
for up in (0, 1, 2):
    a, b = [i for i in (0, 1, 2) if i != up]
    lo, hi = extent(up)
    span = hi - lo
    if span <= 0:
        continue
    cut = lo + span * 0.22
    pts = [v for v in verts if v[up] <= cut]
    if len(pts) < 20:
        continue
    ca = (min(v[a] for v in pts) + max(v[a] for v in pts)) / 2
    cb = (min(v[b] for v in pts) + max(v[b] for v in pts)) / 2
    quad = defaultdict(list)
    for v in pts:
        quad[(v[a] > ca, v[b] > cb)].append(v)
    big = {k: p for k, p in quad.items() if len(p) > len(pts) * 0.08}
    if len(big) != 4:
        continue
    counts = sorted((len(p) for p in big.values()), reverse=True)
    balance = counts[-1] / counts[0]
    if best is None or balance > best[0]:
        best = (balance, up, a, b, big, ca, cb)

if best is None:
    die("could not find four leg clusters - this mesh is not a quadruped, or the "
        "bottom fifth of it is not feet")
balance, up, a, b, clusters, ca, cb = best

la, lb = extent(a), extent(b)
long_axis = a if (la[1] - la[0]) >= (lb[1] - lb[0]) else b
wide_axis = b if long_axis == a else a

# Rotate into the canonical frame: +Z up, +Y forward (nose), +X right. Doing
# this ONCE here means every pose spec, every render and the Roblox side all
# share one vocabulary, instead of each creature carrying its own axis quirk.
rows = [
    Vector([1 if i == wide_axis else 0 for i in range(3)]),
    Vector([1 if i == long_axis else 0 for i in range(3)]),
    Vector([1 if i == up else 0 for i in range(3)]),
]
basis = Matrix(rows)
# A PERMUTATION OF AXES CAN MIRROR THE MESH, AND A MIRRORED MESH SHREDS.
# Measured 2026-09-09: SheepLamb imports +Y up while the others import +Z up, so
# its permutation is an odd one with determinant -1. That turns the model
# inside out - normals flipped, winding reversed - and the skin then tore it
# into an unrecognisable mess while every count and balance figure stayed green.
# Flipping one axis restores a right-handed frame without changing which axis is
# up or forward.
if basis.determinant() < 0:
    rows[0] = -rows[0]
    basis = Matrix(rows)
    print("=== odd axis permutation (det -1) corrected by flipping the width axis")
obj.data.transform(basis.to_4x4())
obj.data.update()
verts = [v.co.copy() for v in obj.data.vertices]

# Feet, now in canonical space.
feet = {}
for (pa, pb), pts in clusters.items():
    p = [basis @ v for v in pts]
    c = Vector((sum(q.x for q in p) / len(p), sum(q.y for q in p) / len(p),
                sum(q.z for q in p) / len(p)))
    feet[(pa, pb)] = c

xs = [v.x for v in verts]; ys = [v.y for v in verts]; zs = [v.z for v in verts]
W, L, H = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
z0 = min(zs)

# Name the four feet by their canonical sign: +Y is the nose, +X is the right.
#
# SPLIT ON THE MEDIAN OF THE FEET, NOT THE MIDPOINT OF THE BODY. Measured
# 2026-09-09: SheepLamb has a short wheelbase inside a long body, so all four of
# its feet sat on one side of the body's own Y midpoint and the front/back split
# collapsed to two corners. The feet are the only thing that defines front from
# back on a set of legs.
fl = list(feet.values())
midY = sorted(c.y for c in fl)[1:3]
midY = (midY[0] + midY[1]) / 2
midX = sorted(c.x for c in fl)[1:3]
midX = (midX[0] + midX[1]) / 2
named = {}
for c in fl:
    key = ("F" if c.y > midY else "B") + ("R" if c.x > midX else "L")
    named[key] = c
if len(named) != 4:
    die("the four leg clusters did not resolve to four distinct corners: got %s "
        "(feet at %s)" % (sorted(named), [(round(c.x, 2), round(c.y, 2)) for c in fl]))

# Drop each foot to the floor: the cluster centre sits a little above it.
for k in named:
    named[k] = Vector((named[k].x, named[k].y, z0))

# Body landmarks, as fractions of the measured height. A quadruped's belly line
# sits a little above half height; the shoulder is higher than the hip on most
# of these builds, but not by enough to be worth guessing per species.
BELLY = z0 + H * 0.52
KNEE = z0 + H * 0.27
ANKLE = z0 + H * 0.11
hipY = (named["BL"].y + named["BR"].y) / 2
shoY = (named["FL"].y + named["FR"].y) / 2
noseY = max(ys)
tailY = min(ys)

# ------------------------------------------------------------- the armature --
arm_data = bpy.data.armatures.new(NAME + "_Arm")
arm = bpy.data.objects.new(NAME + "_Arm", arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, connect=False):
    b = eb.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    return b


spineZ = BELLY + H * 0.10
bone("Root", (0, hipY, z0), (0, hipY, z0 + H * 0.08))
bone("Hips", (0, hipY, spineZ), (0, (hipY + shoY) / 2, spineZ), "Root")
bone("Spine", (0, (hipY + shoY) / 2, spineZ), (0, shoY, spineZ), "Hips", True)
bone("Chest", (0, shoY, spineZ), (0, shoY + (noseY - shoY) * 0.35, spineZ + H * 0.04), "Spine", True)
bone("Neck", (0, shoY + (noseY - shoY) * 0.35, spineZ + H * 0.04),
     (0, shoY + (noseY - shoY) * 0.72, spineZ + H * 0.10), "Chest", True)
bone("Head", (0, shoY + (noseY - shoY) * 0.72, spineZ + H * 0.10),
     (0, noseY, spineZ + H * 0.06), "Neck", True)
bone("Tail", (0, hipY, spineZ), (0, tailY, spineZ - H * 0.04), "Root")

for key, parent in (("FL", "Chest"), ("FR", "Chest"), ("BL", "Hips"), ("BR", "Hips")):
    f = named[key]
    top = Vector((f.x, f.y, BELLY))
    knee = Vector((f.x, f.y + L * 0.02, KNEE))
    ankle = Vector((f.x, f.y, ANKLE))
    toe = Vector((f.x, f.y + L * 0.05, z0))
    bone("Leg%s_Upper" % key, top, knee, parent)
    bone("Leg%s_Lower" % key, knee, ankle, "Leg%s_Upper" % key, True)
    bone("Leg%s_Foot" % key, ankle, toe, "Leg%s_Lower" % key, True)

bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------ skin ----
# BLENDER'S AUTOMATIC WEIGHTS CANNOT BE TRUSTED ON THESE MESHES AND FAILS
# SILENTLY. Measured 2026-09-09 on all three that rigged: parent_set with
# ARMATURE_AUTO raised nothing, reported nothing, and assigned ZERO groups -
# every single vertex came out unweighted. The heat solver needs manifold
# geometry and a decimated Hi3DGen mesh is not that. A skin that reports success
# and binds nothing is the exact shape of defect this pipeline keeps hitting, so
# the weights are computed here instead, deterministically.
#
# The model is a linear blend skin: for each vertex take the distance to each
# BONE SEGMENT (not to the bone's midpoint - a long spine would otherwise lose
# to a short nearby leg bone), keep the three nearest, and weight by 1/d^2.
# That gives smooth joints without a solver, and it cannot silently do nothing.
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

for vg in list(obj.vertex_groups):
    obj.vertex_groups.remove(vg)
mod = obj.modifiers.new(name="Armature", type="ARMATURE")
mod.object = arm
obj.parent = arm

segments = []
for bn in arm.data.bones:
    segments.append((bn.name, bn.head_local.copy(), bn.tail_local.copy()))


def dist_to_segment(p, h, t):
    d = t - h
    ll = d.length_squared
    if ll <= 1e-12:
        return (p - h).length
    u = max(0.0, min(1.0, (p - h).dot(d) / ll))
    return (p - (h + d * u)).length


INFLUENCES = 3
groups = {name: obj.vertex_groups.new(name=name) for name, _, _ in segments}
for v in obj.data.vertices:
    ds = [(dist_to_segment(v.co, h, t), name) for name, h, t in segments]
    ds.sort()
    near = ds[:INFLUENCES]
    ws = [(1.0 / max(d, 1e-4) ** 2, name) for d, name in near]
    total = sum(w for w, _ in ws)
    for w, name in ws:
        groups[name].add([v.index], w / total, "REPLACE")

method = "linear-blend (computed here; Blender automatic weights bound nothing)"
unweighted = [v.index for v in obj.data.vertices if not v.groups]
if unweighted:
    die("%d vertices still unweighted after explicit skinning - an unweighted "
        "vertex stays behind when its bone moves and tears a hole in the animal, "
        "and a static render cannot show it" % len(unweighted))

report = {
    "name": NAME,
    "source_glb": GLB,
    "orientation_measured": {"up": "XYZ"[up], "long": "XYZ"[long_axis], "wide": "XYZ"[wide_axis]},
    "canonical_frame": "+Z up, +Y nose, +X right",
    "dimensions_canonical": {"length": round(L, 4), "height": round(H, 4), "width": round(W, 4)},
    "cluster_balance": round(balance, 3),
    "feet": {k: [round(v.x, 4), round(v.y, 4), round(v.z, 4)] for k, v in named.items()},
    "landmarks": {"ground": round(z0, 4), "belly": round(BELLY, 4),
                  "knee": round(KNEE, 4), "ankle": round(ANKLE, 4),
                  "hip_y": round(hipY, 4), "shoulder_y": round(shoY, 4)},
    "bones": [b.name for b in arm.data.bones],
    "bone_count": len(arm.data.bones),
    "skin_method": method,
    "unweighted_fixed": len(unweighted),
    "vertices": len(obj.data.vertices),
}
with open(os.path.join(OUTDIR, "rig.json"), "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2)

blend = os.path.join(OUTDIR, NAME + "_rigged.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend)
print("=== rigged %s: %d bones, %d verts, skin=%s, balance=%.2f"
      % (NAME, len(arm.data.bones), len(obj.data.vertices), method, balance))
print("=== saved " + blend)
print("RIGREPORT " + json.dumps(report))
