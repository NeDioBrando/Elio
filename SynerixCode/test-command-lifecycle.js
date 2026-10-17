const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('core/main.js','utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function clock(){let at=0,next=0;const timers=new Map();return {setTimeout(fn,ms){const id=++next;timers.set(id,{at:at+ms,fn});return id;},clearTimeout(id){timers.delete(id);},advance(ms){at+=ms;for(const [id,t]of [...timers])if(t.at<=at){timers.delete(id);t.fn();}},pending:()=>timers.size};}
(async()=>{
 const timer=clock(),A={stop:false},callbacks=[],sent=[];const c={...timer,A,activeEngine:()=> 'roblox',chrome:{runtime:{sendMessage(msg,cb){sent.push(msg);callbacks.push(cb);}}},isContextInvalidated:m=>/invalidated/.test(m)};vm.createContext(c);vm.runInContext(slice('  function bgRequestTimeoutMs(','  // Proactive stale-extension probe')+'this.bg=bg;this.budget=bgRequestTimeoutMs;',c);
 const stalled=c.bg({type:'call_tool',timeout:20000,name:'execute_luau'});timer.advance(49999);await Promise.resolve();assert.equal(timer.pending(),1);timer.advance(1);assert.equal((await stalled).kind,'timeout');assert.equal(sent.length,1,'A lost worker callback cannot replay a mutation');callbacks[0]({ok:true,text:'late'});assert.equal(timer.pending(),0);
 const healthy=c.bg({type:'call_tool',timeout:300000,name:'studio__long'});assert.equal(c.budget({type:'call_tool',timeout:300000}),330000);callbacks[1]({ok:true,text:'actual result'});assert.equal((await healthy).text,'actual result');assert.equal(timer.pending(),0,'Successful replies clear watchdogs');
 A.stop=true;assert.equal((await c.bg({type:'call_tool'})).kind,'stopped');assert.equal(sent.length,2);A.stop=false;
 const stale=c.bg({type:'status'});c.chrome.runtime.lastError={message:'Extension context invalidated'};callbacks[2]();delete c.chrome.runtime.lastError;assert.equal((await stale).kind,'stale-extension');assert.equal(timer.pending(),0);
 // Resume intent is kept until the old operation actually drains; no old command is replayed.
 const state={injecting:false,starting:false,enhancing:false,started:true,stop:true,userStopped:true,running:true,pendingToolSettles:1,stopMode:'immediate',sessionGen:1,sendToken:'previous'};let hooks,starts=0;const t=clock();let chat='chat';const item={dataset:{zStopped:'1'}};
 const box={...t,A:state,P:{installSendHooks:h=>hooks=h,conversationKey:()=>chat,lastAssistant:()=>item,itemText:()=>'',assistantCount:()=>3},Date:{now:()=>0},isRememberedExecuted:()=>false,ui:{toast(){throw Error('Unexpected timeout');}},cowork:{},bumpSys(){},captureSendToken(){state.sendToken='old-tool';},enforceCondo:()=>false,agentLoop(base){starts++;assert.equal(base,2);state.running=true;state.stop=false;},forgetHalted(){},diag(){},setTimeout:t.setTimeout};vm.createContext(box);
 vm.runInContext(slice('  function scheduleNativeIntent(', '\n  // User-send interception:')+slice('  P.installSendHooks({','\n  // Auto-resume watchdog'),box);
 assert.equal(hooks.isBlocked(),false,'Immediate Stop permits a fresh native user request while the old tool drains');
 hooks.onNativeContinue();assert.equal(state.stop,true,'Continue must not clear the old operation’s Stop latch');
 hooks.onUserMessage(2,'old-tool');t.advance(300);assert.equal(starts,0);state.running=false;t.advance(250);assert.equal(starts,0);state.pendingToolSettles=0;t.advance(250);assert.equal(starts,1);t.advance(1000);assert.equal(starts,1);
 state.running=false;state.stop=true;hooks.onNativeContinue();assert.equal(state.stop,true,'Stop latch remains until scheduled continuation');state.nativeSendIntent=null;
 state.pendingToolSettles=1;hooks.onUserMessage(2,'previous');t.advance(300);chat='different-chat';state.pendingToolSettles=0;t.advance(250);assert.equal(starts,1,'Old chat intent cannot start in another conversation');
 assert(source.includes('finally { clearInterval(stopTimer); clearTimeout(capTimer); }'));
 console.log('PASS silent worker callbacks, actual replies, late replies, no replay, long-tool budgets, Stop/Continue latch, deferred new intent, single resume and chat isolation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
