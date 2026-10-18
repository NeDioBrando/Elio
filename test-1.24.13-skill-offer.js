// 1.24.13: elio_skills action suggest shows a one-click "Save as skill"
// card; only the user's click saves (enabled, unverified). Automatic task
// candidates are off and favourites rank first.
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const manifest=JSON.parse(fs.readFileSync('manifest.json'));
const dom=new JSDOM('<!doctype html><html><body><main><form><div class="composer-surface"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"><p></p></div><button id="composer-submit-button" data-testid="send-button" aria-label="Send" type="submit">Send</button></div></form></main></body></html>',{url:'https://chatgpt.com/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
const w=dom.window,context=dom.getInternalVMContext();
let skills=[{id:'starter-syphodev-roblox-code',title:'roblox-code',description:'x',domain:'roblox',steps:['x'],revision:1}];const requests=[];
const answer=msg=>{if(msg?.type==='skills'){requests.push(msg.request);if(msg.request.action==='list')return{ok:true,skills:JSON.parse(JSON.stringify(skills))};if(msg.request.action==='save'){const skill={...msg.request.skill,revision:1};skills.push(skill);return{ok:true,skill};}}return{ok:true,connected:false,tools:[],servers:[]};};
const get=(_k,cb)=>{if(cb)queueMicrotask(()=>cb({}));return Promise.resolve({});};
w.chrome={runtime:{id:'test',getManifest:()=>manifest,getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(){}},sendMessage:(msg,cb)=>{const r=answer(msg);if(cb)queueMicrotask(()=>cb(r));return Promise.resolve(r);}},storage:{local:{get,set:()=>Promise.resolve(),remove:()=>Promise.resolve()},onChanged:{addListener(){}}}};
w.ResizeObserver=class{observe(){}disconnect(){}};w.setInterval=()=>1;w.clearInterval=()=>{};w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};w.console={log(){},warn(){},error(){}};
if(!w.crypto?.randomUUID)Object.defineProperty(w,'crypto',{value:{randomUUID:()=>'00000000-0000-4000-8000-000000000000',getRandomValues:a=>a}});
w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:700,width:700,height:60,right:900,bottom:760};};
const flush=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 for(const file of manifest.content_scripts.find(x=>x.js.includes('providers/chatgpt.js')&&x.js.includes('core/main.js')).js){let code=fs.readFileSync(file,'utf8');if(file==='core/main.js')code=code.replace('const TOKEN_CHARS = 4;','window.__skillFixture={runToolImpl,A}; const TOKEN_CHARS = 4;');vm.runInContext(code,context,{filename:file});}
 await flush();const fixture=w.__skillFixture;assert(fixture);
 const call=args=>fixture.runToolImpl({tool:'elio_skills',arguments:args});
 const offer=()=>w.document.querySelector('.rs-skill-offer');
 assert.match(String(await call({action:'suggest',title:'',steps:[]})),/needs a short title/);assert.equal(offer(),null);
 let out=String(await call({action:'suggest',title:'Use tabs for indentation',description:'Coding style',steps:['Indent Luau with tabs, never spaces.']}));
 assert.match(out,/"shown":true/);assert.match(out,/Do not save it yourself/);
 const card=offer();assert(card,'card shown');assert.equal(card.parentElement,w.document.documentElement);
 assert.match(card.textContent,/Save this as a skill\?/);assert.match(card.textContent,/Use tabs for indentation/);assert.match(card.textContent,/Indent Luau with tabs/);
 assert.equal(card.style.left,'200px','lined up with the chat box');assert.equal(card.style.bottom,'80px','sits just above the chat box, never over it');assert.equal(card.style.top,'auto');
 assert.equal(typeof card._rsTick,'function');card._rsTick(Date.now()+44000);assert(card.isConnected,'still open before 45 seconds');
 assert(!requests.some(r=>r.action==='save'),'nothing is saved before the click');
 out=String(await call({action:'suggest',title:'use TABS for indentation!',steps:['again']}));assert.match(out,/Already offered/);
 card.querySelector('.rs-skill-save').click();await flush();await flush();
 const saved=requests.find(r=>r.action==='save');assert(saved,'click saves');
 assert.equal(saved.skill.enabled,true,'used in future tasks');assert.equal(saved.skill.confirmed,false);assert.equal(saved.skill.scope,'','preferences apply to all projects by default');assert.equal(saved.skill.domain,'all');assert.match(saved.skill.id,/^skill-/);
 assert.match(card.textContent,/Saved “Use tabs for indentation”/);
 out=String(await call({action:'suggest',title:'roblox code',steps:['x']}));assert.match(out,/already exists/);assert.match(out,/"shown":false/);
 out=String(await call({action:'suggest',title:'Prefer early returns',steps:['Return early instead of nesting.'],project_only:true}));assert.match(out,/"shown":true/);
 const second=offer();assert.match(second.textContent,/in this project/);const saves=requests.filter(r=>r.action==='save').length;
 second._rsTick(Date.now()+46000);assert.equal(offer(),null,'closes by itself after 45 seconds');assert.equal(requests.filter(r=>r.action==='save').length,saves,'closing by itself saves nothing');
 out=String(await call({action:'suggest',title:'Name remotes clearly',steps:['Use verb-first RemoteEvent names.']}));assert.match(out,/"shown":true/);const third=offer();
 [...third.querySelectorAll('button')].find(b=>b.textContent==='Not now').click();assert.equal(offer(),null);assert.equal(requests.filter(r=>r.action==='save').length,saves);
 const main=fs.readFileSync('core/main.js','utf8'),rust=fs.readFileSync('agent/src/skills.rs','utf8'),ui=fs.readFileSync('core/skills-ui.js','utf8'),config=fs.readFileSync('core/config.js','utf8');
 assert(!/request:\{action:'checkpoint',checkpoint:id\}/.test(main),'no automatic candidate request after tasks');
 assert.match(rust,/"automatic task candidates are off"/);assert.match(rust,/s\.confirmed\|\|s\.enabled\|\|s\.favorite/);assert.match(rust,/if s\.favorite\{6\}else\{0\}/);assert.match(rust,/starred\.into_iter\(\)\.take\(8\)\.chain\(rest\.into_iter\(\)\.take\(3\)\)/,'favourites are always used');assert.match(main,/always_use:true/);
 assert(!ui.includes('data-sk="learn"'));assert.match(config,/one-click Save as skill button; never save it yourself/);
 assert.match(main,/if \(A\.waitingForClarification\) e\.classList\.remove\("rs-typing"\);/);
 console.log('1.24.13 skill offer: one-click Save as skill above the chat box, closes after 45 s, no automatic candidates, favourites always used');
 process.exit(0);
})().catch(error=>{console.error(error);process.exit(1);});
