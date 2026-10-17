"""Real Engram MCP and large streamed Roblox template requests in an isolated native installation."""
from pathlib import Path
import tempfile,os,subprocess,time,json,shutil,urllib.request,urllib.error,hashlib
source=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='synerixcode-memory-template-') as temporary:
 root=Path(temporary);config=root/'config';config.mkdir();workspace=root/'workspace';workspace.mkdir()
 name='synerixcode.exe' if os.name=='nt' else 'synerixcode'
 bundle=os.environ.get('SYNERIXCODE_TEST_BUNDLE')
 if bundle:
  shutil.copytree(bundle,root/'synerixcode.app');binary=root/'synerixcode.app/Contents/MacOS/synerixcode'
 else:
  binary=root/name;shutil.copy2(Path(os.environ.get('SYNERIXCODE_TEST_BINARY',str(source/'agent/target/debug'/name))),binary)
 platform='windows' if os.name=='nt' else 'darwin' if __import__('sys').platform=='darwin' else 'linux'
 arch='arm64' if __import__('platform').machine().lower() in ['arm64','aarch64'] else 'amd64'
 runtime=root/'runtime/engram';runtime.mkdir(parents=True)
 engram=runtime/f'engram-{platform}-{arch}{".exe" if os.name=="nt" else ""}'
 shutil.copy2(os.environ['SYNERIXCODE_TEST_ENGRAM'],engram);engram.chmod(0o755)
 env={**os.environ,'LOCALAPPDATA':str(config),'XDG_CONFIG_HOME':str(config),'SYNERIXCODE_WORKSPACE_ROOT':str(workspace)}
 output=(root/'output.log').open('w');process=subprocess.Popen([str(binary),'--headless'],env=env,stdout=output,stderr=output)
 try:
  keyfile=config/'synerixcode/bridge-key';key=''
  def request(path,body=None,raw=None):
   req=urllib.request.Request('http://127.0.0.1:3000'+path,data=raw if raw is not None else json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+key,'Content-Type':'application/octet-stream' if raw is not None else 'application/json'})
   with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
  for attempt in range(100):
   if process.poll() is not None:raise RuntimeError((root/'output.log').read_text())
   if keyfile.exists():
    key=keyfile.read_text()
    try:request('/api/status');break
    except OSError:pass
   time.sleep(.1)
  else:raise AssertionError('Native bridge did not start')
  def memory(action,scope='project:AlphaFixture',chat='chat:alpha',**kwargs):
   result=request('/api/engram',{'action':action,'scope':scope,'chat':chat,**kwargs});assert result['ok'],result;return result
  saved=memory('save',title='AlphaCombatUnique',content='Validated combat cooldown is 0.4 seconds in AlphaCombatUnique.',topic_key='combat/cooldown')
  alpha=json.loads(saved['text']);assert alpha['id']>0,alpha
  found=memory('search',query='AlphaCombatUnique');assert 'AlphaCombatUnique' in found['text'],found
  assert '0.4 seconds' in memory('read',id=alpha['id'])['text']
  assert 'AlphaCombatUnique' in memory('context')['text']
  other=memory('save',scope='project:BetaFixture',chat='chat:beta',title='BetaShopUnique',content='Validated shop uses BetaShopUnique currency.',topic_key='shop/currency')
  beta=json.loads(other['text']);assert 'AlphaCombatUnique' not in memory('read',scope='project:BetaFixture',chat='chat:beta',id=beta['id'])['text']
  assert 'No memories found' in memory('search',scope='project:BetaFixture',chat='chat:beta',query='AlphaCombatUnique')['text']
  task=request('/api/checkpoints',{'action':'begin','engine':'local','chat':'chat:alpha','label':'CheckpointFixtureUnique','request':'Inspect the Alpha combat implementation'})
  request('/api/checkpoints',{'action':'finish','id':task['id'],'complete':False})
  memory('checkpoint',checkpoint=task['id']);assert 'CheckpointFixtureUnique' in memory('search',query='CheckpointFixtureUnique')['text']
  request('/api/memory',{'action':'toggle','enabled':False})
  try:memory('save',title='BlockedAutomaticFixture',content='Must not persist.',topic_key='blocked');raise AssertionError('Automatic off ignored')
  except urllib.error.HTTPError as e:assert e.code==400
  assert 'No memories found' in memory('search',query='BlockedAutomaticFixture')['text']
  manual=memory('manual-save',title='ManualMemoryWhileOff',content='An explicit saved project fact.',topic_key='manual/fact')
  assert 'ManualMemoryWhileOff' in memory('search',query='ManualMemoryWhileOff')['text']
  memory('manual-remove',scope='project:BetaFixture',chat='chat:beta',id=beta['id'])
  assert 'No memories found' in memory('search',scope='project:BetaFixture',chat='chat:beta',query='BetaShopUnique')['text']
  assert 'AlphaCombatUnique' in memory('read',id=alpha['id'])['text']
  request('/api/memory',{'action':'toggle','enabled':True})
  large=request('/api/memory',{'action':'add','text':'\x00'*500000});assert len(large['memory']['entries'][0]['text'])==500000
  try:request('/api/memory',{'action':'add','text':'over capacity'});raise AssertionError('500K total limit ignored')
  except urllib.error.HTTPError as e:assert e.code==400
  request('/api/memory',{'action':'remove','id':large['memory']['entries'][0]['id']})
  request('/api/chat-history',{'chat_id':'chat:alpha','provider':'Fixture','history':[{'id':'u1','role':'user','text':'Exact logged request'}],'handoff':{'format':'synerixcode-chat-transfer','version':1,'history':[]}})
  assert request('/api/chat-history',{'action':'list'})['chats'][0]['messages']==1
  assert request('/api/chat-history',{'action':'export','chat_id':'chat:alpha'})['log']['history'][0]['text']=='Exact logged request'

  original=root/'LargeCombat.rbxmx';code='local CombatCooldown = {}; function CombatCooldown.ready(player) return true end; return CombatCooldown'
  with original.open('wb') as f:
   f.write(('<roblox version="4"><Item class="Folder" referent="RBX0"><Properties><string name="Name">CombatLibrary</string></Properties><Item class="ModuleScript" referent="RBX1"><Properties><string name="Name">CombatCooldown</string><ProtectedString name="Source"><![CDATA['+code+']]></ProtectedString></Properties></Item></Item><!--').encode())
   block=b' '*(2*1024*1024)
   for _ in range(65):f.write(block)
   f.write(b'--></roblox>')
  upload=request('/api/templates/upload',{'action':'upload-begin','name':original.name,'description':'Combat cooldown system','size':original.stat().st_size});id=upload['id'];offset=0
  try:request(f'/api/templates/upload/{id}?offset=1',raw=b'x');raise AssertionError('Wrong chunk offset accepted')
  except urllib.error.HTTPError as e:assert e.code==400
  with original.open('rb') as f:
   while chunk:=f.read(upload['chunk_bytes']):
    response=request(f'/api/templates/upload/{id}?offset={offset}',raw=chunk);offset+=len(chunk);assert response['received']==offset
  result=request('/api/templates/upload',{'action':'upload-finish','id':id});deadline=time.monotonic()+180
  while result['state']=='indexing' and time.monotonic()<deadline:
   time.sleep(.2);result=request('/api/templates/upload',{'action':'upload-status','id':id})
  assert result['state']=='complete',result
  matches=request('/api/templates',{'action':'match','query':'combat cooldown system'})['matches'];assert matches and matches[0]['source']==code,matches
  read=request('/api/templates',{'action':'read','id':matches[0]['id'],'path':matches[0]['path'],'script_id':matches[0]['script_id']});assert read['source']==code
  stored=config/'synerixcode/templates'/matches[0]['id']/'template.rbxmx'
  def digest(path):
   h=hashlib.sha256()
   with path.open('rb') as f:
    while data:=f.read(2*1024*1024):h.update(data)
   return h.hexdigest()
  assert digest(stored)==digest(original)
  print('PASS real Engram MCP save/search/read/context, project isolation, durable checkpoints, automatic-memory off/manual override/soft removal, 500K saved memory, saved log export; 130 MB streamed template, offset rejection, asynchronous indexing, system search, exact script read and preserved original SHA256.')
 finally:
  process.terminate()
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
  output.close()
