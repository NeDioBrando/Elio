"""One side-on view per asset, with a GREEN marker at the +body-axis end.

    blender --background --python scripts/orient_sheet.py -- \\
        --outdir work/farm --out "work/farm/_orientation_sheet.png"

Answers one question for a whole set in a single look: for each asset, is the
head at the MIN or the MAX end of its body axis. Geometry cannot decide this
reliably - the cross-section heuristic in make_paint_spec.py is right on a pig
(11.3x) and WRONG on a cow (2.3x), because a cow's rump out-bulks its head.

Read it like this: the green sphere marks the MAX end of the body axis. If the
head is on the opposite side from the green sphere, that asset is `--head-end
min`. If the head is on the same side, it is `--head-end max`.

Assets are drawn in alphabetical order, left to right, top to bottom. The same
order is printed to stdout so there is no counting squares.
"""
from __future__ import annotations
import argparse, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector

BG = np.array([0.16, 0.16, 0.18], dtype=np.float32)


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--tile", type=int, default=380)
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--samples", type=int, default=16)
    return p.parse_args(a)


def scene():
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.render.film_transparent = True
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "Standard"


def render_one(mesh: Path, tile: int, samples: int, tmp: Path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(mesh))
    obj = [o for o in bpy.data.objects if o.type == "MESH"][0]

    co = np.array([obj.matrix_world @ v.co for v in obj.data.vertices], dtype=np.float64)
    lo, hi = co.min(axis=0), co.max(axis=0)
    span = hi - lo
    body = int(np.argmax([span[0], span[1]]))     # longest horizontal axis

    grey = bpy.data.materials.new("G")
    grey.use_nodes = True
    grey.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (.66, .66, .68, 1)
    grey.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
    obj.data.materials.clear()
    obj.data.materials.append(grey)

    # Green marker at the MAX end of the body axis, at mid height.
    n = np.array([0.5, 0.5, 0.5])
    n[body] = 1.0
    pos = lo + n * span
    r = float(span.max()) * 0.07
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=tuple(pos))
    m = bpy.data.materials.new("M")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (.05, 1, .1, 1)
    bpy.context.view_layer.objects.active.data.materials.append(m)

    w = bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (.55, .55, .58, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.1

    centre = Vector((lo + span / 2).tolist())
    radius = float(span.max()) * 0.5
    scene()
    s = bpy.context.scene
    s.cycles.samples = samples
    s.render.resolution_x = s.render.resolution_y = tile

    bpy.ops.object.camera_add()
    cam = bpy.context.view_layer.objects.active
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 2.5
    s.camera = cam
    # Look along the WIDTH axis, so the body axis runs left-right in frame.
    d = Vector((1, 0, 0.18)) if body == 1 else Vector((0, 1, 0.18))
    d = d.normalized()
    cam.location = centre + d * radius * 6.0
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()

    s.render.filepath = str(tmp)
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(str(tmp))
    px = np.array(im.pixels[:], dtype=np.float32).reshape(tile, tile, 4)
    bpy.data.images.remove(im)
    al = px[:, :, 3:4]
    return px[:, :, :3] * al + BG * (1 - al), "xyz"[body]


def main():
    a = args()
    outdir = Path(a.outdir).resolve()
    out = Path(a.out).resolve()
    tmp = out.parent / "_o.png"

    meshes = sorted(p for p in outdir.glob("*/out/low.glb"))
    if not meshes:
        raise SystemExit("no */out/low.glb under {}. Run stage 4 first.".format(outdir))

    tiles, names = [], []
    for m in meshes:
        name = m.parent.parent.name
        tile, axis = render_one(m, a.tile, a.samples, tmp)
        tiles.append(tile)
        names.append((name, axis))
        print("[orient] {:>3}. {:<10} body axis {}".format(len(names), name, axis))
    tmp.unlink(missing_ok=True)

    cols = min(a.cols, len(tiles))
    rows = int(math.ceil(len(tiles) / cols))
    sheet = np.tile(BG, (rows * a.tile, cols * a.tile, 1))
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        r = rows - 1 - r                       # Blender rows run bottom-up
        sheet[r * a.tile:(r + 1) * a.tile, c * a.tile:(c + 1) * a.tile] = t

    rgba = np.concatenate([sheet, np.ones((*sheet.shape[:2], 1), np.float32)], axis=2)
    img = bpy.data.images.new("O", width=cols * a.tile, height=rows * a.tile, alpha=True)
    img.pixels = rgba.reshape(-1).tolist()
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()
    print("[orient] wrote {} ({} assets, {} per row, left-to-right top-to-bottom)"
          .format(out, len(tiles), cols))
    print("[orient] GREEN sphere = the MAX end of the body axis.")
    print("[orient] Head opposite the green sphere -> --head-end min. Same side -> max.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
