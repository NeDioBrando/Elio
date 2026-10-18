const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.ELIO_TEST_JSDOM||'jsdom');
const Cowork=require('./core/cowork.js');
const source=fs.readFileSync('core/main.js','utf8');
const start=source.indexOf('    function renderCowork() {'),end=source.indexOf('    function renderCoworkReceipts(',start);
const dom=new JSDOM('<div id="root"><textarea></textarea><button id="rs-cowork"></button><button id="rs-cowork-queue"></button><section id="rs-cowork-panel"><button id="rs-cowork-resume"></button><div id="rs-cowork-status"></div><div id="rs-cowork-list"></div></section></div>');
try {
 const document=dom.window.document,root=document.querySelector('#root'),ed=root.querySelector('textarea');
 const cowork=Cowork.create({context:()=> 'chat|local',ready:()=>false,send:()=>{throw Error('No automatic sends');}});
 let followup=false;
 const ctx={root,document,cowork,renderCoworkReceipts(){},A:{started:true},P:{getEditor:()=>ed,isGenerating:()=>false,writeDraft(){},setFollowupMode(on){followup=on;}},inputCover(){},coworkReady:()=>true,setFollowupPlaceholder(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'this.render=renderCowork;',ctx);
 cowork.pause('Old stopped state');ctx.render();
 assert(root.querySelector('#rs-cowork-queue').hidden);assert(root.querySelector('#rs-cowork-panel').hidden);assert(root.querySelector('#rs-cowork-resume').hidden);assert.equal(followup,false);
 assert(root.querySelector('#rs-cowork-status').textContent.startsWith('Off.'));
 cowork.setEnabled(true);ctx.render();assert(!root.querySelector('#rs-cowork-queue').hidden);assert.equal(root.querySelector('#rs-cowork-queue').textContent,'Paused');assert(!root.querySelector('#rs-cowork-resume').hidden);
 cowork.enqueue('Keep this request');cowork.setEnabled(false);ctx.render();
 assert(!root.querySelector('#rs-cowork-queue').hidden);assert.equal(root.querySelector('#rs-cowork-queue').textContent,'1 follow-up');assert(root.querySelector('#rs-cowork-resume').hidden);assert.equal(cowork.snapshot().pending.length,1);
 root.querySelector('#rs-cowork-panel').hidden=false;ctx.render();assert(!root.querySelector('#rs-cowork-panel').hidden,'Saved requests remain reviewable while Off');
 cowork.remove(cowork.snapshot().pending[0].id);ctx.render();assert(root.querySelector('#rs-cowork-panel').hidden);assert(root.querySelector('#rs-cowork-queue').hidden);
 cowork.setEnabled(true);cowork.resume();ctx.render();assert(root.querySelector('#rs-cowork-queue').hidden);assert.equal(root.querySelector('#rs-cowork').textContent,'Co-Work: On');
 assert.equal(followup,false,'Idle Co-work restores the native site placeholder');
 ctx.A.running=true;ctx.render();assert.equal(followup,true,'Working agent enables the Follow up placeholder');
 ctx.A.running=false;ctx.render();assert.equal(followup,false,'Finished agent restores the native placeholder without disabling Co-work');
 let generating=true;ctx.P.isGenerating=()=>generating;ctx.render();assert.equal(followup,true);
 generating=false;ctx.render();assert.equal(followup,false);
 console.log('Co-work Off hides empty stale pause/panel, preserves queued requests for review, and keeps enabled Stop/Resume behavior.');
} finally {dom.window.close();}
