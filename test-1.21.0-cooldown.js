// 1.21.0 regression: optional seconds-between-commands cooldown (DeepSeek rate limits).
// Fails on 1.20.0 because the setting, helper and send-loop wait do not exist.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = __dirname;
let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; console.log('PASS', msg); } else { failed++; console.log('FAIL', msg); } }
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

(async () => {
  const main = read('core/main.js');
  assert(main === read('synerixcode-Extension/core/main.js'), 'root and extension main.js match');
  try { new vm.Script(main, { filename: 'main.js' }); assert(true, 'main.js compiles'); } catch (e) { assert(false, 'main.js compiles: ' + e.message); }
  const bg = read('background.js');
  assert(bg === read('synerixcode-Extension/background.js'), 'root and extension background.js match');
  try { new vm.Script(bg, { filename: 'background.js' }); assert(true, 'background.js compiles'); } catch (e) { assert(false, 'background.js compiles: ' + e.message); }
  assert(/"rsContinuationOffer",\s*"rsCommandCooldown",/.test(bg), 'cooldown syncs with the desktop app');
  assert(/"rsVisualCheck",\s*"rsContinuationOffer",/.test(bg), 'existing sync order kept');
  assert(/rsCommandCooldown:0\}/.test(main), 'default cooldown is 0 (unchanged pacing)');
  assert(main.includes('id="rs-command-cooldown"') && main.includes('["rs-command-cooldown","rsCommandCooldown"]'), 'bar settings has the cooldown input wired to storage');
  assert(/"rsCommandCooldown","rsLatestHandoff"\]/.test(main) && main.includes("'rsContinuationOffer','rsCommandCooldown'"), 'cooldown loaded and live-updated from storage');
  const loop = main.indexOf('await waitCommandCooldown(userPrompt === true, () => A.stop);');
  assert(loop > 0 && main.indexOf('await jitterBeforeSend();', loop) - loop < 120, 'send loop waits before each send');
  const html = read('agent/src/desktop.html');
  assert(html.includes('data-pref="rsCommandCooldown"'), 'desktop settings has the cooldown input');
  const rs = read('agent/src/preferences.rs');
  assert(rs.includes('rename = "rsCommandCooldown"') && rs.includes('command_cooldown:0.0'), 'desktop preferences store the cooldown with default 0');

  // Behaviour: run the real helper with fake timers.
  const a = main.indexOf('  let _lastCommandSendAt = 0;'), b = main.indexOf('  function jitterBeforeSend() {');
  assert(a > 0 && b > a, 'helper source found');
  let now = 1000000; const slept = [];
  const ctx = { Date: { now: () => now }, Math, Number, diag: () => {}, reliabilitySettings: { rsCommandCooldown: 0 },
    sleep: ms => { slept.push(ms); now += ms; return Promise.resolve(); } };
  vm.createContext(ctx);
  vm.runInContext(main.slice(a, b) + '\nthis.normalizeCooldown=normalizeCooldown;this.waitCommandCooldown=waitCommandCooldown;', ctx);
  const N = ctx.normalizeCooldown;
  assert(N(undefined) === 0 && N('abc') === 0 && N(-3) === 0 && N(2.25) === 2.3 && N(500) === 120, 'cooldown value is clamped to 0..120 s');
  await ctx.waitCommandCooldown(false); await ctx.waitCommandCooldown(false);
  assert(slept.length === 0, 'cooldown 0 never waits (previous behaviour)');
  ctx.reliabilitySettings.rsCommandCooldown = 3;
  await ctx.waitCommandCooldown(false); now += 1000; slept.length = 0;
  await ctx.waitCommandCooldown(false);
  assert(slept.reduce((x, y) => x + y, 0) === 2000, 'command waits the remaining 2 s of a 3 s cooldown');
  slept.length = 0; await ctx.waitCommandCooldown(true);
  assert(slept.length === 0, 'user prompts are never delayed');
  slept.length = 0; let polls = 0;
  await ctx.waitCommandCooldown(false, () => ++polls > 2);
  assert(slept.length === 2, 'Stop interrupts the cooldown wait');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
