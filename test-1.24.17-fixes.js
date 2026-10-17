const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {parse}=require('./release-tools/node_modules/acorn');
const ctx={crypto:crypto.webcrypto,setTimeout,window:{},location:{hostname:'app.clickup.com',pathname:'/123/ai/brain'}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('core/parser.js','utf8')+';this.parser=RSParse;',ctx);
function call(value){return ctx.parser.parseToolCalls('```json\n'+JSON.stringify(value)+'\n```');}
for(const command of ['list_commands','list_tools']){
 for(const value of [{command,server:'blender'},{command,server:'blender',params:{}},{command,params:{server:'blender'}},{command,server:'blender',params:{server:'blender'}}])assert.equal(call(value)[0].arguments.server,'blender');
 assert.equal(call({command,server:'blender',params:{server:'roblox'}}).length,0,'conflicting selectors must not run against either project');
 assert.equal(call({command,server:42}).length,0);
}
assert.equal(call({command:'execute_luau',server:'blender',params:{code:'return 1'}})[0].arguments.server,undefined,'do not infer a mutation server');
vm.runInContext(fs.readFileSync('providers/clickup.js','utf8')+';this.P=RSProvider;',ctx);
let chat='original-chat',engine='roblox';ctx.P.conversationKey=()=>chat;ctx.activeEngine=()=>engine;
const source=fs.readFileSync('core/main.js','utf8'),names=['resultPageSize','compressToolFeedback','readRetainedToolResult','prepareToolFeedback'],found={};
function walk(node){if(!node?.type)return;if(node.type==='FunctionDeclaration'&&names.includes(node.id.name))found[node.id.name]=source.slice(node.start,node.end);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value?.type)walk(value);}
walk(parse(source,{ecmaVersion:'latest'}));for(const name of names)assert(found[name],name);
vm.runInContext('const retainedToolResults=new Map();let characterLimits={rsInputLimitEnabled:true,rsInputCharLimit:120000,rsOutputLimitEnabled:true,rsOutputCharLimit:32000};'+names.map(n=>found[n]).join('\n')+';this.compress=compressToolFeedback;this.read=readRetainedToolResult;this.prepare=prepareToolFeedback;this.limits=value=>{characterLimits=value;};',ctx);
function reconstruct(text){
 const first=ctx.prepare(text);assert(first.length<18000,'final feedback must fit ClickUp transport');
 assert(ctx.parser.isInjectedFeedback(first),'owned retained pages keep normal result masking');
 const id=first.match(/id:"([^"]+)"/)[1];let offset=Number(first.match(/offset:(\d+)/)[1]),restored=first.slice(first.indexOf('\n')+1),count=0;
 while(offset!==null){const page=ctx.read({id,offset,limit:1000000}),split=page.indexOf('\n---RESULT CONTENT---\n');assert(page.length<18000);const meta=JSON.parse(page.slice(page.indexOf('\n')+1,split));restored+=page.slice(split+22);offset=meta.next_offset;assert(++count<100);}
 assert.equal(restored,text,'complete schema/result/debug text must remain exact');return id;
}
const original="Output of 'list_commands':\nblender commands\n"+('path \\file 🧪\nparameters {code,exact_name}\n').repeat(2200)+'END OF REFERENCE';
assert(ctx.compress(original,'list_commands').length<18000,'first tool-result page must also fit');
const id=reconstruct(original+'\n[SYSTEM_STATE: bridge UP]\n'+('Appended debug/reference 🧪\n').repeat(1000));
ctx.limits({rsInputLimitEnabled:false,rsOutputLimitEnabled:false});reconstruct(original);
chat='other-chat';assert.match(ctx.read({id}),/^ERROR:/);chat='original-chat';engine='local';assert.match(ctx.read({id}),/^ERROR:/);engine='roblox';
delete ctx.P.toolResultPageChars;delete ctx.P.toolFeedbackMaxChars;
assert.equal(ctx.prepare(original),original,'other providers keep their full existing transport');
assert.equal(ctx.compress(original,'list_commands'),original,'disabled user limits stay disabled on other providers');
console.log('PASS ClickUp-sized complete result pages, final appended context, Unicode, disabled limits, project isolation, catalog server repair/conflicts and unchanged other-provider behavior');
