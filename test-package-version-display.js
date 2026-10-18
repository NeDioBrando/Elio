const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('agent/src/desktop.html','utf8');
const start=source.indexOf("      elioVersion.render(Byid('updateInstalled')");
const end=source.indexOf('      Renderreleasenotes',start);
const renders=[];const nodes={};const box={Value:{installed:'1.19.11',latest:'1.19.11',available:false},Byid:id=>nodes[id]??=( {}),elioVersion:{render(node,version){renders.push(version);node.textContent=version;}}};
vm.createContext(box);vm.runInContext(source.slice(start,end),box);
assert.equal(nodes.sidebarVersion.textContent,'1.19.11');assert.equal(nodes.settingsVersion.textContent,'1.19.11');assert.equal(nodes.titleVersion.textContent,'1.19.11');assert.equal(nodes.updateInstalled.textContent,'1.19.11');assert.equal(nodes.updateLatest.textContent,'1.19.11');
box.Value.latest='1.19.99';vm.runInContext(source.slice(start,end),box);assert.equal(nodes.updateInstalled.textContent,'1.19.11');assert.equal(nodes.updateLatest.textContent,'1.19.99');
box.Value.desktop_version='1.19.15';box.Value.desktop_latest='1.19.17';vm.runInContext(source.slice(start,end),box);assert.equal(nodes.sidebarVersion.textContent,'1.19.15');assert.equal(nodes.updateInstalled.textContent,'1.19.15');assert.equal(nodes.updateLatest.textContent,'1.19.99');
const ps=fs.readFileSync('Update-elio.ps1','utf8');assert(ps.includes('$latest = [version]$release.version'));assert(ps.includes('$ZipPath = Join-Path $stage'));assert(ps.includes('$next -ne $latest'));assert(!ps.includes('$current.Build + 1'));
console.log('Desktop labels show the actual native executable version when available; multi-version latest remains the update target.');

const packageVersion=fs.readFileSync('agent/Cargo.toml','utf8').match(/^version = "([^"]+)"/m)[1];
for(const path of ['manifest.json','elio-Extension/manifest.json']) {
 const manifest=JSON.parse(fs.readFileSync(path,'utf8'));
 assert.equal(manifest.version,packageVersion,path+' must match the release version');
 assert.equal(manifest.version_name??manifest.version,manifest.version,path+' must not override the displayed version with a stale label');
}
console.log('Both extension manifests display the actual current package version.');
