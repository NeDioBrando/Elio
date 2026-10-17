const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('core/main.js','utf8');
function clock(){let now=1000,id=0;const timers=new Map();return {timers,Date:{now:()=>now},setTimeout(fn,ms){const key=++id;timers.set(key,{fn,at:now+ms});return key;},clearTimeout(key){timers.delete(key);},advance(ms){const end=now+ms;let count=0;while(true){const row=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!row||row[1].at>end)break;assert(++count<100000);now=row[1].at;timers.delete(row[0]);row[1].fn();}now=end;}};}
(async()=>{
 for(const tool of [false,true]){
  const time=clock(),A={stop:false},callbacks=[];
  const box={...time,A,activeEngine:()=> 'roblox',isContextInvalidated:()=>false,chrome:{runtime:{sendMessage(m,cb){callbacks.push(cb);},lastError:null}}};vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('  function bgRequestTimeoutMs('),source.indexOf('\n  // Proactive stale-extension probe'))+'this.bg=bg;',box);
  const result=box.bg({type:tool?'call_tool':'skills',timeout:1000});
  if(tool){assert.equal(A.inflightTools.size,1);for(const r of A.inflightTools){r.draining=true;A.pendingToolSettles=1;}}
  time.advance(tool?31000:180000);const value=await result;assert.equal(value.kind,'timeout');
  if(tool){assert.equal(A.pendingToolSettles,0);assert.equal(A.inflightTools.size,0);assert.match(value.error,/not replayed/);}
  callbacks[0]({ok:true,text:'late'});assert.equal((await result).kind,'timeout');assert.equal(time.timers.size,0);
  A.stop=false;const healthy=box.bg({type:'call_tool',timeout:1000});callbacks[1]({ok:true,text:'once'});assert.equal((await healthy).text,'once');assert.equal(time.timers.size,0);
 }
 // Fresh user sends and Continue are retained until the old loop/cancellation drains.
 const code=source.slice(source.indexOf('  function scheduleNativeIntent('),source.indexOf('\n  // User-send interception:'));
 for(const stopAgain of [false,true]){
  const time=clock(),A={running:true,stop:true,sessionGen:1,userStopped:false,pendingToolSettles:1},calls=[];
  const box={...time,A,P:{conversationKey:()=> 'chat',lastAssistant:()=>null},enforceCondo:()=>false,isRememberedExecuted:()=>false,agentLoop:base=>calls.push(base),ui:{toast(){throw Error('Unexpected deadline');}}};vm.createContext(box);vm.runInContext(code+'this.schedule=scheduleNativeIntent;',box);
  const intent={base:4,token:'before',chat:'chat',generation:1};A.nativeSendIntent=intent;box.schedule(intent);time.advance(500);
  assert.equal(A.stop,true,'Continue must not cancel the old stop latch');assert.equal(calls.length,0);assert.equal(A.nativeSendIntent,intent);
  A.running=false;time.advance(500);assert.equal(calls.length,0,'Wait for tool cancellation too');
  if(stopAgain){A.userStopped=true;A.nativeSendIntent=null;}A.pendingToolSettles=0;time.advance(500);
  assert.deepEqual(calls,stopAgain?[]:[4]);assert.equal(time.timers.size,0);if(!stopAgain)assert.equal(A.stop,false);
 }
 console.log('PASS missing worker callback deadlines, late reply once-only settlement, cancellation draining, deferred fresh send and second Stop.');
})().catch(e=>{console.error(e);process.exitCode=1});
