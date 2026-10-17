const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const bg=fs.readFileSync('background.js','utf8');const engineCode=bg.slice(bg.indexOf('const tabEngines ='),bg.indexOf('// Probe Rust agent'));
const handler=bg.slice(bg.indexOf('      case "rs-set-engine":'),bg.indexOf('      case "rs-set-full":'));
(async()=>{
 const session={},messages=[];let response;
 const box={Map,Number,normalizeEngine:v=>v==='local'?'local':'roblox',chrome:{storage:{session:{async get(k){return {[k]:session[k]}},async set(v){Object.assign(session,v)},async remove(k){delete session[k]}}},tabs:{onRemoved:{addListener(){}},async sendMessage(id,msg){messages.push({id,msg})}}},sendResponse:r=>response=r,tabId:1,msg:{engine:'local'}};
 vm.createContext(box);vm.runInContext(engineCode,box);
 assert.equal(await box.tabEngine(1),'roblox');assert.equal(await box.tabEngine(2),'roblox');
 await vm.runInContext('(async()=>{switch("rs-set-engine"){'+handler+'}})()',box);
 assert.equal(response.engine,'local');assert.equal(await box.tabEngine(1),'local');assert.equal(await box.tabEngine(2),'roblox');assert.equal(messages.length,1);assert.equal(messages[0].id,1);
 box.tabId=2;box.msg.engine='local';await vm.runInContext('(async()=>{switch("rs-set-engine"){'+handler+'}})()',box);
 box.tabId=1;box.msg.engine='roblox';await vm.runInContext('(async()=>{switch("rs-set-engine"){'+handler+'}})()',box);
 assert.equal(await box.tabEngine(2),'local');assert.equal(await box.tabEngine(1),'roblox');
 const second={...box};vm.createContext(second);vm.runInContext(engineCode,second);assert.equal(await second.tabEngine(2),'local','worker restart restores per-tab selection');
 assert(!bg.slice(bg.indexOf('const DESKTOP_PREF_KEYS'),bg.indexOf('let desktopSyncApplying')).includes('ENGINE_KEY'));
 // A slow initial storage read must not overwrite a newer explicit choice.
 let release;const delayed={...box,chrome:{...box.chrome,storage:{session:{get:()=>new Promise(resolve=>release=resolve),async set(){},async remove(){}}}}};vm.createContext(delayed);vm.runInContext(engineCode,delayed);const restoring=delayed.tabEngine(99);vm.runInContext('tabEngines.set(99,\"local\")',delayed);release({'rs-tab-engine-99':'roblox'});assert.equal(await restoring,'local');assert.equal(await delayed.tabEngine(99),'local');
 console.log('Tab-local selection, popup targeting, worker recovery and no desktop engine synchronization passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
