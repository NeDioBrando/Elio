"""Headless source contracts; opt-in real installed Blender + native bridge integration."""
from pathlib import Path
import os, json, time, subprocess, tempfile, urllib.request, urllib.error, threading, shutil
R=Path(__file__).resolve().parents[1]
worker=(R/'agent/src/blender_headless_worker.py').read_text(encoding='utf8')
native=(R/'agent/src/blender_headless.rs').read_text(encoding='utf8')
assert 'bpy.app.background' in worker and 'compare_digest' in worker
assert 'project_lock()' in worker and 'sys.stdin.buffer.read' in worker
assert '--background' in native and '--disable-autoexec' in native
assert 'render_preview' in worker and 'checkpoint()' in worker and 'load_scene()' in worker
assert 'KILL_ON_JOB_CLOSE' in (R/'agent/src/blender_headless_job.rs').read_text(encoding='utf8')
assert 'OwnedJob::attach' in native
for path in ['background.js','core/main.js']:
 assert (R/path).read_bytes()==(R/'elio-Extension'/path).read_bytes(),path
print('PASS headless contracts: embedded worker, auth, process ownership, project lock, checkpoint, on-demand preview, mirrored extension.')
exe=os.environ.get('ELIO_TEST_BLENDER');binary=os.environ.get('ELIO_TEST_NATIVE')
if not exe or not binary:
 print('Real Blender integration not requested (set ELIO_TEST_BLENDER and ELIO_TEST_NATIVE).');raise SystemExit(0)
with tempfile.TemporaryDirectory(prefix='elio-headless-native-') as temp:
 root=Path(temp);config=root/'config';config.mkdir();workspace=root/'workspace';workspace.mkdir()
 # A unique executable name avoids the app singleton colliding with another installation.
 app=root/('elio.exe' if os.name=='nt' else 'elio');shutil.copy2(binary,app)
 env={**os.environ,'LOCALAPPDATA':str(config),'XDG_CONFIG_HOME':str(config),'ELIO_WORKSPACE_ROOT':str(workspace)}
 log=(root/'native.log').open('w');proc=subprocess.Popen([str(app),'--headless'],env=env,stdout=log,stderr=log)
 key='';pids=[]
 try:
  for _ in range(150):
   path=config/'elio/bridge-key'
   if path.exists():
    key=path.read_text().strip()
    try:
     req=urllib.request.Request('http://127.0.0.1:3000/api/status',headers={'Authorization':'Bearer '+key});urllib.request.urlopen(req,timeout=1).close();break
    except OSError:pass
   if proc.poll() is not None:raise AssertionError((root/'native.log').read_text())
   time.sleep(.1)
  else:raise AssertionError('Native bridge startup timeout')
  def request(route,data,auth=True):
   req=urllib.request.Request('http://127.0.0.1:3000/api/'+route,data=json.dumps(data).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+key} if auth else {})})
   with urllib.request.urlopen(req,timeout=100) as response:return json.load(response)
  def control(action,**kw):return request('blender-headless',{'action':action,**kw})
  def call(kind='get_scene_info',params=None,**kw):return request('blender',{'type':kind,'params':params or {},**kw})
  def ok(result):assert result.get('ok'),result;return result
  def edit(code,**kw):return call('execute_code',{'code':code},**kw)
  try:request('blender-headless',{'action':'status'},False);raise AssertionError('Unauthenticated control accepted')
  except urllib.error.HTTPError as e:assert e.code==401
  assert not control('start',executable=exe,project='../escape')['ok']
  start=ok(control('start',executable=exe,project='regression',threads=2,idle_seconds=30));pids.append(start['pid'])
  assert ok(control('start',executable=exe,project='regression'))['pid']==start['pid']
  assert not control('start',executable=exe,project='different')['ok']
  scene=ok(call())['data'];assert scene['status']=='success' and scene['result']['backend']=='headless',scene
  result=ok(edit("bpy.ops.mesh.primitive_cube_add(); bpy.context.object.name='HeadlessProof'; print('checkpoint-proof')"));assert result['data']['status']=='success',result
  saved=Path(start['project'])/'scene.blend';assert saved.exists()
  result=ok(edit("bpy.data.objects.remove(bpy.data.objects['HeadlessProof'],do_unlink=True); raise ValueError('rollback test')"));assert result['data']['status']=='error'
  assert ok(call('get_object_info',{'name':'HeadlessProof'}))['data']['status']=='success'
  ok(control('cancel',request_id='before-send'));assert not edit("raise Exception('must not execute')",request_id='before-send')['ok'];assert ok(control('status'))['running']
  before=ok(call())['data']['result']['object_count'];png=root/'preview.png'
  preview=ok(call('render_preview',{'filepath':str(png),'max_size':128}))['data'];assert preview['status']=='success',preview
  assert png.read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
  assert ok(call())['data']['result']['object_count']==before
  fbx=root/'proof.fbx';result=ok(edit(f"bpy.ops.export_scene.fbx(filepath={str(fbx)!r}, use_selection=False)"));assert result['data']['status']=='success',result;assert fbx.stat().st_size>100
  print('PASS real Blender: authenticated native start, one process, project guards, edit/checkpoint, error rollback, CPU PNG, cleanup and FBX export.')
  # Idle exit is intentional and resumes the last checkpoint, without replaying an edit.
  time.sleep(33);idle=ok(control('status'));assert not idle['running'] and not idle['faulted'],idle
  result=ok(call());assert result['data']['status']=='success';resumed=ok(control('status'));assert resumed['pid']!=start['pid'];pids.append(resumed['pid'])
  assert ok(call('get_object_info',{'name':'HeadlessProof'}))['data']['status']=='success'
  results=[]
  thread=threading.Thread(target=lambda:results.append(edit("import time; time.sleep(20); bpy.context.scene['late_edit']=True",request_id='cancel-me')));thread.start();time.sleep(1)
  assert ok(control('cancel',request_id='other-request'))['running']
  stopped=ok(control('cancel',request_id='cancel-me'));assert not stopped['running'] and stopped['faulted'];thread.join(10);assert not thread.is_alive() and not results[0]['ok'],results
  assert not call()['ok'],'Canceled worker must not auto-resume or fall back to desktop'
  ok(control('start',executable=exe,project='regression',idle_seconds=30));assert ok(call())['data']['status']=='success'
  timeout=edit('import time; time.sleep(10)',timeout_seconds=1);assert not timeout['ok'] and 'timed out' in timeout['error'],timeout
  assert not ok(control('status'))['running'];assert not call()['ok']
  ok(control('start',executable=exe,project='regression',idle_seconds=30));pid=ok(control('status'))['pid']
  proc.kill();proc.wait(5)
  for _ in range(100):
   if os.name=='nt':
    # os.kill(pid, 0) is NOT a non-destructive process probe on Windows.
    import ctypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.restype=ctypes.c_void_p
    kernel.OpenProcess.argtypes=[ctypes.c_uint32,ctypes.c_int,ctypes.c_uint32]
    kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_uint32]
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.OpenProcess(0x00100000,False,pid)
    if not handle:break
    try:exited=kernel.WaitForSingleObject(handle,0)==0
    finally:kernel.CloseHandle(handle)
    if exited:break
   else:
    try:
     os.kill(pid,0)
     if Path(f'/proc/{pid}/stat').exists() and Path(f'/proc/{pid}/stat').read_text().split()[2]=='Z':break
    except ProcessLookupError:break
   time.sleep(.1)
  else:raise AssertionError('Blender survived native owner termination')
  print('PASS real lifecycle: idle unload/resume, scoped Stop, no desktop fallback/replay, timeout kill, saved recovery and owner-death cleanup.')
 finally:
  if proc.poll() is None:proc.terminate();proc.wait(10)
  log.close()
