// SPDX-License-Identifier: GPL-3.0-or-later
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const root=process.env.ELIO_AUDIT_SOURCE||__dirname,read=n=>fs.readFileSync(root+'/'+n,'utf8');
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 let checks=0;const check=(fn)=>{fn();checks++;};
 const d=new JSDOM('<main></main>',{url:'http://localhost',runScripts:'outside-only'}),w=d.window,active=new Set(),Original=w.MutationObserver;
 class Observer{constructor(fn){this.inner=new Original(fn);}observe(...args){active.add(this);this.inner.observe(...args);}disconnect(){active.delete(this);this.inner.disconnect();}}
 w.MutationObserver=Observer;w.elioLocaleData={en:{Settings:'Settings',Home:'Home'},ru:{Settings:'Настройки',Home:'Дом'}};
 w.eval(read('core/i18n.js').replace('global.elioI18n=api;','global.elioI18n=api;global.__probe=()=>({owners:owners.size,bindings:bindings.size,pickers:pickers.size});'));
 try{
  const locale=w.elioI18n;
  locale.setLanguage('ru');
  for(let i=0;i<200;i++){
   const host=w.document.createElement('section');host.innerHTML='<h3>Settings</h3><button>Home</button>';w.document.body.append(host);locale.mountStatic(host);host.remove();if(i%10===0)await tick();
  }await tick();
  check(()=>assert.equal(w.__probe().owners,0,'detached translation roots released'));
  check(()=>assert.equal(w.__probe().bindings,0,'detached text bindings released'));
  check(()=>assert.equal(active.size,0,'root/document observers disconnected'));
  const host=w.document.createElement('section');host.innerHTML='<h3>Settings</h3>';w.document.body.append(host);locale.setLanguage('en');let view=locale.mountStatic(host);locale.setLanguage('ru');check(()=>assert.equal(host.textContent,'Настройки'));view.disconnect();view=locale.mountStatic(host);locale.setLanguage('en');check(()=>assert.equal(host.textContent,'Settings','manual disconnect/remount retains original source'));view.disconnect();host.remove();
  for(let i=0;i<80;i++){const host=w.document.createElement('div');w.document.body.append(host);locale.mountPicker(host);host.remove();await tick();}
  check(()=>assert.equal(w.__probe().pickers,0,'removed language pickers released'));check(()=>assert.equal(active.size,0,'picker-only document observer released'));
 }finally{w.close();}
 const sk=new JSDOM('<div id="host"></div>',{url:'http://localhost',runScripts:'outside-only'}),sw=sk.window;sw.TextEncoder=TextEncoder;
 const intervals=new Map();let seq=0;sw.setInterval=fn=>{const id=++seq;intervals.set(id,fn);return id;};sw.clearInterval=id=>intervals.delete(id);
 sw.eval(read('core/skills-ui.js')+';window.skills=elioSkillsUI;');const host=sw.document.getElementById('host');let complete;
 const pending=new Promise(resolve=>complete=resolve),args=[async()=>({ok:true,skills:[]}),async()=>{},()=>({}),async()=>{},async()=>({tasks:[]})];
 try{
  let last;
  for(let i=0;i<100;i++)last=sw.skills.mount(host,...args);
  check(()=>assert.equal(intervals.size,1,'remounting skills keeps one polling timer'));
  const previous=sw.skills.mount(host,()=>pending,...args.slice(1));const oldRead=previous.refresh();const next=sw.skills.mount(host,...args);await next.refresh();const snapshot=host.innerHTML;complete({ok:true,skills:[{id:'late',title:'Late stale response',description:'',steps:[]}]});await oldRead;check(()=>assert.equal(host.innerHTML,snapshot,'old response cannot overwrite remounted skills'));
  next.destroy();check(()=>assert.equal(intervals.size,0,'explicit skills destroy cancels timers'));
 }finally{sw.close();}
 const cr=new JSDOM('<div id="host"></div>',{url:'http://localhost',runScripts:'outside-only'}),cw=cr.window;const polls=new Map(),frames=new Map();let nextId=0,finishList;
 cw.setInterval=fn=>{const id=++nextId;polls.set(id,fn);return id;};cw.clearInterval=id=>polls.delete(id);cw.requestAnimationFrame=fn=>{const id=++nextId;frames.set(id,fn);return id;};cw.cancelAnimationFrame=id=>frames.delete(id);cw.HTMLCanvasElement.prototype.getContext=()=>({});
 try{
  cw.eval(['headless-builder','creator','creator-ui'].map(file=>read('core/'+file+'.js')).join('\n')+';window.creatorUI=elioCreatorUI;');
  const pendingList=new Promise(resolve=>finishList=resolve),view=cw.creatorUI.mount(cw.document.getElementById('host'),()=>pendingList,async()=>{},async()=>{},async()=>{},()=>({canTaskSend:true}));
  const started=view.startPolling();view.dispose();finishList({ok:true,records:[],feedback:[]});await started;
  check(()=>assert.equal(polls.size,0,'late Creator refresh cannot recreate poll after disposal'));check(()=>assert.equal(frames.size,0,'disposed Creator does not schedule redraw'));
 }finally{cw.close();}
 const main=read('core/main.js'),start=main.indexOf('  const _sleepers = new Set();'),end=main.indexOf('  // ── Background mode',start);
 const timers=new Map();let counter=0;let now=0;
 const vm=require('node:vm'),ctx=vm.createContext({Date:{now:()=>now},setTimeout:fn=>{const n=++counter;timers.set(n,fn);return n;},clearTimeout:n=>timers.delete(n)});vm.runInContext(main.slice(start,end)+';globalThis.sleep=sleep;globalThis.wake=wakeDueSleepers;',ctx);
 const sleepers=[];for(let i=0;i<1000;i++)sleepers.push(ctx.sleep(10000));now=10001;ctx.wake();await Promise.all(sleepers);check(()=>assert.equal(timers.size,0,'early wakes cancel native timers'));
 for(const f of ['i18n.js','theme.js','skills-ui.js','creator-ui.js','main.js'])check(()=>assert.equal(read('core/'+f),read('elio-Extension/core/'+f),'mirror '+f));
 console.log(`PASS resource lifecycle: ${checks} checks; 200 translated root removals, 80 picker removals, 100 Skills remounts/stale response, 1000 early wakes, parity.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
