const fs=require('fs');const {chromium}=require('playwright');
(async()=>{
 const original=fs.readFileSync('agent/src/desktop.html','utf8');
 const themeScript='function Byid(id){return document.getElementById(id)};'+original.slice(original.indexOf('  var Desktopthemes ='),original.indexOf('  function Saveappearance()'));
 const html=original.replace(/<script>[\s\S]*?<\/script>/g,'');
 const browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.setContent(html);
 await page.addScriptTag({content:themeScript});
 await page.evaluate(()=>Applyappearance({theme:'default'}));
 fs.mkdirSync('visual-checks',{recursive:true});
 for(const width of [1440,1024,760]){
  await page.setViewportSize({width,height:960});
  for(const name of ['home','settings','tools','creators']){
   await page.evaluate(name=>{document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-'+name));},name);
   await page.screenshot({animations:"disabled",path:`visual-checks/${name}-${width}.png`});
   const overflow=await page.evaluate(()=>{const n=document.getElementById('content');return n.scrollWidth>n.clientWidth+1});
   if(overflow)throw Error(`${name} overflows at ${width}`);
  }
 }
 await page.setViewportSize({width:1440,height:960});
 for(const theme of ['ocean','copper','aurora','orchid','solar']){
  await page.evaluate(theme=>{Applyappearance({theme});document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-home'));},theme);
  await page.screenshot({animations:"disabled",path:`visual-checks/theme-${theme}.png`});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 const motion=await page.locator('.page.active').evaluate(n=>getComputedStyle(n).animationName);if(motion!=='none')throw Error('Reduced motion was ignored');
 await browser.close();console.log('Visual checks: three widths, four pages, five new palettes, reduced motion passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
