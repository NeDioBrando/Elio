// Real MV3 classic service-worker regression; no bridge, Studio or Full PC access.
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=__dirname;
function makeExtension(base,dir,missing=false){
 fs.mkdirSync(path.join(dir,'core/asset-library'),{recursive:true});
 const full=fs.readFileSync(path.join(base,'background.js'),'utf8');
 const end=full.indexOf('// Elio build compatibility:');assert(end>0);
 fs.writeFileSync(path.join(dir,'background.js'),full.slice(0,end)+'\nchrome.runtime.onMessage.addListener((msg,sender,reply)=>{localAssetLibrary(msg).then(reply);return true;});');
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({manifest_version:3,name:'Elio offline library regression',version:'1.0.0',background:{service_worker:'background.js'}}));
 if(!missing)fs.copyFileSync(path.join(base,'core/asset-library.js'),path.join(dir,'core/asset-library.js'));
 fs.copyFileSync(path.join(base,'core/asset-library/catalog.json'),path.join(dir,'core/asset-library/catalog.json'));
 fs.writeFileSync(path.join(dir,'probe.html'),'<!doctype html><title>Offline library regression</title>');
}
async function probe(dir,profile,missing=false){
 const browser=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROMIUM_PATH||process.env.ELIO_TEST_CHROMIUM||chromium.executablePath(),args:['--no-sandbox','--disable-extensions-except='+dir,'--load-extension='+dir]});
 try{
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host;const page=await browser.newPage();
  await page.goto('chrome-extension://'+id+'/probe.html');
  // Request via runtime messaging only after installation and initial evaluation.
  await page.waitForTimeout(300);
  async function call(req){return page.evaluate(req=>chrome.runtime.sendMessage(req),req);}
  const stats=await call({action:'stats'});
  if(missing){assert.equal(stats.ok,false);assert.equal(stats.error_code,'library_unavailable');assert.equal(stats.resource,'core/asset-library.js');assert.match(stats.recovery,/Reload/);assert.match(stats.error,/Full PC access is not required/);return;}
  assert.equal(stats.ok,true,JSON.stringify(stats));assert.equal(stats.total,5515);
  const search=await call({action:'search',query:'beam',limit:12});assert.equal(search.ok,true);assert(search.results.length>0);
  const reported=await call({action:'search',query:'energy beam tapered laser lightning sparks',limit:12});assert.equal(reported.ok,true);assert(Array.isArray(reported.results));
  const get=await call({action:'get',key:search.results[0].key});assert.equal(get.ok,true);
  assert.equal((await call({action:'guide'})).ok,true);
  assert.equal((await call({action:'delete'})).ok,false);
 }finally{await browser.close();}
}
async function checkLoaderFailures(){
 const vm=require('node:vm');const source=fs.readFileSync(path.join(root,'background.js'),'utf8').split('// Elio build compatibility:')[0];
 const data=JSON.parse(fs.readFileSync(path.join(root,'core/asset-library/catalog.json'),'utf8'));
 let startup=true,imports=0,fetches=0,fail=true;
 const context={chrome:{runtime:{getURL:p=>'chrome-extension://test/'+p}},importScripts:p=>{assert(startup,'Late importScripts');assert.equal(p,'core/asset-library.js');imports++;context.ElioAssetLibrary=require('./core/asset-library.js');},fetch:async()=>{fetches++;return {ok:!fail,status:503,json:async()=>data};}};
 vm.createContext(context);vm.runInContext(source+';this.lookup=localAssetLibrary',context);startup=false;assert.equal(imports,1);
 const unavailable=await context.lookup({action:'stats'});assert.equal(unavailable.error_code,'library_unavailable');assert.equal(unavailable.resource,'core/asset-library/catalog.json');
 fail=false;const replies=await Promise.all(Array.from({length:8},()=>context.lookup({action:'stats'})));assert(replies.every(r=>r.ok&&r.total===5515));assert.equal(fetches,2);assert.equal(imports,1);
}
(async()=>{
 await checkLoaderFailures();
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'elio-library-worker-'));
 try{
  const dir=path.join(temp,'extension');makeExtension(root,dir);
  await probe(dir,path.join(temp,'profile'));
  await probe(dir,path.join(temp,'profile')); // Reactivation without extension reinstall.
  const mirror=path.join(temp,'mirror');makeExtension(path.join(root,'elio-Extension'),mirror);await probe(mirror,path.join(temp,'mirror-profile'));
  const missing=path.join(temp,'missing');makeExtension(root,missing,true);await probe(missing,path.join(temp,'missing-profile'),true);
  console.log('PASS real Chrome MV3: delayed offline stats/search/get/guide, reported query, worker reactivation, packaged mirror, missing script stays actionable without crashing worker.');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
