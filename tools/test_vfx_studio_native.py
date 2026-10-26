"""Real local skill API; VFX Studio/Studio UI is deliberately not simulated as success."""
from pathlib import Path
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request, urllib.error
ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('ELIO_TEST_BINARY',str(ROOT/'agent/target/debug'/('elio.exe' if os.name=='nt' else 'elio'))))
probe=socket.socket()
try:probe.bind(('127.0.0.1',3000))
except OSError:raise SystemExit('Port 3000 busy: refusing to stop another program')
finally:probe.close()
with tempfile.TemporaryDirectory(prefix='elio-vfx-native-') as temporary:
 base=Path(temporary);install=base/'install';install.mkdir();binary=install/BINARY.name
 shutil.copy2(BINARY,binary);shutil.copytree(ROOT/'elio-Extension',install/'elio-Extension')
 config=base/'config';config.mkdir()
 env={**os.environ,'LOCALAPPDATA':str(config),'XDG_CONFIG_HOME':str(config),'HOME':str(base),'ELIO_WORKSPACE_ROOT':str(base/'workspace')}
 env.pop('ELIO_GITHUB_TOKEN',None)
 with (base/'log.txt').open('w') as log:
  process=subprocess.Popen([str(binary),'--headless','--workspace',str(base/'workspace')],env=env,stdout=log,stderr=log)
  try:
   key=''
   for _ in range(150):
    file=config/'elio/bridge-key'
    if file.exists():
     key=file.read_text().strip()
     try:
      urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:3000/api/status',headers={'Authorization':'Bearer '+key}),timeout=1).close();break
     except OSError:pass
    if process.poll() is not None:raise AssertionError((base/'log.txt').read_text())
    time.sleep(.1)
   else:raise AssertionError('Test agent did not start')
   def call(body,auth=True):
    req=urllib.request.Request('http://127.0.0.1:3000/api/skills',data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+key} if auth else {})})
    try:
     with urllib.request.urlopen(req,timeout=45) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:
     raw=e.read().decode();return e.code,{'error':raw}
   assert call({'action':'list'},False)[0]==401
   status,rows=call({'action':'list'});assert status==200
   card=next(r for r in rows['skills'] if r['id']=='builtin-vfx-studio');assert card['enabled'] and not card['confirmed']
   fragments=[];offset=0
   while True:
    status,r=call({'action':'read','id':card['id'],'offset':offset,'limit':1000});assert status==200,(status,r)
    b=r['bundle'];fragments.append(b['content']);offset=b['next_offset']
    if offset is None:break
   assert ''.join(fragments)==(ROOT/'starter-skills/vfx-studio/SKILL.md').read_text()
   for file in ['NOTICE.txt','references/library-workflow.md','references/feature-analysis.md','references/sources.md','scripts/inspect_asset.luau']:
    status,r=call({'action':'read','id':card['id'],'resource':file,'limit':24000});assert status==200,(status,r)
    assert r['bundle']['content']==(ROOT/'starter-skills/vfx-studio'/file).read_text()
   assert call({'action':'read','id':card['id'],'resource':'../../config.json'})[0]==400
   for query,blender,wanted in [('Сделай эффект удара',False,True),('Create VFX for a spell',True,True),('Use VFX Studio',True,True),('Do not use VFX Studio',False,False),('Animate a CSS button',False,False),('Animate the character',False,False)]:
    status,r=call({'action':'match','domain':'roblox','query':query,'blender_available':blender});assert status==200,(status,r)
    assert any(s['id']==card['id'] for s in r['skills'])==wanted,(query,r)
   status,r=call({'action':'match','domain':'roblox','query':'Animate the character','blender_available':False});assert status==200 and any(s['id']=='builtin-eclipse-animator' for s in r['skills'])
   print('PASS real native VFX Studio skill API: authorization, built-in migration, complete paginated resources from packaged extension, traversal refusal, Russian/English library-first selection regardless of Blender, Eclipse coexistence. No Studio/plugin UI interaction performed.')
  finally:
   process.terminate()
   try:process.wait(timeout=8)
   except subprocess.TimeoutExpired:process.kill();process.wait()
