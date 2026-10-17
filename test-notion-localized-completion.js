const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
for(const label of ['Helpful','Erneut generieren','Gute Antwort','Régénérer','Buena respuesta','Resposta boa','再生成','重新生成','좋은 답변']){
 const dom=new JSDOM('<main><section id="composer"><div role="textbox" contenteditable="true" data-placeholder="Ask Notion AI"></div><button data-testid="agent-chat-send-button" aria-label="Submit AI message">Send</button></section><div data-agent-service-scroll-anchor="assistant-done" style="justify-content:flex-start">Finished response</div></main>',{url:'https://app.notion.com/chat/test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.HTMLElement.prototype.getBoundingClientRect=()=>({left:100,top:100,width:500,height:40,right:600,bottom:140});
 try{
  vm.runInContext(fs.readFileSync('providers/notion.js','utf8')+';globalThis.provider=RSProvider;',dom.getInternalVMContext());const p=w.provider,item=w.document.querySelector('[data-agent-service-scroll-anchor]');
  const action=w.document.createElement('button');action.setAttribute('aria-label',label);item.appendChild(action);
  assert.equal(p.softGenerationSettled(item,'Finished response',400),false,'A finished action still requires stable text');
  assert.equal(p.softGenerationSettled(item,'Finished response',700),true,label+' avoids the nine-second soft tail');
  const stop=w.document.createElement('button');stop.setAttribute('aria-label','Stop');w.document.querySelector('#composer').appendChild(stop);assert.equal(p.softGenerationSettled(item,'Finished response',12000),false,'Native Stop always wins');stop.remove();
  const other=w.document.createElement('div');other.textContent='Unfinished response';w.document.querySelector('main').appendChild(other);assert.equal(p.softGenerationSettled(other,'Unfinished response',12000),false,'Historical completion actions never complete another response');
  assert.equal(p.softGenerationSettled(other,'synerixcode ist bereit.',700),true,'German ready acknowledgement avoids the soft tail');
 }finally{w.close();}
}
console.log('PASS localized final response controls remove unnecessary soft-tail waits while requiring stable current-response text and no native Stop.');
