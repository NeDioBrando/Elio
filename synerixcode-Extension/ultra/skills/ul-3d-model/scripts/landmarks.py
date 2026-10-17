"""Dump landmarks for a mesh with the head end STATED, not inferred.

make_paint_spec.py infers the head end from which 8% end-slice has the bigger
cross-section, then --head-end only overrides the FLAG at the end - the
nose_point, nose_z and head_z_range it already computed keep the inferred
answer. On three of this set's four animals the inference was wrong (the rump
out-bulks the head on a round sheep, exactly the cow case in the skill), so
those numbers pointed at the TAIL. This recomputes them from a stated end.

  blender --background --python landmarks.py -- --mesh <low.glb> --head-end min
"""
import argparse, json, sys
import bpy, numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
p = argparse.ArgumentParser()
p.add_argument("--mesh", required=True)
p.add_argument("--head-end", choices=["min", "max"], required=True)
p.add_argument("--bins", type=int, default=12)
args = p.parse_args(a)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.mesh)
ob = [o for o in bpy.data.objects if o.type == "MESH"][0]
co = np.array([ob.matrix_world @ v.co for v in ob.data.vertices], dtype=np.float64)
lo, hi = co.min(axis=0), co.max(axis=0)
span = np.where(hi - lo == 0, 1.0, hi - lo)
n = (co - lo) / span
up, body = 2, int(np.argmax([span[0], span[1]]))
width = 1 - body

# body coord with 0 = head, whichever end that is
nb = n[:, body] if args.head_end == "min" else 1.0 - n[:, body]

# THE ORIENTATION PROFILE. Bin along the body axis and report the cross-section
# of each bin, head end FIRST. Printed whole so somebody else can check the
# call instead of taking a verdict on trust.
prof = []
for i in range(args.bins):
    m = (nb >= i / args.bins) & (nb < (i + 1) / args.bins)
    if m.sum() < 3:
        prof.append([0.0, 0.0, int(m.sum())])
        continue
    s = n[m]
    prof.append([round(float(s[:, width].max() - s[:, width].min()), 3),
                 round(float(s[:, up].max() - s[:, up].min()), 3), int(m.sum())])

nose_i = int(np.argmin(nb))
head = n[nb < 0.22]
low = n[n[:, up] < 0.06]
ears = n[(n[:, up] > 0.88) & (nb < 0.35)]

out = {
    "mesh": args.mesh,
    "span_blender_xyz": [round(float(v), 4) for v in span],
    "body_axis": "xyz"[body], "width_axis": "xyz"[width], "up_axis": "z",
    "head_end": args.head_end,
    "profile_head_first_wid_hgt_n": prof,
    "nose_point_xyz": [round(float(v), 3) for v in n[nose_i]],
    "nose_z": round(float(n[nose_i, up]), 3),
    "nose_body": round(float(n[nose_i, body]), 3),
    "head_z_range": [round(float(head[:, up].min()), 3), round(float(head[:, up].max()), 3)],
    "head_width_range": [round(float(head[:, width].min()), 3), round(float(head[:, width].max()), 3)],
    "head_body_z_at_front10": None,
    "foot_body_range_headfirst": [round(float(nb[n[:, up] < 0.06].min()), 3),
                                  round(float(nb[n[:, up] < 0.06].max()), 3)] if len(low) else None,
    "ear_count": int(len(ears)),
    "ear_body_headfirst": round(float(np.median(nb[(n[:, up] > 0.88) & (nb < 0.35)])), 3) if len(ears) else None,
    "ear_z": round(float(np.median(ears[:, up])), 3) if len(ears) else None,
    "centroid_normalised": [round(float(v), 4) for v in n.mean(axis=0)],
}
f = nb < 0.10
if f.sum() > 3:
    out["head_body_z_at_front10"] = [round(float(n[f][:, up].min()), 3),
                                     round(float(n[f][:, up].max()), 3)]
print("LM " + json.dumps(out))
