"""Headless smoke test for the Blender stage.

    blender --background --python scripts/verify.py

Builds a known high-poly (a displaced sphere, so it has real surface detail to
capture), drives the REAL entry point over it, and then asserts on the artifacts
rather than on the exit code. Every check here exists because the corresponding
failure exits 0 and produces a file that opens fine:

  - a decimate that overshoots still writes a valid GLB, and Roblox rejects it
  - an unwrap that never ran still writes a valid GLB, and the texture is garbage
  - a bake that missed still writes a valid, perfectly flat PNG

The last one is the dangerous one, which is why it is measured numerically.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import bpy

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import mesh_pipeline  # noqa: E402  (path must be set first)

TARGET_TRIS = 2000
TEX = 512

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    results.append((bool(ok), label))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")


def build_highpoly(path: Path) -> int:
    """A sphere with noise displacement: dense, and detailed enough to bake."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # subdivisions=7 gives ~82k tris. Six gives 20k, which decimates to the target
    # so easily that the test stops resembling a real 60:1 generated-mesh cut.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=7, radius=1.0)
    obj = bpy.context.view_layer.objects.active

    tex = bpy.data.textures.new("Noise", type="CLOUDS")
    tex.noise_scale = 0.35
    mod = obj.modifiers.new(name="Displace", type="DISPLACE")
    mod.texture = tex
    mod.strength = 0.18
    bpy.ops.object.modifier_apply(modifier=mod.name)

    obj.data.calc_loop_triangles()
    tris = len(obj.data.loop_triangles)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True)
    return tris


def run_pipeline(src: Path, outdir: Path, extra: list[str]) -> int:
    """Call the real entry point the way a user would, argv and all."""
    sys.argv = ["blender", "--",
                "--input", str(src),
                "--outdir", str(outdir),
                "--target-tris", str(TARGET_TRIS),
                "--texture-size", str(TEX)] + extra
    return mesh_pipeline.main()


def reimport_tris(path: Path) -> tuple[int, int, bool]:
    """Re-import the exported GLB and measure it, rather than trusting the report."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return 0, 0, False
    obj = meshes[0]
    obj.data.calc_loop_triangles()
    uvs_in_range = True
    if obj.data.uv_layers:
        for loop in obj.data.uv_layers.active.data:
            u, v = loop.uv
            if not (-0.001 <= u <= 1.001 and -0.001 <= v <= 1.001):
                uvs_in_range = False
                break
    return len(obj.data.loop_triangles), len(obj.data.uv_layers), uvs_in_range


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="rbx3d_verify_"))
    src = tmp / "high.glb"
    outdir = tmp / "out"

    print(f"[verify] workspace {tmp}")
    high_tris = build_highpoly(src)
    print(f"[verify] built high-poly: {high_tris} tris")
    check(high_tris > 50000, f"high-poly is dense enough to be a real test ({high_tris} tris)")

    print("[verify] --- collapse + bake ---")
    rc = run_pipeline(src, outdir, [])
    check(rc == 0, "pipeline exited 0")

    report_path = outdir / "report.json"
    check(report_path.exists(), "report.json written")
    if not report_path.exists():
        return summarise()

    report = json.loads(report_path.read_text())
    check(report["low_tris"] <= TARGET_TRIS * 1.05,
          f"decimated to target ({report['low_tris']} vs {TARGET_TRIS})")
    check(report["within_roblox_hard_cap_20k"], "under the 20k Roblox hard cap")
    check(report["high_tris"] > report["low_tris"] * 5,
          f"a real reduction happened ({report['reduction']}:1)")
    check(report["uv_layers"] >= 1, "UVs were generated (the mesh arrives with none)")

    # A GLB always arrives vertex-split, so if the weld reports no change it did
    # not run, and both the decimation and the bake are quietly compromised.
    check(report["import_was_split"],
          f"the split import was detected ({report['verts_on_import']} verts)")
    check(report["verts_after_weld"] < report["verts_on_import"],
          f"weld reconnected the mesh ({report['verts_on_import']} -> {report['verts_after_weld']})")

    # Measured on the test shape: margin 0.02 gives 0.29 coverage, 0.003 gives 0.49.
    # Under a quarter means the padding is eating the texture, and the only symptom
    # is a soft normal map that looks like a decimation problem.
    check(report["uv_coverage"] > 0.25,
          f"UV layout uses enough of the texture ({report['uv_coverage']})")

    normal = Path(report.get("normal_map", ""))
    check(normal.exists() and normal.stat().st_size > 0, "normal.png written and non-empty")
    check(report.get("normal_looks_baked") is True,
          f"normal map has real variation ({report.get('normal_stats', {}).get('variation')})")

    mesh = Path(report["mesh"])
    check(mesh.exists(), "low.glb written")
    tris, uv_layers, uvs_in_range = reimport_tris(mesh)
    check(tris > 0, f"low.glb re-imports ({tris} tris)")
    check(abs(tris - report["low_tris"]) <= max(4, report["low_tris"] * 0.02),
          "re-imported triangle count matches the report")
    check(uv_layers >= 1, "UVs survived the GLB round trip")
    check(uvs_in_range, "UVs lie inside 0-1 (outside means the unwrap did not run)")

    print("[verify] --- planar mode, no bake ---")
    outdir2 = tmp / "out_planar"
    rc2 = run_pipeline(src, outdir2, ["--decimate-mode", "planar", "--no-bake"])
    check(rc2 == 0, "planar mode exits 0")
    if (outdir2 / "report.json").exists():
        r2 = json.loads((outdir2 / "report.json").read_text())
        # Planar dissolve ignores the triangle target, so the follow-up collapse
        # pass is the thing under test here, not the dissolve itself.
        check(r2["low_tris"] <= TARGET_TRIS * 1.05,
              f"planar mode still respects the budget ({r2['low_tris']})")

    return summarise()


def summarise() -> int:
    passed = sum(1 for ok, _ in results if ok)
    total = len(results)
    print(f"\n[verify] {passed}/{total} checks passed")
    if passed != total:
        for ok, label in results:
            if not ok:
                print(f"  FAILED: {label}")
        return 1
    print("[verify] Blender stage is sound. Now LOOK at normal.png: this proves the "
          "bake ran, not that the seams are acceptable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
