const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8').split('const PORT_ROBLOX')[0];
(async () => {
  const requests = [], saved = [];
  let stale = false, invalid = false;
  const context = vm.createContext({ Headers, AbortController, setTimeout, clearTimeout, chrome: {
    runtime: { id: 'a'.repeat(32) }, storage: { local: {
      get: async () => ({}), set: async value => saved.push(value)
    }}
  }, fetch: async (url, options) => {
    requests.push([url, options]);
    if (url.endsWith('/api/pair')) return { ok: true, json: async () => ({ key: invalid ? 'bad' : 'b'.repeat(64) }) };
    if (stale) { stale = false; return { status: 401 }; }
    return { status: 200 };
  }});
  vm.runInContext(source, context);
  await Promise.all([vm.runInContext('ensurePairing()', context), vm.runInContext('ensurePairing()', context)]);
  assert.equal(requests.length, 1, 'concurrent pairing must share one request');
  assert.equal(requests[0][1].headers['X-elio-Extension'], 'a'.repeat(32));
  await vm.runInContext('bridgeFetch("http://127.0.0.1:3000/api/status")', context);
  assert.equal(requests[1][1].headers.get('Authorization'), 'Bearer ' + 'b'.repeat(64));
  assert.equal(requests[1][1].redirect, 'error');
  stale = true;
  await vm.runInContext('bridgeFetch("http://127.0.0.1:3000/api/status")', context);
  assert.equal(requests.filter(([url]) => url.endsWith('/api/pair')).length, 2);
  assert.equal(saved.length, 2);
  invalid = true;
  await assert.rejects(vm.runInContext('ensurePairing(true)', context), /invalid pairing/);
  console.log('PASS automatic pairing, concurrent requests, stale-key recovery, and invalid-key rejection');
})();
