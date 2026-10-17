// SPDX-License-Identifier: GPL-3.0-or-later
// Ollama (127.0.0.1:11434) and the Roblox CSRF/authenticated requests had no
// timeout before 1.22.1: a server that accepted the connection but never
// answered left the Ollama page or a dev-product tool waiting forever. Runs the
// whole background.js on a virtual clock against hung and healthy endpoints.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const FILE=process.argv[2]||'background.js';
const PAGE=process.argv[3]||'ollama-page.js';
const source=fs.readFileSync(FILE,'utf8');
let now=0;const timers=new Map();let nextTimer=1;
const setTimeoutV=(fn,ms=0,...a)=>{const id=nextTimer++;timers.set(id,{at:now+Math.max(0,+ms||0),fn:()=>fn(...a)});return id;};
const setIntervalV=(fn,ms=0,...a)=>{const id=nextTimer++;const every=Math.max(1,+ms||0);const t={at:now+every,fn:()=>{t.at=now+every;timers.set(id,t);fn(...a);}};timers.set(id,t);return id;};
const clearV=id=>{timers.delete(id);};
class VAbortSignal extends EventTarget{constructor(){super();this.aborted=false;this.reason=undefined;}
  throwIfAborted(){if(this.aborted)throw this.reason;}
  static timeout(ms){const c=new VAbortController();setTimeoutV(()=>c.abort(Object.assign(new Error('The operation timed out.'),{name:'TimeoutError'})),ms);return c.signal;}
  static any(list){const c=new VAbortController();for(const s of list)s.addEventListener('abort',()=>c.abort(s.reason));return c.signal;}}
class VAbortController{constructor(){this.signal=new VAbortSignal();}
  abort(reason=Object.assign(new Error('aborted'),{name:'AbortError'})){const s=this.signal;if(s.aborted)return;s.aborted=true;s.reason=reason;s.dispatchEvent(new Event('abort'));}}
// mode: 'hang' = accept and never answer (only the signal ends it); 'ok' = healthy server.
let mode='hang';const seen=[];let unsignalled=0;
const hdrs=(o)=>({get:k=>o[String(k).toLowerCase()]||null});
function reply(url,options){
  if(url.endsWith('/api/tags'))return {ok:true,status:200,headers:hdrs({}),json:async()=>({models:[{name:'qwen2.5-coder:7b'}]}),text:async()=>''};
  if(url.endsWith('/api/chat'))return {ok:true,status:200,headers:hdrs({}),json:async()=>({message:{content:'hello from ollama'}}),text:async()=>''};
  if(url.includes('auth.roblox.com/v2/logout'))return {ok:false,status:403,headers:hdrs({'x-csrf-token':'tok1'}),text:async()=>''};
  if(url.includes('roblox.com')){const tok=options.headers&&options.headers['X-CSRF-TOKEN'];
    if(tok!=='tok2')return {ok:false,status:403,headers:hdrs({'x-csrf-token':'tok2'}),text:async()=>'{"errors":[{"code":0}]}'};
    return {ok:true,status:200,headers:hdrs({}),text:async()=>JSON.stringify({developerProducts:[{id:7,name:'Coins'}],universeId:42})};}
  return null;
}
function fetchV(url,options={}){
  url=String(url);
  if(url.endsWith('/api/pair'))return Promise.resolve({ok:true,status:200,json:async()=>({key:'a'.repeat(64)})});
  if(url.startsWith('http://127.0.0.1:3000'))return new Promise((_,rej)=>{const s=options.signal;if(s)s.addEventListener('abort',()=>rej(s.reason),{once:true});});
  const external=url.includes(':11434')||url.includes('roblox.com');
  if(!external)return new Promise(()=>{});
  seen.push(url);if(!options.signal)unsignalled++;
  if(mode==='ok')return Promise.resolve(reply(url,options));
  return new Promise((_,reject)=>{const s=options.signal;if(!s)return;
    if(s.aborted)reject(s.reason);else s.addEventListener('abort',()=>reject(s.reason),{once:true});});
}
const ev=()=>({addListener(){}});
const area=()=>({get:async()=>({}),set:async()=>{},remove:async()=>{}});
const local=area();local.get=(k,cb)=>{if(typeof cb==='function'){cb({});return;}return Promise.resolve({});};
let messageListener=null;
const chrome={runtime:{id:'test',getURL:()=>'chrome-extension://test/',onMessage:{addListener:fn=>{messageListener=fn;}},onStartup:ev(),onInstalled:ev(),
  sendMessage:()=>Promise.resolve(),getPlatformInfo:async()=>({os:'win'}),lastError:null},
  storage:{local,session:area(),onChanged:ev()},tabs:{query:async()=>[],get:async()=>null,sendMessage:async()=>null,update:async()=>{},onRemoved:ev(),onUpdated:ev(),onActivated:ev(),captureVisibleTab:async()=>''},
  windows:{getLastFocused:async()=>({focused:false})},scripting:{executeScript:async()=>[{}]},alarms:{create(){},onAlarm:ev()},action:{setBadgeText(){},setBadgeBackgroundColor(){}}};
class WS{constructor(){this.readyState=0;}send(){}close(){}addEventListener(){}}WS.OPEN=1;WS.CONNECTING=0;WS.CLOSED=3;
const box={chrome,fetch:fetchV,WebSocket:WS,AbortSignal:VAbortSignal,AbortController:VAbortController,setTimeout:setTimeoutV,setInterval:setIntervalV,clearTimeout:clearV,clearInterval:clearV,
  console:{log(){},warn(){},error(){},info(){},debug(){}},Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Blob,Event,EventTarget,crypto:require('crypto').webcrypto,
  structuredClone,queueMicrotask,atob,btoa,performance:{now:()=>now},navigator:{userAgent:'Chrome/140'},Date:class extends Date{constructor(...a){super(...(a.length?a:[now+1.7e12]));}static now(){return now+1.7e12;}}};
box.self=box;box.globalThis=box;vm.createContext(box);
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
async function advance(ms,step=250){const end=now+ms;while(now<end){now=Math.min(end,now+step);
  for(const [id,t] of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(t.at<=now&&timers.get(id)===t){timers.delete(id);t.fn();}}await flush();}}
async function ask(msg,maxMs,step){let answer=null,at=-1;const t0=now;
  messageListener(msg,{tab:{id:1,windowId:1}},r=>{answer=r;at=now-t0;});await flush();
  while(answer===null&&now-t0<maxMs)await advance(Math.min(step||250,maxMs-(now-t0)),step||250);
  return {answer,at};}
(async()=>{
  vm.runInContext(source,box,{filename:FILE});await flush();
  assert(messageListener,'message listener registered');
  // ---- Hung servers: every request ends at its deadline with a clear error.
  let r=await ask({type:'ollama_list_models'},30000);
  assert(r.answer,'ollama_list_models answered against a hung Ollama');
  assert(r.at<=6000,`model list bounded (${r.at} ms)`);
  assert.equal(r.answer.ok,false);assert(/did not answer/.test(r.answer.error),r.answer.error);
  r=await ask({type:'ollama_chat',model:'qwen2.5-coder:7b',messages:[{role:'user',content:'hi'}]},30000);
  assert(r.answer&&r.answer.ok===false&&r.answer.errKind==='no_server','chat against hung Ollama reports no_server after the tags deadline');
  assert(r.at<=6000,`chat pre-check bounded (${r.at} ms)`);
  // Healthy /api/tags but /api/chat hangs: bounded by the long chat deadline, not earlier.
  const realFetch=box.fetch;box.fetch=(u,o)=>String(u).endsWith('/api/tags')?(seen.push(String(u)),o&&o.signal||unsignalled++,Promise.resolve(reply(String(u),o||{}))):realFetch(u,o);
  r=await ask({type:'ollama_chat',model:'qwen2.5-coder:7b',messages:[{role:'user',content:'hi'}]},700000,5000);
  box.fetch=realFetch;
  assert(r.answer,'hung /api/chat is answered');
  assert(r.at>=595000&&r.at<=610000,`chat waits the full 10 min for a slow local model (${r.at} ms)`);
  assert.equal(r.answer.errKind,'timeout');assert(/TIMED OUT/.test(r.answer.error),r.answer.error);
  r=await ask({type:'list_dev_products',universeId:42},60000);
  assert(r.answer&&r.answer.ok===false,'list_dev_products answered against hung Roblox');
  assert(r.at<=45000,`Roblox CSRF + request bounded (${r.at} ms)`);
  assert(/Roblox did not answer within 20 s/.test(r.answer.error)&&!/[?#]/.test(r.answer.error),r.answer.error);
  r=await ask({type:'resolve_universe',placeId:99},120000);
  assert(r.answer&&r.answer.ok===false&&r.at<=110000,`resolve_universe bounded (${r.at} ms)`);
  assert.equal(unsignalled,0,'every Ollama and Roblox request carries an abort signal');
  // ---- Healthy servers: behavior unchanged.
  mode='ok';
  r=await ask({type:'ollama_list_models'},1000);
  assert(r.answer&&r.answer.ok&&r.answer.models[0].name==='qwen2.5-coder:7b'&&r.at===0,'model list unchanged');
  r=await ask({type:'ollama_chat',model:'qwen2.5-coder:7b',messages:[{role:'user',content:'hi'}]},1000);
  assert(r.answer&&r.answer.ok&&r.answer.text==='hello from ollama','chat unchanged');
  r=await ask({type:'ollama_chat',model:'gone:1b',messages:[]},1000);
  assert(r.answer&&r.answer.errKind==='model_not_found','stale model still reported');
  r=await ask({type:'list_dev_products',universeId:42},1000);
  assert(r.answer,'list_dev_products answered');
  const csrfRetries=seen.filter(u=>/developer-products/.test(u)).length;
  assert(csrfRetries>=2,'403 + new CSRF token still retries once');
  // ---- Static guarantees (also hold for the minified build).
  const page=fs.readFileSync(PAGE,'utf8');
  assert(/11434\/api\/tags['"]\s*,\s*\{\s*signal\s*:\s*AbortSignal\.timeout\(\s*(?:5000|5e3)\s*\)/.test(page),'Ollama page fallback fetch has a 5 s timeout');
  for(const m of source.matchAll(/fetch\(\s*["'`](https?:\/\/[^"'`]*(?:11434|roblox\.com)[^"'`]*)/g)){
    const tail=source.slice(m.index,m.index+400);assert(/signal\s*:/.test(tail.slice(0,tail.indexOf(')')+200)),'signal on '+m[1]);}
  console.log('PASS: hung Ollama and Roblox requests end at their deadlines; healthy servers behave as before.');
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
