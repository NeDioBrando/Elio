"""Show a mesh with three markers at known normalised object positions, so the
axes can be read off a picture instead of guessed.

  RED   = +X end   (normalised 1.0, 0.5, 0.5)
  GREEN = +Y end   (0.5, 1.0, 0.5)
  BLUE  = +Z top   (0.5, 0.5, 1.0)

Cheap, once per mesh, and it removes every "which end is the head" guess from
the paint spec that follows.
"""
from __future__ import annotations
import argparse, json, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector

BG = np.array([0.145, 0.145, 0.157], dtype=np.float32)


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mesh", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--tile", type=int, default=470)
    p.add_argument("--samples", type=int, default=24)
    return p.parse_args(a)


def main():
    a = args()
    out = Path(a.out).resolve()
    tmp = out.parent / "_a.png"

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(a.mesh).resolve()))
    obj = [o for o in bpy.data.objects if o.type == "MESH"][0]

    co = np.array([obj.matrix_world @ v.co for v in obj.data.vertices], dtype=np.float64)
    lo, hi = co.min(axis=0), co.max(axis=0)
    span = hi - lo

    grey = bpy.data.materials.new("G")
    grey.use_nodes = True
    grey.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (.62, .62, .64, 1)
    grey.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.65
    obj.data.materials.clear()
    obj.data.materials.append(grey)

    r = float(span.max()) * 0.06
    for n, colour in ((np.array([1.0, .5, .5]), (1, .05, .05, 1)),
                      (np.array([.5, 1.0, .5]), (.05, 1, .05, 1)),
                      (np.array([.5, .5, 1.0]), (.1, .3, 1, 1))):
        pos = lo + n * span
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=tuple(pos))
        m = bpy.data.materials.new("M")
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = colour
        bpy.context.view_layer.objects.active.data.materials.append(m)

    w = bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (.4, .4, .42, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0

    centre = Vector((lo + span / 2).tolist())
    radius = float(span.max()) * 0.5
    bpy.ops.object.light_add(type="SUN", location=centre + Vector((2, -3, 4)) * radius)
    lt = bpy.context.view_layer.objects.active
    lt.data.energy = 3.0
    lt.rotation_euler = (centre - lt.location).normalized().to_track_quat("-Z", "Y").to_euler()

    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = a.samples
    s.render.resolution_x = s.render.resolution_y = a.tile
    s.render.film_transparent = True
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "Standard"

    bpy.ops.object.camera_add()
    cam = bpy.context.view_layer.objects.active
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 2.9
    s.camera = cam

    tiles = []
    for d in ((1, 0, 0), (0, 1, 0), (-1, 0, 0), (0.6, 0.6, 0.5)):
        dv = Vector(d).normalized()
        cam.location = centre + dv * radius * 6.0
        cam.rotation_euler = (-dv).to_track_quat("-Z", "Y").to_euler()
        s.render.filepath = str(tmp)
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(str(tmp))
        px = np.array(im.pixels[:], dtype=np.float32).reshape(a.tile, a.tile, 4)
        bpy.data.images.remove(im)
        al = px[:, :, 3:4]
        tiles.append(px[:, :, :3] * al + BG * (1 - al))
    tmp.unlink(missing_ok=True)

    sheet = np.concatenate(tiles, axis=1)
    rgba = np.concatenate([sheet, np.ones((*sheet.shape[:2], 1), np.float32)], axis=2)
    img = bpy.data.images.new("A", width=sheet.shape[1], height=sheet.shape[0], alpha=True)
    img.pixels = rgba.reshape(-1).tolist()
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()
    print("[axes] views: from +X, from +Y, from -X, three-quarter")
    print("[axes] bbox lo={} hi={} span={}".format(
        [round(v, 3) for v in lo], [round(v, 3) for v in hi], [round(v, 3) for v in span]))
    print("[axes] wrote {}".format(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
