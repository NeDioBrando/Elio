"""Per-height slice: how wide is the mesh and how far along the body does it
reach. Finds where legs stop and the body starts, which is the number a "legs"
band needs. Head-first body coords (0 = head).
"""
import argparse, json, sys
import bpy, numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
p = argparse.ArgumentParser()
p.add_argument("--mesh", required=True)
p.add_argument("--head-end", default="min")
args = p.parse_args(a)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.mesh)
ob = [o for o in bpy.data.objects if o.type == "MESH"][0]
co = np.array([ob.matrix_world @ v.co for v in ob.data.vertices], dtype=np.float64)
lo, hi = co.min(axis=0), co.max(axis=0)
span = np.where(hi - lo == 0, 1.0, hi - lo)
n = (co - lo) / span
body = int(np.argmax([span[0], span[1]])); width = 1 - body
nb = n[:, body] if args.head_end == "min" else 1.0 - n[:, body]
rows = []
for i in range(20):
    m = (n[:, 2] >= i / 20) & (n[:, 2] < (i + 1) / 20)
    if m.sum() < 3:
        rows.append({"z": round(i / 20, 2), "n": int(m.sum())}); continue
    s = n[m]
    rows.append({"z": round(i / 20, 2), "n": int(m.sum()),
                 "wid": round(float(s[:, width].max() - s[:, width].min()), 3),
                 "body_lo": round(float(nb[m].min()), 3),
                 "body_hi": round(float(nb[m].max()), 3)})
print("ZP " + json.dumps(rows))
