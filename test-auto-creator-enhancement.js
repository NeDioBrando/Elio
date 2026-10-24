const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const c=vm.createContext({console,Map,Promise});
for(const name of ['prompt-enhancer','chat-creators'])vm.runInContext(fs.readFileSync('core/'+name+'.js','utf8'),c);
vm.runInContext('this.Chat=elioChatCreators;this.Enhancer=elioEnhancer',c);
const raw='Make a UI called ExactShop with 44px buttons, #123456, an exact 250x400 panel. Preview only; do not insert.';
(async()=>{
 const request=c.Chat.enhancementRequest(raw);assert(request.includes(c.Enhancer.rules));assert(request.endsWith(raw));assert(request.startsWith('(System note:'));
 let clock=0;const rewrite=await c.Enhancer.waitForRewrite({read:()=>clock<400?'':'Stable exact rewrite',busy:()=>false,cancelled:()=>false,sleep:async ms=>clock+=ms,now:()=>clock});assert.equal(rewrite,'Stable exact rewrite');assert(clock>=1900);
 let context='chat|roblox|1',cancelled=false,calls=[],release;
 const env={context:()=>context,cancelled:()=>cancelled,rewrite:async(text,check,requestId)=>{calls.push('rewrite');assert.equal(text,raw);await new Promise(r=>release=r);check();return JSON.stringify({request_id:requestId,enhanced_prompt:'Create the specified ExactShop UI with its exact layout.'});},send:async text=>{calls.push('send');assert(text.includes(raw));assert(text.includes('exact original request remains authoritative')||text.includes('exact original request')||text.includes('exact original'));assert(text.includes('Preview only; do not insert'));assert(text.includes('44px'));assert(text.includes('250x400'));return 5;}};
 const helper=c.Chat.createEnhancer(env);const first=helper.perform('request-1',raw),second=helper.perform('request-1',raw);assert.equal(first,second);assert.deepEqual(calls,['rewrite']);release();assert.equal((await first).base,5);assert.deepEqual(calls,['rewrite','send']);
 calls=[];cancelled=false;const stopped=helper.perform('request-2',raw);cancelled=true;release();await assert.rejects(()=>stopped,/stopped/);assert.deepEqual(calls,['rewrite']);
 calls=[];cancelled=false;const changed=helper.perform('request-3',raw);context='other-chat|roblox|1';release();await assert.rejects(()=>changed,/changed/);assert.deepEqual(calls,['rewrite']);
 const empty=c.Chat.createEnhancer({...env,context:()=>context,rewrite:async(raw,check,requestId)=>JSON.stringify({request_id:requestId,enhanced_prompt:''}),send:async()=>{throw Error('Invalid rewrite must not send');}});await assert.rejects(()=>empty.perform('empty',raw),/empty/);
 await assert.rejects(()=>empty.perform('large','x'.repeat(40001)),/40,000/);
 assert.throws(()=>c.Chat.parseRewrite('Нажми Stop, диагностика ещё идёт.','expected'),/Invalid/);assert.throws(()=>c.Chat.parseRewrite(JSON.stringify({request_id:'wrong',enhanced_prompt:'Make a UI'}),'expected'),/another request/);
 const main=fs.readFileSync('core/main.js','utf8');assert(main.indexOf('await enhanceCreationBeforeTools(res)')<main.indexOf('const preflight = calls.flatMap'));assert(main.includes('A.creatorPreEnhanced'));assert(main.includes('A.creatorFollowups=texts'));assert.equal(main,fs.readFileSync('elio-Extension/core/main.js','utf8'));
 console.log('Automatic creator enhancement: existing rules, exact original constraints, rewrite-before-execution, concurrent deduplication, Stop/navigation, invalid results and manual-enhancer reuse passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
