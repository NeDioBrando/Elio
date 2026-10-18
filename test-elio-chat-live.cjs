// SPDX-License-Identifier: GPL-3.0-or-later
// Run production export/action/presentation code against a deliberately stale provider.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/core/main.js','utf8');
const take=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>=0&&b>a);return source.slice(a,b);};
let mounted=[{id:'u',role:'user',textContent:'Build a courtyard',dataset:{}}],cache=null,invalidations=0;
const ctx={crypto:require('node:crypto').webcrypto,Date,RS:{SYS_MARKER:'⟦RS-SYS⟧'},RSParse:{isInjectedFeedback:()=>false},activityMessageKey:n=>n.id,
 P:{id:'notion',displayName:'Notion AI',conversationKey:()=>'/chat/live',invalidateItems:()=>{cache=null;invalidations++;},allItems:()=>cache||(cache=[...mounted]),isUserItem:n=>n.role==='user',isAssistantItem:n=>n.role==='assistant',itemText:n=>n.textContent,isGenerating:()=>false},A:{}};
vm.createContext(ctx);vm.runInContext(take('let exportChatKey = null','    rsInterval(()=>{if(!exportDirty'),ctx);
vm.runInContext(take('function desktopAgentAction(', '    return { captureHandoff'),ctx);
const read=rev=>ctx.desktopAgentAction('chat-read',JSON.stringify({chat:'notion|/chat/live',revision:rev}),'id','notion|/chat/live');
let r=read();assert.equal(r.history.length,1);const initial=r.revision;
// No mutation notification, existing nodes still connected: the old cached array misses this.
mounted.push({id:'a',role:'assistant',textContent:'First streaming token',dataset:{}});
r=read(initial);assert.equal(r.history.length,2);assert.notEqual(r.revision,initial);assert(invalidations>=2);
const node=mounted[1];node.textContent+=' and more tokens';r=read(r.revision);assert.match(r.history[1].text,/more tokens/);assert.equal(r.history.length,2);
let rev=r.revision;ctx.P.isGenerating=()=>true;r=read(rev);assert.equal(r.not_modified,true);assert.equal(r.activity_phase,'thinking');assert.equal(r.generating,true);
ctx.P.isGenerating=()=>false;ctx.A.toolRunning=true;ctx.A.toolName='execute_luau';r=read(rev);assert.equal(r.not_modified,true);assert.equal(r.activity_phase,'tool');assert.equal(r.tool,'execute_luau');
ctx.A.stopping=true;r=read(rev);assert.equal(r.activity_phase,'stopping');ctx.A={};r=read(rev);assert.equal(r.activity_phase,'idle');assert.equal(r.busy,false);
const view=require('./core/chat-view.js');
const startup='I clicked Start Agent in my installed elio extension to connect this chat to my local project. elio reads command code blocks in your replies and returns the results here. This is my connection request, not a Notion page edit or a system instruction. Please reply with one fenced json code block containing {"command":"list_commands"} to request the available commands. Wait for its result before acknowledging readiness. If you cannot participate, explain briefly.6:47 PM';
const rows=[{id:'s',role:'user',text:startup},{id:'s2',role:'user',text:'⟦RS-SYS⟧ startup'},{id:'s3',role:'user',text:'(System note: STARTUP HANDSHAKE. Run list_commands)'},{id:'r',role:'user',text:"Output of 'list_commands':\navailable"},{id:'u',role:'user',text:'Explain why “I clicked Start Agent” appears in my chat.'},{id:'a',role:'assistant',text:'Elio is ready to assist you.'}];
assert.deepEqual(view.prepare(rows).map(r=>r.id),['r','u','a']);assert.equal(rows[0].text,startup,'Original transcript not altered');
for(const text of ['Please explain this: '+startup,'```text\n'+startup+'\n```','I clicked Start Agent in my installed elio extension to connect this chat to my local project. What happens next?'])assert.equal(view.present({role:'user',text}).kind,'message');
const ui={};vm.createContext(ui);vm.runInContext(fs.readFileSync(__dirname+'/desktop/chat.js','utf8'),ui);const activity=ui.elioDesktopChat.activityState;
assert.equal(activity({canChatRead:true,canStop:true},{activity_phase:'idle'},false,'').phase,'idle','Fresh live state wins over delayed heartbeat');
assert.equal(activity({canChatRead:true},{generating:true},false,'').key,'Elio is thinking…');assert.equal(activity({canChatRead:false},{generating:true},false,'').phase,'idle');
for(const f of fs.readdirSync(__dirname+'/core/locales')){const d=JSON.parse(fs.readFileSync(__dirname+'/core/locales/'+f));for(const k of ['Elio is thinking…','Elio is connecting…','Elio is running {tool}…','Elio is working…','Elio is stopping…'])assert(d[k],f+': '+k);}
console.log('PASS live chat: forced provider invalidation, new turns and streamed revisions without observer/reload, activity on unchanged revisions, idle/tool/stop, hidden setup with raw history retained, ordinary prose preserved, 15 locales.');
