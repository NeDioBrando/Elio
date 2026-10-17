// Full-adapter fault injection, not just source-pattern assertions.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {prelude}=require('./test-support/provider-dom.cjs');
const fixtures={
 chatgpt:['https://chatgpt.com/c/test','<div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>'],
 deepseek:['https://chat.deepseek.com/a/chat/test','<textarea></textarea>'],
 claude:['https://claude.ai/chat/test','<div class="ProseMirror" contenteditable="true"></div>'],
 gemini:['https://gemini.google.com/app/test','<div class="ql-editor" contenteditable="true"></div>'],
 kimi:['https://www.kimi.com/chat/test','<div class="chat-input-editor" contenteditable="true"></div>'],
 glm:['https://chat.z.ai/c/test','<textarea id="chat-input"></textarea>'],
 arena:['https://arena.ai/?mode=direct','<textarea placeholder="Ask anything"></textarea>'],
 freebuff:['https://freebuff.ai/chat/test','<textarea placeholder="Ask anything"></textarea>'],
 qwen:['https://chat.qwen.ai/c/test','<textarea class="message-input-textarea"></textarea>'],
 crax:['https://gpt.crax.lol/','<textarea id="promptInput"></textarea>'],
 useai:['https://use.ai/chat/test','<textarea placeholder="Ask anything"></textarea>'],
 oxalpha:['https://oxalpha.com/chat/test','<textarea placeholder="Ask anything"></textarea>'],
 notion:['https://app.notion.com/chat/test','<textarea placeholder="Ask Notion AI"></textarea>'],
 copilot:['https://copilot.microsoft.com/chats/test','<textarea id="userInput" placeholder="Message Copilot"></textarea>'],
 meta:['https://www.meta.ai/','<textarea data-testid="composer-input"></textarea>'],
};
let checks=0;
function check(name,fn){fn();checks++;}
function load(name,html=''){
 const source=fs.readFileSync('providers/'+name+'.js','utf8');
 const d=new JSDOM(html,{url:fixtures[name][0],runScripts:'outside-only',pretendToBeVisual:true});
 const w=d.window;
 w.HTMLElement.prototype.getBoundingClientRect=function(){return{x:100,y:400,left:100,top:400,right:700,bottom:450,width:600,height:50};};
 Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return this.parentElement;},configurable:true});
 // jsdom has no layout or innerText; fixtures model them explicitly.
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;},configurable:true});
 const end=source.indexOf('\n  }',source.indexOf('  function waitBudget('))+4;
 const expose='\n globalThis.testdom={safeRead,safeQuery,safeQueryAll,safeClosest,safeRect,safeStyle,safePredicate,waitBudget,get waitFor(){return waitFor;},get selfWrite(){return typeof _selfWrite===\"undefined\"?false:_selfWrite;},get setRichText(){return typeof setRichText===\"undefined\"?null:setRichText;},get chatList(){return typeof chatList===\"undefined\"?null:chatList;}};\n';
 vm.runInContext(source.slice(0,end)+expose+source.slice(end)+';globalThis.p=RSProvider;',d.getInternalVMContext());
 return d;
}
function probe(p){for(const name of ['getEditor','editorText','allItems','assistantCount','userCount','lastAssistant','lastAssistantId','readAssistant','streamLen','snapshot','isGenerating','isBusyNow','isHardGenerating','genDebug','composerFrame','barAnchor','scanError','scanBusy','chatIsEmpty'])if(typeof p[name]==='function')assert.doesNotThrow(()=>p[name](),name);}
(async()=>{
 for(const name of Object.keys(fixtures)){
  const d=load(name,'<main><form><section role="region">'+fixtures[name][1]+'<button aria-label="Send message" type="submit">Send</button></section></form></main>'),w=d.window,h=w.testdom,p=w.p;
  try{
   const editor=w.document.querySelector('textarea,[contenteditable]');
   check(name+' healthy composer',()=>assert.equal(p.getEditor(),editor));
   check(name+' healthy query identity',()=>assert.equal(h.safeQuery(w.document,'textarea,[contenteditable]'),editor));
   check(name+' invalid selector',()=>{assert.equal(h.safeQuery(w.document,'['),null);assert.equal(h.safeQueryAll(w.document,'[').length,0);assert.equal(h.safeClosest(editor,'['),null);});
   check(name+' missing root',()=>{assert.equal(h.safeQuery(null,'div'),null);assert.equal(h.safeQueryAll(null,'div').length,0);});
   check(name+' shadow root',()=>{const host=w.document.createElement('div');const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<button>Shadow</button>';assert.equal(h.safeQueryAll(shadow,'button').length,1);assert.equal(h.safeQueryAll(shadow,'[').length,0);});
   check(name+' snapshot query list',()=>{const list=h.safeQueryAll(w.document,'textarea,[contenteditable]');editor.remove();assert.equal(list[0],editor);w.document.querySelector('section').append(editor);});
   check(name+' healthy layout',()=>assert.equal(h.safeRect(editor).width,600));
   check(name+' throwing layout',()=>{const old=editor.getBoundingClientRect;editor.getBoundingClientRect=()=>{throw Error('remount');};assert.equal(h.safeRect(editor).width,0);probe(p);editor.getBoundingClientRect=old;});
   check(name+' throwing styles',()=>{const old=w.getComputedStyle;w.getComputedStyle=()=>{throw Error('remount');};assert.equal(h.safeStyle(editor).display,'none');probe(p);w.getComputedStyle=old;});
   check(name+' throwing parent/text/attribute getters',()=>{const stale=new Proxy(editor,{get(t,key){if(['textContent','innerText','parentElement','getAttribute','closest','matches','querySelector','querySelectorAll'].includes(key))throw Error('stale');return Reflect.get(t,key);}});assert.equal(h.safeQueryAll(stale,'div').length,0);assert.equal(h.safeClosest(stale,'form'),null);assert.equal(h.safeRead(()=>stale.textContent,''),'');for(const key of ['itemText','itemKey','isUserItem','isAssistantItem'])if(typeof p[key]==='function')assert.doesNotThrow(()=>p[key](stale),key);});
   check(name+' failed read cannot confirm a send',()=>assert.equal(h.safePredicate(()=>h.safeRead(()=>{throw Error('read');},'')===''),false));
   check(name+' healthy predicate retains value',()=>assert.equal(h.safePredicate(()=>editor),editor));
   check(name+' healthy public reads',()=>probe(p));
  }finally{w.close();}
  const empty=load(name);try{check(name+' empty document',()=>probe(empty.window.p));const w=empty.window;w.Document.prototype.querySelector=w.Document.prototype.querySelectorAll=()=>{throw Error('query failure');};check(name+' failed document queries',()=>{probe(w.p);assert.equal(w.p.getEditor(),null);assert.equal(w.p.assistantCount(),0);});}finally{empty.window.close();}
  // Run actual waitFor on a virtual clock, including its final predicate call.
  const source=fs.readFileSync('providers/'+name+'.js','utf8');
  const start=source.indexOf(name==='claude'?'  const waitFor =':'  async function waitFor('),end=source.indexOf('\n  }',start)+4;
  const waitsource=source.slice(start,end)+(name==='claude'?';':'');
  const makeClock=(rollback=false)=>{let now=0,sleeps=0;const context={Date:{now:()=>now},sleep:async(ms)=>{sleeps++;now+=rollback?-ms:ms;},getComputedStyle:()=>({})};vm.createContext(context);vm.runInContext(prelude(source)+waitsource+';this.wait=waitFor;',context);return {context,get sleeps(){return sleeps;}};};
  {const clock=makeClock();let attempts=0;const result=await clock.context.wait(()=>{if(++attempts<3)throw Error('transient');return 'ready';},500);check(name+' transient wait errors recover',()=>assert(result));}
  {const clock=makeClock();const result=await clock.context.wait(()=>{throw Error('persistent');},300);check(name+' persistent wait errors time out',()=>{assert.equal(result,false);assert(clock.sleeps<=4);});}
  {const clock=makeClock(true);const result=await clock.context.wait(()=>false,300);check(name+' clock rollback stays bounded',()=>{assert.equal(result,false);assert(clock.sleeps<=4);});}
  {const clock=makeClock();const result=await clock.context.wait(()=>{throw Error('deadline');},0);check(name+' final predicate cannot throw',()=>assert.equal(result,false));}
  {const clock=makeClock();const result=await clock.context.wait(()=>true,Infinity);check(name+' invalid budget exits',()=>assert(result));}
  console.log('PASS '+name+' resilience');
 }
 // Semantic ancestry survives wrapper insertion without targeting Notion pages.
 {const d=load('notion','<main id="boundary"><div><div><div><div><div><div><textarea placeholder="Ask Notion AI"></textarea></div></div></div></div></div></div></main>');try{check('Notion semantic chat boundary',()=>assert.equal(d.window.testdom.chatList().id,'boundary'));}finally{d.window.close();}}
 // A submit button beyond twelve inserted wrappers remains inside the semantic composer.
 {const d=load('notion','<form id="composer">'+'<div>'.repeat(12)+'<textarea placeholder="Ask Notion AI"></textarea>'+'</div>'.repeat(12)+'<button data-testid="agent-chat-send-button" aria-label="Send">Send</button></form>');try{check('Notion deeply wrapped semantic composer',()=>assert.equal(d.window.p.composerFrame().id,'composer'));const b=d.window.document.querySelector('button');Object.defineProperty(b,'title',{get(){throw Error('stale tooltip');}});check('Notion failed tooltip read',()=>probe(d.window.p));}finally{d.window.close();}}
 // Faults in the native setter and rich-text selection must always release control.
 {const d=load('notion','<textarea placeholder="Ask Notion AI" readonly></textarea>');const w=d.window,e=w.document.querySelector('textarea');try{const old=Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value');Object.defineProperty(w.HTMLTextAreaElement.prototype,'value',{...old,set(){throw Error('setter failed');}});check('Notion failed write releases selfWrite',()=>{assert.throws(()=>w.testdom.setRichText(e,'text'));assert.equal(w.testdom.selfWrite,false);assert.equal(e.readOnly,true);});Object.defineProperty(w.HTMLTextAreaElement.prototype,'value',old);}finally{w.close();}}
 {const d=load('notion','<div contenteditable="true" role="textbox" aria-label="Ask Notion AI"></div>'),w=d.window;try{w.getSelection=()=>{throw Error('selection failed');};check('Notion selection error releases selfWrite',()=>{assert.equal(w.testdom.setRichText(w.document.querySelector('[contenteditable]'),'text'),'rejected');assert.equal(w.testdom.selfWrite,false);});}finally{w.close();}}
 console.log('PASS '+checks+' provider DOM resilience checks (13 active adapters + 2 retained legacy adapters).');
})().catch(e=>{console.error(e);process.exitCode=1;});
