const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('core/main.js','utf8');
const start=source.indexOf('          const toSend = withSysResend(feedback)');
assert(start>=0);
const end=source.indexOf('          markActivity(',start);
const code=source.slice(start,end);
async function check(feedback,images,failures=0,kind){
 const sent=[];const box={P:{},feedback,failedToolAttempts:failures,A:{pendingImages:images,requestKind:kind},base:9,withSysResend:text=>text+'\nSaved memory context',diag(){},ui:{banner(){}},submitAndGetBase:async(text,attachments)=>{sent.push({text,attachments});return 10;}};
 vm.createContext(box);
 // Load the real provider-feedback helper used by the production send block.
 vm.runInContext(source.slice(source.indexOf('  function prepareToolFeedback('),source.indexOf('  async function attachAutoDebug(')),box);
 await vm.runInContext('(async()=>{for(let i=0;i<1;i++){'+code+'}})()',box);
 if(failures<3){assert.equal(sent.length,1);if(kind==='quick'){assert(sent[0].text.startsWith(feedback+'\nSaved memory context'));assert(sent[0].text.includes('quick user request'));}else assert.equal(sent[0].text,feedback+'\nSaved memory context');assert.equal(sent[0].attachments,images);assert.equal(box.base,10);}else{assert.equal(sent.length,1);assert(sent[0].text.startsWith(feedback+'\nSaved memory context'));assert(sent[0].text.includes('try a different approach'));assert.equal(box.base,10);}
 assert.equal(box.A.pendingImages,null);
}
(async()=>{await check("Output of 'read_file':\n1 | exact text",null);await check('ERROR: script not found',null,1);await check('Screenshot result',[{data:'exact image'}]);await check('ERROR: third failure',null,3);await check("Output of 'list_commands':\nread_file",null,0,'quick');assert(!source.includes('if (A.toolCallsSinceReminder >= REMIND_TOOLS_EVERY)'));console.log('Actual tool-feedback send block delivers success/error/images once, retains changed memory context, and keeps running after repeated failures with a change-approach note without scheduled reminders.');})().catch(e=>{console.error(e);process.exitCode=1;});
