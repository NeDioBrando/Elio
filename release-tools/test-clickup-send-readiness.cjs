// Real browser fixtures only; never sends to a ClickUp account or local bridge.
const {chromium,firefox}=require('playwright'),assert=require('node:assert/strict');
const {pageFor}=require('./test-clickup-browser.cjs');
async function check(browser,name){
 for(const kind of ['disabled','missing','aria-disabled','obscured','restore-original','changed','stopped','chat-change','user-message','uncertain','rejected']){
  const {page}=await pageFor(browser);
  const result=await page.evaluate(async kind=>{
   const p=provider,editor=p.getEditor(),button=p.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]');
   const nativeState=fixtureComposerStates.get(editor);
   const keepSendDisabled=()=>{nativeState.forceDisabled=true;nativeState.refresh();};
   history.replaceState({},'','/90141771095/ai/brain?conversationId=fixture');
   const original=kind==='restore-original'?'My own unsent question':'';
   if(original)await p.writeDraft(original);
   const text=kind==='user-message'?'Please help with my project':p.startupRequest('roblox');
   const diagnostics=[];let stopped=false;p.init({diag:(name,data)=>diagnostics.push({name,data}),isStopped:()=>stopped});
   if(['disabled','restore-original','user-message'].includes(kind))keepSendDisabled();
   if(kind==='missing')button.remove();
   if(kind==='aria-disabled')button.setAttribute('aria-disabled','true');
   if(kind==='obscured'){const r=button.getBoundingClientRect(),block=document.createElement('div');block.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:9999`;document.body.append(block);}
   const realNow=Date.now,realTimeout=setTimeout;let tick=realNow();Date.now=()=>tick+=1000;window.setTimeout=(fn,ms,...args)=>realTimeout(fn,Math.min(ms,1),...args);
   if(['changed','stopped','chat-change'].includes(kind)){
    keepSendDisabled();const exec=document.execCommand.bind(document);document.execCommand=(...args)=>{const result=exec(...args);if(args[2]===text)queueMicrotask(()=>{
     if(kind==='changed'){editor.textContent='A new draft from the user';editor.dispatchEvent(new InputEvent('input',{bubbles:true}));}
     if(kind==='stopped')stopped=true;
     if(kind==='chat-change')history.replaceState({},'','/90141771095/ai/brain?conversationId=other');
    });return result;};
   }
   if(kind==='uncertain'){echo=false;const send=button.onclick;button.onclick=e=>{send(e);editor.textContent='A draft after the attempted send';};}
   if(kind==='rejected'){const send=button.onclick;button.onclick=e=>{send(e);const row=p.allItems().filter(p.isUserItem).at(-1);row.parentElement.dataset.id='optimistic';const label=document.createElement('span');label.className='failedLabel';label.textContent='Not allowed';row.append(label);};}
   let error='';try{await p.typeAndSend(text);}catch(e){error=e.message;}
   return {kind,error,sent:sent.length,draft:p.editorText(),original,text,diagnostics,ambiguous:p.sendFailureAmbiguous(),retry:p.sendRetryable()};
  },kind);
  assert(result.error,kind+' must fail rather than send');assert.equal(result.retry,false);
  if(['disabled','missing','aria-disabled','obscured','restore-original','stopped'].includes(kind)){
   assert.equal(result.sent,0);assert.equal(result.draft,result.original,kind+': only the definitely unsent owned startup draft should be restored');
  }
  if(kind==='changed'){assert.equal(result.sent,0);assert.equal(result.draft,'A new draft from the user');}
  if(kind==='chat-change'){assert.equal(result.sent,0);assert.equal(result.draft,result.text,'do not edit a changed chat');}
  if(kind==='user-message'){assert.equal(result.sent,0);assert.equal(result.draft,result.text,'never automatically erase an ordinary user message');}
  if(kind==='uncertain'){assert.equal(result.sent,1);assert.equal(result.draft,'A draft after the attempted send','ambiguous sends must leave the draft alone');assert(result.ambiguous);}
  if(kind==='rejected')assert.equal(result.sent,1);
  if(['disabled','missing','aria-disabled','obscured'].includes(kind)){
   assert(result.diagnostics.some(x=>x.name==='clickup.send.blocked'&&x.data.reason===kind),JSON.stringify(result.diagnostics));
   assert(!JSON.stringify(result.diagnostics).includes(result.text),'diagnostics must not log draft contents');
  }
  console.log('PASS '+name+' pre-send '+kind);await page.close();
 }
}
(async()=>{for(const [name,engine] of [['chromium',chromium],['firefox',firefox]]){
 if(process.env.SYNERIXCODE_TEST_BROWSER&&process.env.SYNERIXCODE_TEST_BROWSER!==name)continue;
 const browser=await engine.launch({headless:true,...(name==='chromium'&&process.env.SYNERIXCODE_CHROMIUM?{executablePath:process.env.SYNERIXCODE_CHROMIUM}:{}),args:name==='chromium'?['--no-sandbox']:[]});try{await check(browser,name);}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
