const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{for(const engine of ['ROBLOXSCRIPT','AGENTSCRIPT'])for(const behavior of ['retain','partial','remount']){
 const dom=new JSDOM('<main><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><div role="button" data-testid="agent-chat-send-button" aria-label="Submit AI message">Send</div></section></main>',{url:'https://app.notion.com/ai',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let ed=w.document.querySelector('[role=textbox]'),model='',edits=0,commits=0;const sent=[];
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:600,width:650,height:this===ed?40:100,right:850,bottom:700};};
 w.document.execCommand=(_,__,text)=>{
  edits++;model=behavior==='partial'?'Unexpected changed draft':text;ed.textContent=model;
  if(behavior==='remount'){const next=ed.cloneNode();next.textContent='Preserved new editor';ed.replaceWith(next);ed=next;}
  return true;
 };
 w.document.querySelector('[role=button]').addEventListener('click',()=>{
  commits++;sent.push(model);model='';ed.textContent='';
  const row=w.document.createElement('div');row.setAttribute('data-agent-service-scroll-anchor','user-'+commits);row.style.justifyContent='flex-end';row.textContent=sent.at(-1);w.document.body.append(row);w.provider.invalidateItems();w.history.replaceState({},'','/chat/native-'+engine);
 });
 try{
  vm.runInContext(fs.readFileSync('providers/notion.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());const p=w.provider;p.init({isStopped:()=>false});p.setInputLock(true);
  const startup='⟦RS-SYS⟧ '+engine+'\n'+('Keep **literal** C:\\Exact\\File <tags> 🧠\n').repeat(1000)+'\nEmit list_commands first.';
  const ok=await p.typeAndSend(startup);
  if(behavior==='retain'){
   assert(ok);assert.equal(sent[0],startup);assert.equal(edits,1);assert.equal(commits,1);assert.equal(w.document.querySelector('[data-testid=attachment]'),null);
   const catalog="Output of 'list_commands':\n"+'read_file {path}\n'.repeat(400);assert(await p.typeAndSend(catalog));assert.equal(sent[1],catalog);assert.equal(edits,2);assert.equal(commits,2);
  }else{assert.equal(ok,false);assert.equal(commits,0);assert(p.sendFailureDetail().includes('complete contents could be verified'));assert(ed.textContent.includes(behavior==='partial'?'Unexpected':'Preserved'));}
  p.setInputLock(false);console.log('PASS Notion '+engine+' '+behavior+': verified complete native startup/catalogue, one commit, changed/remounted drafts never submitted.');
 }finally{w.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
