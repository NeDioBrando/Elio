const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),acorn=require('./release-tools/node_modules/acorn');
const bg=fs.readFileSync('background.js','utf8'),main=fs.readFileSync('core/main.js','utf8');
const tree=acorn.parse(bg,{ecmaVersion:'latest',sourceType:'script'});
const functions=['headlessBlenderControl','blenderPayload','blenderRequest'];
const box={AbortSignal,crypto:require('crypto').webcrypto,RUST_ROBLOX_HTTP:'http://127.0.0.1:3000',agentWorkspaceRoot:async()=>'/workspace',wrapBlenderUserCode:c=>c,blenderShotCode:()=> 'GUI-only screenshot',BLENDER_CMD:{},mode:'headless'};
let requests=[];box.bridgeFetch=async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({ok:true,mode:box.mode})}};
vm.createContext(box);for(const name of functions){const node=tree.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert(node,name);vm.runInContext(bg.slice(node.start,node.end),box);}
(async()=>{
 let payload=await box.blenderPayload('get_viewport_screenshot',{max_size:256});assert.equal(payload.type,'render_preview');assert.equal(payload.params.max_size,256);assert(payload._orReadShot.startsWith('elio_blender_shot_'));assert(!payload.params.code);
 box.mode='desktop';payload=await box.blenderPayload('get_viewport_screenshot',{});assert.equal(payload.type,'execute_code');assert.equal(payload.params.code,'GUI-only screenshot');
 payload=await box.blenderPayload('execute_blender_code',{code:'print(1)',_elio_headless_request_id:'secret'});assert.equal(payload.params.code,'print(1)');assert(!JSON.stringify(payload).includes('secret'));
 await box.headlessBlenderControl({action:'cancel',request_id:'current'});assert.equal(requests.at(-1).body.request_id,'current');assert(requests.at(-1).url.endsWith('/api/blender-headless'));
 box.bridgeFetch=async()=>({ok:false,status:404});await assert.rejects(()=>box.headlessBlenderControl({action:'start'}),/Update Elio.exe/);
 assert(main.includes('rs-headless-start')&&main.includes('rs-headless-stop'));assert(main.includes('BLENDER HEADLESS CONTRACT'));
 assert(/action:"cancel",request_id:blenderRequestId/.test(main));assert(bg.includes('request_id:args?._elio_headless_request_id'));
 for(const file of ['background.js','core/main.js'])assert.equal(fs.readFileSync(file,'utf8'),fs.readFileSync('elio-Extension/'+file,'utf8'));
 console.log('PASS headless extension: authenticated control path, backend-aware PNG, desktop screenshot preserved, internal IDs stripped, scoped Stop, connection controls and source parity.');
})().catch(e=>{console.error(e);process.exitCode=1});
