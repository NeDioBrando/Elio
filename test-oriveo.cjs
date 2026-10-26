// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('providers/oriveo.js','utf8');
const fixture=JSON.parse(fs.readFileSync('test-support/fixtures/oriveo-dom.json','utf8'));
let checks=0;const check=(name,fn)=>{fn();checks++;};
function load(html=fixture.turns.join('')+fixture.composer,url='https://app.oriveoai.com/chat/fixture-chat'){
 const d=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true}),w=d.window;
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:600,height:50});
 vm.runInContext(source+';globalThis.p=RSProvider;',d.getInternalVMContext());return d;
}
const body=(id,role,content)=>`<div data-message-id="${id}" data-message-role="${role}"><div data-role="${role}" role="article"><div class="MessageBubble_bubble__test">${content}</div><div data-role="${role}" class="MessageActions_actions"><button>Copy</button></div></div></div>`;
(async()=>{
 let d=load(),w=d.window,p=w.p;
 try{
 check('real DOM roles are deduplicated',()=>{assert.equal(p.userCount(),1);assert.equal(p.assistantCount(),1);assert.equal(p.allItems().length,2);});
 check('paragraphs unicode fences and control exclusion',()=>{const r=p.readAssistant().reply;assert.match(r,/Oriveo connection OK\n\nКириллица 🐔/);assert.match(r,/```json\n\{\n  "oriveo_test": "ok"\n\}\n```/);assert(!/Copy|Save as Note|NVIDIA/.test(r));});
 check('composer not recaptcha or sidebar',()=>{const trap=w.document.createElement('textarea');trap.id='g-recaptcha-response';w.document.body.prepend(trap);assert.match(p.getEditor().className,/InputComposer_textarea/);});
 check('stable ID after remount',()=>{const before=p.lastAssistantId(),el=p.lastAssistant();el.replaceWith(el.cloneNode(true));assert.equal(p.lastAssistantId(),before);});
 check('scrollback retained',()=>{p.lastAssistant().getBoundingClientRect=()=>({width:0,height:0});assert.equal(p.assistantCount(),1);});
 check('hidden duplicates excluded',()=>{const h=w.document.createElement('div');h.style.display='none';h.innerHTML=p.lastAssistant().outerHTML.replace('fixture-assistant','mobile-assistant');w.document.body.append(h);assert.equal(p.assistantCount(),1);});
 check('quiet generation stays busy',()=>{const stop=w.document.createElement('button');stop.setAttribute('aria-label','Stop generating');p.composerFrame().append(stop);const now=w.Date.now;w.Date.now=()=>now()+600000;assert.equal(p.isGenerating(),true);w.Date.now=now;stop.remove();assert.equal(p.isGenerating(),false);});
 check('typing indicator authoritative',()=>{const t=w.document.createElement('span');t.className='TypingIndicator_wrap';t.setAttribute('aria-label','Generating');p.lastAssistant().append(t);assert(p.isHardGenerating());t.remove();});
 check('lock restores prior state and placeholder',()=>{const e=p.getEditor();e.readOnly=true;const before=e.placeholder;p.setInputLock(true);p.setInputLock(false);assert.equal(e.readOnly,true);assert.equal(e.placeholder,before);e.readOnly=false;});
 check('tool masking preserves prose',()=>{const a=w.document.createElement('div');a.innerHTML=body('cmd','assistant','<p>Before</p><div class="CodeBlock_wrapper"><pre><code class="language-json">{"command":"list_commands"}</code></pre></div><p>After</p>');const el=a.firstChild;w.document.body.append(el);vm.runInContext(fs.readFileSync('core/parser.js','utf8')+';globalThis.parser=RSParse;',d.getInternalVMContext());const calls=w.parser.parseToolCalls(p.itemText(el));assert.equal(calls.length,1);assert.equal(calls[0].tool,'list_commands');assert(p.findToolBlockSpot(el));assert.match(p.itemText(el),/Before[\s\S]*After/);assert.match(el.querySelector('pre').parentElement.className,/rs-tool-hide/);el.remove();});
 check('code whitespace preserved',()=>{const a=w.document.createElement('div');a.innerHTML=body('code','assistant','<pre><code class="language-lua">local x = 1\n\n\nreturn x</code></pre>');assert.match(p.itemText(a.firstChild),/1\n\n\nreturn/);});
 check('saved key and no fresh chat memory collision',()=>{assert.equal(p.conversationKey(),'fixture-chat');w.history.replaceState({},'','/chat');assert.equal(p.conversationKey(),'');});
 check('vision truthful',()=>assert.equal(p.supportsVision,false));
 const e=p.getEditor();e.value='existing draft';await assert.rejects(p.typeAndSend('new'),/unsent draft/);check('unsent draft preserved',()=>assert.equal(e.value,'existing draft'));
 await assert.rejects(p.typeAndSend('new',[{data:'x'}]),/image upload/);check('image failure preserves draft',()=>assert.equal(e.value,'existing draft'));
 }finally{w.close();}
 // Send acknowledgement, no generic-submit fallback, concurrent call rejection.
 d=load();w=d.window;p=w.p;
 try{
 const b=p.composerFrame().querySelector('button[aria-label="Send"]');b.disabled=false;
 let clicks=0,trap=0;const sidebar=w.document.createElement('button');sidebar.type='submit';sidebar.onclick=()=>trap++;w.document.body.prepend(sidebar);
 b.onclick=()=>{clicks++;const e=p.getEditor(),text=e.value;e.value='';w.document.body.insertAdjacentHTML('beforeend',body('new-user','user',text));};
 const first=p.typeAndSend('Adapter send test 🐔');await assert.rejects(p.typeAndSend('duplicate'),/already sending/);await first;
 check('exactly one scoped send with receipt',()=>{assert.equal(clicks,1);assert.equal(trap,0);assert.equal(p.userCount(),2);});
 // Editor clearing alone is NOT an acknowledgement. Virtual immediate timers bound the wait.
 w.setTimeout=fn=>{queueMicrotask(fn);return 1;};let now=0;w.Date.now=()=>now+=120;
 b.onclick=()=>{clicks++;p.getEditor().value='';};
 await assert.rejects(p.typeAndSend('unconfirmed'),/uncertain/);
 check('unacknowledged send is not repeated',()=>assert.equal(clicks,2));
 b.disabled=true;await assert.rejects(p.typeAndSend('disabled'),/not ready/);
 check('disabled Send never falls back to sidebar',()=>{assert.equal(clicks,2);assert.equal(trap,0);});
 }finally{w.close();}
 // Native hook routing ignores unrelated submit controls, model/menu buttons and IME.
 d=load();w=d.window;p=w.p;try{
 let notified=0,stopped=0;p.installSendHooks({isBlocked:()=>false,isStarted:()=>true,onUserMessage:()=>notified++,onNativeStop:()=>stopped++,onBlockedAttempt:()=>{}});
 p.getEditor().value='hello';const b=p.composerFrame().querySelector('button[aria-label="Send"]');b.disabled=false;b.click();
 const trap=w.document.createElement('button');trap.type='submit';w.document.body.append(trap);trap.click();
 p.getEditor().dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
 const stop=w.document.createElement('button');stop.setAttribute('aria-label','Stop generating');p.composerFrame().append(stop);stop.click();
 check('native events route only intended actions',()=>{assert.equal(notified,1);assert.equal(stopped,1);});
 }finally{w.close();}
 const m=JSON.parse(fs.readFileSync('manifest.json')),origin='https://app.oriveoai.com/*';
 check('registered full content chain once',()=>{assert(m.host_permissions.includes(origin));const cs=m.content_scripts.filter(c=>c.js?.includes('providers/oriveo.js'));assert.equal(cs.length,1);assert.deepEqual(cs[0].matches,[origin]);assert(cs[0].js.includes('core/figma.js'));assert(cs[0].js.includes('core/memory.js'));assert(cs[0].js.indexOf('providers/oriveo.js')<cs[0].js.indexOf('core/main.js'));});
 check('debug scripts registered',()=>assert(m.content_scripts.slice(0,2).every(c=>c.matches.includes(origin))));
 check('extension parity',()=>{for(const f of ['providers/oriveo.js','manifest.json','core/main.js','background.js','popup.js'])assert.equal(fs.readFileSync(f,'utf8'),fs.readFileSync('elio-Extension/'+f,'utf8'));});
 check('app popup and pushes registered',()=>{for(const f of ['popup.js','background.js','core/main.js'])assert(fs.readFileSync(f,'utf8').includes('app.oriveoai.com'));assert(fs.readFileSync('agent/src/gui.rs','utf8').includes('"open:oriveo" => Some("https://app.oriveoai.com/chat")'));assert(fs.readFileSync('agent/src/desktop.html','utf8').includes('data-ipc="open:oriveo"'));});
 console.log(`PASS Oriveo: ${checks} checks (live-DOM fixture, roles, paragraphs/code, streaming, scoped single send, ambiguity, hooks, registration/parity)`);
})().catch(e=>{console.error(e);process.exitCode=1;});
