// 1.24.10 regressions: Notion startup draft rewritten by the editor, late
// Notion receipts with block/Markdown rendering, plan-only replies, connected
// add-on servers, ready acknowledgements with follow-ups, and checklists.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
async function notionDom(url='https://app.notion.com/ai'){
 const dom=new JSDOM('<main><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><div role="button" data-testid="agent-chat-send-button" aria-label="Submit AI message">Send</div></section></main>',{url,runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;const state={ed:w.document.querySelector('[role=textbox]'),model:'',commits:0,sent:[],render:t=>t};
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:600,width:650,height:this===state.ed?40:100,right:850,bottom:700};};
 class Transfer{constructor(){this.data={};}setData(k,v){this.data[k]=v;}getData(k){return this.data[k]||'';}}
 class Paste extends w.Event{constructor(type,o){super(type,o);this.clipboardData=o.clipboardData;}}
 w.DataTransfer=Transfer;w.ClipboardEvent=Paste;
 // Literal (HTML code) pastes are kept exactly, like Notion's code import.
 state.ed.addEventListener('paste',e=>{e.preventDefault();const plain=e.clipboardData.getData('text/plain');const sel=w.getSelection();if(!sel.isCollapsed)state.model='';state.model+=plain;state.ed.textContent=state.model;});
 w.document.querySelector('[role=button]').addEventListener('click',()=>{
  state.commits++;state.sent.push(state.model);const shown=state.render(state.model);state.model='';state.ed.textContent='';
  const row=w.document.createElement('div');row.setAttribute('data-agent-service-scroll-anchor','user-'+state.commits);row.style.justifyContent='flex-end';row.textContent=shown;w.document.body.append(row);w.provider.invalidateItems();w.history.replaceState({},'','/chat/fixes');
 });
 vm.runInContext(fs.readFileSync('providers/notion.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());
 const p=w.provider;p.init({isStopped:()=>false});
 // Let the one-time stale-draft cleanup run first, as it does long before a real send.
 await new Promise(r=>setTimeout(r,700));return {w,p,state};
}
// Notion's rich editor: lines become blocks (no separators) and Markdown marks vanish.
const notionRender=t=>t.split('\n').map(l=>l.replace(/^\s*[-*]\s+/,'').replace(/^\s*\d+\.\s+/,'').replace(/\*\*/g,'')).join('');
(async()=>{
 { // A. startup draft rewritten by native insert -> recovered through literal paste
  const {w,p,state}=await notionDom();
  w.document.execCommand=(_,__,text)=>{state.model=notionRender(text);state.ed.textContent=state.model;return true;};
  p.setInputLock(true);
  const startup="Output of 'list_commands':\n"+'read_file {path} — Read a text file.\n'.repeat(120)+'\nThese user preferences apply:\n- Keep **Read_me** enabled\n1. Use exact names\n\nPlease acknowledge with "elio is ready."';
  assert(startup.length>2500);
  const ok=await p.typeAndSend(startup);
  // 1.24.12: the reformatted startup draft (same words, Markdown turned into
  // formatting) is accepted as written and sent once, with no slow re-paste.
  let pastes=0;state.ed.addEventListener('paste',()=>pastes++,true);
  assert(ok,p.sendFailureDetail());assert.equal(state.commits,1);assert.equal(state.sent[0],notionRender(startup));assert.equal(pastes,0,'no fallback paste');
  p.setInputLock(false);w.close();console.log('PASS Notion reformatted startup draft is accepted and delivered exactly once without a fallback paste.');
 }
 { // A2. a foreign draft is still preserved and never sent
  const {w,p,state}=await notionDom();
  w.document.execCommand=()=>{state.model='Something the user typed';state.ed.textContent=state.model;return true;};
  p.setInputLock(true);
  const ok=await p.typeAndSend("Output of 'list_commands':\n"+'read_file {path}\n'.repeat(400));
  assert.equal(ok,false);assert.equal(state.commits,0);assert.equal(state.ed.textContent,'Something the user typed');
  p.setInputLock(false);w.close();console.log('PASS Notion foreign startup draft is preserved and not submitted.');
 }
 { // B. tool result shown as blocks with Markdown rendered is confirmed
  const {w,p,state}=await notionDom('https://app.notion.com/chat/fixes');
  state.render=notionRender;
  const result="Output of 'list_roblox_studios':\n{\"studios\":[{\"id\":\"61e4b61f\",\"name\":\"Place1\"}]}\n- **active**: true";
  const ok=await p.typeAndSend(result,null,{sentWaitMs:800,lateConfirmMs:0});
  assert(ok,'rendered receipt must confirm the send');assert.equal(state.commits,1);
  w.close();console.log('PASS Notion block/Markdown-rendered result receipt confirms delivery without a second click.');
 }
 { // C. main.js helpers
  const main=fs.readFileSync('core/main.js','utf8');
  const helpers=main.slice(main.indexOf('  // 1.24.10 helpers'),main.indexOf('  function isCapabilityRefuse(text) {'));
  const box=vm.createContext({window:{__rsPlanMode:()=>true,__rsThinkingLevel:()=>'default'},RSParse:{hasOpenToolBlock:t=>/```json|"command"\s*:/.test(t)},A:{bridge:{servers:[{id:'roblox',alive:true,tools:39},{id:'blender',alive:true,tools:89},{id:'git',alive:false,tools:0}]}}});
  vm.runInContext(helpers+';this.h={planWantsImplementation,looksLikePlanOnly,connectedAddonsNote,notionPlainText};',box);
  assert.equal(box.h.notionPlainText('Rules:\n- Keep **Read_me** on\n1. Use names\n## Head\n  * nested'),'Rules:\n• Keep Read_me on\n(1) Use names\nHead\n  • nested');
  const plan='Plan: Polished Roblox Shop GUI\nGoal: Create a complete Shop GUI.\nArchitecture\n- Topbar: icon\n- Shop GUI: panel\nImplementation steps\n1. Read project memory.\n2. Find existing GUI.\n3. Create the preview.\n4. Insert the GUI.\nRisks and safeguards: keep systems working.';
  assert(box.h.planWantsImplementation());assert(box.h.looksLikePlanOnly(plan));
  assert(!box.h.looksLikePlanOnly(plan+'\nWhich color theme do you want for the shop?'),'a real question to the user is not auto-continued');
  // 1.24.12: Plan Mode/Ultracode already approve the plan, so approval-style endings continue.
  assert(box.h.looksLikePlanOnly(plan+'\nShould I start with step 1?'),'approval question after a plan continues');
  assert(box.h.looksLikePlanOnly('## Plan\nHere is how I will build the shop:\n1. Inspect the existing UI.\n2. Create the frame.\n3. Add buttons.\n4. Test on mobile.\nShall I proceed?'),'Claude/ChatGPT style plan continues');
  assert(!box.h.looksLikePlanOnly('## Plan\n1. Inspect.\n2. Create.\n3. Test.\nDo you want a dark theme? And should it be animated?'),'several open questions wait for the user');
  assert(!box.h.looksLikePlanOnly('Roblox uses Luau. RemoteEvents connect client and server.'),'ordinary answers are not plans');
  assert(!box.h.looksLikePlanOnly(plan+'\n```json\n{"command":"read_file"}\n```'),'replies with a command are handled as tools');
  const note=box.h.connectedAddonsNote('roblox');assert(/blender \(89 commands\)/.test(note));assert(!/roblox|git/.test(note.split('.')[0].replace('Also connected right now','')));
  assert.equal(vm.runInContext('A.bridge.servers=[{id:"roblox",alive:true,tools:39}];h.connectedAddonsNote("roblox")',box),'');
  // ready acknowledgement accepts a short follow-up but not commands
  const s=main.indexOf('      const readyOk = '),e=main.indexOf('      diag("start.readyReply"',s);
  const check=(text,id='notion')=>vm.runInContext(main.slice(s,e)+';readyOk',vm.createContext({readyRes:{kind:'text'},readyText:text,P:{id}}));
  assert(check('elio is ready.'));assert(check('elio is ready. What would you like to work on in your Roblox Studio project?'));
  assert(check('elio is ready. Tell me what you\'d like to work on.','chatgpt'));
  assert(!check('elio is ready. {"command":"list_commands"}'));assert(!check('Sure, here is the command list.'));
  console.log('PASS plan-only auto-continue detection, connected add-on note and ready follow-up acceptance.');
 }
 { // D. checklist detection
  const Activity=require('./core/activity');const a=Activity.create();
  a.sync(true,'chat');a.task('Create a polished Shop GUI using topbarplus. Keep Read_me enabled.','k1');
  let g=a.active();assert.deepEqual(g.plan.items.map(i=>i.label),['Create a polished Shop GUI using topbarplus','Keep Read_me enabled']);
  assert.equal(g.plan.items[0].status,'in_progress');
  a.record(g.id,'r1','command','Plan\nGoal: Build a working shop.\n1. Inspect existing GUI\n2. Build the shop frame\n3. Wire purchases\n```json\n{"command":"read_file"}\n```');
  g=a.active();assert.deepEqual(g.plan.items.map(i=>i.label),['Inspect existing GUI','Build the shop frame','Wire purchases']);
  assert.equal(g.taskLabel,'Build a working shop.'.replace(/\.$/,''));
  a.record(g.id,'r2','command','Step 2 of 3: building the frame.');
  assert.deepEqual(a.active().plan.items.map(i=>i.status),['completed','in_progress','pending']);assert.equal(a.active().plan.done,1);
  a.record(g.id,'r3','assistant','Step 3 done.');
  assert.equal(a.active().plan.done,3);
  a.sync(true,'chat');a.finish(Date.now(),{collapse:true});assert(g.completed);
  // explicit AI checklist still replaces automatic plans
  const b=Activity.create();b.sync(true,'c2');b.task('Fix A. Then fix B.','k2');b.checklist([{label:'Fix the A bug',status:'in_progress'}]);
  assert.equal(b.active().plan.auto,undefined);assert.equal(b.active().plan.items.length,1);
  console.log('PASS checklist seeds numbered steps, adopts plans from command replies, tracks Step N progress and completes.');
 }
 { // F. auto creator enhancer only intercepts real creator saves and never ends a task on failure
  const main=fs.readFileSync('core/main.js','utf8');
  const s0=main.indexOf('  async function enhanceCreationBeforeTools(res){'),e0=main.indexOf('  let latestRequestCache=null;',s0);
  let performs=0,fail=false;
  const A={creatorTask:true,creatorContext:'UI policy',creatorRequestKey:'k',creatorEnhancedKey:null,stop:false,userStopped:false};
  const box=vm.createContext({A,activeEngine:()=>'roblox',rememberExecuted(){},diag(){},P:{lastAssistant:()=>null},ui:{toast(){}},
    creatorPromptEnhancer:{perform:async()=>{performs++;if(fail)throw Error('rewrite failed');return {base:7};}}});
  vm.runInContext(main.slice(s0,e0)+';this.enh=enhanceCreationBeforeTools;',box);
  assert.equal(await box.enh({calls:[{tool:'multi_edit',arguments:{}}]}),null);assert.equal(performs,0,'ordinary commands run unchanged');
  fail=true;assert.equal(await box.enh({calls:[{tool:'creation_preview',arguments:{action:'save'}}]}),null);assert.equal(performs,1);assert.equal(A.creatorEnhancedKey,'k');
  assert.equal(await box.enh({calls:[{tool:'creation_preview',arguments:{action:'save'}}]}),null);assert.equal(performs,1,'failed enhancement is not retried');
  A.creatorEnhancedKey=null;fail=false;assert.deepEqual(await box.enh({calls:[{tool:'creation_insert',arguments:{}}]}),{base:7});
  console.log('PASS auto enhancer leaves ordinary commands alone, runs once before creator saves and falls back on failure.');
 }
 { // E. skill reference is labelled and once per task
  const main=fs.readFileSync('core/main.js','utf8');
  assert(main.includes('One-time task reference (separate from the command result above')&&!main.includes('command has NOT run yet'));assert(main.includes('A.referenceDelivered.has(A.referenceTaskKey)'));
  console.log('PASS task reference context is labelled as not a result and delivered once per task.');
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
