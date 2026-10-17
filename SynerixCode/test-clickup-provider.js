// Wiring checks; real native-browser behavior is in release-tools/test-clickup-browser.cjs.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
assert(manifest.host_permissions.includes('https://app.clickup.com/*'));
const scripts=manifest.content_scripts.filter(x=>x.matches.includes('https://app.clickup.com/*'));
assert(scripts.some(x=>x.run_at==='document_start'&&x.js.includes('core/input-isolation.js')));
const provider=scripts.find(x=>x.js.includes('providers/clickup.js'));assert(provider&&provider.js.includes('core/main.js'));
for(const file of provider.js)assert(fs.existsSync(file),file);
for(const file of ['popup.js','background.js','core/main.js'])assert(fs.readFileSync(file,'utf8').includes('app.clickup.com'),file);
for(const file of ['providers/clickup.js','core/main.js','background.js','manifest.json'])assert.equal(fs.readFileSync(file,'utf8'),fs.readFileSync('synerixcode-Extension/'+file,'utf8'),file+' extension copy');
const code=fs.readFileSync('providers/clickup.js','utf8');assert(code.includes('authoritativeSendResult:true'));assert(code.includes('compactStartup:true'));assert(code.includes('sendRetryable:()=>false'));assert(code.includes('barOutside:true'));
assert(!code.includes('90141771095'),'no private workspace identifier in shipped source');
assert.equal(manifest.version,'1.0.0');assert.match(fs.readFileSync('agent/Cargo.toml','utf8'),/version = "1\.24\.20"/);
const browser=fs.readFileSync('release-tools/test-clickup-browser.cjs','utf8');assert(browser.includes('firefox'));assert(browser.includes('fixture.startSession()'));assert(browser.includes('fixture.agentLoop(base)'));
console.log('PASS ClickUp manifest, popup, background, provider/core wiring, extension parity, private-workspace hygiene and browser fixture coverage');
