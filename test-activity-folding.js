const fs=require('fs'),vm=require('vm'),assert=require('assert');
const Activity=require('./core/activity.js'),Parser=new Function(fs.readFileSync('./core/parser.js','utf8')+';return RSParse;')();
const source=fs.readFileSync('core/main.js','utf8');
const start=source.indexOf('  const activity = elioActivity.create('),end=source.indexOf('  const cowork =',start);
let items=[],chat='chat-a',tick,canMount=true;
const context={RS:{SYS_MARKER:'⟦RS-SYS⟧'},elioChecklist:{userText:(item,read)=>read(item)},elioActivity:{...Activity,renderer:()=>({sync(groups){return new Set(canMount ? groups.map(group=>group.id) : []);}})},RSParse:Parser,Map,Set,document:{hidden:false},A:{running:false,starting:false},ui:{renderActivity(){}},P:{conversationKey:()=>chat,itemKey:x=>x.id,allItems:()=>items,isUserItem:x=>x.role==='user',itemText:x=>x.text,classifyText:x=>x.text,lastAssistant:()=>items.filter(x=>x.role==='assistant').at(-1),lastAssistantId:()=>items.filter(x=>x.role==='assistant').at(-1)?.id,isGenerating:()=>false},rsInterval:fn=>{tick=fn;},turnKey:x=>x.id};
vm.createContext(context);vm.runInContext(source.slice(start,end)+source.slice(source.indexOf('  let latestRequestCache=null;'),source.indexOf('  async function beginTaskCheckpoint()'))+';this.state=activity;this.mark=markActivity;this.sync=syncActivityItems;',context);
function item(id,text,role='assistant'){return {id,text,role,isConnected:true,dataset:{}};}
const ready=item('ready','elio is ready.');items=[ready];tick();
context.A.starting=true;context.A.running=true;tick();assert.equal(context.state.list(chat).length,0);context.A.starting=false;context.A.running=false;tick();
items.push(item('goal','Fix the project scripts.','user'));context.A.running=true;const first=item('one','Reading your project…');items.push(first);tick();assert.equal(first.dataset.rsActivityFolded,'0');
first.text='Reading your project and checking scripts.';tick();
const list=item('list','```json\n{"command":"list_commands","params":{}}\n```');items.push(list);context.mark(list);assert(!list.dataset.rsActivity);
const listResult=item('list-result',"Output of 'list_commands':\nread_file",'user');items.push(listResult);context.mark(listResult);assert(!listResult.dataset.rsActivity);
const tool=item('tool','```json\n{"command":"read_file","params":{"path":"a.lua"}}\n```');items.push(tool);context.mark(tool);
const result=item('result',"Output of 'read_file':\nexact source",'user');items.push(result);context.mark(result);
const followup=item('followup','Also check a second issue.','user');items.push(followup);tick();assert.equal(followup.dataset.rsActivityFolded,'0');
const unmarked=item('unmarked','Investigating the second issue.');items.push(unmarked);tick();assert.equal(unmarked.dataset.rsActivityFolded,'0');
const answer=item('answer','Finished the fix.');items.push(answer);context.mark(answer);context.A.running=false;tick();
for(const x of [first,tool,result,followup,unmarked,answer])assert.equal(x.dataset.rsActivityFolded,'0');
assert(context.state.list(chat)[0].expanded, 'Completion keeps the task open');
context.state.toggle(context.state.list(chat)[0].id);context.sync();
for(const x of [first,tool,followup,unmarked,answer])assert.equal(x.dataset.rsActivityFolded,'0');assert.equal(result.dataset.rsActivityFolded,'1');
assert(!ready.dataset.rsActivity);assert(!list.dataset.rsActivity);assert(!listResult.dataset.rsActivity);
const group=context.state.list(chat)[0];context.state.toggle(group.id);context.sync();for(const x of [first,tool,result,followup,unmarked,answer])assert.equal(x.dataset.rsActivityFolded,'0');
context.state.toggle(group.id);context.sync();const replacement=item('answer','Finished the fix.');answer.isConnected=false;items[items.indexOf(answer)]=replacement;context.sync();assert.equal(replacement.dataset.rsActivityFolded,'0');
canMount=false;context.sync();for(const x of [first,tool,result,followup,unmarked,replacement])assert.equal(x.dataset.rsActivityFolded,'0');
canMount=true;context.sync();assert.equal(first.dataset.rsActivityFolded,'0');assert.equal(result.dataset.rsActivityFolded,'1');
context.A.running=true;const interrupted=item('interrupted','In-progress changes stay visible.');items.push(interrupted);tick();context.A.userStopped=true;context.A.running=false;tick();assert.equal(interrupted.dataset.rsActivityFolded,'0');assert(context.state.list(chat).at(-1).expanded);context.A.userStopped=false;
context.A.running=true;const paused=item('paused','Waiting for approval.');items.push(paused);tick();context.A.budgetResume=true;context.A.running=false;tick();assert.equal(paused.dataset.rsActivityFolded,'0');context.A.budgetResume=false;
chat='chat-b';context.A.running=true;items=[item('new-goal','Fix a different project.','user'),item('answer','A different chat.')];tick();assert.equal(items.at(-1).dataset.rsActivityFolded,'0');assert.equal(context.state.list(chat).length,1);
for(const text of ['ELIO_READY','**elio is ready.**','⟦RS-SYS⟧\nstartup',"Output of 'list_tools': tools"])assert(Activity.exempt(text));
assert(!Activity.exempt('After elio is ready, fix this.'));
assert(!Activity.exempt('Normal reply', [{tool:'list_commands'},{tool:'read_file'}]));
assert(source.includes('markActivity(res.item);\n')||source.includes('markActivity(res.item);\r\n'));
assert(source.includes('id="rs-bar-version" data-elio-version'));
for(const provider of ['chatgpt','notion','arena']){context.P.id=provider;for(const x of items)x.dataset.rsActivityFolded='1';context.sync();for(const x of items)assert.equal(x.dataset.rsActivityFolded,undefined,provider+' must never fold its messages');}
console.log('Task prose, command/results, final replies, streaming identity, manual completion collapse, reopen, remount, chat isolation and startup/list/ready exceptions passed.');
const detail=activityDetailsTest();
function activityDetailsTest(){
 const a=Activity.create();a.sync(true,'chat',1);const id=a.active().id;
 a.record(id,'reply','assistant','Exact <reply>');a.record(id,'command','command','{"command":"read_file"}');a.record(id,'result','result',"Output of 'read_file': source");
 let r=a.read(id);assert.deepEqual(r.messages.map(x=>x.role),['assistant','command','result']);assert.equal(r.messages[0].text,'Exact <reply>');const revision=r.revision;
 a.record(id,'reply','assistant','Exact <reply>');assert(a.read(id,revision).not_modified);
 a.record(id,'reply','assistant','Streamed final');assert.equal(a.read(id).messages.length,3);assert.equal(a.read(id).messages[0].text,'Streamed final');
 a.removeMessage(id,'command');assert.equal(a.read(id).messages.length,2);a.sync(false,'chat',20);assert.equal(a.read(id).messages[0].text,'Streamed final');
 a.sync(true,'other',21);assert(!a.read('unknown').ok);
 const big=a.active().id;for(let i=0;i<125;i++)a.record(big,String(i),'assistant','x'.repeat(2000));r=a.read(big);assert(r.omitted>0);assert(r.messages.length<=120);assert(r.messages.reduce((n,m)=>n+m.text.length,0)<=200000);
 a.record(big,'huge','assistant','x'.repeat(200001));const hugeRev=a.read(big).revision;a.record(big,'huge','assistant','x'.repeat(200001));assert(a.read(big,hugeRev).not_modified);
 console.log('Desktop activity details retain exact replies, commands/results, deduplicate streaming, support revision reads, survive completion and enforce explicit retention notices.');
 return true;
}
// Starting agentLoop must preserve older history even when it creates the group before the timer.
const begin=source.indexOf('  async function agentLoop(base, recoveryAttempt = 0) {'),boundary=source.indexOf('    A.resumeArmed = false;',begin);
const old1=item('older1','Earlier unrelated reply.'),old2=item('older2','Another earlier reply.'),request=item('new-user','New task.','user'),stream=item('new-stream','Starting the new task.');
const boot={elioReliability:require('./core/reliability.js'),reliabilitySettings:{rsToolBudget:100,rsTaskMinutes:30},A:{},condoLocked:()=>false,P:{allItems:()=>[old1,old2,request,stream],isUserItem:x=>x.role==='user',assistantCount:()=>3,conversationKey:()=>chat},activity:{active:()=>null},WeakSet};vm.createContext(boot);vm.runInContext(source.slice(begin,boundary)+'return activitySeenItems;}this.begin=agentLoop;',boot);
boot.begin(2).then(seen=>{assert(seen.has(old1));assert(seen.has(old2));assert(!seen.has(stream));console.log('Starting a new work group preserves unrelated older assistant history.');}).catch(error=>{console.error(error);process.exitCode=1;});
