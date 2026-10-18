const {runInContext: runProviderFixture} = require('./test-support/provider-dom.cjs');
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {JSDOM}=require(process.env.ELIO_TEST_JSDOM||'jsdom');
const dom=new JSDOM('<section><div contenteditable=true>draft</div><button data-testid=agent-chat-send-button><span>Send</span></button><button data-testid=agent-stop-button>Stop</button></section>');
const document=dom.window.document,frame=document.querySelector('section'),send=frame.querySelector('button'),stop=frame.lastElementChild;
let editor=frame.firstElementChild;
const source=fs.readFileSync('providers/notion.js','utf8');
const ctx={document,findEditorRaw:()=>editor,isTextControl:()=>false,composerFrame:()=>frame,CONTROL_SEL:'button',sendControlLike:c=>c===send,stopControlLike:c=>c===stop,setInterval:()=>1,clearInterval(){}};
vm.createContext(ctx);runProviderFixture(source.slice(source.indexOf('  let _lockWanted ='),source.indexOf('  // ── typing + sending'))+'this.lock=setInputLock;this.handle=onLockedInput;',ctx);
function event(type,target,extra={}){return {type,target,isTrusted:true,preventDefault(){this.blocked=true;},stopImmediatePropagation(){this.stopped=true;},...extra};}
ctx.lock(true);
for(const e of [event('keydown',editor,{key:'Enter'}),event('beforeinput',editor),event('paste',editor),event('drop',editor),event('click',send.firstElementChild)]){ctx.handle(e);assert(e.blocked);assert(e.stopped);}
const stopped=event('click',stop);ctx.handle(stopped);assert(!stopped.blocked);
const synthetic=event('paste',editor,{isTrusted:false});ctx.handle(synthetic);assert(!synthetic.blocked);
const copy=event('keydown',editor,{key:'c',ctrlKey:true});ctx.handle(copy);assert(!copy.blocked);
const replacement=document.createElement('div');editor.replaceWith(replacement);editor=replacement;
const remount=event('keydown',editor,{key:'a'});ctx.handle(remount);assert(remount.blocked);
ctx.lock(false);const idle=event('paste',editor);ctx.handle(idle);assert(!idle.blocked);
const main=fs.readFileSync('core/main.js','utf8');const start=main.indexOf('  async function startSession('),prepare=main.indexOf('await P.prepareSessionStart(',start);
assert(main.indexOf('P.setInputLock(true)',start)<prepare,'Bootstrap lock must precede async composer preparation');
assert(main.indexOf('ui.inputCover(true)',start)<prepare);
let hasStop=false,height=100;frame.getBoundingClientRect=()=>({width:600,height});
const coverCtx={getEditor:()=>editor,composerFrame:()=>frame,stopButton:()=>hasStop};vm.createContext(coverCtx);
runProviderFixture(source.slice(source.indexOf('  const coverTarget ='),source.indexOf('  const modeWarning ='))+'this.target=coverTarget;',coverCtx);
assert.equal(coverCtx.target(),frame);hasStop=true;assert.equal(coverCtx.target(),editor,'Native Stop must stay outside the cover');hasStop=false;height=600;assert.equal(coverCtx.target(),editor,'Never cover a page-size ancestor');
dom.window.close();console.log('Notion startup blocks trusted typing/paste/drop/send across remounts, permits internal writes/copy/Stop, unlocks afterward, and locks before preparation.');
