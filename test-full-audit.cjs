// SPDX-License-Identifier: GPL-3.0-or-later
// Behavioral regressions for the full source audit (no external service needed).
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const reliability=require('./core/reliability.js'),chat=require('./core/chat-view.js');
(async()=>{
 let checks=0;
 const guard=require('./core/tool-guard.js');
 for(const schema of [{required:{}},{required:[{}]},{enum:{}},{anyOf:{}},{oneOf:'bad'},{allOf:[null]},{properties:[]}]){assert(guard.check({tool:'fixture',arguments:{}},[{name:'fixture',inputSchema:schema}]).length>0);checks++;}
 assert.equal(guard.validate({}, {anyOf:[false,{type:'object'}]}).length,0);assert(guard.validate({}, {allOf:[false,{type:'object'}]}).length>0);checks+=2;
 const task='Исправь зависание агента и сохрани изменения';
 for(const history of [[],[{role:'assistant',text:'Checked.'}],[{role:'user',text:"Output of 'execute_luau': {}"}]]){
  const transfer=reliability.handoff({request:task,history});assert.equal(reliability.canContinue(transfer),true);assert(transfer.history[0].text.includes(task));checks++;
 }
 for(const request of ['',"Output of 'execute_luau': {}",'⟦RS-SYS⟧ status']){assert.equal(reliability.canContinue(reliability.handoff({request})),false);checks++;}
 assert.equal(chat.present({role:'user',text:'ERROR: connection lost'}).status,'error');checks++;
 const command=name=>JSON.stringify({command:name,arguments:{}});
 const rows=chat.prepare([{role:'assistant',text:command('one')+'\n'+command('two')},{role:'user',text:"Output of 'one': ERROR: failed"},{role:'user',text:"Output of 'two': ok"}]);
 assert.equal(rows[0].status,'error');assert.equal(rows[0].segments.filter(x=>x.type==='tool')[0].status,'error');checks++;
 const partial=chat.prepare([{role:'assistant',text:command('one')+'\n'+command('two')},{role:'user',text:"Output of 'one': ok"}]);assert.notEqual(partial[0].status,'done');checks++;
 const success=chat.prepare([{role:'assistant',text:command('one')+'\n'+command('two')},{role:'user',text:"Output of 'one': ok"},{role:'user',text:"Output of 'two': ok"}]);assert.equal(success[0].status,'done');checks++;
 for(const reject of [false,true]){
  const w=new JSDOM('<div id="host"></div>',{runScripts:'outside-only',url:'http://localhost'}).window;
  try{
   w.eval(fs.readFileSync('core/version.js','utf8')+'\nwindow.elioVersion=elioVersion;');let settle;const promise=new Promise((resolve,no)=>{settle=reject?()=>no(Error('Offline')):()=>resolve({phase:'error',error:'Offline'});});
   const host=w.document.getElementById('host');const view=w.elioVersion.mount(host,{current:'1.0.1',getStatus:()=>promise,invoke:async()=>{}});
   view.destroy();settle();await new Promise(r=>setTimeout(r,5));assert.equal(host.childNodes.length,0);await view.refresh();view.destroy();checks++;
  }finally{w.close();}
 }
 for(const f of ['core/reliability.js','core/chat-view.js','core/version.js','core/tool-guard.js'])assert.equal(fs.readFileSync(f,'utf8'),fs.readFileSync('elio-Extension/'+f,'utf8'));
 console.log(`PASS full audit: ${checks} behavioral scenarios — continuation, error/pending cards, destroyed update UI, source parity.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
