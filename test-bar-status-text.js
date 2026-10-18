// 1.19.39 bar status wording.
// 1) "No agent on this chat" now says plainly what is wrong, which button fixes
//    it and which engine it connects (Roblox Studio for RS, AgentScript for AS).
// 2) While the agent loop runs, the bar names the actual step (running a tool,
//    sending the result, the site writing, waiting for the site to finish), so
//    a working agent whose native Stop already turned back into Send no longer
//    reads as a hang.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const main=fs.readFileSync(__dirname+'/core/main.js','utf8');
assert.equal(main,fs.readFileSync(__dirname+'/elio-Extension/core/main.js','utf8'),'main.js copies are in sync');
assert(!main.includes('No agent on this chat. Restart to start <b>Roblox</b>.'),'old engine-blind message is gone');
const m=/const engineName = currentEngine === "local" \? "AgentScript" : "Roblox Studio";\s*msg = `([^`]+)`;/.exec(main);
assert(m,'engine-aware no-agent message');
for(const [engine,name] of [['roblox','Roblox Studio'],['local','AgentScript']]){
 const engineName=engine==='local'?'AgentScript':'Roblox Studio';
 const text=vm.runInNewContext('`'+m[1]+'`',{engineName}).replace(/<[^>]+>/g,'');
 assert.equal(text,'Not connected to this chat yet. Click Restart Agent to connect '+name+'.');
 assert(text.length<=90,'fits the single-line status');
}
assert(/stateEl\.title = full/.test(main),'full status text stays readable on hover when ellipsized');
// Extract the real phase helper and drive it with fake agent/provider state.
const start=main.indexOf('    function loopPhaseText() {'),end=main.indexOf('    function renderBar() {',start);
assert(start>0&&end>start,'loopPhaseText present before renderBar');
const fn=vm.runInNewContext('(function(A,P){'+main.slice(start,end)+';return loopPhaseText();})');
const P=(hard)=>({displayName:'Notion AI',isHardGenerating:()=>hard,isGenerating:()=>hard});
assert.equal(fn({toolRunning:true,toolName:'get_game_tree'},P(false)),'running <b>get_game_tree</b>');
assert.equal(fn({injecting:true},P(false)),'sending the result to Notion AI');
assert.equal(fn({},P(true)),'Notion AI is writing');
assert.equal(fn({},P(false)),'waiting for Notion AI to finish','native Stop gone but loop still settling');
assert.equal(fn({waitingForClarification:true,toolRunning:true,toolName:'elio_clarify'},P(false)),'','clarification keeps its own panel');
assert.equal(fn({toolRunning:true,toolName:'<img src=x onerror=1>'},P(false)).includes('<img'),false,'tool names cannot inject markup');
assert.equal(fn({},{displayName:'Chat<GPT>',isHardGenerating:()=>{throw Error('boom');},isGenerating:()=>false}),'waiting for ChatGPT to finish','provider errors never break the bar');
assert(/if \(A\.started && A\.running && !A\.stopping && toneClass === "active"\) \{\s*const phase = loopPhaseText\(\);/.test(main),'phase only replaces healthy running text, never warnings');
console.log('Bar status: clear engine-aware "not connected" message and truthful live phase while the agent works.');
