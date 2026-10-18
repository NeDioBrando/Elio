// 1.24.13: pasting into the prompt enhancer (and other elio text boxes)
// must work even when the page cancels paste/edit events outside its editor.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const source=fs.readFileSync('core/input-isolation.js','utf8'),manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
 // Registered first: a document_start entry on every site that runs core/main.js.
 const early=manifest.content_scripts.find(e=>e.js.includes('core/input-isolation.js')&&e.run_at==='document_start');assert(early,'document_start entry');
 for(const entry of manifest.content_scripts.filter(e=>e.js.includes('core/main.js'))){assert.equal(entry.js[1],'core/input-isolation.js');for(const url of entry.matches)assert(early.matches.includes(url),url+' gets early isolation');}
 // JSDOM: own text controls are isolated, page controls and plain typing are not.
 const dom=new JSDOM('<!doctype html><html><body><div id="app"><textarea id="page"></textarea></div></body></html>',{runScripts:'outside-only'}),w=dom.window;
 assert(source.includes('if (!event.isTrusted ||'),'only trusted user events are isolated');
 // JSDOM cannot create trusted events, so this copy treats events marked synthetic as untrusted.
 w.eval(source.replace('!event.isTrusted','event.synthetic'));
 const root=w.document.createElement('div');root.id='rs-root';root.innerHTML='<div id="rs-enhancer-panel"><textarea id="rs-enhancer-input"></textarea><button id="b">x</button></div>';w.document.documentElement.append(root);
 const seen=[];w.document.addEventListener('paste',e=>seen.push(['paste',e.target.id]),true);w.document.addEventListener('keydown',e=>seen.push(['keydown',e.target.id,e.key]),true);
 const fire=(el,type,init={})=>{const e=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(e,init);el.dispatchEvent(e);return e;};
 const own=w.document.getElementById('rs-enhancer-input'),page=w.document.getElementById('page');
 fire(own,'paste');fire(own,'keydown',{key:'v',ctrlKey:true});fire(own,'keydown',{key:'a'});fire(page,'paste');fire(page,'keydown',{key:'v',ctrlKey:true});
 assert.deepEqual(JSON.parse(JSON.stringify(seen)),[['keydown','rs-enhancer-input','a'],['paste','page'],['keydown','page','v']]);
 const untrusted=new w.Event('paste',{bubbles:true});untrusted.synthetic=true;own.dispatchEvent(untrusted);assert.equal(seen.at(-1)[0],'paste','synthetic events are never touched');
 // Real browser: a hostile page blocks paste outside its editor (the Notion case).
 let chromium=null;try{({chromium}=require('playwright'));}catch{}
 const executable=['/usr/local/bin/chromium','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p));
 if(!chromium||!executable){console.log('1.24.13 enhancer paste: isolation wiring passes (browser check skipped: no Playwright/Chromium)');return;}
 const browser=await chromium.launch({executablePath:executable,args:['--no-sandbox']});
 try{
  const run=async isolate=>{
   const context=await browser.newContext();await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://example.com'});
   const page=await context.newPage();if(isolate)await page.addInitScript({content:source});
   await page.route('https://example.com/',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="app" contenteditable="true">page editor</div><script>
    const outside=e=>!document.getElementById('app').contains(e.target);
    for(const target of [window,document])for(const type of ['paste','beforeinput','keydown'])target.addEventListener(type,e=>{if(!outside(e))return;if(type==='keydown'&&!(e.ctrlKey&&e.key==='v'))return;if(type==='beforeinput'&&e.inputType!=='insertFromPaste')return;e.preventDefault();e.stopImmediatePropagation();window.blocked=(window.blocked||0)+1;},true);
   </script></body></html>`}));
   await page.goto('https://example.com/');
   await page.evaluate(async()=>{const root=document.createElement('div');root.id='rs-root';root.innerHTML='<div id="rs-enhancer-panel"><textarea id="rs-enhancer-input"></textarea></div>';document.documentElement.appendChild(root);await navigator.clipboard.writeText('pasted request');});
   await page.click('#rs-enhancer-input');await page.keyboard.type('Fix ');await page.keyboard.press('Control+V');await page.waitForTimeout(200);
   const value=await page.$eval('#rs-enhancer-input',e=>e.value);
   // The page's own editor keeps its own behaviour.
   await page.click('#app');await page.keyboard.press('Control+V');await page.waitForTimeout(100);
   const pageEditor=await page.$eval('#app',e=>e.textContent);await context.close();return {value,pageEditor};
  };
  const before=await run(false),after=await run(true);
  assert.equal(before.value,'Fix ','the hostile page reproduces the bug without isolation');
  assert.equal(after.value,'Fix pasted request','paste lands in the prompt enhancer');
  assert.equal(after.pageEditor,before.pageEditor,'page editor behaviour is unchanged');
 }finally{await browser.close();}
 console.log('1.24.13 enhancer paste: paste works in elio text boxes on hostile pages (browser verified)');
})().catch(error=>{console.error(error);process.exit(1);});
