// elio v1 fork-specific audit. Run with Node 24; no npm packages required.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const root=__dirname,read=p=>fs.readFileSync(path.join(root,p),'utf8');
const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.name === 'Elio',true);assert.match(manifest.version,/^\d+\.\d+\.\d+$/);assert.equal(manifest.version_name,manifest.version);assert.equal(manifest.update_url,undefined);
const hosts=['https://vani.ai/*','https://www.vani.ai/*','https://c.vani.ai/*'];
for(const host of hosts){
 assert(manifest.host_permissions.includes(host));
 const providerBlocks=manifest.content_scripts.filter(b=>b.matches.includes(host)&&b.js?.some(s=>/^providers\/(?!media\.js)/.test(s)));
 assert.equal(providerBlocks.length,1,'exactly one provider per Vani origin');assert(providerBlocks[0].js.includes('providers/vani.js'));
 assert(manifest.content_scripts[0].matches.includes(host));assert(manifest.content_scripts[1].matches.includes(host));
 assert(read('background.js').includes(host));
}
for(const b of manifest.content_scripts)for(const f of [...(b.js||[]),...(b.css||[])])assert(fs.existsSync(path.join(root,f)),f);
const updater=read('agent/src/update_service.rs');
assert(updater.includes('NeDioBrando/Elio'));
assert(!updater.includes('stoveez'));
assert(!read('agent/src/main.rs').includes('mod updater;'));
const version=require('./core/version.js');assert.equal(version.display('1.0.1'),'1.0.1');
assert.equal(version.describe('1.0.1',{current:'1.0.1',latest:'1.0.2',outdated:true}).outdated,true);
assert.equal(version.describe('1.0.1',{current:'1.0.2',latest:'1.0.2',outdated:false}).reload,true);
const p=new Function(read('providers/vani.js')+';return RSProvider;')();assert.equal(p.id,'vani');
for(const key of ['init','getEditor','allItems','readAssistant','typeAndSend','stopGeneration','ensureComposerReady','scanError','conversationKey','installSendHooks'])assert.equal(typeof p[key],'function',key);
assert(!read('providers/vani.js').includes('for (let i = 0; i < 5 && !sent'));
// Canonical runtime and installable extension must be byte-for-byte identical.
let count=0;
function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.js'))syntax(f);}}
function syntax(f){cp.execFileSync(process.execPath,['--check',path.join(root,f)],{stdio:'pipe'});count++;}
for(const dir of ['core','providers']){walk(dir);for(const name of fs.readdirSync(path.join(root,dir))){if(fs.statSync(path.join(root,dir,name)).isFile())assert.deepEqual(fs.readFileSync(path.join(root,dir,name)),fs.readFileSync(path.join(root,'elio-Extension',dir,name)),dir+'/'+name);}}
for(const f of ['manifest.json','background.js','popup.js','popup.html','overlay.css','icon.png'])assert.deepEqual(fs.readFileSync(path.join(root,f)),fs.readFileSync(path.join(root,'elio-Extension',f)),f);
syntax('background.js');syntax('popup.js');
for(const f of ['agent/src/desktop.html','popup.html'])for(const [i,s]of [...read(f).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].entries()){if(!s[1].trim()||s[1].trim().startsWith('__ELIO_'))continue;cp.execFileSync(process.execPath,['--check'],{input:s[1],stdio:['pipe','pipe','pipe']});count++;}
console.log('PASS elio v1: identity, full version, Vani registration/contracts, own update channel, synced extension, syntax ('+count+' scripts)');
