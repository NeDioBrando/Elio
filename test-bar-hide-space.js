// 1.19.39: hiding the bar must give the chat box back its native size. Before,
// the hidden bar stayed invisible but kept its reserved strip / top padding /
// widening, so the enlarged chat box still covered chat text. The bar itself
// must stay mounted, keep its geometry for the show tab and desktop state, and
// restore the exact reserved layout when shown again.
const {JSDOM,VirtualConsole}=require(process.env.SYNERIXCODE_TEST_JSDOM || 'jsdom');const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const root=__dirname;const manifest=JSON.parse(fs.readFileSync(root+'/manifest.json'));
const css=fs.readFileSync(root+'/overlay.css','utf8');
// jsdom cannot parse the whole production stylesheet (modern color syntax), so
// load the exact shipped rules this behavior depends on, read from overlay.css.
const pick=re=>{const m=re.exec(css);assert(m,'rule present in overlay.css: '+re);return m[0];};
const testCss=[pick(/#rs-bar\.rs-bar-inline \{[^}]*\}/),pick(/html\[data-rs-bar-collapsed\] #rs-bar,\s*html\[data-rs-bar-collapsed\] #rs-bar \*,[^{]*\{[^}]*\}/),pick(/html\[data-rs-bar-collapsed\] #rs-bar\.rs-bar-inline \{[^}]*\}/)].join('\n');
const urls={chatgpt:'https://chatgpt.com/',deepseek:'https://chat.deepseek.com/',claude:'https://claude.ai/new',notion:'https://www.notion.so/ai'};
assert(/html\[data-rs-bar-collapsed\] #rs-bar\.rs-bar-inline \{\s*position: absolute !important;\s*width: var\(--rs-collapsed-w, 100%\) !important;\s*margin: 0 !important;\s*\}/.test(css),'hidden inline bar leaves the composer flow with a pinned width');
assert(!/data-rs-bar-collapsed[^{]*\{[^}]*display:\s*none/.test(css),'collapse still never uses display:none');
async function load(provider){
 const dom=new JSDOM('<!doctype html><html><head><style>'+testCss+'</style></head><body><main><form><div class="composer-surface" style="border-radius:28px"><div id="prompt-textarea" class="ProseMirror content-editable-leaf-rtl" contenteditable="true" role="textbox" data-placeholder="Ask Notion AI"><p data-placeholder="Ask anything"></p></div><button id="composer-submit-button" data-testid="send-button" aria-label="Send" class="ds-button--primary" type="submit">Send</button></div></form></main></body></html>',{url:urls[provider],runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
 const w=dom.window,context=dom.getInternalVMContext(),listeners=[];
 const get=(_k,cb)=>{const d={};if(cb)queueMicrotask(()=>cb(d));return Promise.resolve(d);};
 w.chrome={runtime:{id:'test',getManifest:()=>manifest,getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:(msg,cb)=>{const r={ok:true,connected:false,tools:[],servers:[]};if(cb)queueMicrotask(()=>cb(r));return Promise.resolve(r);}},storage:{local:{get,set:()=>Promise.resolve(),remove:()=>Promise.resolve()},onChanged:{addListener(){}}}};
 w.ResizeObserver=class{observe(){}disconnect(){}};w.setInterval=()=>1;w.setTimeout=()=>1;w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};
 w.console={log(){},warn(){},error:(...x)=>process.stderr.write(x.map(String).join(' ')+'\n')};
 w.HTMLElement.prototype.getBoundingClientRect=function(){const editor=this.id==='prompt-textarea';return {left:200,top:editor?720:700,width:700,height:editor?40:120,right:900,bottom:editor?760:820};};
 Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return this.parentElement;}});
 Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{configurable:true,get(){return this.classList.contains('composer-surface')?700:0;}});
 for(const file of manifest.content_scripts.find(x=>x.js.includes('providers/'+provider+'.js')&&x.js.includes('core/main.js')).js) vm.runInContext(fs.readFileSync(root+'/'+file,'utf8'),context,{filename:file});
 await new Promise(r=>setImmediate(r));
 const d=w.document;
 const state=()=>new Promise(res=>{let done=false;for(const fn of listeners)fn({type:'rs-desktop-agent-state'},{},v=>{if(!done){done=true;res(v);}});setImmediate(()=>{if(!done)res(null);});});
 return {dom,w,d,bar:d.querySelector('#rs-bar'),card:d.querySelector('.composer-surface'),hide:d.querySelector('#rs-hide'),tab:d.querySelector('#rs-show-tab'),state,context};
}
const reserveRules=d=>[...d.querySelectorAll('style')].map(s=>s.textContent).filter(t=>t.length<800&&/\{box-sizing:border-box!important;padding-top:\d+px!important;min-height:\d+px!important\}/.test(t));
async function anchored(provider,expectReserve){
 const t=await load(provider);
 try{
  const {d,bar,card,hide,tab}=t;
  const reservedBefore=reserveRules(d),styleBefore=card.getAttribute('style');
  if(expectReserve==='stylesheet')assert.equal(reservedBefore.length,1,provider+': shown bar reserves its composer strip');
  else assert(/padding-top:\s*\d+px/.test(styleBefore),provider+': shown bar pads the composer');
  const parent=bar.parentElement,before=await t.state();
  hide.click();
  assert.equal(bar.parentElement,parent,provider+': hidden bar stays mounted');
  assert.equal(reserveRules(d).length,0,provider+': hidden bar releases the reserved strip');
  assert(!/padding-top|max-width/.test(card.getAttribute('style')||''),provider+': hidden bar removes padding and widening');
  assert(bar.style.display!=='none',provider+': hidden bar is not display:none');
  const hidden=await t.state();
  assert.equal(hidden.barCollapsed,true);assert.equal(hidden.barVisible,before.barVisible,provider+': desktop Start/Stop gate unchanged');
  assert(!tab.hidden,provider+': show tab is available');
  tab.click();
  assert.deepEqual(reserveRules(d),reservedBefore,provider+': showing restores the exact reserved strip');
  assert.equal(card.getAttribute('style'),styleBefore,provider+': showing restores the exact padding/widening');
  console.log(provider+': hiding returns the chat box to its native size; showing restores the bar strip.');
 }finally{t.dom.window.close();}
}
async function inline(provider){
 const t=await load(provider);
 try{
  const {w,d,bar,card,hide,tab}=t;
  // Drive the in-flow mount used by ChatGPT/DeepSeek/Kimi/Qwen/Arena layouts.
  vm.runInContext('RSProvider.barMount=()=>({parent:document.querySelector(".composer-surface"),before:document.querySelector("#prompt-textarea"),inside:true});',t.context);
  hide.click();tab.click();
  assert(bar.classList.contains('rs-bar-inline'),provider+': bar is mounted in the composer flow');
  assert.equal(bar.parentElement,card);
  assert.notEqual(w.getComputedStyle(bar).position,'absolute',provider+': shown inline bar is in flow');
  const widened=card.style.maxWidth;
  hide.click();
  assert.equal(bar.parentElement,card,provider+': hidden inline bar stays mounted');
  assert.equal(w.getComputedStyle(bar).position,'absolute',provider+': hidden inline bar no longer takes composer height');
  assert.equal(bar.style.getPropertyValue('--rs-collapsed-w'),'700px',provider+': hidden bar keeps the composer content width');
  assert.equal(card.style.maxWidth,'',provider+': widening is undone while hidden');
  assert.equal(w.getComputedStyle(bar).visibility,'hidden');assert.equal(w.getComputedStyle(bar).pointerEvents,'none');
  tab.click();
  assert.notEqual(w.getComputedStyle(bar).position,'absolute',provider+': showing puts the bar back in flow');
  assert.equal(bar.style.getPropertyValue('--rs-collapsed-w'),'',provider+': pinned width is cleared');
  assert.equal(card.style.maxWidth,widened,provider+': widening is restored exactly');
  console.log(provider+': hidden in-flow bar leaves the composer flow and restores exactly.');
 }finally{t.dom.window.close();}
}
(async()=>{
 await anchored('notion','stylesheet');
 await anchored('claude','inline-style');
 for(const p of ['chatgpt','deepseek'])await inline(p);
 console.log('Hide bar frees the chat box space on Notion, Claude, ChatGPT and DeepSeek without unmounting the bar.');
})().catch(e=>{console.error(e);process.exit(1);});
