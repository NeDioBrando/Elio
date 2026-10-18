const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('core/main.js','utf8'),config=fs.readFileSync('core/config.js','utf8');
const box={console,Map,Set,Date,A:{started:true},P:{chatIsEmpty:()=>false,conversationKey:()=> 'same-chat'},diag(){},engine:'local'};
vm.createContext(box);vm.runInContext(config+';this.rs=RS;',box);
box.systemPrompt=()=>box.rs.buildSystemPrompt({engine:box.engine,siteName:'Test AI',customPrompt:'Preserve my exact project convention.',fullAccess:true});
const a=source.indexOf('  function sessionReminderPrompt()'),b=source.indexOf('  let lastMemoryContext',a);
vm.runInContext(source.slice(a,b)+'this.reminder=sessionReminderPrompt;',box);
for(const engine of ['local','roblox']){
 box.engine=engine;const startup=box.systemPrompt(),reminder=box.reminder();
 assert(startup.includes('Your very first action'));
 assert(!reminder.includes('Your very first action'));assert(!reminder.includes('reply with exactly "elio is ready."'));
 assert(reminder.includes('SESSION STATE: elio is already ready.'));assert(reminder.includes('Preserve my exact project convention.'));
 assert(reminder.includes(box.rs.RESEND_MARKER));assert(reminder.includes('pending follow-ups'));
}
assert(!source.includes('const SYS_FALLBACK_IDLE_MS'));assert(!source.includes('const rider ='));assert(source.includes('Recovery is triggered only by an explicit command-access refusal.'));
const start=source.indexOf('  async function startSession('),end=source.indexOf('  const SVG =',start);
box.SendAbortedError=class extends Error{};box.A.startGen=0;box.A.toolList=[];box.ensureTools=async()=>{};
box.P.lastAssistantId=()=>null;box.P.chatIsEmpty=()=>false;box.ui={setStarting(){throw Error('A duplicate Start reached startup');},updateStartGate(){},inputCover(){},toast(){},banner(){throw Error('A duplicate Start reached startup');}};box.P.setInputLock=()=>{};
vm.runInContext(source.slice(start,end)+'this.start=startSession;',box);
(async()=>{
 const result=await box.start();assert(result.ready&&result.alreadyStarted);
 box.A.starting=true;assert((await box.start()).alreadyStarted);
 box.A.starting=false;box.A.running=true;assert.equal(await box.start({restart:true}),undefined);
 box.A.running=false;await assert.rejects(box.start({restart:true}),/duplicate Start reached startup/);
 box.P.chatIsEmpty=()=>true;await assert.rejects(box.start(),/duplicate Start reached startup/);
 console.log('Both engines preserve bootstrap on initial Start, remove it from both reminder paths, retain custom rules, and reject duplicate Start while permitting explicit Restart and fresh chats.');
})().catch(e=>{console.error(e);process.exitCode=1;});
