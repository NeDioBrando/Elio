const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parse}=require('./release-tools/node_modules/acorn');
const source=fs.readFileSync('background.js','utf8'),found={};function walk(node){if(!node?.type)return;if(node.type==='FunctionDeclaration'&&['fetchWithTimeout','extText'].includes(node.id.name))found[node.id.name]=source.slice(node.start,node.end);for(const v of Object.values(node))if(Array.isArray(v))v.forEach(walk);else if(v?.type)walk(v);}walk(parse(source,{ecmaVersion:'latest'}));
(async()=>{for(const helper of ['fetchWithTimeout','extText'])for(const scenario of ['healthy','headers-stall','body-stall','failure']){
 const timers=new Map();let next=0,signal;const response={ok:true,status:200,headers:new Headers(),url:'https://example.test',text:()=>scenario==='body-stall'?new Promise(()=>{}):Promise.resolve('Complete body')};
 const box={AbortController,WEB_FETCH_TIMEOUT:1000,chrome:{runtime:{getURL:path=>'chrome-extension://test/'+path}},setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),fetch:async(_,options)=>{signal=options.signal;if(scenario==='headers-stall')return new Promise(()=>{});if(scenario==='failure')throw Error('Network failed');return response;}};vm.createContext(box);vm.runInContext(found[helper]+';this.run='+helper+';',box);
 const pending=box.run('file.txt',{},1000);await Promise.resolve();await Promise.resolve();
 if(scenario.endsWith('stall')){for(const callback of timers.values())callback();await assert.rejects(pending,/timed out/);assert(signal.aborted,'Stalled request aborted');}
 else if(scenario==='failure')await assert.rejects(pending,/Network failed/);
 else {const result=await pending;assert.equal(helper==='extText'?result:await result.text(),'Complete body');}
 assert.equal(timers.size,0,'Deadline timer always released');
 }
 console.log('PASS extension resource and web request deadlines cover headers and body stalls, preserve healthy content and release timers on failure.');
})().catch(error=>{console.error(error);process.exitCode=1;});
