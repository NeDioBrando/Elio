// A bridge request already written to the socket must not be resent when the
// socket closes (desktop restart, automatic update, crash): the bridge may have
// executed it. Previous versions resolved it as "disconnected" and send()
// resent it, which could run execute_luau or a file write twice.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const bg=fs.readFileSync('background.js','utf8');
const slice=(from,to)=>{const a=bg.indexOf(from),b=bg.indexOf(to,a);assert(a>=0&&b>a,from);return bg.slice(a,b);};
const code=slice('async function send(','// Ask the bridge whether')+slice('const RESEND_AFTER_LOSS','// ── status push');
const main=fs.readFileSync('core/main.js','utf8');
const box={WebSocket:{OPEN:1},connected:true,pending:new Map(),nextId:1,sent:[],waits:0,setTimeout,clearTimeout,
  ws:null,waitForConnection:async()=>{box.waits++;box.connected=true;box.ws=makeSocket();}};
function makeSocket(){return {readyState:1,send(raw){box.sent.push(JSON.parse(raw));}};}
box.ws=makeSocket();vm.createContext(box);vm.runInContext(code+';globalThis.send=send;globalThis.failAllPending=failAllPending;',box);
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
  // Mutation in flight when the socket closes: one send, reported as lost.
  const call=box.send({type:'call_tool',name:'execute_luau',arguments:{code:'Instance.new("Part").Parent=workspace'}},5000);
  await tick();assert.equal(box.sent.length,1);
  box.connected=false;box.failAllPending('bridge connection closed');
  const lost=await call;
  assert.equal(lost.kind,'lost');assert.equal(lost.ok,false);
  assert.equal(box.sent.filter(m=>m.type==='call_tool').length,1,'execute_luau must never be resent after an in-flight loss');
  assert.equal(box.waits,0);
  // Read-only request lost in flight is resent once after reconnect.
  box.connected=true;box.ws=makeSocket();box.sent.length=0;
  const tools=box.send({type:'list_tools'},5000);await tick();
  box.connected=false;box.failAllPending('bridge connection closed');await tick();await tick();
  assert.equal(box.waits,1);assert.equal(box.sent.length,2,'list_tools is resent');
  const id=box.sent[1].id;const p=box.pending.get(id);clearTimeout(p.timer);box.pending.delete(id);p.resolve({ok:true,tools:[]});
  assert.equal((await tools).ok,true);
  // A request that never reached the socket is still retried (nothing ran).
  box.connected=false;box.ws=null;box.sent.length=0;box.waits=0;
  const later=box.send({type:'call_tool',name:'get_file_tree',arguments:{}},5000);
  for(let i=0;i<4&&!box.sent.length;i++)await tick();
  assert.equal(box.sent.length,1,'unsent request goes out once the bridge is back');
  const p2=box.pending.get(box.sent[0].id);clearTimeout(p2.timer);box.pending.delete(box.sent[0].id);p2.resolve({ok:true,text:'tree'});
  assert.equal((await later).text,'tree');
  // The content script turns a lost command into a verify-first error.
  const feedback=main.slice(main.indexOf('if (r.kind === "lost")'),main.indexOf('if (r.kind === "timeout")',main.indexOf('if (r.kind === "lost")')));
  assert(/did NOT repeat it/.test(feedback)&&/Inspect the current state/.test(feedback));
  // A tool timeout is also uncertain: the code may still finish in Studio.
  const tmo=main.slice(main.indexOf('if (r.kind === "timeout")'),main.indexOf('if (r.kind === "timeout")')+600);
  assert(/did NOT repeat it/.test(tmo)&&/Inspect the current state/.test(tmo),'timeout feedback is verify-first');
  console.log('PASS: in-flight bridge commands are never resent after a socket loss; read-only requests and unsent commands still recover.');
})().catch(e=>{console.error(e);process.exitCode=1;});
