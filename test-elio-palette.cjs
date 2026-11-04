// SPDX-License-Identifier: GPL-3.0-or-later
// Liquid Glass palettes: every palette ships light+dark tokens, the logo follows the palette,
// the popup picker persists the choice, and unknown ids fall back to the default.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const out=process.env.ELIO_TEST_OUTPUT||process.cwd();fs.mkdirSync(out,{recursive:true});
const IDS=['aurora','ocean','amethyst','orchid','sakura','ember','crimson','emerald','graphite','linen'];
const css=fs.readFileSync(path.join(__dirname,'core/theme.css'),'utf8');
for(const id of IDS){for(const mode of ['light','dark']){assert.ok(css.includes('data-elio-palette="'+id+'"')||css.includes("data-elio-palette='"+id+"'")||css.includes('data-elio-palette='+id),'palette '+id+' defined');}assert.ok(css.includes('data-elio-swatch="'+id+'"'),'swatch '+id);}
assert.equal(fs.readFileSync(path.join(__dirname,'core/theme.css'),'utf8'),fs.readFileSync(path.join(__dirname,'elio-Extension/core/theme.css'),'utf8'),'extension theme.css mirrors core');
assert.equal(fs.readFileSync(path.join(__dirname,'core/theme.js'),'utf8'),fs.readFileSync(path.join(__dirname,'elio-Extension/core/theme.js'),'utf8'),'extension theme.js mirrors core');
for(const f of ['popup.html','popup.js','background.js'])assert.equal(fs.readFileSync(path.join(__dirname,f),'utf8'),fs.readFileSync(path.join(__dirname,'elio-Extension',f),'utf8'),f+' mirrors');
const desktop=fs.readFileSync(path.join(__dirname,'agent/src/desktop.html'),'utf8');
assert.ok(desktop.includes('id="desktopPalettePicker"')&&desktop.includes('elioBrandLogo')&&desktop.includes('rsPalette'),'desktop exposes palette picker, dynamic logo and rsPalette');
assert.ok(fs.readFileSync(path.join(__dirname,'agent/src/preferences.rs'),'utf8').includes('rsPalette'),'rust preferences persist rsPalette');
assert.ok(fs.readFileSync(path.join(__dirname,'background.js'),'utf8').includes('"rsPalette"'),'palette syncs between desktop and extension');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:400,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{const tabs=[{id:1,active:true,url:'https://chatgpt.com/c/mock'}];const result=(v,cb)=>{if(cb)cb(v);return Promise.resolve(v)};window.mockStorage={rsLanguage:'en'};window.chrome={runtime:{getManifest:()=>({version:'1.0.1'}),getURL:p=>'http://elio.test/'+p,onMessage:{addListener:()=>{}},sendMessage:(m,cb)=>result({ok:true,connected:true,tools:1,servers:[],engine:'roblox',update:{current:'1.0.1',phase:'current'}},cb)},tabs:{query:(o,cb)=>result(tabs,cb),create:()=>{},update:()=>{},sendMessage:()=>Promise.resolve({ok:true})},storage:{local:{get:(k,cb)=>result(window.mockStorage,cb),set:async v=>Object.assign(window.mockStorage,v)},onChanged:{addListener:()=>{}}}};});
await page.route('http://elio.test/**',r=>{const file=path.join(__dirname,new URL(r.request().url()).pathname);if(!fs.existsSync(file))return r.fulfill({status:404,body:''});return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'image/png'});});
await page.goto('http://elio.test/popup.html');await page.waitForTimeout(800);
const html=page.locator('html');
assert.equal(await html.getAttribute('data-elio-palette'),'aurora','default palette is aurora');
await page.locator('#settings-card>summary').click();
const buttons=page.locator('#popup-palette-picker .elio-swatch');assert.equal(await buttons.count(),IDS.length,'popup picker lists every palette');
const logo=()=>page.evaluate(()=>{const s=getComputedStyle(document.querySelector('.crest.elio-logo'));return s.getPropertyValue('--lg-logo-1').trim()+'|'+s.getPropertyValue('--lg-logo-2').trim();});
const seen=new Set();
for(const id of IDS){await page.evaluate(i=>elioTheme.applyPalette(i),id);assert.equal(await html.getAttribute('data-elio-palette'),id);const l=await logo();assert.ok(l.length>3,'logo gradient defined for '+id);seen.add(l);const accent=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--elio-accent').trim());assert.ok(accent,'accent token for '+id);}
assert.equal(seen.size,IDS.length,'every palette has a distinct logo gradient');
await page.evaluate(()=>elioTheme.applyPalette('not-a-palette'));assert.equal(await html.getAttribute('data-elio-palette'),'aurora','unknown palette falls back');
await page.locator('#popup-palette-picker .elio-swatch').nth(5).click();await page.waitForTimeout(200);
assert.equal(await page.evaluate(()=>window.mockStorage.rsPalette),IDS[5],'picker persists rsPalette');assert.equal(await html.getAttribute('data-elio-palette'),IDS[5]);
await page.screenshot({path:path.join(out,'elio-palette-popup.png'),fullPage:true});
assert.deepEqual(errors,[]);
console.log('PASS Elio palettes: '+IDS.length+' palettes, logo follows palette, popup picker persists rsPalette, desktop/extension mirrors in sync.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
