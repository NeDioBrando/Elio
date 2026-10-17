// Hide bar is visual only: hiding and showing must not change agent state,
// controls, mounting, desktop Start/Stop availability or bar placement.
const {JSDOM,VirtualConsole}=require(process.env.SYNERIXCODE_TEST_JSDOM || 'jsdom');const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const root=__dirname;const manifest=JSON.parse(fs.readFileSync(root+'/manifest.json'));
const urls={chatgpt:'https://chatgpt.com/',deepseek:'https://chat.deepseek.com/',claude:'https://claude.ai/new',notion:'https://www.notion.so/ai'};
const css=fs.readFileSync(root+'/overlay.css','utf8');
assert(/html\[data-rs-bar-collapsed\] #rs-bar,\s*html\[data-rs-bar-collapsed\] #rs-bar \*/.test(css),'collapsed bar and children are hidden');
assert(/visibility: hidden !important;\s*pointer-events: none !important;/.test(css),'collapsed bar is click-through, not removed from layout');
assert(!/data-rs-bar-collapsed[^{]*\{[^}]*display:\s*none/.test(css),'collapse never uses display:none (keeps mount and geometry)');
assert(/#rs-brand-stack > #rs-brand \{ flex: 0 0 auto !important; \}/.test(css),'narrow-viewport brand basis cannot become a height');
async function run(provider){
 const dom=new JSDOM('<!doctype html><html><body><main><form><div class="composer-surface" style="border-radius:28px"><div id="prompt-textarea" class="ProseMirror content-editable-leaf-rtl" contenteditable="true" role="textbox" data-placeholder="Ask Notion AI"><p data-placeholder="Ask anything"></p></div><button id="composer-submit-button" data-testid="send-button" aria-label="Send" class="ds-button--primary" type="submit">Send</button></div></form></main></body></html>',{url:urls[provider],runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
 const w=dom.window,context=dom.getInternalVMContext(),listeners=[];
 const get=(_k,cb)=>{const d={};if(cb)queueMicrotask(()=>cb(d));return Promise.resolve(d);};
 w.chrome={runtime:{id:'test',getManifest:()=>manifest,getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:(msg,cb)=>{const r={ok:true,connected:false,tools:[],servers:[]};if(cb)queueMicrotask(()=>cb(r));return Promise.resolve(r);}},storage:{local:{get,set:()=>Promise.resolve(),remove:()=>Promise.resolve()},onChanged:{addListener(){}}}};
 w.ResizeObserver=class{observe(){}disconnect(){}};w.setInterval=()=>1;w.setTimeout=()=>1;w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};
 w.console={log(){},warn(){},error:(...x)=>process.stderr.write(x.map(String).join(' ')+'\n')};
 w.HTMLElement.prototype.getBoundingClientRect=function(){const editor=this.id==='prompt-textarea';return {left:200,top:editor?720:700,width:700,height:editor?40:120,right:900,bottom:editor?760:820};};
 Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return this.parentElement;}});
 try{
  for(const file of manifest.content_scripts.find(x=>x.js.includes('providers/'+provider+'.js')&&x.js.includes('core/main.js')).js) vm.runInContext(fs.readFileSync(root+'/'+file,'utf8'),context,{filename:file});
  await new Promise(r=>setImmediate(r));
  const d=w.document,html=d.documentElement,bar=d.querySelector('#rs-bar');
  const state=()=>new Promise(res=>{let done=false;for(const fn of listeners){const r=fn({type:'rs-desktop-agent-state'},{},v=>{if(!done){done=true;res(v);}});if(r!==true&&!done){}}setImmediate(()=>{if(!done)res(null);});});
  const hide=d.querySelector('#rs-hide'),tab=d.querySelector('#rs-show-tab');
  assert(hide&&tab,provider+': hide button and show tab exist');
  assert(hide.closest('.rs-cluster-right'),provider+': hide button sits with the bar controls');
  assert(tab.hidden,provider+': show tab starts hidden');
  const controls=[...bar.querySelectorAll('button')].map(b=>b.id+':'+b.hidden+':'+b.disabled+':'+b.textContent.trim());
  const parent=bar.parentElement,before=await state();
  assert(before&&before.barVisible!==undefined,provider+': desktop state replies');
  hide.click();
  assert.equal(html.getAttribute('data-rs-bar-collapsed'),'1',provider+': collapse flag set');
  assert.equal(w.sessionStorage.getItem('synerixcode.barCollapsed'),'1',provider+': collapse remembered for this tab');
  assert.equal(bar.parentElement,parent,provider+': bar stays mounted in place');
  assert.notEqual(bar.style.display,'none',provider+': bar is not display:none');
  assert.deepEqual([...bar.querySelectorAll('button')].map(b=>b.id+':'+b.hidden+':'+b.disabled+':'+b.textContent.trim()),controls,provider+': every control is unchanged while hidden');
  const hiddenState=await state();
  assert.equal(hiddenState.barCollapsed,true,provider+': desktop sees collapse');
  assert.equal(hiddenState.barVisible,before.barVisible,provider+': desktop Start/Stop gate unaffected by hiding');
  for(const k of ['canStart','canStop','canEnhance','engine','chat']) assert.deepEqual(hiddenState[k],before[k],provider+': '+k+' unchanged while hidden');
  tab.click();
  assert(!html.hasAttribute('data-rs-bar-collapsed'),provider+': show restores bar');
  assert.equal(w.sessionStorage.getItem('synerixcode.barCollapsed'),null,provider+': restore clears tab memory');
  assert(tab.hidden,provider+': show tab hides again');
  assert.deepEqual([...bar.querySelectorAll('button')].map(b=>b.id+':'+b.hidden+':'+b.disabled+':'+b.textContent.trim()),controls,provider+': controls restored exactly');
  const after=await state();
  for(const k of ['barVisible','canStart','canStop','canEnhance','engine','chat']) assert.deepEqual(after[k],before[k],provider+': '+k+' restored');
  assert.equal(after.barCollapsed,false);
 }finally{dom.window.close();}
}
(async()=>{for(const p of ['chatgpt','deepseek','claude','notion'])await run(p);console.log('Hide bar is visual only on ChatGPT, DeepSeek, Claude and Notion: controls, mounting and desktop Start/Stop state are unchanged and restored exactly.');})().catch(e=>{console.error(e);process.exit(1);});
