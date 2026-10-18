"use strict";
const fs=require("fs"),path=require("path"),assert=require("assert");
let pass=0,fail=0;function t(n,f){try{f();pass++;console.log("ok",n);}catch(e){fail++;console.log("FAIL",n,e.message);}}
for(const base of ["","elio-Extension"]){
 const m=fs.readFileSync(path.join(__dirname,base,"core/main.js"),"utf8"),c=fs.readFileSync(path.join(__dirname,base,"core/config.js"),"utf8");
 t(base+" visual check uncapped",()=>{assert(!m.includes("(A.visualChecks||0)>=3"));assert(m.includes("fix it now without asking the user"));});
 t(base+" visual default on",()=>{assert(m.includes("rsVisualCheck:true"));});
 t(base+" failures no longer pause",()=>{assert(!m.includes('"Repeated tool failures"'));assert(m.includes("try a different approach"));});
 t(base+" image-to-model unlimited",()=>{assert(!c.includes("up to 2 more rounds"));assert(c.includes("keep refining (screenshot, compare, fix)"));});
}
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
