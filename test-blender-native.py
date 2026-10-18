"""Native authenticated Blender transport against a local addon-protocol fixture, not real Blender."""
from pathlib import Path
import socket,threading,json,os,tempfile,subprocess,shutil,time,urllib.request,urllib.error
root=Path(__file__).resolve().parent
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1];mode='success';calls=[];halt=threading.Event()
def client(connection):
 with connection:
  data=connection.recv(8192);calls.append(json.loads(data));current=mode
  if current=='silent':halt.wait(10);return
  if current=='close':return
  if current=='invalid':connection.sendall(b'not json');return
  value=json.dumps({'status':'success','result':{'name':'Fixture scene','objects':[]}}).encode()
  connection.sendall(value[:15]);connection.sendall(value[15:]);halt.wait(.1)
def serve():
 while not halt.is_set():
  try:connection,_=listener.accept();threading.Thread(target=client,args=(connection,),daemon=True).start()
  except OSError:return
threading.Thread(target=serve,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='elio-blender-native-') as temporary:
 install=Path(temporary);name='elio.exe' if os.name=='nt' else 'elio';shutil.copy2(root/'agent/target/release'/name,install/name)
 config=install/'config';config.mkdir();env={**os.environ,'LOCALAPPDATA':str(config),'XDG_CONFIG_HOME':str(config),'ELIO_WORKSPACE_ROOT':str(install/'workspace'),'BLENDER_HOST':'127.0.0.1','BLENDER_PORT':str(port)}
 log=(install/'output.log').open('w');process=subprocess.Popen([str(install/name),'--headless'],env=env,stdout=log,stderr=log);key=''
 try:
  for _ in range(100):
   path=config/'elio/bridge-key'
   if path.exists():
    key=path.read_text()
    try:
     req=urllib.request.Request('http://127.0.0.1:3000/api/status',headers={'Authorization':'Bearer '+key});urllib.request.urlopen(req,timeout=1).close();break
    except OSError:pass
   time.sleep(.1)
  else:raise AssertionError('Native Blender fixture bridge did not start')
  def request(auth=True):
   req=urllib.request.Request('http://127.0.0.1:3000/api/blender',data=b'{"type":"get_scene_info","params":{}}',headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+key} if auth else {})})
   with urllib.request.urlopen(req,timeout=12) as response:return json.load(response)
  try:request(False);raise AssertionError('Blender route accepted an unauthenticated command')
  except urllib.error.HTTPError as error:assert error.code==401
  assert request()['ok'] and calls[-1]['type']=='get_scene_info';assert len(calls)==1
  for case in ['close','invalid','silent']:
   mode=case;count=len(calls);started=time.monotonic();result=request();assert not result['ok'],result;assert len(calls)==count+1,'A failed command must never be automatically replayed';assert time.monotonic()-started<10
  mode='success';assert request()['ok'],'A new socket must recover after a failed connection'
  print('PASS native Blender: auth rejection, real fragmented TCP response, wrong protocol, closed socket, bounded silent endpoint, no replay and recovery.')
 finally:
  halt.set();listener.close();process.terminate()
  try:process.wait(timeout=5)
  except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
  log.close()

