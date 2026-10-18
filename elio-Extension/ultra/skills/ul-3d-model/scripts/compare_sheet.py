"""Two colour maps on the same mesh, one row each, same views and same light.

    blender --background --python compare_sheet.py -- --mesh low.glb \
        --before old/color.png --after new/color.png --normal normal.png \
        --out compare.png
"""
from __future__ import annotations
import argparse, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector

BG = np.array([0.145, 0.145, 0.157], dtype=np.float32)


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mesh", required=True)
    p.add_argument("--before", required=True)
    p.add_argument("--after", required=True)
    p.add_argument("--normal", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--tile", type=int, default=520)
    p.add_argument("--views", type=int, default=3)
    p.add_argument("--samples", type=int, default=96)
    return p.parse_args(a)


def main():
    a = args()
    out = Path(a.out).resolve()
    tmp = out.parent / "_c.png"

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(a.mesh).resolve()))
    obj = [o for o in bpy.data.objects if o.type == "MESH"][0]

    mat = bpy.data.materials.new("S")
    mat.use_nodes = True
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.55
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    tex = nt.nodes.new("ShaderNodeTexImage")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if a.normal:
        ni = nt.nodes.new("ShaderNodeTexImage")
        ni.image = bpy.data.images.load(str(Path(a.normal).resolve()))
        ni.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.8
        nt.links.new(ni.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    w = bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (.25, .25, .27, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6

    centre = obj.matrix_world @ (sum((Vector(v) for v in obj.bound_box), Vector()) / 8.0)
    radius = max(obj.dimensions) * 0.5
    for offset, energy, size in ((Vector((1.2, -1.4, 1.6)), 6.0, 2.0),
                                 (Vector((-1.6, -0.8, 0.6)), 2.0, 3.0),
                                 (Vector((0.2, 1.8, 1.2)), 3.0, 2.0)):
        bpy.ops.object.light_add(type="AREA", location=centre + offset * radius * 3.0)
        lt = bpy.context.view_layer.objects.active
        lt.data.energy = energy * (radius * 6.0) ** 2
        lt.data.size = size * radius
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
    cam.data.ortho_scale = radius * 2.45
    s.camera = cam

    rows = []
    for path in (a.before, a.after):
        tex.image = bpy.data.images.load(str(Path(path).resolve()))
        tiles = []
        for i in range(a.views):
            yaw = math.radians(35) + 2 * math.pi * i / a.views
            e = math.radians(10)
            d = Vector((math.cos(yaw) * math.cos(e), math.sin(yaw) * math.cos(e), math.sin(e)))
            cam.location = centre + d * radius * 6.0
            cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
            s.render.filepath = str(tmp)
            bpy.ops.render.render(write_still=True)
            im = bpy.data.images.load(str(tmp))
            px = np.array(im.pixels[:], dtype=np.float32).reshape(a.tile, a.tile, 4)
            bpy.data.images.remove(im)
            al = px[:, :, 3:4]
            tiles.append(px[:, :, :3] * al + BG * (1 - al))
        rows.append(np.concatenate(tiles, axis=1))
    tmp.unlink(missing_ok=True)

    # Blender rows are bottom-up, so "before" must be written to the LOWER half
    sheet = np.concatenate([rows[1], rows[0]], axis=0)
    rgba = np.concatenate([sheet, np.ones((*sheet.shape[:2], 1), np.float32)], axis=2)
    img = bpy.data.images.new("C", width=sheet.shape[1], height=sheet.shape[0], alpha=True)
    img.pixels = rgba.reshape(-1).tolist()
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()
    print("[compare] wrote {} (top row = BEFORE, bottom row = AFTER)".format(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
