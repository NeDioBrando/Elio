// Regressions from the live Elio audit. No Studio instance is modified.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({console,Map,Promise});
for(const file of ['headless-builder','motion-tools','motion-interchange','reliability','prompt-enhancer','chat-creators'])vm.runInContext(fs.readFileSync('core/'+file+'.js','utf8'),ctx);
const api=vm.runInContext('({builder:ZSHeadlessBuilder,motion:ZSMotionTools,bundle:ZSMotionInterchange,reliability:elioReliability,creator:elioChatCreators})',ctx);
const guard=require('./core/tool-guard.js');
const skills={name:'skill',inputSchema:{type:'object',required:['skill_name'],properties:{skill_name:{type:'string'},studio_id:{type:'string'}}}};
for(const name of ['headless_build','creation_insert','execute_luau']){
 const call={tool:'skill',arguments:{skill_name:name,studio_id:'connected-studio'}};guard.repair(call,[skills,{name,inputSchema:{type:'object'}}]);assert.equal(call.tool,'skill');assert.deepEqual(guard.check(call,[skills]),[]);
}
const scoped=api.motion.compileScan({action:'scan',scope:'game.Workspace',budget:500,max_depth:3,max_items:2,include_duplicates:true});assert(scoped.ok);assert.deepEqual(Array.from(scoped.request.scopes),['game.Workspace']);
assert(!api.motion.compileScan({action:'scan',scope:'game.Workspace',scopes:['game.ServerStorage']}).ok);
assert(!api.motion.compileScan({action:'scan',scopes:[]}).ok);
const summary={scopes:['game.Workspace','game.ServerStorage'],scanned_scopes:['game.Workspace'],next_cursor:3,budget:500,max_depth:3,max_items:2,include_duplicates:true};
const formatted=api.motion.formatScan({ok:true,summary,items:[]});const continuation=JSON.parse(formatted.match(/arguments (\{[^\n]+\}); keep/)[1]);assert.deepEqual(continuation,{action:'scan',scopes:summary.scopes,cursor:3,budget:500,max_depth:3,max_items:2,include_duplicates:true});assert(api.motion.compileScan(continuation).ok);
assert(scoped.code.includes('scopes=r.scopes'));assert(scoped.code.includes('scanned_scopes=rootsScanned'));
const compiled=[api.bundle.compileScan({action:'read_vfx',path:'game.Workspace.Baseplate'}),api.bundle.compileCopy({action_id:'audit-1',build_id:'audit',kind:'vfx',source_path:'game.Workspace.Baseplate',target_parent:'game.ServerStorage',root_name:'Audit'}),api.bundle.compileIntegration({action_id:'audit-2',build_id:'audit',profile:'skill',target_parent:'game.ServerStorage',module_name:'Audit',animation_id:'123456'})];
for(const result of compiled){assert(result.ok,result.error);assert(result.code.startsWith('local __elioMotionReceipt\nlocal function __elioMotionRun()'));assert(result.code.includes('local function out(t) __elioMotionReceipt=t end'));assert(result.code.includes('return game:GetService("HttpService"):JSONEncode(__elioMotionReceipt'));assert(!result.code.includes('print("ELIO_MOTION:'));assert(!result.code.includes('table.concat(rows,"\n")'),"Lua string must not contain an unescaped newline")}
for(const code of ['return workspace.Baseplate.Color','return workspace.Baseplate.Position == Vector3.zero','-- Instance.new("Part")\nreturn 1','local s = [[part.Position = 1; Instance.new("Part")]]; return s',`local s = 'Instance.new("Part")'; return s`,'--[=[ p:Destroy() ]=]\nreturn 1'])assert.equal(api.reliability.visual({tool:'execute_luau',arguments:{code}}),false,code);
for(const code of ['workspace.Baseplate.Color = Color3.new(1,0,0)','local p = Instance.new("Part")','workspace.Model:PivotTo(CFrame.new())'])assert.equal(api.reliability.visual({tool:'execute_luau',arguments:{code}}),true,code);
assert(api.creator.previewOnly('Сделай модель, не вставляй в Studio'));assert(api.creator.previewOnly('Только предпросмотр интерфейса'));assert(api.creator.routeRequest('Создай модель курочки'));assert(!api.creator.routeRequest('Продолжай аудит и проверь creation_preview'));
assert.throws(()=>api.creator.parseRewrite('Нажми Stop, диагностика ещё идёт.','token'),/Invalid/);
const updater=fs.readFileSync('updater/apply-update.ps1','utf8');assert(updater.includes('engram-windows-amd64\\.exe|LICENSE|README\\.txt|SHA256SUMS\\.txt'));
const main=fs.readFileSync('core/main.js','utf8');
const gate=main.slice(main.indexOf('  async function enhanceCreationBeforeTools('),main.indexOf('  let latestRequestCache='));
(async()=>{
 let touched=false;const gateContext=vm.createContext({activeEngine:()=> 'roblox',A:{creatorTask:false},rememberExecuted:()=>{touched=true},ui:{toast:()=>{touched=true}}});vm.runInContext(gate+';this.gate=enhanceCreationBeforeTools;',gateContext);assert.equal(await gateContext.gate({calls:[{tool:'creation_preview',arguments:{action:'save'}}]}),null);assert.equal(touched,false,'Audit must not invoke enhancer');
 const begin=main.indexOf('    if (name === "elio_tool_schema") {'),end=main.indexOf('    if (name === "elio_checklist")',begin);let executions=0;
 const catalog=[api.builder.TOOL,{name:'creation_preview',description:'Preview',inputSchema:{type:'object'}}];const schemaContext=vm.createContext({ensureTools:async()=>catalog,ZSHeadlessBuilder:api.builder});
 vm.runInContext('(async function lookup(name,args){'+main.slice(begin,end)+'return "unhandled";})',schemaContext);const lookup=vm.runInContext('(async function lookup(name,args){'+main.slice(begin,end)+'return "unhandled";})',schemaContext);
 const text=await lookup('elio_tool_schema',{name:'creation_preview'}),result=JSON.parse(text.slice(text.indexOf('\n')+1));assert.equal(result.executed,false);assert(result.blueprintSchema);assert.equal(executions,0);
 const example=api.builder.compile(result.preview_example.arguments.blueprint);assert(example.ok,example.error);assert((await lookup('elio_tool_schema',{name:'unknown'})).startsWith('ERROR:'));assert((await lookup('elio_tool_schema',{name:'headless_build',execute:true})).startsWith('ERROR:'));
 const invalid=api.builder.compile({...result.preview_example.arguments.blueprint,nodes:[{id:'root',className:'Model'}]});assert(!invalid.ok);assert(invalid.error.includes('Allowed keys:'));assert(invalid.error.includes('class'));
 console.log('PASS live audit fixes: no skill rerouting, read-only schema/example, creator scope gate, correlated rewrites, Russian preview-only, Motion scopes/pagination/returned receipts, read-only visual detection.');
})().catch(error=>{console.error(error);process.exitCode=1});
