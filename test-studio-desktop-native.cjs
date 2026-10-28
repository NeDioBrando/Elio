// SPDX-License-Identifier: GPL-3.0-or-later
// Actual authenticated Roblox websocket routing. Deliberately no Full PC grant,
// no Studio dependency and no input. Does NOT claim Windows UI acceptance.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {WebSocket}=require('ws');
const root=__dirname,source=process.env.ELIO_TEST_BINARY||path.join(root,'agent/target/debug',process.platform==='win32'?'elio.exe':'elio');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const free=port=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error(`Port ${port} busy; no process was stopped`)));s.listen(port,'127.0.0.1',()=>s.close(resolve));});
(async()=>{
 for(const p of [3000,17613,17615])await free(p);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'elio-studio-ui-test-'));let child,ws,logs='';
 try{
  const install=path.join(temp,'install');fs.mkdirSync(install);const binary=path.join(install,path.basename(source));fs.copyFileSync(source,binary,fs.constants.COPYFILE_FICLONE);
  fs.cpSync(path.join(root,'elio-Extension'),path.join(install,'elio-Extension'),{recursive:true});
  const env={...process.env,LOCALAPPDATA:temp,XDG_CONFIG_HOME:temp,HOME:temp,ELIO_WORKSPACE_ROOT:path.join(temp,'workspace')};delete env.ELIO_GITHUB_TOKEN;
  child=spawn(binary,['--headless','--workspace',path.join(temp,'workspace')],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',x=>logs=(logs+x).slice(-12000));child.stderr.on('data',x=>logs=(logs+x).slice(-12000));
  let key='';for(let i=0;i<150;i++){await delay(100);const f=path.join(temp,'elio/bridge-key');if(fs.existsSync(f)){key=fs.readFileSync(f,'utf8').trim();try{const r=await fetch('http://127.0.0.1:3000/api/status',{headers:{Authorization:'Bearer '+key}});if(r.ok)break;}catch{}}if(child.exitCode!==null)throw Error(logs);}
  assert(key,'Agent did not start');
  ws=new WebSocket('ws://127.0.0.1:17613',['elio','elio-auth.'+key]);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  let id=20;async function call(name){const request=++id;return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',on);reject(Error('Native route timeout '+logs));},6000);function on(raw){const v=JSON.parse(raw);if(v.id===request&&v.type==='tool_result'){clearTimeout(timer);ws.off('message',on);resolve(v);}}ws.on('message',on);ws.send(JSON.stringify({type:'call_tool',id:request,name,arguments:{studio_id:'deliberately-not-connected'}}));});}
  for(const name of ['studio_ui_snapshot','studio_ui_action']){
   const result=await call(name);assert.equal(result.ok,false);assert.match(result.error,/only in the Windows build|needs user-enabled Full PC access/);assert(!result.images);assert(!/unknown tool|MCP.*failed/i.test(result.error));
  }
  const prefsFile=path.join(temp,'elio/preferences.json');if(fs.existsSync(prefsFile)){const prefs=JSON.parse(fs.readFileSync(prefsFile));assert.notEqual(prefs.perm_mode,'full');}
  console.log('PASS actual authenticated Roblox WS -> native Studio desktop route, both tools fail before MCP/input when platform/Full PC is unavailable; no automatic access grant. No Studio/plugin UI tested.');
 }finally{
  if(ws)ws.terminate();if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),delay(7000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
