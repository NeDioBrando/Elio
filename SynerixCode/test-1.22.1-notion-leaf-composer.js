// SPDX-License-Identifier: GPL-3.0-or-later
// 1.22.1: Notion's AI composer can be a DIV.content-editable-leaf-rtl whose
// placeholder lives on a nearby overlay node, next to Notion's own send button.
// The page-block penalty used to win ("phEditable":true,"editor":false), so the
// accepted-message fallback in sendLanded() could not see the composer and the
// turn ended as "Message was not confirmed". Attribute evidence only: reply
// text, generic words and transcript blocks still never become the composer.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(process.argv[2]||'providers/notion.js','utf8');
const load=(html)=>{const d=new JSDOM(html,{url:'https://app.notion.com/chat?t=abc',runScripts:'outside-only',pretendToBeVisual:true});
  d.window.HTMLElement.prototype.getBoundingClientRect=function(){return{left:100,top:300,width:600,height:50,right:700,bottom:350};};
  vm.runInContext(source+';this.p=RSProvider;',d.getInternalVMContext());return d;};
const pick=(html)=>{const d=load(html);try{const e=d.window.p.getEditor();return e&&e.id;}finally{d.window.close();}};
// Toolbar text that pushes any placeholder text out of the first 220 characters.
const chrome='<div class="tools">'+'Review for me · Auto · Research · Attach · Web search · '.repeat(6)+'</div>';
// (a) Notion send-button test id next to the leaf editor, no placeholder anywhere.
assert.equal(pick(`<main><div class="composer"><div><div><div id="comp" class="content-editable-leaf-rtl notranslate" contenteditable="true"></div></div>${chrome}<div role="button" data-testid="agent-chat-send-button"></div></div></div></main>`),'comp','send-button test id lifts the page-block penalty');
// (b) Placeholder attribute on a sibling overlay (not on the editor), far from any matching text.
assert.equal(pick(`<main><div class="composer">${chrome}<div><div aria-label="Ask Notion AI" class="ph"></div><div id="comp" class="content-editable-leaf-rtl notranslate" contenteditable="true"></div></div></div></main>`),'comp','nearby placeholder attribute counts as composer evidence');
// Guards from 1.21.1 still hold.
assert.equal(pick('<main><div data-testid="agent-chat-transcript"><div id="hist" class="content-editable-leaf-rtl" contenteditable="true">Answer text</div></div></main>'),null,'transcript blocks stay excluded');
assert.equal(pick('<main><div id="hist" class="content-editable-leaf-rtl" contenteditable="true">How can I help you next?</div></main>'),null,'reply text is not a placeholder');
assert.equal(pick('<main><input id="search" placeholder="Search chats"><div id="hist" class="content-editable-leaf-rtl" contenteditable="true">Old answer: ask me anything</div></main>'),null,'search box / reply words stay excluded');
// A historical leaf block next to a real composer: the composer still wins.
assert.equal(pick(`<main><div data-testid="agent-chat-transcript"><div><div><div><div><div id="hist" class="content-editable-leaf-rtl" contenteditable="true">Here is the answer about your tasks</div></div></div></div></div></div><div class="composer"><div><div id="comp" class="content-editable-leaf-rtl" contenteditable="true"></div></div><div role="button" data-testid="agent-chat-send-button"></div></div></main>`),'comp','composer beats historical blocks');
// Ordinary pages remain excluded even with the send-button test id.
{const d=new JSDOM('<main><div id="comp" class="content-editable-leaf-rtl" contenteditable="true"></div><div data-testid="agent-chat-send-button"></div></main>',{url:'https://app.notion.com/p/ordinary-page',runScripts:'outside-only'});
 try{vm.runInContext(source+';this.p=RSProvider;',d.getInternalVMContext());assert.equal(d.window.p.getEditor(),null,'ordinary pages stay excluded');}finally{d.window.close();}}
console.log('PASS: leaf-div Notion composer found via send-button test id or nearby placeholder attribute; reply/transcript guards intact.');
