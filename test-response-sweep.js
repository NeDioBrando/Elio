// Exact sweep source must retain ownership; parsed calls alone are not evidence.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const main=fs.readFileSync('core/main.js','utf8'),start=main.indexOf('  async function waitForResponse('),end=main.indexOf('\n  // ═',start);
const parser=new Function(fs.readFileSync('core/parser.js','utf8')+';return RSParse;')();
const text='{"command":"synerixcode_status","params":{}}';
async function run(mode){let time=1000,tick=0;const first={},second={};
 const cache={item:first,id:'fresh',text,calls:parser.parseToolCalls(text),chat:'chat-a',session:2,sendToken:'old',at:1000};
 if(mode==='wrong-token')cache.id='different';if(mode==='wrong-chat')cache.chat='other';if(mode==='wrong-session')cache.session=3;if(mode==='wrong-send')cache.sendToken='different';if(mode==='no-source')delete cache.text;
 const A={stop:false,sessionGen:2,sendToken:'old',detectedTool:cache};
 const P={id:'claude',conversationKey:()=> 'chat-a',isHardGenerating:()=>tick===0,isGenerating:()=>tick===0,readAssistant:()=>({item:tick?second:first,reply:'',thinking:''}),lastAssistantId:()=>mode==='historical'?'old':'fresh',assistantCount:()=>2,scanError:()=>null,isTooLongMsg:()=>false,turnComplete:()=>false,turnHalted:()=>false,findContinueBtn:()=>null,requireFreshResponse:true};
 const box={A,P,T:{RESPONSE_TIMEOUT_MS:20000,STABLE_MS:1000,WARMUP_MS:300,REASON_NOREPLY_MS:300,PRESTART_MS:1000},RSParse:parser,Date:{now:()=>time},document:{hidden:false},bgMode:false,sleep:async ms=>{time+=ms;tick++},diag(){},log(){}};
 vm.createContext(box);vm.runInContext(main.slice(start,end)+';this.watch=waitForResponse;',box);return box.watch(1);
}
(async()=>{for(const mode of ['valid','wrong-token','wrong-chat','wrong-session','wrong-send','no-source','historical']){const r=await run(mode);if(mode==='valid'){assert.equal(r.kind,'tool');assert.equal(r.text,text);assert.equal(r.responseOwner.token,'fresh');}else assert.notEqual(r.kind,'tool',mode);console.log('PASS sweep ownership',mode);}})().catch(e=>{console.error(e);process.exitCode=1;});
