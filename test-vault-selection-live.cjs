// SPDX-License-Identifier: GPL-3.0-or-later
// Runs the real native API in an isolated temporary profile. No user data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'elio-vault-choice-')),base='http://127.0.0.1:3000';let proc,key,log='';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){proc=spawn(path.join(__dirname,'agent/target/debug/elio'),['--headless','--workspace',dir],{env:{...process.env,LOCALAPPDATA:dir,XDG_CONFIG_HOME:dir,HOME:dir}});proc.stdout.on('data',x=>log+=x);proc.stderr.on('data',x=>log+=x);for(let i=0;i<150;i++){await delay(100);const f=path.join(dir,'elio/bridge-key');if(fs.existsSync(f)){key=fs.readFileSync(f,'utf8');try{if((await fetch(base+'/',{headers:{Authorization:'Bearer '+key}})).ok)return;}catch{}}if(proc.exitCode!==null)break;}throw Error(log.slice(-1500));}
async function stop(){if(!proc||proc.exitCode!==null)return;const done=new Promise(r=>proc.once('exit',r));proc.kill('SIGTERM');await done;}
async function api(url,body){const r=await fetch(base+'/api/'+url,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};}
(async()=>{try{await start();const chat='notion|/chat?work',other='notion|/chat?other';
 for(const scope of ['project:Game','project:Elio']){const r=await api('vault',{action:'manual-save',scope,title:scope,text:'Isolated reference for '+scope,source:'Local integration fixture'});assert.equal(r.ok,true);}
 assert.equal((await api('checkpoints',{action:'project',chat,project:'Game'})).ok,true);
 assert.equal((await api('vault',{action:'select',chat,scope:'project:Missing'})).status,400);
 assert.equal((await api('vault',{action:'select',chat:'notion|',scope:'project:Elio'})).status,400);
 assert.equal((await api('vault',{action:'select',chat,scope:'project:Elio'})).vault_mode,'manual');
 let r=await api('vault',{action:'list',scope:'project:Game',chat});assert.equal(r.scope,'project:Elio');assert.equal(r.notes.length,1);assert.equal(r.notes[0].title,'project:Elio');
 assert.equal((await api('checkpoints',{action:'context',chat})).project,'Game');
 const written=await api('vault',{action:'save',scope:'project:Game',chat,title:'Pinned write',text:'Only belongs to Elio',source:'Local integration test'});assert.equal(written.ok,true,JSON.stringify(written));assert.equal(written.scope,'project:Elio');
 r=await api('vault',{action:'list',scope:'project:Game'});assert.equal(r.notes.length,1,'browsing another vault remains independent');
 r=await api('vault',{action:'context',scope:'project:Game',chat,budget:4500});assert.equal(r.scope,'project:Elio');
 r=await api('vault',{action:'list',scope:'project:Game',chat:other});assert.equal(r.notes.length,1);assert.equal(r.scope,'project:Game','another chat is not pinned');
 assert.equal((await api('vault',{action:'read',scope:'project:Game',chat:other,id:written.note.id})).status,400,'cross-vault read is rejected');
 await api('checkpoints',{action:'project',chat,project:'Changed'});assert.equal((await api('checkpoints',{action:'context',chat})).vault_scope,'project:Elio');
 await stop();await start();r=await api('checkpoints',{action:'context',chat});assert.equal(r.vault_scope,'project:Elio');assert.equal(r.vault_mode,'manual');
 r=await api('vault',{action:'select',chat,scope:''});assert.equal(r.vault_scope,'project:Changed');assert.equal(r.vault_mode,'auto');
 r=await api('vault',{action:'list',scope:'project:Game',chat});assert.equal(r.scope,'project:Game','auto preserves legacy/continuation routing');
 console.log('PASS real native vault routing: pinned read/context/write, other-chat isolation, independent browsing/project, invalid selection refusal, restart persistence, Auto reset.');
}finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
