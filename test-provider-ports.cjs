const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('./release-tools/node_modules/jsdom');
async function queueFixture(){
 const source=fs.readFileSync('providers/deepseek.js','utf8');
 const queue=source.slice(source.indexOf('  let sendTail ='),source.indexOf('  async function typeAndSendNow'));
 let now=100000,chat='A',draft='',events=[];
 const c={Promise,Date:{now:()=>now},Math:{random:()=>0,floor:Math.floor,min:Math.min},conversationKey:()=>chat,editorText:()=>draft,truncateForSend:x=>x,sleep:async ms=>{now+=ms;},typeAndSendNow:async(t,i,fresh)=>{fresh();events.push(['start',t,now]);now+=5000;await Promise.resolve();events.push(['end',t,now]);}};
 vm.createContext(c);vm.runInContext(queue+';this.send=typeAndSend;this.cancel=()=>sendEpoch++;',c);
 await Promise.all([c.send('one'),c.send('two')]);
 assert.equal(events.length,4);assert(events[2][2]-events[1][2]>=8000,'spacing measured after send completion');
 const stopped=c.send('stop');c.cancel();await assert.rejects(stopped,/cancelled/);assert.equal(events.length,4);
 const switched=c.send('switch');chat='B';await assert.rejects(switched,/chat changed/);assert.equal(events.length,4);
 draft='human draft';await assert.rejects(c.send('do not overwrite'),/different draft/);assert.equal(events.length,4);
 draft='';await c.send('next');assert.equal(events.length,6,'rejection does not poison send queue');
}
function codexFixture(){
 const dom=new JSDOM('<main><article data-message-author-role="assistant"><textarea placeholder="Ask Codex">history</textarea></article><textarea id="search" placeholder="Search tasks"></textarea><textarea id="composer" placeholder="Describe a task"></textarea></main>',{url:'https://chatgpt.com/codex',runScripts:'outside-only'});
 const w=dom.window;for(const e of w.document.querySelectorAll('textarea'))e.getBoundingClientRect=()=>({width:300,height:100});
 w.eval(fs.readFileSync('providers/chatgpt.js','utf8')+';window.provider=RSProvider');
 assert.equal(w.provider.getEditor().id,'composer');assert.equal(w.provider.getEditor().value,'');dom.window.close();
}
(async()=>{await queueFixture();codexFixture();console.log('PASS DeepSeek single send queue, completion spacing, Stop/chat-change/draft guards, queue recovery and Codex composer exclusion');})().catch(e=>{console.error(e);process.exitCode=1;});
