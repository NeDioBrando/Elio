const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('providers/notion.js','utf8');
(async()=>{
 for(const scenario of ['replaced-row','reused-row','attachment-label','delayed-row','unrelated-row','old-identical-row','cleared-only']) {
  const dom=new JSDOM('<main><div data-agent-service-scroll-anchor="old-user" style="justify-content:flex-end">Earlier question</div><div data-agent-service-scroll-anchor="same-assistant" style="justify-content:flex-start">Earlier answer</div><section id="composer"><textarea placeholder="Ask Notion AI"></textarea><button data-testid="agent-chat-send-button" aria-label="Submit AI message">Send</button><button data-testid="agent-stop-button" aria-label="Stop">Stop</button></section></main>',{url:'https://app.notion.com/chat/same-thread',runScripts:'outside-only',pretendToBeVisual:true});
  try {
   const w=dom.window,ed=w.document.querySelector('textarea'),button=w.document.querySelector('[data-testid=agent-chat-send-button]');
   w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:600,width:650,height:40,right:850,bottom:640};};
   vm.runInContext(source+';this.p=RSProvider;',dom.getInternalVMContext());w.p.init({isStopped:()=>false});
   const prompt='Output of list_commands: exact new catalogue';
   if(scenario==='old-identical-row')w.document.querySelector('[data-agent-service-scroll-anchor=old-user]').textContent=prompt;
   let commits=0;
   button.addEventListener('click',()=>{
    commits++;ed.value='';
    const acknowledge=()=>{
     if(['old-identical-row','cleared-only'].includes(scenario))return;
     let row=w.document.querySelector('[data-agent-service-scroll-anchor=old-user]');
     if(scenario!=='reused-row') { const replacement=row.cloneNode();row.replaceWith(replacement);row=replacement; }
     row.setAttribute('data-agent-service-scroll-anchor','new-user');
     row.textContent=scenario==='unrelated-row'?'A different message':scenario==='attachment-label'?'elio_tool_result.txt '+prompt:prompt;
     w.p.invalidateItems();
    };
    if(scenario==='delayed-row')w.setTimeout(acknowledge,4600);else acknowledge();
   });
   const expected=['replaced-row','reused-row','attachment-label','delayed-row'].includes(scenario);
   const options=scenario==='delayed-row'?{}:{sentWaitMs:220,attempts:1,retryDelayMs:0};
   const started=Date.now();assert.equal(await w.p.typeAndSend(prompt,null,options),expected,scenario);
   assert.equal(commits,1,scenario+': never repeat an uncertain commit');
   assert.equal(w.p.sendFailureAmbiguous(),!expected,scenario);
   assert.equal(w.p.userCount(),1,scenario+': virtualized count stays constant');
   if(scenario==='delayed-row')assert(Date.now()-started>=4500,'Accept acknowledgement after the old four-second timeout');
   console.log(scenario+': '+(expected?'confirmed once':'kept ambiguous without a retry'));
  } finally {dom.window.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
