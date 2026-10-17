"""Measure, for a built prop, what fraction of the VISIBLE surface each paint
key actually occupies, and sample the atlas pixels against the spec hex.

Run:
  blender --background --python check_prop.py -- --glb <low.glb> --color <color.png>
          --palette '{"shaft":"#5B4632",...}' --out <sheet dir>

WHY. A material can be assigned to real faces, carry the right hex, and still be
painted on ZERO VISIBLE SURFACE because the geometry is buried inside another
part. Every count-based check passes in that state. So this casts rays inward
from a sphere of directions and reports which material the ray actually HITS.
"""
import argparse, json, math, os, sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True)
ap.add_argument("--color", required=True)
ap.add_argument("--palette", required=True)
args = ap.parse_args(argv)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=args.glb)
obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
assert len(obs) == 1, "expected ONE mesh object, got %d" % len(obs)
ob = obs[0]
me = ob.data
mats = [m.name for m in me.materials]

# world-space bbox
bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
centre = (lo + hi) / 2
radius = (hi - lo).length

# Fibonacci sphere of ray origins; each ray aimed at a jittered point in the bbox
N = 20000
hits = {}
miss = 0
ga = math.pi * (3.0 - math.sqrt(5.0))
import random
random.seed(7)
mw_inv = ob.matrix_world.inverted()
for i in range(N):
    y = 1 - (i / float(N - 1)) * 2
    r = math.sqrt(max(0.0, 1 - y * y))
    th = ga * i
    d = Vector((math.cos(th) * r, y, math.sin(th) * r))
    origin = centre + d * radius
    # aim at a random point inside the bbox so the whole body gets covered
    tgt = Vector((random.uniform(lo.x, hi.x),
                  random.uniform(lo.y, hi.y),
                  random.uniform(lo.z, hi.z)))
    direction = (tgt - origin).normalized()
    ok, loc, nrm, idx = ob.ray_cast(mw_inv @ origin, mw_inv.to_3x3() @ direction)
    if not ok:
        miss += 1
        continue
    mi = me.polygons[idx].material_index
    key = mats[mi] if mi < len(mats) else "?"
    hits[key] = hits.get(key, 0) + 1

total = sum(hits.values())
vis = {k: round(v / total, 4) for k, v in sorted(hits.items(), key=lambda kv: -kv[1])}

# ---- sample the atlas file's actual pixels against the spec hex ----
palette = json.loads(args.palette)
img = bpy.data.images.load(args.color)
w, h = img.size
px = list(img.pixels)  # linear floats 0..1 as Blender decodes an sRGB PNG


def raw_bytes_at(path, x, y):
    """Read the PNG's own sRGB bytes, bypassing Blender's colour management,
    because the failure this guards against is exactly a colour-space one."""
    import zlib, struct
    data = open(path, "rb").read()
    p, idat = 8, b""
    W = H = None
    while p < len(data):
        ln = struct.unpack(">I", data[p:p + 4])[0]
        tag = data[p + 4:p + 8]
        body = data[p + 8:p + 8 + ln]
        if tag == b"IHDR":
            W, H, bd, ct = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            idat += body
        p += 12 + ln
    raw = zlib.decompress(idat)
    nch = 3 if ct == 2 else 4
    stride = W * nch
    out = bytearray()
    prev = bytearray(stride)
    q = 0
    for row in range(H):
        f = raw[q]; q += 1
        line = bytearray(raw[q:q + stride]); q += stride
        for i in range(stride):
            a = line[i - nch] if i >= nch else 0
            b = prev[i]
            c = prev[i - nch] if i >= nch else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out.extend(line)
        prev = line
    off = (y * W + x) * nch
    return W, H, tuple(out[off:off + 3])


keys = list(palette)
grid = 4
sampled = {}
for i, k in enumerate(keys):
    cx, cy = i % grid, i // grid
    W, H, rgb = raw_bytes_at(args.color, int((cx + 0.5) * (256 // grid)),
                             int((cy + 0.5) * (256 // grid)))
    sampled[k] = {"spec": palette[k].upper(),
                  "file": "#%02X%02X%02X" % rgb,
                  "match": ("#%02X%02X%02X" % rgb).upper() == palette[k].upper()}

print("CHECK " + json.dumps({
    "materials": mats,
    "visible_fraction": vis,
    "rays": N, "rays_missed": miss,
    "atlas": sampled,
    "atlas_size": [W, H],
}))
