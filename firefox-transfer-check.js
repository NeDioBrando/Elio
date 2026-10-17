// Real Firefox: actual Notion adapter + Firefox transfer shim against page-world
// handlers that read only native DataTransfer fields, like Notion's own code.
// Usage: node firefox-transfer-check.js [--without-shim]
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),assert=require('assert'),cp=require('child_process');
const {Builder}=require(process.env.SYNERIXCODE_SELENIUM||'selenium-webdriver'),firefox=require((process.env.SYNERIXCODE_SELENIUM||'selenium-webdriver')+'/firefox');
const root=__dirname,ext=path.join(root,'synerixcode-Extension'),withoutShim=process.argv.includes('--without-shim');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'synerixcode-firefox-transfer-'));
const page=`<!doctype html><html><head><style>body{margin:0;background:#191919;color:#eee;font:15px sans-serif}main{height:100vh}#host{position:fixed;left:200px;bottom:40px;width:650px}#composer{display:flex;gap:8px;align-items:center;height:100px;background:#2a2a2a;border-radius:12px;padding:8px;box-sizing:border-box}#composer [role=textbox]{flex:1;min-height:40px;outline:none}#uploads{min-height:10px}</style></head><body><main><div id="rows"></div><section id="host"><div id="uploads"></div><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><div role="button" data-testid="agent-chat-send-button" aria-label="Submit AI message" aria-disabled="true">Send</div></section></section></main>
<script>
const ed=document.querySelector('[role=textbox]'),button=document.querySelector('[role=button]'),frame=document.getElementById('composer'),uploads=document.getElementById('uploads');
const log={pastes:[],drops:[],sent:[]};let fileText='',filename='';
const publish=()=>document.body.setAttribute('data-page',JSON.stringify(log));
ed.addEventListener('paste',e=>{e.preventDefault();const html=e.clipboardData.getData('text/html'),plain=e.clipboardData.getData('text/plain');log.pastes.push({html:html.length,plain:plain.length});const holder=document.createElement('div');holder.innerHTML=html;const value=html?holder.textContent:plain;const sel=getSelection();if(sel.rangeCount&&!sel.isCollapsed)ed.textContent=value;else ed.textContent+=value;button.setAttribute('aria-disabled',ed.textContent?'false':'true');publish();});
ed.addEventListener('input',()=>{button.setAttribute('aria-disabled',ed.textContent?'false':'true');});
for(const t of ['dragenter','dragover'])frame.addEventListener(t,e=>e.preventDefault());
frame.addEventListener('drop',e=>{e.preventDefault();const files=e.dataTransfer.files;log.drops.push(files.length);publish();if(!files.length)return;const f=files[0];filename=f.name;const card=document.createElement('div');card.setAttribute('data-testid','attachment');card.setAttribute('aria-busy','true');card.innerHTML='<span></span><button aria-label="Remove file">X</button>';card.firstChild.textContent=f.name;card.lastChild.onclick=()=>card.remove();uploads.append(card);f.text().then(t=>{fileText=t;setTimeout(()=>card.removeAttribute('aria-busy'),300);});});
button.addEventListener('click',()=>{if(button.getAttribute('aria-disabled')==='true')return;log.sent.push({text:ed.textContent,fileText,filename});fileText='';filename='';ed.textContent='';uploads.innerHTML='';button.setAttribute('aria-disabled','true');const row=document.createElement('div');row.setAttribute('data-agent-service-scroll-anchor','user-'+log.sent.length);row.style.justifyContent='flex-end';row.textContent=log.sent.at(-1).text;document.getElementById('rows').append(row);history.replaceState({},'','/chat/firefox-check');publish();});
const probe=document.createElement('div');probe.id='probe';document.body.append(probe);log.probe={};
probe.addEventListener('paste',e=>{log.probe.paste=(log.probe.paste||[]).concat(e.clipboardData?e.clipboardData.getData('text/plain'):null);if(e.clipboardData&&e.clipboardData.getData('text/plain')==='cancel me')e.preventDefault();publish();});
for(const t of ['dragenter','dragover','drop'])probe.addEventListener(t,e=>{(log.probe.drag=log.probe.drag||[]).push(t+':'+e.dataTransfer.files.length+':'+(e.dataTransfer.files[0]?e.dataTransfer.files[0].name:''));if(t==='dragenter')log.probe.dt0=e.dataTransfer;else if(t==='drop')log.probe.sameTransfer=(log.probe.dt0===e.dataTransfer);publish();});
probe.addEventListener('beforeinput',e=>{log.probe.beforeinput=[e.inputType,e.dataTransfer&&e.dataTransfer.getData('text/plain')];publish();});
const sh=document.createElement('div');sh.id='shadowhost';document.body.append(sh);const root=sh.attachShadow({mode:'open'});const inner=document.createElement('div');inner.id='inner';root.append(inner);inner.addEventListener('paste',e=>{log.probe.shadow=e.clipboardData.getData('text/plain');publish();});
publish();
</script></body></html>`;
const harness=`(async()=>{const out={};try{const p=RSProvider;p.init({isStopped:()=>false});
new MutationObserver(()=>{try{p.invalidateItems&&p.invalidateItems();}catch{}}).observe(document.documentElement,{childList:true,subtree:true});
const startup='\\u27e6RS-SYS\\u27e7 AGENTSCRIPT\\n'+('Keep **names**, exact C:\\\\Path\\\\File & <tag> \\ud83e\\udde0\\n').repeat(1000)+'\\nEmit list_commands first.';
out.startupChars=startup.length;const t0=Date.now();out.startup=await p.typeAndSend(startup);out.startupMs=Date.now()-t0;out.detail=p.sendFailureDetail?p.sendFailureDetail():'';
out.short=await p.typeAndSend('Short Co-Work follow-up: keep **bold** & C:\\\\path');
const ed=p.getEditor();ed.focus();document.execCommand('insertText',false,'user draft');out.draftBefore=ed.textContent;
out.clear=await p.writeDraft('','user draft');out.draftAfter=p.getEditor().textContent;
out.shim=!!globalThis.__synerixcodeFirefoxShim;
const probe=document.getElementById('probe');const sem={};
let clicks=0;probe.addEventListener('click',()=>clicks++);sem.clickReturn=probe.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));sem.clicks=clicks;
const dt=new window.DataTransfer();dt.setData('text/plain','cancel me');const pe=new window.ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt});sem.cancelReturn=probe.dispatchEvent(pe);sem.cancelPrevented=pe.defaultPrevented;
const dd=new window.DataTransfer();dd.items.add(new File(['abc'],'seq.txt',{type:'text/plain'}));for(const t of ['dragenter','dragover','drop'])probe.dispatchEvent(new window.DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dd}));
const bi=new window.DataTransfer();bi.setData('text/plain','before input');probe.dispatchEvent(new window.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertFromPaste',dataTransfer:bi}));

const sdt=new window.DataTransfer();sdt.setData('text/plain','shadow paste');const target=document.getElementById('shadowhost').wrappedJSObject?document.getElementById('shadowhost').openOrClosedShadowRoot.querySelector('#inner'):null;if(target)target.dispatchEvent(new window.ClipboardEvent('paste',{bubbles:true,composed:true,cancelable:true,clipboardData:sdt}));
sem.emptyPaste=probe.dispatchEvent(new window.ClipboardEvent('paste',{bubbles:true,cancelable:true}));
out.sem=sem;}catch(e){out.error=String(e&&e.stack||e);}document.documentElement.setAttribute('data-harness',JSON.stringify(out));})();`;
(async()=>{let driver,server;try{
  const dir=path.join(tmp,'ext');fs.mkdirSync(path.join(dir,'core'),{recursive:true});fs.mkdirSync(path.join(dir,'providers'));
  fs.copyFileSync(path.join(ext,'providers/notion.js'),path.join(dir,'providers/notion.js'));
  for(const f of ['firefox-events.js','firefox-events-main.js'])fs.copyFileSync(path.join(ext,'core',f),path.join(dir,'core',f));
  fs.writeFileSync(path.join(dir,'harness.js'),harness);
  const isolated=[...(withoutShim?[]:['core/firefox-events.js']),'providers/notion.js','harness.js'];
  const scripts=[{matches:['http://127.0.0.1/*'],js:isolated,run_at:'document_idle'}];
  if(!withoutShim)scripts.unshift({matches:['http://127.0.0.1/*'],js:['core/firefox-events-main.js'],world:'MAIN',run_at:'document_start'});
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({manifest_version:3,name:'synerixcode transfer check',version:'1.0',browser_specific_settings:{gecko:{id:'synerixcode-transfer@synerixcode.local',strict_min_version:'140.0'}},content_scripts:scripts}));
  cp.execFileSync('python3',['-c',`import pathlib,zipfile;r=pathlib.Path(${JSON.stringify(dir)});z=zipfile.ZipFile(${JSON.stringify(path.join(tmp,'x.zip'))},'w');[z.write(p,p.relative_to(r).as_posix()) for p in r.rglob('*') if p.is_file()];z.close()`]);
  server=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html');s.end(page);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const o=new firefox.Options().addArguments('-headless');if(process.env.SYNERIXCODE_TEST_FIREFOX)o.setBinary(process.env.SYNERIXCODE_TEST_FIREFOX);
  driver=await new Builder().forBrowser('firefox').setFirefoxOptions(o).setFirefoxService(new firefox.ServiceBuilder(process.env.SYNERIXCODE_TEST_GECKODRIVER)).build();
  await driver.manage().window().setRect({width:1280,height:900});
  await driver.installAddon(path.join(tmp,'x.zip'),true);await driver.get('http://127.0.0.1:'+server.address().port+'/ai');
  let h=null;const end=Date.now()+150000;while(Date.now()<end&&!h){h=await driver.executeScript("return document.documentElement.getAttribute('data-harness')");if(!h)await new Promise(r=>setTimeout(r,250));}
  const pageLog=JSON.parse(await driver.executeScript("return document.body.getAttribute('data-page')"));const r=JSON.parse(h);
  console.log(JSON.stringify({harness:{...r,detail:(r.detail||'').slice(0,80)},drops:pageLog.drops,pastes:pageLog.pastes,sent:pageLog.sent.map(s=>({text:s.text.slice(0,400),file:s.filename,fileChars:s.fileText.length}))},null,1));
  if(withoutShim){assert.equal(r.startup,false);console.log('Baseline reproduced: Firefox hides content-script drop files; startup fails.');}
  else{assert(!r.error,r.error);assert.equal(r.shim,true);assert.equal(r.startup,true,'startup protocol file');assert.equal(pageLog.sent[0].fileText.length,r.startupChars);assert(pageLog.sent[0].text.includes(pageLog.sent[0].filename));
    assert.equal(r.short,true);assert.equal(pageLog.sent[1].text,'Short Co-Work follow-up: keep **bold** & C:\\path');assert.deepEqual(r.clear,{ok:true,reason:''});assert.equal(r.draftAfter,'');
    const sem=r.sem,pr=pageLog.probe;assert.equal(sem.clickReturn,true);assert.equal(sem.clicks,1,'ordinary events stay native');assert.equal(sem.cancelReturn,false);assert.equal(sem.cancelPrevented,true,'page cancellation returns to caller');
    assert.deepEqual(pr.drag,['dragenter:1:seq.txt','dragover:1:seq.txt','drop:1:seq.txt']);assert.equal(pr.sameTransfer,true,'one transfer per drag sequence');assert.deepEqual(pr.beforeinput,['insertFromPaste','before input']);assert.equal(pr.shadow,'shadow paste','shadow DOM targets keep their exact target');assert.equal(sem.emptyPaste,true);
    console.log('Real Firefox shim semantics: native events untouched, cancellation, drag identity, beforeinput and shadow targets passed.');
    console.log('Real Firefox: Notion protocol file upload, inline follow-up paste and Co-Work draft clear reach page handlers intact.');}
}catch(e){console.error(e);process.exitCode=1;}finally{if(driver)await driver.quit();if(server)server.close();fs.rmSync(tmp,{recursive:true,force:true});}})();
