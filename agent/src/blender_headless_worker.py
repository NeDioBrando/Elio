# SPDX-License-Identifier: GPL-3.0-or-later
"""Elio-owned Blender background worker. bpy is used only on this main thread.
Not a Python sandbox: execute_code has the user's OS permissions, as in GUI mode.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
import traceback

import bpy
from mathutils import Vector

ROOT = Path(os.environ['ELIO_BLENDER_PROJECT'])
TOKEN = os.environ.pop('ELIO_BLENDER_TOKEN')
OWNER = int(os.environ['ELIO_BLENDER_OWNER'])
IDLE = int(os.environ.get('ELIO_BLENDER_IDLE', '120'))
THREADS = int(os.environ.get('ELIO_BLENDER_THREADS', '2'))
SCENE = ROOT / 'scene.blend'


def watch_owner():
    # Native owner keeps stdin open. EOF is portable, does not depend on PID reuse,
    # and terminates even if an arbitrary bpy operation has wedged the main thread.
    try:
        sys.stdin.buffer.read(1)
    finally:
        os._exit(0)


def checkpoint():
    pending = ROOT / 'checkpoint.pending.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(pending), check_existing=False, copy=True, compress=False)
    os.replace(pending, SCENE)


def load_scene():
    if SCENE.exists():
        bpy.ops.wm.open_mainfile(filepath=str(SCENE), load_ui=False, use_scripts=False)
    bpy.context.scene.render.threads_mode = 'FIXED'
    bpy.context.scene.render.threads = THREADS
    bpy.context.preferences.filepaths.save_version = 0


def info(obj):
    return {'name': obj.name, 'type': obj.type,
            'location': list(obj.location), 'rotation': list(obj.rotation_euler),
            'scale': list(obj.scale), 'visible': not obj.hide_render,
            'dimensions': list(obj.dimensions)}


def preview(args):
    # No viewport/GPU context is required. Preview is an explicit CPU render,
    # never a continuous redraw or a render on each mutation.
    scene = bpy.context.scene
    output = Path(args['filepath'])
    size = max(128, min(768, int(args.get('max_size', 512))))
    old = {k: getattr(scene.render, k) for k in ('engine', 'resolution_x', 'resolution_y', 'resolution_percentage', 'filepath', 'threads_mode', 'threads')}
    old_camera, old_format = scene.camera, scene.render.image_settings.file_format
    old_samples, old_device = scene.cycles.samples, scene.cycles.device
    old_denoise = scene.cycles.use_denoising
    staging = []
    try:
        if scene.camera is None:
            meshes = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
            corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
            center = sum(corners, Vector()) / len(corners) if corners else Vector()
            radius = max(((c-center).length for c in corners), default=2.0)
            camera = bpy.data.objects.new('_ElioPreviewCamera', bpy.data.cameras.new('_ElioPreviewCamera'))
            scene.collection.objects.link(camera); staging.append(camera)
            camera.location = center + Vector((1.25, -1.7, 1.2)).normalized() * max(radius*3.5, 3)
            camera.rotation_euler = (center-camera.location).to_track_quat('-Z', 'Y').to_euler()
            scene.camera = camera
        if not any(o.type == 'LIGHT' and not o.hide_render for o in scene.objects):
            light = bpy.data.objects.new('_ElioPreviewLight', bpy.data.lights.new('_ElioPreviewLight', 'AREA'))
            scene.collection.objects.link(light); staging.append(light)
            light.location = scene.camera.location
            light.rotation_euler = scene.camera.rotation_euler
            light.data.energy = 1200; light.data.shape = 'DISK'; light.data.size = 5
        scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'
        scene.cycles.samples = 8; scene.cycles.use_denoising = False
        scene.render.threads_mode = 'FIXED'; scene.render.threads = THREADS
        scene.render.resolution_x = scene.render.resolution_y = size
        scene.render.resolution_percentage = 100
        scene.render.filepath = str(output); scene.render.image_settings.file_format = 'PNG'
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists(): output.unlink()  # Unique requested path; never return an old image.
        bpy.ops.render.render(write_still=True)
        raw = output.read_bytes()
        receipt = {'filepath': str(output), 'size': [size, size], 'bytes': len(raw),
                   'sha1': hashlib.sha1(raw).hexdigest()[:12], 'method': 'headless-cycles-cpu',
                   'taken': time.strftime('%H:%M:%S')}
        return {'executed': True, 'result': 'ELIO_SHOT_JSON:'+json.dumps(receipt)}
    finally:
        scene.camera = old_camera
        for o in staging:
            data = o.data; kind = o.type
            bpy.data.objects.remove(o, do_unlink=True)
            if kind == 'CAMERA': bpy.data.cameras.remove(data)
            else: bpy.data.lights.remove(data)
        for k, v in old.items(): setattr(scene.render, k, v)
        scene.render.image_settings.file_format = old_format
        scene.cycles.samples = old_samples; scene.cycles.device = old_device
        scene.cycles.use_denoising = old_denoise


class BoundedOutput(io.StringIO):
    def write(self, text):
        text = str(text)
        if self.tell()+len(text)>1_000_000:
            tail = (self.getvalue()+text)[-500_000:]
            self.seek(0); self.truncate(0); super().write(tail)
            return len(text)
        return super().write(text)


def perform(kind, args):
    if kind == 'get_scene_info':
        return {'name': bpy.context.scene.name, 'objects': [info(o) for o in list(bpy.context.scene.objects)[:500]],
                'object_count': len(bpy.context.scene.objects), 'backend': 'headless',
                'blender_version': bpy.app.version_string, 'project_file': str(SCENE), 'threads': THREADS}
    if kind == 'get_object_info':
        obj = bpy.data.objects.get(args.get('name', ''))
        if obj is None: raise ValueError('Object not found')
        return info(obj)
    if kind == 'render_preview': return preview(args)
    if kind != 'execute_code': raise ValueError('Unsupported headless command: '+kind)
    code = args.get('code', '')
    if not isinstance(code, str) or len(code.encode('utf8')) > 1_500_000:
        raise ValueError('Python code exceeds 1.5 MB')
    output = BoundedOutput()
    try:
        with contextlib.redirect_stdout(output):
            exec(compile(code, '<elio-headless>', 'exec'), {'bpy': bpy, '__name__': '__main__'})
        # Do not save from Edit mode: checkpoint must be resumable without a UI.
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        checkpoint()
        return {'executed': True, 'result': output.getvalue()[-1_000_000:]}
    except BaseException:
        # Roll back Blender scene state, not arbitrary OS side effects of Python.
        load_scene()
        raise


def project_lock():
    stream = (ROOT / 'worker.lock').open('a+b')
    if os.name == 'nt':
        import msvcrt
        stream.seek(0); stream.write(b'0'); stream.flush(); stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    return stream


def main():
    if not bpy.app.background: raise RuntimeError('Worker requires --background')
    ROOT.mkdir(parents=True, exist_ok=True)
    lock = project_lock()  # Retained until process exit: two Elio instances must not overwrite one scene.
    if sys.platform.startswith('linux'):
        import ctypes
        ctypes.CDLL(None).prctl(1, 9)  # PR_SET_PDEATHSIG / SIGKILL also covers a blocked C operation.
        if os.getppid() != OWNER: return
    threading.Thread(target=watch_owner, daemon=True, name='Elio owner lifetime').start()
    load_scene()
    if not SCENE.exists(): checkpoint()
    server = socket.socket(); server.bind(('127.0.0.1', 0)); server.listen(4); server.settimeout(1)
    ready = ROOT / os.environ['ELIO_BLENDER_READY']
    ready.write_text(json.dumps({'pid': os.getpid(), 'owner': OWNER, 'port': server.getsockname()[1]}), encoding='utf8')
    last = time.monotonic()
    while time.monotonic()-last < IDLE:
        try: connection, _ = server.accept()
        except socket.timeout: continue
        with connection:
            connection.settimeout(5)
            try:
                raw = bytearray()
                while b'\n' not in raw:
                    chunk = connection.recv(8192)
                    if not chunk: raise ValueError('Incomplete request')
                    raw.extend(chunk)
                    if len(raw) > 2_000_000: raise ValueError('Request exceeds 2 MB')
                request = json.loads(raw.split(b'\n', 1)[0])
                if not secrets.compare_digest(str(request.get('token', '')), TOKEN):
                    raise PermissionError('Invalid worker token')
                last = time.monotonic()
                result = perform(request['type'], request.get('params') or {})
                reply = {'status': 'success', 'result': result}
            except BaseException as error:
                reply = {'status': 'error', 'message': str(error)[:4000], 'traceback': traceback.format_exc()[-8000:]}
            try: connection.sendall(json.dumps(reply, ensure_ascii=False).encode('utf8'))
            except OSError: pass
            # Idle timer starts after completion, not at the beginning of a render.
            last = time.monotonic()
    server.close()
    # All edits are already checkpointed. Avoid Blender teardown hooks keeping a
    # supposedly idle worker alive (or crashing in optional driver shutdown).
    sys.stdout.flush(); sys.stderr.flush()
    os._exit(0)


if __name__ == '__main__': main()
