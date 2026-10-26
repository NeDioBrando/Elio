// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=__dirname,read=n=>fs.readFileSync(path.join(root,n),'utf8');
const card=JSON.parse(read('agent/src/vfx-studio-skill-index.json'));
assert.equal(card.id,'builtin-vfx-studio');assert.equal(card.enabled,true);assert.equal(card.confirmed,false);
let count=0;function mirror(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=dir+'/'+entry.name;if(entry.isDirectory())mirror(name);else{assert.equal(read(name),read('elio-Extension/'+name),name);count++;}}}
mirror('starter-skills/vfx-studio');
for(const n of ['main.js','skills-ui.js'])assert.equal(read('core/'+n),read('elio-Extension/core/'+n));
const main=read('core/main.js');assert(main.includes('"id":"builtin-vfx-studio"'));assert(main.includes('motion scans do not browse the private library'));
assert(read('core/skills-ui.js').includes('VFX Studio (library-first'));
const skill=read('starter-skills/vfx-studio/SKILL.md');assert(skill.includes('135581141962270'));assert(skill.includes('motion_bundle_copy'));assert(skill.includes('never browses the plugin library'));
assert(read('starter-skills/vfx-studio/references/sources.md').includes('AI for demonstration'));
const native=read('agent/src/skills.rs');assert(native.includes('vfx_studio_pack_version'));assert(native.includes('s.id!=crate::vfx_studio_skill::ID'));assert(native.includes('!data.deleted.contains_key(&card.id)&&!data.suppressed.contains(&card.id)'));
assert(read('Build-Windows.ps1').includes('test_vfx_studio_luau.mjs'));assert(read('tools/package_windows.py').includes('VFX-STUDIO-RU.md'));
const acorn=require('acorn');for(const n of ['main.js','skills-ui.js'])acorn.parse(read('core/'+n),{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
console.log(`PASS VFX Studio integration: ${count} mirrored resources, visible card, scoped native/context wiring, packaging/build hooks, JS syntax; no asset library bundled.`);

(async()=>{
 const {JSDOM}=require('jsdom');const d=new JSDOM('<div id="host"></div>',{url:'http://localhost',runScripts:'outside-only'});const w=d.window;w.TextEncoder=TextEncoder;
 try{
  w.eval(read('core/skills-ui.js')+';window.ui=elioSkillsUI;');const calls=[];
  const api=async req=>{calls.push(req);if(req.action==='list')return{ok:true,skills:[card]};if(req.action==='export')return{ok:true,skill:card};if(req.action==='read')return{ok:true,skill:card,bundle:{content:'# VFX Studio\nLibrary first',next_offset:null}};if(req.action==='list_deleted')return{ok:true,skills:[],trash_revision:0};throw Error('Unexpected request '+req.action);};
  const host=w.document.getElementById('host'),page=w.ui.mount(host,api,async()=>{throw Error('No task should run');},()=>({}),async()=>{},async()=>({tasks:[]}));
  await page.refresh();const button=host.querySelector('[data-sk-card="builtin-vfx-studio"]>.softbtn');assert(button,'base skill visible at ordinary effort');button.click();await new Promise(r=>setTimeout(r,20));assert.equal(host.querySelector('[data-sk="detail-source"]').textContent,'Built-in Elio skill');
  const readButton=host.querySelector('[data-sk="read"]');assert.equal(readButton.hidden,false);readButton.click();await new Promise(r=>setTimeout(r,20));assert.match(host.querySelector('[data-sk="instructions"]').textContent,/VFX Studio/);assert.equal(calls.filter(r=>r.action==='read').length,1);assert.equal(calls.filter(r=>r.action==='save').length,0);
  console.log('PASS VFX actual skill UI: ordinary-effort visibility, built-in label, read instructions, zero automatic saves or task execution.');
 }finally{w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
