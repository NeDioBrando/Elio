const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),source=fs.readFileSync('core/main.js','utf8');
let stops=0,pauses=0,marked=0,clarifications=0;
const A={stop:false,starting:true,startGen:7,running:true,toolRunning:false};
const context={clarification:{cancel(){clarifications++;}},stopMode:"safe",bg:()=>Promise.resolve({ok:true}),A,cowork:{snapshot:()=>({enabled:true,pending:[],sending:false}),pause(){pauses++;}},P:{streamLen:()=>10,stopGeneration(){stops++;},setInputLock(on){assert.equal(on,false);}},ui:{inputCover(on){assert.equal(on,false);},markStopping(){marked++;},toast(){}},diag(){},markStoppedTurn(){},Date,RS:{toolCategory(){}},rememberHalted(){},decorate:{toolBox(){}}};vm.createContext(context);
let start=source.indexOf('  function stopLoop('),end=source.indexOf('  // The full system prompt',start);vm.runInContext(source.slice(start,end)+'this.stop=stopLoop;',context);
context.stop();assert.equal(clarifications,1,"Stop cancels pending clarification before waiting for the current step");assert(A.stop && A.userStopped && A.stopping);assert(!A.starting);assert.equal(A.startGen,8);assert.equal(stops,1);assert.equal(pauses,1);assert.equal(marked,1);context.stop();assert.equal(stops,1);
A.stopping=false;A.stop=false;context.stop({native:true});assert(A.stop);assert.equal(stops,1);assert.equal(pauses,2);
A.stopping=false;context.cowork.snapshot=()=>({enabled:false,pending:[],sending:false});context.stop({native:true});assert.equal(pauses,2,'Off and empty queue must not become paused');
A.stopping=false;context.cowork.snapshot=()=>({enabled:false,pending:[{id:1}],sending:false});context.stop({native:true});assert.equal(pauses,3,'Saved requests must still pause safely');
start=source.indexOf('  async function runToolImpl(call) {');end=source.indexOf('    let name = call.tool;',start);vm.runInContext(source.slice(start,end)+'return "must not execute";}this.block=runToolImpl;',context);
(async()=>{
 assert((await context.block({tool:'write_file'})).includes('not run'));
 const wrapper=source.slice(source.indexOf('  async function runTool(call)'),source.indexOf('  async function runToolImpl(call)'));
 let release;const state={stop:false,stopMode:'immediate'};const c={A:state,setInterval,clearInterval,Promise,runToolImpl:()=>new Promise(resolve=>{release=resolve;})};vm.createContext(c);vm.runInContext(wrapper+'this.run=runTool;',c);
 const immediate=c.run({tool:'write_file'});state.stop=true;assert((await immediate).includes('partial effects'));assert.equal(state.pendingToolSettles,1);state.stop=false;assert((await c.run({tool:'write_file'})).includes('waiting for cancellation'));release('finished');await new Promise(resolve=>setImmediate(resolve));assert.equal(state.pendingToolSettles,0);
 state.stop=false;state.stopMode='safe';let resolved=false;const safe=c.run({tool:'write_file'}).then(result=>{resolved=true;return result;});state.stop=true;await new Promise(resolve=>setTimeout(resolve,80));assert(!resolved);release('safe completion');assert.equal(await safe,'safe completion');assert.equal(state.pendingToolSettles,0);
 assert(source.includes('if (!A.pendingToolSettles) A.stop = false;'));assert(source.includes('(A.stop || A.pendingToolSettles) && msg && msg.type === \"call_tool\"')); assert(source.includes('A.running || A.starting || A.stopping || A.enhancing || A.pendingToolSettles'));assert(source.includes('if (!A.stop) try { feedback = await attachAutoDebug'));
 console.log('Stop latch, startup cancellation, native Stop, Immediate early return + draining guard, and Safe current-step completion passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
