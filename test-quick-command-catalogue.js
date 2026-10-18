const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const main=fs.readFileSync('core/main.js','utf8'),start=main.indexOf('    if (name === "list_commands" || name === "list_tools") {'),end=main.indexOf('    // ── Image attachment plumbing',start);
const rsContext=vm.createContext({});vm.runInContext(fs.readFileSync('core/config.js','utf8')+';this.config=RS',rsContext);
const tools=[{name:'user_keyboard_input',server:'local',description:'Type input into the workspace. '+ 'Long description. '.repeat(100),inputSchema:{properties:{actions:{type:'array',items:{type:'object',required:['action'],properties:{action:{enum:['press','release']},key:{type:'string'}}}}},required:['actions']}},{name:'other_tool',server:'other',description:'Other server command.',inputSchema:{properties:{}}}];
async function catalogue(extra={},args={}){
 const A={toolList:tools,bridge:{connected:true,local_connected:true},requestKind:'quick',quickCatalogue:true,...extra};
 const context=vm.createContext({A,RS:rsContext.config,activeEngine:()=> 'local',ensureTools:async()=>{},bareToolName:n=>n,AgentScriptSkills:{describeCommands:()=>['— AgentScript helpers —','read_json: Read JSON\n path:string','write_json: Save JSON\n path:string']},RSAnim:{describeCommands:()=>[]},elioClarification:{DESCRIPTION:'elio_clarify {question:string, recommended_id:string} — Clarify work.'}});
 vm.runInContext('async function catalogue(name,args){'+main.slice(start,end)+'};this.run=catalogue',context);
 return context.run('list_commands',args);
}
(async()=>{
 const quick=await catalogue();assert(quick.includes('user_keyboard_input(actions)'));assert(quick.includes('read_json'));assert(quick.includes('write_json'));assert(quick.includes('elio_status'));assert(!quick.includes('recommended_id,'),'Argument identifiers are not advertised as commands');assert(!quick.includes('each item:'));assert(!quick.includes('other_tool'));assert(quick.length<2500);
 for(const flags of [{requestKind:'work'},{catalogueDetail:true},{starting:true},{quickCatalogue:false}]){const full=await catalogue(flags);assert(full.includes('each item: {action:(press|release), key?:string}'),JSON.stringify(flags));assert(full.includes('Long description. '.repeat(100)));}
 const other=await catalogue({}, {server:'other'});assert(other.includes('other_tool'));assert(!other.includes('user_keyboard_input'));
 assert((await catalogue({}, {server:'missing'})).includes('ERROR: no server named'));
 assert((await catalogue({bridge:{connected:false},toolList:[]})).includes('OFFLINE'));
 console.log('PASS quick command discovery stays compact and server-scoped; work, startup and full-reference requests retain array/object schemas, descriptions and offline checks.');
})().catch(e=>{console.error(e);process.exitCode=1;});
