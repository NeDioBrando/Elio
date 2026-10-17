const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),Cowork=require('./core/cowork');
const provider=fs.readFileSync('providers/notion.js','utf8'),core=fs.readFileSync('core/main.js','utf8');
(async()=>{
 const dom=new JSDOM('<main><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><button data-testid="agent-chat-send-button" aria-label="Submit AI message">Send</button></section></main>',{url:'https://app.notion.com/chat/current',runScripts:'outside-only',pretendToBeVisual:true});
 try {
  const w=dom.window,ed=w.document.querySelector('[role=textbox]'),button=w.document.querySelector('button'),pastes=[],delivered=[];
  w.HTMLElement.prototype.getBoundingClientRect=function(){return{left:200,top:600,width:650,height:40,right:850,bottom:640};};
  class Transfer {constructor(){this.data={};}setData(key,value){this.data[key]=value;}getData(key){return this.data[key]||'';}}
  class Paste extends w.Event {constructor(type,options){super(type,options);this.clipboardData=options.clipboardData;}}
  w.DataTransfer=Transfer;w.ClipboardEvent=Paste;
  ed.addEventListener('paste',event=>{event.preventDefault();const data=event.clipboardData;pastes.push({plain:data.getData('text/plain'),html:data.getData('text/html')});ed.textContent=data.getData('text/plain');});
  button.addEventListener('click',()=>{delivered.push(ed.textContent);const row=w.document.createElement('div');row.setAttribute('data-agent-service-scroll-anchor','user-'+delivered.length);row.style.justifyContent='flex-end';row.textContent=ed.textContent;ed.textContent='';w.document.body.append(row);w.P.invalidateItems();});
  vm.runInContext(fs.readFileSync('core/parser.js','utf8')+';this.RSParse=RSParse;',dom.getInternalVMContext());
  vm.runInContext(provider+';this.P=RSProvider;',dom.getInternalVMContext());w.P.init({isStopped:()=>false});
  Object.assign(w,{RS:{SYS_MARKER:'⟦RS-SYS⟧'},rememberSession(){},A:{stop:false,sessionGen:1},captureSendToken(){},diag(){},sleep:async()=>{},waitFor:async predicate=>predicate(),jitterBeforeSend:async()=>{},waitCommandCooldown:async()=>{},bgMode:true,scheduleSweep(){},SendAbortedError:Error,
   ui:{setStarted(){},inputCover(){},captureCoworkFocus(){},restoreCoworkFocus(){},renderCowork(){},banner(){throw Error('Unexpected send warning');}},cowork:{snapshot:()=>({enabled:true})}});
  const start=core.indexOf('  async function submitCore('),end=core.indexOf('  async function waitForResponse(',start);
  vm.runInContext(core.slice(start,end)+';this.submit=submitCore;',dom.getInternalVMContext());
  const queue=Cowork.create({context:()=>'/chat/current|roblox',ready:()=>true,send:text=>w.submit(text,undefined,true)});queue.setEnabled(true);
  const text='and when the game closes the controls do not save\nKeep **these names** unchanged.';
  queue.enqueue(text);assert(await queue.take());assert.equal(delivered[0],text);assert.equal(pastes[0].html,'','Human follow-ups use plain text, without an HTML code wrapper');assert.equal(queue.snapshot().receipts[0].status,'sent');
  const feedback="Output of 'read_script':\nKeep literal **markers** <tag> and C:\\Game\\file.lua";
  await w.submit(feedback,undefined,false);assert.equal(delivered[1],feedback);assert(pastes[1].html.includes('<pre><code>'),'Internal tool feedback keeps its literal code transport');assert(pastes[1].html.includes('&lt;tag&gt;'));assert.equal(delivered.length,2,'Each message commits once');
  console.log('Actual Co-work queue → core submission → Notion sends follow-ups as plain text, retains exact text and confirmed receipts, and preserves literal protocol transport.');
 } finally {dom.window.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
