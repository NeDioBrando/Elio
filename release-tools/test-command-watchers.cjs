// Production adapters + parser + response watcher in native browser DOMs.
const {chromium,firefox}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
const main=fs.readFileSync('core/main.js','utf8'),a=main.indexOf('  async function waitForResponse('),b=main.indexOf('\n  // ═',a),watcher=main.slice(a,b);
(async()=>{for(const [engine,kind]of [['chromium',chromium],['firefox',firefox]]){
 const browser=await kind.launch({headless:true});
 try{for(const name of ['chatgpt','claude'])for(const mode of ['complete','native-pause','soft-wedge','stopped']){
  const context=await browser.newContext(),page=await context.newPage();
  const command='{"command":"script_grep","params":{"pattern":"Dock"}}';
  const turns=name==='chatgpt'?'<div data-message-author-role="assistant" data-message-id="fresh"><div class="markdown"><pre class="rs-tool-hide"><code></code></pre><div class="rs-chip">script_grep · 1s</div></div></div>':'<div data-testid="assistant-message" data-message-id="fresh"><div class="standard-markdown"><pre class="rs-tool-hide"><code></code></pre><div class="rs-chip">script_grep · 1s</div></div></div>';
  const editor=name==='chatgpt'?'<div id="prompt-textarea" contenteditable="true"></div>':'<div class="ProseMirror" contenteditable="true"></div>';
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:turns+'<form>'+editor+'<button data-testid="send-button" aria-label="Send message" type="submit">Send</button></form><style>.rs-tool-hide{display:none} [contenteditable]{width:600px;height:50px}</style>'}));await page.goto(name==='chatgpt'?'https://chatgpt.com/c/test':'https://claude.ai/chat/test');
  await page.addScriptTag({content:fs.readFileSync('providers/'+name+'.js','utf8')+';window.adapter=RSProvider;'});
  await page.addScriptTag({content:fs.readFileSync('core/parser.js','utf8')+';window.parser=RSParse;'});
  const result=await page.evaluate(async({watcher,mode,command})=>{
   let now=1000,ticks=0;Date.now=()=>now;
   const p=window.adapter,code=document.querySelector('code'),button=document.querySelector('form button'),chip=document.querySelector('.rs-chip');
   const apply=()=>{
    if(mode==='soft-wedge')code.textContent='{"command":'+' '.repeat(ticks+1)+'"script_grep","params":{';else code.textContent=command;
    if(mode==='native-pause'&&now<21000){button.setAttribute('data-testid','stop-button');button.setAttribute('aria-label','Stop response');}else{button.setAttribute('data-testid','send-button');button.setAttribute('aria-label','Send message');}
    if(mode==='soft-wedge'&&p.id==='claude')p.lastAssistant().setAttribute('data-is-streaming','true');
    chip.textContent='script_grep · '+ticks+'s';
   };apply();
   const A={stop:mode==='stopped',sendToken:'previous',detectedTool:null};
   const T={...p.timings,RESPONSE_TIMEOUT_MS:30000,STABLE_MS:9000,WARMUP_MS:1000,REASON_NOREPLY_MS:1000};
   const sleep=async ms=>{now+=ms;ticks++;if(now>40000)throw Error('Unbounded response watcher');apply();};
   const watch=new Function('A','P','T','RSParse','sleep','diag','log','bgMode',watcher+';return waitForResponse(0);');
   const result=await watch(A,p,T,window.parser,sleep,()=>{},()=>{},false);
   return {kind:result.kind,time:now,calls:result.calls?.map(c=>c.tool),reply:p.readAssistant().reply};
  },{watcher,mode,command});
  if(mode==='soft-wedge'){assert.equal(result.kind,'busy_timeout');assert(result.time<33000);}else if(mode==='stopped'){assert.equal(result.kind,'stopped');assert.equal(result.calls,undefined);}else{assert.equal(result.kind,'tool');assert.deepEqual(result.calls,['script_grep']);if(mode==='native-pause')assert(result.time>=21000,'No command while native Stop remains');assert(!result.reply.includes('script_grep ·'),'Own timer must not be model progress');}
  console.log(`${engine} ${name} ${mode}: production command watcher passed`);await context.close();
 }}finally{await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
