// SPDX-License-Identifier: GPL-3.0-or-later
// Local HTML only. Measures retained JS/DOM heap after forced GC, not Windows/WebView2 RSS.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'chromium',args:['--no-sandbox']});const results=[];
try{for(const [label,root] of [['before',process.env.ELIO_AUDIT_BASELINE||'/data/Elio-vfx-studio'],['after',path.resolve(__dirname,'..')]]){
 const page=await browser.newPage();await page.setContent('<html><head></head><body></body></html>');await page.evaluate(()=>{window.elioLocaleData={en:{Settings:'Settings',Home:'Home'},ru:{Settings:'Настройки',Home:'Дом'}};});await page.addScriptTag({content:fs.readFileSync(root+'/core/i18n.js','utf8')});
 const session=await page.context().newCDPSession(page);async function measure(){await session.send('HeapProfiler.collectGarbage');return session.send('Runtime.getHeapUsage');}const samples=[await measure()];
 for(let round=0;round<3;round++){
  await page.evaluate(async()=>{for(let i=0;i<100;i++){const host=document.createElement('section');host.innerHTML='<button title="Settings">Home</button>'.repeat(30);document.body.append(host);elioI18n.mountStatic(host);host.remove();if(i%10===0)await new Promise(r=>setTimeout(r,0));}await new Promise(r=>setTimeout(r,0));});samples.push(await measure());
 }
 const growth=samples.at(-1).usedSize-samples[0].usedSize;results.push({label,removed_roots:300,buttons_per_root:30,samples,growth_bytes:growth});await page.close();
}assert(results[1].growth_bytes<results[0].growth_bytes/3,'removed UI retention should materially decrease');assert(results[1].growth_bytes<4*1024*1024,'candidate heap should return close to baseline after GC');
const output=process.env.ELIO_AUDIT_OUTPUT||'/data/audit-browser-memory.json';fs.writeFileSync(output,JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(x=>({label:x.label,growth_bytes:x.growth_bytes}))))
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
