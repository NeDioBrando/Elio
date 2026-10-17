// Chromium DOM fixtures for the reported Co-Work/Claude failure shapes.
// This is not a signed-in Claude session or a live Microsoft Edge test.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const executable=['/usr/bin/chromium','/usr/local/bin/chromium'].find(p=>fs.existsSync(p));
 const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<main><article data-testid="assistant-message" data-message-id="old"><div class="standard-markdown">Old answer</div></article><div data-testid="user-message">Current request</div><article data-testid="assistant-message" data-message-id="new"><div data-is-thinking="true"><div class="standard-markdown">Thinking must stay excluded</div></div><div class="font-claude-response"><div class="standard-markdown"><pre>{"command":"synerixcode_status","params":{}}</pre></div></div><div class="font-claude-response"></div></article></main>'}));
  await page.goto('https://claude.ai/chat/local-fixture');
  await page.addScriptTag({content:fs.readFileSync('providers/claude.js','utf8')+';window.provider=RSProvider;'});
  await page.addScriptTag({content:fs.readFileSync('core/parser.js','utf8')+';window.parser=RSParse;'});
  const main=fs.readFileSync('core/main.js','utf8');
  await page.addScriptTag({content:'const P=window.provider;'+main.slice(main.indexOf('    function renderCoworkReceipts('),main.indexOf('    function desktopAgentState('))+';window.renderReceipts=renderCoworkReceipts;'});
  const result=await page.evaluate(()=>{
   const p=window.provider;
   if(p.assistantCount()!==2)throw Error('Nested response wrappers were counted as turns');
   const reply=p.readAssistant().reply;
   if(reply.includes('Thinking must stay excluded'))throw Error('Thinking was read as an answer');
   const calls=window.parser.parseToolCalls(reply);
   if(calls.length!==1||calls[0].tool!=='synerixcode_status')throw Error('Completed Claude command was lost');
   for(let id=1;id<=3;id++){
    window.renderReceipts([{id,text:'Follow-up '+id,status:'queued'}]);
    if(document.querySelectorAll('.rs-cowork-receipt').length!==1)throw Error('Queued card missing');
    window.renderReceipts([{id,text:'Follow-up '+id,status:'sent'}]);
    if(document.querySelector('.rs-cowork-receipt'))throw Error('Sent card still occupies chat space');
   }
   window.renderReceipts([{id:4,text:'May have been sent',status:'unconfirmed'}]);
   if(!document.querySelector('.rs-cowork-receipt').textContent.includes('not confirmed'))throw Error('Uncertain delivery was hidden');
   return {turns:p.assistantCount(),tool:calls[0].tool};
  });
  assert.deepEqual(result,{turns:2,tool:'synerixcode_status'});
  console.log('PASS Chromium: completed Claude command survives nested/empty/thinking nodes; confirmed Co-Work cards clear immediately and uncertain cards remain.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
