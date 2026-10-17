"""Render a textured MeshPart as a multi-view contact sheet, for judging by eye.

    blender --background --python render_check.py -- --mesh low.glb \
        --color color.png [--normal normal.png] --out sheet.png

Plain grey ground and soft key light on purpose: the sheet exists to judge the
COLOUR MAP, so nothing in the lighting should be doing the work.
"""
from __future__ import annotations
import argparse, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector

BG = (0.145, 0.145, 0.157, 1.0)   # linear, reads as the mid grey in a showcase


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mesh", required=True)
    p.add_argument("--color", required=True)
    p.add_argument("--normal", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--tile", type=int, default=560)
    p.add_argument("--cols", type=int, default=3)
    p.add_argument("--views", type=int, default=6)
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--elev", type=float, default=12.0)
    p.add_argument("--engine", default="EEVEE", choices=["EEVEE", "CYCLES", "WORKBENCH"],
                   help="EEVEE is the default: this sheet exists to judge WHERE colour "
                        "landed, and measured on the pig it is ~14x faster than Cycles "
                        "for a picture that answers the same question.")
    return p.parse_args(a)


def build(mesh, color, normal):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(mesh))
    obj = [o for o in bpy.data.objects if o.type == "MESH"][0]

    mat = bpy.data.materials.new("Show")
    mat.use_nodes = True
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    nt = mat.node_tree
    n, l = nt.nodes, nt.links
    bsdf = n.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.55
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25

    tex = n.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(color))
    l.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    if normal:
        nt_img = n.new("ShaderNodeTexImage")
        nt_img.image = bpy.data.images.load(str(normal))
        nt_img.image.colorspace_settings.name = "Non-Color"
        nmap = n.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = 0.8
        l.new(nt_img.outputs["Color"], nmap.inputs["Color"])
        l.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    world = bpy.data.worlds.new("W")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.42, 0.42, 0.45, 1.0)
    bg.inputs["Strength"].default_value = 1.15
    return obj


def add_lights(centre, radius):
    for name, offset, energy, size in (
        ("key", Vector((1.2, -1.4, 1.6)), 3.5, 2.5),
        ("fill", Vector((-1.6, -0.8, 0.6)), 1.6, 3.5),
        ("rim", Vector((0.2, 1.8, 1.2)), 1.8, 2.5),
    ):
        bpy.ops.object.light_add(type="AREA",
                                 location=centre + offset * radius * 3.0)
        lt = bpy.context.view_layer.objects.active
        lt.name = name
        lt.data.energy = energy * (radius * 6.0) ** 2
        lt.data.size = size * radius
        d = (centre - lt.location).normalized()
        lt.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def main():
    a = args()
    out = Path(a.out).resolve()
    obj = build(Path(a.mesh).resolve(), Path(a.color).resolve(),
                Path(a.normal).resolve() if a.normal else None)

    centre = obj.matrix_world @ (sum((Vector(v) for v in obj.bound_box), Vector()) / 8.0)
    radius = max(obj.dimensions) * 0.5
    add_lights(centre, radius)

    s = bpy.context.scene
    if a.engine == "CYCLES":
        s.render.engine = "CYCLES"
        s.cycles.device = "CPU"
        s.cycles.samples = a.samples
    elif a.engine == "WORKBENCH":
        s.render.engine = "BLENDER_WORKBENCH"
        s.display.shading.light = "STUDIO"
        s.display.shading.color_type = "TEXTURE"
    else:
        s.render.engine = "BLENDER_EEVEE_NEXT"
        try:
            s.eevee.taa_render_samples = max(8, a.samples // 4)
        except AttributeError:
            pass
    s.render.resolution_x = s.render.resolution_y = a.tile
    s.render.film_transparent = True
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "Standard"

    bpy.ops.object.camera_add()
    cam = bpy.context.view_layer.objects.active
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 2.5
    s.camera = cam

    tiles = []
    elev = math.radians(a.elev)
    tmp = out.parent / "_view.png"
    for i in range(a.views):
        yaw = 2 * math.pi * i / a.views
        d = Vector((math.cos(yaw) * math.cos(elev),
                    math.sin(yaw) * math.cos(elev),
                    math.sin(elev)))
        cam.location = centre + d * radius * 6.0
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        s.render.filepath = str(tmp)
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(str(tmp))
        px = np.array(im.pixels[:], dtype=np.float32).reshape(a.tile, a.tile, 4)
        bpy.data.images.remove(im)
        alpha = px[:, :, 3:4]
        flat = px[:, :, :3] * alpha + np.array(BG[:3], dtype=np.float32) * (1 - alpha)
        tiles.append(flat)
    tmp.unlink(missing_ok=True)

    cols = a.cols
    rows = int(math.ceil(len(tiles) / cols))
    sheet = np.tile(np.array(BG[:3], dtype=np.float32),
                    (rows * a.tile, cols * a.tile, 1))
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        # Blender image rows run bottom-up, so the first tile goes on the top row
        r = rows - 1 - r
        sheet[r * a.tile:(r + 1) * a.tile, c * a.tile:(c + 1) * a.tile] = t

    rgba = np.concatenate([sheet, np.ones((*sheet.shape[:2], 1), np.float32)], axis=2)
    img = bpy.data.images.new("Sheet", width=cols * a.tile, height=rows * a.tile,
                              alpha=True)
    img.pixels = rgba.reshape(-1).tolist()
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()
    print("[render] wrote {}".format(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
