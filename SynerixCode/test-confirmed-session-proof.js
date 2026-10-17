const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('core/main.js','utf8');
const code=source.slice(source.indexOf('        // A confirmed internal result'),source.indexOf('        if(typeof synerixcodeUltracode',source.indexOf('        // A confirmed internal result')));
function run(overrides={}){
 const remembered=[],states=[],box={A:{sessionGen:2,enhancing:false,started:false},userPrompt:false,generation:2,chat:'thread-one',payload:"Output of 'script_read':\nexact result",P:{conversationKey:()=> 'thread-one'},RS:{SYS_MARKER:'⟦RS-SYS⟧'},RSParse:{isInjectedFeedback:t=>/^Output of '/.test(t)},rememberSession:k=>remembered.push(k),ui:{setStarted:x=>states.push(x)},...overrides};
 vm.createContext(box);vm.runInContext(code,box);return {box,remembered,states};
}
let r=run();assert.deepEqual(r.remembered,['thread-one']);assert.equal(r.box.A.started,true);assert.deepEqual(r.states,[true]);
assert.deepEqual(run({chat:''}).remembered,['thread-one'],'Initial route can acquire a real thread ID');
for(const overrides of [{userPrompt:true},{payload:'Hello'},{payload:'{"command":"script_read"}'},{generation:1},{chat:'different-thread'},{P:{conversationKey:()=>''}},{A:{sessionGen:2,enhancing:true,started:false}},{A:{sessionGen:2,starting:true,started:false}}])assert.deepEqual(run(overrides).remembered,[]);
assert.deepEqual(run({payload:'⟦RS-SYS⟧ reminder'}).remembered,['thread-one']);
assert.deepEqual(run({payload:'⟦RS-SYS⟧ startup',A:{sessionGen:2,starting:true,started:false}}).remembered,[],'Only the completed startup handshake may mark startup ready');
console.log('Confirmed internal delivery persists current-session proof despite immediate virtualization; user text, command examples, other chats, Stop generations and enhancement cannot arm a session.');
