const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('core/ultracode.js','utf8');
const context=vm.createContext({});
vm.runInContext(source+';globalThis.mode=synerixcodeUltracode;',context);
const names=['server-authority','docs-lookup','toolbox','project-layout','map-placement','tunables-config','remote-events','roblox-gotchas','review-for-exploits','report-what-you-verified'];
// Compare the actual injected method pack with the preceding full instruction
// pack, retained in this module as complete skill references.
const legacyPrompt=JSON.parse(source.match(/const prompt=("(?:[^"\\]|\\.)*");/)[1]);
const full=legacyPrompt+names.map(n=>{const s=context.mode.readSkill(n);return `Skill: ${s.name}\nWhen: ${s.use_when}\n${s.body}`;}).join('\n');
const efficient=context.mode.build('roblox');
assert(efficient.length<full.length*0.65,`${efficient.length} vs ${full.length}`);
for(const name of names){assert(efficient.includes('Skill: '+name));assert(context.mode.readSkill(name).body.length>100);}
for(const rule of ['type, range, ownership, distance/cooldown','Stop Play','Script/LocalScript/ModuleScript','world bounds','sender, server handler and receiver','timed WaitForChild','Missing target is failure','THINK=ultracode','one-command-per-reply','exact protocol handshake','uncertainty and risk','re-running passing tests without a new reason'])assert(efficient.includes(rule),rule);
assert(context.mode.turn().length<180);
assert(!context.mode.build('local').includes('Skill: map-placement'));
assert(context.mode.build('local').includes('no Studio operations'));
assert.equal(context.mode.readSkill('missing'),null);
console.log(`PASS Ultracode instruction size: ${full.length} → ${efficient.length} characters (${Math.round((1-efficient.length/full.length)*100)}% less); all ten skill references and critical checks preserved. This measures prompt overhead, not provider latency or model accuracy.`);
