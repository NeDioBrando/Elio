// 1.24.13: the clarification panel ("<AI> is asking you…") must stay above
// synerixcode's own "Agent is working…" cover and Tasks button. Notion makes <body>
// its own stacking context, so a panel mounted in <body> was flattened below
// those <html>-level overlays and they covered the Submit button.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const clarSource=fs.readFileSync('core/clarification.js','utf8'),main=fs.readFileSync('core/main.js','utf8'),css=fs.readFileSync('overlay.css','utf8');
 const z=selector=>{const m=css.match(new RegExp(selector.replace(/[#.]/g,'\\$&')+'\\s*\\{[^}]*?z-index:\\s*(\\d+)'));return m&&Number(m[1]);};
 const hostZ=Number(clarSource.match(/:host\{position:fixed;inset:0;z-index:(\d+);/)[1]);
 assert.equal(hostZ,2147483647,'the panel uses the highest stacking value');
 for(const [name,value] of [['#rs-root',z('#rs-root')],['#rs-input-cover',z('#rs-input-cover')],['#rs-approve',z('#rs-approve')]])assert(value&&value<hostZ,name+' stays below the clarification panel');
 assert.match(main,/provider: \(\) => P\.displayName, mount: \(\) => document\.documentElement,/,'the panel mounts beside the cover and #rs-root, not inside <body>');
 assert.match(main,/A\.waitingForClarification \|\|\s*\(P\.overlayBlocking && P\.overlayBlocking\(\)\)/,'the Agent is working cover hides while a question waits');
 assert.match(main,/blocked:\(\)=> !!A\.waitingForClarification \|\|/,'the Tasks button and checklist hide while a question waits');
 assert.match(main,/overlay\.append\(style, wrap\); document\.documentElement\.append\(overlay\);/,'the screenshot viewer uses the same root layer');
 // Default mount (no mount callback) is the root element too.
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.eval(clarSource+';window.Clarify=synerixcodeClarification;');
 const c=w.Clarify.create({document:w.document,context:()=>'k',provider:()=>'Notion AI',mount:()=>null});
 const pending=c.request({question:'Moon unlock?',options:[{id:'a',label:'A',scope:'a'},{id:'b',label:'B',scope:'b'}],recommended_id:'b',recommendation:'why',questions:['What happens?']});pending.catch(()=>{});
 const host=w.document.getElementById('rs-clarification-host');assert.equal(host.parentElement,w.document.documentElement);c.cancel();
 // Real browser check when Playwright and Chromium are available locally.
 let chromium=null;try{({chromium}=require('playwright'));}catch{}
 const executable=['/usr/local/bin/chromium','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p));
 if(chromium&&executable){
  const browser=await chromium.launch({executablePath:executable,args:['--no-sandbox']});
  try{for(const bodyCss of ['','position:relative;z-index:0','transform:translateZ(0)','position:fixed;inset:0;z-index:1','isolation:isolate']){
   const page=await browser.newPage({viewport:{width:800,height:950}});
   await page.setContent(`<html><head><style>${css}</style></head><body style="margin:0;${bodyCss}"><div style="height:2000px">page</div></body></html>`);
   await page.addScriptTag({content:clarSource});
   const hit=await page.evaluate(async()=>{
    const root=document.createElement('div');root.id='rs-root';document.documentElement.appendChild(root);
    const tab=document.createElement('button');tab.id='rs-checklist-show';tab.style.cssText='position:fixed;right:70px;bottom:320px;width:94px;height:36px';root.append(tab);
    const cover=document.createElement('div');cover.id='rs-input-cover';cover.style.cssText='display:flex;left:150px;top:820px;width:640px;height:100px';document.documentElement.appendChild(cover);
    synerixcodeClarification.create({document,context:()=>'k',provider:()=>'AI',mount:()=>document.documentElement}).request({question:'Q?',options:[{id:'a',label:'A',scope:'a'},{id:'b',label:'B',scope:'b'}],recommended_id:'b',recommendation:'why',questions:['Q?']}).catch(()=>{});
    await new Promise(r=>setTimeout(r,300));const host=document.getElementById('rs-clarification-host');
    const top=(el,dx,dy)=>{const r=el.getBoundingClientRect(),e=document.elementFromPoint(r.left+dx,r.top+dy);return e===host||host.contains(e);};
    return top(cover,320,50)&&top(tab,20,10);
   });
   assert(hit,'panel is on top with body style "'+bodyCss+'"');await page.close();
  }}finally{await browser.close();}
  console.log('1.24.13 dialog layer: panel stays above the cover and Tasks button (browser verified)');
 }else console.log('1.24.13 dialog layer: panel stays above the cover and Tasks button (browser check skipped: no Playwright/Chromium)');
})().catch(error=>{console.error(error);process.exit(1);});
