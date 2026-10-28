// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parse}=require('acorn'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('core/main.js','utf8'),functions={};
function visit(n){if(!n?.type)return;if(n.type==='FunctionDeclaration')functions[n.id.name]=source.slice(n.start,n.end);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v?.type)visit(v);}}visit(parse(source,{ecmaVersion:'latest'}));
(async()=>{
 let checks=0;
 for(const limit of [1000,6000,120000])for(const failures of [0,3]){
  const feedback='Output of read_file:\n'+('Exact 🐔 source\n'.repeat(15000)),images=[{mimeType:'image/png',data:'unchanged'}],sent=[];
  const box={P:{conversationKey:()=>'/test',toolFeedbackMaxChars:100000},A:{pendingImages:images,pendingReference:'Optional '.repeat(4000)},calls:[{tool:'read_file',arguments:{}}],feedback,failedToolAttempts:failures,isErr:false,base:9,activeEngine:()=> 'local',characterLimits:{rsInputLimitEnabled:true,rsInputCharLimit:limit,rsOutputLimitEnabled:true,rsOutputCharLimit:32000},retainedToolResults:new Map(),crypto:require('node:crypto'),personalMemoryContext:()=> 'Saved preference '.repeat(200),lastMemoryContext:'',diag(){},submitAndGetBase:async(text,attachments)=>{sent.push({text,attachments});return 10;}};
  vm.createContext(box);for(const n of ['inputBudget','fitReference','withSysResend','resultPageSize','compressToolFeedback','readRetainedToolResult','prepareToolFeedback'])vm.runInContext(functions[n],box);
  const start=source.indexOf('          const ownMemoryWrite=calls.some('),end=source.indexOf('          markActivity(',start);assert(start>0&&end>start);
  await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',box);
  assert.equal(sent.length,1);assert(sent[0].text.length<=Math.min(limit,100000),'assembled message fits budget');assert.equal(sent[0].attachments,images);assert.equal(box.A.pendingImages,null);assert.equal(box.base,10,'loop continues without const-shadow assignment');
  assert([...box.retainedToolResults.values()].some(r=>r.text===feedback),'complete original result retained');
  const [id,record]=[...box.retainedToolResults].find(([,r])=>r.text===feedback);let offset=0,rebuilt='';do{box.args={id,offset};const page=vm.runInContext('readRetainedToolResult(args)',box),meta=JSON.parse(page.split('\n')[1]);rebuilt+=page.split('\n---RESULT CONTENT---\n')[1];offset=meta.next_offset;}while(offset!==null);assert.equal(rebuilt,record.text);checks++;
 }
 const w=new JSDOM('<div id="root"></div>',{url:'http://localhost',runScripts:'outside-only'}).window;try{
  w.eval(fs.readFileSync('core/vault-ui.js','utf8'));let requests=[];const note={id:'a'.repeat(24),title:'Inventory',scope:'project:Test',category:'Systems',status:'unreviewed',tags:[],evidence:[],text:'Exact\n\nparagraph',revision:1,etag:'v1',updated:'2026-01-01',source:'test',reference_images:[]};
  const api=async req=>{requests.push(req);const result={ok:true};switch(req.action){case 'projects':return {...result,projects:['project:Test']};case 'state':return {...result,version:'1',automatic:true,count:1};case 'list':return {...result,notes:[note],total:1,next_offset:null};case 'read':return {...result,note,backlinks:[]};case 'audit':return {...result,items:[{note,reasons:['not verified']}]};case 'graph':return {...result,nodes:[note],edges:[],unresolved_links:{}};default:return result;}};
  const host=w.document.getElementById('root'),view=w.elioVaultUI.mount(host,api,{scope:()=> 'project:Test'});await view.refresh();await new Promise(r=>setTimeout(r,40));host.querySelector('[data-view="audit"]').click();await new Promise(r=>setTimeout(r,10));assert.match(host.querySelector('[data-content]').textContent,/not verified/);host.querySelector('[data-view="graph"]').click();await new Promise(r=>setTimeout(r,10));assert(host.querySelector('svg circle'));assert([...host.querySelectorAll('button')].some(b=>b.textContent==='Grid'));assert(host.querySelector('[data-obsidian]'));view.destroy();checks++;
 }finally{w.close();}
 for(const name of ['main.js','vault-ui.js','task-center.js','build-info.json'])assert.equal(fs.readFileSync('core/'+name,'utf8'),fs.readFileSync('elio-Extension/core/'+name,'utf8'));
 assert.equal(fs.readFileSync('background.js','utf8'),fs.readFileSync('elio-Extension/background.js','utf8'));
 console.log(`PASS upstream merge: ${checks} runtime scenarios; full result paging, final message budgets, continued loop/image delivery, memory review/graph lifecycle and mirrored source.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
