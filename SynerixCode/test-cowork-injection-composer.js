const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.SYNERIXCODE_TEST_JSDOM||'jsdom');
const source=fs.readFileSync('core/main.js','utf8'),start=source.indexOf('    function renderCoworkComposer('),end=source.indexOf('    function inputCover(',start);
const dom=new JSDOM('<div id="cover"><span id="rs-working-label">Agent is working…</span></div>',{runScripts:'outside-only'}),w=dom.window;
const queued=[];let context='one',enabled=true;
Object.assign(w,{cover:w.document.querySelector('#cover'),coworkComposer:null,coworkCoverDrafts:new Map(),coworkCoverContext:()=>context,A:{started:true,staleExtension:false,running:true},cowork:{enqueue:text=>{if(!enabled)return{ok:false,error:'Turn Co-work on first.'};queued.push(text);return{ok:true};}},toast(){},renderCowork(){},pumpCowork(){},inputCover(){}});
try {
 vm.runInContext(source.slice(start,end)+';this.render=renderCoworkComposer;',dom.getInternalVMContext());
 w.render(true);const c=w.coworkComposer;
 assert.equal(c.host.shadowRoot,null);assert.equal(w.document.querySelector('textarea'),null,'Provider searches cannot select the independent draft');
 c.editor.value='Add a door';c.editor.dispatchEvent(new w.Event('input'));w.render(false);w.render(true);assert.equal(c.editor.value,'Add a door');
 context='two';w.render(true);assert.equal(c.editor.value,'');context='one';w.render(true);assert.equal(c.editor.value,'Add a door');
 c.editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}));assert.equal(queued.length,0);
 enabled=false;c.editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(c.editor.value,'Add a door');
 enabled=true;c.editor.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.deepEqual(queued,['Add a door']);assert.equal(c.editor.value,'');assert.equal(w.coworkCoverDrafts.has('one'),false);
 assert.equal(w.document.querySelector('#rs-working-label').hidden,true);
 console.log('Co-work remains editable during feedback injection, isolates native provider writes, retains context-bound drafts and clears only accepted follow-ups.');
}finally{w.close();}
