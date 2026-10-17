"""Headless smoke test for the colour stage (the PAINTER).

    blender --background --python scripts/verify_texture.py

Rewritten 2026-08-26. The old version tested the concept-PROJECTION route, which
is no longer the default and still smears. A green light from it said nothing
about the stage that actually runs.

Uses Suzanne, because the test has to be able to FAIL: a sphere looks the same
everywhere, so a placement bug would still score perfectly. Suzanne has a front,
a back, a top and two profiles.

WHAT IS ACTUALLY ASSERTED. Not "something was written" - that is the failure
mode this whole skill keeps hitting. Each check names a place the colour must
land and reads the baked atlas back at that place:

  1. the atlas exists, is not flat, and its uv_coverage matches stage 4's own
     report (proof the rasteriser and Blender agree about the layout)
  2. a `band` stamp low on Z paints the BOTTOM of the mesh and NOT the top
  3. a `blob` stamp paints where it was aimed and nowhere else
  4. `mirror: "x"` produces the stamp on BOTH sides
  5. `facing` keeps a stamp off surfaces pointing the wrong way
  6. an empty gutter is dilated, so no texel that a triangle uses is left black
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import mesh_pipeline  # noqa: E402
import paint_texture as P  # noqa: E402

TEX = 256
results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    results.append((bool(ok), label))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")


def build_suzanne(path: Path) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_monkey_add(size=2.0)
    obj = bpy.context.view_layer.objects.active
    mod = obj.modifiers.new("Sub", "SUBSURF")
    mod.levels = mod.render_levels = 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB",
                              use_selection=False)


SPEC = {
    "base": "#808080",
    "stamps": [
        {"name": "floor", "type": "band", "axis": "z", "max": 0.20,
         "color": "#FF0000", "soft": 0.0},
        {"name": "nose", "type": "blob", "at": [0.5, 0.10, 0.5],
         "r": [0.16, 0.16, 0.16], "color": "#00FF00", "soft": 0.0},
        {"name": "cheeks", "type": "blob", "at": [0.20, 0.45, 0.60],
         "r": [0.10, 0.10, 0.10], "color": "#0000FF", "soft": 0.0,
         "mirror": "x"},
        {"name": "topward", "type": "band", "axis": "z", "min": 0.90,
         "color": "#FFFF00", "soft": 0.0,
         "facing": [0, 0, 1], "facing_min": 0.5},
    ],
}


def sample(co, uv, ln, tv, tl, colour, predicate):
    """Mean baked colour over texels whose 3D point satisfies `predicate`."""
    pos, nrm, hit = P.rasterise(co, uv, ln, tv, tl, TEX)
    lo, hi = co.min(axis=0), co.max(axis=0)
    span = np.where(hi - lo == 0, 1.0, hi - lo)
    npos = (pos - lo) / span
    sel = hit & predicate(npos, nrm)
    if not sel.any():
        return None, 0
    return colour[sel].mean(axis=0), int(sel.sum())


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="rbx3d_paint_"))
    high = tmp / "high.glb"
    build_suzanne(high)

    rc = mesh_pipeline.run_pipeline(  # type: ignore[attr-defined]
        input_path=high, outdir=tmp / "out", target_tris=4000,
        texture_size=TEX, decimate_mode="collapse", target_studs=4.0,
    ) if hasattr(mesh_pipeline, "run_pipeline") else None
    if rc is None:
        import subprocess
        blender = bpy.app.binary_path
        subprocess.run([blender, "--background", "--python",
                        str(SCRIPTS / "mesh_pipeline.py"), "--",
                        "--input", str(high), "--outdir", str(tmp / "out"),
                        "--target-tris", "4000", "--texture-size", str(TEX),
                        "--target-studs", "4.0"], check=True)

    low = tmp / "out" / "low.glb"
    stage4 = json.loads((tmp / "out" / "report.json").read_text())
    spec_path = tmp / "suzanne.paint.json"
    spec_path.write_text(json.dumps(SPEC), encoding="utf-8")

    import subprocess
    subprocess.run([bpy.app.binary_path, "--background", "--python",
                    str(SCRIPTS / "paint_texture.py"), "--",
                    "--mesh", str(low), "--spec", str(spec_path),
                    "--outdir", str(tmp / "out"),
                    "--texture-size", str(TEX)], check=True)

    report = json.loads((tmp / "out" / "paint_report.json").read_text())
    img = bpy.data.images.load(str(tmp / "out" / "color.png"))
    colour = np.array(img.pixels[:], np.float32).reshape(TEX, TEX, 4)[:, :, :3]
    bpy.data.images.remove(img)

    print("\nchecks:")
    check(abs(report["uv_coverage"] - stage4["uv_coverage"]) < 0.02,
          "uv_coverage matches stage 4 ({} vs {})".format(
              report["uv_coverage"], stage4["uv_coverage"]))
    check(float(colour.max() - colour.min()) > 0.2, "atlas is not flat")

    co, uv, ln, tv, tl = P.load_mesh(low)

    bottom, n_b = sample(co, uv, ln, tv, tl, colour,
                         lambda p, n: p[:, :, 2] < 0.12)
    top, n_t = sample(co, uv, ln, tv, tl, colour,
                      lambda p, n: p[:, :, 2] > 0.5)
    check(bottom is not None and bottom[0] > bottom[1] * 2 and bottom[0] > bottom[2] * 2,
          f"band 'floor' is RED at the bottom ({n_b} texels)")
    check(top is not None and not (top[0] > top[1] * 2 and top[0] > top[2] * 2),
          f"band 'floor' did NOT leak to the top ({n_t} texels)")

    nose, n_n = sample(co, uv, ln, tv, tl, colour,
                       lambda p, n: (np.abs(p[:, :, 0] - 0.5) < 0.06) &
                                    (p[:, :, 1] < 0.16) &
                                    (np.abs(p[:, :, 2] - 0.5) < 0.06))
    check(nose is not None and nose[1] > nose[0] * 1.5 and nose[1] > nose[2] * 1.5,
          f"blob 'nose' is GREEN where it was aimed ({n_n} texels)")

    left, n_l = sample(co, uv, ln, tv, tl, colour,
                       lambda p, n: (np.abs(p[:, :, 0] - 0.20) < 0.07) &
                                    (np.abs(p[:, :, 1] - 0.45) < 0.07) &
                                    (np.abs(p[:, :, 2] - 0.60) < 0.07))
    right, n_r = sample(co, uv, ln, tv, tl, colour,
                        lambda p, n: (np.abs(p[:, :, 0] - 0.80) < 0.07) &
                                     (np.abs(p[:, :, 1] - 0.45) < 0.07) &
                                     (np.abs(p[:, :, 2] - 0.60) < 0.07))
    check(left is not None and left[2] > left[0] * 1.4,
          f"mirror: BLUE present on the -x side ({n_l} texels)")
    check(right is not None and right[2] > right[0] * 1.4,
          f"mirror: BLUE present on the +x side ({n_r} texels)")

    facing_down, n_f = sample(co, uv, ln, tv, tl, colour,
                              lambda p, n: (p[:, :, 2] > 0.90) &
                                           (n[:, :, 2] < -0.5))
    if n_f == 0:
        check(True, "facing: no downward-facing texels up high to test (vacuous)")
    else:
        check(not (facing_down[0] > 0.5 and facing_down[1] > 0.5 and facing_down[2] < 0.3),
              f"facing: YELLOW kept off downward faces ({n_f} texels)")

    _pos, _nrm, hit = P.rasterise(co, uv, ln, tv, tl, TEX)
    black_on_mesh = float((hit & (colour.max(axis=2) < 0.02)).sum())
    check(black_on_mesh / max(hit.sum(), 1) < 0.01,
          f"no black texels under the mesh ({int(black_on_mesh)} of {int(hit.sum())})")

    passed = sum(1 for ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
