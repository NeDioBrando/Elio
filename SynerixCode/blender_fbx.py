# Sent to Blender as execute_code. Placeholders:
#   __SYNERIXCODE_MODE__  export | import | dump
#   __SYNERIXCODE_FILE__  a Python string literal (r"..." or "")
#   __SYNERIXCODE_NAMES__ a Python list literal or None
import bpy
import json
import os
import traceback

MODE = """__SYNERIXCODE_MODE__"""
FILE = __SYNERIXCODE_FILE__
NAMES = __SYNERIXCODE_NAMES__


def enable_fbx():
    for mod in ("io_scene_fbx", "bl_ext.blender_org.io_scene_fbx"):
        try:
            bpy.ops.preferences.addon_enable(module=mod)
        except Exception:
            pass


def view_override():
    wm = bpy.context.window_manager
    if not wm:
        return {}
    for win in wm.windows:
        screen = win.screen
        if not screen:
            continue
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            for region in area.regions:
                if region.type == "WINDOW":
                    return {"window": win, "screen": screen, "area": area, "region": region}
    return {}


def run_op(op, **kwargs):
    ov = view_override()
    if ov:
        try:
            with bpy.context.temp_override(**ov):
                return op(**kwargs)
        except TypeError:
            pass
        except Exception:
            pass
    return op(**kwargs)


def default_path():
    home = os.path.expanduser("~")
    folder = os.path.join(home, "Documents", "synerixcode")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, "synerixcode_export.fbx")


def select_meshes(names):
    bpy.ops.object.select_all(action="DESELECT")
    count = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if names and obj.name not in names:
            continue
        obj.select_set(True)
        count += 1
        try:
            bpy.context.view_layer.objects.active = obj
        except Exception:
            pass
    if count == 0 and not names:
        bpy.ops.object.select_all(action="SELECT")
        count = sum(1 for o in bpy.data.objects if o.type == "MESH")
    return count


def dump_meshes(names):
    meshes = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if names and obj.name not in names:
            continue
        mesh = obj.data
        if mesh is None or len(mesh.vertices) == 0:
            continue
        mw = obj.matrix_world
        verts = []
        for v in mesh.vertices:
            c = mw @ v.co
            # Blender Z-up, Y-forward → Roblox Y-up, -Z-forward
            verts.append([round(float(c.x), 5), round(float(c.z), 5), round(float(-c.y), 5)])
        faces = []
        for p in mesh.polygons:
            ids = [int(i) for i in p.vertices]
            if len(ids) >= 3:
                faces.append(ids)
        if not faces:
            continue
        meshes.append({"name": obj.name, "verts": verts, "faces": faces, "tris": sum(max(0, len(f) - 2) for f in faces)})
        total_v = sum(len(m["verts"]) for m in meshes)
        if len(meshes) >= 24 or total_v >= 8000:
            break
    return meshes


def emit(payload):
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    print("SYNERIXCODE_MESH_JSON:" + text)
    # blender-mcp execute_code often returns the `result` name from exec()
    global result
    result = payload
    return payload


def do_export():
    enable_fbx()
    fp = (FILE or "").strip() or default_path()
    if not fp.lower().endswith(".fbx"):
        fp = fp + ".fbx"
    folder = os.path.dirname(fp)
    if folder:
        os.makedirs(folder, exist_ok=True)
    n = select_meshes(NAMES)
    if n == 0:
        return emit({"ok": False, "error": "no mesh objects to export", "filepath": fp})
    # Apply rotation/scale so Studio sees the same axes as the FBX settings.
    try:
        run_op(bpy.ops.object.transform_apply, location=False, rotation=True, scale=True)
    except Exception:
        pass
    kw = dict(
        filepath=fp,
        use_selection=True,
        apply_scale_options="FBX_SCALE_UNITS",
        axis_forward="-Z",
        axis_up="Y",
        apply_unit_scale=True,
        add_leaf_bones=False,
        bake_space_transform=True,
        object_types={"MESH", "ARMATURE", "EMPTY"},
    )
    try:
        run_op(bpy.ops.export_scene.fbx, **kw)
    except TypeError:
        kw.pop("object_types", None)
        run_op(bpy.ops.export_scene.fbx, **kw)
    except Exception as e:
        return emit({"ok": False, "error": "FBX export failed: " + str(e), "filepath": fp})
    meshes = dump_meshes(NAMES)
    exists = os.path.isfile(fp)
    size = os.path.getsize(fp) if exists else 0
    return emit({
        "ok": True,
        "filepath": fp,
        "bytes": size,
        "objects": [m["name"] for m in meshes],
        "mesh_count": len(meshes),
        "note": "Pass filepath to asset_bridge_import {source:'blender', asset: filepath}.",
    })


def do_import():
    enable_fbx()
    fp = (FILE or "").strip()
    if not fp:
        return emit({"ok": False, "error": "filepath is required to import an FBX into Blender"})
    if not os.path.isfile(fp):
        return emit({"ok": False, "error": "FBX not found: " + fp})
    before = set(bpy.data.objects.keys())
    try:
        run_op(bpy.ops.import_scene.fbx, filepath=fp, automatic_bone_orientation=True)
    except TypeError:
        run_op(bpy.ops.import_scene.fbx, filepath=fp)
    except Exception as e:
        return emit({"ok": False, "error": "FBX import failed: " + str(e), "filepath": fp})
    added = [k for k in bpy.data.objects.keys() if k not in before]
    return emit({"ok": True, "filepath": fp, "imported": added or [o.name for o in bpy.context.selected_objects]})


def do_dump():
    fp = (FILE or "").strip()
    if fp and os.path.isfile(fp) and fp.lower().endswith(".fbx"):
        before = set(o.name for o in bpy.data.objects if o.type == "MESH")
        if not before:
            try:
                do_import()
            except Exception:
                pass
    meshes = dump_meshes(NAMES)
    if not meshes:
        return emit({"ok": False, "error": "no mesh objects in the Blender scene to import into Studio"})
    return emit({"ok": True, "filepath": fp or "", "meshes": meshes, "objects": [m["name"] for m in meshes]})


try:
    if MODE == "import":
        do_import()
    elif MODE == "dump":
        do_dump()
    else:
        do_export()
except Exception:
    emit({"ok": False, "error": traceback.format_exc()[-800:]})
