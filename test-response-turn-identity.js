// Shared watcher regressions: no live provider, bridge or Studio operations.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const main=fs.readFileSync('core/main.js','utf8');
const start=main.indexOf('  async function waitForResponse('),end=main.indexOf('\n  // ═',start);
const parser=new Function(fs.readFileSync('core/parser.js','utf8')+';return RSParse;')();
const command='{"command":"synerixcode_status","params":{}}';
const other='{"command":"list_commands","params":{}}';
async function watch(id,mode){
 let now=1000,ticks=0;const first={dataset:{}},second={dataset:{}},events=[];
 const changed=()=>ticks>0;const item=()=>changed()&&['remount','different','missing','replacement','old'].includes(mode)?second:first;
 const token=()=>mode==='missing'?null:mode==='old'?'baseline':changed()&&['reuse','different'].includes(mode)?'next-turn':'fresh-turn';
 const chat=()=>mode==='route'&&changed()?'chat-b':'chat-a';
 const read=()=>({item:item(),reply:changed()?(mode==='replacement'?other:''):command,thinking:''});
 const P={id,conversationKey:chat,isHardGenerating:()=>mode==='busy'||ticks===0,isGenerating:()=>mode==='busy'||ticks===0,readAssistant:read,lastAssistantId:token,assistantCount:()=>2,scanError:()=>null,isTooLongMsg:()=>false,turnComplete:()=>false,turnHalted:()=>false,findContinueBtn:()=>null,requireFreshResponse:true};
 const A={stop:false,sendToken:'baseline',detectedTool:null};
 const box={A,P,T:{RESPONSE_TIMEOUT_MS:20000,STABLE_MS:1000,WARMUP_MS:300,REASON_NOREPLY_MS:300,PRESTART_MS:1000},RSParse:parser,Date:{now:()=>now},document:{hidden:false},bgMode:false,sleep:async ms=>{now+=ms;ticks++;if(mode==='stop')A.stop=true;},diag:(name,data)=>events.push({name,data}),log(){}};
 vm.createContext(box);vm.runInContext(main.slice(start,end)+';this.watch=waitForResponse;',box);
 return{result:await box.watch(1),now,events,first,second};
}
(async()=>{
 let failures=0;
 for(const id of ['claude','clickup','chatgpt','gemini','deepseek','qwen'])for(const mode of ['remount','reuse','different','missing','route','replacement','old','busy','stop','same']){
  try{
   const {result,now}=await watch(id,mode);
   if(['remount','same','replacement'].includes(mode)){
    assert.equal(result.kind,'tool','Observed fresh command survives only proven same-turn blank reads');
    assert.equal(result.calls[0].tool,mode==='replacement'?'list_commands':'synerixcode_status');
    assert.equal(result.text,mode==='replacement'?other:command,'Recovered parsed body is carried for replay protection');
   }else assert.notEqual(result.kind,'tool','No stale/history/other-chat command may be recovered');
   if(mode==='busy')assert.equal(result.kind,'busy_timeout');
   if(mode==='stop')assert.equal(result.kind,'stopped');
   assert(now<35000,'All terminal cases bounded');
   console.log('PASS',id,mode);
  }catch(e){failures++;console.error('FAIL',id,mode,e.message);}
 }
 if(failures)throw Error(failures+' shared response-identity failures');
 console.log('PASS shared identity recovery across six provider modes without bridge execution');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
