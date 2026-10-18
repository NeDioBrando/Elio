// 1.24.11 regression: a chunked Notion startup paste that stops part-way must not
// strand the opening of elio's own draft in the composer (which then blocked
// every later command result). The partial copy is cleared, the complete message
// goes through the protocol-file path, and later sends in the chat still work.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.ELIO_TEST_JSDOM||'jsdom');
async function notionDom(){
 const dom=new JSDOM('<main><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><div role="button" data-testid="agent-chat-send-button" aria-label="Submit AI message">Send</div></section></main>',{url:'https://app.notion.com/chat?t=abc',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;const state={ed:w.document.querySelector('[role=textbox]'),model:'',commits:0,sent:[],appendPastes:0,ignoreAppend:true};
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:600,width:650,height:this===state.ed?40:100,right:850,bottom:700};};
 class Transfer{constructor(){this.data={};}setData(k,v){this.data[k]=v;}getData(k){return this.data[k]||'';}}
 class Paste extends w.Event{constructor(type,o){super(type,o);this.clipboardData=o.clipboardData;}}
 w.DataTransfer=Transfer;w.ClipboardEvent=Paste;
 // Native bulk insert: Notion turns the lines into blocks and consumes Markdown marks.
 // 1.24.12: a complete-but-reformatted draft is now accepted, so this fixture
 // models the real failure: the bulk insert lands only part of the message.
 w.document.execCommand=(cmd,_,text)=>{if(cmd==='insertText'){const all=String(text).split('\n').map(l=>l.replace(/^\s*[-*]\s+/,'').replace(/\*\*/g,'')).join('');state.model=all.slice(0,Math.floor(all.length*0.4));state.ed.textContent=state.model;}return true;};
 // Paste: replacing paste works; an appended chunk is ignored (live Notion, Oct 2026).
 state.ed.addEventListener('paste',e=>{e.preventDefault();const plain=e.clipboardData.getData('text/plain');const sel=w.getSelection();
  if(sel.isCollapsed&&state.model){state.appendPastes++;if(state.ignoreAppend)return;state.model+=plain;}else state.model=plain;state.ed.textContent=state.model;});
 w.document.querySelector('[role=button]').addEventListener('click',()=>{
  state.commits++;state.sent.push(state.model);const shown=state.model;state.model='';state.ed.textContent='';
  const row=w.document.createElement('div');row.setAttribute('data-agent-service-scroll-anchor','user-'+state.commits);row.style.justifyContent='flex-end';row.textContent=shown;w.document.body.append(row);w.provider.invalidateItems();
 });
 vm.runInContext(fs.readFileSync(process.env.ELIO_NOTION_PROVIDER_SOURCE||'providers/notion.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());
 const p=w.provider;p.init({isStopped:()=>false});
 await new Promise(r=>setTimeout(r,700));return {w,p,state};
}
(async()=>{
 const {w,p,state}=await notionDom();
 p.setInputLock(true);
 const result="Output of 'list_commands':\n"+Array.from({length:160},(_,i)=>`- tool_${i} {path?} — Read a **text** file and report it.`).join('\n')+'\nPlease acknowledge with "elio is ready."';
 assert(result.length>2500);
 const t0=Date.now();
 const ok=await p.typeAndSend(result,null,{sentWaitMs:800,lateConfirmMs:0});
 const detail=p.sendFailureDetail();
 assert(!/Notion changed the message before its complete contents could be verified/.test(detail),'own partial startup draft must not strand the send: '+detail);
 assert.equal(state.ed.textContent,'','the partial copy of elio\'s own draft is cleared');
 assert(state.sent.every(t=>t!==result.slice(0,t.length)||t.length===result.length),'a partial draft is never submitted');
 assert(state.appendPastes>=1,'fixture exercised the ignored append');
 // A later send in the same tab skips the chunked path (no second long freeze).
 const before=state.appendPastes;
 await p.typeAndSend(result.replace('list_commands','list_commands '),null,{sentWaitMs:800,lateConfirmMs:0});
 assert.equal(state.appendPastes,before,'chunked paste is not retried after Notion ignored an append');
 assert.equal(state.ed.textContent,'');
 // Ordinary short results still deliver afterwards (commands are not left "not run").
 state.ignoreAppend=false;
 const short="Output of 'read_file':\n1 | print('hi')";
 assert(await p.typeAndSend(short,null,{sentWaitMs:800,lateConfirmMs:0}),p.sendFailureDetail());
 assert.equal(state.sent[state.sent.length-1],short);
 p.setInputLock(false);w.close();
 console.log('PASS partial chunked Notion startup draft is cleared, never submitted, later sends skip the stalled path and short results still deliver ('+(Date.now()-t0)+' ms).');
})().catch(e=>{console.error(e);process.exitCode=1;});
