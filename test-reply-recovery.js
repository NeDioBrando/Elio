const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('core/main.js','utf8'),code=s.slice(s.indexOf('  async function agentLoop('),s.indexOf('  // Mark the current assistant turn',s.indexOf('  async function agentLoop(')));
async function run(replies,ready=true,draft=''){
 let restart=0,sent=[],locks=[],finishes=[],warnings=[],status=0;
 const box={Map,Set,Date,Promise,A:{started:true,sessionGen:1,toolList:[]},P:{conversationKey:()=> 'chat-a',allItems:()=>[],isUserItem:()=>false,assistantCount:()=>0,lastAssistant:()=>null,isHardGenerating:()=>false,editorText:()=>draft,setInputLock:on=>locks.push(on)},document:{hidden:false},synerixcodeReliability:{createBudget:()=>({})},reliabilitySettings:{},condoLocked:()=>false,
 activity:{active:()=>true,sync(){}},syncActivityItems(){},markActivity(){},diag(){},ui:{showStop(){},inputCover:on=>locks.push(on),toast(){},setStatus(){},banner:(_,name)=>warnings.push(name)},
 beginTaskCheckpoint:async()=>{box.A.taskRequest='Fix the existing bug';},finishTaskCheckpoint:complete=>{finishes.push(complete);return new Promise(()=>{});},cowork:{take:async()=>null,snapshot:()=>({pending:[]})},bg:async()=>{status++;return{ok:true,local_connected:ready};},activeEngine:()=> 'local',waitForResponse:async()=>({kind:'text',text:replies.shift()||'Finished.'}),playSfx(){},SendAbortedError:class extends Error{},
 startSession:async opts=>{assert(opts.restart);restart++;return{ready:true};},sessionReminderPrompt:()=> 'Session instructions',submitAndGetBase:async text=>{sent.push(text);return 0;}};
 vm.createContext(box);const a=s.indexOf('  function isProviderPolicyRefusal('),b=s.indexOf('  const activity =',a);
 vm.runInContext(s.slice(a,b)+code+'this.loop=agentLoop;',box);
 await Promise.race([box.loop(0),new Promise((_,reject)=>setTimeout(()=>reject(Error('Reply stayed blocked on checkpoint bookkeeping')),500))]);
 assert.equal(box.A.running,false);assert.equal(locks.at(-1),false);
 return{restart,sent,finishes,warnings,status,locks};
}
(async()=>{
 let r=await run(['Normal answer.']);assert.equal(r.restart,0);assert.equal(r.status,0);assert(r.finishes.includes(true));
 r=await run(['I cannot use local commands in this chat.','Finished.']);assert.equal(r.restart,1);assert.equal(r.sent.length,1);assert(r.sent[0].includes('Fix the existing bug'));assert(r.finishes.includes(false));
 r=await run(['I cannot use commands.','I cannot use commands.']);assert.equal(r.restart,1);assert(r.warnings.includes('Command access recovery stopped'));assert(!r.finishes.includes(true));
 r=await run(['I cannot use commands.'],false);assert.equal(r.restart,0);assert.equal(r.status,1);
 r=await run(['I cannot use commands.'],true,'My unsent draft');assert.equal(r.restart,0);assert.equal(r.sent.length,0);
 r=await run(['I cannot draw that picture.']);assert.equal(r.restart,0);assert.equal(r.status,0);
 assert(!s.includes('const SYS_FALLBACK_IDLE_MS'));assert(!s.includes('if (A.toolCallsSinceReminder >= REMIND_TOOLS_EVERY)'));
 console.log('Actual loop unlocks normal replies without waiting for checkpoint I/O, never sends periodic reminders, reconnects once only for command-access loss with a live engine, preserves unfinished goals/drafts, and bounds repeat failures.');
})().catch(e=>{console.error(e);process.exitCode=1;});
