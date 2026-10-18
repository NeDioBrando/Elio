"""Authenticated native skills routes against a real locally compiled agent."""
from pathlib import Path
import json,os,shutil,tempfile,subprocess,time,urllib.request,urllib.error
root=Path(__file__).resolve().parent
binary=root/'agent/target/debug'/('elio.exe' if os.name=='nt' else 'elio')
with tempfile.TemporaryDirectory(prefix='elio-skills-native-') as temporary:
 install=Path(temporary)/'install';install.mkdir();shutil.copy2(binary,install/binary.name);shutil.copytree(root/'elio-Extension',install/'elio-Extension');binary=install/binary.name
 config=Path(temporary)/'config';config.mkdir();env={**os.environ,'LOCALAPPDATA':str(config),'XDG_CONFIG_HOME':str(config),'ELIO_WORKSPACE_ROOT':str(Path(temporary)/'workspace')}
 env.pop('ELIO_GITHUB_TOKEN',None)
 with (Path(temporary)/'agent.log').open('w') as log:
  process=subprocess.Popen([str(binary),'--headless'],env=env,stdout=log,stderr=log)
  try:
   key=''
   for _ in range(100):
    path=config/'elio/bridge-key'
    if path.exists():
     key=path.read_text()
     try:urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:3000/api/status',headers={'Authorization':'Bearer '+key}),timeout=1).close();break
     except OSError:pass
    time.sleep(.1)
   else:raise AssertionError('Agent did not start')
   def call(path,body,auth=True):
    request=urllib.request.Request('http://127.0.0.1:3000'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+key} if auth else {})})
    try:
     with urllib.request.urlopen(request,timeout=8) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:
     text=error.read().decode()
     try:body=json.loads(text)
     except json.JSONDecodeError:body={"error":text}
     return error.code,body
   request=urllib.request.Request('http://127.0.0.1:3000/desktop',headers={'Authorization':'Bearer '+key})
   with urllib.request.urlopen(request,timeout=8) as response: desktop=response.read().decode()
   for removed in ['Model Builder','UI Creator','modelWorkspace','uiWorkspace','elioCreatorUI','Mountbuilder']:
    assert removed not in desktop,removed
   assert 'elioToolkitUI' in desktop and '__ELIO_TOOLKIT_UI__' not in desktop
   assert call('/api/skills',{'action':'list'},False)[0]==401
   starters=call('/api/skills',{'action':'list'})[1]['skills'];assert len([x for x in starters if x['id'].startswith('starter-syphodev-')])==11
   assert len([x for x in starters if x['id'].startswith('bundled-ultragui-')])==8
   status,gui=call('/api/skills',{'action':'read','id':'bundled-ultragui-expert-gui','limit':100});assert status==200 and len(gui['bundle']['content'])==100 and gui['bundle']['next_offset']==100
   assert call('/api/skills',{'action':'read','id':'bundled-ultragui-expert-gui','resource':'../../bridge-key'})[0]==400
   status,reference=call('/api/skills',{'action':'read','id':'starter-syphodev-roblox-code','limit':100});assert status==200 and len(reference['bundle']['content'])==100 and reference['bundle']['next_offset']==100
   assert call('/api/skills',{'action':'read','id':'starter-syphodev-roblox-code','resource':'../../bridge-key'})[0]==400
   status,named=call('/api/skills',{'action':'save','skill':{'id':'ai-candidate','description':'Context-aware inventory UI. Reuse this game’s conventions.','domain':'roblox','steps':['Inspect the existing inventory','Adapt this project’s layout']}});assert status==200,named
   assert named['skill']['title']=='Context-aware inventory UI' and named['skill']['confirmed']==False
   assert any(s['id']=='ai-candidate' for s in call('/api/skills',{'action':'list'})[1]['skills'])
   skill={'id':'inventory','title':'Inventory','description':'Inventory menu','domain':'roblox','scope':'project:A','steps':['Inspect existing UI','Adapt the menu'],'pitfalls':[],'verification':['Test open/close'],'confirmed':True,'revision':0,'community':False}
   status,saved=call('/api/skills',{'action':'save','skill':skill,'revision':0});assert status==200 and saved['skill']['revision']==1,saved
   assert call('/api/skills',{'action':'save','skill':skill,'revision':0})[0]==400
   assert any(x['id']=='inventory' for x in call('/api/skills',{'action':'match','domain':'roblox','scope':'project:A','query':'inventory'})[1]['skills'])
   assert all(x['id']!='inventory' for x in call('/api/skills',{'action':'match','domain':'roblox','scope':'project:B','query':'inventory'})[1]['skills'])
   assert call('/api/skills',{'action':'export','id':'inventory'})[1]['skill']['scope']==''
   assert call('/api/skills',{'action':'publish','id':'inventory','reviewed':True,'revision':1})[0]==400
   status,task=call('/api/checkpoints',{'action':'begin','engine':'roblox','chat':'test|chat','label':'Build an inventory'});assert status==200,task
   assert call('/api/checkpoints',{'action':'finish','id':task['id'],'complete':True})[0]==200
   status,auto=call('/api/skills',{'action':'checkpoint','checkpoint':task['id']});assert status==200 and auto.get('skipped')==True and auto.get('reason'),auto
   status,candidate=call('/api/skills',{'action':'checkpoint','checkpoint':task['id'],'manual':True});assert status==200,candidate
   assert candidate['skill']['scope']=='chat:test|chat' and candidate['skill']['confirmed']==False
   assert all(x['id']!=candidate['id'] for x in call('/api/skills',{'action':'match','domain':'roblox','scope':'chat:test|chat','query':'inventory'})[1]['skills'])
   status,again=call('/api/skills',{'action':'checkpoint','checkpoint':task['id']});assert status==200 and again.get('skipped')==True and again.get('reason')=='automatic task candidates are off',again
   status,starred=call('/api/skills',{'action':'favorite','id':'inventory','favorite':True});assert status==200 and starred['skill']['favorite']==True,starred
   status,cleared=call('/api/skills',{'action':'delete_all'});assert status==200 and cleared['removed']>=1,cleared
   remaining={x['id'] for x in call('/api/skills',{'action':'list'})[1]['skills']}
   assert 'inventory' in remaining and candidate['id'] not in remaining and sum(1 for x in remaining if x.startswith('starter-syphodev-'))==11,remaining
   # Deleted Skills routes are authenticated, revision checked and isolated from active favourites.
   assert call('/api/skills',{'action':'list_deleted'},False)[0]==401
   draft={**skill,'id':'trash-route','title':'Trash route','revision':0,'favorite':False}
   status,item=call('/api/skills',{'action':'save','skill':draft,'revision':0});assert status==200,item
   assert call('/api/skills',{'action':'delete','id':'trash-route','revision':1})[0]==200
   removed=next(x for x in call('/api/skills',{'action':'list_deleted'})[1]['skills'] if x['id']=='trash-route');assert removed['revision']==2 and removed['scope']=='project:A'
   assert call('/api/skills',{'action':'restore','id':'trash-route','revision':1})[0]==400
   status,restored=call('/api/skills',{'action':'restore','id':'trash-route','revision':2});assert status==200 and restored['skill']['revision']==3,restored
   assert call('/api/skills',{'action':'delete','id':'trash-route','revision':3})[0]==200
   assert call('/api/skills',{'action':'purge','id':'trash-route','revision':4})[0]==400
   assert call('/api/skills',{'action':'purge','id':'trash-route','revision':4,'confirm':True})[0]==200
   assert call('/api/skills',{'action':'restore','id':'trash-route','revision':4})[0]==400
   trash=call('/api/skills',{'action':'list_deleted'})[1]
   assert call('/api/skills',{'action':'purge_all','confirm':True,'trash_revision':trash['trash_revision']+1})[0]==400
   assert call('/api/skills',{'action':'purge_all','confirm':True,'trash_revision':trash['trash_revision']})[0]==200
   assert not call('/api/skills',{'action':'list_deleted'})[1]['skills']
   assert any(x['id']=='inventory' for x in call('/api/skills',{'action':'list'})[1]['skills'])
   status,ultra=call('/api/skills',{'action':'read','id':'bundled-ultra-luau-performance','effort':'ultracode','limit':80});assert status==200 and len(ultra['bundle']['content'])==80 and ultra['bundle']['next_offset']==80,ultra
   assert call('/api/skills',{'action':'read','id':'bundled-ultra-luau-performance','resource':'../../bridge-key'})[0]==400
   assert call('/api/explorer',{'action':'write','id':'1;error()','source':'','expected':''})[0]==400
   print('PASS real native HTTP: auth, skill persistence, revision conflicts, project isolation, public export, sharing disabled, gated task candidates, favourites, delete all, Deleted Skills restore/confirmed purge, hidden Ultra pagination and Explorer input validation.')
  finally:
   process.terminate()
   try:process.wait(timeout=5)
   except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
