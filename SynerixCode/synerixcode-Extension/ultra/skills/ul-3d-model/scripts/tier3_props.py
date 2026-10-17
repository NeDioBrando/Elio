"""Tier 3 code-authored stand-ins for props Hi3DGen could not produce.

    blender --background --python tier3_props.py -- --kind bush --out work/set/Bush/out --studs 24 --tris 400
    blender --background --python tier3_props.py -- --kind sandwich --out work/set/Sandwich/out --studs 20 --tris 2500

WHY IT EXISTS. Measured 2026-09-28 (Kaggle T4, 14.56 GiB): Bush and
Sandwich died "CUDA out of memory" on BOTH attempts in two separate kernels
(1.33 GiB and 1.02 GiB allocations) while 23 other assets succeeded, so the OOM is
a property of those two inputs, not the leak the retry/allocator fix addresses.
The pre-authorised fallback is a code-authored mesh that is closed, UV-unwrapped
and inside budget, painted by paint_texture.py like everything else.

  bush      a union of overlapping spheres, voxel-remeshed into one closed puffy
            surface, collapsed to --tris. Deterministic (--seed).
  sandwich  a bevelled triangular prism lying flat; the layers (bread, lettuce,
            tomato, cheese, bread) are z-bands in the paint spec.

Writes low.glb and report.json with the MEASURED triangles and dimensions.
"""
from __future__ import annotations
import argparse, json, math, random, sys
from pathlib import Path
import bpy, bmesh


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--kind", required=True, choices=["bush", "sandwich"])
    p.add_argument("--out", required=True)
    p.add_argument("--studs", type=float, required=True)
    p.add_argument("--tris", type=int, required=True)
    p.add_argument("--seed", type=int, default=3)
    return p.parse_args(a)


def apply(ob, mod):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def bush(seed):
    rng = random.Random(seed)
    bm = bmesh.new()
    pts = [(0, 0, 0.55, 0.62)]
    for i in range(8):
        ang = 2 * math.pi * i / 8 + rng.uniform(-0.2, 0.2)
        pts.append((0.55 * math.cos(ang), 0.55 * math.sin(ang), rng.uniform(0.3, 0.5),
                    rng.uniform(0.38, 0.48)))
    for i in range(4):
        ang = 2 * math.pi * i / 4 + 0.4
        pts.append((0.3 * math.cos(ang), 0.3 * math.sin(ang), 0.9, rng.uniform(0.32, 0.4)))
    for x, y, z, r in pts:
        m = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r)
        bmesh.ops.translate(bm, verts=m["verts"], vec=(x, y, z))
    me = bpy.data.meshes.new("Bush")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Bush", me)
    bpy.context.scene.collection.objects.link(ob)
    rm = ob.modifiers.new("R", "REMESH")
    rm.mode, rm.voxel_size = "VOXEL", 0.04
    apply(ob, rm)
    # flatten the underside so it sits on the ground
    for v in ob.data.vertices:
        v.co.z = max(v.co.z, 0.0)
    return ob


def sandwich():
    bm = bmesh.new()
    # isosceles-ish right triangle footprint, thickness 0.38 of the long side
    tri = [(0.0, 0.0), (1.0, 0.0), (0.0, 0.8)]
    h = 0.38
    bot = [bm.verts.new((x, y, 0.0)) for x, y in tri]
    top = [bm.verts.new((x, y, h)) for x, y in tri]
    bm.faces.new(bot[::-1])
    bm.faces.new(top)
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    # horizontal loops so bands paint on real edges and the bevel stays crisp
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.04, segments=3,
                    affect="EDGES", profile=0.5)
    me = bpy.data.meshes.new("Sandwich")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Sandwich", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main():
    a = args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ob = bush(a.seed) if a.kind == "bush" else sandwich()
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    ob.data.calc_loop_triangles()
    if len(ob.data.loop_triangles) > a.tris:
        for _ in range(5):
            ob.data.calc_loop_triangles()
            n = len(ob.data.loop_triangles)
            if n <= a.tris:
                break
            d = ob.modifiers.new("D", "DECIMATE")
            d.ratio = a.tris / n
            apply(ob, d)
    f = a.studs / max(ob.dimensions)
    ob.scale = (f, f, f)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.005)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth() if a.kind == "bush" else None
    me = ob.data
    me.calc_loop_triangles()
    cnt = {}
    for p in me.polygons:
        for k in p.edge_keys:
            cnt[k] = cnt.get(k, 0) + 1
    bad = sum(1 for v in cnt.values() if v != 2)
    bpy.ops.export_scene.gltf(filepath=str(out / "low.glb"), export_format="GLB",
                              use_selection=True, export_apply=True)
    rep = {"generator": f"tier3_props.py --kind {a.kind} (tier 3, code-authored)",
           "low_tris": len(me.loop_triangles), "target_tris": a.tris,
           "dimensions_studs": [round(d, 4) for d in ob.dimensions],
           "edges_not_two_faced": bad}
    (out / "report.json").write_text(json.dumps(rep, indent=2))
    print(json.dumps(rep, indent=2))
    return 1 if (bad or len(me.loop_triangles) > a.tris) else 0


if __name__ == "__main__":
    sys.exit(main())
