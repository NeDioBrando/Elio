// Large startup draft on a slow editor: Notion renders the native insert late (live: 17 s freeze, 37,362 of
// 38,089 characters visible at the first checks). A late-completing draft must be accepted; a stuck own-prefix
// must be cleared and re-sent by bounded pastes; a foreign/changed draft must never be overwritten or sent.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{for(const behavior of ['late','prefix','foreign','pasteLate','pasteIgnored']){
 const dom=new JSDOM('<main><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><div role="button" data-testid="agent-chat-send-button" aria-label="Submit AI message">Send</div></section></main>',{url:'https://app.notion.com/ai',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,ed=w.document.querySelector('[role=textbox]');const render=m=>{if(m.endsWith('"'))m=m.slice(0,-1)+'\u201D';/* Notion smart-quotes a final quote */ed.textContent='';for(const part of m.split(/(\p{Extended_Pictographic}\uFE0F?)/u)){if(!part)continue;if(/^\p{Extended_Pictographic}/u.test(part)){const i=w.document.createElement('img');i.className='notion-emoji';i.setAttribute('alt',part);ed.append(i);}else ed.append(w.document.createTextNode(part));}};/* Notion renders emoji as <img alt>, invisible to textContent */
 let model='',edits=0,commits=0,pastes=0;const sent=[];
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:600,width:650,height:this===ed?40:100,right:850,bottom:700};};
 w.DataTransfer=class{constructor(){this.d={};}setData(k,v){this.d[k]=v;}getData(k){return this.d[k]||'';}};
 w.ClipboardEvent=class extends w.Event{constructor(t,o){super(t,o);this.clipboardData=o.clipboardData;}};
 ed.addEventListener('paste',e=>{pastes++;const sel=w.getSelection();const add=e.clipboardData.getData('text/plain'),base=(sel&&sel.isCollapsed?model:'');
  if(behavior==='pasteIgnored'&&pastes===8)return;/* Notion drops one paste; editor stays at the previous prefix */
  if(behavior==='pasteLate'&&pastes===8){setTimeout(()=>{model=base+add;render(model);},900);return;}/* applied late */
  model=base+add;render(model);});
 const startup='⟦RS-SYS⟧ ROBLOXSCRIPT\n'+Array.from({length:700},(_,i)=>'cmd_'+i+' ✅ {"a":"'+'x'.repeat(30)+'"} ⚠️ 🔧 ©').join('\n')+'\nEmit list_commands first. Reply with "elio is ready."';
 w.document.execCommand=(cmd,_,text)=>{
  if(cmd==='delete'){model='';render('');return true;}
  if(!text){model='';render('');return true;}
  edits++;const cut=Math.floor(text.length*0.98);
  if(behavior==='late'){model=text.slice(0,cut);render(model);setTimeout(()=>{model=text;render(text);},900);}
  else if(behavior==='prefix'||behavior.startsWith('paste')){model=text.slice(0,cut);render(model);}
  else{model='Unexpected changed draft';render(model);}
  return true;};
 w.document.querySelector('[role=button]').addEventListener('click',()=>{commits++;sent.push(model);model='';render('');
  const row=w.document.createElement('div');row.setAttribute('data-agent-service-scroll-anchor','user-'+commits);row.style.justifyContent='flex-end';row.textContent=sent.at(-1);w.document.body.append(row);w.provider.invalidateItems();w.history.replaceState({},'','/chat?t=native');});
 try{
  vm.runInContext(fs.readFileSync('providers/notion.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());const p=w.provider;p.init({isStopped:()=>false});p.setInputLock(true);
  const text="Output of 'list_commands':\n"+startup;
  const ok=await p.typeAndSend(text);
  if(behavior==='foreign'){assert.equal(ok,false);assert.equal(commits,0);assert.equal(pastes,0,'a changed draft is never overwritten');assert.equal(ed.textContent,'Unexpected changed draft');}
  else{assert(ok,behavior);assert.equal(commits,1);assert.equal(sent[0],text.replace(/\n/g,'\n'));assert.equal(edits,1,'one native attempt');
   if(behavior==='late')assert.equal(pastes,0,'late render needs no fallback');else assert(pastes>3,'partial own draft was cleared and re-sent by bounded pastes');
   if(behavior==='pasteIgnored')assert.equal(sent[0],text,'ignored chunk re-sent exactly once, no duplicate');
   if(behavior==='pasteLate')assert.equal(sent[0],text,'late chunk accepted without re-paste');}
  p.setInputLock(false);console.log('PASS Notion slow render '+behavior);
 }finally{w.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
