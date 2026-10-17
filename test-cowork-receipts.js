const assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const {JSDOM} = require(process.env.SYNERIXCODE_TEST_JSDOM || 'jsdom');
const Cowork = require('./core/cowork');
(async () => {
  const dom = new JSDOM('<main><div role="log"><article id="assistant">Existing AI response</article></div></main>');
  try {
    let context = 'chat-a'; let confirm;
    const queue = Cowork.create({context:()=>context,ready:()=>true,send:()=>new Promise(resolve=>{confirm=resolve;})});
    const source=fs.readFileSync('core/main.js','utf8');
    const start=source.indexOf('    function renderCoworkReceipts('),end=source.indexOf('    function desktopAgentState()',start);
    const ctx={document:dom.window.document,P:{lastAssistant:()=>dom.window.document.querySelector('article')}};
    vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'this.render=renderCoworkReceipts;',ctx);
    queue.setEnabled(true);const text='Exact follow-up\n<script>literal</script>';queue.enqueue(text);
    ctx.render(queue.snapshot().receipts);
    const card=dom.window.document.querySelector('.rs-cowork-receipt');
    assert(card.textContent.includes('Queued'));assert(card.textContent.includes(text));assert(!card.querySelector('script'));
    assert.equal(card.closest('[role="log"]'),null,'Receipt must not become a native assistant message in provider fallback lists');
    const operation=queue.take();ctx.render(queue.snapshot().receipts);assert(card.textContent.includes('Sending to AI'));
    assert.equal(queue.snapshot().receipts[0].status,'sending');confirm(1);await operation;
    ctx.render(queue.snapshot().receipts);assert.equal(queue.snapshot().pending.length,0);assert.equal(card.isConnected,false,'Confirmed sent card is removed immediately');assert.equal(queue.snapshot().receipts[0].status,'sent','Keep the internal confirmed receipt');
    ctx.render(queue.snapshot().receipts);assert.equal(dom.window.document.querySelectorAll('.rs-cowork-receipt').length,0);
    assert.equal(dom.window.document.querySelector('article').textContent,'Existing AI response');
    context='chat-b';ctx.render(queue.snapshot().receipts);assert.equal(dom.window.document.querySelectorAll('.rs-cowork-receipt').length,0);
    context='chat-a';ctx.render(queue.snapshot().receipts);assert.equal(dom.window.document.querySelectorAll('.rs-cowork-receipt').length,0);
    queue.enqueue('uncertain follow-up');await assert.rejects(queue.deliverWithFeedback('tool result',async()=>{throw Error('No confirmation');}));
    ctx.render(queue.snapshot().receipts);assert(dom.window.document.querySelector('[data-status="unconfirmed"]').textContent.includes('Send not confirmed'));
    assert.equal(await queue.take(),null);
    console.log('Queued/sending/uncertain follow-ups remain visible; confirmed cards disappear immediately and stay absent across chat switches, while internal receipts and AI narration are preserved.');
  } finally {dom.window.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
