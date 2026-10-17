// User reports: confirmed Co-Work cards persist; completed Claude reply reported empty.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const main = fs.readFileSync('core/main.js', 'utf8');
const parser = new Function(fs.readFileSync('core/parser.js', 'utf8') + ';return RSParse;')();
const command = '{"command":"synerixcode_status","params":{}}';
function coworkCards() {
  const dom = new JSDOM('<main><article id="answer">Answer</article></main>');
  try {
    const document = dom.window.document;
    const code = main.slice(main.indexOf('    function renderCoworkReceipts('), main.indexOf('    function desktopAgentState('));
    const box = { document, P: { lastAssistant: () => document.querySelector('#answer') } };
    vm.createContext(box); vm.runInContext(code + ';this.render=renderCoworkReceipts;', box);
    const item = { id: 1, text: 'Exact follow-up', status: 'queued' };
    box.render([item]); assert.equal(document.querySelectorAll('.rs-cowork-receipt').length, 1);
    box.render([{ ...item, status: 'sending' }]);
    assert.match(document.querySelector('.rs-cowork-receipt').textContent, /Sending to AI/);
    // Uncertain sends must remain visible and must not become automatic retries.
    box.render([{ ...item, status: 'unconfirmed' }]);
    assert.match(document.querySelector('.rs-cowork-receipt').textContent, /not confirmed/);
    box.render([{ ...item, status: 'sent' }]);
    assert.equal(document.querySelectorAll('.rs-cowork-receipt').length, 0, 'Confirmed sent cards disappear immediately');
    box.render([{ ...item, status: 'sent' }, { id: 2, text: 'Later request', status: 'queued' }]);
    assert.equal(document.querySelectorAll('.rs-cowork-receipt').length, 1, 'Later queued cards remain');
    assert.match(document.querySelector('.rs-cowork-receipt').textContent, /Later request/);
    box.render([]); assert.equal(document.querySelectorAll('.rs-cowork-receipt').length, 0, 'Changing chat clears old cards');
    // Run the real queue panel renderer too: sent history is retained internally, never mounted.
    document.body.insertAdjacentHTML('beforeend', '<div id="root"><button id="rs-cowork"></button><button id="rs-cowork-queue"></button><div id="rs-cowork-panel"></div><button id="rs-cowork-resume"></button><div id="rs-cowork-status"></div><div id="rs-cowork-list"></div></div>');
    Object.assign(box, {root:document.querySelector('#root'), cowork:{snapshot:()=>({enabled:true,pending:[],receipts:[{...item,status:'sent'}]})}, A:{}, inputCover(){},setFollowupPlaceholder(){},coworkReady:()=>true});
    Object.assign(box.P,{isGenerating:()=>false,getEditor:()=>null});
    vm.runInContext(main.slice(main.indexOf('    function renderCowork()'), main.indexOf('    function renderCoworkReceipts('))+';renderCowork();', box);
    assert.equal(document.querySelector('#rs-cowork-list').childElementCount, 0, 'Queue panel also drops sent cards');
  } finally { dom.window.close(); }
}
async function claudeReplies() {
  let now = 1000;
  const dom = new JSDOM('<main><article data-testid="assistant-message" data-message-id="old"><div class="standard-markdown">Old answer</div></article><div data-testid="user-message">New request</div></main>', {url:'https://claude.ai/chat/test',runScripts:'outside-only'});
  try {
    const w=dom.window, d=w.document; w.Date.now=()=>now;
    vm.runInContext(fs.readFileSync('providers/claude.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());
    const p=w.provider, sendToken=p.lastAssistantId();
    const item=d.createElement('article');item.dataset.testid='assistant-message';item.dataset.messageId='new';d.querySelector('main').append(item);
    item.innerHTML='<div data-is-thinking="true"><div class="standard-markdown">Private thinking</div></div><div class="font-claude-response"><div class="standard-markdown"><p>Checking status.</p><pre><code>'+command+'</code></pre></div></div><div class="font-claude-response"></div>';
    assert.equal(p.assistantCount(),2,'Nested response nodes count as one assistant turn');
    assert.equal(p.lastAssistant(),item,'Use the owning turn, not its trailing empty child');
    assert(p.readAssistant().reply.includes(command),'Completed command remains readable');
    assert(!p.readAssistant().reply.includes('Private thinking'),'Reasoning is not an answer');
    const start=main.indexOf('  async function waitForResponse('),end=main.indexOf('\n  // ═',start);
    const box={P:p,A:{stop:false,sendToken},T:{RESPONSE_TIMEOUT_MS:20000,STABLE_MS:8000,WARMUP_MS:1000,REASON_NOREPLY_MS:1000},RSParse:parser,Date:{now:()=>now},document:{hidden:false},bgMode:false,sleep:async ms=>{now+=ms},diag(){},log(){}};
    vm.createContext(box);vm.runInContext(main.slice(start,end)+';this.watch=waitForResponse;',box);
    const result=await box.watch(1);
    assert.equal(result.kind,'tool','A visible completed Claude command must not become an empty reply');
    assert.equal(result.calls[0].tool,'synerixcode_status');
    // Same turn contains multiple answer blocks; the command may be after narration.
    item.innerHTML='<div data-is-thinking="true"><div class="standard-markdown">Hidden thought</div></div><div class="standard-markdown">First answer block.</div><div data-testid="markdown"><pre>'+command+'</pre></div>';
    assert(p.readAssistant().reply.includes('First answer block.'));
    assert(p.readAssistant().reply.includes(command),'Read all sibling answer blocks');
    assert(!p.classifyText(item).includes('Hidden thought'));
    // DOM remount must not resurrect old commands or copy previous-turn content.
    const fresh=item.cloneNode(true);item.replaceWith(fresh);
    assert.equal(p.lastAssistant(),fresh);assert(p.readAssistant().reply.includes(command));
    fresh.innerHTML='';assert.equal(p.readAssistant().reply,'','A genuinely blank latest reply stays blank');
    fresh.remove();
    const standalone=d.createElement('div');standalone.className='font-claude-response';standalone.innerHTML='<div class="standard-markdown">Legacy answer</div>';d.querySelector('main').append(standalone);
    assert.equal(p.readAssistant().reply,'Legacy answer','Legacy unwrapped responses remain supported');
  } finally { dom.window.close(); }
}
(async()=>{let failed=0;for(const [name,run] of [['cowork',coworkCards],['claude',claudeReplies]]){
  try {await run();console.log('PASS '+name+' reported regression and preservation cases');}
  catch(error){failed++;console.error('FAIL '+name+': '+error.stack);}
}if(failed)process.exitCode=1;})();
