const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/core/main.js','utf8');
const action='const coworkAccepted=new Map();'+source.slice(source.indexOf('    function desktopAgentAction('),source.indexOf('    return { captureHandoff,'));
let submitted='',saved=false;
const ctx={setInterval(){},rsInterval(){},A:{},P:{conversationKey:()=>'/c/known',lastAssistant:()=>null,setInputLock(){}},desktopAgentState:()=>({canEnhance:true}),ui:{showStop(){},inputCover(){},toast(){}},refreshPersonalMemory:async()=>{saved=true},submitAndGetBase:async t=>{submitted=t;return 0},waitForResponse:async()=>({kind:'text'}),rememberExecuted(){}};
vm.createContext(ctx);vm.runInContext(action+'this.action=desktopAgentAction',ctx);
(async()=>{
 const result=ctx.action('memory-import',JSON.stringify({context:'{"history":[]}',memory:{entries:[{text:'Use ExactCase in C:\\Game\\Path.lua'}]},importMemory:false}));
 assert(result.ok);await new Promise(r=>setTimeout(r,0));assert(submitted.includes('ExactCase'));assert(submitted.includes('reference only'));assert(!saved);
 submitted='';const tooBig=ctx.action('memory-import',JSON.stringify({context:'x'.repeat(39999),memory:{entries:[{text:'a'.repeat(999)}]},importMemory:true}));assert(!tooBig.ok);assert(!submitted);assert(!saved);
 submitted='';saved=false;
 const large=ctx.action('memory-import',JSON.stringify({context:'{"history":[]}',memory:{entries:[{text:'A'.repeat(500000)}]},importMemory:true}));assert(large.ok);await new Promise(r=>setTimeout(r,0));assert(saved);assert(submitted.length<10000);assert(submitted.includes('Full imported notes'));assert(submitted.includes('action list'));
 submitted='';saved=false;const overflow=ctx.action('memory-import',JSON.stringify({context:'history',memory:{entries:[{text:'A'.repeat(500000)},{text:'B'}]},importMemory:true}));assert(!overflow.ok);assert(!saved);assert(!submitted);
 console.log('Actual import handler keeps 500,000-character notes in durable memory, sends bounded excerpts, preserves exact facts, and rejects aggregate overflow before saving/sending.');
})().catch(e=>{console.error(e);process.exitCode=1});
