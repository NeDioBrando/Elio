"""Concept, then the textured mesh from the projector axis and from behind it.

The only reading that matters: does the head end of the mesh carry the head of
the concept, on BOTH sides. Judged on the pair, never on a render alone.
"""
from __future__ import annotations
import argparse, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector

BG = np.array([0.145, 0.145, 0.157], dtype=np.float32)
DIRS = {"+X": (1, 0, 0), "-X": (-1, 0, 0), "+Y": (0, 1, 0), "-Y": (0, -1, 0),
        "+X+Y": (.7071, .7071, 0), "+X-Y": (.7071, -.7071, 0),
        "-X+Y": (-.7071, .7071, 0), "-X-Y": (-.7071, -.7071, 0)}


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mesh", required=True)
    p.add_argument("--color", required=True)
    p.add_argument("--concept", required=True)
    p.add_argument("--view", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--tile", type=int, default=520)
    p.add_argument("--samples", type=int, default=48)
    return p.parse_args(a)


def main():
    a = args()
    tile = a.tile
    out = Path(a.out).resolve()
    tmp = out.parent / "_p.png"

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(a.mesh).resolve()))
    obj = [o for o in bpy.data.objects if o.type == "MESH"][0]
    mat = bpy.data.materials.new("S")
    mat.use_nodes = True
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.6
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(Path(a.color).resolve()))
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    w = bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (.5, .5, .52, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.1

    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = a.samples
    s.render.resolution_x = s.render.resolution_y = tile
    s.render.film_transparent = True
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "Standard"

    centre = obj.matrix_world @ (sum((Vector(v) for v in obj.bound_box), Vector()) / 8.0)
    radius = max(obj.dimensions) * 0.5
    bpy.ops.object.camera_add()
    cam = bpy.context.view_layer.objects.active
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 2.4
    s.camera = cam

    def shot(d):
        d = Vector(d).normalized()
        cam.location = centre + d * radius * 6.0
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        s.render.filepath = str(tmp)
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(str(tmp))
        px = np.array(im.pixels[:], dtype=np.float32).reshape(tile, tile, 4)
        bpy.data.images.remove(im)
        al = px[:, :, 3:4]
        return px[:, :, :3] * al + BG * (1 - al)

    d = DIRS[a.view]
    tiles = []
    im = bpy.data.images.load(str(Path(a.concept).resolve()))
    im.scale(tile, tile)
    tiles.append(np.array(im.pixels[:], dtype=np.float32).reshape(tile, tile, 4)[:, :, :3])
    bpy.data.images.remove(im)
    tiles.append(shot(d))
    tiles.append(shot(tuple(-v for v in d)))
    tmp.unlink(missing_ok=True)

    sheet = np.concatenate(tiles, axis=1)
    rgba = np.concatenate([sheet, np.ones((*sheet.shape[:2], 1), np.float32)], axis=2)
    img = bpy.data.images.new("P", width=tile * 3, height=tile, alpha=True)
    img.pixels = rgba.reshape(-1).tolist()
    img.filepath_raw = str(out)
    img.file_format = "PNG"
    img.save()
    print("[pair] wrote {}".format(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
