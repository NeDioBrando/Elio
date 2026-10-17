// Unattended runs: a running tab is protected from auto-discard (Edge sleeping
// tabs / Chrome memory saver), receives wake messages that resolve only
// already-due sleeps (hidden/occluded tabs clamp timers to 1/min), and keeps
// the desktop from auto-updating mid-run. 1.19.35 had none of this.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const bg=fs.readFileSync('background.js','utf8'),main=fs.readFileSync('core/main.js','utf8');
const between=(src,a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert(i>=0&&j>i,a);return src.slice(i,j);};
// Background side.
const updates=[],wakes=[],posts=[];let intervalFn=null;let now=1_000_000;
const box={Date:{now:()=>now},rustMode:true,RUST_ROBLOX_HTTP:'http://127.0.0.1:3000',Map,Number,
  setInterval:(fn)=>{intervalFn=fn;return 1;},
  bridgeFetch:(url,opt)=>{posts.push(url);return Promise.resolve({});},
  chrome:{tabs:{update:(id,p)=>{updates.push([id,p.autoDiscardable]);return Promise.resolve();},sendMessage:(id,m)=>{wakes.push([id,m.type]);return Promise.resolve();},onRemoved:{addListener(fn){box.removed=fn;}}}}};
vm.createContext(box);
vm.runInContext(between(bg,'const RUN_BEAT_TTL_MS','\nfunction broadcastStatus')+';globalThis.noteRunBeat=noteRunBeat;globalThis.runTabs=runTabs;',box);
box.noteRunBeat(7,true);box.noteRunBeat(7,true);
assert.deepEqual(updates,[[7,false]],'autoDiscardable is disabled once per run');
assert.equal(posts.length,1);assert(posts[0].endsWith('/api/desktop/activity'));
now+=31000;box.noteRunBeat(7,true);assert.equal(posts.length,2,'activity heartbeat repeats at most every 30s');
intervalFn();assert.deepEqual(wakes,[[7,'rs-wake']]);
box.noteRunBeat(9,true);box.noteRunBeat(9,false);assert.deepEqual(updates.slice(-2),[[9,false],[9,true]],'stopping a run restores discarding');
now+=181000;intervalFn();assert.deepEqual(updates.at(-1),[7,true],'a tab that stops beating is released after the TTL');assert.equal(box.runTabs.size,0);
box.noteRunBeat('x',true);assert.equal(box.runTabs.size,0,'beats without a tab id are ignored');
assert(/case "rs-run-beat":\s*noteRunBeat\(tabId, msg\.running === true\)/.test(bg));
// Content side: wakes resolve only sleeps that are already due.
const sleepSrc=between(main,'  const _sleepers = new Set();','  // ── Background mode (v1.12)');
let clock=0;const timers=[];
const c={Date:{now:()=>clock},Set,Promise,setTimeout:(fn,ms)=>{timers.push({fn,at:clock+ms});return timers.length;}};
vm.createContext(c);vm.runInContext(sleepSrc+';globalThis.sleep=sleep;globalThis.wake=wakeDueSleepers;',c);
(async()=>{
  let a=false,b=false;c.sleep(160).then(()=>a=true);c.sleep(5000).then(()=>b=true);
  clock=100;c.wake();await null;await null;assert(!a&&!b,'nothing resolves before its deadline');
  clock=1000;c.wake();await null;await null;assert(a&&!b,'a due sleep resolves on wake even if its timer is throttled');
  for(const t of timers)t.fn();await null;await null;assert(b,'native timers still resolve without wakes');
  let n=0;c.sleep(10).then(()=>n++);clock=2000;c.wake();for(const t of timers)t.fn();await null;await null;assert.equal(n,1,'a sleep never resolves twice');
  assert(main.includes('if (msg && msg.type === "rs-wake") { wakeDueSleepers();'));
  assert(main.includes('navigator.locks.request("synerixcode-agent-run"'));
  assert(main.includes('rsInterval(syncRunBeat, 5000)'));
  console.log('PASS: running tabs stay undiscarded, get due-only wakes and defer desktop updates; released on stop or silence.');
})().catch(e=>{console.error(e);process.exitCode=1;});
