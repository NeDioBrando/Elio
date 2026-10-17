const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('agent/src/desktop.html','utf8');
const dom=new JSDOM(html);const document=dom.window.document;
const begin=html.indexOf('  var Desktopthemes =');const end=html.indexOf('  function Saveappearance()',begin);
const c={document,Byid:id=>document.getElementById(id)};vm.createContext(c);vm.runInContext(html.slice(begin,end),c);
const main=fs.readFileSync('core/main.js','utf8');const b=main.indexOf('  const SYNERIXCODE_PALETTES =');const e=main.indexOf('  let synerixcodeTheme =',b);
const browser={document,SYNERIXCODE_THEMES:{},synerixcodeTheme:'night'};vm.createContext(browser);vm.runInContext(main.slice(b,e),browser);
const rust=fs.readFileSync('agent/src/preferences.rs','utf8');
const themes=['default','amethyst','cyan','rose','emerald','graphite','crimson','ocean','copper','aurora','orchid'];
for(const theme of themes){
 const result=vm.runInContext(`Applyappearance({theme:'${theme}',glow:'off',gradients:'off'})`,c);
 assert.equal(result.theme,theme);assert.equal(document.documentElement.dataset.desktopTheme,theme);
 assert.equal(document.getElementById('desktopTheme').value,theme);
 assert(rust.includes('"'+theme+'"'),'native preference accepts '+theme);
 vm.runInContext(`applySharedAppearance({theme:'${theme}',glow:'off',gradients:'off'})`,browser);
 assert.equal(document.documentElement.dataset.rsPalette,theme);
 assert.equal(document.documentElement.style.getPropertyValue('--theme-glow'),'0');
 assert.equal(document.documentElement.style.getPropertyValue('--pc-glow-strength'),'0');
 if(theme!=='crimson')assert.equal(document.querySelector(`[data-desktop-palette="${theme}"]`).getAttribute('aria-pressed'),'true');
}
assert.equal(vm.runInContext('Applyappearance({theme:"missing"}).theme',c),'default');
assert.equal(vm.runInContext('Applyappearance({theme:"solar"}).theme',c),'default');
vm.runInContext('applySharedAppearance({theme:"solar"})',browser);assert.equal(document.documentElement.dataset.rsPalette,'default');
assert(html.includes('animation:none!important;transition:none!important'));
assert(!html.slice(html.indexOf('/* Workspace refinement')).split('</style>')[0].replace('animation:pc-ultra-shine 3.2s linear infinite','').includes('infinite'),'only the explicitly requested Ultra label shine repeats');
assert.equal(fs.readFileSync('synerixcode-Extension/core/main.js','utf8'),main);
if(process.env.SYNERIXCODE_DESIGN_BASELINE){
 const before=fs.readFileSync(process.env.SYNERIXCODE_DESIGN_BASELINE,'utf8');
 const script=x=>x.replace(/\r\n/g,'\n').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/  var Desktopthemes = \{[\s\S]*?\n  \};/,'THEMES');
 assert.equal(script(html),script(before),'desktop behavior outside theme definitions preserved');
 const ids=x=>[...new JSDOM(x).window.document.querySelectorAll('[id]')].filter(n=>!n.closest('.supported-ai-logo')).map(n=>n.id).sort();
 assert.deepStrictEqual(ids(html),ids(before),'existing UI IDs preserved');
 const routes=x=>[...new JSDOM(x).window.document.querySelectorAll('[data-page],[data-go]')].map(n=>[n.dataset.page,n.dataset.go]);
 assert.deepStrictEqual(routes(html),routes(before),'navigation preserved');
}
console.log('Design upgrade: eleven themes synchronize and legacy Solar Dusk becomes Default, native accepts themes, reduced motion, preserved desktop behavior and routes.');
