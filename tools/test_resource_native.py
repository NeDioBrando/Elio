"""Isolated native agent load test. Never connects to the user's Studio or project."""
from pathlib import Path
import os,json,socket,subprocess,tempfile,time,urllib.request,urllib.error,statistics,shutil,sys
ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('ELIO_TEST_BINARY',str(ROOT/'agent/target/debug'/('elio.exe'if os.name=='nt'else'elio'))))
BASELINE=os.environ.get('ELIO_AUDIT_BASELINE_BINARY')
for port in [3000,17613,17615]:
 probe=socket.socket();probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 try:probe.bind(('127.0.0.1',port))
 except OSError:raise SystemExit(f'Port {port} busy; refusing to stop another program')
 finally:probe.close()
results=[]
for label,binary in ([('before',Path(BASELINE))]if BASELINE else[])+[('after',BINARY)]:
 with tempfile.TemporaryDirectory(prefix='elio-resource-audit-')as temp:
  base=Path(temp);install=base/'install';install.mkdir();exe=install/binary.name;shutil.copy2(binary,exe);shutil.copytree(ROOT/'elio-Extension',install/'elio-Extension');config=base/'config';config.mkdir();work=base/'workspace';work.mkdir();(work/'fixture.txt').write_text('x'*524288)
  fixture=base/'fixture.py';fixture.write_text('import sys,json\nfor line in sys.stdin:\n try:\n  v=json.loads(line);r={"capabilities":{}} if v.get("method")=="initialize" else {"tools":[]} if v.get("method")=="tools/list" else {"content":[{"type":"text","text":"{\\"studios\\":[]}"}]}\n  if "id" in v: print(json.dumps({"jsonrpc":"2.0","id":v["id"],"result":r}),flush=True)\n except Exception: pass\n')
  env={**os.environ,'LOCALAPPDATA':str(config),'XDG_CONFIG_HOME':str(config),'HOME':str(base),'ELIO_WORKSPACE_ROOT':str(work),'ELIO_MCP_COMMAND':f'{sys.executable} {fixture}','HTTPS_PROXY':'http://127.0.0.1:1','HTTP_PROXY':'http://127.0.0.1:1','NO_PROXY':'127.0.0.1,localhost'}
  with (base/'log').open('w')as log:
   process=subprocess.Popen([str(exe),'--headless','--workspace',str(work)],env=env,stdout=log,stderr=log)
   try:
    key=''
    def call(path,body=None):
     req=urllib.request.Request('http://127.0.0.1:3000'+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
     try:
      with urllib.request.urlopen(req,timeout=30)as r:return r.status,json.load(r)
     except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
    for _ in range(200):
     file=config/'elio/bridge-key'
     if file.exists():
      key=file.read_text().strip()
      try:
       if call('/api/status')[0]==200:break
      except OSError:pass
     if process.poll()is not None:raise AssertionError((base/'log').read_text())
     time.sleep(.1)
    else:raise AssertionError('Agent did not start')
    def rss():
     if sys.platform!='linux':return None
     for line in Path(f'/proc/{process.pid}/status').read_text().splitlines():
      if line.startswith('VmRSS:'):return int(line.split()[1])*1024
    start=time.monotonic();samples=[rss()];latencies=[];status_requests=0
    history=[{'id':f'm{i}','role':'assistant'if i%2 else'user','text':'Exact request and response 🐔 '*5}for i in range(1500)]
    capture={'chat_id':'chat|audit','provider':'fixture','history':history,'handoff':{'format':'elio-chat-transfer'}}
    assert call('/api/chat-history',capture)[0]==200
    for batch in range(3):
     for n in range(20):
      before=time.monotonic();assert call('/api/chat-history',capture)[0]==200;latencies.append((time.monotonic()-before)*1000)
      for _ in range(10):assert call('/api/status')[0]==200;status_requests+=1
     samples.append(rss())
    logdata=call('/api/chat-history',{'action':'export','chat_id':'chat|audit'})[1]['log'];assert len(logdata['history'])==1500 and logdata['omitted']==0
    ws_script=ROOT/'tools/test_resource_ws.cjs'
    ws=subprocess.run(['node',str(ws_script),key,label],env=os.environ,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=90)
    assert ws.returncode==0,ws.stdout
    # Test queue count AND byte backpressure without executing queued payloads.
    queued=0;refused=0
    for n in range(64):
     status,value=call('/api/push',{'id':f'queue-{n}','code':'-- inert fixture only\n'+('x'*200000)})
     if status==200:queued+=1
     else:assert status==429 and value['ok']is False;refused+=1
    if label=='after':assert queued<=32 and refused>0
    assert call('/api/status')[1]['roblox_queue']==queued
    for n in range(queued):assert call('/api/poll')[1]['payload']['id']==f'queue-{n}'
    assert call('/api/status')[1]['roblox_queue']==0
    until=start+float(os.environ.get('ELIO_AUDIT_SOAK_SECONDS','60'))
    while time.monotonic()<until:
     assert call('/api/status')[0]==200;status_requests+=1;time.sleep(.1)
    samples.append(rss());row={'label':label,'seconds':round(time.monotonic()-start,2),'status_requests':status_requests,'captures':61,'messages_per_capture':1500,'capture_median_ms':round(statistics.median(latencies),3),'capture_p95_ms':round(sorted(latencies)[int(.95*(len(latencies)-1))],3),'rss_samples_bytes':samples,'queue_accepted':queued,'queue_refused':refused,'websocket':ws.stdout.strip(),'archive_export_verified':True}
    if label=='after'and samples[-1]is not None:assert samples[-1]-samples[1]<64*1024*1024,'Unexpected post-warmup native memory growth'
    results.append(row)
    Path(os.environ.get('ELIO_AUDIT_NATIVE_OUTPUT','/data/audit-native-results.json')).write_text(json.dumps(results,indent=2))
   finally:
    process.terminate()
    try:process.wait(timeout=8)
    except subprocess.TimeoutExpired:process.kill();process.wait()
Path(os.environ.get('ELIO_AUDIT_NATIVE_OUTPUT','/data/audit-native-results.json')).write_text(json.dumps(results,indent=2));print(json.dumps(results))
