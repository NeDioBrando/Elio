// Production ClickUp/core/parser, simulated AI, isolated bridge. No live project.
const {chromium,firefox}=require('playwright'),assert=require('node:assert/strict');
const {pageFor}=require('./test-clickup-browser.cjs');
async function check(browser,name){
 const {page,errors}=await pageFor(browser,false,true);
 page.on("pageerror",e=>console.log("fixture page error: "+e.message));
 const result=await page.evaluate(async()=>{
  await fixture.startSession();if(!fixture.A.started)throw Error('Startup failed');
  const notices=[],banner=fixture.ui.banner;fixture.ui.banner=(...args)=>{notices.push(args);return banner(...args);};
  const a=fixture.A,extra=Array.from({length:20},(_,i)=>({name:'blender_fixture_'+i,server:'blender',description:'Full schema '+i+' '+('precise Unicode 🧪 parameter rules; '.repeat(45)),inputSchema:{type:'object',properties:{code:{type:'string',description:'Complete code; preserve every character.'}},required:['code']}}));
  a.toolList.push(...extra);a.toolsAt=Date.now();
  const scene='SCENE RESULT\n'+('🧪 Exact object names, materials and geometry data.\n'.repeat(950))+'END OF SCENE';
  const nativeSend=chrome.runtime.sendMessage;
  chrome.runtime.sendMessage=(msg,cb)=>{
   if(msg.type==='call_tool'&&msg.name==='execute_blender_code'){
    nativeCalls.push(msg);const value={ok:true,text:scene};if(cb)queueMicrotask(()=>cb(value));return Promise.resolve(value);
   }
   return nativeSend(msg,cb);
  };
  const blender=await fixture.runTool({tool:'list_commands',arguments:{server:'blender'}});
  const roblox=await fixture.runTool({tool:'list_commands',arguments:{server:'roblox'}});
  if(blender.length<18000||roblox.length<18000)throw Error('References must exceed the old ClickUp bound');
  const steps=[
   {request:{command:'execute_blender_code',params:{code:'print("large-scene-fixture")'}},expected:"Output of 'execute_blender_code':\n"+scene},
   {request:{command:'list_commands',server:'blender'},expected:blender},
   {request:{command:'list_commands',params:{server:'roblox'}},expected:roblox},
   {request:{command:'execute_luau',params:{code:'return game:GetService("StarterGui"):GetChildren()'}},expected:null}
  ];
  const first=steps.shift();let current=first,restored='',pages=0,reads=0;const restoredResults=[];
  const button=provider.composerFrame().querySelector('[data-test="refinement-prompt-submit-button"]'),send=button.onclick;
  autoReply=false;
  button.onclick=e=>{
   send(e);const text=sent.at(-1).text;let next;
   const retained=text.match(/^\[elio retained the COMPLETE result\.[^\n]*id:"([^"]+)",offset:(\d+)/);
   if(retained){const offset=Number(retained[2]);restored=text.slice(text.indexOf('\n')+1,text.indexOf('\n')+1+offset);pages++;next={command:'elio_result_read',params:{id:retained[1],offset,limit:1000000}};}
   else if(text.startsWith("Output of 'elio_result_read':\n")){
    const split=text.indexOf('\n---RESULT CONTENT---\n'),meta=JSON.parse(text.slice(text.indexOf('\n')+1,split));
    const end=meta.next_offset??meta.total_characters;restored+=text.slice(split+22,split+22+end-meta.offset);pages++;reads++;
    if(meta.next_offset!==null)next={command:'elio_result_read',params:{id:meta.id,offset:meta.next_offset,limit:1000000}};
   }
   if(!next){if(current.expected){if(!restored.startsWith(current.expected)||!restored.slice(current.expected.length).startsWith('\n[SYSTEM_STATE:'))throw Error('Paged result changed or wrong server catalog: '+current.request.command+' (got '+restored.length+', expected body '+current.expected.length+')');restoredResults.push(restored);restored='';}current=steps.shift();next=current?.request;}
   addItem('assistant',next?'```json\n'+JSON.stringify(next)+'\n```':'Fixture task complete.','result-sequence-'+sent.length);
  };
  const before=sent.length,base=provider.assistantCount();
  addItem('user','Build an interactive Roblox shop using Blender models and the exact available schemas.','user-fixture-task');
  addItem('assistant','```json\n'+JSON.stringify(first.request)+'\n```','first-tool');
  await fixture.agentLoop(base);
  const owned=provider.allItems().filter(x=>provider.isUserItem(x)&&(/^(?:\[elio retained|Output of 'elio_result_read')/.test(provider.itemText(x))));
  for(const row of owned)row.classList.remove('rs-hidden');
  provider.enforceComposer();
  const masked=owned.length>0&&owned.every(row=>getComputedStyle(row.querySelector('[data-test="chat-item-content-area__message-body"]')).display==='none');
  return {notices,masked,messages:sent.slice(before).map(x=>x.text),calls:nativeCalls.map(x=>({name:x.name,args:x.arguments})),pages,reads,restored:restoredResults.map(x=>({length:x.length,gui:x.includes('ui_create_screen')&&x.includes('ui_create_component'),blender:x.includes('blender_fixture_19')})),running:a.running,editable:provider.getEditor().getAttribute('contenteditable')};
 });
 assert.deepEqual(result.notices,[],JSON.stringify(result.notices));
 assert.equal(result.restored.length,3,JSON.stringify(result));assert(result.restored[1].blender);assert(result.restored[2].gui);
 assert(result.messages.every(x=>x.length<18000));assert(result.reads>3);
 assert(result.masked,'paged tool feedback stays masked after host class resets');
 assert.equal(result.calls.filter(x=>x.name==='execute_blender_code').length,1,'never rerun the Blender operation to retrieve pages');
 assert.equal(result.calls.filter(x=>x.name==='execute_luau'&&x.args.code.includes('StarterGui')).length,1,'UI inspection command dispatched once');
 assert(!result.running);assert.equal(result.editable,'true');assert.deepEqual(errors,[]);
 console.log('PASS '+name+' full core: large Blender result, top-level Blender catalog, complete Roblox GUI catalog, exact retained pages and one dispatch per operation');
 await page.close();
}
(async()=>{for(const [name,engine]of [['chromium',chromium],['firefox',firefox]]){
 if(process.env.ELIO_TEST_BROWSER&&process.env.ELIO_TEST_BROWSER!==name)continue;
 const browser=await engine.launch({headless:true,...(name==='chromium'&&process.env.ELIO_CHROMIUM?{executablePath:process.env.ELIO_CHROMIUM}:{}),args:name==='chromium'?['--no-sandbox']:[]});
 let timer;try{await Promise.race([check(browser,name),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ClickUp result fixture timed out')),240000);})]);}finally{clearTimeout(timer);await browser.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
