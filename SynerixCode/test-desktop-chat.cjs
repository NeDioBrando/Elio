// SPDX-License-Identifier: GPL-3.0-or-later
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'core/main.js'),'utf8');
const background=fs.readFileSync(path.join(__dirname,'background.js'),'utf8');
function functionText(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);assert(a>=0&&b>a);return text.slice(a,b);}
async function main(){
  let captureCount=0;
  const context={P:{id:'mock',conversationKey:()=> 'chat-a',displayName:'Mock AI',isGenerating:()=>true},captureExportHistory:()=>captureCount++,desktopChatSession:"page-session-a",exportRevision:7,exportRows:[{id:'u',role:'user',text:'Request'},{id:'a',role:'assistant',text:'Streaming'}],exportBytes:16,exportOverflow:false};
  vm.createContext(context);
  vm.runInContext(functionText(source,'function desktopAgentAction(', '    return { captureHandoff'),context);
  let result=context.desktopAgentAction('chat-read','{}','id','mock|chat-a');
  assert.equal(result.history.length,2);assert.equal(result.generating,true);assert.equal(captureCount,1);
  const revision=result.revision;
  result=context.desktopAgentAction('chat-read',JSON.stringify({chat:'mock|chat-a',revision}),'id','mock|chat-a');
  assert.equal(result.not_modified,true);assert.equal(result.history,undefined);
  context.exportRows[1].text='Complete';context.exportRevision++;context.exportBytes=15;
  result=context.desktopAgentAction('chat-read',JSON.stringify({chat:'mock|chat-a',revision}),'id','mock|chat-a');assert.equal(result.history[1].text,'Complete');
  assert.equal(context.desktopAgentAction('chat-read','{}','id','mock|other').ok,false);
  assert.equal(context.desktopAgentAction('chat-read','{','id','mock|chat-a').ok,false);
  context.exportRows=Array.from({length:400},(_,i)=>({id:String(i),role:'assistant',text:'hello'}));
  result=context.desktopAgentAction('chat-read','{}','id','mock|chat-a');assert.equal(result.history.length,300);assert.equal(result.omitted,100);assert.equal(result.history[0].id,'100');
  context.exportRows=Array.from({length:3},(_,i)=>({id:String(i),role:'assistant',text:'x'.repeat(80000)}));
  result=context.desktopAgentAction('chat-read','{}','id','mock|chat-a');assert.equal(result.history.length,2);assert.equal(result.omitted,1);
  const ui={crypto:require('node:crypto').webcrypto};vm.createContext(ui);vm.runInContext(fs.readFileSync(path.join(__dirname,'desktop/chat.js'),'utf8'),ui);
  const requests=[];const transport=ui.synerixcodeDesktopChat.createTransport(async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true};});
  const c={chat:'mock|chat-a',browser_id:'browser-a',tab_id:42};
  await transport.send(c,'Hello','stable-request');await transport.send(c,'Hello','stable-request');await transport.read(c,'revision-1');await transport.pin(c,true);
  assert.equal(requests[0].body.request_id,requests[1].body.request_id);assert.equal(requests[0].body.chat,c.chat);assert.equal(requests[0].body.tab_id,42);assert.equal(requests[2].body.action,'chat-read');assert.equal(requests[3].body.action,'chat-pin');
  await assert.rejects(ui.synerixcodeDesktopChat.createTransport(async()=>({ok:false,error:'Rejected'})).send(c,'x','i'),/Rejected/);
  // Exercise actual background dispatch and pinning, with browser APIs stubbed.
  let sent=[],posts=[],stored={};
  const bg={Number,Date,Error,JSON,desktopPinReady:Promise.resolve(),desktopPinnedTab:null,browserIdentity:'browser-a',desktopAgentError:null,
    chrome:{tabs:{sendMessage:async(id,msg)=>{sent.push({id,msg});return msg.type==='rs-desktop-agent-state'?{chat:'mock|chat-a'}:{ok:true};}},storage:{session:{set:async v=>Object.assign(stored,v),remove:async key=>delete stored[key]}}},
    bridgeFetch:async(url,options)=>{posts.push(JSON.parse(options.body));},reportDesktopAgentState:async()=>{}};
  vm.createContext(bg);vm.runInContext(functionText(background,'async function dispatchDesktopAgentAction(', 'setInterval(() => { reportDesktopAgentState();'),bg);
  await bg.dispatchDesktopAgentAction({action:'chat-pin',tab_id:42,browser_id:'browser-a',expected_chat:'mock|chat-a',prompt:'on',request_id:'p'});
  assert.equal(bg.desktopPinnedTab,42);assert.equal(stored.synerixcodeDesktopPinnedTab,42);assert.equal(posts.at(-1).result.ok,true);
  await bg.dispatchDesktopAgentAction({action:'task-send',tab_id:42,browser_id:'browser-a',expected_chat:'mock|wrong',prompt:'no',request_id:'bad'});
  assert.equal(posts.at(-1).result.ok,false);assert(!sent.some(x=>x.msg.action==='task-send'));
  await bg.dispatchDesktopAgentAction({action:'chat-read',tab_id:42,browser_id:'browser-a',expected_chat:'mock|chat-a',prompt:'{}',request_id:'read'});
  assert.equal(sent.at(-1).msg.expected_chat,'mock|chat-a');
  await bg.dispatchDesktopAgentAction({action:'chat-pin',tab_id:42,browser_id:'browser-a',expected_chat:'mock|chat-a',prompt:'off',request_id:'unpin'});assert.equal(bg.desktopPinnedTab,null);
  // Both source trees are distributed; neither may silently lag behind.
  for(const file of ['core/main.js','background.js'])assert.equal(fs.readFileSync(path.join(__dirname,file),'utf8'),fs.readFileSync(path.join(__dirname,'synerixcode-Extension',file),'utf8'));
  const rust=fs.readFileSync(path.join(__dirname,'agent/src/main.rs'),'utf8');assert(rust.includes('"chat-read" => "canChatRead", "chat-pin" => "canChatPin"'));assert(rust.includes('"expected_chat":req.get("chat")'));
  console.log('PASS desktop chat: snapshots, streaming revisions, bounds, target guards, request IDs, pin/unpin, source parity');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
