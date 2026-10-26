// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const card=JSON.parse(fs.readFileSync('agent/src/eclipse-skill-index.json','utf8'));
let checks=0;const check=(fn)=>{fn();checks++;};
(async()=>{
check(()=>{assert.equal(card.id,'builtin-eclipse-animator');assert.equal(card.domain,'roblox');assert.equal(card.enabled,true);assert.equal(card.confirmed,false);for(const s of [...card.steps,...card.pitfalls,...card.verification])assert(Buffer.byteLength(s)<=1000);});
const root='starter-skills/eclipse-animator/';const resources=['SKILL.md','NOTICE.txt','references/craft.md','references/joints.md','scripts/build_sequence.luau','scripts/inspect_pose.luau','upstream/SKILL.md','upstream/scripts/build_sequence.luau','upstream/scripts/inspect_pose.luau'];
check(()=>{for(const r of resources){assert(fs.statSync(root+r).size>0);assert.equal(fs.readFileSync(root+r,'utf8'),fs.readFileSync('elio-Extension/'+root+r,'utf8'));assert(fs.readFileSync('agent/src/eclipse_skill.rs','utf8').includes('"'+r+'"'));}});
check(()=>{const guide=fs.readFileSync(root+'SKILL.md','utf8');for(const term of ['Blender','explicitly','FULL PC ACCESS','not proof','upstream/scripts/','baked','next_offset','permission'])assert(guide.includes(term));const original=fs.readFileSync(root+'upstream/SKILL.md','utf8');assert(original.includes('Claude'));assert(original.includes('124901669247946'));assert(guide.includes('private place/ServerStorage kit is NOT bundled'));});
check(()=>{for(const f of ['core/main.js','core/skills-ui.js'])assert.equal(fs.readFileSync(f,'utf8'),fs.readFileSync('elio-Extension/'+f,'utf8'));const main=fs.readFileSync('core/main.js','utf8');assert(main.includes('blender_available:'));assert(main.includes("if(args.action==='match')request.blender_available="));assert(main.includes('window.__rsBlender()===true'));assert(main.includes('id:builtin-eclipse-animator'));assert(main.includes('If Blender fails mid-task'));assert(main.includes('If Blender becomes unavailable during a Roblox character-animation task'));assert(main.includes('Respect user exclusions/removal'));});
const d=new JSDOM('<div id="host"></div>',{url:'http://localhost',runScripts:'outside-only'});const w=d.window;w.TextEncoder=TextEncoder;
w.eval(fs.readFileSync('core/skills-ui.js','utf8')+';window.ui=elioSkillsUI;');let reads=0;const calls=[];
const api=async req=>{calls.push(req);if(req.action==='list')return{ok:true,skills:[card]};if(req.action==='export')return{ok:true,skill:card};if(req.action==='read'){reads++;return{ok:true,skill:card,bundle:{content:'# Eclipse Animator\nConfirmed draft only',next_offset:null}};}if(req.action==='list_deleted')return{ok:true,skills:[],trash_revision:0};throw Error('unexpected API request '+req.action);};
try{
const host=w.document.getElementById('host'),page=w.ui.mount(host,api,async()=>{throw Error('No task should run');},()=>({}),async()=>{},async()=>({tasks:[]}));
await page.refresh();const button=host.querySelector('[data-sk-card="builtin-eclipse-animator"]>.softbtn');check(()=>assert(button,'base skill must be visible at ordinary effort'));
button.click();await new Promise(r=>setTimeout(r,20));check(()=>assert.equal(host.querySelector('[data-sk="detail-source"]').textContent,'Built-in Elio skill'));
const read=host.querySelector('[data-sk="read"]');check(()=>assert.equal(read.hidden,false));read.click();await new Promise(r=>setTimeout(r,20));
check(()=>{assert.equal(reads,1);assert.match(host.querySelector('[data-sk="instructions"]').textContent,/Eclipse Animator/);assert.equal(calls.filter(r=>r.action==='save').length,0);});
}finally{w.close();}
check(()=>{const build=fs.readFileSync('Build-Windows.ps1','utf8');assert(build.includes('test-eclipse.cjs'));assert(build.includes('test_eclipse_luau.mjs'));assert(fs.readFileSync('tools/package_windows.py','utf8').includes("shutil.copytree(ROOT/'elio-Extension'"));});
console.log(`PASS Eclipse integration: ${checks} checks (built-in card, complete resources/parity, Blender routing wiring, actual skill UI list/read, no automatic mutations, GitHub test registration).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
