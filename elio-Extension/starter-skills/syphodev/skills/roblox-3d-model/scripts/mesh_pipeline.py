"""Stage 4: a 600k-face generated mesh -> a Roblox-legal MeshPart plus a normal map.

Runs inside Blender:

    blender --background --python scripts/mesh_pipeline.py -- \
        --input work/high.glb --outdir work/out --target-tris 9000

The whole design is one sentence: Roblox caps a MeshPart at 20,000 triangles and
the real working budget is under 10,000, which against 600,000 is a 60:1 cut, so
the detail has to be MOVED into a normal map rather than thrown away.

Order matters and is not arbitrary:
    import -> join -> normalise scale -> duplicate -> decimate -> smart UV ->
    smooth shade -> bake high onto low -> export low + PNG

Scale is normalised BEFORE the duplicate so the two meshes share a coordinate
frame; bake a cage across two differently-scaled objects and you get garbage that
looks like a UV problem.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy


# --------------------------------------------------------------------------
# argv
# --------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    # Blender passes its own flags first; everything after a bare -- is ours.
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True, help=".glb/.gltf/.obj/.fbx high-poly")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--target-tris", type=int, default=9000,
                    help="Roblox hard cap is 20000; under 10000 is the working budget")
    ap.add_argument("--texture-size", type=int, default=1024,
                    help="SurfaceAppearance caps at 1024; larger is downscaled on upload")
    ap.add_argument("--decimate-mode", choices=["collapse", "planar"], default="collapse",
                    help="collapse for organic, planar for hard surface")
    ap.add_argument("--planar-angle", type=float, default=5.0,
                    help="degrees, planar mode only")
    ap.add_argument("--target-studs", type=float, default=0.0,
                    help="scale so the longest axis is this many studs (0 = leave alone)")
    ap.add_argument("--uv-margin", type=float, default=0.003,
                    help="island margin, charged PER ISLAND; 0.02 wastes most of a "
                         "1024 map on a mesh with many islands")
    ap.add_argument("--uv-angle", type=float, default=66.0, help="smart project angle limit, degrees")
    ap.add_argument("--cage-extrusion", type=float, default=-1.0,
                    help="<0 auto-scales from model size")
    ap.add_argument("--bake-margin", type=int, default=16)
    ap.add_argument("--samples", type=int, default=1,
                    help="a normal bake is a geometric projection; 1 is correct and fast")
    ap.add_argument("--weld-threshold", type=float, default=1e-5,
                    help="merge-by-distance threshold used to undo the importer's vertex split")
    ap.add_argument("--min-part-frac", type=float, default=0.002,
                    help="drop loose parts under this share of faces before decimating")
    ap.add_argument("--remesh-voxel", type=float, default=0.0,
                    help="voxel-remesh the low copy first, voxel = this x longest "
                         "dimension (0 = off). For meshes where collapse stalls")
    ap.add_argument("--no-bake", action="store_true", help="decimate and unwrap only")
    return ap.parse_args(argv)


# --------------------------------------------------------------------------
# scene helpers
# --------------------------------------------------------------------------

def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(path: Path) -> list[bpy.types.Object]:
    """Import and return only the objects this call added.

    Diffing the object set beats trusting the selection, which importers leave in
    inconsistent states. Blender 4.x renamed the OBJ importer, so route by suffix.
    """
    before = set(bpy.data.objects)
    suffix = path.suffix.lower()
    if suffix in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif suffix == ".ply":
        bpy.ops.wm.ply_import(filepath=str(path))
    elif suffix == ".stl":
        bpy.ops.wm.stl_import(filepath=str(path))
    else:
        raise SystemExit(f"unsupported input format: {suffix}")
    return [o for o in bpy.data.objects if o not in before]


def only_meshes(objects) -> list[bpy.types.Object]:
    return [o for o in objects if o.type == "MESH"]


def select_only(objects, active=None) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or (objects[0] if objects else None)


def join_meshes(meshes: list[bpy.types.Object]) -> bpy.types.Object:
    """Collapse a multi-object import into one mesh.

    A Roblox MeshPart is a single mesh, and selected-to-active baking needs one
    unambiguous target, so this is not cosmetic.
    """
    if len(meshes) == 1:
        return meshes[0]
    select_only(meshes, active=meshes[0])
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def weld_import(obj: bpy.types.Object, threshold: float = 1e-5) -> tuple[int, int]:
    """Reconnect a mesh that the importer arrived as a triangle soup.

    THIS IS THE MOST IMPORTANT FUNCTION IN THE FILE. glTF stores normals per
    corner, so the importer SPLITS EVERY VERTEX: a welded 10,242-vertex sphere
    comes back as 61,412 vertices, one set per face, with nothing joined to
    anything. Measured, not assumed.

    Nothing about that looks wrong, and everything downstream then fails quietly:

      - Decimate Collapse cannot collapse across disconnected faces, so it
        reduces far less than the ratio says while still reporting success
      - Smart UV Project sees every triangle as its own island and produces
        thousands of sub-pixel islands, so the bake rasterises no pixels at all
        and writes a perfectly valid, perfectly FLAT normal map

    Every one of those steps exits 0. The only visible symptom is a normal map
    with zero variation, which reads like a cage or selection problem and is not.

    Clearing custom split normals first is part of the fix, not a tidy-up: they
    hold the per-face normals that justified the split in the first place.
    """
    select_only([obj], active=obj)
    bpy.ops.mesh.customdata_custom_splitnormals_clear()

    before = len(obj.data.vertices)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=threshold)
    bpy.ops.object.mode_set(mode="OBJECT")
    after = len(obj.data.vertices)
    return before, after


def tri_count(obj: bpy.types.Object) -> int:
    """Triangles, not faces. Roblox budgets in triangles and quads count double."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def apply_all_transforms(obj: bpy.types.Object) -> None:
    select_only([obj], active=obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def normalise_scale(obj: bpy.types.Object, target_studs: float) -> float:
    """Scale so the longest axis measures target_studs, and bake the scale in.

    Roblox's importer will happily accept a mesh a thousand times too big; you
    find out when it fills the baseplate. Normalising here makes the size a stated
    intention rather than an accident of whatever the generator emitted.
    """
    if target_studs <= 0:
        return 1.0
    longest = max(obj.dimensions)
    if longest <= 0:
        return 1.0
    factor = target_studs / longest
    obj.scale = (obj.scale[0] * factor, obj.scale[1] * factor, obj.scale[2] * factor)
    apply_all_transforms(obj)
    return factor


# --------------------------------------------------------------------------
# pipeline stages
# --------------------------------------------------------------------------

def drop_specks(obj: bpy.types.Object, min_frac: float) -> tuple[int, int]:
    """Delete loose parts holding under min_frac of the faces.

    WHY: Hi3DGen emits floating specks (crumbs, stray blades). Each closed
    speck costs a floor of triangles that collapse cannot remove, so a 120-tri
    budget is unreachable while they exist, and they are invisible at game
    scale anyway. Returns (parts_before, parts_removed).
    """
    import bmesh
    if min_frac <= 0:
        return 0, 0
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen, parts = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, comp = [f], []
        seen.add(f.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.edges:
                for nb in e.link_faces:
                    if nb.index not in seen:
                        seen.add(nb.index)
                        stack.append(nb)
        parts.append(comp)
    total = len(bm.faces)
    doomed = [c for c in parts if len(c) < min_frac * total]
    if doomed and len(doomed) < len(parts):
        kill = [f for c in doomed for f in c]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(parts), len(doomed)


def rescale_pair(objs, target_studs: float) -> float:
    """Re-fit the LOW poly's longest axis to target_studs, scaling both meshes.

    WHY: normalise_scale() fits the HIGH poly; collapse then shaves thin
    extremities. Measured 2026-09-28: GrassClump briefed 6.0 came out 4.51 on
    the low (-25%) because the blade tips collapsed. Both meshes get the same
    factor about the same origin, so the bake stays aligned.
    """
    low = objs[-1]
    if target_studs <= 0 or max(low.dimensions) <= 0:
        return 1.0
    f = target_studs / max(low.dimensions)
    for o in objs:
        o.scale = (o.scale[0] * f, o.scale[1] * f, o.scale[2] * f)
        apply_all_transforms(o)
    return f


def decimate(low: bpy.types.Object, target_tris: int, mode: str, planar_angle: float) -> None:
    """Reduce in place.

    Mode is a real decision, not a default to accept. Collapse rounds corners,
    which is right for organic shapes and wrong for a crate or a gun, where the
    crisp edges are the read. Planar merges coplanar faces and leaves silhouettes
    sharp, but does nothing on a marching-cubes surface that has no flat regions.
    """
    select_only([low], active=low)
    mod = low.modifiers.new(name="Decimate", type="DECIMATE")

    if mode == "planar":
        mod.decimate_type = "DISSOLVE"
        mod.angle_limit = math.radians(planar_angle)
    else:
        mod.decimate_type = "COLLAPSE"
        current = tri_count(low)
        mod.ratio = min(1.0, target_tris / max(current, 1))

    bpy.ops.object.modifier_apply(modifier=mod.name)

    # ITERATE THE COLLAPSE. Measured 2026-09-28: at small budgets one pass
    # stops well short (Crumb asked 300 got 666, GrassClump asked 120 got 372)
    # while reporting success, because collapse refuses edges that would break
    # a boundary. Re-applying at the new ratio closes most of the gap.
    for _ in range(4):
        after = tri_count(low)
        if mode == "planar" or after <= target_tris * 1.02:
            break
        m = low.modifiers.new(name="DecimateIter", type="DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = target_tris / after
        bpy.ops.object.modifier_apply(modifier=m.name)

    # Planar dissolve produces n-gons and ignores the triangle target entirely, so
    # follow it with a collapse pass if it overshot. Otherwise a "hard surface"
    # run silently uploads at 40k and gets rejected by moderation.
    after = tri_count(low)
    if after > target_tris:
        select_only([low], active=low)
        mod2 = low.modifiers.new(name="Decimate2", type="DECIMATE")
        mod2.decimate_type = "COLLAPSE"
        mod2.ratio = min(1.0, target_tris / max(after, 1))
        bpy.ops.object.modifier_apply(modifier=mod2.name)


def smart_unwrap(low: bpy.types.Object, angle_deg: float, margin: float) -> int:
    """Generate UVs, because a generated mesh has none.

    This is the weak link in the whole chain. Decimation is deterministic and
    predictable; the unwrap is where visible seams come from, and the only dial
    that reliably helps is the island margin.
    """
    select_only([low], active=low)
    if not low.data.uv_layers:
        low.data.uv_layers.new(name="UVMap")

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(angle_deg),
        island_margin=margin,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=False,
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    return len(low.data.uv_layers)


def uv_coverage(obj: bpy.types.Object) -> float:
    """Fraction of the 0-1 UV square the mesh actually occupies.

    This is the number that decides how much of the baked texture is detail and
    how much is wasted padding. Smart UV Project on a generated mesh makes a lot
    of small islands, and the island margin is charged PER ISLAND, so a margin
    that looks tiny can eat most of the texture. Nothing errors; the normal map
    just comes out soft, and softness is easy to blame on the decimation.
    """
    mesh = obj.data
    if not mesh.uv_layers:
        return 0.0
    uvs = mesh.uv_layers.active.data
    mesh.calc_loop_triangles()
    total = 0.0
    for tri in mesh.loop_triangles:
        a, b, c = (uvs[i].uv for i in tri.loops)
        # Shoelace, halved: signed area of the UV triangle.
        total += abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5
    return total


def make_bake_material(low: bpy.types.Object, image: bpy.types.Image) -> None:
    """Attach a material whose ACTIVE node is the bake target.

    Blender bakes to whichever Image Texture node is active in the active
    material. Miss this and the bake succeeds, reports nothing, and writes to an
    image you never see.
    """
    mat = bpy.data.materials.new(name="BakeMat")
    mat.use_nodes = True
    low.data.materials.clear()
    low.data.materials.append(mat)

    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.select = True
    mat.node_tree.nodes.active = node


def bake_normal(high, low, image, cage_extrusion: float, margin: int, samples: int) -> None:
    """Bake the high-poly surface onto the low-poly UVs, tangent space.

    Selection order is load-bearing: sources selected, target selected AND active.
    """
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    # CPU on purpose: not every machine has CUDA, and a normal bake is
    # cheap anyway. Asking for GPU here just risks a device error at 1 sample.
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples

    bake = scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = cage_extrusion
    bake.use_cage = False           # extrusion-only cage; simpler and enough here
    bake.margin = margin
    bake.normal_space = "TANGENT"
    bake.normal_r, bake.normal_g, bake.normal_b = "POS_X", "POS_Y", "POS_Z"

    select_only([high, low], active=low)

    # EVERY setting is repeated as an operator argument, and that is not
    # redundancy. Called from a script, bpy.ops.object.bake takes its OWN property
    # defaults for anything not passed, ignoring the scene settings above -
    # use_selected_to_active defaults to False, so the bake silently captures the
    # low-poly's own normals and writes a perfectly flat, perfectly valid map.
    # That failure exits 0 and looks like a UV or cage problem for hours.
    result = bpy.ops.object.bake(
        type="NORMAL",
        use_selected_to_active=True,
        cage_extrusion=cage_extrusion,
        use_clear=True,
        margin=margin,
        normal_space="TANGENT",
        normal_r="POS_X", normal_g="POS_Y", normal_b="POS_Z",
    )
    if "FINISHED" not in result:
        raise SystemExit(f"bake operator did not finish: {result}")


def image_stats(image: bpy.types.Image) -> dict:
    """Cheap sanity numbers on the baked map.

    An all-flat (0.5, 0.5, 1.0) image means the bake found nothing: wrong cage,
    wrong selection, or the two meshes not overlapping. That failure exits 0 and
    produces a perfectly valid PNG, so it has to be measured, not eyeballed.
    """
    px = list(image.pixels)
    n = len(px) // 4
    if n == 0:
        return {"pixels": 0}
    rs = px[0::4]
    gs = px[1::4]
    return {
        "pixels": n,
        "r_min": min(rs), "r_max": max(rs),
        "g_min": min(gs), "g_max": max(gs),
        "variation": (max(rs) - min(rs)) + (max(gs) - min(gs)),
    }


def main() -> int:
    args = parse_args()
    src = Path(args.input).resolve()
    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    if not src.exists():
        raise SystemExit(f"input not found: {src}")

    reset_scene()
    imported = only_meshes(import_any(src))
    if not imported:
        raise SystemExit(f"no mesh objects in {src}")

    high = join_meshes(imported)
    high.name = "HighPoly"

    # Weld BEFORE anything measures or reduces the mesh: on a split import the
    # triangle count is honest but the topology is not, and both the decimate and
    # the unwrap depend on topology.
    verts_before, verts_after = weld_import(high, args.weld_threshold)
    print(f"[mesh] weld: {verts_before} -> {verts_after} vertices")

    high_tris = tri_count(high)

    scale_factor = normalise_scale(high, args.target_studs)
    dims = tuple(round(d, 4) for d in high.dimensions)

    # Duplicate AFTER normalising so both meshes share one frame.
    select_only([high], active=high)
    bpy.ops.object.duplicate()
    low = bpy.context.view_layer.objects.active
    low.name = "LowPoly"

    if args.remesh_voxel > 0:
        # COLLAPSE CAN STALL DEAD. Measured 2026-09-28: Crumb sat at 631 tris
        # on 196 vertices (a closed mesh that size should be ~388) and a
        # ratio-0.3 collapse removed NOTHING; GrassClump likewise stuck at 353.
        # Degenerate/overlapping faces from the generator block every collapse.
        # A voxel remesh of the low copy rebuilds clean closed topology first;
        # the high poly is untouched, so the normal bake still carries detail.
        select_only([low], active=low)
        rm = low.modifiers.new(name="Remesh", type="REMESH")
        rm.mode = "VOXEL"
        rm.voxel_size = max(low.dimensions) * args.remesh_voxel
        bpy.ops.object.modifier_apply(modifier=rm.name)
        print(f"[mesh] voxel remesh at {rm.voxel_size:.4f} -> {tri_count(low)} tris")
    parts, specks = drop_specks(low, args.min_part_frac)
    print(f"[mesh] loose parts: {parts}, dropped {specks} specks under "
          f"{args.min_part_frac:.2%} of faces")
    decimate(low, args.target_tris, args.decimate_mode, args.planar_angle)
    low_tris = tri_count(low)
    refit = rescale_pair([high, low], args.target_studs)
    print(f"[mesh] refit after decimation x{refit:.4f}")

    smart_unwrap(low, args.uv_angle, args.uv_margin)

    # Smooth shading is what lets a normal map carry the detail; leave the low-poly
    # flat-shaded and every decimated facet stays visible through the map.
    select_only([low], active=low)
    bpy.ops.object.shade_smooth()

    report = {
        "input": str(src),
        "verts_on_import": verts_before,
        "verts_after_weld": verts_after,
        "import_was_split": verts_before > verts_after * 1.5,
        "high_tris": high_tris,
        "low_tris": low_tris,
        "reduction": round(high_tris / max(low_tris, 1), 1),
        "target_tris": args.target_tris,
        "within_roblox_hard_cap_20k": low_tris <= 20000,
        "within_working_budget_10k": low_tris <= 10000,
        "decimate_mode": args.decimate_mode,
        "scale_factor": round(scale_factor, 6),
        "refit_after_decimate": round(refit, 5),
        "loose_parts": parts,
        "specks_dropped": specks,
        "low_dimensions_studs": tuple(round(d, 4) for d in low.dimensions),
        "dimensions_studs": dims,
        "uv_layers": len(low.data.uv_layers),
        "uv_coverage": round(uv_coverage(low), 4),
        "uv_margin": args.uv_margin,
    }

    if not args.no_bake:
        size = args.texture_size
        if size > 1024:
            print(f"[mesh] WARNING: {size}px exceeds the 1024 SurfaceAppearance cap; "
                  "Roblox will downscale it on upload")

        image = bpy.data.images.new("Normal", width=size, height=size,
                                    alpha=False, float_buffer=False)
        # Neutral tangent-space normal, so unbaked margin pixels read as 'flat'
        # rather than as a black gouge across the model.
        image.generated_color = (0.5, 0.5, 1.0, 1.0)
        image.colorspace_settings.name = "Non-Color"

        make_bake_material(low, image)

        extrusion = args.cage_extrusion
        if extrusion < 0:
            # Proportional to the model, because a fixed 0.05 is enormous on a
            # 0.3-stud coin and invisible on a 40-stud vehicle.
            extrusion = max(max(high.dimensions) * 0.02, 1e-4)

        bake_normal(high, low, image, extrusion, args.bake_margin, args.samples)

        normal_path = outdir / "normal.png"
        image.filepath_raw = str(normal_path)
        image.file_format = "PNG"
        image.save()

        stats = image_stats(image)
        report["normal_map"] = str(normal_path)
        report["cage_extrusion"] = round(extrusion, 6)
        report["normal_stats"] = {k: (round(v, 4) if isinstance(v, float) else v)
                                  for k, v in stats.items()}
        report["normal_looks_baked"] = stats.get("variation", 0.0) > 0.05

    # Export the low-poly alone. GLB because the Assets API Model type accepts it
    # directly, which keeps the upload seam clean.
    low_path = outdir / "low.glb"
    select_only([low], active=low)
    bpy.ops.export_scene.gltf(
        filepath=str(low_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )
    report["mesh"] = str(low_path)

    (outdir / "report.json").write_text(json.dumps(report, indent=2))

    print(json.dumps(report, indent=2))
    if not report["within_working_budget_10k"]:
        print("[mesh] WARNING: over the 10k working budget. Legal, but heavy on mobile.")
    if not report["within_roblox_hard_cap_20k"]:
        print("[mesh] FAIL: over the 20k hard cap. Roblox will reject this at upload.")
        return 1
    if not args.no_bake and not report.get("normal_looks_baked", True):
        print("[mesh] FAIL: the normal map is flat. The bake found no geometry - "
              "check the cage extrusion and that both meshes overlap.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
