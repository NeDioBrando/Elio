// Differential regression: run the same DOM and send events with v1.22.1 and this build.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const matrix={
 chatgpt:['https://chatgpt.com/c/test','<div id="prompt-textarea" contenteditable="true"></div>','<div data-message-author-role="user">hello</div><div data-message-author-role="assistant"><div class="markdown">COMMAND</div></div>','<button data-testid="send-button" aria-label="Send prompt">Send</button>'],
 deepseek:['https://chat.deepseek.com/a/chat/test','<textarea></textarea>','<div class="ds-message"><div class="fbb737a4">hello</div></div><div class="ds-message"><div class="ds-markdown">COMMAND</div></div>','<button class="ds-button ds-button--primary" aria-label="Send"><svg><path d="M8 1"></path></svg></button>'],
 claude:['https://claude.ai/chat/test','<div class="ProseMirror" contenteditable="true"></div>','<div data-testid="user-message">hello</div><div class="font-claude-response"><div class="standard-markdown">COMMAND</div></div>','<button aria-label="Send message">Send</button>'],
 gemini:['https://gemini.google.com/app/test','<div class="ql-editor" contenteditable="true"></div>','<user-query>hello</user-query><model-response><message-content>COMMAND</message-content></model-response>','<button class="send-button" aria-label="Send message">Send</button>'],
 kimi:['https://www.kimi.com/chat/test','<div class="chat-input-editor" contenteditable="true"></div>','<div class="segment-user">hello</div><div class="segment-assistant"><div class="markdown">COMMAND</div></div>','<button class="send-button-container">Send</button>'],
 glm:['https://chat.z.ai/c/test','<textarea id="chat-input"></textarea>','<div class="user-message">hello</div><div class="chat-assistant markdown-prose">COMMAND</div>','<button id="send-message-button">Send</button>'],
 arena:['https://arena.ai/?mode=direct','<textarea></textarea>','<ol class="flex-col-reverse"><li class="mx-auto"><div class="justify-end">hello</div></li><li class="mx-auto"><div class="prose">COMMAND</div></li></ol>','<button type="submit" aria-label="Send message">Send</button>'],
 freebuff:['https://freebuff.ai/chat/test','<textarea></textarea>','<article data-message-role="user">hello</article><article data-message-role="assistant">COMMAND</article>','<button type="submit" aria-label="Send message">Send</button>'],
 qwen:['https://chat.qwen.ai/c/test','<textarea class="message-input-textarea"></textarea>','<div class="qwen-chat-message-user">hello</div><div class="qwen-chat-message-assistant"><div class="markdown">COMMAND</div></div>','<button class="send-button">Send</button>'],
 crax:['https://gpt.crax.lol/','<textarea id="promptInput"></textarea>','<div class="thread"><div class="msg msg-user"><div class="bubble">hello</div></div><div class="msg msg-assistant"><div class="bubble">COMMAND</div></div></div>','<button id="sendBtn">Send</button>'],
 useai:['https://use.ai/chat/test','<textarea></textarea>','<article data-message-role="user">hello</article><article data-message-role="assistant">COMMAND</article>','<button type="submit" aria-label="Send message">Send</button>'],
 oxalpha:['https://oxalpha.com/chat/test','<textarea></textarea>','<article data-message-role="user">hello</article><article data-message-role="assistant">COMMAND</article>','<button type="submit" aria-label="Send message">Send</button>'],
 notion:['https://app.notion.com/chat/test','<textarea placeholder="Ask Notion AI"></textarea>','<div data-agent-service-scroll-anchor="user" style="display:flex;justify-content:flex-end">hello</div><div data-agent-service-scroll-anchor="assistant" style="display:flex;justify-content:flex-start"><div>COMMAND</div></div>','<button data-testid="agent-chat-send-button" aria-label="Send message">Send</button>'],
};
const command='{"command":"list_commands","params":{}}';
function setup(name,baseline){
 const [url,editor,turns,button]=matrix[name];
 const d=new JSDOM('<main>'+turns.replace('COMMAND',command)+'<form><section role="region" style="border-radius:20px">'+editor+button+'</section></form></main>',{url,runScripts:'outside-only',pretendToBeVisual:true});const w=d.window;
 Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return this.parentElement;}});
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 w.HTMLElement.prototype.getBoundingClientRect=function(){return{left:100,top:400,right:700,bottom:450,width:600,height:50};};
 let now=1000000;w.Date.now=()=>now;w.setTimeout=(fn,ms=0)=>{now+=ms;queueMicrotask(fn);return 1;};
 const input=w.document.querySelector('textarea,[contenteditable]');let clicks=0,enters=0,inputs=0;
 const setText=text=>{if(input.tagName==='TEXTAREA')input.value=text;else input.textContent=text;};
 w.document.execCommand=(action,_,value)=>{if(action==='insertText'){setText(value);input.dispatchEvent(new w.Event('input',{bubbles:true}));return true;}return action==='selectAll';};
 input.addEventListener('input',()=>inputs++);
 const send=()=>{setText('');};
 w.document.querySelector('form').addEventListener('submit',e=>e.preventDefault());
 w.document.querySelector('button').addEventListener('click',()=>{clicks++;send();});
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){enters++;send();}});
 const source=fs.readFileSync((baseline?'test-support/provider-baseline/':'providers/')+name+'.js','utf8');
 vm.runInContext(source+';this.p=RSProvider;',d.getInternalVMContext());
 return {d,w,p:w.p,input,setText,advance:ms=>{now+=ms;},counts:()=>({clicks,enters,inputs})};
}
function inspect(f){const p=f.p,r=p.readAssistant();return {editor:!!p.getEditor(),reply:r.reply,present:r.present,users:p.userCount(),assistants:p.assistantCount(),generating:p.isGenerating(),chat:p.conversationKey(),itemText:p.lastAssistant()?p.itemText(p.lastAssistant()):''};}
(async()=>{
 let checks=0;
 for(const name of Object.keys(matrix)){
  const old=setup(name,true),current=setup(name,false);
  try{
   const before=inspect(old);assert(before.editor,name+' baseline editor');assert(before.reply.includes(command),name+' baseline reply fixture must be meaningful');
   assert.deepEqual(inspect(current),before,name+' healthy message detection unchanged');checks++;
   for(const f of [old,current]){
    f.advance(60000);f.setText('user draft');assert.equal(f.p.editorText(),'user draft',name+' native draft read');f.p.setInputLock(true);f.p.setInputLock(false);assert.equal(f.p.editorText(),'user draft',name+' locking preserves draft');
    // Native send counts must be identical, and no duplicate submission is allowed.
    await f.p.typeAndSend('elio regression prompt');assert.equal(f.p.editorText().trim(),'',name+' draft consumed');assert.equal(f.counts().clicks+f.counts().enters,1,name+' one submission');
   }
   assert.deepEqual(current.counts(),old.counts(),name+' native event behavior unchanged');checks+=3;
   // Virtualized editor replacement after a successful send.
   for(const f of [old,current]){f.input.replaceWith(f.input.cloneNode(true));assert.equal(f.p.getEditor(),f.w.document.querySelector('textarea,[contenteditable]'),name+' detects replacement');}
   checks++;console.log('PASS '+name+' healthy transcript, draft, lock/unlock, send and remount');
  }finally{old.w.close();current.w.close();}
 }
 console.log('PASS '+checks+' healthy differential checks against v1.22.1.');
})().catch(e=>{console.error(e);process.exitCode=1;});
