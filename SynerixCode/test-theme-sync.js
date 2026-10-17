const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const background = fs.readFileSync('background.js', 'utf8');
const begin = background.indexOf('const DESKTOP_PREF_KEYS =');
const end = background.indexOf('async function pullDesktopPreferences()', begin);
const local = {};
const writes = [];
const context = { ENGINE_KEY: 'rs-engine', chrome: { storage: { local: {
  async get() { return {...local}; },
  async set(value) { Object.assign(local,value); writes.push(value); }
} } } };
vm.createContext(context);
vm.runInContext(background.slice(begin,end),context);
(async () => {
  const cyan = {theme:'cyan',glow:'strong',gradients:'off'};
  await vm.runInContext(`applyDesktopPreferences(${JSON.stringify({rsAppearance:cyan})})`,context);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(local.rsAppearance)),cyan);
  await vm.runInContext(`applyDesktopPreferences(${JSON.stringify({rsAppearance:cyan})})`,context);
  assert.equal(writes.length,1,'unchanged preferences must not create an echo loop');
  vm.runInContext('desktopPendingPreferences.set("rsAppearance", {theme:"rose",glow:"off",gradients:"on"})',context);
  await vm.runInContext(`applyDesktopPreferences(${JSON.stringify({rsAppearance:cyan})})`,context);
  assert.equal(writes.length,1,'pending local theme changes take priority');
  vm.runInContext('desktopPendingPreferences.clear()',context);
  await vm.runInContext('applyDesktopPreferences({rsAppearance:{theme:"emerald",glow:"off",gradients:"on"}})',context);
  assert.equal(local.rsAppearance.theme,'emerald');
  const main=fs.readFileSync('core/main.js','utf8');
  assert(main.includes('if (changes.rsAppearance && changes.rsAppearance.newValue)'));
  const desktop=fs.readFileSync('agent/src/desktop.html','utf8');
  assert(desktop.includes('JSON.stringify({rsAppearance:Value})'));
  assert(desktop.includes('Applyappearance(Preferences.rsAppearance)'));
  console.log('Shared appearance propagation, deduplication and pending-change priority passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
