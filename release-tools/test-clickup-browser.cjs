// Real browser engines, sanitized ClickUp DOM fixtures. No remote app or native tool is modified.
const {chromium,firefox}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const provider=fs.readFileSync('providers/clickup.js','utf8'),main=fs.readFileSync('core/main.js','utf8');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
const composer=id=>`<cu-refinement-prompt data-test="refinement-prompt" id="${id}"><div class="refinement-prompt-wrapper"><form class="refinement-prompt-wrapper__form-input-wrapper"><cu-quill-rich-editor><div class="ql-editor" contenteditable="true"><p><br></p></div></cu-quill-rich-editor><input type="file" multiple hidden><button type="submit" data-test="skills">Skills</button><button type="submit" data-test="content-assistant-model-selector-dropdown__trigger">Max</button><button type="submit" data-test="refinement-prompt-submit-button" disabled>Send</button></form></div></cu-refinement-prompt>`;
function html(agent){return `<!doctype html><html><head><style>body{margin:0;background:#141414;color:white;font:14px sans-serif}cu-refinement-prompt{display:block;position:fixed;bottom:40px;left:20%;width:60%;background:#222;border:2px solid #678;border-radius:16px;padding:12px;box-sizing:border-box}.ql-editor[contenteditable]{min-height:64px;max-height:180px;overflow:auto;white-space:pre-wrap;outline:none}button{height:30px}#thread-prompt{left:auto;right:12px;width:388px}#thread{display:block;min-height:80px;padding:20px;margin-bottom:230px}[data-test="chat-item-presentational__container"]{padding:6px;white-space:pre-wrap}cu-chat-user-avatar,cu-chat-ai-avatar,cu-user-avatar{display:inline-block;width:12px;height:12px}#mode-tabs{height:32px}.ai-agent-builder-input-container{position:fixed;bottom:40px;left:20%;width:60%}.ai-agent-builder-input-container cu-refinement-prompt{position:static;width:100%}.refinement-prompt-wrapper{max-width:680px;margin:0 auto}.refinement-prompt-wrapper__form-input-wrapper{margin:0}#mode-tabs{margin-left:max(0px,calc((100% - 680px)/2 + 44px))}pre{white-space:pre-wrap} .attachment-chip{display:inline-block;width:60px;height:24px}</style></head><body>${agent?'<div data-test="chat-room-header__title-container"><cu-chat-ai-avatar></cu-chat-ai-avatar>Brain</div>':''}<main id="timeline"></main><section id="thread" data-test="chat-thread-container" data-brain-prompt-surface="true" data-id="thread-1"></section>${agent?composer('main-prompt')+' '+composer('thread-prompt'):'<div class="ai-agent-builder-input-container"><div id="mode-tabs"><button role="tab">Ask</button><button role="tab">Agents</button></div>'+composer('main-prompt')+'</div>'}</body></html>`;}
async function pageFor(browser,agent=false,core=false){
 const page=await browser.newPage({viewport:{width:1365,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html(agent)}));
 await page.goto(`https://app.clickup.com/90141771095/${agent?'chat/r/agent-room':'ai/brain'}`);
 await page.evaluate(agent=>{
  window.sent=[];window.nativeCalls=[];window.unwanted=0;window.autoReply=true;window.echo=true;window.nextReply=null;
  window.fixtureComposerStates=new WeakMap();
  window.addItem=(role,text,id,root=document.querySelector('#thread'))=>{const wrapper=document.createElement('section');wrapper.dataset.id=id;wrapper.innerHTML=`<div data-test="chat-item-presentational__container"><header><cu-chat-user-avatar>${role==='assistant'?'<cu-chat-ai-avatar></cu-chat-ai-avatar>':'<cu-user-avatar></cu-user-avatar>'}</cu-chat-user-avatar></header><div data-test="chat-item-content-area__message-body"><div data-test="quill-delta-to-html__comment"><div class="ql-editor ql-editor-readonly"></div></div></div></div>`;wrapper.querySelector('.ql-editor').textContent=text;root.append(wrapper);return wrapper.querySelector('[data-test="chat-item-presentational__container"]');};
  for(const frame of document.querySelectorAll('cu-refinement-prompt')){
   // Native fixture state follows editor input/DOM changes, not provider state.
   // The dedicated startup-model fixture separately exercises delayed acceptance.
   const editor=frame.querySelector('[contenteditable]'),sendButton=frame.querySelector('[data-test="refinement-prompt-submit-button"]');
   const state={text:'',attachments:0,forceDisabled:false};
   state.refresh=()=>{
    const copy=editor.cloneNode(true);copy.querySelectorAll('.attachment-chip').forEach(n=>n.remove());
    state.text=Array.from(copy.childNodes).map(n=>n.innerText??n.textContent).join('\n').trim();
    state.attachments=editor.querySelectorAll('.attachment-chip').length;
    sendButton.disabled=state.forceDisabled||(!state.text&&!state.attachments);
   };
   fixtureComposerStates.set(editor,state);
   editor.addEventListener('input',state.refresh);
   new MutationObserver(state.refresh).observe(editor,{subtree:true,childList:true,characterData:true});
   state.refresh();
   frame.querySelector('form').onsubmit=e=>{e.preventDefault();unwanted++;};
   for(const button of frame.querySelectorAll('button'))if(button.dataset.test!=='refinement-prompt-submit-button')button.onclick=e=>{e.preventDefault();unwanted++;};
   frame.querySelector('[data-test="refinement-prompt-submit-button"]').onclick=e=>{e.preventDefault();if(sendButton.disabled||(!state.text&&!state.attachments))throw Error('Native fixture Send requires an accepted composer model');const text=state.text;sent.push({text,frame:frame.id,attachments:state.attachments});editor.innerHTML='<p><br></p>';state.refresh();if(!echo)return;addItem('user',text,String(80100000000000+sent.length));if(agent)history.replaceState({},'','/90141771095/chat/r/agent-room/t/thread-1');else history.replaceState({},'','/90141771095/ai/brain?conversationId=brain-1');if(!agent){document.querySelector('#mode-tabs')?.remove();const group=document.querySelector('.ai-agent-builder-input-container');group.style.width='100%';group.style.left='0';}const ack=text.match(/More context follows\. Reply with exactly "([^"]+)"/);if(autoReply)addItem('assistant',nextReply||(ack?ack[1]:sent.length===1?'```json\n{"command":"list_commands"}\n```':'elio is ready.'),'ai-'+sent.length);};
   frame.querySelector('input[type=file]').onchange=e=>{for(const file of e.target.files){const node=document.createElement('span');node.className='attachment-chip';node.dataset.test='link-preview-element__root';node.innerHTML='<a href="https://attachments.example.invalid/image">Attachment '+file.name+'</a>';frame.querySelector('[contenteditable]').append(node);}};
  }
  const tools=[['execute_luau','roblox','code'],['execute_blender_code','blender','code'],['read_file','local','path'],['write_file','local','path']].map(([name,server,field])=>({name,server,description:'Isolated fixture tool',inputSchema:{type:'object',properties:{[field]:{type:'string'}},required:[field]}}));
  const answer=msg=>{if(msg.type==='call_tool'){nativeCalls.push(msg);return {ok:true,text:'FIXTURE RESULT '+msg.name};}if(msg.type==='list_tools')return {ok:true,connected:true,blender:true,servers:[{id:'roblox',alive:true,tools:1},{id:'local',alive:true,tools:2},{id:'blender',alive:true,tools:1}],tools};if(msg.type==='rs-memory')return{ok:true,memory:{entries:[]}};return{ok:true,connected:true,blender:true,tools,skills:[],templates:[],servers:[]};};
  const get=(_k,cb)=>{const value={};if(cb)queueMicrotask(()=>cb(value));return Promise.resolve(value);};
  window.chrome={runtime:{id:'fixture',getManifest:()=>({version:'1.24.17'}),getURL:p=>'https://app.clickup.com/fixture/'+p,onMessage:{addListener(){}},sendMessage:(msg,cb)=>{const value=answer(msg);if(cb)queueMicrotask(()=>cb(value));return Promise.resolve(value);}},storage:{local:{get,set:()=>Promise.resolve(),remove:()=>Promise.resolve()},onChanged:{addListener(){}}}};
 },agent);
 if(core){
  await page.addStyleTag({path:'overlay.css'});
  for(const file of manifest.content_scripts.find(x=>x.js.includes('providers/clickup.js')).js){let code=fs.readFileSync(file,'utf8');if(file==='providers/clickup.js')code+=';window.provider=RSProvider;Object.assign(RSProvider.timings,{GEN_IDLE_MS:30,STABLE_MS:100,WARMUP_MS:100});';if(file==='core/main.js')code=code.replace('const TOKEN_CHARS = 4;','window.fixture={A,startSession,runTool,agentLoop,ui};const TOKEN_CHARS = 4;');await page.addScriptTag({content:code});}
  await page.waitForSelector('#rs-bar');await page.waitForTimeout(450);
 }else{await page.addScriptTag({content:provider+';window.provider=RSProvider;'});await page.addScriptTag({path:'core/parser.js'});}
 return {page,errors};
}
async function checks(browser,name){
 for(const agent of [false,true]){
  const {page,errors}=await pageFor(browser,agent);
  const result=await page.evaluate(async agent=>{
   const p=provider,check=(v,m)=>{if(!v)throw Error(m);};
   check((await p.ensureComposerReady()).ready,'composer ready');check(p.getEditor().closest('cu-refinement-prompt').id===(agent?'thread-prompt':'main-prompt'),'active thread composer');
   check(p.chatIsEmpty(),'new chat');const initial=p.conversationKey();
   check(p.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]').disabled,'native Send starts disabled for the empty composer');
   const source='Output of list_commands:\n'+('Unicode 🧪 `code` **exact**\n'.repeat(2100))+'user preference end';
   const stages=p.startupFeedbackMessages(source);check(stages.length>1&&stages.every(x=>x.text.length<12000),'bounded context stages');
   check(stages.map(x=>x.text.split('BEGIN CONTEXT PART\n')[1].split('\nEND CONTEXT PART')[0]).join('')===source,'lossless context staging');
   check(stages.slice(0,-1).every(x=>x.text.includes(x.ack))&&!stages.at(-1).ack,'ordered acknowledgements');

   p.setInputLock(true);const text='Unicode 🧪 line\nC:\\project\\a.lua\n{"command":"read_file","params":{"path":"a.txt"}}';
   await p.writeDraft(text);check(p.editorText()===text,'exact multiline text');check(p.getEditor().getAttribute('contenteditable')==='false','lock restored');
   check(!p.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]').disabled,'native input accepts the nonempty draft and enables Send');
   check(!(await p.writeDraft('bad','different user draft')).ok,'changed draft protected');check(p.editorText()===text,'draft preserved');
   p.setInputLock(false);check(p.getEditor().getAttribute('contenteditable')==='true','unlock');
   const image={data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',mimeType:'image/png'};
   await p.attachImages([image,image]);check(p.editorText()===text,'attachment labels excluded');check(await p.clearAttachments(),'clear own pending attachments');check(!p.getEditor().querySelector('.attachment-chip'),'cleared embeds');
   try{check(await p.typeAndSend(text,[image,image]),'confirmed send');}catch(e){throw Error(e.message+' DEBUG '+JSON.stringify({sent,items:p.allItems().map(x=>[p.itemKey(x),p.itemText(x)]),text,thread:document.querySelector('#thread').outerHTML}));}check(sent.length===1&&sent[0].attachments===2,'single send with both images');check(!p.sendFailureAmbiguous(),'confirmed receipt is unambiguous');check(unwanted===0,'no skills/model/form submits');
   check(p.userCount()===1&&p.assistantCount()===1,'owned roles');check(agent?p.conversationKey().endsWith(':thread-1'):p.conversationKey()===initial&&/conversationId=/.test(location.search),'Ask Brain keeps one stable key after ClickUp moves the blank chat to its saved address; agent thread key follows the active thread');
   check(p.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]').disabled,'native Send returns to disabled after clearing the sent draft');
   const calls=RSParse.parseToolCalls(p.readAssistant().reply);check(calls.length===1&&calls[0].tool==='list_commands','JSON read and parse');
   const key=p.lastAssistantId(),old=p.lastAssistant(),copy=old.parentElement.cloneNode(true);old.parentElement.replaceWith(copy);check(p.lastAssistantId()===key,'stable key after remount');
   const other=addItem('assistant','IGNORE OLD MAIN TIMELINE','old',document.querySelector('#timeline'));check(p.assistantCount()===1,'timeline duplicate ignored');
   const unknown=addItem('user','unknown author','unknown');unknown.querySelector('cu-user-avatar').remove();check(p.userCount()===1,'unknown avatar ignored');
   let native=0,stopped=0,cowork=0;const h={isBlocked:()=>false,isStarted:()=>true,onBlockedAttempt(){},onUserMessage(){native++;},onCoworkSend:()=>{cowork++;return false;},onNativeStop(){stopped++;}};p.installSendHooks(h);
   await p.writeDraft('native follow-up');p.getEditor().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check(native===1&&cowork===1,'native followup hook');p.getEditor().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));check(native===1,'Shift+Enter not send');
   const stop=document.createElement('button');stop.dataset.test='refinement-prompt-stop-button';stop.textContent='Stop generating response';let stopClicks=0;stop.onclick=()=>stopClicks++;p.composerFrame().append(stop);check(p.isGenerating(),'stop is authoritative');p.stopGeneration();check(stopClicks===1&&stopped===1,'native stop scoped');stop.remove();check(!p.isGenerating(),'finished despite persistent streaming wrapper');
   const oldKey=p.conversationKey();history.replaceState({},'','/888/ai/brain?conversationId=brain-1');check(p.conversationKey()!==oldKey,'workspace isolated');
   history.replaceState({},'','/888/ai/agents');check(!p.getEditor()&&/creation form/.test(p.modeWarning()),'never use agent builder');
   history.replaceState({},'','/888/chat/r/human');document.querySelector('[data-test="chat-room-header__title-container"]')?.remove();check(!p.getEditor(),'human chats excluded');
   history.replaceState({},'','/888/t/task');check(!p.getEditor(),'task comments excluded');
   return {agent,send:sent.length,images:sent[0].attachments};
  },agent);assert.equal(result.send,1);assert.equal(result.images,2);assert.deepEqual(errors,[]);console.log('PASS '+name+' '+(agent?'agent thread':'Ask Brain')+' provider roles, route, text, images, hooks, scope');await page.close();
 }
 // Complete production core, mocked bridge. All dispatches are intercepted in chrome.runtime.
 for(const [agent,ultra] of [[false,false],[true,false],[false,true]]){
  const {page,errors}=await pageFor(browser,agent,true);
  if(ultra){await page.locator("#rs-menu [data-lvl=ultracode]").evaluate(n=>n.click());assert.equal(await page.evaluate(()=>window.__rsThinkingLevel()),"ultracode");}
  const bar=await page.evaluate(()=>{const r=document.querySelector('#rs-bar').getBoundingClientRect(),a=provider.barAnchor().getBoundingClientRect();return {bottom:r.bottom,left:r.left,width:r.width,top:a.top,anchorLeft:a.left,anchorWidth:a.width};});
  assert(bar.width>100&&bar.bottom<=bar.top,JSON.stringify(bar));if(!agent){const tabHit=await page.evaluate(()=>[...document.querySelectorAll('[role=tab]')].every(t=>{const r=t.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return t===hit||t.contains(hit);}));assert(tabHit,'Ask/Agents must stay in front and clickable through the bar cutout');}assert(Math.abs(bar.left-bar.anchorLeft)<=1);assert(Math.abs(bar.width-bar.anchorWidth)<=1);
  const donations=await page.evaluate(()=>[...document.querySelectorAll('#rs-menu .rs-tip-rbx')].map(b=>({url:b.dataset.u,label:b.querySelector('.rs-rbx-amt').textContent})));
  assert.deepEqual(donations,[
   {url:'https://www.roblox.com/game-pass/2025206972/elio-small-donation',label:'50 Robux'},
   {url:'https://www.roblox.com/game-pass/2026664687/elio-medium-donation',label:'100 Robux'},
   {url:'https://www.roblox.com/game-pass/2025386949/elio-Large-Donation',label:'500 Robux'},
   {url:'https://www.roblox.com/game-pass/2026352931/elio-Massive-Donation-much-love',label:'1,000 Robux'}]);
  const overlaps=await page.evaluate(()=>{const controls=[...document.querySelectorAll('#rs-bar button')].filter(b=>{const r=b.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(b).visibility!=='hidden';});const conflicts=[];for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i].getBoundingClientRect(),b=controls[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)conflicts.push([controls[i].id,controls[j].id]);}return conflicts;});assert.deepEqual(overlaps,[],'toolbar buttons must not overlap');
  await page.evaluate(()=>fixture.startSession());
  let state=await page.evaluate(()=>({started:fixture.A.started,starting:fixture.A.starting,sent:sent.map(x=>x.text),draft:provider.editorText(),editable:provider.getEditor().getAttribute('contenteditable')}));
  assert(state.started,JSON.stringify(state));assert.equal(state.starting,false);assert(state.sent.length>2,'large startup context is staged, never a single oversized paste');assert(state.sent.every(x=>x.length<12000),'every startup stage stays below the conservative bound');assert(state.sent.slice(1,-1).every(x=>x.includes('More context follows.')));assert(state.sent[0].length<1600);if(ultra)assert(state.sent.join('\n').includes('ULTRA —'),'Ultra startup context reaches ClickUp through bounded parts');assert(state.sent.join('\n').includes('ClickUp native task'));assert.equal(state.editable,'true');
  const dispatch=await page.evaluate(async()=>{
   const commands=[['execute_luau',{code:'print("fixture")'}],['execute_blender_code',{code:'print("fixture")'}],['read_file',{path:'fixture.txt'}]];
   const responses=commands.map(([command,params])=>'```json\n'+JSON.stringify({command,params})+'\n```');
   const base=provider.assistantCount();addItem('user','Run the isolated test command sequence','fixture-task');
   addItem('assistant',responses.shift(),'fixture-first-tool');
   // Subsequent simulated AI replies arrive only after the real core submits feedback.
   autoReply=false;const button=provider.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]'),original=button.onclick;
   button.onclick=event=>{original(event);addItem('assistant',responses.shift()||'Fixture sequence complete.','sequence-'+sent.length);};
   const before=sent.length;await fixture.agentLoop(base);
   return {results:sent.slice(before).map(x=>x.text),calls:nativeCalls.map(x=>({name:x.name,engine:x.engine,args:x.arguments})),frames:sent.map(x=>x.frame),unwanted,running:fixture.A.running,editable:provider.getEditor().getAttribute('contenteditable')};
  });const requested=dispatch.calls.filter(x=>x.args?.code==='print("fixture")'||x.args?.path==='fixture.txt');assert.equal(requested.length,3,JSON.stringify(dispatch));assert.deepEqual(requested.map(x=>x.name),['execute_luau','execute_blender_code','read_file']);const probes=dispatch.calls.filter(x=>!requested.includes(x));assert(probes.every(x=>x.name==='execute_luau'&&x.args.code.includes('GetLogHistory')),'only unchanged read-only Debug log probes may accompany the three commands');assert.equal(dispatch.results.length,3);assert(dispatch.results.every(x=>x.includes('FIXTURE RESULT')),JSON.stringify(dispatch));assert.equal(dispatch.unwanted,0);assert.equal(dispatch.running,false);assert.equal(dispatch.editable,'true');assert(dispatch.frames.every(x=>x===(agent?'thread-prompt':'main-prompt')));
  await page.evaluate(()=>{const old=provider.getEditor(),copy=old.cloneNode(true);old.replaceWith(copy);document.querySelector('cu-refinement-prompt:last-of-type').style.bottom='160px';});await page.waitForTimeout(400);
  const moved=await page.evaluate(()=>({bar:document.querySelector('#rs-bar').getBoundingClientRect().bottom,anchor:provider.barAnchor().getBoundingClientRect().top}));assert(moved.bar<=moved.anchor,JSON.stringify(moved));
  assert.deepEqual(errors,[]);console.log('PASS '+name+' '+(agent?'agent':ultra?'Brain Ultra':'Brain')+' FULL CORE startup, automatic watcher/parser/dispatch/feedback loop, mock Studio/Blender/files, bar tracks active composer');await page.close();
 }

 // Rich text may remove Markdown delimiters; only a persisted numeric ID is accepted.
 {const {page}=await pageFor(browser);await page.evaluate(()=>{
   autoReply=false;const b=provider.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]'),original=b.onclick;
   b.onclick=e=>{original(e);const row=provider.allItems().filter(provider.isUserItem).at(-1);row.querySelector('[data-test="quill-delta-to-html__comment"]').innerHTML='<p>Fixture <code>read_file</code> and <strong>exact</strong> receipt.</p>';};
  });const result=await page.evaluate(async()=>({ok:await provider.typeAndSend('Fixture `read_file` and **exact** receipt.'),count:sent.length}));assert(result.ok&&result.count===1);await page.close();console.log('PASS '+name+' rich-text receipt preserves content without requiring literal Markdown delimiters');}
 // An optimistic UUID and native failed-label must never be treated as delivery.
 {const {page}=await pageFor(browser);await page.evaluate(()=>{
   autoReply=false;const b=provider.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]'),original=b.onclick;
   b.onclick=e=>{original(e);const row=provider.allItems().filter(provider.isUserItem).at(-1);row.parentElement.dataset.id='optimistic-uuid';row.classList.add('_failed_fixture');const label=document.createElement('div');label.className='_failedLabel_fixture';label.textContent="The message you're trying to send is too long. Try to shorten it!";row.append(label);};
  });const result=await page.evaluate(async()=>{let error='';try{await provider.typeAndSend('⟦RS-SYS⟧ startup failure fixture');}catch(e){error=e.message;}const row=provider.allItems().filter(provider.isUserItem).at(-1);row.classList.remove('rs-hidden');return {error,count:sent.length,restore:provider.canRestoreSession(),masked:getComputedStyle(row.querySelector('[data-test="chat-item-content-area__message-body"]')).display};});assert.match(result.error,/rejected.*too long/);assert.equal(result.count,1);assert.equal(result.restore,false);assert.equal(result.masked,'none','own data-attribute CSS survives Angular wiping rs-hidden');await page.close();console.log('PASS '+name+' native rejection stays failed, no replay, persistent masking survives class reset');}
 // Full-core failure remains stopped even after marker/restoration sweeps.
 {const {page}=await pageFor(browser,false,true);await page.evaluate(()=>{const b=provider.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]'),original=b.onclick;b.onclick=e=>{if(sent.length>0)nextReply='Wrong startup context acknowledgement.';original(e);};});await page.evaluate(()=>fixture.startSession());await page.waitForTimeout(1200);const state=await page.evaluate(()=>({started:fixture.A.started,calls:nativeCalls.length,starting:fixture.A.starting,count:sent.length,editable:provider.getEditor().getAttribute('contenteditable')}));assert.equal(state.started,false,JSON.stringify(state));assert.equal(state.calls,0);assert.equal(state.starting,false);assert.equal(state.editable,'true');assert.equal(state.count,2);await page.close();console.log('PASS '+name+' incomplete staged startup never restores Ready or runs project tools');}

 // Post-click uncertain delivery: one click, no automatic resend, failure remains explicit.
 const {page}=await pageFor(browser);await page.evaluate(()=>{echo=false;window.realTimeout=setTimeout;window.setTimeout=(fn,ms,...args)=>realTimeout(fn,Math.min(ms,1),...args);window.realNow=Date.now;let tick=realNow();Date.now=()=>tick+=100;});
 const failure=await page.evaluate(async()=>{let error='';try{await provider.typeAndSend('one uncertain message');}catch(e){error=e.message;}return{error,count:sent.length,ambiguous:provider.sendFailureAmbiguous(),retry:provider.sendRetryable()};});
 assert.equal(failure.count,1);assert(failure.ambiguous&&!failure.retry);assert.match(failure.error,/will not resend/);console.log('PASS '+name+' ambiguous delivery is never replayed');await page.close();
}
module.exports={pageFor};
if(require.main===module)(async()=>{for(const [name,engine] of [['chromium',chromium],['firefox',firefox]]){
 if(process.env.ELIO_TEST_BROWSER&&process.env.ELIO_TEST_BROWSER!==name)continue;
 const executable=process.env.ELIO_CHROMIUM;const browser=await engine.launch({headless:true,...(name==='chromium'&&executable?{executablePath:executable}:{}),args:name==='chromium'?['--no-sandbox']:[]});try{await checks(browser,name);}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
