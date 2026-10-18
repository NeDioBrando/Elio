// Weighted fallback for a relabelled Notion send control. Fixture only.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
function boot(controls){
  const dom=new JSDOM('<main><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><div id="bar">'+controls+'</div></section></main>',{url:'https://app.notion.com/chat',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    if(this.getAttribute('role')==='textbox')return {left:200,top:600,width:600,height:40,right:800,bottom:640};
    if(this.getAttribute('role')==='button'){const i=[...this.parentNode.children].indexOf(this);return {left:700+i*40,top:650,width:32,height:32,right:732+i*40,bottom:682};}
    return {left:200,top:600,width:650,height:100,right:850,bottom:700};};
  vm.runInContext(fs.readFileSync('providers/notion.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());
  w.provider.init({isStopped:()=>false});return {w,p:w.provider};
}
const svg='<svg width="16" height="16"></svg>';
{ // relabelled arrow beside a labelled attach button
  const {w,p}=boot('<div role="button" aria-label="Attach file">'+svg+'</div><div role="button" data-x="arrow">'+svg+'</div>');
  assert.equal(p.sendButton(),null,'no draft: never guess a send control');
  w.document.querySelector('[role=textbox]').textContent='hello';
  const b=p.sendButton();assert.ok(b,'inferred');assert.equal(b.getAttribute('data-x'),'arrow');w.close();
}
{ // ambiguous icon buttons: refuse to guess
  const {w,p}=boot('<div role="button">'+svg+'</div><div role="button">'+svg+'</div>');
  w.document.querySelector('[role=textbox]').textContent='hello';
  const b=p.sendButton();assert.ok(!b||b===w.document.querySelectorAll('[role=button]')[1],'only the clearly best (last) control, or nothing');w.close();
}
{ // named stop/mic/model controls are never inferred as send
  const {w,p}=boot('<div role="button" aria-label="Voice input">'+svg+'</div><div role="button" aria-label="Choose model">'+svg+'</div>');
  w.document.querySelector('[role=textbox]').textContent='hello';assert.equal(p.sendButton(),null);w.close();
}
{ // the stable control still wins
  const {w,p}=boot('<div role="button" data-testid="agent-chat-send-button" aria-label="Submit AI message">'+svg+'</div><div role="button">'+svg+'</div>');
  w.document.querySelector('[role=textbox]').textContent='hello';assert.equal(p.sendButton().getAttribute('data-testid'),'agent-chat-send-button');w.close();
}
assert.deepEqual(fs.readFileSync('providers/notion.js'),fs.readFileSync('elio-Extension/providers/notion.js'));
console.log('Notion send inference: relabelled arrow found only with a draft, ambiguous/utility controls refused, stable control preferred.');
