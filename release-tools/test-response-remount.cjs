// Offline browser fixture: real Claude reader + shared watcher, no account/bridge.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const main=fs.readFileSync(path.join(root,'core/main.js'),'utf8');
const watcher=main.slice(main.indexOf('  async function waitForResponse('),main.indexOf('\n  // ═',main.indexOf('  async function waitForResponse(')));
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.ELIO_CHROMIUM?{executablePath:process.env.ELIO_CHROMIUM}:fs.existsSync('/usr/local/bin/chromium')?{executablePath:'/usr/local/bin/chromium'}:{})});
 try{for(const mode of ['remount','reuse','thinking-only','user-only','missing-id']){
  const page=await browser.newPage();
  await page.route('**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<main><article data-testid="assistant-message" data-message-id="old"><div class="standard-markdown">Old answer</div></article><div data-testid="user-message">New request</div></main>'}));
  await page.goto('https://claude.ai/chat/offline-response-test');
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'core/parser.js'),'utf8')+';window.parser=RSParse;'});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'providers/claude.js'),'utf8')+';window.provider=RSProvider;'});
  const result=await page.evaluate(async({mode,watcher})=>{
   let now=1000,ticks=0;const p=window.provider,sendToken=p.lastAssistantId(),command='{"command":"elio_status","params":{}}';
   const answer=document.createElement('article');answer.dataset.testid='assistant-message';if(mode!=='missing-id')answer.dataset.messageId='new';
   answer.innerHTML=mode==='thinking-only'?'<div data-is-thinking="true"><div class="standard-markdown">'+command+'</div></div>':mode==='user-only'?'':'<div class="standard-markdown">'+command+'</div>';
   document.querySelector('main').append(answer);
   if(mode==='user-only')document.querySelector('[data-testid="user-message"]').textContent=command;
   const A={stop:false,sessionGen:1,sendToken};
   const P={...p,isHardGenerating:()=>ticks===0,isGenerating:()=>ticks===0};
   const T={RESPONSE_TIMEOUT_MS:20000,STABLE_MS:1000,WARMUP_MS:300,REASON_NOREPLY_MS:300,PRESTART_MS:1000};
   const sleep=async ms=>{now+=ms;ticks++;if(ticks===1){if(mode==='reuse'){answer.dataset.messageId='other';answer.innerHTML='';}else if(mode==='remount'||mode==='missing-id'){const fresh=answer.cloneNode(false);answer.replaceWith(fresh);}}};
   const run=new Function('A','P','T','RSParse','Date','document','bgMode','sleep','diag','log',watcher+';return waitForResponse(1);');
   const res=await run(A,P,T,window.parser,{now:()=>now},document,false,sleep,()=>{},()=>{});
   return{kind:res.kind,text:res.text,tool:res.calls?.[0]?.tool};
  },{mode,watcher});
  if(mode==='remount'){assert.equal(result.kind,'tool');assert.equal(result.tool,'elio_status');assert(result.text.includes('elio_status'));}else assert.notEqual(result.kind,'tool',mode+' must not execute borrowed text');
  console.log('PASS Chromium real Claude adapter',mode,result.kind);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
