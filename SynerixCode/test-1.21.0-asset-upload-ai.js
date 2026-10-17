// Regression for 1.21.0: the AI can upload assets to Studio (fails on 1.20.0: no studio_upload_asset tool).
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=__dirname;let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('PASS '+name);}else{fail++;console.log('FAIL '+name);}}
const main=fs.readFileSync(path.join(root,'core','main.js'),'utf8');
const mainExt=fs.readFileSync(path.join(root,'synerixcode-Extension','core','main.js'),'utf8');
const bg=fs.readFileSync(path.join(root,'background.js'),'utf8');
const bgExt=fs.readFileSync(path.join(root,'synerixcode-Extension','background.js'),'utf8');
ok('main.js copies match',main===mainExt);
ok('background.js copies match',bg===bgExt);
for(const [n,s] of [['main.js',main],['background.js',bg]]){let c=true;try{new vm.Script(s);}catch(e){c=false;console.log(e.message);}ok(n+' compiles',c);}
ok('tool is in the desktop tool list',main.includes('"asset_bridge_import", "studio_upload_asset",'));
ok('tool has a description',main.includes('studio_upload_asset: "Upload (insert) a Roblox asset'));
ok('tool schema lists every type',main.includes("enum:['model','mesh','animation','sound','image','texture','video','package']"));
ok('tool handler sends typed insert',main.includes('type: "rs-toolkit", request: { action: "insert-typed-asset"'));
ok('tool errors are labelled',main.includes('ERROR in studio_upload_asset: '));
ok('background forwards to /api/toolkit',bg.includes('case "rs-toolkit": {')&&bg.includes('127.0.0.1:3000/api/toolkit'));
ok('background allows only asset uploads',bg.includes('if (request.action !== "insert-typed-asset")'));
// behaviour: run the background case logic in isolation
const start=bg.indexOf('case "rs-toolkit": {'),end=bg.indexOf('case "rs-memory":',start);
const body=bg.slice(start+'case "rs-toolkit": {'.length,end).replace(/break;\s*}\s*$/,'');
(async()=>{
  const calls=[];let out;
  const run=new Function('msg','sendResponse','bridgeFetch','return (async()=>{switch(1){case 1:{'+body+'}}})();');
  await run({request:{action:'restore',id:'x'}},v=>out=v,async()=>{calls.push(1);});
  ok('restore is refused from chat',out&&out.ok===false&&calls.length===0);
  await run({request:{action:'insert-typed-asset',kind:'sound',asset_id:'123'}},v=>out=v,async(u,o)=>{calls.push(JSON.parse(o.body));return {ok:true,json:async()=>({ok:true,text:'Added Sound'})};});
  ok('upload forwarded with kind and id',calls.length===1&&calls[0].kind==='sound'&&calls[0].asset_id==='123'&&out.text==='Added Sound');
  await run({request:{action:'insert-typed-asset',kind:'bad',asset_id:'1'}},v=>out=v,async()=>({ok:false,json:async()=>({ok:false,error:'Choose an asset type'})}));
  ok('bridge errors returned',out.ok===false&&/Choose an asset type/.test(out.error));
  console.log('\n'+pass+' passed, '+fail+' failed');process.exit(fail?1:0);
})();
