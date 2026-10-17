const {chromium,firefox}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const main=fs.readFileSync('core/main.js','utf8'),start=main.indexOf('  async function startSession('),bootstrap=main.slice(main.indexOf('  function isProviderPolicyRefusal('),main.indexOf('  function isCapabilityRefuse('))+main.slice(start,main.indexOf('  const SVG =',start));
const submit=main.slice(main.indexOf('  async function submitCore('),main.indexOf('  async function performSubmitCore('));
const html='<main><section id="composer" style="min-height:900px"><div><div role="textbox" contenteditable="true" data-placeholder="Frage Notion AI"></div></div><div role="button" data-testid="agent-chat-send-button" aria-label="Nachricht senden">Senden</div></section></main>';
(async()=>{for(const [name,engine] of [['chromium',chromium],['firefox',firefox]]){
 if(process.env.SYNERIXCODE_TEST_BROWSER&&process.env.SYNERIXCODE_TEST_BROWSER!==name)continue;
 const browser=await engine.launch({headless:true});
 for(const scenario of ['success','block-success','wrong-command','throwing-composer']){
  const page=await browser.newPage();page.on('pageerror',error=>console.error(name,scenario,error.message));await page.route('https://app.notion.com/**',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('https://app.notion.com/ai');
  for(const file of ['core/parser.js','core/ultracode.js','core/config.js','providers/notion.js'])await page.addScriptTag({path:file});
  await page.evaluate(scenario=>{
   window.P=RSProvider;window.A={startGen:0,sessionGen:1,toolList:[{name:'read_file',server:'local',inputSchema:{properties:{path:{type:'string'}},required:['path']}}]};window.sent=[];window.dispatches=0;window.banners=[];window.cover=false;window.starting=false;
   const ed=document.querySelector('[role=textbox]');document.execCommand=()=>false;
   ed.addEventListener('paste',event=>{event.preventDefault();const value=event.clipboardData.getData('text/plain'),range=getSelection().getRangeAt(0);range.deleteContents();const text=document.createTextNode(value);range.insertNode(text);range.setStartAfter(text);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);});
   document.querySelector('[role=button]').onclick=()=>{
    const text=ed.innerText;sent.push(text);ed.textContent='';
    for(const [kind,body] of [['user',text],['assistant',sent.length===1?(scenario==='wrong-command'?'```json\n{"command":"execute_luau","params":{}}\n```':'```json\n{"command":"list_commands"}\n```'):'synerixcode is ready.']]){const row=document.createElement('div');if(scenario==='block-success'){if(kind==='user'){row.style.display='flex';row.style.justifyContent='flex-end';row.textContent=body;}else{row.setAttribute('data-content-editable-root','true');const block=document.createElement('pre');block.setAttribute('data-block-id',kind+'-'+sent.length);block.textContent=body;row.append(block);}}else{row.setAttribute('data-agent-service-scroll-anchor',kind+'-'+sent.length);row.style.justifyContent=kind==='user'?'flex-end':'flex-start';row.textContent=body;}document.body.append(row);}
    history.replaceState({},'','/chat/bootstrap-fixture');P.invalidateItems();
   };
   P.init({isStopped:()=>!!A.stop,diag:(name,data)=>{window.diagnostics=window.diagnostics||[];diagnostics.push({name,data});}});
   if(scenario==='throwing-composer')P.ensureComposerReady=async()=>{throw new DOMException('Composer changed during startup');};
   window.condoLocked=()=>false;window.diagnostics=[];window.diag=(name,data)=>diagnostics.push({name,data});window.activeEngine=()=> 'local';window.ensureTools=async()=>{};
   window.systemPrompt=()=> '⟦RS-SYS⟧ Full future task rules. Preserve literal paths C:\\Game\\main.lua.\n'+('Keep the current architecture.\n').repeat(100);
   window.performSubmitCore=async text=>{const ok=await P.typeAndSend(text);if(!ok)throw new Error(P.sendFailureDetail()||'Send failed');return P.assistantCount();};
   window.waitForResponse=async()=>{const response=P.readAssistant(),calls=RSParse.parseToolCalls(response.reply);return calls.length?{kind:'tool',calls,item:response.item}:{kind:'text',text:response.reply,item:response.item};};
   window.decorate={sweep(){},toolBox(){}};window.ui={setStarting:x=>starting=x,inputCover:x=>cover=x,updateStartGate(){},trackCard(){},setStarted(){},toast(){},banner:(...args)=>banners.push(args)};
   window.startupTurnIdentity=()=>({});window.rememberExecuted=()=>{};window.runTool=async()=>{dispatches++;return 'read_file {path}';};window.rememberStartupOutcome=window.rememberSession=window.log=()=>{};window.SendAbortedError=class extends Error{};window.RUN_CMD='run';window.sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  },scenario);
  await page.addScriptTag({content:submit+';window.submitAndGetBase=text=>submitCore(text);'});
  await page.addScriptTag({content:bootstrap+';window.start=startSession;'});await page.evaluate(()=>start());
  const result=await page.evaluate(()=>({started:!!A.started,starting:!!A.starting,owner:A.startupOwner,cover,sent,dispatches,banners,diagnostics:diagnostics.slice(-8),draft:document.querySelector('[role=textbox]').textContent,editable:document.querySelector('[role=textbox]').getAttribute('contenteditable')}));
  assert.equal(result.starting,false);assert(!result.owner);assert.equal(result.cover,false);assert.equal(result.editable,'true');
  if(scenario==='success'||scenario==='block-success'){assert(result.started,JSON.stringify(result));assert.equal(result.dispatches,1);assert.equal(result.sent.length,2);assert(result.sent[0].length<1500);assert(!result.sent[0].includes('Full future task rules'));assert(result.sent[1].includes('Full future task rules'));assert(result.sent[1].includes('C:\\Game\\main.lua'));assert(result.sent[1].includes('already ran'));}
  else{assert(!result.started);assert.equal(result.dispatches,0);assert(result.banners.length);assert.equal(result.sent.length,scenario==='wrong-command'?1:0);}
  await page.close();console.log(`${name} ${scenario}: actual Notion composer/receipt/parser/bootstrap, small first handshake, task-policy transfer and unlocked failure cleanup passed.`);
 }
 await browser.close();
}})().catch(e=>{console.error(e);process.exitCode=1;});
