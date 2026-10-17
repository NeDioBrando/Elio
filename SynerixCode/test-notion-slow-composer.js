// Edge cold starts: Notion's AI editor can mount 30s+ after /ai paints.
// 1.19.35 gave up after 20s and showed "isn't ready"; it must wait up to 60s
// and still fail cleanly (no endless wait) when the editor never appears.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('providers/notion.js','utf8').replace(/\r\n/g,'\n');
const i=src.indexOf('  async function ensureComposerReady(');const j=src.indexOf('\n  }\n',i)+4;
const pre=src.slice(Math.max(0,src.lastIndexOf('\n',i-2)),i);
const code=(/COMPOSER_WAIT_MS/.test(pre)?pre:'')+src.slice(i,j);
async function run(appearAt,stopAt=Infinity){let now=0;const editor={};const c={Date:{now:()=>now},location:{pathname:'/ai'},diag(){},isStopped:()=>now>=stopAt,isAiSurface:()=>true,
  findEditorRaw:()=>now>=appearAt?editor:null,waitFor:async(fn,ms)=>{const end=now+ms;while(now<end){now+=250;if(fn())return true;}return false;}};
  vm.createContext(c);vm.runInContext(code+';globalThis.f=ensureComposerReady;',c);const r=await c.f('startup');return {r,now};}
(async()=>{
  let {r,now}=await run(35000);assert.equal(r.ready,true,'editor mounting after 35s is found');assert(now<36500);
  ({r,now}=await run(Infinity));assert.equal(r.ready,false);assert(now>=60000&&now<=61500,'gives up after about 60s');assert(/60 seconds/.test(r.error));
  ({r,now}=await run(0));assert.equal(r.ready,true);assert.equal(now,0,'ready editor costs no wait');
  ({r,now}=await run(Infinity,1500));assert.equal(r.ready,false);assert(now<=2000,'cancelled startup stops waiting promptly');
  console.log('PASS: Notion composer wait covers slow Edge cold starts (60s) and still fails cleanly.');
})().catch(e=>{console.error(e);process.exitCode=1;});
