const {chromium,firefox}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const main=fs.readFileSync('core/main.js','utf8');
const session=main.slice(main.indexOf('  const startedSessions = new Set();'),main.indexOf('  // Schedule a debounced sweep.'));
const proof=main.slice(main.indexOf('        // A confirmed internal result'),main.indexOf('        if(typeof synerixcodeUltracode',main.indexOf('        // A confirmed internal result')));
(async()=>{for(const [name,engine] of [['chromium',chromium],['firefox',firefox]]){
 if(process.env.SYNERIXCODE_TEST_BROWSER&&process.env.SYNERIXCODE_TEST_BROWSER!==name)continue;
 const browser=await engine.launch({headless:true});
 try{const page=await browser.newPage();await page.route('https://app.notion.com/**',r=>r.fulfill({contentType:'text/html',body:`<div id="rs-root"></div><main>
 <div id="request" style="display:flex;justify-content:flex-end">Fix movement</div>
 <div data-content-editable-root="true"><pre data-block-id="call">{"command":"script_read"}</pre></div>
 <div id="result" style="display:flex;justify-content:flex-end"><div>Output of 'script_read':\n1 → exact source</div><pre>2 → return value</pre></div>
 <div id="reply" data-content-editable-root="true"><div data-block-id="reply">Movement is fixed.</div></div>
 <form><textarea placeholder="Ask Notion AI"></textarea><button data-testid="agent-chat-send-button">Send</button></form>
 </main><style>textarea{width:600px;height:50px}</style>`}));await page.goto('https://app.notion.com/chat?t=one');
 await page.addScriptTag({path:'providers/notion.js'});await page.addScriptTag({path:'core/parser.js'});
 const result=await page.evaluate(({session,proof})=>{
  const P=RSProvider,RS={SYS_MARKER:'⟦RS-SYS⟧'},A={started:false,starting:false,running:false,injecting:false,sessionGen:3},states=[];
  const ui={setStarted:x=>states.push(x)},chrome={storage:{local:{get(){},set(){}}}},diag=()=>{};
  const state=new Function('A','P','RS','ui','chrome','diag',session+';return {syncSessionState,rememberSession};')(A,P,RS,ui,chrome,diag);
  const check=(ok,label)=>{if(!ok)throw Error(label);};
  state.syncSessionState();check(A.started,'Visible feedback must restore session');
  check(P.userCount()===2&&P.assistantCount()===2,'Correct roles and counts');
  const item=document.getElementById('result'),before=item.innerHTML;
  P.renderImmutableChip(item,{whole:true,label:'script_read · result',phase:'result'});
  check(item.innerHTML===before,'No locked child mutation');
  check(Array.from(item.children).every(el=>getComputedStyle(el).display==='none'),'Every raw result block visually hidden');
  check(getComputedStyle(item,'::before').content.includes('script_read · result'),'Visible result card');
  check(P.itemText(item).includes('exact source'),'Parser can still read hidden feedback');
  P.syncImmutableChips();check(P.immutableChipPresent(item),'Cleanup retains whole card');
  const copy=item.cloneNode(true);copy.removeAttribute('data-synerixcode-notion-card');item.replaceWith(copy);P.invalidateItems();P.renderImmutableChip(copy,{whole:true,label:'script_read · result',phase:'result'});
  check(Array.from(copy.children).every(el=>getComputedStyle(el).display==='none'),'Remounted result stays hidden');
  // Confirmed delivery proof survives removal of every injected marker before
  // the idle sweep; a new empty conversation still requires its own startup.
  history.replaceState({},'','/chat/proof');A.started=false;P.invalidateItems();
  new Function('A','P','RS','RSParse','ui','rememberSession','chat','generation','payload','userPrompt',proof)(A,P,RS,RSParse,ui,state.rememberSession,P.conversationKey(),3,"Output of 'script_read':\nsource",false);
  copy.remove();P.invalidateItems();state.syncSessionState();check(A.started,'Confirmed result retained after virtualization');
  history.replaceState({},'','/chat/brand-new');P.invalidateItems();state.syncSessionState();check(!A.started,'Different chat not armed');
  check(getComputedStyle(document.getElementById('request')).color!=='rgba(0, 0, 0, 0)','User request visible');
  return {states,rawHidden:true,once:true};
 },{session,proof});assert(result.rawHidden);assert.deepEqual(result.states,[true,true,false]);console.log(`${name}: production Notion block-layout masks raw results, keeps parser text and immutable children, survives remount/virtualization, and binds readiness to the correct chat.`);
 }finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
