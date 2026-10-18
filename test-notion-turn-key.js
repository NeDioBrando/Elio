const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {JSDOM}=require(process.env.ELIO_TEST_JSDOM||'jsdom');
const dom=new JSDOM('<main><div data-agent-service-scroll-anchor="assistant-1"><div data-content-editable-root="true"><pre data-block-id="old">{"command":"list_commands"}</pre></div></div></main>',{url:'https://app.notion.com/chat?t=one',runScripts:'outside-only'});
try {
 vm.runInContext(fs.readFileSync('providers/notion.js','utf8')+';this.provider=RSProvider;',dom.getInternalVMContext());
 const d=dom.window.document,p=dom.window.provider,row=d.querySelector('[data-agent-service-scroll-anchor]'),old=row.firstElementChild;
 assert.equal(p.itemKey(old),'assistant-1');
 const fresh=old.cloneNode(true);fresh.querySelector('pre').setAttribute('data-block-id','new');old.replaceWith(fresh);
 assert.equal(p.itemKey(fresh),'assistant-1');assert.equal(p.itemKey(row),'assistant-1');
 const other=row.cloneNode(true);other.setAttribute('data-agent-service-scroll-anchor','assistant-2');row.after(other);
 assert.equal(p.itemKey(other.firstElementChild),'assistant-2');
 const unanchored=d.createElement('article');assert.equal(p.itemKey(unanchored),null);
 assert.equal(d.querySelector('pre').textContent,'{"command":"list_commands"}');
 console.log('Notion turn keys survive response/code-block replacements inside the semantic row, distinguish new rows, and leave unanchored layouts on the existing fallback.');
} finally {dom.window.close();}
