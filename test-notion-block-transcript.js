const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('providers/notion.js','utf8');
const dom=new JSDOM(`<div id="rs-root"></div><main>
<div style="display:flex;justify-content:flex-end"><div>Fix my movement controller</div></div>
<div data-content-editable-root="true"><pre data-block-id="command">{"command":"script_read"}</pre></div>
<div id="plain-result" style="display:flex;justify-content:flex-end"><div>Output of 'script_read':\n1 → local Players = game:GetService("Players")</div></div>
<div style="display:flex;justify-content:flex-end"><div data-content-editable-root="true" id="block-result"><div data-block-id="result-head">Output of 'script_read':</div><pre data-block-id="result-code">2 → return Players</pre></div></div>
<div data-content-editable-root="true" id="prose"><div data-block-id="answer">Your movement controller is fixed.</div></div>
<section id="composer"><textarea placeholder="Ask Notion AI"></textarea><button data-testid="agent-chat-send-button" aria-label="Send message">Send</button><div style="justify-content:flex-end">Composer toolbar</div></section>
</main>`,{url:'https://app.notion.com/chat?t=one',runScripts:'outside-only',pretendToBeVisual:true});
try {
 const w=dom.window,d=w.document;
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:100,top:600,width:600,height:60,right:700,bottom:660};};
 vm.runInContext(source+';globalThis.provider=RSProvider;',dom.getInternalVMContext());const p=w.provider;
 const items=p.allItems();assert.equal(items.length,5);assert.deepEqual(Array.from(items,p.isUserItem),[true,false,true,true,false]);
 assert.equal(p.userCount(),3);assert.equal(p.assistantCount(),2);assert.equal(p.lastAssistant(),d.querySelector('#prose'));
 for(const id of ['plain-result','block-result']){
  const item=d.getElementById(id),before=item.innerHTML;
  assert(p.canRenderImmutableChip(item,{whole:true}));
  p.renderImmutableChip(item,{whole:true,label:'script_read · result',phase:'result',body:p.itemText(item)});
  assert.equal(item.innerHTML,before,'No locked children modified');
  const key=item.getAttribute('data-synerixcode-notion-card');assert(key);
  const rules=Array.from(d.querySelector('#zs-notion-immutable-cards').sheet.cssRules);
  assert(rules.some(r=>r.selectorText===`[data-synerixcode-notion-card="${key}"]>*`&&r.style.display==='none'));
  assert(p.immutableChipPresent(item));assert(p.itemText(item).startsWith("Output of 'script_read':"));
  p.syncImmutableChips();assert(p.immutableChipPresent(item),'Whole-bubble mask survives cleanup');
 }
 const original=d.querySelector('#plain-result'),fresh=original.cloneNode(true);fresh.removeAttribute('data-synerixcode-notion-card');original.replaceWith(fresh);p.invalidateItems();
 assert.equal(p.userCount(),3);assert(p.isUserItem(fresh));p.renderImmutableChip(fresh,{whole:true,label:'script_read · result',phase:'result'});assert(p.immutableChipPresent(fresh));
 p.clearImmutableChip(fresh,{force:true});assert.equal(fresh.getAttribute('data-synerixcode-notion-card'),null,'Recycled user message immediately loses its old visual mask');
 const recycled=d.querySelector('#block-result');d.querySelector('main').append(recycled);p.invalidateItems();assert(p.isAssistantItem(recycled),'Role cache follows a moved/recycled block root');
 const history=d.createDocumentFragment();for(let i=0;i<1000;i++){const row=d.createElement('div');row.style.justifyContent='flex-end';const inner=d.createElement('div');inner.style.justifyContent='flex-end';inner.textContent='Earlier request '+i;row.append(inner);history.append(row);}d.querySelector('main').append(history);p.invalidateItems();
 let queries=0,contains=0;const query=d.querySelectorAll.bind(d),originalContains=w.Node.prototype.contains;d.querySelectorAll=(...args)=>{queries++;return query(...args);};w.Node.prototype.contains=function(node){contains++;return originalContains.call(this,node);};
 const longItems=p.allItems();assert.equal(p.userCount(),1002);assert(contains<12000,'Plain-bubble collection must avoid comparing every historical message with every other message');const beforeQueries=queries;for(let i=0;i<200;i++)assert.equal(p.allItems(),longItems);assert.equal(queries,beforeQueries,'Unchanged long transcript stays cached');
 w.history.replaceState({},'','/p/document');p.invalidateItems();assert.equal(p.allItems().length,0,'Document pages never enter the chat transcript');
 console.log('Notion newer block/plain user bubbles: goals and receipts visible to parser, result cards mask every block without locked-child writes, remounts/reloads keep evidence, composer/document excluded.');
}finally{dom.window.close();}
