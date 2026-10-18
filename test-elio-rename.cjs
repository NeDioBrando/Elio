// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Git checkout may use CRLF on Windows; source-pattern checks are EOL-independent.
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8').replace(/\r\n/g,'\n');
const cargo=read('agent/Cargo.toml'),lock=read('agent/Cargo.lock');
assert.match(cargo,/name = "elio-agent"\nversion = "1\.0\.1"/);assert.match(cargo,/\[\[bin\]\]\nname = "elio"/);assert.match(lock,/name = "elio-agent"\nversion = "1\.0\.1"/);
for(const f of ['manifest.json','elio-Extension/manifest.json']){const m=JSON.parse(read(f));assert.equal(m.name,'Elio');assert.equal(m.version,'1.0.1');assert.equal(m.version_name,'1.0.1');}
const forbidden=new RegExp('(?:synerix|plaz)'+'code|\\bPlaz\\b','i');
function walk(dir){for(const e of fs.readdirSync(path.join(__dirname,dir),{withFileTypes:true})){const f=path.join(dir,e.name);assert(!forbidden.test(f),f);if(e.isDirectory())walk(f);else {if(/\.(?:js|json|html|css|rs|py|ps1|cmd|yml|plist|toml)$/.test(f))assert(!forbidden.test(read(f)),f+' old product identifier');if(dir==='core'||dir.startsWith('core'+path.sep)||dir==='providers')assert.deepEqual(fs.readFileSync(f),fs.readFileSync(path.join('elio-Extension',f)),f+' extension parity');}}}
for(const dir of ['core','providers','desktop','updater','tools'])walk(dir);
for(const f of ['background.js','popup.js','popup.html','overlay.css','agent/src/main.rs','agent/src/update_service.rs','agent/src/desktop.html','agent/build.rs','Build-Windows.ps1','.github/workflows/build-windows.yml','Start-elio-Agent.cmd'])assert(!forbidden.test(read(f)),f);
const pack=read('tools/package_windows.py'),helper=read('updater/apply-update.ps1'),update=read('agent/src/update_service.rs'),flow=read('.github/workflows/build-windows.yml');
for(const s of [pack,helper]){assert(s.includes('elio.exe'));assert(s.includes('elio-Extension'));assert(s.includes('elio-agent '));}
assert.equal((pack.match(/shutil.copy2\(exe,stage\/'elio.exe'\)/g)||[]).length,1,'one executable, no case-only alias');
assert(helper.includes("StartsWith('elio/'"));assert(update.includes('NeDioBrando/Elio'));assert(update.includes('elio-v{v}-Windows-x64.zip'));assert(pack.includes('elio-v{version}-Windows-x64.zip'));assert(flow.includes('dist/elio-v*-Windows-x64.zip'));
for(const f of ['agent/assets/elio.ico','agent/assets/elio.png','agent/assets/elio.svg','elio-Extension/manifest.json','Start-elio-Agent.cmd'])assert(fs.existsSync(f),f);
assert(read('Build-Windows.ps1').includes('test-elio-identity.cjs'));assert(read('Build-Windows.ps1').includes('test-elio-rename.cjs'));
console.log('PASS complete rename: 1.0.1, Cargo/bin/icons, runtime identifiers, recursive extension parity, one executable, packager/helper/update authority/workflow contracts.');
