// Exercise actual agentLoop across an asynchronous visibility handoff. No bridge.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const main=fs.readFileSync('core/main.js','utf8');
const guard=main.slice(main.indexOf('  function verifyResponseOwner('),main.indexOf('  async function waitForResponse('));
const loop=main.slice(main.indexOf('  async function agentLoop('),main.indexOf('  // Mark the current assistant turn',main.indexOf('  async function agentLoop(')));
async function test(mode){
 const first={dataset:{}},second={dataset:{}};let item=first,token='turn-a',chat='chat-a',calls=0,records=[],warnings=[],locks=[],parked=0;
 const A={started:true,sessionGen:1,sendToken:'before',toolList:[],imageTools:new Set()};
 const P={conversationKey:()=>chat,lastAssistantId:()=>token,lastAssistant:()=>item,allItems:()=>[item],isUserItem:()=>false,assistantCount:()=>1,isHardGenerating:()=>false,setInputLock:v=>locks.push(v)};
 const text='{"command":"list_commands","params":{}}';
 const box={A,P,Map,Set,Date,Promise,document:{hidden:false},synerixcodeReliability:{createBudget:()=>({})},reliabilitySettings:{},condoLocked:()=>false,
  activity:{active:()=>true,sync(){}},syncActivityItems(){},markActivity(){},diag(){},ui:{showStop(){},inputCover(){},toast(){},setStatus(){},banner:(_,title)=>warnings.push(title),trackCard(){}},
  beginTaskCheckpoint:async()=>{},finishTaskCheckpoint:async()=>{},cowork:{snapshot:()=>({pending:[]})},playSfx(){},SendAbortedError:class extends Error{},
  waitForResponse:async()=>{box.document.hidden=true;return{kind:'tool',calls:[{tool:'list_commands',arguments:{}}],item:first,text,responseOwner:{session:1,sendToken:'before',token:'turn-a',chat:'chat-a',item:first}}},
  waitVisible:async()=>{parked++;await Promise.resolve();box.document.hidden=false;if(mode==='route')chat='chat-b';if(mode==='token')token='turn-b';if(mode==='session')A.sessionGen++;if(mode==='send')A.sendToken='other';if(mode==='missing')item=null;if(mode==='remount')item=second;return true},
  synerixcodeToolGuard:{repair:v=>v,check:()=>[]},bareToolName:v=>v,RS:{toolCategory:()=> 'info'},decorate:{toolBox(){}},argSummary:()=>'',callBody:()=>'',rememberExecuted:(el,txt)=>records.push({el,txt}),
  runTool:async()=>{calls++;throw Error('fixture stops immediately after dispatch')},activeEngine:()=> 'local',enhanceCreationBeforeTools:async()=>false
 };
 vm.createContext(box);vm.runInContext(guard+loop+';this.loop=agentLoop;',box);await box.loop(0);
 assert.equal(parked,1);assert.equal(A.running,false);assert.equal(locks.at(-1),false);
 if(mode==='valid'||mode==='remount'){assert.equal(calls,1);assert.equal(records.length,1);assert.equal(records[0].txt,text);assert.equal(records[0].el,mode==='remount'?second:first);}else{assert.equal(calls,0);assert.equal(records.length,0);assert(warnings.includes('Response changed — run paused'));assert(!warnings.includes('Internal loop error'));}
 console.log('PASS actual async loop ownership',mode);
}
(async()=>{for(const mode of ['valid','remount','route','token','session','send','missing'])await test(mode)})().catch(e=>{console.error(e);process.exitCode=1});
