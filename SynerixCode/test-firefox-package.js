const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),vm=require('vm');
const root=__dirname,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'synerixcode-firefox-package-'));
try {
  cp.execFileSync(process.env.PYTHON || (process.platform==='win32'?'python':'python3'),[path.join(root,'release-tools/build-firefox.py'),path.join(root,'synerixcode-Extension'),path.join(tmp,'extension'),path.join(tmp,'firefox.zip')]);
  const chrome=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))),firefox=JSON.parse(fs.readFileSync(path.join(tmp,'extension/manifest.json')));
  assert.deepStrictEqual(firefox.background,{scripts:['background.js']});assert(!firefox.minimum_chrome_version);assert.equal(firefox.browser_specific_settings.gecko.id,'synerixcode@synerixcode.local');assert.equal(firefox.browser_specific_settings.gecko.strict_min_version,'140.0');
  // Firefox adds only its transfer shim/helper; every Chromium script and order is preserved.
  const shim='core/firefox-events.js',helper='core/firefox-events-main.js';
  const restored=firefox.content_scripts.filter(s=>!(s.js.length===1&&s.js[0]===helper)).map(s=>({...s,js:s.js.filter(f=>f!==shim)}));
  assert.deepStrictEqual(restored,chrome.content_scripts);
  for(const [i,s] of firefox.content_scripts.entries()){if(s.world==='MAIN'&&s.js[0]===helper){const next=firefox.content_scripts[i+1];assert.equal(s.run_at,'document_start');assert.deepStrictEqual(s.matches,next.matches);assert.equal(next.js[0],shim);}else if(s.world!=='MAIN')assert.equal(s.js[0],shim,'isolated groups load the shim first');}
  assert(!chrome.content_scripts.some(s=>s.js.includes(shim)||s.js.includes(helper)),'Chromium manifest unchanged');assert.deepStrictEqual(firefox.permissions,chrome.permissions);assert.deepStrictEqual(firefox.host_permissions,chrome.host_permissions);
  for(const s of firefox.content_scripts)for(const f of [...(s.js||[]),...(s.css||[])])assert(fs.existsSync(path.join(tmp,'extension',f)),f);
  assert.equal(firefox.content_scripts.filter(s=>s.world==='MAIN'&&s.js[0]!==helper&&s.js[0]!=='core/debug-capture-main.js').length,3);assert.equal(firefox.content_scripts.filter(s=>s.world==='MAIN'&&s.js[0]==='core/debug-capture-main.js').length,1,'1.22.0 debug helper kept');assert.equal(firefox.content_scripts.filter(s=>s.js[0]===helper).length,chrome.content_scripts.filter(s=>s.world!=='MAIN').length);
  for(const f of ['LICENSE','SOURCE.txt','BRANDING-NOTICE.txt'])assert(fs.readFileSync(path.join(tmp,'extension',f)).equals(fs.readFileSync(path.join(root,f))),f);
  for(const f of ['background.js','core/main.js','core/clarification.js','providers/notion.js','popup.js'])assert(fs.readFileSync(path.join(tmp,'extension',f)).equals(fs.readFileSync(path.join(root,'synerixcode-Extension',f))),f);
  const source=fs.readFileSync(path.join(root,'background.js'),'utf8'),start=source.indexOf('function pairingIdentity()'),end=source.indexOf('async function bridgeFetch',start),code=source.slice(start,end);
  for(const [url,id,expected] of [['chrome-extension://abcdefghijklmnopabcdefghijklmnop/','abcdefghijklmnopabcdefghijklmnop','abcdefghijklmnopabcdefghijklmnop'],['moz-extension://12345678-1234-1234-1234-123456789abc/','synerixcode@synerixcode.local','12345678-1234-1234-1234-123456789abc']])assert.equal(vm.runInNewContext(code+';pairingIdentity()', {URL,chrome:{runtime:{id,getURL:()=>url}}}),expected);
  assert(/"X-synerixcode-Extension"\s*:\s*pairingIdentity\(\)/.test(source));
  console.log('Firefox manifest, full provider coverage/MAIN taps, shared script parity, install guidance and UUID pairing identity passed.');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
