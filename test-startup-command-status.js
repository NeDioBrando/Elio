const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('core/main.js','utf8');
const command='```json\n{"command":"list_commands","params":{}}\n```';
let current={id:'startup-command',text:command,dataset:{}},items=[current],chat='chat-a',dispatches=0,remembered=0;
const phases=[];
const box={Map,Set,Date,A:{startGen:0,sessionGen:1,toolList:[{name:'read_file',server:'local',description:'Read a file.',inputSchema:{properties:{path:{type:'string'}},required:['path']}}]},
 P:{id:'notion',displayName:'Notion',prepareSessionStart:async()=>({ready:true}),chatIsEmpty:()=>true,lastAssistantId:()=>current.id,lastAssistant:()=>current,conversationKey:()=>chat,setInputLock(){},ensureComposerReady:async()=>({ready:true}),classifyText:i=>i.text,isAssistantItem:i=>i.role!=='user'},
 assistantIdx:i=>items.filter(x=>x.role!=='user').indexOf(i),turnKey:i=>i.id,condoLocked:()=>false,diag(){},activeEngine:()=> 'local',ensureTools:async()=>{},systemPrompt:()=> '⟦RS-SYS⟧',submitAndGetBase:async()=>0,
 waitForResponse:async()=>dispatches?{kind:'text',text:'synerixcode is ready.'}:{kind:'tool',calls:[{tool:'list_commands',arguments:{}}],item:current},
 rememberExecuted(){remembered++;},rememberSession(){},decorate:{sweep(){},toolBox(i,name,phase,detail){phases.push({name,phase,detail});}},
 ui:{setStarting(){},updateStartGate(){},inputCover(){},trackCard(){},setStarted(){},toast(){},banner(){throw Error('Unexpected startup failure');}},
 RSParse:{parseToolCalls:()=>[],hasCommandShape:text=>text.includes('"command"')},SendAbortedError:class extends Error{},RUN_CMD:'Start-synerixcode-Agent.cmd',
 runTool:async()=>{dispatches++;current={id:'startup-command',text:command,dataset:{}};items=[current];return "Output of 'list_commands':\nread_file";}};
vm.createContext(box);
// The actual bootstrap now checks model refusal during the context stage too.
// Load its real helpers into this isolated VM; keep all outcome assertions.
vm.runInContext(source.slice(source.indexOf('  function isProviderPolicyRefusal('),source.indexOf('  function notionPlainText(')),box);
// 1.24.12: Notion readyPrompt preferences pass through the real notionPlainText helper.
vm.runInContext(source.slice(source.indexOf('  function notionPlainText('),source.indexOf('  const PLAN_CONTINUE_FEEDBACK')),box);
box.P.itemText=i=>i.text;const user={role:'user',text:'⟦RS-SYS⟧ startup attachment synerixcode_protocol_1.txt'};box.P.allItems=()=>[user,...items];box.P.isUserItem=i=>i.role==='user';
const executedHelpers=source.slice(source.indexOf('  const executed = new Map()'),source.indexOf('  const startupOutcomes ='));
vm.runInContext(executedHelpers+'this.didExecute=isRememberedExecuted;',box);
const remember=box.rememberExecuted;
box.rememberExecuted=i=>{remembered++;remember(i);};
const helpers=source.slice(source.indexOf('  const startupOutcomes ='),source.indexOf('  let reliabilitySettings='));
const start=source.indexOf('  async function startSession('),end=source.indexOf('  const SVG =',start);
vm.runInContext(helpers+source.slice(start,end)+'this.start=startSession;this.lookup=startupOutcome;this.capture=startupTurnIdentity;this.save=rememberStartupOutcome;',box);
(async()=>{
 assert((await box.start()).ready);assert.equal(dispatches,1);assert.equal(remembered,1);assert(box.A.started);assert(!box.A.starting);
 assert.equal(box.lookup(current,current.text).phase,'done');assert.equal(box.lookup(current,current.text).detail,'1 commands');
 const classifyStart=source.indexOf('    classify(item, next) {'),classifyEnd=source.indexOf('      // NOTE on the',classifyStart);
 vm.runInContext('this.restore={'+source.slice(classifyStart,classifyEnd)+'},toolBox(i,name,phase,detail,owned){this.last={name,phase,detail,owned};},ensureOwnedChip(){}};',box);
 box.restore.classify(current,null);assert.equal(box.restore.last.phase,'done');assert(box.restore.last.owned);
 assert.equal(dispatches,1,'Restoring a remounted chip must not dispatch again');
 assert(box.didExecute(current,current.text),'The watchdog dispatch guard must remember the remounted startup command');
 assert.equal(box.lookup({...current,text:command.replace('list_commands','read_file')},command.replace('list_commands','read_file')),null);
 current={...current,id:'settled-event-anchor',dataset:{}};items=[current];
 assert.equal(box.lookup(current,command).phase,'done','Notion outer anchor replacement');
 assert(box.didExecute(current,command),'No re-dispatch after anchor replacement');
 box.restore.classify(current,null);assert.equal(box.restore.last.phase,'done');
 items=[current,{id:'later-command',text:command,dataset:{}}];
 assert.equal(box.lookup(items[1],command),null,'Identical later command remains distinct');
 items=[current];
 const prior=user.text;user.text='A later request';assert.equal(box.lookup(current,command),null,'Window shift with a later user request cannot match startup');user.text=prior;
 assert.equal(box.lookup({...current,id:'different-turn'},command),null);
 chat='other-chat';assert.equal(box.lookup(current,command),null);chat='chat-a';
 assert.equal(box.lookup({...current,role:'user'},command),null);
 box.save(box.capture(current),'err','offline');assert.equal(box.lookup(current,command).phase,'err');
 console.log('Actual bootstrap executes once, remembers dispatch, retains the confirmed outcome after an in-flight node replacement, restores the card without rerunning, and isolates changed commands/turns/chats/errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
