// The Notion bar must sit on the chat box even when Notion's placeholder text
// changes, follow the chat box when it moves, and centre any fallback on the
// main content column instead of the whole window (which is offset by the sidebar).
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.SYNERIXCODE_TEST_JSDOM||'jsdom');
const source=fs.readFileSync(__dirname+'/providers/notion.js','utf8');
// Reuse the exact Notion AI route used by the established bar-seat test.
const AI_URL=/url:'([^']+)'/.exec(fs.readFileSync(__dirname+'/test-notion-bar-seat.js','utf8'))[1];
const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
function boot(body,rects){
  const dom=new JSDOM('<main id="main">'+body+'</main>',{url:AI_URL,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;Object.defineProperty(w,'innerHeight',{value:800});Object.defineProperty(w,'innerWidth',{value:1300});
  w.HTMLElement.prototype.getBoundingClientRect=function(){const r=rects[this.id]||{left:0,top:0,width:0,height:0};return {...r,right:r.left+r.width,bottom:r.top+r.height};};
  vm.runInContext(source+';this.p=RSProvider;',dom.getInternalVMContext());return dom;
}
(async()=>{
  // Placeholder-free editor; Notion's stable send test id alone confirms the chat box.
  const rects={main:{left:300,top:0,width:1000,height:800},card:{left:427,top:709,width:746,height:75},ed:{left:440,top:720,width:700,height:24}};
  let dom=boot('<section id="card"><div id="ed" contenteditable="true"></div><button data-testid="agent-chat-send-button">\u2191</button></section>',rects);
  try{
    const p=dom.window.p;
    assert.equal(p.getEditor()&&p.getEditor().id,'ed','send test id confirms the composer');
    let a=p.barAnchor();assert.equal(a&&a.id,'card','bar anchors to the chat box itself');
    assert.equal(a.getBoundingClientRect().top,709);
    // Chat box grows/moves up (multi-line input): the anchor is the live box, so the bar follows it.
    rects.card={left:427,top:640,width:746,height:144};
    await sleep(350);
    a=p.barAnchor();assert.equal(a&&a.id,'card','still the chat box after it moves');
    assert.equal(a.getBoundingClientRect().top,640,'bar follows the moving chat box');
  }finally{dom.window.close();}
  // No chat box yet: centre on the main column (300 + 1000/2 = 800), not the window (650).
  dom=boot('<div id="resp" contenteditable="true"></div>',{main:{left:300,top:0,width:1000,height:800},resp:{left:427,top:520,width:746,height:60}});
  try{
    const a=dom.window.p.barAnchor();
    assert(a&&a.id==='zs-notion-nav-anchor'&&/translateX\(-50%\)/.test(a.style.cssText),'centred fallback');
    assert.match(a.style.cssText,/left: ?800px/,'centred on the main content column');
    assert.equal(dom.window.p.reserveBarSpace(a,40),false,'temporary anchor never reserves composer space');
  }finally{dom.window.close();}
  console.log('Notion bar seats on the chat box by send id, follows it, and centres fallbacks on the content column.');
})().catch((e)=>{console.error(e);process.exit(1);});
