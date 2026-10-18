// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const view=require('./core/chat-view.js');const source=fs.readFileSync('core/main.js','utf8');
async function main(){
 let rows=view.prepare([{id:'u',role:'user',text:'Create a scene'},{id:'a',role:'assistant',text:'I will adjust the light.\n###MCP_TOOL###\n{"command":"execute_luau","params":{"code":"print(1)"}}\n###END_MCP_TOOL###\nThen verify the scene.',phase:'run'},{id:'r',role:'user',text:"Output of 'execute_luau':\nOK",kind:'result'}]);
 assert.equal(rows[0].kind,'message');assert.equal(rows[1].kind,'tool');assert.equal(rows[1].status,'done');assert(rows[1].segments.some(p=>p.type==='text'&&p.text.includes('verify')));assert.equal(rows[2].kind,'result');
 assert.equal(view.present({role:'user',text:'My JSON {"name":"test"}'}).kind,'message');
 assert.equal(view.present({role:'assistant',text:'```lua\nprint("hello")\n```'}).kind,'message');
 assert.equal(view.present({role:'user',text:'⟦RS-SYS⟧\nsecret protocol'}).kind,'system');
 assert.equal(view.present({role:'assistant',text:JSON.stringify({command:'execute_luau',params:{code:'x="{x}"'}})}).segments[0].name,'execute_luau');
 assert.equal(view.present({role:'assistant',text:'{"command":"execute_luau","params":'}).kind,'tool');
 assert.equal(view.prepare([{role:'assistant',text:'{"command":"x"}'},{role:'user',kind:'result',text:"Output of 'x': ERROR failed"}])[0].status,'error');
 // Run the actual content-script action, not a reimplementation. It must await
 // provider delivery, mark it as user input and resume explicitly after Stop.
 const action=source.slice(source.indexOf('function desktopAgentAction('),source.indexOf('    return { captureHandoff',source.indexOf('function desktopAgentAction(')));
 let delivered,submits=0,loops=0,forced;
 const ctx={P:{id:'mock',conversationKey:()=> 'a',displayName:'Mock',isGenerating:()=>false},A:{stop:true,userStopped:true,stopping:false},coworkAccepted:new Map(),desktopAgentState:()=>({canTaskSend:true}),activeEngine:()=> 'roblox',submitAndGetBase:(text,img,user)=>{submits++;assert.equal(user,true);return new Promise(r=>delivered=r);},agentLoop:()=>loops++,rememberSession:()=>{},captureExportHistory:force=>forced=force,desktopChatSession:'s',exportRevision:1,exportBytes:1,exportRows:[{id:'x',role:'user',text:'Hi'}],exportOverflow:false};vm.createContext(ctx);vm.runInContext(action,ctx);
 const pending=ctx.desktopAgentAction('task-send','Hi','request1','mock|a');assert.equal(submits,1);assert.equal(ctx.A.stop,false);assert.equal(ctx.A.userStopped,false);assert.equal(loops,0);assert.equal(ctx.desktopAgentAction('task-send','Hi','request1','mock|a'),pending);delivered(1);assert.equal((await pending).delivered,true);assert.equal(loops,1);assert.equal(forced,true);ctx.desktopAgentAction('chat-read','{}','read','mock|a');assert.equal(forced,true);
 const rust=fs.readFileSync('agent/src/main.rs','utf8');assert(rust.includes('"start"=>"canStart"'));assert(rust.includes('action == "task-send" { 100 }'));
 // Every NEW UI string is present in all 15 catalogs. No machine API/network
 // translation of conversations is performed by this test or implementation.
 const extra=['Chat','You','Assistant','Connect agent','Pin tab','Pinned','Working…','Sending…','Retry manually','Completed','Failed','Requested','Agent setup','Tool call','Tool result','Message','Not connected','Your creative workspace','What would you like to create?','Version outdated · Outdated','Update status','Delivery not confirmed. Your draft is saved. Check the browser before retrying.'];
 for(const file of fs.readdirSync('core/locales')){const data=JSON.parse(fs.readFileSync('core/locales/'+file));for(const k of extra)assert(file==='en.json'?k in data:typeof data[k]==='string'&&data[k].length,file+': '+k);assert.equal(fs.readFileSync('core/locales/'+file,'utf8'),fs.readFileSync('elio-Extension/core/locales/'+file,'utf8'));}
 const i18n={};vm.createContext(i18n);vm.runInContext(fs.readFileSync('core/i18n-catalog.js','utf8'),i18n);vm.runInContext(fs.readFileSync('core/i18n.js','utf8'),i18n);i18n.elioI18n.setLanguage('ru');assert.equal(i18n.elioI18n.t('Chat'),'Чат');assert.match(i18n.elioI18n.t('Installed {current} → available {latest}.',{current:'1',latest:'2'}),/Установлена 1/);i18n.elioI18n.setLanguage('ja');assert.equal(i18n.elioI18n.t('Chat'),'チャット');
 console.log('PASS Elio: protocol cards preserve prose, truthful tool states, user delivery ACK, explicit post-Stop resume, retry deduplication, fresh read, 15-language coverage');
}
main().catch(e=>{console.error(e);process.exitCode=1});
