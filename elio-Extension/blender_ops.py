# Sent to Blender as execute_code. Tokens CMD / ARGS / OUT / MESH are filled by elio.
import bpy
import json
import math
import os
import traceback
from mathutils import Vector

CMD = """__ELIO_CMD__"""
ARGS = json.loads(r"""__ELIO_ARGS__""")
if not isinstance(ARGS, dict):
    ARGS = {}
OUT = __ELIO_OUT__
MESH = __ELIO_MESH__
if not OUT:
    OUT = "elio_status.json"
if not MESH:
    MESH = "elio_mesh.json"
result = None


def emit(payload):
    global result
    result = payload
    try:
        folder = os.path.dirname(OUT) if OUT else ""
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1)
    except Exception:
        pass
    try:
        slim = dict(payload)
        print("ELIO_MESH_JSON:" + json.dumps(slim, ensure_ascii=False, separators=(",", ":")), flush=True)
    except Exception:
        print("ELIO_MESH_JSON:{\"ok\":false}", flush=True)
    return payload


def view_override():
    wm = bpy.context.window_manager
    if not wm:
        return {}
    for win in wm.windows:
        screen = getattr(win, "screen", None)
        if not screen:
            continue
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            for region in area.regions:
                if region.type == "WINDOW":
                    return {"window": win, "screen": screen, "area": area, "region": region, "scene": bpy.context.scene}
    return {}


def run_op(op, **kwargs):
    # Decide context before execution. An operator may mutate and then raise.
    if op.poll():
        return op(**kwargs)
    override = view_override()
    if override:
        with bpy.context.temp_override(**override):
            if op.poll():
                return op(**kwargs)
    raise RuntimeError("Blender operator is unavailable in the current mode/context")


def ensure_object_mode():
    obj = bpy.context.view_layer.objects.active
    if obj is not None and getattr(obj, "mode", "OBJECT") != "OBJECT":
        if "FINISHED" not in run_op(bpy.ops.object.mode_set, mode="OBJECT"):
            raise RuntimeError("Blender could not leave edit mode")


def in_edit(objs, fn):
    select_only(objs)
    run_op(bpy.ops.object.mode_set, mode="EDIT")
    try:
        run_op(bpy.ops.mesh.select_all, action="SELECT")
        fn()
    finally:
        try:
            run_op(bpy.ops.object.mode_set, mode="OBJECT")
        except Exception:
            pass


def enable_io():
    for mod in (
        "io_scene_fbx",
        "bl_ext.blender_org.io_scene_fbx",
        "bl_ext.blender_org.fbx",
        "io_scene_obj",
        "bl_ext.blender_org.io_scene_obj",
    ):
        try:
            bpy.ops.preferences.addon_enable(module=mod)
        except Exception:
            pass


def default_dir():
    folder = os.path.join(os.path.expanduser("~"), "Documents", "elio")
    os.makedirs(folder, exist_ok=True)
    return folder


def as_list(v):
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        return [x for x in v if x is not None and str(x) != ""]
    return [v]


def resolve_objects(names):
    names = as_list(names)
    if names:
        out = []
        for n in names:
            o = bpy.data.objects.get(str(n))
            if o:
                out.append(o)
        return out
    sel = [o for o in bpy.context.selected_objects if o]
    if sel:
        return sel
    return [o for o in bpy.data.objects if o.type == "MESH"]


def named_elio_sel():
    return resolve_objects(ARGS.get("objects") or ([ARGS.get("name")] if ARGS.get("name") else None))


def select_only(objs):
    ensure_object_mode()
    try:
        run_op(bpy.ops.object.select_all, action="DESELECT")
    except Exception:
        for o in bpy.data.objects:
            try:
                o.select_set(False)
            except Exception:
                pass
    count = 0
    for o in objs:
        try:
            o.select_set(True)
            count += 1
        except Exception:
            pass
    if objs:
        try:
            bpy.context.view_layer.objects.active = objs[0]
        except Exception:
            pass
    return count


def vec3(key, default=(0.0, 0.0, 0.0)):
    v = ARGS.get(key)
    if v is None:
        return tuple(default)
    if isinstance(v, (int, float)):
        return (float(v), float(v), float(v))
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        return (float(v[0]), float(v[1]), float(v[2]))
    if isinstance(v, (list, tuple)) and len(v) == 1:
        f = float(v[0])
        return (f, f, f)
    return tuple(default)


def set_name(obj, name):
    if obj is not None and name:
        obj.name = str(name)
        if getattr(obj, "data", None) is not None and hasattr(obj.data, "name"):
            try:
                obj.data.name = str(name)
            except Exception:
                pass
    return obj.name if obj else None


def active():
    return bpy.context.view_layer.objects.active


def add_primitive(op_name, name, extra=None):
    loc = vec3("location", (0, 0, 0))
    kw = {"location": loc, **(extra or {})}
    rotation = ARGS.get("rotation_deg") or ARGS.get("rotation")
    rotation = (vec3("rotation_deg") if ARGS.get("rotation_deg") is not None else vec3("rotation")) if rotation is not None else None
    numeric = list(loc) + list(rotation or [])
    for value in kw.values():
        if isinstance(value, (int, float)):
            numeric.append(value)
    if any(not math.isfinite(float(value)) for value in numeric):
        raise ValueError("Primitive position, rotation and dimensions must be finite numbers")
    ensure_object_mode()
    before = {obj.as_pointer() for obj in bpy.data.objects}
    op = getattr(bpy.ops.mesh, op_name)
    outcome = run_op(op, **kw)
    obj = active()
    if "FINISHED" not in outcome or obj is None or obj.as_pointer() in before:
        raise RuntimeError("Blender did not create the requested primitive")
    set_name(obj, name or ARGS.get("name"))
    if rotation is not None:
        obj.rotation_euler = [math.radians(float(x)) for x in rotation] if ARGS.get("rotation_deg") is not None else rotation
    return emit({"ok": True, "name": obj.name, "type": "MESH", "location": list(loc)})


def dump_meshes(names):
    explicit = as_list(names)
    if explicit:
        missing = [str(name) for name in explicit if bpy.data.objects.get(str(name)) is None]
        if missing:
            raise ValueError("Requested objects were not found: " + ", ".join(missing))
    objects = [obj for obj in resolve_objects(names) if obj.type == "MESH" and obj.data]
    if not objects:
        raise ValueError("No requested mesh objects to transfer")
    if len(objects) > 128:
        raise ValueError("Transfer at most 128 mesh objects per request; none were omitted")
    graph = bpy.context.evaluated_depsgraph_get()
    output = []
    total_bytes = 0
    for obj in objects:
        evaluated = obj.evaluated_get(graph)
        try:
            mesh = evaluated.to_mesh()
            if mesh is None or not mesh.vertices:
                raise ValueError("Mesh has no vertices: " + obj.name)
            mesh.calc_loop_triangles()
            if len(mesh.vertices) > 60000 or len(mesh.loop_triangles) > 20000:
                raise ValueError("Mesh exceeds transfer limits (60,000 vertices / 20,000 triangles): " + obj.name)
            matrix = evaluated.matrix_world
            mirrored = matrix.to_3x3().determinant() < 0
            verts = []
            for vertex in mesh.vertices:
                point = matrix @ vertex.co
                coords = [float(point.x), float(point.z), float(-point.y)]
                if any(not math.isfinite(value) for value in coords):
                    raise ValueError("Mesh contains invalid coordinates: " + obj.name)
                verts.append(coords)
            faces, face_uvs, face_colors = [], [], []
            uv_layer = mesh.uv_layers.active
            for triangle in mesh.loop_triangles:
                indices, loops = list(triangle.vertices), list(triangle.loops)
                if mirrored:
                    indices[1], indices[2] = indices[2], indices[1]
                    loops[1], loops[2] = loops[2], loops[1]
                faces.append([int(index) for index in indices])
                if uv_layer:
                    uv = [[float(uv_layer.data[index].uv.x), 1-float(uv_layer.data[index].uv.y)] for index in loops]
                    if any(not math.isfinite(value) for pair in uv for value in pair):
                        raise ValueError("Mesh contains invalid UV coordinates: " + obj.name)
                    face_uvs.append(uv)
                material = mesh.materials[triangle.material_index] if triangle.material_index < len(mesh.materials) else None
                rgba = [float(value) for value in material.diffuse_color] if material else [0.7,0.7,0.7,1.0]
                if any(not math.isfinite(value) for value in rgba):
                    raise ValueError("Mesh contains invalid material colors: " + obj.name)
                face_colors.append(rgba)
            if not faces:
                raise ValueError("Mesh has no triangles: " + obj.name)
            entry = {"name": obj.name, "verts": verts, "faces": faces, "tris": len(faces), "face_colors": face_colors}
            if face_uvs:
                entry["face_uvs"] = face_uvs
            total_bytes += len(json.dumps(entry, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
            if total_bytes > 12000000:
                raise ValueError("Mesh transfer exceeds 12 MB; transfer fewer objects. No geometry was omitted.")
            output.append(entry)
        finally:
            evaluated.to_mesh_clear()
    return output


def write_mesh_file(meshes):
    if not MESH:
        return ""
    folder = os.path.dirname(MESH)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(MESH, "w", encoding="utf-8") as f:
        json.dump({"ok": True, "meshes": meshes}, f, ensure_ascii=False, indent=1)
    return MESH


def try_export_fbx(fp):
    enable_io()
    ensure_object_mode()
    kwargs_list = [
        dict(filepath=fp, use_selection=True, apply_scale_options="FBX_SCALE_UNITS",
             axis_forward="-Z", axis_up="Y", apply_unit_scale=True, add_leaf_bones=False,
             bake_space_transform=True),
        dict(filepath=fp, use_selection=True, path_mode="AUTO"),
        dict(filepath=fp),
    ]
    ops = []
    if hasattr(bpy.ops.wm, "fbx_export"):
        ops.append(bpy.ops.wm.fbx_export)
    if hasattr(bpy.ops.export_scene, "fbx"):
        ops.append(bpy.ops.export_scene.fbx)
    last = "FBX exporter not found — enable the FBX add-on in Blender Preferences"
    for op in ops:
        for kw in kwargs_list:
            try:
                ret = run_op(op, **kw)
                if os.path.isfile(fp) and os.path.getsize(fp) > 0:
                    return True, None
                last = "FBX operator returned %s and wrote no file" % (ret,)
            except TypeError:
                continue
            except Exception as e:
                last = str(e)
    return False, last


def try_import_fbx(fp):
    enable_io()
    ensure_object_mode()
    ops = []
    if hasattr(bpy.ops.wm, "fbx_import"):
        ops.append(bpy.ops.wm.fbx_import)
    if hasattr(bpy.ops.import_scene, "fbx"):
        ops.append(bpy.ops.import_scene.fbx)
    last = "FBX importer not found — enable the FBX add-on in Blender Preferences"
    for op in ops:
        for kw in (dict(filepath=fp, automatic_bone_orientation=True), dict(filepath=fp)):
            try:
                run_op(op, **kw)
                return True, None
            except TypeError:
                continue
            except Exception as e:
                last = str(e)
    return False, last


def try_export_obj(fp):
    enable_io()
    ensure_object_mode()
    ops = []
    if hasattr(bpy.ops.wm, "obj_export"):
        ops.append(bpy.ops.wm.obj_export)
    if hasattr(bpy.ops.export_scene, "obj"):
        ops.append(bpy.ops.export_scene.obj)
    last = "OBJ exporter not found"
    for op in ops:
        for kw in (dict(filepath=fp, export_selected_objects=True), dict(filepath=fp, use_selection=True), dict(filepath=fp)):
            try:
                run_op(op, **kw)
                if os.path.isfile(fp):
                    return True, None
                last = "OBJ wrote no file"
            except TypeError:
                continue
            except Exception as e:
                last = str(e)
    return False, last


def try_import_obj(fp):
    enable_io()
    ensure_object_mode()
    ops = []
    if hasattr(bpy.ops.wm, "obj_import"):
        ops.append(bpy.ops.wm.obj_import)
    if hasattr(bpy.ops.import_scene, "obj"):
        ops.append(bpy.ops.import_scene.obj)
    last = "OBJ importer not found"
    for op in ops:
        try:
            run_op(op, filepath=fp)
            return True, None
        except Exception as e:
            last = str(e)
    return False, last


def cmd_export_fbx():
    fp = str(ARGS.get("filepath") or ARGS.get("path") or "").strip()
    if not fp:
        fp = os.path.join(default_dir(), "elio_export.fbx")
    if not fp.lower().endswith(".fbx"):
        fp += ".fbx"
    folder = os.path.dirname(fp)
    if folder:
        os.makedirs(folder, exist_ok=True)
    names = ARGS.get("objects")
    objs = resolve_objects(names)
    n = select_only(objs)
    if n == 0:
        return emit({"ok": False, "error": "no mesh objects to export", "filepath": fp})
    try:
        run_op(bpy.ops.object.transform_apply, location=False, rotation=True, scale=True)
    except Exception:
        pass
    ok, err = try_export_fbx(fp)
    meshes = dump_meshes(names)
    mesh_path = write_mesh_file(meshes) if meshes else ""
    if not ok:
        return emit({
            "ok": True,
            "filepath": fp if os.path.isfile(fp) else "",
            "file_error": err,
            "objects": [m["name"] for m in meshes],
            "mesh_count": len(meshes),
            "mesh_file": mesh_path,
            "meshes": meshes,
            "note": "FBX file was not written, but meshes were dumped for Studio.",
        })
    return emit({
        "ok": True,
        "filepath": fp,
        "bytes": os.path.getsize(fp) if os.path.isfile(fp) else 0,
        "objects": [m["name"] for m in meshes],
        "mesh_count": len(meshes),
        "mesh_file": mesh_path,
        "meshes": meshes,
    })


def cmd_import_fbx():
    fp = str(ARGS.get("filepath") or ARGS.get("path") or ARGS.get("asset") or "").strip()
    if not fp:
        fp = os.path.join(default_dir(), "elio_export.fbx")
    if not os.path.isfile(fp):
        return emit({"ok": False, "error": "FBX not found: " + fp, "filepath": fp})
    before = set(bpy.data.objects.keys())
    ok, err = try_import_fbx(fp)
    if not ok:
        return emit({"ok": False, "error": err, "filepath": fp})
    added = [k for k in bpy.data.objects.keys() if k not in before]
    return emit({"ok": True, "filepath": fp, "imported": added})


def cmd_export_obj():
    fp = str(ARGS.get("filepath") or ARGS.get("path") or "").strip() or os.path.join(default_dir(), "or_export.obj")
    if not fp.lower().endswith(".obj"):
        fp += ".obj"
    os.makedirs(os.path.dirname(fp) or ".", exist_ok=True)
    select_only(resolve_objects(ARGS.get("objects")))
    ok, err = try_export_obj(fp)
    if not ok:
        return emit({"ok": False, "error": err, "filepath": fp})
    return emit({"ok": True, "filepath": fp, "bytes": os.path.getsize(fp) if os.path.isfile(fp) else 0})


def cmd_import_obj():
    fp = str(ARGS.get("filepath") or ARGS.get("path") or "").strip()
    if not fp or not os.path.isfile(fp):
        return emit({"ok": False, "error": "OBJ not found: " + (fp or "(empty)")})
    before = set(bpy.data.objects.keys())
    ok, err = try_import_obj(fp)
    if not ok:
        return emit({"ok": False, "error": err})
    added = [k for k in bpy.data.objects.keys() if k not in before]
    return emit({"ok": True, "filepath": fp, "imported": added})


def cmd_dump():
    names = ARGS.get("objects")
    meshes = dump_meshes(names)
    if not meshes:
        return emit({"ok": False, "error": "no mesh objects in the Blender scene"})
    mesh_path = write_mesh_file(meshes)
    return emit({
        "ok": True,
        "objects": [m["name"] for m in meshes],
        "mesh_count": len(meshes),
        "mesh_file": mesh_path,
        "meshes": meshes,
        "tris": sum(m["tris"] for m in meshes),
    })


def cmd_group():
    ensure_object_mode()
    name = str(ARGS.get("name") or "Group")
    objs = resolve_objects(ARGS.get("objects"))
    if not objs:
        return emit({"ok": False, "error": "no objects to group"})
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if coll.name not in bpy.context.scene.collection.children:
        try:
            bpy.context.scene.collection.children.link(coll)
        except Exception:
            pass
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    try:
        coll.objects.link(empty)
    except Exception:
        bpy.context.scene.collection.objects.link(empty)
    for o in objs:
        try:
            mw = o.matrix_world.copy()
            o.parent = empty
            o.matrix_world = mw
        except Exception:
            pass
        if o.name not in coll.objects:
            try:
                coll.objects.link(o)
            except Exception:
                pass
    select_only([empty] + objs)
    return emit({"ok": True, "group": empty.name, "collection": coll.name, "objects": [o.name for o in objs]})


def cmd_ungroup():
    ensure_object_mode()
    name = str(ARGS.get("name") or "")
    empty = bpy.data.objects.get(name) if name else active()
    if empty is None:
        return emit({"ok": False, "error": "no group empty to ungroup"})
    children = list(empty.children)
    for c in children:
        mw = c.matrix_world.copy()
        c.parent = None
        c.matrix_world = mw
    coll = bpy.data.collections.get(empty.name)
    if coll:
        try:
            bpy.context.scene.collection.children.unlink(coll)
        except Exception:
            pass
    try:
        bpy.data.objects.remove(empty, do_unlink=True)
    except Exception:
        pass
    return emit({"ok": True, "ungrouped": [c.name for c in children]})


def cmd_parent():
    ensure_object_mode()
    parent_name = str(ARGS.get("parent") or ARGS.get("name") or "")
    parent = bpy.data.objects.get(parent_name)
    objs = resolve_objects(ARGS.get("objects"))
    if parent is None or not objs:
        return emit({"ok": False, "error": "parent and objects are required"})
    linked = []
    keep = bool(ARGS.get("keep_transform", True))
    for o in objs:
        if o == parent:
            continue
        mw = o.matrix_world.copy() if keep else None
        o.parent = parent
        if keep:
            o.matrix_world = mw
        linked.append(o.name)
    return emit({"ok": True, "parent": parent.name, "objects": linked})


def cmd_unparent():
    objs = named_elio_sel()
    names = []
    for o in objs:
        if o.parent:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
            names.append(o.name)
    return emit({"ok": True, "objects": names})


def cmd_join():
    ensure_object_mode()
    objs = resolve_objects(ARGS.get("objects"))
    meshes = [o for o in objs if o.type == "MESH"]
    if len(meshes) < 2:
        return emit({"ok": False, "error": "join needs at least two mesh objects"})
    select_only(meshes)
    run_op(bpy.ops.object.join)
    obj = active()
    if ARGS.get("name") and obj:
        set_name(obj, ARGS.get("name"))
    return emit({"ok": True, "name": obj.name if obj else "", "joined": [o.name for o in meshes]})


def cmd_move_to_collection():
    name = str(ARGS.get("collection") or ARGS.get("name") or "Collection")
    objs = named_elio_sel()
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if coll.name not in bpy.context.scene.collection.children:
        try:
            bpy.context.scene.collection.children.link(coll)
        except Exception:
            pass
    moved = []
    for o in objs:
        if o.name not in coll.objects:
            try:
                coll.objects.link(o)
                moved.append(o.name)
            except Exception:
                pass
    return emit({"ok": True, "collection": coll.name, "objects": moved})


def cmd_list_collections():
    cols = []
    for c in bpy.data.collections:
        cols.append({"name": c.name, "objects": [o.name for o in c.objects]})
    return emit({"ok": True, "collections": cols})


def cmd_list_objects():
    items = []
    for o in bpy.data.objects:
        items.append({
            "name": o.name, "type": o.type,
            "location": [round(x, 4) for x in o.location],
            "rotation_deg": [round(math.degrees(x), 2) for x in o.rotation_euler],
            "scale": [round(x, 4) for x in o.scale],
            "dimensions": [round(x, 4) for x in o.dimensions] if hasattr(o, "dimensions") else None,
            "hide": bool(o.hide_get()) if hasattr(o, "hide_get") else bool(o.hide_viewport),
            "parent": o.parent.name if o.parent else None,
            "collections": [c.name for c in o.users_collection],
        })
    return emit({"ok": True, "objects": items, "selected": [o.name for o in bpy.context.selected_objects]})


def cmd_delete():
    ensure_object_mode()
    objs = named_elio_sel()
    names = [o.name for o in objs]
    select_only(objs)
    try:
        run_op(bpy.ops.object.delete)
    except Exception:
        for o in objs:
            try:
                bpy.data.objects.remove(o, do_unlink=True)
            except Exception:
                pass
    return emit({"ok": True, "deleted": names})


def cmd_duplicate():
    ensure_object_mode()
    objs = named_elio_sel()
    if not objs:
        return emit({"ok": False, "error": "nothing to duplicate"})
    select_only(objs)
    run_op(bpy.ops.object.duplicate)
    created = list(bpy.context.selected_objects)
    offset = ARGS.get("offset") or ARGS.get("location")
    if offset is not None:
        off = vec3("offset", vec3("location", (0, 0, 0)))
        for o in created:
            o.location = Vector(o.location) + Vector(off)
    if ARGS.get("name") and created:
        set_name(created[0], ARGS.get("name"))
    return emit({"ok": True, "objects": [o.name for o in created]})


def cmd_rename():
    obj = bpy.data.objects.get(str(ARGS.get("name") or ARGS.get("object") or "")) or active()
    new = str(ARGS.get("new_name") or ARGS.get("to") or "")
    if obj is None or not new:
        return emit({"ok": False, "error": "name and new_name are required"})
    old = obj.name
    set_name(obj, new)
    return emit({"ok": True, "from": old, "to": obj.name})


def cmd_select():
    objs = named_elio_sel()
    n = select_only(objs)
    return emit({"ok": True, "selected": [o.name for o in objs], "count": n})


def cmd_select_all():
    ensure_object_mode()
    run_op(bpy.ops.object.select_all, action="SELECT")
    return emit({"ok": True, "selected": [o.name for o in bpy.context.selected_objects]})


def cmd_deselect():
    ensure_object_mode()
    run_op(bpy.ops.object.select_all, action="DESELECT")
    return emit({"ok": True, "selected": []})


def cmd_invert_selection():
    ensure_object_mode()
    run_op(bpy.ops.object.select_all, action="INVERT")
    return emit({"ok": True, "selected": [o.name for o in bpy.context.selected_objects]})


def cmd_select_children():
    objs = named_elio_sel()
    kids = []
    for o in objs:
        kids.extend(list(o.children_recursive) if hasattr(o, "children_recursive") else list(o.children))
    select_only(kids or objs)
    return emit({"ok": True, "selected": [o.name for o in (kids or objs)]})


def cmd_get_selection():
    sel = list(bpy.context.selected_objects)
    act = active()
    return emit({"ok": True, "selected": [o.name for o in sel], "active": act.name if act else None})


def cmd_transform():
    ensure_object_mode()
    objs = named_elio_sel()
    if not objs:
        return emit({"ok": False, "error": "no objects to transform"})
    loc = ARGS.get("location")
    rot = ARGS.get("rotation")
    rot_deg = ARGS.get("rotation_deg") or ARGS.get("degrees")
    sca = ARGS.get("scale")
    dim = ARGS.get("dimensions") or ARGS.get("size")
    changed = []
    for o in objs:
        if loc is not None:
            o.location = vec3("location", tuple(o.location))
        if rot_deg is not None:
            d = vec3("rotation_deg", vec3("degrees"))
            o.rotation_euler = [math.radians(x) for x in d]
        elif rot is not None:
            o.rotation_euler = vec3("rotation", tuple(o.rotation_euler))
        if sca is not None:
            if isinstance(sca, (int, float)):
                o.scale = (float(sca), float(sca), float(sca))
            else:
                o.scale = vec3("scale", tuple(o.scale))
        if dim is not None and hasattr(o, "dimensions"):
            if isinstance(dim, (int, float)):
                o.dimensions = (float(dim), float(dim), float(dim))
            else:
                o.dimensions = Vector(vec3("dimensions", vec3("size", tuple(o.dimensions))))
        changed.append(o.name)
    return emit({"ok": True, "objects": changed})


def cmd_translate():
    ensure_object_mode()
    objs = named_elio_sel()
    off = vec3("offset", vec3("location", (0, 0, 0)))
    for o in objs:
        o.location = Vector(o.location) + Vector(off)
    return emit({"ok": True, "objects": [o.name for o in objs], "offset": list(off)})


def cmd_rotate_deg():
    ensure_object_mode()
    objs = named_elio_sel()
    d = vec3("rotation_deg", vec3("degrees", (0, 0, 0)))
    add = bool(ARGS.get("add", False))
    for o in objs:
        rad = [math.radians(x) for x in d]
        if add:
            o.rotation_euler = [a + b for a, b in zip(list(o.rotation_euler), rad)]
        else:
            o.rotation_euler = rad
    return emit({"ok": True, "objects": [o.name for o in objs], "rotation_deg": list(d)})


def cmd_set_dimensions():
    ensure_object_mode()
    objs = named_elio_sel()
    dim = ARGS.get("dimensions") or ARGS.get("size")
    if dim is None:
        return emit({"ok": False, "error": "dimensions [x,y,z] required"})
    for o in objs:
        if isinstance(dim, (int, float)):
            o.dimensions = (float(dim), float(dim), float(dim))
        else:
            o.dimensions = Vector(vec3("dimensions", vec3("size")))
    return emit({"ok": True, "objects": [o.name for o in objs], "dimensions": [list(o.dimensions) for o in objs]})


def cmd_apply_transforms():
    ensure_object_mode()
    objs = named_elio_sel()
    select_only(objs)
    run_op(bpy.ops.object.transform_apply, location=bool(ARGS.get("location", False)),
           rotation=bool(ARGS.get("rotation", True)), scale=bool(ARGS.get("scale", True)))
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_set_origin():
    ensure_object_mode()
    objs = named_elio_sel()
    select_only(objs)
    kind = str(ARGS.get("type") or "ORIGIN_GEOMETRY")
    run_op(bpy.ops.object.origin_set, type=kind)
    return emit({"ok": True, "objects": [o.name for o in objs], "type": kind})


def cmd_origin_to_bottom():
    ensure_object_mode()
    objs = named_elio_sel()
    done = []
    scene = bpy.context.scene
    for obj in objs:
        if obj.type != "MESH" or obj.data is None or len(obj.data.vertices) == 0:
            continue
        mw = obj.matrix_world
        world = [mw @ v.co for v in obj.data.vertices]
        min_z = min(c.z for c in world)
        mid_x = (min(c.x for c in world) + max(c.x for c in world)) / 2.0
        mid_y = (min(c.y for c in world) + max(c.y for c in world)) / 2.0
        scene.cursor.location = (mid_x, mid_y, min_z)
        select_only([obj])
        run_op(bpy.ops.object.origin_set, type="ORIGIN_CURSOR")
        done.append(obj.name)
    return emit({"ok": True, "objects": done})


def cmd_drop_to_ground():
    ensure_object_mode()
    objs = named_elio_sel()
    done = []
    for obj in objs:
        if obj.type != "MESH" or obj.data is None or len(obj.data.vertices) == 0:
            obj.location.z = 0
            done.append(obj.name)
            continue
        mw = obj.matrix_world
        min_z = min((mw @ v.co).z for v in obj.data.vertices)
        obj.location.z -= min_z
        done.append(obj.name)
    return emit({"ok": True, "objects": done})


def cmd_center():
    ensure_object_mode()
    objs = named_elio_sel()
    for o in objs:
        o.location = (0.0, 0.0, 0.0)
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_snap_to_grid():
    ensure_object_mode()
    objs = named_elio_sel()
    step = float(ARGS.get("step") or 1)
    for o in objs:
        o.location = Vector((round(o.location.x / step) * step, round(o.location.y / step) * step, round(o.location.z / step) * step))
    return emit({"ok": True, "objects": [o.name for o in objs], "step": step})


def cmd_shade_smooth():
    ensure_object_mode()
    objs = named_elio_sel()
    select_only(objs)
    try:
        run_op(bpy.ops.object.shade_smooth)
    except Exception:
        for o in objs:
            if o.type == "MESH":
                for p in o.data.polygons:
                    p.use_smooth = True
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_shade_flat():
    ensure_object_mode()
    objs = named_elio_sel()
    select_only(objs)
    try:
        run_op(bpy.ops.object.shade_flat)
    except Exception:
        for o in objs:
            if o.type == "MESH":
                for p in o.data.polygons:
                    p.use_smooth = False
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_set_material():
    name = str(ARGS.get("name") or ARGS.get("object") or "")
    objs = named_elio_sel() if not name else [bpy.data.objects.get(name) or active()]
    objs = [o for o in objs if o is not None]
    if not objs:
        return emit({"ok": False, "error": "mesh object required"})
    mat_name = str(ARGS.get("material") or ((objs[0].name if objs else "elio") + "_Mat"))
    color = ARGS.get("color") or ARGS.get("rgb") or [0.8, 0.8, 0.8, 1]
    if len(color) == 3:
        color = list(color) + [1]
    mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = tuple(float(c) for c in color[:4])
    assigned = []
    for obj in objs:
        if obj.type != "MESH":
            continue
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)
        assigned.append(obj.name)
    return emit({"ok": True, "objects": assigned, "material": mat.name, "color": color})


# ── materials ───────────────────────────────────────────────────────────────
# Node-based material toolkit (create / preset / assign / set / inspect / list /
# remove / procedural texture / image maps / PBR maps).
#
# VERSION SAFETY: the Principled BSDF input NAMES were renamed in Blender 4.0
# ("Specular" -> "Specular IOR Level", "Transmission" -> "Transmission Weight",
# "Emission" -> "Emission Color", "Clearcoat" -> "Coat Weight", "Sheen" ->
# "Sheen Weight", "Subsurface" -> "Subsurface Weight"), and 4.1 removed the
# Musgrave texture while 4.2 removed blend_method/shadow_method. Every write
# below goes through a helper that tries the modern name, then the legacy one,
# and reports what it actually set - so the same call works on 3.x, 4.0-4.1 and
# 4.2+, and an unsupported property is a no-op instead of an exception.

_BSDF_NAMES = {
    "base_color": ("Base Color",),
    "metallic": ("Metallic",),
    "roughness": ("Roughness",),
    "specular": ("Specular IOR Level", "Specular"),
    "specular_tint": ("Specular Tint",),
    "ior": ("IOR",),
    "transmission": ("Transmission Weight", "Transmission"),
    "alpha": ("Alpha",),
    "emission": ("Emission Color", "Emission"),
    "emission_strength": ("Emission Strength",),
    "coat": ("Coat Weight", "Clearcoat"),
    "coat_roughness": ("Coat Roughness", "Clearcoat Roughness"),
    "sheen": ("Sheen Weight", "Sheen"),
    "anisotropic": ("Anisotropic",),
    "subsurface": ("Subsurface Weight", "Subsurface"),
}

MATERIAL_PRESETS = {
    "metal": {"color": [0.55, 0.56, 0.58], "metallic": 1.0, "roughness": 0.28},
    "steel": {"color": [0.42, 0.44, 0.47], "metallic": 1.0, "roughness": 0.35},
    "iron": {"color": [0.32, 0.31, 0.3], "metallic": 1.0, "roughness": 0.5},
    "chrome": {"color": [0.9, 0.92, 0.95], "metallic": 1.0, "roughness": 0.05},
    "gold": {"color": [1.0, 0.77, 0.34], "metallic": 1.0, "roughness": 0.2},
    "silver": {"color": [0.95, 0.95, 0.96], "metallic": 1.0, "roughness": 0.15},
    "copper": {"color": [0.95, 0.64, 0.54], "metallic": 1.0, "roughness": 0.25},
    "bronze": {"color": [0.8, 0.55, 0.32], "metallic": 1.0, "roughness": 0.35},
    "brass": {"color": [0.88, 0.72, 0.36], "metallic": 1.0, "roughness": 0.3},
    "plastic": {"color": [0.8, 0.8, 0.82], "metallic": 0.0, "roughness": 0.4},
    "rubber": {"color": [0.05, 0.05, 0.06], "metallic": 0.0, "roughness": 0.9},
    "ceramic": {"color": [0.92, 0.92, 0.9], "metallic": 0.0, "roughness": 0.15, "coat": 0.4},
    "concrete": {"color": [0.5, 0.5, 0.48], "roughness": 0.95, "noise": {"type": "noise", "scale": 18, "affect": "bump", "strength": 0.25}},
    "asphalt": {"color": [0.12, 0.12, 0.13], "roughness": 0.85, "noise": {"type": "noise", "scale": 30, "affect": "bump", "strength": 0.2}},
    "wood": {"color": [0.45, 0.28, 0.14], "roughness": 0.7,
             "noise": {"type": "wave", "scale": 6, "affect": "bump", "strength": 0.35, "distortion": 8}},
    "marble": {"color": [0.9, 0.9, 0.88], "roughness": 0.25,
               "noise": {"type": "voronoi", "scale": 8, "affect": "bump", "strength": 0.15}},
    "fabric": {"color": [0.35, 0.33, 0.4], "roughness": 0.95, "sheen": 0.5},
    "leather": {"color": [0.22, 0.16, 0.12], "roughness": 0.75,
                "noise": {"type": "noise", "scale": 40, "affect": "bump", "strength": 0.3}},
    "glass": {"color": [0.95, 0.98, 1.0], "transmission": 1.0, "roughness": 0.02, "ior": 1.45, "alpha": 0.2, "blend": "BLEND"},
    "frosted_glass": {"color": [0.94, 0.97, 1.0], "transmission": 1.0, "roughness": 0.35, "ior": 1.45, "alpha": 0.35, "blend": "BLEND"},
    "water": {"color": [0.1, 0.35, 0.6], "transmission": 0.9, "roughness": 0.05, "ior": 1.33, "alpha": 0.4, "blend": "BLEND"},
    "ice": {"color": [0.75, 0.9, 1.0], "transmission": 0.85, "roughness": 0.12, "ior": 1.31, "alpha": 0.45,
            "blend": "BLEND", "noise": {"type": "voronoi", "scale": 12, "affect": "bump", "strength": 0.2}},
    "emissive": {"color": [1.0, 0.9, 0.6], "emission": [1.0, 0.9, 0.6], "emission_strength": 5.0},
    "neon": {"color": [0.2, 1.0, 0.9], "emission": [0.2, 1.0, 0.9], "emission_strength": 8.0},
    "lava": {"color": [1.0, 0.25, 0.05], "emission": [1.0, 0.18, 0.02], "emission_strength": 10.0, "roughness": 0.6,
             "noise": {"type": "voronoi", "scale": 10, "affect": "emission", "strength": 3.0}},
    "hologram": {"color": [0.3, 0.9, 1.0], "emission": [0.3, 0.9, 1.0], "emission_strength": 3.0,
                 "alpha": 0.35, "transmission": 0.5, "roughness": 0.1, "blend": "BLEND"},
    "ghost": {"color": [0.85, 0.9, 1.0], "alpha": 0.35, "roughness": 0.5, "blend": "BLEND"},
    "toon": {"color": [0.9, 0.5, 0.2], "roughness": 1.0, "specular": 0.0},
    "roblox_plastic": {"color": [0.64, 0.64, 0.64], "metallic": 0.0, "roughness": 0.45},
    "roblox_metal": {"color": [0.55, 0.55, 0.58], "metallic": 0.85, "roughness": 0.3},
    "roblox_glass": {"color": [0.9, 0.95, 1.0], "alpha": 0.4, "roughness": 0.05, "blend": "BLEND", "transmission": 0.7},
}

_ELIO_PREFIX = "ELIO_"


def _color(v, default=(0.8, 0.8, 0.8, 1.0)):
    """Accept [r,g,b(,a)] in 0-1, [r,g,b] in 0-255, or '#rrggbb'."""
    if v is None:
        return list(default)
    if isinstance(v, str):
        s = v.strip().lstrip("#")
        if len(s) == 6:
            try:
                return [int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0, 1.0]
            except Exception:
                return list(default)
        return list(default)
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        c = [float(x) for x in v[:3]]
        if max(c) > 1.0:  # 0-255 given
            c = [x / 255.0 for x in c]
        a = float(v[3]) if len(v) > 3 else 1.0
        return [c[0], c[1], c[2], a]
    return list(default)


def _principled(mat):
    """The material's Principled BSDF (created and wired up if missing)."""
    tree = mat.node_tree
    for n in tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    out = None
    for n in tree.nodes:
        if n.type == "OUTPUT_MATERIAL":
            out = n
            break
    node = tree.nodes.new("ShaderNodeBsdfPrincipled")
    node.location = (0, 0)
    if out is None:
        out = tree.nodes.new("ShaderNodeOutputMaterial")
        out.location = (320, 0)
    try:
        tree.links.new(node.outputs[0], out.inputs["Surface"])
    except Exception:
        pass
    return node


def _set_in(bsdf, key, value):
    """Write a Principled input by ROLE, tolerating the 4.0 renames."""
    if value is None:
        return None
    for nm in _BSDF_NAMES.get(key, ()):
        sock = bsdf.inputs.get(nm)
        if sock is None:
            continue
        attempts = [value]
        if isinstance(value, (list, tuple)):
            attempts = [tuple(value), value]
        for attempt in attempts:
            try:
                sock.default_value = attempt
                return nm
            except Exception:
                continue
    return None


def _set_node_input(node, name, value):
    if value is None:
        return False
    sock = node.inputs.get(name)
    if sock is None:
        return False
    attempts = [value]
    if isinstance(value, (list, tuple)):
        attempts = [tuple(value), value]
    for attempt in attempts:
        try:
            sock.default_value = attempt
            return True
        except Exception:
            continue
    return False


def _blend_mode(mat, mode):
    """Transparency/blend handling across 4.2+ (surface_render_method) and <=4.1."""
    m = str(mode or "").upper()
    applied = {}
    if not m:
        return applied
    want = {"BLEND": "BLENDED", "BLENDED": "BLENDED", "ALPHA": "BLENDED", "TRANSPARENT": "BLENDED",
            "HASHED": "DITHERED", "DITHERED": "DITHERED", "OPAQUE": "DITHERED"}.get(m)
    if want and hasattr(mat, "surface_render_method"):
        try:
            mat.surface_render_method = want
            applied["surface_render_method"] = want
        except Exception:
            pass
    if hasattr(mat, "blend_method"):
        legacy = {"BLENDED": "BLEND", "DITHERED": "OPAQUE"}.get(want, "OPAQUE")
        if m in ("OPAQUE", "SOLID"):
            legacy = "OPAQUE"
        try:
            mat.blend_method = legacy
            applied["blend_method"] = legacy
        except Exception:
            pass
        if hasattr(mat, "shadow_method"):
            try:
                mat.shadow_method = "NONE" if legacy == "BLEND" else "OPAQUE"
                applied["shadow_method"] = mat.shadow_method
            except Exception:
                pass
    try:
        if m in ("BLEND", "BLENDED", "ALPHA", "TRANSPARENT", "HASHED"):
            mat.use_backface_culling = bool(ARGS.get("backface_culling", False))
    except Exception:
        pass
    return applied


def _purge_elio_nodes(mat):
    """Remove the nodes a previous elio texture call added (idempotent restyle)."""
    tree = mat.node_tree
    doomed = [n for n in tree.nodes if str(n.name).startswith(_ELIO_PREFIX)]
    for n in doomed:
        try:
            tree.nodes.remove(n)
        except Exception:
            pass
    return len(doomed)


def _find_material():
    name = str(ARGS.get("material") or ARGS.get("material_name") or "").strip()
    if name:
        return bpy.data.materials.get(name)
    obj = bpy.data.objects.get(str(ARGS.get("name") or ARGS.get("object") or "")) or active()
    if obj is not None and getattr(obj, "data", None) is not None and getattr(obj.data, "materials", None):
        return obj.data.materials[0] if len(obj.data.materials) else None
    if bpy.context.object and bpy.context.object.active_material:
        return bpy.context.object.active_material
    return None


def _target_objects():
    names = ARGS.get("objects") or ARGS.get("targets")
    if names:
        return [o for o in resolve_objects(as_list(names)) if o is not None]
    one = str(ARGS.get("name") or ARGS.get("object") or "").strip()
    if one:
        return [o for o in [bpy.data.objects.get(one)] if o is not None]
    return [o for o in named_elio_sel() if o is not None]


def _tex_node(mat, kind, params):
    """Create a procedural texture node of `kind` (4.x-safe; no Musgrave)."""
    tree = mat.node_tree
    k = str(kind or "noise").lower()
    if k in ("musgrave", "noise", "fbm"):
        node = tree.nodes.new("ShaderNodeTexNoise")       # Musgrave folded into Noise in 4.1
    elif k in ("voronoi", "cells"):
        node = tree.nodes.new("ShaderNodeTexVoronoi")
    elif k in ("wave", "wood", "rings"):
        node = tree.nodes.new("ShaderNodeTexWave")
    elif k in ("checker", "checkerboard"):
        node = tree.nodes.new("ShaderNodeTexChecker")
    elif k in ("brick", "bricks"):
        node = tree.nodes.new("ShaderNodeTexBrick")
    elif k in ("gradient", "ramp"):
        node = tree.nodes.new("ShaderNodeTexGradient")
    else:
        return None
    node.name = _ELIO_PREFIX + k
    node.label = "elio " + k
    node.location = (-620, -180)
    for key, sock in (("scale", "Scale"), ("detail", "Detail"), ("roughness", "Roughness"),
                      ("distortion", "Distortion"), ("randomness", "Randomness"),
                      ("size", "Scale"), ("fac", "Scale")):
        if ARGS.get(key) is not None:
            _set_node_input(node, sock, float(ARGS.get(key)))
    if k in ("wave", "wood", "rings"):
        _set_node_input(node, "Scale", float(ARGS.get("scale") or 5))
    if k in ("checker", "checkerboard"):
        _set_node_input(node, "Color1", _color(ARGS.get("color_a"), (0.05, 0.05, 0.05, 1)))
        _set_node_input(node, "Color2", _color(ARGS.get("color_b"), (0.9, 0.9, 0.9, 1)))
    if k in ("brick", "bricks"):
        _set_node_input(node, "Color1", _color(ARGS.get("color_a"), (0.4, 0.15, 0.12, 1)))
        _set_node_input(node, "Color2", _color(ARGS.get("color_b"), (0.75, 0.72, 0.68, 1)))
        _set_node_input(node, "Mortar", _color(ARGS.get("mortar"), (0.75, 0.75, 0.72, 1)))
    return node


def _apply_material(mat, spec, report):
    """Write a preset/args dict onto a material and record what was applied."""
    bsdf = _principled(mat)
    if spec.get("color") is not None or spec.get("base_color") is not None:
        col = _color(spec.get("color") if spec.get("color") is not None else spec.get("base_color"),
                     _color(None))
        used = _set_in(bsdf, "base_color", col)
        report["color"] = col
        report["color_input"] = used
    for key in ("metallic", "roughness", "specular", "ior", "transmission", "alpha",
                "coat", "coat_roughness", "sheen", "anisotropic", "subsurface", "emission_strength"):
        if spec.get(key) is None:
            continue
        val = float(spec.get(key))
        if key == "emission_strength":
            val = max(0.0, val)
        if key in ("metallic", "roughness", "specular", "transmission", "alpha", "coat",
                   "coat_roughness", "sheen", "anisotropic"):
            val = min(max(val, 0.0), 1.0) if key != "roughness" else min(max(val, 0.0), 1.0)
        used = _set_in(bsdf, key, val)
        report[key] = val
        if used and used != key:
            report.setdefault("renamed_inputs", {})[key] = used
    if spec.get("emission") is not None or spec.get("emissive") is not None:
        em = _color(spec.get("emission") if spec.get("emission") is not None else spec.get("emissive"),
                    _color(None))
        used = _set_in(bsdf, "emission", em)
        report["emission"] = em
        if used and used != "Emission":
            report.setdefault("renamed_inputs", {})["emission"] = used
    # Alpha < 1 without an explicit blend mode would render OPAQUE in EEVEE.
    blend = spec.get("blend")
    if blend is None and spec.get("alpha") is not None and float(spec.get("alpha")) < 1.0:
        blend = "BLEND"
    if blend:
        applied = _blend_mode(mat, blend)
        if applied:
            report["blend"] = applied
    noise = spec.get("noise")
    if isinstance(noise, dict) and noise:
        saved = dict(ARGS)
        try:
            ARGS.clear()
            ARGS.update(noise)
            ARGS["material"] = mat.name
            removed = _purge_elio_nodes(mat)
            _wire_texture(mat, report)
            if removed:
                report["removed_previous_nodes"] = removed
        finally:
            ARGS.clear()
            ARGS.update(saved)
    return report


def _wire_texture(mat, report):
    """Shared by material_create/material_set/material_noise: build the node graph."""
    kind = ARGS.get("type") or ARGS.get("texture") or "noise"
    affect = str(ARGS.get("affect") or ARGS.get("target") or "bump").lower()
    node = _tex_node(mat, kind, ARGS)
    if node is None:
        report["texture_error"] = "unknown texture type: " + str(kind)
        return report
    strength = float(ARGS.get("strength") or 0.3)
    tree = mat.node_tree
    bsdf = _principled(mat)
    color_a = _color(ARGS.get("color_a"), (0.05, 0.05, 0.05, 1.0))
    color_b = _color(ARGS.get("color_b"), (0.85, 0.85, 0.85, 1.0))
    record = {"type": str(kind), "affect": affect, "node": node.name}
    if affect in ("bump", "normal", "height"):
        bump = tree.nodes.new("ShaderNodeBump")
        bump.name = _ELIO_PREFIX + "bump"
        bump.location = (-300, -260)
        _set_node_input(bump, "Strength", min(max(strength, 0.0), 1.0))
        try:
            tree.links.new(node.outputs["Fac"], bump.inputs["Height"])
        except Exception:
            try:
                tree.links.new(node.outputs["Color"], bump.inputs["Height"])
            except Exception:
                pass
        try:
            tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        except Exception:
            pass
        record["strength"] = strength
    elif affect in ("roughness",):
        _set_node_input(bsdf, "Roughness", None)
        try:
            tree.links.new(node.outputs["Fac"], bsdf.inputs["Roughness"])
        except Exception:
            pass
    elif affect in ("emission", "emissive"):
        node2 = tree.nodes.new("ShaderNodeMath")
        node2.name = _ELIO_PREFIX + "emission_mul"
        node2.operation = "MULTIPLY"
        node2.location = (-300, -400)
        _set_node_input(node2, "1", max(strength, 0.0) if strength else 1.0)
        try:
            tree.links.new(node.outputs["Fac"], node2.inputs[0])
            tree.links.new(node2.outputs[0], bsdf.inputs["Emission Strength"])
        except Exception:
            pass
        record["strength"] = strength
    else:  # base_color / color / mix
        ramp = tree.nodes.new("ShaderNodeValToRGB")
        ramp.name = _ELIO_PREFIX + "ramp"
        ramp.location = (-320, 20)
        try:
            ramp.color_ramp.elements[0].position = 0.35
            ramp.color_ramp.elements[0].color = color_a
            if len(ramp.color_ramp.elements) > 1:
                ramp.color_ramp.elements[1].position = 0.65
                ramp.color_ramp.elements[1].color = color_b
        except Exception:
            pass
        try:
            tree.links.new(node.outputs["Fac"], ramp.inputs["Fac"])
            tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
        except Exception:
            pass
        record["colors"] = [color_a, color_b]
    report["texture"] = record
    return report


def cmd_material_create():
    spec = dict(MATERIAL_PRESETS.get(str(ARGS.get("preset") or "").lower(), {}))
    for key in ("color", "base_color", "metallic", "roughness", "specular", "ior", "transmission",
                "alpha", "emission", "emissive", "emission_strength", "coat", "coat_roughness",
                "sheen", "anisotropic", "subsurface", "blend", "noise"):
        if ARGS.get(key) is not None:
            spec[key] = ARGS.get(key)
    name = str(ARGS.get("material") or ARGS.get("material_name") or ARGS.get("name") or "ELIO_Material")
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    report = {"material": mat.name, "preset": ARGS.get("preset") or None}
    if not spec:
        spec = {"color": [0.8, 0.8, 0.8]}
    _purge_elio_nodes(mat)
    _apply_material(mat, spec, report)
    assigned = []
    objs = _target_objects()
    if objs and ARGS.get("assign", True) is not False:
        for obj in objs:
            if getattr(obj, "type", "") != "MESH" or getattr(obj, "data", None) is None:
                continue
            try:
                if ARGS.get("append_slot") and obj.data.materials:
                    obj.data.materials.append(mat)
                elif len(obj.data.materials):
                    obj.data.materials[0] = mat
                else:
                    obj.data.materials.append(mat)
                assigned.append(obj.name)
            except Exception:
                continue
    report["assigned"] = assigned
    report["ok"] = True
    return emit(report)


def cmd_material_preset():
    if not ARGS.get("preset"):
        return emit({"ok": False, "error": "preset required. Known presets: " + ", ".join(sorted(MATERIAL_PRESETS))})
    return cmd_material_create()


def cmd_material_set():
    mat = _find_material()
    if mat is None:
        return emit({"ok": False, "error": "material required (pass material:\"<name>\")"})
    mat.use_nodes = True
    report = {"material": mat.name}
    keys = ("color", "base_color", "metallic", "roughness", "specular", "ior", "transmission",
            "alpha", "emission", "emissive", "emission_strength", "coat", "coat_roughness",
            "sheen", "anisotropic", "subsurface", "blend")
    spec = {k: ARGS.get(k) for k in keys if ARGS.get(k) is not None}
    if not spec:
        return emit({"ok": False, "error": "nothing to set - pass color/metallic/roughness/emission/alpha/blend..."})
    _apply_material(mat, spec, report)
    assigned = []
    if ARGS.get("objects") or ARGS.get("name"):
        for obj in _target_objects():
            if getattr(obj, "type", "") != "MESH" or getattr(obj, "data", None) is None:
                continue
            try:
                if len(obj.data.materials):
                    obj.data.materials[0] = mat
                else:
                    obj.data.materials.append(mat)
                assigned.append(obj.name)
            except Exception:
                continue
    if assigned:
        report["assigned"] = assigned
    report["ok"] = True
    return emit(report)


def cmd_material_assign():
    mat = _find_material()
    if mat is None:
        return emit({"ok": False, "error": "material not found - pass material:\"<name>\" (material_list shows what exists)"})
    objs = _target_objects()
    if not objs:
        return emit({"ok": False, "error": "no objects - pass name/objects or select meshes first"})
    slot = ARGS.get("slot")
    assigned = []
    for obj in objs:
        if getattr(obj, "type", "") != "MESH" or getattr(obj, "data", None) is None:
            continue
        try:
            if slot is not None and int(slot) < len(obj.data.materials):
                obj.data.materials[int(slot)] = mat
            elif ARGS.get("append") or len(obj.data.materials):
                obj.data.materials.append(mat)
            else:
                obj.data.materials.append(mat)
            assigned.append({"object": obj.name, "slots": len(obj.data.materials)})
        except Exception:
            continue
    return emit({"ok": bool(assigned), "material": mat.name, "assigned": assigned,
                 "error": None if assigned else "no mesh objects in the target list"})


def cmd_material_list():
    mats = []
    for mat in bpy.data.materials:
        users = [o.name for o in bpy.data.objects if getattr(o, "data", None) is not None
                 and getattr(o.data, "materials", None) is not None and mat.name in [m.name for m in o.data.materials if m]]
        bsdf = None
        try:
            for n in mat.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    bsdf = n
                    break
        except Exception:
            bsdf = None
        entry = {"name": mat.name, "users": users[:12], "user_count": len(users), "use_nodes": bool(mat.use_nodes)}
        if bsdf is not None:
            for key, sock in (("metallic", "Metallic"), ("roughness", "Roughness")):
                s = bsdf.inputs.get(sock)
                if s is not None:
                    try:
                        entry[key] = round(float(s.default_value), 4)
                    except Exception:
                        pass
            for nm in ("Base Color",):
                s = bsdf.inputs.get(nm)
                if s is not None:
                    try:
                        entry["color"] = [round(float(c), 3) for c in list(s.default_value)[:4]]
                    except Exception:
                        pass
            for nm in ("Emission Strength",):
                s = bsdf.inputs.get(nm)
                if s is not None:
                    try:
                        entry["emission_strength"] = round(float(s.default_value), 3)
                    except Exception:
                        pass
        mats.append(entry)
    return emit({"ok": True, "count": len(mats), "materials": mats,
                 "presets": sorted(MATERIAL_PRESETS)})


def cmd_material_inspect():
    mat = _find_material()
    if mat is None:
        return emit({"ok": False, "error": "material required (material:\"<name>\") or target a shaded object"})
    info = {"ok": True, "name": mat.name, "use_nodes": bool(mat.use_nodes),
            "presets": sorted(MATERIAL_PRESETS)}
    for attr in ("diffuse_color", "metallic", "roughness", "blend_method", "surface_render_method",
                 "use_backface_culling", "alpha_threshold"):
        if hasattr(mat, attr):
            try:
                v = getattr(mat, attr)
                info[attr] = [round(float(x), 4) for x in list(v)] if isinstance(v, (list, tuple)) else (v if isinstance(v, (str, bool, int, float)) else str(v))
            except Exception:
                pass
    bsdf = None
    try:
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                bsdf = n
                break
    except Exception:
        pass
    if bsdf is not None:
        inputs = {}
        for sock in bsdf.inputs:
            try:
                if hasattr(sock, "default_value"):
                    dv = sock.default_value
                    inputs[sock.name] = [round(float(x), 4) for x in list(dv)] if hasattr(dv, "__len__") else round(float(dv), 4)
                elif sock.is_linked:
                    inputs[sock.name] = "<linked>"
            except Exception:
                continue
        info["principled"] = inputs
        info["linked_inputs"] = [s.name for s in bsdf.inputs if s.is_linked]
    try:
        info["nodes"] = [{"name": n.name, "type": n.type, "label": n.label} for n in mat.node_tree.nodes]
    except Exception:
        pass
    users = [o.name for o in bpy.data.objects if getattr(o, "data", None) is not None
             and getattr(o.data, "materials", None) is not None and mat.name in [m.name for m in o.data.materials if m]]
    info["users"] = users[:20]
    return emit(info)


def cmd_material_remove():
    name = str(ARGS.get("material") or ARGS.get("material_name") or "").strip()
    mat = bpy.data.materials.get(name)
    if mat is None:
        return emit({"ok": False, "error": "no material named " + (name or "<empty>")})
    try:
        mat.user_clear()
    except Exception:
        pass
    bpy.data.materials.remove(mat)
    return emit({"ok": True, "removed": name, "remaining": len(bpy.data.materials)})


def cmd_material_noise():
    mat = _find_material()
    if mat is None:
        return emit({"ok": False, "error": "material required (material:\"<name>\")"})
    mat.use_nodes = True
    removed = _purge_elio_nodes(mat) if ARGS.get("replace", True) else 0
    report = {"material": mat.name, "removed_previous_nodes": removed}
    _wire_texture(mat, report)
    if "texture" not in report:
        return emit({"ok": False, "error": report.get("texture_error", "could not build the texture nodes"),
                     "hint": "types: noise, voronoi, wave, checker, brick, gradient; affect: bump, base_color, roughness, emission"})
    report["ok"] = True
    return emit(report)


def cmd_material_image():
    mat = _find_material()
    if mat is None:
        return emit({"ok": False, "error": "material required (material:\"<name>\")"})
    path = str(ARGS.get("path") or ARGS.get("filepath") or ARGS.get("image") or "").strip()
    if not path:
        return emit({"ok": False, "error": "path required (an image file Blender can read, e.g. C:/tex/brick.png)"})
    path = os.path.expanduser(os.path.expandvars(path))
    if not os.path.isfile(path):
        return emit({"ok": False, "error": "no such image file: " + path})
    slot = str(ARGS.get("slot") or ARGS.get("channel") or "base_color").lower()
    if slot not in ("base_color", "color", "albedo", "diffuse", "roughness", "rough", "orm",
                    "metallic", "metal", "orm_metal", "normal", "bump", "emission", "emissive"):
        return emit({"ok": False, "error": "unknown slot: " + slot,
                     "hint": "slot: base_color | roughness | metallic | normal | emission"})
    mat.use_nodes = True
    bsdf = _principled(mat)
    tree = mat.node_tree
    img = bpy.data.images.load(path, check_existing=True)
    node = tree.nodes.new("ShaderNodeTexImage")
    node.name = _ELIO_PREFIX + "image"
    node.label = os.path.basename(path)
    node.location = (-460, 120)
    node.image = img
    try:
        node.image.colorspace_settings.name = str(ARGS.get("colorspace") or "sRGB")
    except Exception:
        pass
    wired = []
    try:
        if slot in ("base_color", "color", "albedo", "diffuse"):
            node.image.colorspace_settings.name = str(ARGS.get("colorspace") or "sRGB")
            tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
            wired.append("Base Color")
            if ARGS.get("alpha_to_alpha") and node.outputs.get("Alpha") is not None:
                tree.links.new(node.outputs["Alpha"], bsdf.inputs["Alpha"])
                wired.append("Alpha")
        elif slot in ("roughness", "rough", "orm"):
            img.colorspace_settings.name = "Non-Color"
            tree.links.new(node.outputs["Color"], bsdf.inputs["Roughness"])
            wired.append("Roughness")
        elif slot in ("metallic", "metal", "orm_metal"):
            img.colorspace_settings.name = "Non-Color"
            tree.links.new(node.outputs["Color"], bsdf.inputs["Metallic"])
            wired.append("Metallic")
        elif slot in ("normal", "bump"):
            img.colorspace_settings.name = "Non-Color"
            nmap = tree.nodes.new("ShaderNodeNormalMap")
            nmap.name = _ELIO_PREFIX + "normal_map"
            nmap.location = (-260, -140)
            tree.links.new(node.outputs["Color"], nmap.inputs["Color"])
            tree.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
            wired.append("Normal")
        elif slot in ("emission", "emissive"):
            tree.links.new(node.outputs["Color"], bsdf.inputs["Emission Color" if bsdf.inputs.get("Emission Color") else "Emission"])
            _set_in(bsdf, "emission_strength", float(ARGS.get("strength") or 1.0))
            wired.append("Emission Color")
    except Exception as exc:
        return emit({"ok": False, "error": "could not wire the image: " + str(exc)})
    return emit({"ok": True, "material": mat.name, "image": path, "size": list(img.size),
                 "slot": slot, "wired": wired, "node": node.name})


def cmd_material_pbr():
    """Full PBR graph (albedo + ORM + normal) - the game-ready / Roblox layout."""
    mat = _find_material()
    if mat is None:
        return emit({"ok": False, "error": "material required (material:\"<name>\")"})
    files = {}
    for key in ("base_color", "albedo", "roughness", "metallic", "orm", "normal", "emission"):
        v = ARGS.get(key)
        if v:
            p = os.path.expanduser(os.path.expandvars(str(v)))
            if not os.path.isfile(p):
                return emit({"ok": False, "error": "no such file for " + key + ": " + p})
            files[key] = p
    if not files:
        return emit({"ok": False, "error": "pass at least base_color/albedo (optional orm/roughness/metallic/normal)"})
    mat.use_nodes = True
    _purge_elio_nodes(mat)
    saved = dict(ARGS)
    built = []
    try:
        for key, p in files.items():
            ARGS.clear()
            ARGS.update(saved)
            ARGS["path"] = p
            ARGS["slot"] = {"albedo": "base_color", "orm": "roughness"}.get(key, key)
            sub = {}
            _material_image_into(mat, p, ARGS["slot"], sub)
            built.append({"channel": key, "file": p, **sub})
    finally:
        ARGS.clear()
        ARGS.update(saved)
    return emit({"ok": True, "material": mat.name, "channels": built,
                 "note": "Non-Color colorspace is set automatically for roughness/metallic/normal maps."})


def _material_image_into(mat, path, slot, report):
    """Add one image node into an existing graph (used by cmd_material_pbr)."""
    bsdf = _principled(mat)
    tree = mat.node_tree
    img = bpy.data.images.load(path, check_existing=True)
    node = tree.nodes.new("ShaderNodeTexImage")
    node.name = _ELIO_PREFIX + "img_" + str(slot)
    node.label = os.path.basename(path)
    node.location = (-520, 200 - 60 * len([n for n in tree.nodes if str(n.name).startswith(_ELIO_PREFIX + "img_")]))
    node.image = img
    if slot in ("base_color", "color", "albedo"):
        node.image.colorspace_settings.name = "sRGB"
        tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
        report["wired"] = "Base Color"
    elif slot in ("roughness", "orm"):
        img.colorspace_settings.name = "Non-Color"
        tree.links.new(node.outputs["Color"], bsdf.inputs["Roughness"])
        report["wired"] = "Roughness"
    elif slot == "metallic":
        img.colorspace_settings.name = "Non-Color"
        tree.links.new(node.outputs["Color"], bsdf.inputs["Metallic"])
        report["wired"] = "Metallic"
    elif slot == "normal":
        img.colorspace_settings.name = "Non-Color"
        nmap = tree.nodes.new("ShaderNodeNormalMap")
        nmap.name = _ELIO_PREFIX + "nm_" + os.path.basename(path)
        nmap.location = (-260, -160)
        tree.links.new(node.outputs["Color"], nmap.inputs["Color"])
        tree.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        report["wired"] = "Normal"
    elif slot == "emission":
        tree.links.new(node.outputs["Color"], bsdf.inputs["Emission Color" if bsdf.inputs.get("Emission Color") else "Emission"])
        report["wired"] = "Emission Color"
    report["node"] = node.name
    report["size"] = list(img.size)
    return report


def cmd_add_modifier():
    obj = bpy.data.objects.get(str(ARGS.get("name") or ARGS.get("object") or "")) or active()
    if obj is None:
        objs = named_elio_sel()
        obj = objs[0] if objs else None
    if obj is None:
        return emit({"ok": False, "error": "object required"})
    kind = str(ARGS.get("type") or ARGS.get("modifier") or "SUBSURF").upper()
    alias = {"SUBSURF": "SUBSURF", "SUBDIVISION": "SUBSURF", "BEVEL": "BEVEL", "SOLIDIFY": "SOLIDIFY",
             "MIRROR": "MIRROR", "ARRAY": "ARRAY", "BOOLEAN": "BOOLEAN", "DECIMATE": "DECIMATE",
             "TRIANGULATE": "TRIANGULATE", "REMESH": "REMESH", "WELD": "WELD"}
    kind = alias.get(kind, kind)
    mod = obj.modifiers.new(name=kind.title(), type=kind)
    if kind == "SUBSURF":
        mod.levels = int(ARGS.get("levels") or 1)
    if kind == "BEVEL":
        mod.width = float(ARGS.get("width") or 0.02)
        mod.segments = int(ARGS.get("segments") or 2)
    if kind == "SOLIDIFY":
        mod.thickness = float(ARGS.get("thickness") or 0.05)
    if kind == "ARRAY":
        mod.count = int(ARGS.get("count") or 3)
        off = ARGS.get("offset")
        if off is not None:
            mod.use_relative_offset = True
            mod.relative_offset_displace = vec3("offset", (1, 0, 0))
    if kind == "MIRROR":
        axis = str(ARGS.get("axis") or "X").upper()
        mod.use_axis = (axis == "X", axis == "Y", axis == "Z")
    if kind == "DECIMATE":
        mod.ratio = float(ARGS.get("ratio") or 0.5)
    if kind == "BOOLEAN":
        target = bpy.data.objects.get(str(ARGS.get("target") or ""))
        if target:
            mod.object = target
            mod.operation = str(ARGS.get("operation") or "DIFFERENCE")
    if ARGS.get("apply"):
        ensure_object_mode()
        select_only([obj])
        try:
            run_op(bpy.ops.object.modifier_apply, modifier=mod.name)
        except Exception:
            pass
    return emit({"ok": True, "object": obj.name, "modifier": kind})


def cmd_boolean():
    ARGS["type"] = "BOOLEAN"
    if "apply" not in ARGS:
        ARGS["apply"] = True
    return cmd_add_modifier()


def cmd_apply_modifiers():
    ensure_object_mode()
    objs = named_elio_sel()
    applied = []
    for obj in objs:
        select_only([obj])
        for mod in list(obj.modifiers):
            try:
                run_op(bpy.ops.object.modifier_apply, modifier=mod.name)
                applied.append(obj.name + ":" + mod.name)
            except Exception:
                try:
                    obj.modifiers.remove(mod)
                except Exception:
                    pass
    return emit({"ok": True, "applied": applied})


def cmd_remove_modifier():
    objs = named_elio_sel()
    kind = str(ARGS.get("type") or ARGS.get("modifier") or "").upper()
    removed = []
    for obj in objs:
        for mod in list(obj.modifiers):
            if not kind or mod.type == kind or mod.name.upper() == kind:
                obj.modifiers.remove(mod)
                removed.append(obj.name)
    return emit({"ok": True, "objects": removed})


def cmd_triangulate():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    if not objs:
        return emit({"ok": False, "error": "no mesh"})
    in_edit(objs, lambda: run_op(bpy.ops.mesh.quads_convert_to_tris))
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_decimate():
    ARGS["type"] = "DECIMATE"
    ARGS["apply"] = True if "apply" not in ARGS else ARGS.get("apply")
    return cmd_add_modifier()


def cmd_merge():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    dist = float(ARGS.get("distance") or 0.0001)
    def _m():
        try:
            run_op(bpy.ops.mesh.merge_by_distance, threshold=dist)
        except Exception:
            try:
                run_op(bpy.ops.mesh.remove_doubles, threshold=dist)
            except TypeError:
                run_op(bpy.ops.mesh.remove_doubles)
    in_edit(objs, _m)
    return emit({"ok": True, "objects": [o.name for o in objs], "distance": dist})


def cmd_recalc_normals():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    in_edit(objs, lambda: run_op(bpy.ops.mesh.normals_make_consistent, inside=bool(ARGS.get("inside", False))))
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_flip_normals():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    in_edit(objs, lambda: run_op(bpy.ops.mesh.flip_normals))
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_separate_loose():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    if not objs:
        return emit({"ok": False, "error": "no mesh"})
    before = set(bpy.data.objects.keys())
    in_edit(objs, lambda: run_op(bpy.ops.mesh.separate, type="LOOSE"))
    added = [k for k in bpy.data.objects.keys() if k not in before]
    return emit({"ok": True, "objects": added or [o.name for o in objs]})


def cmd_subdivide():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    cuts = int(ARGS.get("cuts") or ARGS.get("levels") or 1)
    in_edit(objs, lambda: run_op(bpy.ops.mesh.subdivide, number_cuts=cuts))
    return emit({"ok": True, "objects": [o.name for o in objs], "cuts": cuts})


def cmd_uv_unwrap():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    if not objs:
        return emit({"ok": False, "error": "no mesh"})
    def _u():
        try:
            run_op(bpy.ops.uv.smart_project)
        except Exception:
            run_op(bpy.ops.uv.unwrap)
    in_edit(objs, _u)
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_array():
    ensure_object_mode()
    objs = named_elio_sel()
    count = int(ARGS.get("count") or 3)
    offset = Vector(vec3("offset", (2, 0, 0)))
    unique = bool(ARGS.get("unique", True))
    created = []
    for o in objs:
        for i in range(1, count):
            dup = o.copy()
            if unique and getattr(o, "data", None) is not None:
                try:
                    dup.data = o.data.copy()
                except Exception:
                    pass
            dup.location = Vector(o.location) + offset * i
            bpy.context.scene.collection.objects.link(dup)
            created.append(dup.name)
    return emit({"ok": True, "objects": created, "count": count})


def cmd_mirror():
    ensure_object_mode()
    objs = named_elio_sel()
    axis = str(ARGS.get("axis") or "X").upper()
    idx = {"X": 0, "Y": 1, "Z": 2}.get(axis, 0)
    created = []
    for o in objs:
        dup = o.copy()
        if getattr(o, "data", None) is not None:
            try:
                dup.data = o.data.copy()
            except Exception:
                pass
        bpy.context.scene.collection.objects.link(dup)
        sc = list(dup.scale)
        sc[idx] = -abs(sc[idx]) if sc[idx] != 0 else -1
        dup.scale = sc
        created.append(dup.name)
        select_only([dup])
        try:
            run_op(bpy.ops.object.transform_apply, location=False, rotation=False, scale=True)
        except Exception:
            pass
    return emit({"ok": True, "objects": created, "axis": axis})


def cmd_hide():
    objs = named_elio_sel()
    for o in objs:
        try:
            o.hide_set(True)
        except Exception:
            o.hide_viewport = True
    return emit({"ok": True, "hidden": [o.name for o in objs]})


def cmd_unhide():
    names = as_list(ARGS.get("objects") or ([ARGS.get("name")] if ARGS.get("name") else None))
    objs = [bpy.data.objects.get(str(n)) for n in names] if names else list(bpy.data.objects)
    objs = [o for o in objs if o]
    for o in objs:
        try:
            o.hide_set(False)
        except Exception:
            o.hide_viewport = False
    return emit({"ok": True, "unhidden": [o.name for o in objs]})


def cmd_unhide_all():
    names = []
    for o in bpy.data.objects:
        try:
            o.hide_set(False)
        except Exception:
            o.hide_viewport = False
        names.append(o.name)
    return emit({"ok": True, "unhidden": names})


def cmd_hide_unselected():
    sel = set(bpy.context.selected_objects)
    hidden = []
    for o in bpy.data.objects:
        if o not in sel:
            try:
                o.hide_set(True)
            except Exception:
                o.hide_viewport = True
            hidden.append(o.name)
    return emit({"ok": True, "hidden": hidden})


def cmd_undo():
    try:
        bpy.ops.ed.undo()
    except Exception:
        run_op(bpy.ops.ed.undo)
    return emit({"ok": True, "undo": True})


def cmd_redo():
    try:
        bpy.ops.ed.redo()
    except Exception:
        run_op(bpy.ops.ed.redo)
    return emit({"ok": True, "redo": True})


def cmd_frame_selected():
    objs = named_elio_sel()
    select_only(objs)
    try:
        run_op(bpy.ops.view3d.view_selected)
    except Exception:
        pass
    return emit({"ok": True, "objects": [o.name for o in objs]})


def cmd_stats():
    items = []
    for o in named_elio_sel() or list(bpy.data.objects):
        verts = faces = 0
        if o.type == "MESH" and o.data:
            verts = len(o.data.vertices)
            faces = len(o.data.polygons)
        items.append({"name": o.name, "type": o.type, "verts": verts, "faces": faces,
                      "modifiers": [m.type for m in o.modifiers]})
    return emit({"ok": True, "objects": items})


def cmd_save_blend():
    fp = str(ARGS.get("filepath") or ARGS.get("path") or "").strip()
    if not fp:
        fp = os.path.join(default_dir(), "or_scene.blend")
    if not fp.lower().endswith(".blend"):
        fp += ".blend"
    os.makedirs(os.path.dirname(fp) or ".", exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=fp)
    return emit({"ok": True, "filepath": fp})


def cmd_look_at():
    obj = bpy.data.objects.get(str(ARGS.get("name") or "")) or active()
    if obj is None:
        return emit({"ok": False, "error": "object required"})
    target = bpy.data.objects.get(str(ARGS.get("target") or ""))
    if target is not None:
        loc = target.matrix_world.translation
    else:
        loc = Vector(vec3("location", (0, 0, 0)))
    direction = loc - obj.matrix_world.translation
    if direction.length < 1e-8:
        return emit({"ok": False, "error": "target is at the same location"})
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return emit({"ok": True, "name": obj.name, "target": list(loc)})


def cmd_convert_to_mesh():
    ensure_object_mode()
    objs = named_elio_sel()
    select_only(objs)
    try:
        run_op(bpy.ops.object.convert, target="MESH")
    except Exception as e:
        return emit({"ok": False, "error": str(e)})
    return emit({"ok": True, "objects": [o.name for o in bpy.context.selected_objects]})


def cmd_add_empty():
    ensure_object_mode()
    loc = vec3("location", (0, 0, 0))
    empty = bpy.data.objects.new(str(ARGS.get("name") or "Empty"), None)
    empty.location = loc
    bpy.context.scene.collection.objects.link(empty)
    return emit({"ok": True, "name": empty.name, "type": "EMPTY"})


def cmd_add_camera():
    ensure_object_mode()
    loc = vec3("location", (7.5, -6.5, 5.5))
    run_op(bpy.ops.object.camera_add, location=loc)
    obj = active()
    set_name(obj, ARGS.get("name") or "Camera")
    return emit({"ok": True, "name": obj.name if obj else "Camera", "type": "CAMERA"})


def cmd_add_light():
    ensure_object_mode()
    loc = vec3("location", (4, -4, 6))
    kind = str(ARGS.get("type") or "SUN").upper()
    if kind not in ("SUN", "POINT", "SPOT", "AREA"):
        kind = "SUN"
    run_op(bpy.ops.object.light_add, type=kind, location=loc)
    obj = active()
    set_name(obj, ARGS.get("name") or kind.title())
    energy = ARGS.get("energy")
    if energy is not None and obj and obj.data:
        try:
            obj.data.energy = float(energy)
        except Exception:
            pass
    return emit({"ok": True, "name": obj.name if obj else kind, "type": "LIGHT", "light": kind})


def cmd_add_text():
    ensure_object_mode()
    loc = vec3("location", (0, 0, 0))
    run_op(bpy.ops.object.text_add, location=loc)
    obj = active()
    set_name(obj, ARGS.get("name") or "Text")
    if obj and obj.data:
        obj.data.body = str(ARGS.get("text") or ARGS.get("body") or "elio")
        if ARGS.get("extrude") is not None:
            try:
                obj.data.extrude = float(ARGS.get("extrude"))
            except Exception:
                pass
    return emit({"ok": True, "name": obj.name if obj else "Text", "type": "FONT"})


def cmd_clear_scene():
    ensure_object_mode()
    keep = set(str(x) for x in (ARGS.get("keep") or []))
    removed = []
    for o in list(bpy.data.objects):
        if o.name in keep:
            continue
        removed.append(o.name)
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass
    return emit({"ok": True, "deleted": removed})



def cmd_align_camera_axis():
    axis = str(ARGS.get("axis") or ARGS.get("view") or "front").lower().replace(" ", "_")
    dist = float(ARGS.get("distance") or 12.0)
    target = bpy.data.objects.get(str(ARGS.get("target") or ""))
    if target is not None:
        center = target.matrix_world.translation.copy()
    else:
        sel = [o for o in bpy.context.selected_objects if getattr(o, "type", "") != "CAMERA"]
        if sel:
            acc = Vector((0.0, 0.0, 0.0))
            for o in sel:
                acc += o.matrix_world.translation
            center = acc / float(len(sel))
        else:
            center = Vector(vec3("location", (0.0, 0.0, 0.0)))
    offsets = {
        "front": Vector((0.0, -dist, 0.0)),
        "back": Vector((0.0, dist, 0.0)),
        "right": Vector((dist, 0.0, 0.0)),
        "left": Vector((-dist, 0.0, 0.0)),
        "top": Vector((0.0, 0.0, dist)),
        "bottom": Vector((0.0, 0.0, -dist)),
        "iso": Vector((dist * 0.72, -dist * 0.72, dist * 0.62)),
        "camera": Vector((dist * 0.72, -dist * 0.72, dist * 0.62)),
    }
    off = offsets.get(axis, offsets["front"])
    cam = bpy.data.objects.get(str(ARGS.get("name") or ""))
    if cam is None or getattr(cam, "type", "") != "CAMERA":
        cam = next((o for o in bpy.data.objects if o.type == "CAMERA"), None)
    if cam is None:
        ensure_object_mode()
        run_op(bpy.ops.object.camera_add, location=tuple(center + off))
        cam = active()
        set_name(cam, ARGS.get("name") or "Camera")
    else:
        cam.location = center + off
    direction = center - cam.matrix_world.translation
    if direction.length > 1e-8:
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    try:
        bpy.context.scene.camera = cam
    except Exception:
        pass
    ov = view_override()
    if ov:
        try:
            with bpy.context.temp_override(**ov):
                bpy.ops.view3d.view_camera()
        except Exception:
            pass
    return emit({"ok": True, "name": cam.name if cam else "Camera", "axis": axis, "location": list(cam.location) if cam else None})


def cmd_view_axis():
    axis = str(ARGS.get("axis") or ARGS.get("view") or "FRONT").upper()
    aliases = {"ISO": "iso", "CAMERA": "iso", "PERSP": "iso"}
    if axis in aliases:
        ARGS["axis"] = aliases[axis]
        return cmd_align_camera_axis()
    mapping = {"FRONT": "FRONT", "BACK": "BACK", "LEFT": "LEFT", "RIGHT": "RIGHT", "TOP": "TOP", "BOTTOM": "BOTTOM"}
    typ = mapping.get(axis, "FRONT")
    ov = view_override()
    if not ov:
        return emit({"ok": False, "error": "no 3D viewport to align"})
    try:
        with bpy.context.temp_override(**ov):
            bpy.ops.view3d.view_axis(type=typ)
    except Exception as e:
        return emit({"ok": False, "error": str(e)})
    return emit({"ok": True, "axis": typ})


def cmd_camera_to_view():
    ov = view_override()
    if not ov:
        return emit({"ok": False, "error": "no 3D viewport"})
    try:
        with bpy.context.temp_override(**ov):
            bpy.ops.view3d.camera_to_view()
    except Exception as e:
        return emit({"ok": False, "error": str(e)})
    cam = getattr(bpy.context.scene, "camera", None)
    return emit({"ok": True, "name": cam.name if cam else None})


def cmd_set_camera_lens():
    cam = bpy.data.objects.get(str(ARGS.get("name") or ""))
    if cam is None or getattr(cam, "type", "") != "CAMERA":
        cam = getattr(bpy.context.scene, "camera", None)
    if cam is None or getattr(cam, "type", "") != "CAMERA":
        cam = next((o for o in bpy.data.objects if o.type == "CAMERA"), None)
    if cam is None or cam.type != "CAMERA":
        return emit({"ok": False, "error": "no camera in the scene"})
    data = cam.data
    if ARGS.get("lens") is not None:
        try:
            data.lens = float(ARGS.get("lens"))
        except Exception:
            pass
    if ARGS.get("clip_start") is not None:
        try:
            data.clip_start = float(ARGS.get("clip_start"))
        except Exception:
            pass
    if ARGS.get("clip_end") is not None:
        try:
            data.clip_end = float(ARGS.get("clip_end"))
        except Exception:
            pass
    if ARGS.get("ortho") is True:
        data.type = "ORTHO"
        if ARGS.get("ortho_scale") is not None:
            try:
                data.ortho_scale = float(ARGS.get("ortho_scale"))
            except Exception:
                pass
    elif ARGS.get("ortho") is False:
        data.type = "PERSP"
    return emit({"ok": True, "name": cam.name, "lens": getattr(data, "lens", None), "type": data.type})



def cmd_scale():
    ensure_object_mode()
    objs = named_elio_sel()
    s = vec3("scale", vec3("factor", (1.0, 1.0, 1.0)))
    mul = ARGS.get("multiply")
    if mul is None:
        mul = True
    names = []
    for o in objs:
        if mul:
            o.scale = Vector((o.scale[0] * s[0], o.scale[1] * s[1], o.scale[2] * s[2]))
        else:
            o.scale = Vector(s)
        names.append(o.name)
    return emit({"ok": True, "objects": names, "scale": list(s), "multiply": bool(mul)})


def cmd_bevel():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    width = float(ARGS.get("width") or ARGS.get("offset") or 0.05)
    segs = int(ARGS.get("segments") or 2)
    if not objs:
        return emit({"ok": False, "error": "no mesh selected"})
    in_edit(objs, lambda: run_op(bpy.ops.mesh.bevel, offset=width, segments=max(1, segs)))
    return emit({"ok": True, "objects": [o.name for o in objs], "width": width, "segments": segs})


def cmd_solidify():
    thickness = float(ARGS.get("thickness") or 0.1)
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    if not objs:
        return emit({"ok": False, "error": "no mesh selected"})
    names = []
    for o in objs:
        m = o.modifiers.new(name="Solidify", type="SOLIDIFY")
        m.thickness = thickness
        names.append(o.name)
    return emit({"ok": True, "objects": names, "thickness": thickness})


def cmd_extrude():
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    dist = float(ARGS.get("distance") or ARGS.get("offset") or 0.5)
    if not objs:
        return emit({"ok": False, "error": "no mesh selected"})
    def _fn():
        run_op(bpy.ops.mesh.extrude_region)
        run_op(bpy.ops.transform.translate, value=(0.0, 0.0, dist), orient_type="NORMAL")
    in_edit(objs, _fn)
    return emit({"ok": True, "objects": [o.name for o in objs], "distance": dist})


def cmd_add_curve():
    ensure_object_mode()
    loc = vec3("location", (0.0, 0.0, 0.0))
    run_op(bpy.ops.curve.primitive_bezier_curve_add, location=loc)
    obj = active()
    set_name(obj, ARGS.get("name") or "Curve")
    return emit({"ok": True, "name": obj.name if obj else None})


def cmd_add_armature():
    ensure_object_mode()
    loc = vec3("location", (0.0, 0.0, 0.0))
    run_op(bpy.ops.object.armature_add, location=loc)
    obj = active()
    set_name(obj, ARGS.get("name") or "Armature")
    return emit({"ok": True, "name": obj.name if obj else None})


def cmd_keyframe_insert():
    scene = bpy.context.scene
    frame = int(ARGS.get("frame") if ARGS.get("frame") is not None else scene.frame_current)
    data_path = str(ARGS.get("data_path") or "location")
    objs = named_elio_sel()
    try:
        scene.frame_set(frame)
    except Exception:
        pass
    names = []
    for o in objs:
        inserted = False
        for path in (data_path, "location", "rotation_euler", "scale"):
            try:
                o.keyframe_insert(data_path=path)
                inserted = True
                if path == data_path:
                    break
            except Exception:
                continue
        if inserted:
            names.append(o.name)
    return emit({"ok": True, "frame": frame, "objects": names, "data_path": data_path})


def cmd_set_frame():
    frame = int(ARGS.get("frame") or 1)
    bpy.context.scene.frame_set(frame)
    return emit({"ok": True, "frame": int(bpy.context.scene.frame_current)})


def cmd_set_active_camera():
    name = str(ARGS.get("name") or "")
    cam = bpy.data.objects.get(name) if name else None
    if cam is None or getattr(cam, "type", "") != "CAMERA":
        cam = getattr(bpy.context.scene, "camera", None)
    if cam is None or getattr(cam, "type", "") != "CAMERA":
        cam = next((o for o in bpy.data.objects if o.type == "CAMERA"), None)
    if cam is None or getattr(cam, "type", "") != "CAMERA":
        return emit({"ok": False, "error": "no camera in the scene"})
    bpy.context.scene.camera = cam
    return emit({"ok": True, "camera": cam.name})


def cmd_track_to():
    target = bpy.data.objects.get(str(ARGS.get("target") or ""))
    if target is None:
        return emit({"ok": False, "error": "target object required"})
    objs = named_elio_sel()
    names = []
    for o in objs:
        if o == target:
            continue
        c = o.constraints.new(type="TRACK_TO")
        c.target = target
        try:
            c.track_axis = "TRACK_NEGATIVE_Z"
            c.up_axis = "UP_Y"
        except Exception:
            pass
        names.append(o.name)
    return emit({"ok": True, "objects": names, "target": target.name})


def cmd_cursor_to_selected():
    objs = named_elio_sel()
    if not objs:
        return emit({"ok": False, "error": "nothing selected"})
    acc = Vector((0.0, 0.0, 0.0))
    for o in objs:
        acc += o.matrix_world.translation
    loc = acc / float(len(objs))
    bpy.context.scene.cursor.location = loc
    return emit({"ok": True, "cursor": [loc.x, loc.y, loc.z], "objects": [o.name for o in objs]})


def cmd_randomize_transform():
    import random
    objs = named_elio_sel()
    loc_amt = float(ARGS.get("location") or 0.5)
    rot_amt = float(ARGS.get("rotation") or 0.0)
    scl_amt = float(ARGS.get("scale") or 0.0)
    if ARGS.get("seed") is not None:
        random.seed(int(ARGS.get("seed")))
    names = []
    for o in objs:
        o.location = Vector(o.location) + Vector((
            random.uniform(-loc_amt, loc_amt),
            random.uniform(-loc_amt, loc_amt),
            random.uniform(-loc_amt, loc_amt),
        ))
        if rot_amt:
            o.rotation_euler[2] += math.radians(random.uniform(-rot_amt, rot_amt))
        if scl_amt:
            f = 1.0 + random.uniform(-scl_amt, scl_amt)
            o.scale = Vector((o.scale[0] * f, o.scale[1] * f, o.scale[2] * f))
        names.append(o.name)
    return emit({"ok": True, "objects": names})


def cmd_hide_render():
    objs = named_elio_sel()
    hide = ARGS.get("hide")
    if hide is None:
        hide = True
    for o in objs:
        o.hide_render = bool(hide)
    return emit({"ok": True, "objects": [o.name for o in objs], "hide_render": bool(hide)})


def cmd_subdivision():
    levels = int(ARGS.get("levels") or 2)
    render_levels = int(ARGS.get("render_levels") or max(levels, 2))
    objs = [o for o in named_elio_sel() if o.type == "MESH"]
    if not objs:
        return emit({"ok": False, "error": "no mesh selected"})
    names = []
    for o in objs:
        m = o.modifiers.new(name="Subdivision", type="SUBSURF")
        m.levels = max(0, levels)
        m.render_levels = max(0, render_levels)
        names.append(o.name)
    return emit({"ok": True, "objects": names, "levels": levels})


def cmd_origin_to_geometry():
    ensure_object_mode()
    objs = named_elio_sel()
    if not objs:
        return emit({"ok": False, "error": "nothing selected"})
    select_only(objs)
    run_op(bpy.ops.object.origin_set, type="ORIGIN_GEOMETRY")
    return emit({"ok": True, "objects": [o.name for o in objs]})



DISPATCH = {
    "export_fbx": cmd_export_fbx,
    "import_fbx": cmd_import_fbx,
    "export_obj": cmd_export_obj,
    "import_obj": cmd_import_obj,
    "dump": cmd_dump,
    "group": cmd_group,
    "ungroup": cmd_ungroup,
    "parent": cmd_parent,
    "unparent": cmd_unparent,
    "join": cmd_join,
    "move_to_collection": cmd_move_to_collection,
    "list_collections": cmd_list_collections,
    "list_objects": cmd_list_objects,
    "delete": cmd_delete,
    "duplicate": cmd_duplicate,
    "rename": cmd_rename,
    "select": cmd_select,
    "select_all": cmd_select_all,
    "deselect": cmd_deselect,
    "invert_selection": cmd_invert_selection,
    "select_children": cmd_select_children,
    "get_selection": cmd_get_selection,
    "transform": cmd_transform,
    "translate": cmd_translate,
    "rotate_deg": cmd_rotate_deg,
    "set_dimensions": cmd_set_dimensions,
    "apply_transforms": cmd_apply_transforms,
    "set_origin": cmd_set_origin,
    "origin_to_bottom": cmd_origin_to_bottom,
    "drop_to_ground": cmd_drop_to_ground,
    "center": cmd_center,
    "snap_to_grid": cmd_snap_to_grid,
    "shade_smooth": cmd_shade_smooth,
    "shade_flat": cmd_shade_flat,
    "set_material": cmd_set_material,
    "material_create": cmd_material_create,
    "material_preset": cmd_material_preset,
    "material_set": cmd_material_set,
    "material_assign": cmd_material_assign,
    "material_list": cmd_material_list,
    "material_inspect": cmd_material_inspect,
    "material_remove": cmd_material_remove,
    "material_noise": cmd_material_noise,
    "material_image": cmd_material_image,
    "material_pbr": cmd_material_pbr,
    "add_modifier": cmd_add_modifier,
    "boolean": cmd_boolean,
    "apply_modifiers": cmd_apply_modifiers,
    "remove_modifier": cmd_remove_modifier,
    "triangulate": cmd_triangulate,
    "decimate": cmd_decimate,
    "merge": cmd_merge,
    "recalc_normals": cmd_recalc_normals,
    "flip_normals": cmd_flip_normals,
    "separate_loose": cmd_separate_loose,
    "subdivide": cmd_subdivide,
    "uv_unwrap": cmd_uv_unwrap,
    "array": cmd_array,
    "mirror": cmd_mirror,
    "hide": cmd_hide,
    "unhide": cmd_unhide,
    "unhide_all": cmd_unhide_all,
    "hide_unselected": cmd_hide_unselected,
    "undo": cmd_undo,
    "redo": cmd_redo,
    "frame_selected": cmd_frame_selected,
    "stats": cmd_stats,
    "save_blend": cmd_save_blend,
    "look_at": cmd_look_at,
    "convert_to_mesh": cmd_convert_to_mesh,
    "add_cube": lambda: add_primitive("primitive_cube_add", ARGS.get("name") or "Cube", {"size": float(ARGS.get("size") or 2)}),
    "add_sphere": lambda: add_primitive("primitive_uv_sphere_add", ARGS.get("name") or "Sphere", {"radius": float(ARGS.get("radius") or ARGS.get("size") or 1)}),
    "add_ico_sphere": lambda: add_primitive("primitive_ico_sphere_add", ARGS.get("name") or "IcoSphere", {"radius": float(ARGS.get("radius") or ARGS.get("size") or 1)}),
    "add_cylinder": lambda: add_primitive("primitive_cylinder_add", ARGS.get("name") or "Cylinder", {"radius": float(ARGS.get("radius") or 1), "depth": float(ARGS.get("depth") or ARGS.get("height") or 2)}),
    "add_cone": lambda: add_primitive("primitive_cone_add", ARGS.get("name") or "Cone", {"radius1": float(ARGS.get("radius") or 1), "depth": float(ARGS.get("depth") or ARGS.get("height") or 2)}),
    "add_plane": lambda: add_primitive("primitive_plane_add", ARGS.get("name") or "Plane", {"size": float(ARGS.get("size") or 2)}),
    "add_grid": lambda: add_primitive("primitive_grid_add", ARGS.get("name") or "Grid", {"size": float(ARGS.get("size") or 2)}),
    "add_circle": lambda: add_primitive("primitive_circle_add", ARGS.get("name") or "Circle", {"radius": float(ARGS.get("radius") or 1)}),
    "add_torus": lambda: add_primitive("primitive_torus_add", ARGS.get("name") or "Torus"),
    "add_monkey": lambda: add_primitive("primitive_monkey_add", ARGS.get("name") or "Suzanne"),
    "add_empty": cmd_add_empty,
    "add_camera": cmd_add_camera,
    "align_camera_axis": cmd_align_camera_axis,
    "view_axis": cmd_view_axis,
    "camera_to_view": cmd_camera_to_view,
    "set_camera_lens": cmd_set_camera_lens,
    "add_light": cmd_add_light,
    "add_text": cmd_add_text,
    "clear_scene": cmd_clear_scene,
    "scale": cmd_scale,
    "bevel": cmd_bevel,
    "solidify": cmd_solidify,
    "extrude": cmd_extrude,
    "add_curve": cmd_add_curve,
    "add_armature": cmd_add_armature,
    "keyframe_insert": cmd_keyframe_insert,
    "set_frame": cmd_set_frame,
    "set_active_camera": cmd_set_active_camera,
    "track_to": cmd_track_to,
    "cursor_to_selected": cmd_cursor_to_selected,
    "randomize_transform": cmd_randomize_transform,
    "hide_render": cmd_hide_render,
    "subdivision": cmd_subdivision,
    "origin_to_geometry": cmd_origin_to_geometry,
}

try:
    fn = DISPATCH.get(str(CMD).strip())
    if not fn:
        emit({"ok": False, "error": "unknown blender command: " + str(CMD)})
    else:
        fn()
except Exception:
    emit({"ok": False, "error": traceback.format_exc()[-900:]})
