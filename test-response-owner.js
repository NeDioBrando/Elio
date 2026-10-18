// No network/bridge: exercise the exact production dispatch fence and memory.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const main=fs.readFileSync('core/main.js','utf8');
const fence=main.slice(main.indexOf('  function verifyResponseOwner('),main.indexOf('  async function waitForResponse('));
const memory=main.slice(main.indexOf('  const executed = new Map();'),main.indexOf('  function isRememberedExecuted('));
const first={dataset:{}},second={dataset:{}};let item=first,token=0,chat='chat-a',live='';
const A={sessionGen:4,sendToken:'before'};
const P={conversationKey:()=>chat,lastAssistantId:()=>token,lastAssistant:()=>item,itemText:()=>live};
const box={A,P,assistantIdx:el=>el===item?0:-1,turnKey:()=>String(token)};
vm.createContext(box);vm.runInContext(fence+memory+';this.verify=verifyResponseOwner;this.remember=rememberExecuted;this.records=executed;',box);
const cmd='{"command":"elio_status","params":{}}';
const make=()=>({item:first,text:cmd,responseOwner:{session:4,sendToken:'before',token:0,chat:'chat-a',item:first}});
let count=0;function check(name,fn){fn();count++;console.log('PASS',name);}
check('numeric zero identity and verified remount',()=>{item=second;const r=make();assert(box.verify(r));assert.equal(r.item,second);});
check('blank live body records EXACT parsed source',()=>{const r=make();assert(box.verify(r));box.remember(r.item,r.text);assert.equal(box.records.get('chat-a|0'),cmd.slice(0,60));});
check('explicit empty capture cannot borrow another live body',()=>{box.records.clear();live=cmd;box.remember(item,'');assert.equal(box.records.size,0);live='';});
for(const [name,change,restore] of [
 ['token change',()=>token='other',()=>token=0],
 ['route change',()=>chat='other',()=>chat='chat-a'],
 ['missing route',()=>chat=null,()=>chat='chat-a'],
 ['session change',()=>A.sessionGen++,()=>A.sessionGen=4],
 ['send change',()=>A.sendToken='different',()=>A.sendToken='before'],
 ['historical token',()=>token='before',()=>token=0],
 ['missing live item',()=>item=null,()=>item=second],
])check(name+' blocks dispatch without dedupe pollution',()=>{box.records.clear();const r=make();change();assert.equal(box.verify(r),false);assert.equal(box.records.size,0);restore();});
check('missing identity cannot rebind across nodes',()=>{token=null;const r=make();r.responseOwner.token=null;assert.equal(box.verify(r),false);item=first;assert(box.verify(r));token=0;});
check('two independently verified turns may contain identical commands',()=>{box.records.clear();item=first;for(const tok of [0,1]){token=tok;const r=make();r.responseOwner.token=tok;assert(box.verify(r));box.remember(r.item,r.text);}assert.equal(box.records.size,2);token=0;});
// Assert the guard is after the async parking point and before side effects.
const park=main.indexOf('diag("tool.parkBeforeDispatch"');
const guard=main.indexOf('if (res.responseOwner && !verifyResponseOwner(res))',park);
assert(guard>park&&guard<main.indexOf('rememberExecuted(res.item, res.text)',park));
assert(main.includes('text: txt,\n              chat:'));
console.log('PASS',count,'ownership/memory cases and production dispatch ordering');
