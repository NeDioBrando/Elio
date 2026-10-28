// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=__dirname,read=n=>fs.readFileSync(path.join(root,n),'utf8');
const card=JSON.parse(read('agent/src/emitter2d-skill-index.json'));
assert.equal(card.id,'builtin-emitter2d');assert.equal(card.enabled,true);assert.equal(card.confirmed,false);
let count=0;function mirror(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=dir+'/'+entry.name;if(entry.isDirectory())mirror(name);else{assert.equal(read(name),read('elio-Extension/'+name),name);count++;}}}
mirror('starter-skills/emitter2d');
for(const n of ['main.js','skills-ui.js'])assert.equal(read('core/'+n),read('elio-Extension/core/'+n));
const main=read('core/main.js');assert(main.includes('"id":"builtin-emitter2d"'));assert(main.includes('EMITTER2D ROUTING'));
assert(read('core/skills-ui.js').includes('Emitter2D'));
const skill=read('starter-skills/emitter2d/SKILL.md');assert(skill.includes('9544897050'));assert(skill.includes('observed attribute')||skill.includes('Attribute serialization'));assert(skill.includes('private plugin state'));
assert(read('starter-skills/emitter2d/references/sources.md').includes('devforum.roblox.com'));
const native=read('agent/src/skills.rs');assert(native.includes('emitter2d_pack_version'));assert(native.includes('s.id!=crate::emitter2d_skill::ID'));assert(native.includes('!data.deleted.contains_key(&card.id)&&!data.suppressed.contains(&card.id)'));
assert(read('Build-Windows.ps1').includes('test_emitter2d_luau.mjs'));assert(read('tools/package_windows.py').includes('EMITTER2D-RU.md'));
const acorn=require('acorn');for(const n of ['main.js','skills-ui.js'])acorn.parse(read('core/'+n),{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
console.log(`PASS Emitter2D integration: ${count} mirrored resources, visible card, scoped native/context wiring, packaging/build hooks, JS syntax; no asset library bundled.`);

(async()=>{
 const {JSDOM}=require('jsdom');const d=new JSDOM('<div id="host"></div>',{url:'http://localhost',runScripts:'outside-only'});const w=d.window;w.TextEncoder=TextEncoder;
 try{
  w.eval(read('core/skills-ui.js')+';window.ui=elioSkillsUI;');const calls=[];
  const api=async req=>{calls.push(req);if(req.action==='list')return{ok:true,skills:[card]};if(req.action==='export')return{ok:true,skill:card};if(req.action==='read')return{ok:true,skill:card,bundle:{content:'# Emitter2D\nLibrary first',next_offset:null}};if(req.action==='list_deleted')return{ok:true,skills:[],trash_revision:0};throw Error('Unexpected request '+req.action);};
  const host=w.document.getElementById('host'),page=w.ui.mount(host,api,async()=>{throw Error('No task should run');},()=>({}),async()=>{},async()=>({tasks:[]}));
  await page.refresh();const button=host.querySelector('[data-sk-card="builtin-emitter2d"]>.softbtn');assert(button,'base skill visible at ordinary effort');button.click();await new Promise(r=>setTimeout(r,20));assert.equal(host.querySelector('[data-sk="detail-source"]').textContent,'Built-in Elio skill');
  const readButton=host.querySelector('[data-sk="read"]');assert.equal(readButton.hidden,false);readButton.click();await new Promise(r=>setTimeout(r,20));assert.match(host.querySelector('[data-sk="instructions"]').textContent,/Emitter2D/);assert.equal(calls.filter(r=>r.action==='read').length,1);assert.equal(calls.filter(r=>r.action==='save').length,0);
  console.log('PASS Emitter2D actual skill UI: ordinary-effort visibility, built-in label, read instructions, zero automatic saves or task execution.');
 }finally{w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

// Execute actual catalogue builder and actual dispatch/policy blocks rather than string-only checks.
{
 const vm=require('node:vm'),ast=acorn.parse(main,{ecmaVersion:'latest'}),fns={};
 function visit(n){if(!n?.type)return;if(n.type==='FunctionDeclaration')fns[n.id.name]=main.slice(n.start,n.end);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v?.type)visit(v);}}visit(ast);
 const box={engine:'roblox'};vm.createContext(box);vm.runInContext(read('core/studio_skills.js')+';globalThis.skills=RobloxScriptSkills;',box);box.activeEngine=()=>box.engine;
 vm.runInContext(fns.pluginDiscoveryTools,box);const tools=vm.runInContext('pluginDiscoveryTools()',box);assert.deepEqual(Array.from(tools,t=>t.name),['plugin_list','plugin_inspect']);assert.equal(tools[1].inputSchema.properties.path_segments.items.type,'string');assert.equal(tools[0].inputSchema.properties.studio_id.type,'string');box.engine='local';assert.equal(vm.runInContext('pluginDiscoveryTools()',box).length,0);box.engine='roblox';
 const a=main.indexOf('    if (typeof RobloxScriptSkills !== "undefined" && RobloxScriptSkills.SKILL_OPS.includes(name)) {',main.indexOf('// ── Virtual Studio Skills'));
 const b=main.indexOf('    const BLENDER_OPS',a);assert(a>0&&b>a);const sent=[];Object.assign(box,{name:'plugin_list',args:{studio_id:'actual-fixture-studio'},createCheckpoint(){},persistSession(){},bumpPerf(){},showSuggestion(){},runTool:async call=>{sent.push(call);return '{"ok":true}';}});
 const pa=main.indexOf('    if (/^(?:Read-only mode|Allowed-folder mode'),pb=main.indexOf('    if (name === "execute_luau")',pa);assert(pa>0&&pb>pa);
 (async()=>{await vm.runInContext('(async()=>{'+main.slice(a,b)+'})()',box);assert.equal(sent.length,1);assert.equal(sent[0].arguments.studio_id,'actual-fixture-studio');assert.equal(sent[0].arguments.datamodel_type,'Edit');assert(sent[0].arguments.code.includes('plugin_list'));
 for(const error of ['Read-only mode blocked execute_luau','Safety confirmation required. No command was executed.','Path is outside allowed folders: x']){box.r={error};const text=vm.runInContext('(()=>{'+main.slice(pa,pb)+'})()',box);assert.match(text,/access-policy block/);assert(!text.includes('Check your Lua syntax'));}
 console.log('PASS actual plugin catalogue, engine scope, generated helper dispatch/studio targeting, access-policy error classification.');})().catch(e=>{console.error(e);process.exitCode=1;});
}
