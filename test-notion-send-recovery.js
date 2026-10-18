// 1.19.39 Notion delivery recovery. A tool result whose single commit was
// accepted but acknowledged late (Notion under load) used to be declared
// "not confirmed" after 15 s and the whole agent stopped, so the AI waited for
// a result that never came. Now a consumed draft gets a bounded late window
// (never a second click). Failures that happened BEFORE the commit are marked
// retryable so core can deliver once more; anything ambiguous stays ambiguous.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.ELIO_TEST_JSDOM||'jsdom');
const source=fs.readFileSync(__dirname+'/providers/notion.js','utf8');
async function scenario(name,{ackAfter=null,consume=true,ready=true,stopAt=null,options={}}){
 const dom=new JSDOM('<main><div data-agent-service-scroll-anchor="old-user" style="justify-content:flex-end">Earlier question</div><div data-agent-service-scroll-anchor="old-assistant" style="justify-content:flex-start">Earlier answer</div><section id="composer"><textarea placeholder="Ask Notion AI"></textarea><button data-testid="agent-chat-send-button" aria-label="Submit AI message"'+(ready?'':' aria-disabled="true" disabled')+'>Send</button></section></main>',{url:'https://app.notion.com/chat/thread',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,doc=w.document,ed=doc.querySelector('textarea'),button=doc.querySelector('[data-testid=agent-chat-send-button]');
 let clock=1e12,ackAt=null,stopped=false,commits=0;const diags=[];
 const prompt="Output of 'get_game_tree':\nWorkspace > Baseplate";
 const acknowledge=()=>{const row=doc.querySelector('[data-agent-service-scroll-anchor=old-user]');row.setAttribute('data-agent-service-scroll-anchor','new-user');row.textContent=prompt;w.p.invalidateItems();};
 const tickClock=ms=>{clock+=Math.max(0,Number(ms)||0);if(ackAt!==null&&clock>=ackAt){ackAt=null;acknowledge();}if(stopAt!==null&&clock>=stopAt)stopped=true;};
 const realTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms=0)=>{tickClock(ms);return realTimeout(fn,0);};w.Date.now=()=>clock;
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:600,width:650,height:40,right:850,bottom:640};};
 button.addEventListener('click',()=>{commits++;if(consume)ed.value='';if(ackAfter!==null)ackAt=clock+ackAfter;});
 vm.runInContext(source+';this.p=RSProvider;',dom.getInternalVMContext());
 w.p.init({isStopped:()=>stopped,diag:(k)=>diags.push(k)});
 const t0=clock;
 try{
  const result=await w.p.typeAndSend(prompt,null,options);
  return {result,commits,elapsed:clock-t0,ambiguous:w.p.sendFailureAmbiguous(),retryable:w.p.sendRetryable(),draft:ed.value};
 }finally{dom.window.close();}
}
(async()=>{
 let r=await scenario('fast',{ackAfter:300});
 assert.equal(r.result,true);assert.equal(r.commits,1);assert(r.elapsed<15000,'normal acknowledgement keeps its speed');
 console.log('fast acknowledgement: confirmed once in '+r.elapsed+' virtual ms');
 r=await scenario('late',{ackAfter:24000});
 assert.equal(r.result,true,'late Notion acknowledgement after the 15 s window is accepted');
 assert.equal(r.commits,1,'late window never clicks Send again');assert.equal(r.ambiguous,false);
 console.log('late acknowledgement (24 s): confirmed once, no second click');
 r=await scenario('never',{});
 assert.equal(r.result,false);assert.equal(r.commits,1,'never repeat an uncertain commit');
 assert.equal(r.ambiguous,true,'unconfirmed commit stays ambiguous');assert.equal(r.retryable,false,'ambiguous commit is never retryable');
 assert(r.elapsed>=45000&&r.elapsed<60000,'bounded wait: 15 s + 30 s late window, got '+r.elapsed);
 console.log('never acknowledged: ambiguous after a bounded '+Math.round(r.elapsed/1000)+' s, one click, not retryable');
 r=await scenario('kept',{consume:false});
 assert.equal(r.result,false);assert.equal(r.commits,1);assert.equal(r.ambiguous,true);
 assert(r.elapsed<20000,'a draft Notion did not consume gets no late window, got '+r.elapsed);
 console.log('draft not consumed: ambiguous with the original timing');
 r=await scenario('stop',{stopAt:1e12+20000});
 assert.equal(r.result,false);assert.equal(r.commits,1);assert(r.elapsed<25000,'Stop ends the late window promptly');
 console.log('Stop during the late window: ends promptly without a second click');
 r=await scenario('explicit',{options:{sentWaitMs:220,attempts:1,retryDelayMs:0}});
 assert.equal(r.result,false);assert(r.elapsed<2000,'callers with an explicit short budget keep it (recovery nudges)');
 r=await scenario('unready',{ready:false,options:{attempts:2,readyWaitMs:300,retryDelayMs:0}});
 assert.equal(r.result,false);assert.equal(r.commits,0,'never clicked');
 assert.equal(r.ambiguous,false);assert.equal(r.retryable,true,'a pre-commit failure is retryable');
 assert.equal(r.draft,'','the internal draft is not stranded in the composer');
 console.log('composer never ready: nothing sent, marked safe to retry');
 // Core wiring: one safe retry only for a provably unsent delivery.
 const main=fs.readFileSync(__dirname+'/core/main.js','utf8');
 assert(/const retryable = !A\.stop && !retriedUnsent && !\(images && images\.length\) && payloadText\.length < 4000 && typeof P\.sendRetryable === "function" &&\s*P\.sendRetryable\(\) === true && !\(P\.sendFailureAmbiguous && P\.sendFailureAmbiguous\(\)\);/.test(main),'core retries only provably unsent, attachment-free, short deliveries, once (1.20.0)');
 assert(fs.readFileSync(__dirname+'/elio-Extension/providers/notion.js','utf8')===source,'Notion copies are in sync');
 console.log('Notion delivery recovery: late acknowledgements accepted without resending; only provably unsent deliveries retry.');
})().catch(e=>{console.error(e);process.exit(1);});
