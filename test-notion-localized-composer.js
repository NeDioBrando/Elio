const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('providers/notion.js','utf8');
for(const placeholder of ['Frag Notion-KI','Frag die KI','KI etwas fragen','Wie kann ich dir helfen?','Was möchtest du tun?','Ask Notion AI','How can I help you today?','Demandez à Notion','Pregunta a Notion','Pergunte ao Notion']){
 const dom=new JSDOM('<main><section id="composer"><textarea></textarea><button aria-label="Senden">Send</button></section></main>',{url:'https://app.notion.com/ai',runScripts:'outside-only',pretendToBeVisual:true});
 try{
  const w=dom.window,ed=w.document.querySelector('textarea');ed.placeholder=placeholder;
  w.HTMLElement.prototype.getBoundingClientRect=function(){return{left:100,top:300,width:600,height:50,right:700,bottom:350};};
  vm.runInContext(source+';this.p=RSProvider;',dom.getInternalVMContext());
  assert.equal(w.p.getEditor(),ed,placeholder);assert(w.p.barAnchor(),'Localized AI composer anchors the bar');
 }finally{dom.window.close();}
}
const dom=new JSDOM('<main><textarea placeholder="Frag Notion-KI"></textarea></main>',{url:'https://app.notion.com/p/ordinary-page',runScripts:'outside-only'});
try{vm.runInContext(source+';this.p=RSProvider;',dom.getInternalVMContext());assert.equal(dom.window.p.getEditor(),null,'Ordinary pages remain excluded');}finally{dom.window.close();}
// Generic words (ask, message, chat) and loose send-control matches must never
// turn a historical reply block or a search box into the composer.
const pick=(html)=>{const d=new JSDOM(html,{url:'https://app.notion.com/ai',runScripts:'outside-only',pretendToBeVisual:true});
 try{d.window.HTMLElement.prototype.getBoundingClientRect=function(){return{left:100,top:300,width:600,height:50,right:700,bottom:350};};
  vm.runInContext(source+';this.p=RSProvider;',d.getInternalVMContext());const e=d.window.p.getEditor();return e&&e.id;}finally{d.window.close();}};
assert.equal(pick('<main><input id="search" placeholder="Search chats"><div id="hist" class="content-editable-leaf-rtl" contenteditable="true">Old answer: ask me anything about tasks</div></main>'),null,'search box / reply block are not the composer');
assert.equal(pick('<main><div data-testid="agent-chat-transcript"><div id="hist" class="content-editable-leaf-rtl" contenteditable="true">Answer text</div></div></main>'),null,'transcript container test ids do not mark a reply as the composer');
assert.equal(pick('<main><div id="hist" class="content-editable-leaf-rtl" contenteditable="true">How can I help you next?</div></main>'),null,'reply text "How can I help" is not a placeholder');
assert.equal(pick('<main><div id="hist" class="content-editable-leaf-rtl" contenteditable="true">How can I help you next?</div><section><textarea id="comp" placeholder="Ask Notion AI"></textarea></section></main>'),'comp');
console.log('Localized Notion AI composers are detected and anchored; ordinary page editors remain excluded.');
