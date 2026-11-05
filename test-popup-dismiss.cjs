// SPDX-License-Identifier: GPL-3.0-or-later
// Floating popups can be closed with ×, stay closed per kind, and in-app indicators stay explicit.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><html><body><div id="f"></div><div id="i"></div><span id="v"></span></body></html>',{runScripts:'outside-only'});
const w=dom.window;w.eval(fs.readFileSync(path.join(__dirname,'core/version.js'),'utf8')+';globalThis.__elioVersion=elioVersion;');const V=w.__elioVersion;
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dismissed=new Set();let status=null,fail=true;
 const opts={floating:true,dismissible:true,current:'1.0.1',interval:60000,isDismissed:k=>dismissed.has(k),onDismiss:k=>dismissed.add(k),getStatus:async()=>{if(fail)throw Error('no bridge');return status;},invoke:async()=>({ok:true})};
 const host=w.document.getElementById('f');let m=V.mount(host,opts);await tick();
 assert.equal(host.hidden,false);assert.equal(host.querySelector('strong').textContent,'Elio not connected');
 const x=host.querySelector('[data-update-close]');assert(x,'floating popup has a close button');assert.equal(x.getAttribute('aria-label'),'Close');
 x.click();assert.equal(host.hidden,true);assert(dismissed.has('disconnected'));
 await m.refresh();assert.equal(host.hidden,true,'stays closed after refresh');
 m.destroy();m=V.mount(host,opts);await tick();assert.equal(host.hidden,true,'stays closed after remount (same session)');
 fail=false;status={phase:'unpublished'};await m.refresh();assert.equal(host.hidden,false,'a different popup still appears');
 assert.equal(host.querySelector('strong').textContent,'No stable release published yet.');host.querySelector('[data-update-close]').click();assert(dismissed.has('unpublished'));
 status={phase:'current',current:'1.0.1',latest:'1.0.2',outdated:true};await m.refresh();assert.equal(host.hidden,false,'update offer still appears');
 host.querySelector('[data-update-close]').click();assert(dismissed.has('outdated:1.0.2'));
 status={phase:'current',current:'1.0.1',latest:'1.0.3',outdated:true};await m.refresh();assert.equal(host.hidden,false,'a newer release appears again');m.destroy();
 // In-app notice (popup / desktop) is not dismissible and always explains the state.
 const inline=w.document.getElementById('i');fail=true;const n=V.mount(inline,{current:'1.0.1',interval:60000,getStatus:opts.getStatus,invoke:opts.invoke});await tick();
 assert.equal(inline.querySelector('[data-update-close]'),null);assert.equal(inline.hidden,false);assert.equal(inline.querySelector('strong').textContent,'Elio not connected');n.destroy();
 const tag=w.document.getElementById('v');
 V.render(tag,'1.0.1',{phase:'disconnected'});assert.equal(tag.textContent,'v1.0.1 · Elio not connected');
 V.render(tag,'1.0.1',{phase:'unpublished'});assert.equal(tag.textContent,'v1.0.1 · No stable release found');
 V.render(tag,'1.0.1',{phase:'current',current:'1.0.1',latest:'1.0.1'});assert.equal(tag.textContent,'v1.0.1');
 // Content script popups: skill and continuation offers have × that persists for the session.
 const main=fs.readFileSync(path.join(__dirname,'core/main.js'),'utf8'),bgjs=fs.readFileSync(path.join(__dirname,'background.js'),'utf8');
 assert.match(main,/dismissible:true,current:EXT_VERSION/);assert.match(main,/popupCloseButton\(\(\)=>\{dismissPopup\('skill-offer'\)/);assert.match(main,/if\(popupDismissed\('skill-offer'\)\)return null;/);
 assert.match(main,/popupCloseButton\(\(\)=>\{if\(offerBusy\)return;dismissPopup\('continuation-offer'\);closeOffer\(\);\}\)/);assert.match(main,/popupDismissed\('continuation-offer'\)\)return;/);
 assert.match(main,/releaseStatus=\{phase:'disconnected'\};renderVersionIndicators\(\)/);
 assert.match(bgjs,/case "rs-popup-dismissals"[\s\S]{0,200}chrome\.storage\.session\.get\("elioDismissedPopups"\)/);
 for(const f of ['core/version.js','core/main.js','background.js'])assert.equal(fs.readFileSync(path.join(__dirname,f),'utf8'),fs.readFileSync(path.join(__dirname,'elio-Extension',f),'utf8'),f+' mirror');
 console.log('PASS popup dismissal: × on floating update/connection, skill and continuation popups; per-kind session memory; newer popups still shown; in-app indicators keep "Elio not connected" / "No stable release found".');
})().catch(e=>{console.error(e);process.exit(1)});
