"""Code-authored fruit/cake wedge (a circular sector, extruded), Tier 3.

    blender --background --python wedge_slice.py -- --out work/set/WatermelonSlice/out \\
        --studs 22 --angle 70 --thickness 0.3 --segments 16

WHY IT EXISTS. Measured 2026-09-28 (a real build): Hi3DGen turned a near-frontal
watermelon-slice concept into a CONE - 22.0 x 22.0 footprint, 16 tall, x and y
spans shrinking together at every height. A frontal wedge carries no thickness
cue in the estimated normal map, so the model revolved it. The concept gate
cannot see this (the 2D image was a perfectly good slice); only the orient
sheet plus the per-height profile did. A wedge is exact geometry: code draws it
closed and in budget, and a paint spec can place rind/flesh by radius.

Geometry: tip at the TOP, arc at the BOTTOM, standing upright, faces pointing
+-Y (Blender), so the flat cut faces are the asset's front/back. The sector
centre (the tip) sits at normalised (0.5, *, 1.0), which is what a paint spec's
radial "flesh" blob keys on. Writes low.glb (UV-unwrapped) and report.json with
the MEASURED triangles and dimensions.
"""
from __future__ import annotations
import argparse, json, math, sys
from pathlib import Path
import bpy, bmesh


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--studs", type=float, required=True, help="longest axis")
    p.add_argument("--angle", type=float, default=70.0, help="sector angle, degrees")
    p.add_argument("--thickness", type=float, default=0.3, help="x radius")
    p.add_argument("--segments", type=int, default=16)
    return p.parse_args(a)


def main():
    a = args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    R, half, T = 1.0, math.radians(a.angle / 2), a.thickness
    bm = bmesh.new()
    sides = []
    for yy in (-T / 2, T / 2):
        tip = bm.verts.new((0.0, yy, 0.0))
        arc = []
        for i in range(a.segments + 1):
            th = -half + 2 * half * i / a.segments
            arc.append(bm.verts.new((R * math.sin(th), yy, -R * math.cos(th))))
        sides.append((tip, arc))
    (t0, a0), (t1, a1) = sides
    n = a.segments
    for i in range(n):
        bm.faces.new((t0, a0[i], a0[i + 1]))           # front fan
        bm.faces.new((t1, a1[i + 1], a1[i]))           # back fan
        bm.faces.new((a0[i], a1[i], a1[i + 1], a0[i + 1]))   # rind
    bm.faces.new((t0, t1, a1[0], a0[0]))               # straight cut sides
    bm.faces.new((t0, a0[n], a1[n], t1))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Wedge")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Wedge", me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    f = a.studs / max(ob.dimensions)
    ob.scale = (f, f, f)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    me.calc_loop_triangles()
    cnt = {}
    for p in me.polygons:
        for k in p.edge_keys:
            cnt[k] = cnt.get(k, 0) + 1
    bad = sum(1 for v in cnt.values() if v != 2)
    bpy.ops.export_scene.gltf(filepath=str(out / "low.glb"), export_format="GLB",
                              use_selection=True, export_apply=True)
    rep = {"generator": "wedge_slice.py (tier 3, code-authored)",
           "low_tris": len(me.loop_triangles), "angle": a.angle,
           "thickness_of_radius": T, "segments": n,
           "dimensions_studs": [round(d, 4) for d in ob.dimensions],
           "edges_not_two_faced": bad}
    (out / "report.json").write_text(json.dumps(rep, indent=2))
    print(json.dumps(rep, indent=2))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
