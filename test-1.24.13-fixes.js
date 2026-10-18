const assert=require('node:assert/strict'),fs=require('fs'),Activity=require('./core/activity');
const read=name=>fs.readFileSync(name,'utf8');
// Task checklist: summarised steps instead of the user's own sentences.
const src=read('core/activity.js').replace('return { create,','return { requestSteps, create,');
const box={exports:{}};new Function('module',src+'\nreturn module')(box);
const A=box.exports;
assert.deepEqual(A.requestSteps(`1. Your first task will be fixing a weapon
2. It works fine as a weapon but the model is invisible
3. So I want you to see if you can fix the model? Check how the other weapons are rigged etc
4. It's called Muramasa`),['Fix Muramasa weapon','Fix invisible model','Check how the other weapons are rigged']);
assert.deepEqual(A.requestSteps('Please build a shop UI and then add a coin counter. Also fix the lag in the lobby.'),['Build a shop UI','Add a coin counter','Fix the lag in the lobby']);
const activity=Activity.create();activity.sync(true,'chat',1);
activity.task('1. Your first task will be fixing a weapon\n2. It works fine as a weapon but the model is invisible','k');
assert.equal(activity.active().taskLabel,'Planning project work','the AI names the task, the raw request is never the title');
assert(!activity.active().plan.items.some(item=>/\bI want you\b|first task will/i.test(item.label)));
// AgentScript card: the local server reports its real tool count.
const bg=read('background.js');
assert(bg.includes('alive:localReady,tools:localReady ? localTools().length : 0'));
assert(!bg.includes('alive:localReady,tools:0}'));
// Startup handshake: every provider gets the single correction and extra calls do not fail it.
const main=read('core/main.js');
assert(main.includes('elio startup check: reply with exactly one fenced json code block'));
assert(!main.includes('if (P.id === "notion" && listRes.kind === "text" && !isProviderPolicyRefusal'));
assert(main.includes('listRes.calls.find((c) => c && (c.tool === "list_commands"'));
// Studio access reminder for paste-a-script replies.
assert(main.includes('STUDIO_ACCESS_REMINDER')&&main.includes('looksLikePasteScript'));
assert(main.includes('send.retryStuckDraft'));
assert(main.includes('elio connection: ${cur === "local"'));
// The system prompt asks for short imperative labels.
assert(read('core/config.js').includes('at most 8 words')&&read('core/config.js').includes('Goal: <what you will do'));
// Both extension copies stay in sync.
for(const file of ['core/main.js','core/activity.js','core/config.js','background.js'])assert.equal(read(file),read('elio-Extension/'+file),file+' copies are in sync');
// Native agent: reactor panics relaunch, add-ons start concurrently and never block Studio.
const rust=read('agent/src/main.rs'),addons=read('agent/src/mcp_addons.rs');
assert(rust.includes('fn is_reactor_resource_panic')&&rust.includes('fn relaunch_after_crash'));
assert(rust.includes('async fn addon_snapshot')&&rust.includes('addon_cache'));
assert(addons.includes('futures::future::join_all(self.runtimes.iter_mut()'));
console.log('PASS 1.24.13: checklist summaries, local tool count, handshake correction, Studio reminder, stuck-draft resend, add-on startup and crash relaunch');
// 1.24.13 test build 2: Notion startup keeps the exact 1.24.12 checklist wording and
// the stuck-draft resend never runs during startup or after an ambiguous click.
assert(read('core/config.js').includes('(opts.providerId === "notion" ? "" : "Write each label'));
assert(/const draftStuck = !A\.stop && !A\.starting && [^\n]*\n\s*!\(P\.sendFailureAmbiguous && P\.sendFailureAmbiguous\(\)\)/.test(read('core/main.js')));
console.log('test-1.24.13-fixes.js test-build-2 PASS');
// 1.24.13 test build 3: AgentScript lists Blender and its own tool count; every Studio
// probe path shares the 3-miss rule; Claude never clicks a guessed button.
assert(bg.includes('servers: mode === "local" ? blenderServers([{id:"local"'));
assert(bg.includes('tools: mergeBlenderTools(mode === "local" ? localTools() : toolsCache).length'));
{
  const rs=read('agent/src/main.rs');
  assert(rs.includes('fn studio_probe_result(&self, probe: &anyhow::Result<()>) -> bool'));
  assert.equal((rs.match(/mcp\.probe_studio\(\)\.await\.is_ok\(\)/g)||[]).length,0,'a probe path bypasses the shared miss rule');
}
assert(!/return buttons\[buttons\.length - 1\]/.test(read('providers/claude.js')));
console.log('test-1.24.13-fixes.js test-build-3 PASS');
