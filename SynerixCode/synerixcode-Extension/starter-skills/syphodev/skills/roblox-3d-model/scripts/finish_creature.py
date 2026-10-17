"""Centre a creature mesh on its own mass, export, and MEASURE.

The brief: sheep, wolf and dog carry no Humanoid and no rig. They are moved by
BulkMoveTo and animated procedurally from velocity, so an off-centre origin
makes the whole flock orbit its own pivots. mesh_pipeline.py scales but never
centres, so this does it and then measures what came out.

Two centres are reported because they are not the same number:
  bbox centre     - what Roblox re-centres a MeshPart on at import
  vertex centroid - the mass-ish centre; a long tail drags it off the bbox one
The geometry is moved so the BBOX centre is the origin (that is the one Roblox
will use anyway, so anything else drifts) and the residual centroid offset is
reported in studs so the caller can see how far off the mass really is.

  blender --background --python finish_creature.py -- --glb <low.glb>
          --name <Name> --outdir <dir>
"""
import argparse, json, os, sys
import bpy, bmesh
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
p = argparse.ArgumentParser()
p.add_argument("--glb", required=True)
p.add_argument("--name", required=True)
p.add_argument("--outdir", required=True)
p.add_argument("--bins", type=int, default=12)
args = p.parse_args(a)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.glb)
obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
assert len(obs) == 1, "expected ONE mesh object (a MeshPart is one mesh), got %d" % len(obs)
ob = obs[0]
ob.name = args.name
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
centre = Vector(((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(zs) + min(zs)) / 2))
for v in bm.verts:
    v.co = v.co - centre
bm.to_mesh(me); bm.free()

bm = bmesh.new(); bm.from_mesh(me)
xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
cen = Vector((sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs)))
bm.free()
me.calc_loop_triangles()
tris = len(me.loop_triangles)

# Blender Z-up -> Roblox Y-up is (x, y, z) -> (x, z, -y): determinant +1, a
# rotation, so winding is preserved. Do NOT flip an axis "to compensate".
bounds = [max(xs) - min(xs), max(zs) - min(zs), max(ys) - min(ys)]
bbox_off = [(max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2, -(max(ys) + min(ys)) / 2]
centroid_off = [cen.x, cen.z, -cen.y]

# THE ORIENTATION PROFILE, along the long axis, head end first. Printed whole
# rather than reduced to a verdict: three different "which end is the tip"
# rules each inverted on some blade on this project, so hand back the numbers.
body = 1 if (max(ys) - min(ys)) >= (max(xs) - min(xs)) else 0
axco = ys if body == 1 else xs
lo, hi = min(axco), max(axco)
tri_co = [[me.vertices[i].co for i in t.vertices] for t in me.loop_triangles]


def section(c):
    o1, o2 = [], []
    for co in tri_co:
        for i, j in ((0, 1), (1, 2), (2, 0)):
            p0, p1 = co[i], co[j]
            a0, a1 = (p0.y, p1.y) if body == 1 else (p0.x, p1.x)
            if (a0 - c) * (a1 - c) <= 0 and abs(a1 - a0) > 1e-9:
                t = (c - a0) / (a1 - a0)
                if -1e-9 <= t <= 1 + 1e-9:
                    q = p0 + (p1 - p0) * t
                    o1.append(q.x if body == 1 else q.y)
                    o2.append(q.z)
    if not o1:
        return [0.0, 0.0]
    return [round(max(o1) - min(o1), 3), round(max(o2) - min(o2), 3)]


prof = [section(lo + (hi - lo) * (b + 0.5) / args.bins) for b in range(args.bins)]

os.makedirs(args.outdir, exist_ok=True)
glb = os.path.join(args.outdir, "low.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False,
                          export_apply=True)
obj = os.path.join(args.outdir, "%s.obj" % args.name)
bpy.ops.wm.obj_export(filepath=obj, export_selected_objects=False,
                      export_materials=True, forward_axis="Y", up_axis="Z")

rep = {
    "name": args.name,
    "tris": tris,
    "verts": len(me.vertices),
    "bounds_studs": [round(b, 4) for b in bounds],
    "long_axis_blender": "y" if body == 1 else "x",
    "profile_bins_headfirst_wid_hgt": prof if body == 1 else prof,
    "origin": "bbox centre",
    "bbox_offset_studs": [round(v, 5) for v in bbox_off],
    "centroid_offset_studs": [round(v, 5) for v in centroid_off],
}
with open(os.path.join(args.outdir, "report.json"), "w") as fh:
    json.dump(rep, fh, indent=2)
print("FINISH " + json.dumps(rep))
