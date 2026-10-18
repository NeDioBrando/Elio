// Notion protocol-file uploads: a dropped file that never previews or an upload
// spinner that never finishes is retried safely (nothing was submitted yet),
// while Stop, foreign attachments and exhausted retries still fail closed.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.ELIO_TEST_JSDOM||'jsdom');
async function scenario(name,{ignore=0,stuck=0,stopOnDrop=false,foreignOnRetry=false}){
 const dom=new JSDOM('<main><section id="host"><div id="uploads"></div><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><div role="button" data-testid="agent-chat-send-button" aria-label="Submit AI message" aria-disabled="true">Send</div></section></section></main>',{url:'https://app.notion.com/ai',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,doc=w.document,ed=doc.querySelector('[role=textbox]'),button=doc.querySelector('[role=button]'),frame=doc.querySelector('#composer'),fileArea=doc.querySelector('#uploads');
 // Virtual clock: provider timeouts (45s preview, 60s upload, retry pauses) run instantly.
 let clock=1e12;const realTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms=0)=>{clock+=Math.max(0,Number(ms)||0);return realTimeout(fn,0);};w.Date.now=()=>clock;
 let drops=0,commits=0,stopped=false,text='',fileText='';const sent=[],diags=[];
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:600,width:650,height:this===ed?40:100,right:850,bottom:700};};
 class Transfer{constructor(){this.data={};this.files=[];this.items={add:f=>this.files.push(f)};Object.defineProperty(this.items,'length',{get:()=>this.files.length});}setData(k,v){this.data[k]=v;}getData(k){return this.data[k]||'';}}
 class Paste extends w.Event{constructor(type,o){super(type,o);this.clipboardData=o.clipboardData;}}
 const transfers=new WeakMap();class Drag extends w.MouseEvent{constructor(type,o){super(type,o);transfers.set(this,o.dataTransfer);}get dataTransfer(){return transfers.get(this);}}
 w.DragEvent=Drag;w.DataTransfer=Transfer;w.ClipboardEvent=Paste;w.document.execCommand=()=>{throw Error('no bulk edits');};
 ed.addEventListener('paste',e=>{e.preventDefault();if(!e.clipboardData.getData('text/plain').includes('attached file'))return;assert.equal(fileArea.querySelector('[aria-busy=true]'),null);const h=doc.createElement('div');h.innerHTML=e.clipboardData.getData('text/html');text=h.textContent;ed.textContent=text;button.setAttribute('aria-disabled','false');});
 frame.addEventListener('drop',e=>{e.preventDefault();drops++;const file=e.dataTransfer.files[0];
  if(stopOnDrop){stopped=true;return;}
  if(drops<=ignore)return; // Notion ignored this drop: no preview card
  const card=doc.createElement('div');card.className='fixture-card';card.setAttribute('data-testid','attachment');const label=doc.createElement('span');label.textContent=file.name;card.append(label);
  const remove=doc.createElement('button');remove.setAttribute('aria-label','Remove file');remove.textContent='X';remove.onclick=()=>card.remove();card.append(remove);fileArea.append(card);card.setAttribute('aria-busy','true');
  if(drops<=ignore+stuck)return; // spinner never finishes
  const r=new w.FileReader();r.onload=()=>{fileText=r.result;card.removeAttribute('aria-busy');};r.readAsText(file);});
 button.addEventListener('click',()=>{assert.equal(button.getAttribute('aria-disabled'),'false');assert.equal(fileArea.querySelector('[aria-busy=true]'),null,'never submit while uploading');assert.equal(fileArea.querySelectorAll('.fixture-card').length,1,'exactly one file is submitted');commits++;sent.push({text,fileText});text='';ed.textContent='';fileArea.querySelectorAll('.fixture-card').forEach(c=>c.remove());button.setAttribute('aria-disabled','true');const row=doc.createElement('div');row.setAttribute('data-agent-service-scroll-anchor','user-'+commits);row.style.justifyContent='flex-end';row.textContent=sent.at(-1).text;doc.body.append(row);w.provider.invalidateItems();w.history.replaceState({},'','/chat/thread-1');});
 try{
  vm.runInContext(fs.readFileSync(process.env.ELIO_NOTION_PROVIDER_SOURCE||'providers/notion.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());
  const p=w.provider;p.init({isStopped:()=>stopped,diag:(e,d)=>{diags.push([e,d]);if(foreignOnRetry&&e==='notion.attach.previewMissing'){const f=doc.createElement('div');f.setAttribute('data-testid','attachment');f.textContent='Pasted text';fileArea.append(f);}}});p.setInputLock(true);
  const result="Output of 'read_script':\n"+'local x = 1\n'.repeat(400);
  const ok=await p.typeAndSend(result);
  return {ok,drops,commits,sent,detail:p.sendFailureDetail(),cards:fileArea.querySelectorAll('.fixture-card').length,foreign:fileArea.querySelectorAll('[data-testid=attachment]:not(.fixture-card)').length,result};
 }finally{w.close();}
}
(async()=>{
 let r=await scenario('ignored',{ignore:1});
 assert.equal(r.ok,true);assert.equal(r.drops,2);assert.equal(r.commits,1);assert.equal(r.sent[0].fileText,r.result);assert(r.sent[0].text.includes('do not restart it'));assert.equal(r.cards,0);
 r=await scenario('stuck spinner',{stuck:1});
 assert.equal(r.ok,true);assert.equal(r.drops,2);assert.equal(r.commits,1);assert.equal(r.sent[0].fileText,r.result);assert.equal(r.cards,0);
 r=await scenario('two failures',{ignore:1,stuck:1});
 assert.equal(r.ok,true);assert.equal(r.drops,3);assert.equal(r.commits,1);
 r=await scenario('exhausted',{ignore:99});
 assert.equal(r.ok,false);assert.equal(r.drops,4);assert.equal(r.commits,0);assert.equal(r.cards,0);assert(r.detail.includes('after 4 attempts'),r.detail);assert(r.detail.includes('did not submit or repeat'));
 r=await scenario('stopped',{stopOnDrop:true});
 assert.equal(r.ok,false);assert.equal(r.drops,1,'Stop is never retried');assert.equal(r.commits,0);
 r=await scenario('foreign attachment',{ignore:99,foreignOnRetry:true});
 assert.equal(r.ok,false);assert.equal(r.commits,0);assert.equal(r.foreign,1,'a user attachment is never removed');assert.equal(r.drops,1,'no retry over a user attachment');assert(r.detail.includes('after 1 attempt'),r.detail);
 console.log('Notion protocol upload retries: ignored drop, stuck spinner and repeated failures recover with one submitted file; Stop, foreign attachments and exhausted retries fail closed without resubmitting.');
})().catch(e=>{console.error(e);process.exitCode=1;});
