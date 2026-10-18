const assert=require('assert'),fs=require('fs'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<section class="page active"><div id="creator"></div></section>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost'}),w=dom.window;
 const calls=[],sent=[];w.crypto.randomUUID=require('crypto').randomUUID;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({isPointInPath:()=>false},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};w.confirm=()=>true;
 w.eval(['core/headless-builder.js','core/creator.js','core/creator-ui.js'].map(file=>fs.readFileSync(file,'utf8')).join('\n')+'\nwindow.CreatorUI=elioCreatorUI;');
 const bp={action_id:'test',build_id:'ui-test',mode:'model',operation:'replace',target_parent:'game.Workspace',root_name:'Test',root_id:'root',nodes:[{id:'root',class:'Model',properties:{}},{id:'part',parent:'root',class:'Part',properties:{Size:{type:'Vector3',x:2,y:2,z:2},Position:{type:'Vector3',x:0,y:1,z:0}}}]};let record={blueprint:bp,revision:1,status:'ready',stage:'Shape',updated:Date.now()};
 const api=async req=>{calls.push(req);if(req.action==='list')return {ok:true,records:[{build_id:bp.build_id,name:'Test',mode:'model',nodes:2,revision:record.revision,updated:Date.now(),status:'ready'}],feedback:[]};if(req.action==='read')return {ok:true,record,feedback:[]};if(req.action==='save'){record={...record,blueprint:req.blueprint,revision:record.revision+1};return {ok:true};}return {ok:true};};
 const ui=w.CreatorUI.mount(w.document.getElementById('creator'),api,async text=>(sent.push(text),{ok:true}),async()=>({ok:true}),async()=>({ok:true}),()=>({canTaskSend:true}));await ui.refresh();
 const button=name=>[...w.document.querySelectorAll('button')].find(n=>n.textContent===name);
 assert(w.document.querySelector('.pc-create-view canvas'));assert(w.document.querySelector('.pc-create-revision'));assert(!button('Insert in Studio').disabled);
 button('Blueprint').click();assert(w.document.querySelector('.pc-create-data').textContent.includes('ui-test'));assert(w.document.querySelector('canvas').hidden);button('Preview').click();assert(!w.document.querySelector('canvas').hidden);
 const revision=w.document.querySelector('.pc-create-revision input');revision.value='Make only the roof red.';await button('Revise').onclick();assert(sent[0].includes('Make only the roof red.'));assert(sent[0].includes('only changed stable-ID patches'));assert.equal(revision.value,'');
 w.document.querySelector('textarea').value='A toy house';await button('Create model preview').onclick();assert(sent[1].includes('A toy house'));assert(sent[1].includes('Preview ONLY'));
 const selector=w.document.querySelector('[aria-label="Select a draft element"]');selector.value='part';selector.onchange();await button('Apply color & material').onclick();assert(calls.some(r=>r.action==='save'&&r.revision===1));
 button('Reset view').click();ui.dispose();w.close();console.log('Creator UI: compact layout, preview/blueprint tabs, current-chat revisions, preview-only generation, selection edits and clean disposal passed.');
})().catch(e=>{console.error(e);process.exit(1);});
