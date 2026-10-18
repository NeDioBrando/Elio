"""Code-authored grass clump for a scatter budget Hi3DGen cannot meet (Tier 3).

    blender --background --python grass_clump.py -- --out work/set/GrassClump/out \\
        --studs 6 --blades 11 [--seed 7]

WHY IT EXISTS. Measured 2026-09-28 (a real build): the map scatters 139 grass
clumps, so the budget was cut to 120 tris. The Hi3DGen clump (814,942 faces,
18 loose blades) would not go below 353 tris by collapse - the blades are thin
closed shells and collapse stalls - and a voxel remesh coarse enough to reach
134 tris turned it into a crumpled crown with no blades at all. A grass blade
is not an organic sculpt at this budget; it is ~10 triangles of geometry, and
code draws it crisp, CLOSED (Roblox is single-sided) and inside budget.

Each blade is a closed, curved, three-sided tapered spike: base cap (1 tri),
two side rings (6 tris), tip fan (3 tris) = 10 tris. Blades lean outward from
the centre, deterministically from --seed, so the asset regenerates identically.
Writes low.glb (UV-unwrapped, ready for paint_texture.py) and report.json with
the MEASURED triangle count and dimensions. Blender Z up; the longest axis is
fitted to --studs.
"""
from __future__ import annotations
import argparse, json, math, random, sys
from pathlib import Path
import bpy, bmesh


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--studs", type=float, default=6.0)
    p.add_argument("--blades", type=int, default=11)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--max-tris", type=int, default=120)
    return p.parse_args(a)


def blade(bm, rng, ang, lean, height, width):
    ca, sa = math.cos(ang), math.sin(ang)
    # outward direction and a perpendicular for the blade's width
    ox, oy = ca, sa
    px, py = -sa, ca
    r0 = rng.uniform(0.0, 0.35)
    base_c = (ox * r0, oy * r0, 0.0)

    def ring(t, w):
        # quadratic lean outward: bends more toward the tip
        off = lean * t * t
        cx = base_c[0] + ox * off
        cy = base_c[1] + oy * off
        cz = height * t
        # three corners: two along the width, one slightly outward (thickness)
        return [bm.verts.new((cx + px * w, cy + py * w, cz)),
                bm.verts.new((cx - px * w, cy - py * w, cz)),
                bm.verts.new((cx + ox * w * 0.6, cy + oy * w * 0.6, cz))]

    r_a = ring(0.0, width)
    r_b = ring(0.5, width * 0.65)
    tip_off = lean
    tip = bm.verts.new((base_c[0] + ox * tip_off, base_c[1] + oy * tip_off, height))
    bm.faces.new((r_a[2], r_a[1], r_a[0]))                 # base cap
    for lo, hi in ((r_a, r_b),):
        for i in range(3):
            j = (i + 1) % 3
            bm.faces.new((lo[i], lo[j], hi[j]))
            bm.faces.new((lo[i], hi[j], hi[i]))
    for i in range(3):
        bm.faces.new((r_b[i], r_b[(i + 1) % 3], tip))


def main():
    a = args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(a.seed)
    me = bpy.data.meshes.new("GrassClump")
    bm = bmesh.new()
    for i in range(a.blades):
        ang = (2 * math.pi * i / a.blades) + rng.uniform(-0.25, 0.25)
        tall = rng.uniform(0.6, 1.0)
        blade(bm, rng, ang, lean=rng.uniform(0.6, 1.6) * tall, height=4.0 * tall,
              width=rng.uniform(0.16, 0.24))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("GrassClump", me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)

    # fit longest axis to --studs, base on z=0, centred in x/y
    f = a.studs / max(ob.dimensions)
    ob.scale = (f, f, f)
    bpy.ops.object.transform_apply(scale=True)

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    for p in me.polygons:
        p.use_smooth = False

    me.calc_loop_triangles()
    tris = len(me.loop_triangles)
    # closed check: every edge has exactly two faces
    open_edges = 0
    cnt = {}
    for p in me.polygons:
        for k in p.edge_keys:
            cnt[k] = cnt.get(k, 0) + 1
    open_edges = sum(1 for v in cnt.values() if v != 2)

    bpy.ops.export_scene.gltf(filepath=str(out / "low.glb"), export_format="GLB",
                              use_selection=True, export_apply=True)
    report = {"generator": "grass_clump.py (tier 3, code-authored)",
              "low_tris": tris, "target_tris": a.max_tris,
              "blades": a.blades, "seed": a.seed,
              "dimensions_studs": [round(d, 4) for d in ob.dimensions],
              "edges_not_two_faced": open_edges,
              "uv_layers": len(me.uv_layers)}
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    if tris > a.max_tris or open_edges:
        print("[grass] FAIL: over budget or not closed")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
