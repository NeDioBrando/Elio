const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.SYNERIXCODE_TEST_JSDOM||'jsdom');
const dom=new JSDOM('<main></main>',{url:'https://claude.ai/chat/test',runScripts:'outside-only'});
try {
 vm.runInContext(fs.readFileSync('providers/claude.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());
 const d=dom.window.document,p=dom.window.provider,command='{"command":"list_commands","params":{}}';
 const item=d.createElement('article');d.body.append(item);
 item.innerHTML='<p id="narration">Inspecting the project.</p><div id="frame"><div><span>json</span><button aria-label="Copy code">Copy</button></div><div><pre><code>'+command+'</code></pre></div></div><p id="after">Next step.</p><div id="actions"><button aria-label="Retry">Retry</button></div>';
 const spot=p.findToolBlockSpot(item);
 assert.equal(spot.ref,d.querySelector('#frame'));assert(spot.ref.classList.contains('rs-tool-hide'));
 for(const id of ['narration','after','actions'])assert(!d.querySelector('#'+id).closest('.rs-tool-hide'));
 assert.equal(item.querySelector('pre').textContent,command,'Keep raw protocol readable to the parser');
 item.innerHTML='<div id="mixed"><span>Important explanation</span><pre>'+command+'</pre></div><div id="ordinary"><span>json</span><pre>{"value":123}</pre></div><div data-is-thinking="true"><pre>'+command+'</pre></div>';
 p.findToolBlockSpot(item);assert(!d.querySelector('#mixed').classList.contains('rs-tool-hide'));assert(d.querySelector('#mixed pre').classList.contains('rs-tool-hide'));
 assert(!d.querySelector('#ordinary').querySelector('.rs-tool-hide'));assert(!item.querySelector('[data-is-thinking]').querySelector('.rs-tool-hide'));
 item.innerHTML='<div id="multiple"><pre>'+command+'</pre><pre>const keep=1;</pre></div>';
 p.findToolBlockSpot(item);assert(!d.querySelector('#multiple').classList.contains('rs-tool-hide'));assert(!d.querySelector('#multiple pre:last-child').classList.contains('rs-tool-hide'));
 item.innerHTML='<p id="keep">Assessing the request.</p><div id="cm-frame"><div><p>json</p><button aria-label="Copy code">Copy</button></div><div><div class="cm-content" contenteditable="false">'+command+'</div></div></div>';
 const cm=p.findToolBlockSpot(item);assert.equal(cm.ref,d.querySelector('#cm-frame'));assert(!d.querySelector('#keep').closest('.rs-tool-hide'));
 item.innerHTML='<div id="mixed-cm"><p>Keep this explanation.</p><div class="cm-content">'+command+'</div></div>';
 p.findToolBlockSpot(item);assert(!d.querySelector('#mixed-cm').classList.contains('rs-tool-hide'));assert(d.querySelector('.cm-content').classList.contains('rs-tool-hide'));
 item.innerHTML='<p id="safe">Written explanation remains.</p><div id="deep-frame"><span>json</span><button aria-label="Copy code to clipboard">Copy</button><div><div><div><div><div><pre>'+command+'</pre></div></div></div></div></div></div><button id="retry" aria-label="Retry">Retry</button>';
 assert.equal(p.findToolBlockSpot(item).ref,d.querySelector('#deep-frame'));assert(!d.querySelector('#safe').closest('.rs-tool-hide'));assert(!d.querySelector('#retry').closest('.rs-tool-hide'));
 console.log('Claude hides command language/border frames while preserving narration, normal code, thinking, actions and raw parser text.');
} finally {dom.window.close();}
