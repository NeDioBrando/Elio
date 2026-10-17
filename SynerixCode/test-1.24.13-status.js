// 1.24.13 test build 3: bar/popup connection state (run: node test-1.24.13-status.js).
// Exercises the real background.js status code in a VM.
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const s=fs.readFileSync('background.js','utf8');
const cut=(a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i,a);return s.slice(i,j);};
const code=[cut('function blenderServers(','function log('),cut('function handleBridgeMessage(msg) {','function resolvePending('),cut('function localTools()','async function refreshProcStatus(')].join('\n');
const J=v=>JSON.stringify(v);
function box(engine){
  const b={engine,connected:true,mcpAlive:false,studioConnected:null,studioApp:null,studioProc:true,robloxProc:true,robloxEditorConnected:false,studioChecking:false,
    localReady:true,localFull:false,localRoot:'C:/w',toolsCache:[],localToolsCache:[],serversCache:[],blenderAddon:true,blenderError:'',bridgeError:'',
    BLENDER_TOOLS:Array.from({length:89},(_,i)=>({name:'blender_t'+i,server:'blender'})),resolvePending(){},broadcastStatus(){},applyDesktopPreferences:async()=>{},dispatchDesktopAgentAction:async()=>{}};
  vm.createContext(b);vm.runInContext(code+';this.statusObj=statusObj;this.handle=handleBridgeMessage;this.setLocal=t=>{localToolsCache=t};this.get=()=>({mcpAlive,robloxEditorConnected,toolsCache});',b);
  return b;
}
// AgentScript: Blender listed and real local count, no Roblox tools counted.
{
  const b=box('roblox');b.handle({type:'tools',id:1,ok:true,mcp_alive:true,studio:true,tools:Array.from({length:30},(_,i)=>({name:'r'+i}))});
  b.setLocal(Array.from({length:31},(_,i)=>({name:'l'+i,server:'local'})));
  const st=b.statusObj('local');
  assert.equal(J(st.servers.map(x=>[x.id,x.tools])),J([['local',31],['blender',89]]));
  assert.equal(st.tools,31+89);
  const rb=b.statusObj('roblox');assert.equal(rb.tools,30+89);assert.equal(rb.roblox_connected,true);
}
// A successful heartbeat probe marks the helper alive, so auto-heal never restarts it.
{
  const b=box('roblox');b.handle({type:'studio_status',id:2,studio:true,studio_app:true,studio_proc:true});
  assert.equal(b.get().mcpAlive,true);assert.equal(b.statusObj('roblox').roblox_connected,true);
}
// Reconnect frame with the verified link keeps it connected and keeps the catalogue.
{
  const b=box('roblox');b.handle({type:'tools',id:1,ok:true,mcp_alive:true,studio:true,tools:[{name:'a'},{name:'b'}]});
  b.handle({type:'connected',id:0,ok:true,mcp_alive:true,studio:true,studio_checking:false,tools:[],servers:[]});
  assert.equal(b.get().toolsCache.length,2);assert.equal(b.statusObj('roblox').roblox_connected,true);
  // A kept link reported by a failed catalogue read (no "tools" key) stays connected with its cache.
  b.handle({type:'tools',id:3,ok:false,mcp_alive:true,studio:true,error:'slow'});
  assert.equal(b.get().toolsCache.length,2);assert.equal(b.statusObj('roblox').roblox_connected,true);
}
console.log('PASS 1.24.13 status: AgentScript lists Blender with real counts; probes keep a verified Studio link and its catalogue');
