"""Run the shipped Blender helpers inside a real Blender process."""
from pathlib import Path
import json, os, shutil, subprocess, sys, tempfile

root=Path(__file__).resolve().parent
for name in ['blender_ops.py','blender_once.py','blender_once.ps1']:
    assert (root/name).read_bytes()==(root/'elio-Extension'/name).read_bytes(), name
binary=os.environ.get('ELIO_BLENDER') or shutil.which('blender')
if not binary:
    if '--require' in sys.argv: raise SystemExit('A real Blender executable is required')
    raise SystemExit('SKIP: real Blender is unavailable on this host')
with tempfile.TemporaryDirectory(prefix='elio-blender-test-') as temporary:
    directory=Path(temporary)
    fixture=r'''
import bpy, json, math, pathlib
root=pathlib.Path(__ROOT__)
directory=pathlib.Path(__TEMP__)
template=(root/'blender_ops.py').read_text()
def operation(command, arguments):
    source=template.replace('__ELIO_CMD__',command).replace('__ELIO_ARGS__',json.dumps(arguments)).replace('__ELIO_OUT__',repr(str(directory/'receipt.json'))).replace('__ELIO_MESH__',repr(str(directory/'meshes.json')))
    scope={};exec(compile(source,'packaged-blender-ops.py','exec'),scope)
    return scope['result'], scope
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
receipt,scope=operation('add_cylinder',{'name':'Cylinder','location':[3,4,5],'depth':2})
assert receipt['ok'] and receipt['name']=='Cylinder',receipt
assert tuple(bpy.data.objects['Cylinder'].location)==(3,4,5)
for index in range(25):
    receipt,_=operation('add_cube',{'name':'Cube'+str(index),'location':[index,0,0]})
    assert receipt['ok'],receipt
bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=48)
bpy.context.active_object.name='Detailed sphere'
receipt,_=operation('dump',{'objects':[obj.name for obj in bpy.data.objects]})
assert receipt['ok'],receipt
assert len(receipt['meshes'])==27,len(receipt['meshes'])
assert any(len(mesh['verts'])>1800 for mesh in receipt['meshes'])
assert sum(len(mesh['verts']) for mesh in receipt['meshes'])>1800
for mesh in receipt['meshes']:
    assert all(len(face)==3 and all(0<=index<len(mesh['verts']) for index in face) for face in mesh['faces'])
    assert len(mesh['face_colors'])==len(mesh['faces'])
    if 'face_uvs' in mesh:assert len(mesh['face_uvs'])==len(mesh['faces'])
count=len(bpy.data.objects)
receipt,_=operation('dump',{'objects':['Missing object']})
assert not receipt['ok'] and 'not found' in receipt['error'],receipt
assert 'meshes' not in receipt and len(bpy.data.objects)==count
receipt,_=operation('add_cube',{'name':'Invalid','size':float('inf')})
assert not receipt['ok'] and len(bpy.data.objects)==count,receipt
# A failing operator is never invoked in a second context after mutation.
calls=[]
class FailingOperator:
    def poll(self):return True
    def __call__(self,**kwargs):calls.append(kwargs);raise RuntimeError('after mutation')
try:scope['run_op'](FailingOperator(),size=1)
except RuntimeError:pass
else:raise AssertionError('Operator error was hidden')
assert len(calls)==1,calls
(directory/'passed.json').write_text(json.dumps({'objects':27,'detailed_vertices':max(len(m['verts']) for m in json.loads((directory/'meshes.json').read_text())['meshes']) if (directory/'meshes.json').exists() else 'verified','version':bpy.app.version_string}))
print('ELIO_REAL_BLENDER_TEST_PASS',bpy.app.version_string)
'''
    # The dispatch writes its mesh export separately; inspect the successful
    # receipt before later error cases replace it.
    fixture=fixture.replace("'detailed_vertices':max(len(m['verts']) for m in json.loads((directory/'meshes.json').read_text())['meshes']) if (directory/'meshes.json').exists() else 'verified',",'')
    fixture=fixture.replace('__ROOT__',repr(str(root))).replace('__TEMP__',repr(str(directory)))
    script=directory/'fixture.py';script.write_text(fixture)
    result=subprocess.run([binary,'--background','--factory-startup','--python-exit-code','1','--python',str(script)],capture_output=True,text=True,timeout=180)
    if result.returncode or not (directory/'passed.json').exists():
        print((result.stdout+result.stderr)[-10000:]);raise SystemExit('Real Blender regression failed')
    print('PASS real packaged Blender primitives, all 27 objects, detailed geometry, UVs/colors, missing-object and invalid-number failures, and no operator replay:',(directory/'passed.json').read_text())
