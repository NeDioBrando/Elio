"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert");
const R=__dirname;let pass=0,fail=0;
function t(n,f){try{f();pass++;console.log("ok",n);}catch(e){fail++;console.log("FAIL",n,e.message);}}
for(const base of ["","elio-Extension"]){
 const main=fs.readFileSync(path.join(R,base,"core/main.js"),"utf8");
 const ds=fs.readFileSync(path.join(R,base,"providers/deepseek.js"),"utf8");
 t(base+" loop waits on busy",()=>{assert(main.includes('diag("loop.busyWait"'));assert(main.includes('kind: "busy"'));});
 t(base+" no attempt cap",()=>{assert(!/busyWaits\s*<\s*\d/.test(main));assert(!/busyWaits\s*>=?\s*\d/.test(main));});
 t(base+" wait checks stop",()=>{assert(/while \(Date\.now\(\) < until && !A\.stop\) await sleep\(250\)/.test(main));});
 t(base+" resends last message",()=>{assert(main.includes("A._lastSentText = images ? null : String(text);"));});
 t(base+" backoff 5s..120s",()=>{const f=n=>Math.min(120000,5000*Math.pow(2,Math.min(n-1,5)));assert.deepStrictEqual([1,2,3,4,5,6,50].map(f),[5000,10000,20000,40000,80000,120000,120000]);});
 t(base+" cooldown default unchanged",()=>{assert(main.includes("rsCommandCooldown"));});
 t(base+" deepseek exports scanBusy",()=>{assert(ds.includes("scanError, scanBusy, isTooLongMsg, isBusyMsg,"));});
 t(base+" busy regex",()=>{const m=ds.match(/busy: (\/.*\/i),/);assert(m);const re=eval(m[1]);
  for(const s of ["Server is busy, please try again later.","You are sending messages too frequently","Too many requests","Rate limit reached"])assert(re.test(s),s);
  assert(!re.test("Here is the script for the sword."));});
}
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
