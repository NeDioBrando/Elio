// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{parse}=require('acorn');
const source=fs.readFileSync('core/main.js','utf8'),functions={};
function walk(n){if(!n?.type)return;if(n.type==='FunctionDeclaration')functions[n.id.name]=source.slice(n.start,n.end);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v?.type)walk(v);}walk(parse(source,{ecmaVersion:'latest'}));
const start=source.indexOf('          const ownMemoryWrite=calls.some('),end=source.indexOf('          markActivity(',start);assert(start>=0&&end>start);
async function check(feedback,images,failures=0,kind){
 const sent=[];const box={P:{},feedback,failedToolAttempts:failures,isErr:feedback.startsWith('ERROR'),A:{pendingImages:images,requestKind:kind},calls:[{tool:'read_file',arguments:{}}],base:9,characterLimits:{rsInputLimitEnabled:true,rsInputCharLimit:6000},activeEngine:()=> 'local',personalMemoryContext:()=> 'Saved preference',lastMemoryContext:'',retainedToolResults:new Map(),crypto:require('crypto'),diag(){},submitAndGetBase:async(text,attachments)=>{sent.push({text,attachments});return 10;}};
 vm.createContext(box);for(const n of ['inputBudget','fitReference','withSysResend','resultPageSize','compressToolFeedback','readRetainedToolResult','prepareToolFeedback'])vm.runInContext(functions[n],box);
 await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',box);
 assert.equal(sent.length,1);assert(sent[0].text.startsWith(feedback));assert(sent[0].text.includes('Saved preference'));assert(sent[0].text.length<=6000);assert.equal(sent[0].attachments,images);assert.equal(box.base,10);assert.equal(box.A.pendingImages,null);
 if(failures>=3)assert(sent[0].text.includes('try a different approach'));
 if(kind==='quick')assert(!sent[0].text.includes('quick user request'),'optional reminders do not add recurring overhead');
}
(async()=>{await check("Output of 'read_file':\n1 | exact text",null);await check('ERROR: script not found',null,1);await check('Screenshot result',[{data:'exact image'}]);await check('ERROR: third failure',null,3);await check("Output of 'list_commands':\nread_file",null,0,'quick');assert(!source.includes('if (A.toolCallsSinceReminder >= REMIND_TOOLS_EVERY)'));console.log('PASS actual feedback send: success/errors/images, changed memory context, continued loop after repeated failures, no recurring quick-request reminder.');})().catch(e=>{console.error(e);process.exitCode=1;});
