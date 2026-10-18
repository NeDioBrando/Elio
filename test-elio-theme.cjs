// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,p),'utf8');
async function main(){
 const attrs={},root={dataset:{},hasAttribute:()=>false};let change,stored='dark',written;
 const ctx={document:{documentElement:root},elioI18n:{t:x=>'translated '+x,onChange:()=>{}},chrome:{storage:{local:{get:(k,cb)=>cb({rsColorMode:stored}),set:async v=>{written=v}},onChanged:{addListener:f=>change=f}}}};
 vm.createContext(ctx);vm.runInContext(read('core/theme.js'),ctx);const theme=ctx.elioTheme;
 assert.equal(theme.mode,'dark');const button={isConnected:true,classList:{add:()=>{}},setAttribute:(k,v)=>attrs[k]=v};theme.mountBrowser(button);assert.equal(attrs['aria-pressed'],'true');assert.match(button.innerHTML,/<circle/);
 await button.onclick();assert.equal(written.rsColorMode,'light');assert.equal(root.dataset.elioMode,'light');assert.match(button.innerHTML,/<path/);assert.equal(attrs['aria-label'],'translated Switch to dark theme');assert.equal(button.disabled,false);
 change({rsColorMode:{newValue:'dark'}},'local');assert.equal(theme.mode,'dark');change({rsColorMode:{newValue:'light'}},'sync');assert.equal(theme.mode,'dark');
 theme.mount(button,async()=>{throw Error('offline')});await button.onclick();assert.equal(theme.mode,'dark');assert.match(button.title,/Could not save theme.*offline/);assert.equal(button.disabled,false);theme.apply('invalid');assert.equal(theme.mode,'dark');theme.apply('light');
 let release;theme.mount(button,()=>new Promise(r=>release=r));const pending=button.onclick();assert.equal(button.disabled,true);assert.equal(theme.mode,'dark');release();await pending;assert.equal(button.disabled,false);
 // Fresh extension defaults to dark, but explicitly stored light still wins.
 for(const saved of [undefined,'light','dark']){
  const nativeRoot={dataset:{},hasAttribute:()=>true};let storedNative=saved;
  const native={document:{documentElement:nativeRoot},localStorage:{getItem:()=>storedNative,setItem:(k,v)=>{storedNative=v}}};
  vm.createContext(native);vm.runInContext(read('core/theme.js'),native);
  assert.equal(native.elioTheme.mode,saved==='light'?'light':'dark');
  const extension={document:{documentElement:{dataset:{},hasAttribute:()=>false}},chrome:{storage:{local:{get:(k,cb)=>cb({rsColorMode:saved})},onChanged:{addListener:()=>{}}}}};
  vm.createContext(extension);vm.runInContext(read('core/theme.js'),extension);assert.equal(extension.elioTheme.mode,saved==='light'?'light':'dark');
 }
 for(const f of fs.readdirSync(require('node:path').join(__dirname,'core/locales'))){const d=JSON.parse(read('core/locales/'+f));for(const k of ['Switch to dark theme','Switch to light theme','Could not save theme'])assert.equal(typeof d[k],'string',f+': '+k);}
 for(const p of ['core/theme.css','core/theme.js'])assert.equal(read(p),read('elio-Extension/'+p));
 for(const p of ['manifest.json','elio-Extension/manifest.json'])for(const entry of JSON.parse(read(p)).content_scripts.filter(e=>e.js?.includes('core/main.js'))){assert(entry.js.includes('core/theme.js'));assert(entry.css.includes('core/theme.css'));}
 assert(read('background.js').includes('"rsColorMode"'));assert.equal((read('agent/src/main.rs').match(/include_str!\("\.\.\/\.\.\/core\/theme.js"\)/g)||[]).length,2);
 const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
 const css=read('core/theme.css'),palettes=[css.match(/:root\{([^}]+)/)[1],css.match(/html\[data-elio-mode="dark"\]\{([^}]+)/)[1]];const checks=[];
 for(const [i,p]of palettes.entries()){const t=Object.fromEntries([...p.matchAll(/--elio-([\w-]+):(#[\da-f]{6})/g)].map(m=>[m[1],m[2]]));for(const [a,b]of [['text','canvas'],['text','surface'],['muted','surface'],['on-accent','accent'],['green-text','green-bg'],['error-text','error-bg'],['warn-text','warn-bg']]){const la=luminance(t[a]),lb=luminance(t[b]),ratio=(Math.max(la,lb)+.05)/(Math.min(la,lb)+.05);assert(ratio>=4.5,`${i?'dark':'light'} ${a}/${b}: ${ratio}`);checks.push(`${i?'dark':'light'} ${a}/${b} ${ratio.toFixed(2)}:1`);}}
 console.log('PASS theme: persisted browser storage, cross-tab updates, SVG/ARIA, delayed save, failed-save rollback, 15 locales, embed/parity, representative AA text pairs');console.log(checks.join('; '));
}
main().catch(e=>{console.error(e);process.exitCode=1});
