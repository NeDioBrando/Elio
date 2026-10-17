const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<div id="host"></div>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 w.eval(fs.readFileSync('core/explorer-ui.js','utf8')+'\nwindow.Explorer=synerixcodeExplorerUI;');let source='print("original")',writes=0,fail=false,session='one';const prefs={rsExplorerAutoSync:true};
 const api=async req=>{if(req.action==='tree')return{ok:true,session,nodes:[{id:'1',name:'ServerScript',class:'Script',script:true,children:false}]};if(req.action==='read')return{ok:true,session,script:true,source,path:'game.ServerScriptService.ServerScript'};writes++;if(fail)throw Error('Connection dropped. Inspect source before retrying.');if(req.expected!==source)throw Error('Source changed in Studio.');source=req.source;return{ok:true,session,source};};
 const host=w.document.getElementById('host'),ui=w.Explorer.mount(host,api,()=>prefs,async patch=>Object.assign(prefs,patch));
 const find=name=>host.querySelector('[data-ex='+name+']'),flush=async()=>{await new Promise(r=>setTimeout(r,10));},edit=value=>{find('editor').value=value;find('editor').dispatchEvent(new w.Event('input'));};
 await ui.refresh();assert.equal(find('auto').checked,true);host.querySelector('.explorer-node').click();await flush();assert.equal(find('editor').value,source);assert.equal(writes,0);
 edit('print("edited")');await ui.push();assert.equal(source,'print("edited")');assert.equal(writes,1);
 find('auto').checked=false;find('auto').dispatchEvent(new w.Event('change'));edit('print("manual")');await new Promise(r=>setTimeout(r,750));assert.equal(writes,1);assert.equal(prefs.rsExplorerAutoSync,false);await ui.push();assert.equal(source,'print("manual")');
 edit('print("draft")');source='print("Studio edit")';await ui.push();assert.equal(source,'print("Studio edit")');assert.equal(find('editor').value,'print("draft")');assert.match(find('status').textContent,/preserved/);
 await ui.refresh();host.querySelector('.explorer-node').click();await flush();assert.equal(find('editor').value,'print("draft")');assert.match(find('status').textContent,/Restored local draft/);assert.equal(writes,3);await ui.push();assert.equal(source,'print("Studio edit")','Restored stale draft cannot overwrite Studio');find('compare').click();await flush();assert.equal(find('studio').textContent,source);await ui.push();assert.equal(source,'print("draft")');
 fail=true;edit('print("uncertain")');find('auto').checked=true;await ui.push();const count=writes;await new Promise(r=>setTimeout(r,750));assert.equal(writes,count,'Ambiguous push must not retry');assert.equal(find('editor').value,'print("uncertain")');
 ui.pause();session='two';await ui.refresh();host.querySelector('.explorer-node').click();await flush();assert.equal(find('editor').value,source,'Old session draft must not cross into new place/session');
 w.close();console.log('PASS Explorer default auto-sync, manual push, source conflict, refresh draft restoration, ambiguous failure and session isolation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
