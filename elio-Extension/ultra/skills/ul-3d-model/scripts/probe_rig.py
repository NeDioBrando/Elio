"""Report what is actually inside a rigged blend, before anything is built on it."""
import bpy, sys, json
argv = sys.argv[sys.argv.index("--") + 1:]
name = argv[0]
out = {"objects": [], "armature": None, "mesh": None}
for o in bpy.data.objects:
    out["objects"].append({"name": o.name, "type": o.type})
arm = bpy.data.objects.get(name + "_Arm")
mesh = bpy.data.objects.get(name)
if arm:
    out["armature"] = {
        "name": arm.name,
        "bones": [{"name": b.name,
                   "parent": b.parent.name if b.parent else None,
                   "head": list(b.head_local), "tail": list(b.tail_local),
                   "matrix": [list(r) for r in b.matrix_local]}
                  for b in arm.data.bones],
    }
if mesh:
    vgs = [g.name for g in mesh.vertex_groups]
    mods = [(m.name, m.type) for m in mesh.modifiers]
    mats = [m.name if m else None for m in mesh.data.materials]
    imgs = []
    for m in mesh.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    imgs.append(n.image.filepath)
    out["mesh"] = {"name": mesh.name, "verts": len(mesh.data.vertices),
                   "polys": len(mesh.data.polygons), "vertex_groups": vgs,
                   "modifiers": mods, "materials": mats, "images": imgs,
                   "uv_layers": [u.name for u in mesh.data.uv_layers]}
print("PROBE_JSON " + json.dumps(out))
