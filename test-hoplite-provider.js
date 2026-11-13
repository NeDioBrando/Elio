// Hoplite (app.hoplite.sh) adapter against markup mirrored from the live web bundle.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const command='{"command":"list_commands","params":{}}';
const transcript=
 '<div data-slot="message-scroller-content" aria-label="Messages">'+
 '<div data-slot="message" data-align="end" data-message-id="m1"><div data-slot="message-content"><div data-slot="bubble" data-align="end"><div data-slot="bubble-content">hello</div></div></div></div>'+
 '<div data-activity-id="a1">Ran 3 commands</div>'+
 '<div data-slot="message" data-align="start" data-message-id="m2"><div data-slot="message-content"><p>COMMAND</p></div></div>'+
 '<div data-message-id="sys1">system note</div>'+
 '</div>';
const composer=(stop)=>
 '<fieldset aria-label="Message composer" data-keyboard-zone="composer"><div class="rounded-xl">'+
 '<textarea aria-label="Message prompt" name="message"></textarea>'+
 '<input type="file" hidden>'+
 (stop?'<button type="button" aria-label="Stop generation">■</button>':'<button type="button" aria-label="Send message">↑</button>')+
 '</div></fieldset>';
function setup({url='https://app.hoplite.sh/threads/thr_abc123',body}={}){
 const html=body??('<header><button aria-label="Send to my phone">x</button><button aria-label="Stop trusting example.com">x</button></header><main>'+transcript.replace('COMMAND',command)+composer(false)+'</main>');
 const d=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});const w=d.window;
 Object.defineProperty(w.HTMLElement.prototype,'offsetParent',{get(){return this.parentElement;}});
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 w.HTMLElement.prototype.getBoundingClientRect=function(){return{left:100,top:400,right:700,bottom:450,width:600,height:50};};
 let now=1000000;w.Date.now=()=>now;w.setTimeout=(fn,ms=0)=>{now+=ms;queueMicrotask(fn);return 1;};
 w.document.execCommand=(action,_,value)=>{const t=w.document.querySelector('textarea');if(action==='insertText'&&t){t.value=value;t.dispatchEvent(new w.Event('input',{bubbles:true}));return true;}return action==='selectAll';};
 vm.runInContext(fs.readFileSync('providers/hoplite.js','utf8')+';this.p=RSProvider;',d.getInternalVMContext());
 return {d,w,p:w.p,advance:ms=>{now+=ms;}};
}
(async()=>{
 let checks=0;const ok=(name)=>{checks++;console.log('PASS '+name);};
 {
  const f=setup(),p=f.p,doc=f.w.document;
  assert.equal(p.id,'hoplite');
  assert.equal(p.getEditor(),doc.querySelector('textarea[name="message"]'));
  assert.equal(p.userCount(),1);assert.equal(p.assistantCount(),1);
  assert.equal(p.readAssistant().reply,command);
  assert.equal(p.lastAssistant().getAttribute('data-message-id'),'m2');
  assert.equal(p.conversationKey(),'thr_abc123');
  assert.equal(p.composerFrame(),doc.querySelector('fieldset'));
  assert.equal(p.modeWarning(),'');assert.equal(p.loginGatePresent(),false);
  assert.equal(p.isHardGenerating(),false,'"Stop trusting" outside the composer is not a stop button');
  ok('transcript roles, reply text, thread key and composer');
  let clicks=0,phone=0;
  doc.querySelector('[aria-label="Send message"]').addEventListener('click',()=>{clicks++;doc.querySelector('textarea').value='';});
  doc.querySelector('[aria-label="Send to my phone"]').addEventListener('click',()=>phone++);
  await p.typeAndSend('elio prompt');
  assert.equal(clicks,1,'one native send');assert.equal(phone,0,'unrelated Send buttons untouched');
  assert.equal(p.editorText(),'');
  ok('sends through the composer button exactly once');
  f.w.close();
 }
 {
  // A long silent tool run: stop button visible, transcript unchanged for minutes.
  const f=setup({body:'<main>'+transcript.replace('COMMAND','working')+composer(true)+'</main>'});
  assert.equal(f.p.isHardGenerating(),true);
  f.p.isGenerating();f.advance(5*60*1000);
  assert.equal(f.p.isHardGenerating(),true,'still busy while Stop generation is shown');
  assert(f.p.timings.RESPONSE_TIMEOUT_MS>=600000);
  let stopped=0;f.w.document.querySelector('[aria-label="Stop generation"]').addEventListener('click',()=>stopped++);
  f.p.stopGeneration();assert.equal(stopped,1);
  ok('agent run stays busy until Stop generation disappears');
  f.w.close();
 }
 {
  const login=setup({url:'https://app.hoplite.sh/login',body:'<main><button>Continue with GitHub</button></main>'});
  assert.equal(login.p.loginGatePresent(),true);assert.match(login.p.modeWarning(),/sign in/);
  login.w.close();
  const home=setup({url:'https://app.hoplite.sh/',body:'<main></main>'});
  assert.match(home.p.modeWarning(),/open a <b>thread<\/b>/);assert.equal(home.p.chatIsEmpty(),true);
  home.w.close();
  const fresh=setup({url:'https://app.hoplite.sh/threads',body:'<main><textarea aria-label="New thread prompt" name="prompt"></textarea></main>'});
  assert.equal(fresh.p.isFreshChat(),true);
  fresh.w.close();
  ok('login gate, no-thread warning and new-thread composer');
 }
 {
  const man=JSON.parse(fs.readFileSync('manifest.json','utf8'));
  const cs=man.content_scripts.find(c=>c.js.includes('providers/hoplite.js'));
  assert(cs&&cs.matches.includes('https://app.hoplite.sh/*'));
  assert(man.host_permissions.includes('https://app.hoplite.sh/*'));
  assert(fs.readFileSync('popup.js','utf8').includes('"app.hoplite.sh"'));
  assert(fs.readFileSync('background.js','utf8').includes('"https://app.hoplite.sh/*"'));
  assert(fs.readFileSync('core/main.js','utf8').includes('https://app.hoplite.sh/threads'));
  assert(fs.readFileSync('agent/src/desktop.html','utf8').includes('data-ipc="open:hoplite"'));
  ok('manifest, popup, background, site list and desktop button registered');
 }
 console.log('PASS '+checks+' Hoplite provider checks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
