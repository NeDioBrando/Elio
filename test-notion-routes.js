// Notion AI route model: /ai and /chat landings, ?t= threads, benign vs payload query params,
// and the startup hard-navigation fallback. Fixture only; not a signed-in Notion test.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const html='<main><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><div role="button" data-testid="agent-chat-send-button" aria-label="Submit AI message">Send</div></section></main>';
function boot(url,body=html){
  const dom=new JSDOM(body,{url,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:200,top:600,width:650,height:40,right:850,bottom:700};};
  vm.runInContext(fs.readFileSync('providers/notion.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());
  w.provider.init({isStopped:()=>false});return {dom,w,p:w.provider};
}
const cases=[
  // url, fresh landing?, conversationKey
  ['https://app.notion.com/ai',true,''],
  ['https://app.notion.com/ai?wfv=chat',true,''],
  ['https://app.notion.com/chat',true,''],
  ['https://app.notion.com/chat?wfv=chat&v=abc',true,''],
  ['https://app.notion.com/chat?t=thread-1',false,'/chat?t=thread-1'],
  ['https://app.notion.com/chat/thread-2',false,'/chat/thread-2'],
  ['https://app.notion.com/ai?q=Summarize+this',true,''],
  ['https://app.notion.com/ai?defaultUserMessage=hi',true,''],
  ['https://app.notion.com/p/Welcome-123',false,''],
];
(async()=>{
  for(const [url,fresh,key] of cases){
    const {dom,w,p}=boot(url);
    try{
      assert.equal(!!p.isFreshChat(),fresh,url+' isFreshChat (landing + empty + composer)');
      assert.equal(p.conversationKey()||'',key,url+' conversationKey');
      if(new URL(url).pathname.startsWith('/p/'))assert.equal(p.getEditor(),null,'normal pages are never an AI surface');
    }finally{w.close();}
  }
  // two different ?t= threads must not share one saved-chat key
  const a=boot('https://app.notion.com/chat?t=a'),b=boot('https://app.notion.com/chat?t=b');
  assert.notEqual(a.p.conversationKey(),b.p.conversationKey());a.w.close();b.w.close();
  // Launch-payload landings are never a start target (they would auto-submit a foreign first message).
  for(const bad of ['/ai?q=hi','/ai?defaultUserMessage=hi','/chat?aiAction=x']){const {w,p}=boot('https://app.notion.com'+bad,'<a href="/ai" style="display:block">x</a>'+html);w.HTMLAnchorElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,width:80,height:20,right:80,bottom:20};};w.document.querySelector('a').addEventListener('click',e=>e.preventDefault());const r=await p.prepareSessionStart('startup');assert.equal(r.navigating,true,bad);w.close();}
  // A clean /chat landing is a valid start target: no navigation, composer ready.
  {const {w,p}=boot('https://app.notion.com/chat');const r=await p.prepareSessionStart('startup');assert.equal(r.ready,true);assert.ok(!r.navigating);w.close();}
  // A dirty landing navigates through Notion's own new-chat link when one exists (no hard reload).
  {const {w,p}=boot('https://app.notion.com/ai?q=hi','<a href="/chat" style="display:block">New chat</a>'+html);let clicked=0;w.document.querySelector('a').addEventListener('click',e=>{e.preventDefault();clicked++;});
   w.HTMLAnchorElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,width:80,height:20,right:80,bottom:20};};
   const r=await p.prepareSessionStart('startup');assert.equal(r.navigating,true);assert.equal(clicked,1);w.close();}
  // Localized/ARIA new-chat control is used before any hard navigation.
  {const {w,p}=boot('https://app.notion.com/p/Welcome','<div role="button" aria-label="Neuer Chat">+</div>');let clicked=0;w.document.querySelector('[role=button]').addEventListener('click',()=>clicked++);
   const r=await p.prepareSessionStart('startup');assert.equal(r.navigating,true);assert.equal(clicked,1);w.close();}
  assert.deepEqual(fs.readFileSync('providers/notion.js'),fs.readFileSync('elio-Extension/providers/notion.js'),'extension copy in sync');
  console.log('Notion routes: /ai and /chat landings, ?t= threads with distinct keys, payload vs benign params, native new-chat controls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
