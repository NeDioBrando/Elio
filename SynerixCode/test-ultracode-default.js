const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
let level='default';const ctx=vm.createContext({window:{__rsThinkingLevel:()=>level},console});
vm.runInContext(fs.readFileSync('core/ultracode.js','utf8')+'\n'+fs.readFileSync('core/config.js','utf8')+'\nthis.RS=RS;',ctx);
for(const engine of ['roblox','local']){
 for(const selected of ['default','low','mid','high','max']){level=selected;assert(!ctx.RS.buildSystemPrompt({engine}).includes('ULTRA —'));}
 level='ultracode';const prompt=ctx.RS.buildSystemPrompt({engine});assert(prompt.includes('ULTRA —'));assert(prompt.includes('THINK=ultracode'));assert(prompt.includes('smallest complete change'));
 if(engine==='roblox'){for(const name of ['server-authority','docs-lookup','toolbox','project-layout','map-placement','tunables-config','remote-events','roblox-gotchas','review-for-exploits','report-what-you-verified'])assert(prompt.includes('Skill: '+name));assert(prompt.includes('synerixcode CAN inspect and test'));assert(!prompt.includes('You cannot run Studio from here'));}
 else assert(!prompt.includes('Skill: map-placement'));
 level='default';assert(!ctx.RS.buildSystemPrompt({engine}).includes('ULTRA —'));
}
const manifest=JSON.parse(fs.readFileSync('manifest.json'));
for(const item of manifest.content_scripts.filter(s=>s.js.includes('core/config.js')))assert(item.js.indexOf('core/ultracode.js')<item.js.indexOf('core/config.js'));
for(const path of ['popup.html','agent/src/desktop.html']){
 const dom=new JSDOM(fs.readFileSync(path,'utf8'));const select=[...dom.window.document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='ultracode'));assert(select);assert.equal(select.options[select.selectedIndex+5]?.value,'ultracode');const options=[...select.options];assert.equal(options[options.findIndex(o=>o.value==='max')+1].textContent,'Ultra');dom.window.close();
}
const desktop=fs.readFileSync('agent/src/desktop.html','utf8');assert(!desktop.includes('<option value="solar">'));assert(!desktop.includes('data-desktop-palette="solar"'));assert(!desktop.includes('synerixcode Orange'));
const dom=new JSDOM(desktop),d=dom.window.document,style=d.documentElement.style;
const begin=desktop.indexOf('  var Desktopthemes ='),end=desktop.indexOf('  function Saveappearance()',begin);
const box=vm.createContext({document:d,Byid:id=>d.getElementById(id)});vm.runInContext(desktop.slice(begin,end),box);
for(const theme of ['default','solar']){const value=box.Applyappearance({theme,glow:'strong',gradients:'off'});assert.equal(value.theme,'default');assert.equal(style.getPropertyValue('--orange'),'#e9ba53');assert.equal(d.documentElement.dataset.desktopTheme,'default');assert.equal(value.glow,'strong');assert.equal(value.gradients,'off');}
box.Applyappearance({theme:'cyan'});assert.equal(style.getPropertyValue('--orange'),'#27c1e7');dom.window.close();
const popup=fs.readFileSync('popup.js','utf8'),a=popup.indexOf('const POPUP_PALETTES'),b=popup.indexOf('const ENGINE_KEY',a),vars={},root={dataset:{},style:{setProperty:(k,v)=>vars[k]=v}},p=vm.createContext({document:{documentElement:root}});vm.runInContext(popup.slice(a,b),p);p.applyPopupAppearance({theme:'solar',glow:'strong',gradients:'off'});assert.equal(root.dataset.palette,'default');assert.equal(vars['--accent'],'#e9ba53');assert.equal(root.dataset.glow,'strong');
console.log('PASS Ultracode activation/deactivation, engine-aware instructions, all dropdowns/load order, new Default theme and Solar Dusk migration.');
// Every shipped extension entry point receives the same UI and mode hooks.
for(const path of ['popup.js','popup.html','overlay.css'])assert.equal(fs.readFileSync('synerixcode-Extension/'+path,'utf8'),fs.readFileSync(path,'utf8'));
const main=fs.readFileSync('core/main.js','utf8'),hooks=main.match(/window\.__rsThinkingLevel = \(\) => thinkingLevel;[^;]+;/g);assert.equal(hooks.length,5);
const appearanceDom=new JSDOM(desktop),appearanceRoot=appearanceDom.window.document.documentElement;
appearanceRoot.dataset.desktopTheme='cyan';
const appearanceCtx=vm.createContext({document:appearanceDom.window.document,window:{},thinkingLevel:'ultracode'});
for(const hook of hooks){vm.runInContext(hook,appearanceCtx);assert.equal(appearanceRoot.dataset.rsThinking,'ultracode');assert.equal(appearanceRoot.dataset.desktopTheme,'cyan');appearanceCtx.thinkingLevel='max';vm.runInContext(hook,appearanceCtx);assert.equal(appearanceRoot.dataset.rsThinking,'max');appearanceCtx.thinkingLevel='ultracode';}
appearanceDom.window.close();
for(const [path,prefix] of [['agent/src/desktop.html','data-desktop'],['popup.html','data'],['overlay.css','data-rs']]){const css=fs.readFileSync(path,'utf8');assert(css.includes(prefix+'-thinking=ultracode'));assert(css.includes(prefix+'-glow=off'));assert(css.includes(prefix+'-gradients=off'));}
console.log('PASS selected-only purple appearance hooks and packaged popup/style parity.');
