const assert=require('node:assert/strict');const T=require('./core/templates.js');const id='a'.repeat(32);
(async()=>{
 const size=129*1024*1024+17,calls=[],progress=[];
 const file={name:'LargeGame.rbxl',size,arrayBuffer(){throw Error('Whole game must not be buffered');},slice(start,end){return {start,end,size:end-start,arrayBuffer(){throw Error('Desktop upload must send raw chunks');}};}};
 let received=0;
 const result=await T.upload(file,'large game',async req=>{
  calls.push(req.action);
  if(req.action==='upload-begin'){assert.equal(req.size,size);return {ok:true,id,chunk_bytes:T.CHUNK_SIZE};}
  if(req.action==='upload-chunk'){assert.equal(req.offset,received);assert.equal(req.content.start,received);assert(req.content.size<=T.CHUNK_SIZE);received+=req.content.size;return {ok:true,received};}
  if(req.action==='upload-finish'){assert.equal(received,size);return {ok:true,state:'indexing'};}
  if(req.action==='upload-status')return {ok:true,state:'complete',result:{ok:true,id:'template-one'}};
  throw Error(req.action);
 },{rawUpload:true,onProgress:(sent,total,phase)=>progress.push({sent,total,phase})});
 assert.equal(result.id,'template-one');assert.equal(calls.filter(x=>x==='upload-chunk').length,65);assert.equal(progress.at(-1).phase,'indexing');assert.equal(progress.at(-1).sent,size);
 let cancelled=false;
 await assert.rejects(()=>T.upload(file,'',async req=>req.action==='upload-begin'?{ok:true,id,chunk_bytes:T.CHUNK_SIZE}:req.action==='upload-cancel'?(cancelled=true,{ok:true}):{ok:true,received:0},{rawUpload:true}),/size was not confirmed/);assert(cancelled);
 let called=false;await assert.rejects(()=>T.upload({...file,size:T.MAX_FILE+1},'',async()=>{called=true;}),/512 MB/);assert(!called);
 const bytes=Buffer.alloc(33*1024*1024+3);for(let i=0;i<bytes.length;i+=8191)bytes[i]=(i%251)+1;
 const blob=new Blob([bytes]);Object.defineProperty(blob,'name',{value:'BinaryGame.rbxl'});received=0;
 await T.upload(blob,'',async req=>{
  if(req.action==='upload-begin')return {ok:true,id,chunk_bytes:T.CHUNK_SIZE};
  if(req.action==='upload-chunk'){const chunk=Buffer.from(req.content,'base64');assert(chunk.length<=T.CHUNK_SIZE);assert.deepEqual(chunk,bytes.subarray(req.offset,req.offset+chunk.length));received+=chunk.length;return {ok:true,received};}
  return {ok:true,state:'complete',result:{ok:true}};
 });assert.equal(received,bytes.length);
 console.log('Large template uploads: bounded 129 MB raw transfer, exact 33 MB browser bytes, progress/index polling, cancellation and oversized rejection passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
