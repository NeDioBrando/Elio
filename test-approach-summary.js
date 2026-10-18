const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
let enabled=false;const ctx=vm.createContext({window:{__rsShowApproach:()=>enabled},console});
vm.runInContext(fs.readFileSync('core/config.js','utf8')+';this.config=RS;',ctx);
for(const engine of ['local','roblox','an']){
 const off=ctx.config.buildSystemPrompt({engine});assert(!off.includes('VISIBLE APPROACH SUMMARY'));
 enabled=true;const on=ctx.config.buildSystemPrompt({engine});assert(on.includes('one short standard-text paragraph'));assert(on.includes('two newline characters'));assert(on.includes('not private internal reasoning'));assert(on.includes('Startup still follows its exact'));
 enabled=false;assert.equal(ctx.config.buildSystemPrompt({engine}),off);
}
assert(ctx.config.approachSummaryPolicy(false).includes('SHOW_APPROACH=OFF'));
vm.runInContext(fs.readFileSync('core/parser.js','utf8')+';this.parser=RSParse;',ctx);
const reply='I will inspect the current script first so I can preserve its working behavior.\n\n```json\n{"command":"script_read","params":{"path":"game.ServerScriptService.Main"}}\n```';
assert.equal(ctx.parser.parseToolCalls(reply).length,1);assert.equal(ctx.parser.parseToolCalls(reply)[0].tool,'script_read');
// Providers camouflage the command block while the public paragraph stays visible.
for(const name of ['chatgpt','notion']){
 const html='<div id="rs-root"></div><main><div data-message-author-role="assistant" data-agent-service-scroll-anchor="assistant-summary" style="justify-content:flex-start"><div class="markdown"><p id="public-summary">I will inspect the script before changing it.</p><div data-block-id="command-summary"><pre><code>{"command":"script_read","params":{"path":"game.ServerScriptService.Main"}}</code></pre></div></div></div></main>';
 const fixture=new JSDOM(html,{url:name==='chatgpt'?'https://chatgpt.com/c/test':'https://app.notion.com/chat/test',runScripts:'outside-only'}),fw=fixture.window;
 fw.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:600,height:40,right:600,bottom:40});
 vm.runInContext(fs.readFileSync('core/parser.js','utf8')+'\n'+fs.readFileSync('providers/'+name+'.js','utf8')+';this.provider=RSProvider;',fixture.getInternalVMContext());
 const item=fw.document.querySelector('[data-message-author-role=assistant]');
 if(name==='chatgpt')fw.provider.findToolBlockSpot(item);else fw.provider.renderImmutableChip(item,{label:'script_read',phase:'done'});
 const paragraph=fw.document.getElementById('public-summary');assert(!paragraph.closest('.rs-tool-hide,.rs-hidden,.rs-cmd-mask-all'));assert.notEqual(fw.getComputedStyle(paragraph).display,'none');assert.equal(paragraph.textContent,'I will inspect the script before changing it.');
 fixture.window.close();
}
const main=fs.readFileSync('core/main.js','utf8');assert(main.includes('showApproach = false'));assert(main.includes('data-mode="approach"'));assert(main.includes('SHOW_APPROACH=${approach}'));assert(main.includes('RS.approachSummaryPolicy(approach === "ON")'));assert(main.includes('window.__rsShowApproach = () => showApproach'));
const setter=main.slice(main.indexOf('    function setShowApproach('),main.indexOf('    function setExtraThinking('));const writes=[];let resends=0;
const setterCtx=vm.createContext({showApproach:false,chrome:{storage:{local:{set:v=>writes.push(v)}}},buildMenu(){},markModesChanged(){resends++;},toast(){}});vm.runInContext(setter,setterCtx);setterCtx.setShowApproach(true);assert.equal(writes[0].rsShowApproach,true);setterCtx.setShowApproach(false);assert.equal(writes[1].rsShowApproach,false);assert.equal(resends,2);
const dom=new JSDOM(fs.readFileSync('popup.html','utf8'),{runScripts:'outside-only'}),w=dom.window;let stored={},storageListener;
w.elioVersion={render(){}};
w.chrome={storage:{local:{get:async()=>stored,set:async v=>Object.assign(stored,v)},onChanged:{addListener:f=>storageListener=f}},tabs:{query:async()=>[],create(){},update(){}},runtime:{sendMessage:async()=>({engine:'roblox'}),getManifest:()=>({version:'1.24.5'}),getURL:p=>p,onMessage:{addListener(){}}}};
w.setInterval=()=>1;w.setTimeout=()=>1;
(async()=>{try{vm.runInContext(fs.readFileSync('popup.js','utf8'),dom.getInternalVMContext());await new Promise(r=>setImmediate(r));const button=w.document.getElementById('tgl-approach');assert(button);assert.equal(button.getAttribute('aria-checked'),'false');button.click();await new Promise(r=>setImmediate(r));assert.equal(stored.rsShowApproach,true);assert.equal(button.getAttribute('aria-checked'),'true');button.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await new Promise(r=>setImmediate(r));assert.equal(stored.rsShowApproach,false);storageListener({rsShowApproach:{newValue:true}},'local');assert.equal(button.getAttribute('aria-checked'),'true');
 const desktop=new JSDOM(fs.readFileSync('agent/src/desktop.html','utf8'));assert(desktop.window.document.querySelector('[data-pref=rsShowApproach]'));desktop.window.close();assert(fs.readFileSync('background.js','utf8').includes('"rsShowApproach"'));for(const p of ['background.js','popup.js','popup.html'])assert.equal(fs.readFileSync(p,'utf8'),fs.readFileSync('elio-Extension/'+p,'utf8'));
 console.log('PASS approach summaries default off, selected-only prompt, one parsed command, next-turn resend, persisted popup click/keyboard/live sync and desktop/extension parity.');
 }finally{w.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
