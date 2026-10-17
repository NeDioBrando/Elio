// 1.19.39: the "continue your previous chat or start a new project" prompt has
// an on/off setting (default ON) in the bar settings and the desktop Settings
// page. Off never shows the prompt and closes an open one; on keeps the
// existing behavior. The preference syncs with the desktop app.
const {JSDOM,VirtualConsole}=require(process.env.SYNERIXCODE_TEST_JSDOM || 'jsdom');const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const root=__dirname;const manifest=JSON.parse(fs.readFileSync(root+'/manifest.json'));
const handoff={chat_id:'chatgpt|previous',provider:'ChatGPT',reason:'Latest captured chat',handoff:{has_user_request:true},history:[{role:'user',text:'Build a round system for my obby'}]};
async function run(stored){
 const dom=new JSDOM('<!doctype html><html><body><main><form><div class="composer-surface"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"><p></p></div><button id="composer-submit-button" data-testid="send-button" aria-label="Send" type="submit">Send</button></div></form></main></body></html>',{url:'https://chatgpt.com/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
 const w=dom.window,context=dom.getInternalVMContext(),intervals=[],changed=[];let data={rsLatestHandoff:handoff,...stored};
 const get=(keys,cb)=>{const d={};for(const k of [].concat(keys||Object.keys(data)))if(k in data)d[k]=data[k];if(cb)queueMicrotask(()=>cb(d));return Promise.resolve(d);};
 const set=v=>{const changes={};for(const [k,n] of Object.entries(v)){changes[k]={oldValue:data[k],newValue:n};data[k]=n;}for(const fn of changed)fn(changes,'local');return Promise.resolve();};
 w.chrome={runtime:{id:'test',getManifest:()=>manifest,getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(){}},sendMessage:(msg,cb)=>{const r={ok:true,connected:false,tools:[],servers:[]};if(cb)queueMicrotask(()=>cb(r));return Promise.resolve(r);}},storage:{local:{get,set,remove:()=>Promise.resolve()},onChanged:{addListener:fn=>changed.push(fn)}}};
 w.ResizeObserver=class{observe(){}disconnect(){}};w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};w.setTimeout=()=>1;w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};
 w.console={log(){},warn(){},error:(...x)=>process.stderr.write(x.map(String).join(' ')+'\n')};
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:700,width:700,height:120,right:900,bottom:820};};
 Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return this.parentElement;}});
 let now=1e12;vm.runInContext('Date.now=()=>globalThis.__now;',context);w.__now=now;
 for(const file of manifest.content_scripts.find(x=>x.js.includes('providers/chatgpt.js')&&x.js.includes('core/main.js')).js) vm.runInContext(fs.readFileSync(root+'/'+file,'utf8'),context,{filename:file});
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 // Only the offer tick (and other 1s ticks are guarded by an unstarted session).
 const ticks=intervals.filter(x=>x.ms===1000);
 const tick=async ms=>{w.__now+=ms;for(const t of ticks){try{t.fn();}catch{}}await new Promise(r=>setImmediate(r));};
 return {dom,w,d:w.document,tick,set,data};
}
const offer=d=>d.querySelector('.rs-continuation-offer');
(async()=>{
 for(const [label,stored] of [['default (no saved setting)',{}],['explicitly on',{rsContinuationOffer:true}]]){
  const t=await run(stored);
  try{await t.tick(1000);await t.tick(1000);await t.tick(2100);
   assert(offer(t.d),label+': the prompt appears in a fresh chat');
   assert.match(offer(t.d).textContent,/continue where you left off/);
   assert.match(offer(t.d).textContent,/start a new project/);
   await t.set({rsContinuationOffer:false});await t.tick(1000);
   assert.equal(offer(t.d),null,label+': turning the setting off closes an open prompt');
   await t.tick(3000);await t.tick(3000);
   assert.equal(offer(t.d),null,label+': and it stays closed');
   await t.set({rsContinuationOffer:true});await t.tick(1000);await t.tick(2100);
   assert(offer(t.d),label+': turning it back on shows the prompt again');
  }finally{t.dom.window.close();}
 }
 const off=await run({rsContinuationOffer:false});
 try{for(let i=0;i<6;i++)await off.tick(1500);assert.equal(offer(off.d),null,'off: the prompt never appears');}
 finally{off.dom.window.close();}
 // Bar settings control and desktop sync wiring.
 const main=fs.readFileSync(root+'/core/main.js','utf8'),bg=fs.readFileSync(root+'/background.js','utf8'),desk=fs.readFileSync(root+'/agent/src/desktop.html','utf8'),prefs=fs.readFileSync(root+'/agent/src/preferences.rs','utf8');
 assert(main.includes('id="rs-continuation-offer" type="checkbox"'),'bar settings has the toggle');
 assert(main.includes('["rs-continuation-offer","rsContinuationOffer"]'),'bar toggle saves the shared preference');
 assert(/"rsVisualCheck",\s*"rsContinuationOffer",/.test(bg),'extension syncs the preference with the desktop app');
 assert(desk.includes('<div class="toggle" data-pref="rsContinuationOffer"></div>'),'desktop Settings has the toggle');
 assert(/#\[serde\(rename = "rsContinuationOffer"\)\]\s*pub continuation_offer: bool/.test(prefs)&&prefs.includes('continuation_offer:true'),'desktop preference defaults to on');
 for(const f of ['core/main.js','background.js'])assert.equal(fs.readFileSync(root+'/'+f,'utf8'),fs.readFileSync(root+'/synerixcode-Extension/'+f,'utf8'),f+' copies are in sync');
 console.log('Continuation prompt toggle: on by default, off never prompts and closes an open prompt, synced between the bar and desktop settings.');
})().catch(e=>{console.error(e);process.exit(1);});
