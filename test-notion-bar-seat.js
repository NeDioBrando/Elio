// Before the composer is confirmed, Notion's temporary bar anchor must sit on
// the visible chat box (not the viewport centre), and never on a response block.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{JSDOM}=require(process.env.ELIO_TEST_JSDOM||'jsdom');
const source=fs.readFileSync(__dirname+'/providers/notion.js','utf8');
function boot(body){
 const dom=new JSDOM('<main>'+body+'</main>',{url:'https://app.notion.com/ai',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;Object.defineProperty(w,'innerHeight',{value:800});Object.defineProperty(w,'innerWidth',{value:1300});
 const rects={card:{left:427,top:709,width:746,height:75},ed:{left:440,top:720,width:700,height:24},resp:{left:427,top:520,width:746,height:60},respwrap:{left:427,top:500,width:746,height:120}};
 w.HTMLElement.prototype.getBoundingClientRect=function(){const r=rects[this.id]||{left:0,top:0,width:0,height:0};return {...r,right:r.left+r.width,bottom:r.top+r.height};};
 vm.runInContext(source+';this.p=RSProvider;',dom.getInternalVMContext());return dom;
}
// Unconfirmed composer (no AI placeholder) with a send control: seat on the card.
let dom=boot('<section id="card"><div id="ed" contenteditable="true"></div><button aria-label="Submit">↑</button></section>');
try{const p=dom.window.p;assert.equal(p.getEditor(),null,'composer is not confirmed for typing');
 const a=p.barAnchor();assert(a&&a.id==='zs-notion-nav-anchor','temporary anchor used');
 assert.match(a.style.cssText,/left: ?427px/);assert.match(a.style.cssText,/top: ?709px/);assert.match(a.style.cssText,/width: ?746px/);
 assert(!/translateX/.test(a.style.cssText),'not viewport centred');
 assert.equal(p.reserveBarSpace(a,40),false,'temporary anchor never reserves composer space');}finally{dom.window.close();}
// A response block without a send/stop control never becomes the seat.
dom=boot('<div id="respwrap"><div id="resp" contenteditable="true"></div><button aria-label="Copy">c</button></div>');
try{const a=dom.window.p.barAnchor();assert(a&&/translateX\(-50%\)/.test(a.style.cssText),'falls back to centred anchor');}finally{dom.window.close();}
console.log('Notion temporary bar anchor sits on the visible chat box and ignores response blocks.');
