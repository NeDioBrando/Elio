const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {JSDOM}=require('jsdom');
const {runInContext}=require('./test-support/provider-dom.cjs');
const notion=fs.readFileSync('providers/notion.js','utf8'),main=fs.readFileSync('core/main.js','utf8');
const dom=new JSDOM('<textarea placeholder="Frag die KI"></textarea>');
let ed=dom.window.document.querySelector('textarea');const original=ed;
const ctx={document:dom.window.document,findEditorRaw:()=>ed,isTextControl:e=>e.tagName==='TEXTAREA',setInterval:()=>1,clearInterval(){}};
vm.createContext(ctx);
runInContext(notion.slice(notion.indexOf('  let _lockWanted ='),notion.indexOf('  // ── typing + sending'))+'this.lock=setInputLock;',ctx);
ctx.lock(true);assert(original.readOnly);
ed=dom.window.document.createElement('textarea');ed.placeholder='replacement';dom.window.document.body.append(ed);ctx.lock(true);assert(ed.readOnly);
const replacement=ed;original.remove();ed=null;ctx.lock(false);
assert(!original.readOnly,'Detached original unlocks even when no editor is discoverable');
assert.equal(original.placeholder,'Frag die KI');assert(!replacement.readOnly);assert.equal(replacement.placeholder,'replacement');
ed=dom.window.document.createElement('textarea');ed.readOnly=true;ctx.lock(true);ctx.lock(false);assert(ed.readOnly,'Preserve native readonly controls');dom.window.close();
const watchdog=main.slice(main.indexOf('      // Measure real response progress.'),main.indexOf('      // Stuck injecting:',main.indexOf('      // Measure real response progress.')));
let now=1000,busy=true,text='thinking',unlocks=0,banners=0;
const box={A:{starting:true,_startingSince:1000,startGen:1,injectGeneration:1,startupOwner:1},Date:{now:()=>now},P:{isBusyNow:()=>busy,lastAssistant:()=>({text}),classifyText:i=>i.text,lastAssistantId:()=>1,setInputLock:on=>{assert(!on);unlocks++;}},ui:{setStarting(){throw Error('UI remounted');},inputCover(){},banner(){banners++;}},diag(){}};
vm.createContext(box);const tick=()=>vm.runInContext(watchdog,box);
tick();now=122000;tick();assert(box.A.starting,'Healthy native thinking must survive the old two-minute deadline');
text='real streamed progress';now=250000;tick();now=400000;tick();assert(box.A.starting);
now=551000;tick();assert(!box.A.starting);assert(box.A.stop);assert.equal(box.A.startGen,2);assert.equal(unlocks,1);assert.equal(banners,1);assert.equal(box.A.startupOwner,1,'Pending owner prevents a new send from reviving the old cancelled send');
box.A={starting:true,_startingSince:1000,_startupProgressAt:1000,_startupProgressToken:'1:7:stalled',startGen:1,injectGeneration:1};text='stalled';busy=false;now=122000;tick();assert(!box.A.starting,'Idle startup has a bounded deadline');
console.log('Notion detached/remounted editors unlock, native readonly survives, healthy thinking survives 2 minutes, stalled startup cancels and unlocks despite UI exceptions.');
async function startupCase(replies,expectedReady,expectedSends,expectedDispatches,throwUI=false){
 let sends=0,dispatches=0,unlocked=0;
 const b={A:{startGen:0,sessionGen:1,toolList:[{name:'read_file',server:'local'}]},P:{id:'notion',displayName:'Notion',chatIsEmpty:()=>true,lastAssistantId:()=>1,lastAssistant:()=>({}),conversationKey:()=>'/ai',setInputLock:on=>{if(!on)unlocked++;},ensureComposerReady:async()=>({ready:true}),startupReplySettled:()=>true},
 condoLocked:()=>false,diag(){},activeEngine:()=> 'local',ensureTools:async()=>{},systemPrompt:()=> '⟦RS-SYS⟧',submitAndGetBase:async()=>++sends,
 waitForResponse:async()=>replies.shift(),RSParse:{parseToolCalls:text=>text.includes('"list_commands"')?[{tool:'list_commands',arguments:{}}]:[]},
 decorate:{sweep(){},toolBox(){}},ui:{setStarting:on=>{if(throwUI&&!on)throw Error('remounted UI');},inputCover(){},updateStartGate(){},trackCard(){},setStarted(){},toast(){},banner(){}},
 startupTurnIdentity:()=>({}),rememberExecuted(){},runTool:async()=>{dispatches++;return 'read_file';},rememberStartupOutcome(){},rememberSession(){},SendAbortedError:class extends Error{},RUN_CMD:'run',log(){}};
 vm.createContext(b);const start=main.indexOf('  async function startSession('),end=main.indexOf('  const SVG =',start);
 vm.runInContext(main.slice(main.indexOf('  function isProviderPolicyRefusal('),main.indexOf('  function isCapabilityRefuse('))+main.slice(start,end)+'this.start=startSession;',b);
 await b.start();assert.equal(!!b.A.started,expectedReady);assert.equal(sends,expectedSends);assert.equal(dispatches,expectedDispatches);assert.equal(unlocked,1);assert(!b.A.startupOwner);assert(!b.A.starting);
}
const list={kind:'tool',calls:[{tool:'list_commands',arguments:{}}],item:{}};
(async()=>{
 await startupCase([list,{kind:'text',text:'elio ist bereit.'}],true,2,1);
 await startupCase([{kind:'text',text:'Ich helfe dir gerne.'},{kind:'text',text:'```json\n{"command":"list_commands"}\n```'},{kind:'text',text:'elio is ready.'}],true,3,1);
 await startupCase([{kind:'text',text:'prose'},{kind:'text',text:'still prose'}],false,2,0);
 await startupCase([{kind:'tool',calls:[{tool:'execute_luau',arguments:{}}]}],false,1,0);
 await startupCase([list,{kind:'text',text:'I might be ready now'}],false,2,1,true);
 console.log('Actual Notion bootstrap corrects prose once, requires a real list command, accepts exact German acknowledgement, rejects wrong tools/ambiguous readiness, and unlocks even when UI cleanup throws.');
})().catch(e=>{console.error(e);process.exitCode=1;});
