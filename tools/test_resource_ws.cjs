// SPDX-License-Identifier: GPL-3.0-or-later
const WebSocket=require('ws'),assert=require('node:assert/strict');const key=process.argv[2],label=process.argv[3];
const headers={Authorization:'Bearer '+key};
function connect(){return new Promise((resolve,reject)=>{const ws=new WebSocket('ws://127.0.0.1:17615','elio',{headers});ws.once('error',reject);ws.once('open',()=>resolve(ws));});}
async function state(){const r=await fetch('http://127.0.0.1:3000/api/status',{headers});return r.json();}
(async()=>{let completed=0;
 for(let i=0;i<80;i++){
  const ws=await connect();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Ping timeout')),5000);ws.on('message',raw=>{const v=JSON.parse(raw);if(v.type==='pong'&&v.id===i){clearTimeout(timer);resolve();}});ws.send(JSON.stringify({type:'ping',id:i}));});ws.close();await new Promise(r=>ws.once('close',r));completed++;
 }
 for(let i=0;i<50;i++){if(!(await state()).local_bridge_connected)break;await new Promise(r=>setTimeout(r,20));}
 assert.equal((await state()).local_bridge_connected,false,'closed clients removed');
 if(label==='after'){
  const ws=await connect();await new Promise(r=>setTimeout(r,40));ws._socket.pause();
  for(let i=0;i<300;i++)ws.send(JSON.stringify({type:'call_tool',id:1000+i,name:'read_file',arguments:{path:'fixture.txt'}}));
  let disconnected=false;for(let i=0;i<150;i++){if(!(await state()).local_bridge_connected){disconnected=true;break;}await new Promise(r=>setTimeout(r,100));}
  ws.terminate();assert(disconnected,'slow reader must not retain client indefinitely');
 }
 console.log(`PASS ${completed} WebSocket reconnect/ping/close cycles, client cleanup${label==='after'?', slow-reader flood closes under bounded tool/outbound capacity':''}. Only temporary fixture reads.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
