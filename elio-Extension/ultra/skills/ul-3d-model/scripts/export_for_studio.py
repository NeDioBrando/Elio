"""Stage 5-6 without an upload: pack a MeshPart for Studio to build in place.

    blender --background --python export_for_studio.py -- \\
        --mesh out/low.glb --color out/color.png --outdir serve --name pig

Writes serve/<name>.mesh.bin and serve/<name>.tex.bin, which a local HTTP server
hands to Studio. The plugin rebuilds the mesh through AssetService and needs NO
Open Cloud key, NO ROBLOSECURITY cookie and NO upload of any kind.

AXES. Blender is Z-up, Roblox is Y-up, so every position is rewritten
(x, y, z) -> (x, z, -y). Get this wrong and the animal lies on its side, which
looks like a rig problem and is not one.

COLOUR. Blender hands back LINEAR floats for an sRGB PNG, and Roblox wants sRGB
bytes, so the encode is applied on the way out. Verified by round-trip: the
bytes written here match the source PNG.

FORMAT, little endian, so Luau can buffer.fromstring the body and read it
directly with no base64 and no JSON parse:

  mesh.bin  u32 "RMSH"  u32 version  u32 nVerts  u32 nUVs  u32 nTris
            f32[nVerts*3]  positions, studs, Roblox axes
            f32[nUVs*2]    uv pairs
            u32[nTris*3]   vertex indices
            u32[nTris*3]   uv indices
  tex.bin   u32 "RTEX"  u32 size  u8[size*size*4] RGBA, sRGB
"""
from __future__ import annotations
import argparse, struct, sys
from pathlib import Path
import bpy, numpy as np


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--mesh", required=True)
    p.add_argument("--color")
    p.add_argument("--outdir", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--tex-size", type=int, default=1024)
    return p.parse_args(a)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def main():
    a = args()
    outdir = Path(a.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(a.mesh).resolve()))
    obj = [o for o in bpy.data.objects if o.type == "MESH"][0]
    me = obj.data
    me.calc_loop_triangles()

    nv = len(me.vertices)
    co = np.empty((nv, 3), np.float64)
    me.vertices.foreach_get("co", co.ravel())
    mw = np.array(obj.matrix_world.to_4x4())
    co = co @ mw[:3, :3].T + mw[:3, 3]
    # Blender Z-up -> Roblox Y-up
    pos = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
    pos = pos - (pos.min(axis=0) + pos.max(axis=0)) / 2.0   # centre on origin

    nl = len(me.loops)
    uv = np.empty((nl, 2), np.float64)
    me.uv_layers.active.data.foreach_get("uv", uv.ravel())

    nt = len(me.loop_triangles)
    tv = np.empty((nt, 3), np.int32)
    tl = np.empty((nt, 3), np.int32)
    me.loop_triangles.foreach_get("vertices", tv.ravel())
    me.loop_triangles.foreach_get("loops", tl.ravel())

    # dedupe UVs so the id space stays small
    quant = np.round(uv * 65535).astype(np.int64)
    _, first, inverse = np.unique(quant, axis=0, return_index=True, return_inverse=True)
    uniq_uv = uv[first]
    tri_uv = inverse[tl]

    # WINDING IS NOT FLIPPED, and that is deliberate. (x,y,z) -> (x,z,-y) has
    # determinant +1, so it is a ROTATION, not a reflection. Flipping the winding
    # "because an axis was negated" renders every face backwards: the mesh looks
    # hollow and see-through with dark patches, which reads as a texture alpha
    # bug and is not one.

    blob = bytearray()
    blob += struct.pack("<4sIIII", b"RMSH", 1, len(pos), len(uniq_uv), nt)
    blob += pos.astype("<f4").tobytes()
    blob += uniq_uv.astype("<f4").tobytes()
    blob += tv.astype("<u4").tobytes()
    blob += tri_uv.astype("<u4").tobytes()
    mesh_path = outdir / (a.name + ".mesh.bin")
    mesh_path.write_bytes(blob)

    size_studs = pos.max(axis=0) - pos.min(axis=0)
    print("[export] {} verts, {} uvs, {} tris -> {} ({:.0f} KB)".format(
        len(pos), len(uniq_uv), nt, mesh_path.name, len(blob) / 1024))
    print("[export] size in studs (Roblox axes X,Y,Z) = {}".format(
        [round(float(v), 3) for v in size_studs]))

    if a.color:
        n = a.tex_size
        im = bpy.data.images.load(str(Path(a.color).resolve()))
        im.scale(n, n)
        px = np.array(im.pixels[:], np.float32).reshape(n, n, 4)
        bpy.data.images.remove(im)
        # DO NOT FLIP THE ROWS. Blender's row 0 is the BOTTOM of the image and
        # Roblox's buffer row 0 is the TOP, but Roblox's UV v also runs from the
        # top while Blender's runs from the bottom. The two conventions cancel,
        # so writing Blender's array as-is samples identically. Flipping it
        # "to correct for bottom-up rows" sends every UV island into the gutter
        # and the model comes back covered in black blotches.
        rgb = (linear_to_srgb(px[:, :, :3]) * 255.0).round().astype(np.uint8)
        alpha = (np.clip(px[:, :, 3:4], 0, 1) * 255.0).round().astype(np.uint8)
        rgba = np.concatenate([rgb, alpha], axis=2)
        tex = bytearray()
        tex += struct.pack("<4sI", b"RTEX", n)
        tex += rgba.tobytes()
        tex_path = outdir / (a.name + ".tex.bin")
        tex_path.write_bytes(tex)
        print("[export] texture {}x{} -> {} ({:.0f} KB)".format(
            n, n, tex_path.name, len(tex) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
