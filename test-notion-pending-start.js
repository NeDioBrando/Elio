const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('providers/notion.js','utf8');
function fixture(active=false){
 let tick,delayed=[],clears=0,starts=0,navs=0,p={at:0,lastNav:0,navs:1};
 const box={Date:{now:()=>10000},isStopped:()=>false,isSessionActive:()=>active,readPendingStart:()=>p,clearPendingStart:()=>{p=null;clears++;},writePendingStart:v=>{p=v;},setInterval:f=>{tick=f;return 1;},clearInterval(){},setTimeout:(f,ms)=>{delayed.push({f,ms});},isCleanAiLanding:()=>false,isAiLanding:()=>false,findEditorRaw:()=>({}),diag(){},location:{pathname:'/chat'},routeKey:()=>'/chat',openCleanAi:()=>{navs++;},requestStart:()=>{starts++;}};
 vm.createContext(box);const a=source.indexOf('  function armPendingAutoStart()'),b=source.indexOf('  const chatIsEmpty',a);
 vm.runInContext(source.slice(a,b)+'armPendingAutoStart();',box);
 return {box,tick:()=>tick(),setActive:v=>{active=v;},runDelayed:()=>{for(const t of delayed.splice(0))t.f();},state:()=>({p,clears,starts,navs})};
}
const active=fixture(true);active.tick();assert.equal(active.state().navs,0);assert.equal(active.state().p,null);assert.equal(active.state().starts,0);
const fresh=fixture();fresh.box.isCleanAiLanding=()=>true;fresh.tick();fresh.runDelayed();assert.equal(fresh.state().starts,1);assert.equal(fresh.state().p,null);
const race=fixture();race.box.isCleanAiLanding=()=>true;race.tick();race.setActive(true);race.runDelayed();assert.equal(race.state().starts,0);
assert(source.includes('if (state.ready) clearPendingStart();'));
console.log('Stale Notion pending starts cannot redirect active chats, navigation resumes once on a fresh landing, and a delayed request is cancelled when another startup already succeeded.');
