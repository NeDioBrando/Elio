// SPDX-License-Identifier: GPL-3.0-or-later
// 1.22.0 debug capture: records elio's own errors/warnings/info and the AI
// site's own errors for Settings -> Copy debug report, without changing what
// the console prints, without touching the page's console/fetch, with capped
// buffers, redaction, and no extra pressure on the bridge connection pool.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const capture=fs.readFileSync('core/debug-capture.js','utf8'),helper=fs.readFileSync('core/debug-capture-main.js','utf8');
const EXT='chrome-extension://abcdefghijklmnop/';
function isolated(){
  const dom=new JSDOM('<main></main>',{url:'https://chatgpt.com/c/123?x=1',runScripts:'outside-only'});
  const printed=[],sent=[];
  const ctx=dom.getInternalVMContext();
  const fakeConsole={};
  for(const m of ['error','warn','info','log'])fakeConsole[m]=function(...a){printed.push([m,this,a]);return 'ret-'+m;};
  const orig={...fakeConsole};
  dom.window.console=fakeConsole;
  let intervalFn=null;
  dom.window.setInterval=(fn)=>{intervalFn=fn;return 1;};dom.window.clearInterval=()=>{intervalFn=null;};
  dom.window.chrome={runtime:{id:'x',sendMessage:(m)=>{sent.push(m);return Promise.resolve({ok:true});}}};
  vm.runInContext(capture,ctx);
  return {dom,w:dom.window,printed,sent,flush:()=>intervalFn&&intervalFn(),api:dom.window.__elioDebugCapture,fakeConsole,orig};
}
(async()=>{
  // 1. Console output is unchanged: original runs first with same this/args/return.
  {
    const t=isolated();const c=t.w.console;
    assert.notEqual(c.error,t.orig.error,'console.error is wrapped');
    const err=new Error('boom');err.stack='Error: boom\n    at sendPrompt ('+EXT+'core/main.js:1:200)\n    at async run ('+EXT+'core/main.js:1:900)';
    assert.equal(c.error('[elio] failed',err),'ret-error');
    assert.deepEqual(t.printed[0][2],['[elio] failed',err],'printed exactly as before');
    assert.equal(c.log('site-ish log'),'ret-log');assert.equal(c.log('[rs-diag] x'),'ret-log');
    c.log('[elio] ready token=abcdef123456');c.warn('Bearer abcdefghijklmnopqrstu key '+'f'.repeat(64)+' C:\\Users\\Alice\\a.txt bob@example.com');
    for(let i=0;i<5;i++)c.warn('same warning');
    t.flush();
    assert.equal(t.sent.length,1);const m=t.sent[0];assert.equal(m.type,'rs-debug-log');assert.equal(m.page.host,'chatgpt.com');
    const texts=m.entries.map(e=>e.text).join('\n');
    assert(m.entries[0].where.includes('core/main.js › sendPrompt'),'file › function from the stack');
    assert(!/site-ish|rs-diag/.test(texts),'only elio console.log lines are kept');
    assert(m.entries.some(e=>e.level==='info'&&/\[elio\] ready/.test(e.text)));
    for(const secret of ['abcdef123456','abcdefghijklmnopqrstu','f'.repeat(64),'Alice','bob@example.com'])assert(!texts.includes(secret),secret+' leaked');
    assert.equal(m.entries.find(e=>e.text==='same warning').repeats,5,'repeats are folded');
    // Queue is capped.
    for(let i=0;i<500;i++)c.error('e'+i);t.flush();assert(t.sent[1].entries.length<=150&&t.sent[1].dropped>0);
    // A throwing argument never breaks the caller.
    const bad={toJSON(){throw new Error('x')},toString(){throw new Error('y')}};assert.equal(c.warn(bad),'ret-warn');
    t.dom.window.close();
  }
  // 2. Diag events keep names and numbers but drop chat text.
  {
    const t=isolated();
    t.w.__rsDiag=[{t:1,event:'send.failed',data:{prompt:'secret chat words',ms:30,reason:'timeout'},snap:{gen:true}}];
    t.flush();const d=t.sent[0].diag[0];
    assert.equal(d.event,'send.failed');assert.equal(d.data.ms,30);assert.equal(d.data.prompt,'[17 chars]');
    assert(!JSON.stringify(t.sent[0]).includes('secret chat words'));
    t.flush();assert.equal(t.sent.length,1,'unchanged diag is not resent');
    t.dom.window.close();
  }
  // 3. Extension context gone: capture stops quietly.
  {
    const t=isolated();t.w.chrome.runtime.id=undefined;t.w.console.error('x');t.flush();assert.equal(t.sent.length,0);t.dom.window.close();
  }
  // 4. MAIN helper is passive and relays site problems; buffered until ready.
  {
    const dom=new JSDOM('<main></main>',{url:'https://www.notion.so/ai',runScripts:'outside-only'});
    const w=dom.window,ctx=dom.getInternalVMContext();
    let observerCb=null;w.PerformanceObserver=class{constructor(cb){observerCb=cb;}observe(){}};
    const before={console:w.console,error:w.console.error,fetch:w.fetch,xhr:w.XMLHttpRequest,open:w.XMLHttpRequest.prototype.open};
    vm.runInContext(helper,ctx);
    assert.equal(w.console,before.console);assert.equal(w.console.error,before.error);assert.equal(w.fetch,before.fetch);
    assert.equal(w.XMLHttpRequest,before.xhr);assert.equal(w.XMLHttpRequest.prototype.open,before.open);
    const got=[];w.document.addEventListener('elio:site-log',e=>got.push(JSON.parse(e.detail)));
    w.dispatchEvent(new w.ErrorEvent('error',{message:'TypeError: site broke',filename:'https://www.notion.so/app.js?v=9',lineno:3,colno:4}));
    w.dispatchEvent(new w.ErrorEvent('error',{message:'ext error',filename:EXT+'core/main.js'}));
    w.dispatchEvent(new w.ErrorEvent('error',{message:'ResizeObserver loop completed with undelivered notifications.'}));
    observerCb({getEntries:()=>[{initiatorType:'fetch',responseStatus:429,name:'https://www.notion.so/api/v3/runInference?token=abc'},{initiatorType:'fetch',responseStatus:200,name:'https://www.notion.so/ok'},{initiatorType:'img',responseStatus:404,name:'https://x/y.png'}]});
    assert.equal(got.length,0,'held until the isolated capture is ready');
    w.document.dispatchEvent(new w.CustomEvent('elio:site-log-ready'));
    assert.equal(got.length,2,JSON.stringify(got));
    assert.equal(got[0].text,'TypeError: site broke');assert.equal(got[0].file,'https://www.notion.so/app.js:3:4');
    assert.equal(got[1].status,429);assert(!got[1].text.includes('token'));
    for(let i=0;i<100;i++)w.dispatchEvent(new w.ErrorEvent('error',{message:'loop '+i}));
    assert(got.length<=40,'site error flood is rate-limited');
    dom.window.close();
  }
  // 5. Isolated capture ignores site errors (the helper owns them) and records extension ones.
  {
    const t=isolated();
    t.w.dispatchEvent(new t.w.ErrorEvent('error',{message:'site',filename:'https://chatgpt.com/a.js'}));
    const e=new t.w.Error('mine');e.stack='Error: mine\n    at parseReply ('+EXT+'providers/chatgpt.js:1:5)';
    t.w.dispatchEvent(new t.w.ErrorEvent('error',{message:'Uncaught Error: mine',filename:EXT+'providers/chatgpt.js',error:e}));
    t.w.document.dispatchEvent(new t.w.CustomEvent('elio:site-log',{detail:JSON.stringify({level:'error',kind:'http',status:500,text:'HTTP 500 https://chatgpt.com/backend-api'})}));
    t.flush();const list=t.sent[0].entries;
    assert.equal(list.length,2);assert.equal(list[0].where[0],'providers/chatgpt.js › parseReply');assert.equal(list[1].source,'site');assert.equal(list[1].status,500);
    t.dom.window.close();
  }
  // 6. Every isolated content-script group loads the capture first; the MAIN helper covers every site.
  for(const path of ['manifest.json','elio-Extension/manifest.json']){
    const m=JSON.parse(fs.readFileSync(path,'utf8'));
    const iso=m.content_scripts.filter(c=>c.world!=='MAIN'),main=m.content_scripts.find(c=>(c.js||[]).includes('core/debug-capture-main.js'));
    assert(main&&main.world==='MAIN'&&main.run_at==='document_start');
    for(const c of iso){assert.equal(c.js[0],'core/debug-capture.js',path);for(const x of c.matches)assert(main.matches.includes(x),x);}
  }
  for(const f of ['core/debug-capture.js','core/debug-capture-main.js','background.js'])assert.equal(fs.readFileSync(f,'utf8'),fs.readFileSync('elio-Extension/'+f,'utf8'),f+' copies match');
  // 7. Overhead stays small: 20k wrapped console.warn calls.
  {
    const t=isolated();const start=process.hrtime.bigint();for(let i=0;i<20000;i++)t.w.console.warn('w',i);
    const ms=Number(process.hrtime.bigint()-start)/1e6;assert(ms<3000,'console overhead '+ms+' ms');t.dom.window.close();
  }
  // 8. Desktop: the Debug report card is the last block of Settings and uses /api/debug/report.
  {
    const html=fs.readFileSync('agent/src/desktop.html','utf8');
    const settings=html.slice(html.indexOf('id="page-settings"'),html.indexOf('</section>',html.indexOf('id="page-settings"')));
    assert(/id="debugReport"[\s\S]*<\/div>\s*$/.test(settings)&&settings.lastIndexOf('class="settingcard"')===settings.indexOf('id="debugReport" class="settingcard"')+17&&settings.indexOf('id="debugReport"')>settings.lastIndexOf('settingsgrid'),'Debug report is at the bottom of Settings');
    assert(html.includes("Api('/api/debug/report')")&&html.includes("Byid('debugReportCopy').onclick"));
    const rs=fs.readFileSync('agent/src/main.rs','utf8');
    assert(rs.includes('.route("/api/debug/report", get(debug_report_handler))')&&rs.includes('"/api/debug/browser-log")'),'routes and update-activity exclusion');
  }
  console.log('PASS: debug capture keeps console output, leaves the page untouched, redacts, caps and reports file › function.');
})().catch(e=>{console.error(e);process.exit(1);});
