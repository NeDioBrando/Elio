const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('core/main.js','utf8'),a=s.indexOf('    onUserMessage: (base, preSendToken)'),b=s.indexOf('    onNativeStop:',a);let timers=[],loops=[],bumps=0;
const box={A:{sessionGen:1},P:{conversationKey:()=> 'chat',lastAssistant:()=>null},bumpSys:()=>bumps++,captureSendToken:()=>{box.A.sendToken='new-shell';},setTimeout:f=>timers.push(f),enforceCondo:()=>false,agentLoop:base=>loops.push([base,box.A.sendToken])};
vm.createContext(box);vm.runInContext(s.slice(s.indexOf('  function scheduleNativeIntent('),s.indexOf('\n  // User-send interception:')),box);vm.runInContext('this.send='+s.slice(a,b).trim().replace(/^onUserMessage: /,'').replace(/,$/,'')+';',box);
box.send(1,'pre-send-turn');timers.shift()();assert.deepEqual(loops,[[1,'pre-send-turn']]);
loops=[];box.send(2);box.send(2);for(const f of timers.splice(0))f();assert.deepEqual(loops,[[2,'new-shell']]);
loops=[];box.send(3,'old');box.A.sessionGen++;timers.shift()();assert.equal(loops.length,0);
box.send(4,'old');box.A.userStopped=true;timers.shift()();assert.equal(loops.length,0);
console.log('Notion pre-send identity reaches the actual response watcher; duplicate callbacks schedule one loop and stale/stopped intents cannot relock the composer.');
