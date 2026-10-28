const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('core/main.js','utf8');
const wrapper=src.slice(src.indexOf('  async function runTool(call)'),src.indexOf('  async function runToolImpl(call)'));
class SendAbortedError extends Error {}
const A={stop:false};let calls=0;
const c={A,SendAbortedError,setInterval,clearInterval,Promise,runToolImpl:async()=>{calls++;throw new Error('Studio transport disconnected');}};
vm.createContext(c);vm.runInContext(wrapper+'this.run=runTool;',c);
(async()=>{
 const capture=src.indexOf('const toolResponseId =');
 assert(capture>0 && capture<src.indexOf('try { feedback = await runTool(call); }'),'Response identity must be captured before tool execution');
 assert(src.includes('count: toolResponseCount') && src.includes('id: toolResponseId'),'Settle must use the dispatched response, never the latest response after awaiting');
 const failure=await c.run({tool:'execute_luau'});
 assert.match(failure,/^ERROR:/);assert.match(failure,/Studio transport disconnected/);assert.match(failure,/inspect/i);
 assert.equal(calls,1,'Never replay an uncertain mutation');
 c.runToolImpl=async()=> 'Output: recovered';assert.equal(await c.run({tool:'inspect_instance'}),'Output: recovered');
 c.runToolImpl=async()=>{throw new SendAbortedError('User stopped');};await assert.rejects(c.run({}),SendAbortedError);
 c.runToolImpl=async()=>undefined;assert.match(await c.run({}),/^ERROR:/,'Malformed output must not crash includes() downstream');
 c.runToolImpl=()=>{throw new Error('synchronous dispatch failure');};assert.match(await c.run({}),/^ERROR:/);
 console.log('Tool exceptions become actionable feedback; next inspection runs, no replay, cancellation preserved, malformed output bounded.');
})().catch(e=>{console.error(e);process.exitCode=1;});
