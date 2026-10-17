// SPDX-License-Identifier: GPL-3.0-or-later
// A bridge on 127.0.0.1:3000 that accepts connections but never answers must
// not exhaust the browser's 6 HTTP/1.1 connections per host. Before 1.21.1 the
// background pollers had no timeout, pending requests piled up and the agent
// stalled on "Starting Up". Runs the whole background.js on a virtual clock.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const FILE=process.argv[2]||'background.js';
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
let pending=0,peak=0,total=0;
function fetchV(url,options={}){
  url=String(url);
  if(url.endsWith('/api/pair'))return Promise.resolve({ok:true,status:200,json:async()=>({key:'a'.repeat(64)})});
  if(!url.startsWith('http://127.0.0.1:3000'))return new Promise(()=>{});
  total++;pending++;peak=Math.max(peak,pending);
  return new Promise((_,reject)=>{const s=options.signal;if(!s)return; // hung forever
    const done=()=>{pending--;reject(s.reason);};if(s.aborted)done();else s.addEventListener('abort',done,{once:true});});
}
const listeners=[];const ev=()=>({addListener:fn=>listeners.push(fn)});
const area=()=>{const data={};return{get:async k=>{if(typeof k==='function')return k({});return {};},set:async v=>{Object.assign(data,v);},remove:async()=>{}};};
const local=area();local.get=(k,cb)=>{if(typeof cb==='function'){cb({});return;}return Promise.resolve({});};
const chrome={runtime:{id:'test',getURL:()=>'chrome-extension://test/',onMessage:{addListener:fn=>{messageListener=fn;}},onStartup:ev(),onInstalled:ev(),
  sendMessage:()=>Promise.resolve(),getPlatformInfo:async()=>({os:'win'}),lastError:null},
  storage:{local,session:area(),onChanged:ev()},tabs:{query:async()=>[],get:async()=>null,sendMessage:async()=>null,update:async()=>{},onRemoved:ev(),onUpdated:ev(),onActivated:ev(),captureVisibleTab:async()=>''},
  windows:{getLastFocused:async()=>({focused:false})},scripting:{executeScript:async()=>[{}]},alarms:{create(){},onAlarm:ev()},action:{setBadgeText(){},setBadgeBackgroundColor(){}}};
let messageListener=null;
class WS{constructor(){this.readyState=0;}send(){}close(){}addEventListener(){}}WS.OPEN=1;WS.CONNECTING=0;WS.CLOSED=3;
const box={chrome,fetch:fetchV,WebSocket:WS,AbortSignal:VAbortSignal,AbortController:VAbortController,setTimeout:setTimeoutV,setInterval:setIntervalV,clearTimeout:clearV,clearInterval:clearV,
  console:{log(){},warn(){},error(){},info(){},debug(){}},Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Blob,Event,EventTarget,crypto:require('crypto').webcrypto,
  structuredClone,queueMicrotask,atob,btoa,performance:{now:()=>now},navigator:{userAgent:'Chrome/140'},Date:class extends Date{constructor(...a){super(...(a.length?a:[now+1.7e12]));}static now(){return now+1.7e12;}}};
box.self=box;box.globalThis=box;vm.createContext(box);
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
(async()=>{
  vm.runInContext(source,box,{filename:FILE});
  await flush();
  // Bridge answered nothing; force the HTTP pipe on as if it had once replied.
  vm.runInContext('rustMode=true;',box);
  let samples=[];
  for(let t=0;t<60000;t+=250){
    now=t;for(const [id,timer] of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(timer.at<=now&&timers.get(id)===timer){timers.delete(id);timer.fn();}}
    await flush();samples.push(pending);
  }
  const steady=Math.max(...samples.slice(-40));
  console.log(`hung bridge 60 s: ${total} requests, peak ${peak} pending, steady ${steady}, end ${pending}`);
  assert(peak<6,`peak ${peak} simultaneous bridge requests would exhaust the 6-connection pool`);
  assert(steady<6,'steady-state pending requests stay under the pool limit');
  // A message whose handling throws must still be answered.
  assert(messageListener,'message listener registered');
  let answer=null;const sender={get tab(){throw new Error('boom');}};
  const keep=messageListener({type:'release-check'},sender,r=>{answer=r;});
  assert.equal(keep,true);await flush();
  assert(answer&&answer.ok===false&&/boom/.test(answer.error),'throwing message gets {ok:false,error}');
  // Static guarantees.
  assert(/BRIDGE_FETCH_TIMEOUT_MS\s*=\s*(?:15000|15e3)\b/.test(source),'default bridge timeout');
  assert(/options\.signal\s*\|\|\s*AbortSignal\.timeout\(BRIDGE_FETCH_TIMEOUT_MS\)/.test(source),'own signals win over the default');
  const at=source.search(/case\s*"rs-poll"/),poll=source.slice(at,at+source.slice(at).search(/case\s*"web_fetch"/));assert(at>=0,'rs-poll handler present');
  const ms=Number((poll.match(/AbortSignal\.timeout\(([\d.e]+)\)/)||[])[1]);
  assert(ms>25000,'rs-poll outlasts the bridge 25 s long poll so a queued payload is never dropped');
  console.log('PASS: hung bridge stays under the connection limit and every message is answered.');
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
