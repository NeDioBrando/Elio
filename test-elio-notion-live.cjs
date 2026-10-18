// SPDX-License-Identifier: GPL-3.0-or-later
// Optional DOM integration: NODE_PATH=<jsdom location> node test-elio-notion-live.cjs
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM(`<main><div style="display:flex;justify-content:flex-end"><div>Build a courtyard</div></div><div data-content-editable-root="true" id="answer"><div data-block-id="a">Initial answer</div></div><section id="composer"><textarea placeholder="Ask Notion AI"></textarea><button data-testid="agent-chat-send-button" aria-label="Send message">Send</button></section></main>`,{url:'https://app.notion.com/chat?t=live',runScripts:'outside-only',pretendToBeVisual:true});
(async()=>{try{
 const w=dom.window,d=w.document;w.HTMLElement.prototype.getBoundingClientRect=()=>({left:100,top:600,width:600,height:60,right:700,bottom:660});
 vm.runInContext(fs.readFileSync(__dirname+'/providers/notion.js','utf8')+';globalThis.P=RSProvider;',dom.getInternalVMContext());
 w.RS={SYS_MARKER:'⟦RS-SYS⟧'};w.RSParse={isInjectedFeedback:()=>false};let i=0;const ids=new WeakMap();w.activityMessageKey=n=>{if(!ids.has(n))ids.set(n,++i);return ids.get(n);};
 const main=fs.readFileSync(__dirname+'/core/main.js','utf8');const from=main.indexOf('let exportChatKey = null'),end=main.indexOf('    rsInterval(()=>{if(!exportDirty',from);
 vm.runInContext(main.slice(from,end)+';globalThis.snapshot=()=>{captureExportHistory(true);return exportRows.map(r=>({...r}));};',dom.getInternalVMContext());
 assert.equal(w.snapshot().length,2);const cached=w.P.allItems();
 const node=d.createElement('div');node.dataset.contentEditableRoot='true';node.innerHTML='<div data-block-id="b">New answer without reload</div>';d.querySelector('#composer').before(node);
 assert.equal(w.P.allItems(),cached,'Reproduce the unchanged provider row cache');assert.equal(cached.length,2);
 // No MutationObserver or page reload. Explicit desktop snapshot must break that cache.
 let rows=w.snapshot();assert.equal(rows.length,3);assert.equal(rows.at(-1).text,'New answer without reload');
 node.firstChild.textContent+='; streamed token';await Promise.resolve();rows=w.snapshot();assert.equal(rows.length,3);assert.match(rows.at(-1).text,/streamed token/);
 Object.defineProperty(d,'hidden',{value:true,configurable:true});node.firstChild.textContent+=' while browser hidden';await Promise.resolve();rows=w.snapshot();assert.match(rows.at(-1).text,/while browser hidden/);
 console.log('PASS Notion DOM + production desktop export: cached connected rows refreshed, streamed text updated, hidden browser read, no observer or reload.');
}finally{dom.window.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
