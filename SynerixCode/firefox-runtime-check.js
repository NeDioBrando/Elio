// Real Firefox + real native bridge; no signed-in provider account is needed.
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),assert=require('assert'),cp=require('child_process');
const {Builder}=require('selenium-webdriver'),firefox=require('selenium-webdriver/firefox');
const root=__dirname,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'synerixcode-firefox-runtime-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let driver,agent,server;const logs=[];
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await sleep(150);}throw Error('Timed out: '+label);}
async function message(value){return driver.executeAsyncScript(`const done=arguments[arguments.length-1];chrome.runtime.sendMessage(arguments[0]).then(done,e=>done({error:String(e)}));`,value);}
(async()=>{try{
  cp.execFileSync('python3',[path.join(root,'release-tools/build-firefox.py'),path.join(root,'synerixcode-Extension'),path.join(tmp,'extension'),path.join(tmp,'firefox.zip')]);
  const fixtureManifest=JSON.parse(fs.readFileSync(path.join(tmp,'extension/manifest.json')));
  const providers=['chatgpt','claude','deepseek','notion'];
  fixtureManifest.content_scripts=fixtureManifest.content_scripts.filter(s=>s.js.some(f=>providers.some(p=>f==='providers/'+p+'.js'||f==='providers/'+p+'-cm.js'))).map(s=>{
    const p=providers.find(p=>s.js.some(f=>f==='providers/'+p+'.js'||f==='providers/'+p+'-cm.js'));
    return {...s,matches:['http://127.0.0.1/fixture/'+p+'*']};
  });
  // Only fixture URL matches change; all runtime script bytes remain original.
  fs.writeFileSync(path.join(tmp,'extension/manifest.json'),JSON.stringify(fixtureManifest));
  cp.execFileSync('python3',['-c',`import pathlib,zipfile;root=pathlib.Path(${JSON.stringify(path.join(tmp,'extension'))});z=zipfile.ZipFile(${JSON.stringify(path.join(tmp,'fixture.zip'))},'w',zipfile.ZIP_DEFLATED);[z.write(p,p.relative_to(root).as_posix()) for p in root.rglob('*') if p.is_file()];z.close()`]);
  if(process.env.SYNERIXCODE_TEST_NATIVE){
    agent=cp.spawn(process.env.SYNERIXCODE_TEST_NATIVE,['--headless','--workspace',path.join(tmp,'workspace')],{env:{...process.env,XDG_CONFIG_HOME:path.join(tmp,'config'),LOCALAPPDATA:path.join(tmp,'config'),SYNERIXCODE_UPDATE_FEED:'http://127.0.0.1:9/unavailable'},stdio:['ignore','pipe','pipe']});
    agent.stdout.on('data',x=>logs.push(String(x)));agent.stderr.on('data',x=>logs.push(String(x)));
    await until(async()=>{const r=await fetch('http://127.0.0.1:3000/api/status',{signal:AbortSignal.timeout(2000)});return r.status===401;},'native bridge listening');
    console.log('Native bridge listening; starting isolated Firefox.');
  }
  const html=`<!doctype html><html><head><style>body{background:#171717;color:white;font:16px sans-serif;margin:0}main{height:100vh}form{position:fixed;bottom:24px;left:15%;width:70%;}.composer-surface{background:#303030;border-radius:28px;padding:20px}#prompt-textarea{min-height:48px}button{padding:12px}article{padding:20px}</style></head><body><main><article data-message-author-role="assistant"><p>Normal written response remains visible.</p><pre><code>{"command":"workspace_info","params":{}}</code></pre></article><form><div class="composer-surface"><div id="prompt-textarea" class="ProseMirror content-editable-leaf-rtl" contenteditable="true" role="textbox" data-placeholder="Ask Notion AI"><p data-placeholder="Ask anything"></p></div><button id="composer-submit-button" data-testid="send-button" aria-label="Send" class="ds-button--primary" type="submit">Send</button></div></form></main></body></html>`;
  // Reject every proxy request: fixtures and authenticated bridge calls are
  // loopback-only. Never forward AI-page content or URLs to external services.
  server=http.createServer((req,res)=>{if(!req.url.startsWith('/fixture/')){res.writeHead(403);res.end('External traffic disabled in test');return;}res.setHeader('Content-Type','text/html');res.end(html);});
  server.on('connect',(_req,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const options=new firefox.Options().addArguments('-headless').setPreference('network.proxy.type',1).setPreference('network.proxy.http','127.0.0.1').setPreference('network.proxy.http_port',port).setPreference('network.proxy.ssl','127.0.0.1').setPreference('network.proxy.ssl_port',port).setPreference('network.proxy.no_proxies_on','127.0.0.1,localhost').setPreference('network.trr.mode',5);
  if(process.env.SYNERIXCODE_TEST_FIREFOX)options.setBinary(process.env.SYNERIXCODE_TEST_FIREFOX);
  const service=new firefox.ServiceBuilder(process.env.SYNERIXCODE_TEST_GECKODRIVER).setHostname('127.0.0.1').addArguments('--allow-system-access');
  driver=await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();console.log('Isolated Firefox started.');await driver.manage().setTimeouts({script:30000,pageLoad:20000});await driver.manage().window().setRect({width:1440,height:1000});
  const id=await driver.installAddon(path.join(tmp,'firefox.zip'),true);assert.equal(id,'synerixcode@synerixcode.local');console.log('Actual Firefox package installed.');
  await driver.setContext('chrome');let base=await driver.executeScript(`return ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs').ExtensionParent.GlobalManager.getExtension(arguments[0]).baseURI.spec`,id);await driver.setContext('content');
  await driver.get(base+'popup.html');assert((await driver.executeScript('return document.body.innerText')).includes('SYNERIXCODE'));
  const status=await message({type:'status'});assert.equal(status.type,'rs-status');
  if(agent){
    await until(async()=>{const r=await message({type:'live-status'});return r.ok&&r.bridge_reachable&&r.local_connected;},'Firefox UUID pairing and authenticated native status');console.log('Authenticated native HTTP status passed.');
    const result=await message({type:'call_tool',engine:'local',name:'workspace_info',arguments:{},timeout:10000});assert(result.ok,JSON.stringify(result));
    console.log('Real Firefox UUID pairing, HTTP authentication, AgentScript WebSocket and native command result passed.');
  }
  const saved=await driver.executeAsyncScript(`const done=arguments[arguments.length-1];chrome.storage.local.set({rsSounds:false,rsThinkingLevel:'high'}).then(()=>chrome.storage.local.get(['rsSounds','rsThinkingLevel'])).then(done);`);assert.equal(saved.rsSounds,false);assert.equal(saved.rsThinkingLevel,'high');
  await driver.get('about:blank');await driver.uninstallAddon(id);await driver.installAddon(path.join(tmp,'fixture.zip'),true);
  // Reinstallation can change Firefox's internal origin even with the same ID.
  await driver.setContext('chrome');base=await driver.executeScript(`return ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs').ExtensionParent.GlobalManager.getExtension(arguments[0]).baseURI.spec`,id);await driver.setContext('content');
  for(const provider of providers){
    await driver.get('http://127.0.0.1:'+port+'/fixture/'+provider);
    await until(()=>driver.executeScript(`const e=document.getElementById('rs-bar');if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom<=innerHeight+2&&r.left>=0&&r.right<=innerWidth+2;`),provider+' real Firefox content-script startup/bar position');
    assert((await driver.executeScript('return document.body.innerText')).includes('Normal written response remains visible.'));
    console.log(provider+' real Firefox extension scripts mounted a visible, positioned bar without removing narration.');
  }
  // The ChatGPT MAIN-world CodeMirror tap must see actual page expandos.
  await driver.get('http://127.0.0.1:'+port+'/fixture/chatgpt');
  const tap=await driver.executeScript(`const editor=document.createElement('div');editor.className='cm-editor';const content=document.createElement('div');content.className='cm-content';content.cmTile={view:{viewState:{state:{doc:{toString:()=>'{"command":"workspace_info","params":{}}'}}}}};editor.append(content);document.body.append(editor);document.dispatchEvent(new CustomEvent('rs-cm-sync'));return [content.getAttribute('data-rs-cm'),editor.getAttribute('data-rs-cm')];`);
  assert(tap.some(v=>v&&v.includes('workspace_info')),JSON.stringify(tap));
  console.log('Firefox MAIN-world CodeMirror receipt and persistent settings passed.');
  if(agent){console.log('Waiting 35 seconds for the Firefox idle check.');await sleep(35000);await driver.get(base+'popup.html');assert((await message({type:'live-status'})).ok,'Bridge must still answer after background idle');const result=await message({type:'call_tool',engine:'local',name:'workspace_info',arguments:{},timeout:10000});assert(result.ok,JSON.stringify(result));console.log('Firefox background wake/idle authenticated status and native command result passed.');}
}catch(error){console.error(error);if(driver){try{console.error(await driver.executeScript(`const e=document.getElementById('rs-bar');return {url:location.href,bar:!!e,rect:e?JSON.stringify(e.getBoundingClientRect()):null,viewport:[innerWidth,innerHeight]};`));await driver.setContext('chrome');console.error(await driver.executeScript(`return Services.console.getMessageArray().filter(m=>String(m.message).includes('moz-extension')).map(m=>String(m.message)).slice(-15);`));}catch{}}if(logs.length)console.error(logs.join('').slice(-4000));process.exitCode=1;}finally{if(driver)await driver.quit().catch(()=>{});if(agent)agent.kill();if(server)server.close();fs.rmSync(tmp,{recursive:true,force:true});}})();
