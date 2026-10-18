"""Exercise the actual native bridge in an isolated temporary installation."""
from pathlib import Path
import os,subprocess,tempfile,time,json,urllib.request,shutil
root=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='elio-platform-') as temporary:
 install=Path(temporary);name='elio.exe' if os.name=='nt' else 'elio';shutil.copy2(Path(os.environ.get('ELIO_TEST_BINARY',str(root/'agent/target/release'/name))),install/name)
 workspace=install/'workspace';workspace.mkdir();config=install/'config';config.mkdir()
 env={**os.environ,'ELIO_WORKSPACE_ROOT':str(workspace),'LOCALAPPDATA':str(config),'XDG_CONFIG_HOME':str(config)}
 log=(install/'output.log').open('w');process=subprocess.Popen([str(install/name),'--headless'],env=env,stdout=log,stderr=log)
 try:
  keyfile=config/'elio/bridge-key';key=''
  for attempt in range(100):
   if process.poll() is not None:raise RuntimeError('Bridge exited: '+(install/'output.log').read_text())
   if keyfile.exists():
    key=keyfile.read_text()
    try:
     req=urllib.request.Request('http://127.0.0.1:3000/api/status',headers={'Authorization':'Bearer '+key})
     with urllib.request.urlopen(req,timeout=1) as response:status=json.load(response)
     break
    except OSError:pass
   time.sleep(.1)
  else:raise RuntimeError('Bridge did not bind within 10 seconds')
  def request(path,body=None,auth=True):
   req=urllib.request.Request('http://127.0.0.1:3000'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+key} if auth else {})})
   with urllib.request.urlopen(req,timeout=5) as response:return json.load(response)
  assert os.path.samefile(status['local_root'],workspace), (status['local_root'],str(workspace))
  try:request('/api/creations',{'action':'list'},False);raise AssertionError('Unauthenticated creator access was accepted')
  except urllib.error.HTTPError as error:assert error.code==401
  assert request('/api/creations',{'action':'list'})['ok']
  try:request('/api/toolkit',{'action':'backups'},False);raise AssertionError('Unauthenticated Toolkit access was accepted')
  except urllib.error.HTTPError as error:assert error.code==401
  assert request('/api/toolkit',{'action':'backups'})['records']==[]
  place=install/'saved.rbxl';place.write_bytes(b'original saved place')
  backup=request('/api/toolkit',{'action':'backup','path':str(place)})['record']
  place.write_bytes(b'new saved place')
  assert request('/api/toolkit',{'action':'restore','id':backup['id']})['ok']
  assert place.read_bytes()==b'original saved place'
  assert len(request('/api/toolkit',{'action':'backups'})['records'])==2
  try:request('/api/toolkit',{'action':'run','code':'return 42'});raise AssertionError('Offline Studio console accepted')
  except urllib.error.HTTPError as error:assert error.code==400

  draft={'build_id':'smoke','root_id':'root','root_name':'Smoke','mode':'model','nodes':[{'id':'root','class':'Model'},{'id':'part','parent':'root','class':'Part','properties':{'Size':{'type':'Vector3','x':2,'y':2,'z':2}}}]}
  assert request('/api/creations',{'action':'save','build_id':'smoke','revision':0,'blueprint':draft})['revision']==1
  assert '<roblox' in request('/api/creations',{'action':'export','build_id':'smoke','revision':1})['xml']
  assert 'blueprint' in request('/api/creations',{'action':'read','build_id':'smoke'})['record']
  request('/api/creations',{'action':'remove','build_id':'smoke','revision':1})
  html=urllib.request.urlopen('http://127.0.0.1:3000/desktop-ui',timeout=5).read().decode();assert '__ELIO_CREATOR_CORE__' not in html;assert 'pc-create-revision' in html
  subprocess.run(['node','test-bridges.js'],env={**env,'ELIO_TEST_KEY':key},check=True,timeout=25)
  print('PASS native startup, authenticated APIs, isolated workspace, creator persistence/export, unauthorized rejection and embedded desktop assets')
 finally:
  process.terminate()
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
  log.close()
