// Real browser engines against local DOM fixtures, never a live-provider claim.
const {chromium,firefox}=require('playwright'),fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('test-provider-dom-resilience.js','utf8');const fixtures=vm.runInNewContext('('+source.match(/const fixtures=({[\s\S]*?\n});/)[1]+')');
(async()=>{for(const [engine,kind] of [['chromium',chromium],['firefox',firefox]]){
 const browser=await kind.launch({headless:true});let checks=0;
 try{for(const [name,[url,composer]] of Object.entries(fixtures)){
  const context=await browser.newContext();const page=await context.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<main><form><section role="region">'+composer+'<button aria-label="Send message" type="submit">Send</button></section></form></main><style>textarea,[contenteditable]{display:block;width:600px;height:50px}</style>'}));await page.goto(url);
  let code=fs.readFileSync('providers/'+name+'.js','utf8');const end=code.indexOf('\n  }',code.indexOf('  function waitBudget('))+4;
  code=code.slice(0,end)+'\nwindow.probes={safeQuery,safeQueryAll,safeClosest,safeRect,safeStyle,safePredicate,waitBudget};\n'+code.slice(end)+';window.provider=RSProvider;';
  await page.addScriptTag({content:code});const result=await page.evaluate(()=>{
   const editor=document.querySelector('textarea,[contenteditable]'),h=window.probes,p=window.provider;const out=[];
   const check=(label,value)=>{if(!value)throw Error(label);out.push(label);};check('composer',p.getEditor()===editor);
   check('invalid query',h.safeQuery(document,'[')===null&&h.safeQueryAll(document,'[').length===0);check('closest',h.safeClosest(editor,'form')===document.querySelector('form'));
   check('native layout',h.safeRect(editor).width>0);const rect=editor.getBoundingClientRect;editor.getBoundingClientRect=()=>{throw Error('remount');};check('failed rect',h.safeRect(editor).width===0);editor.getBoundingClientRect=rect;
   const style=window.getComputedStyle;window.getComputedStyle=()=>{throw Error('remount');};check('failed style',h.safeStyle(editor).display==='none');window.getComputedStyle=style;
   const copy=editor.cloneNode(true);editor.replaceWith(copy);check('composer remount',p.getEditor()===copy);p.setInputLock(true);p.setInputLock(false);check('unlock',!copy.readOnly&&copy.getAttribute('contenteditable')!=='false');
   check('failed acknowledgement',h.safePredicate(()=>h.safeQuery(null,'input')===null)===false);return out;
  });checks+=result.length;console.log('PASS '+engine+' '+name+' '+result.length+' browser checks');await context.close();
 }}finally{await browser.close();}console.log('PASS '+engine+' '+checks+' real-engine fixture checks');}
})().catch(error=>{console.error(error);process.exitCode=1;});
