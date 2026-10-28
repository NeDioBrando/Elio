// SPDX-License-Identifier: GPL-3.0-or-later
// Compile the COMPLETE generated production template, not an extracted helper.
import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const require=createRequire(new URL('../release-tools/package.json',import.meta.url));
const {LuauState}=await import(pathToFileURL(require.resolve('luau-web')));
const root=fileURLToPath(new URL('../',import.meta.url));
const source=fs.readFileSync(root+'core/studio_skills.js','utf8');
assert.equal(source,fs.readFileSync(root+'elio-Extension/core/studio_skills.js','utf8'));
const ctx=vm.createContext({console});vm.runInContext(source+';this.skills=RobloxScriptSkills',ctx);
const skills=ctx.skills;
const samples=fs.readFileSync(root+'test-skills.js','utf8');const start=samples.indexOf('const sampleArgs = ');const end=samples.indexOf('\n};',start)+3;
const args=vm.runInContext(samples.slice(start,end)+';sampleArgs',vm.createContext({}));
const state=await LuauState.createAsync();let compiled=0,runtime=0;
const lua=v=>v===null?'nil':typeof v==='string'?JSON.stringify(v).replace(/\\u([0-9a-fA-F]{4})/g,'\\u{$1}'):typeof v==='boolean'||typeof v==='number'?String(v):Array.isArray(v)?'{'+v.map(lua).join(',')+'}':'{'+Object.entries(v).map(([k,x])=>'['+lua(k)+']='+lua(x)).join(',')+'}';
const prelude=String.raw`
local spec=__SPEC__ local captured=nil local writes=0
local function value(...)return {...}end
local Color3={fromRGB=value,new=value}local NumberRange={new=value}local Vector2={new=value}local Vector3={new=value}
local NumberSequence={new=value}local NumberSequenceKeypoint={new=value}local ColorSequence={new=value}local ColorSequenceKeypoint={new=value}
local Enum=setmetatable({}, {__index=function(_,name)return setmetatable({}, {__index=function(_,key)return name..'.'..key end})end})
local function instance(name,class,parent)
 local data={Name=name,ClassName=class,Parent=parent,children={}}
 local o=setmetatable({}, {__index=function(_,k)if k=='Source'then error('must not read Source')end return data[k]end,__newindex=function()writes+=1 error('read-only command wrote state')end})
 function data:GetChildren()if data.denied then error('denied')end return self.children end
 function data:FindFirstChild(n)for _,c in ipairs(self.children)do if c.Name==n then return c end end end
 function data:IsA(c)return c==self.ClassName or c=='ScreenGui' and self.ClassName=='ScreenGui'end
 if parent then table.insert(parent.children,o)end
 return o,data
end
local game=instance('Game','DataModel')local services={}
for _,name in ipairs({'Lighting','TweenService','SoundService','StarterGui','StarterPlayer','ServerScriptService','ReplicatedStorage','Debris','LogService','PluginGuiService','CoreGui','ServerStorage'})do services[name]=instance(name,name,game)end
local Http={JSONDecode=function(_,text)assert(text==__WIRE__,'serialized args changed')return spec end,JSONEncode=function(_,v)captured=v return '{}'end}
local getService=function(_,name)if name=='HttpService'then return Http end if not services[name]then error('service denied')end return services[name]end
getmetatable(game).__index=(function(old)return function(self,k)if k=='GetService'then return getService end return old(self,k)end end)(getmetatable(game).__index)
local widget,wd=instance('Dock.42','DockWidgetPluginGui',services.PluginGuiService)wd.Title='VFX Studio' wd.Enabled=true
local frame=instance('Library','Frame',widget)
local button,bd=instance('Fire "🐔"','TextButton',frame)bd.Text='Fire Burst' bd.Visible=true bd.Active=true
local image,id=instance('Thumbnail','ImageLabel',button)id.Image='rbxassetid://123'
local hidden,hd=instance('Hidden','TextLabel',frame)hd.Text='Smoke' hd.Visible=false
local script=instance('Untrusted','ModuleScript',frame)
local core=instance('OtherWidget','ScreenGui',services.CoreGui)
`;
async function run(op,input,checks,setup=''){
 const built=skills.buildLuau(op,input);assert(!built.err,built.err);
 const wire=JSON.stringify({...input,op});const fixture=prelude.replace('__SPEC__',()=>lua({...input,op})).replace('__WIRE__',()=>lua(wire));
 await state.loadstring(fixture+'\n'+setup+'\nlocal function invoke()\n'+built.code+'\nend\ninvoke()\nassert(writes==0)\n'+checks+'\nreturn true','plugin-runtime-'+runtime,true)();runtime++;
}
try{
 if(process.env.ELIO_PLUGIN_BASELINE){
  const old=vm.createContext({});vm.runInContext(fs.readFileSync(process.env.ELIO_PLUGIN_BASELINE,'utf8')+';this.skills=RobloxScriptSkills',old);
  assert.throws(()=>state.loadstring(old.skills.buildLuau('plugin_list',{}).code,'old-plugin-list',true),/65: Malformed string/);console.log('PASS reproduced original :65 Malformed string');
 }
 for(const cmd of skills.SKILL_COMMANDS){const built=skills.buildLuau(cmd.name,args[cmd.name]||{});assert(!built.err,cmd.name+': '+built.err);state.loadstring(built.code,'compile-'+cmd.name,true);compiled++;}
 await run('plugin_list',{},`assert(captured.ok and captured.data.read_only)assert(captured.data.count==2)assert(captured.data.items[1].Title=='VFX Studio')assert(captured.data.items[1].path_segments[2]=='Dock.42')assert(#captured.data.warnings>0)assert(not captured.data.installed_plugin_inventory)`);
 await run('plugin_list',{},`assert(captured.ok and captured.data.count==1)assert(#captured.data.warnings>0)`, `services.PluginGuiService=nil`);
 await run('plugin_list',{},`assert(captured.ok and captured.data.count==0)assert(not captured.data.installed_plugin_inventory)`, `services.PluginGuiService=nil services.CoreGui=nil`);
 const exact=['PluginGuiService','Dock.42'];
 await run('plugin_inspect',{path_segments:exact},`assert(captured.ok and captured.data.read_only)assert(captured.data.visited==6)assert(#captured.data.nodes==6)assert(not captured.data.truncated)assert(captured.data.nodes[4].Visible==false)`);
 await run('plugin_inspect',{path_segments:exact,query:'fire'},`assert(captured.ok)assert(captured.data.matches==1)assert(captured.data.nodes[1].Text=='Fire Burst')`);
 await run('plugin_inspect',{path_segments:exact,query:'rbxassetid://123'},`assert(captured.ok and captured.data.matches==1)`);
 await run('plugin_inspect',{path_segments:exact,query:'['},`assert(captured.ok and captured.data.matches==0)`);
 await run('plugin_inspect',{path_segments:exact,max_nodes:2},`assert(captured.ok and captured.data.visited==2 and captured.data.truncated)`);
 await run('plugin_inspect',{path_segments:exact,max_depth:0},`assert(captured.ok and captured.data.visited==1 and captured.data.truncated)`);
 await run('plugin_inspect',{path:'PluginGuiService.OldWidget'},`assert(not captured.ok)assert(string.find(captured.error,'not proof',1,true))`);
 await run('plugin_inspect',{path_segments:exact},`assert(not captured.ok)assert(string.find(captured.error,'ambiguous',1,true))`, `instance('Dock.42','DockWidgetPluginGui',services.PluginGuiService)`);
 await run('plugin_inspect',{path_segments:exact},`assert(captured.ok and captured.data.truncated and #captured.data.warnings>0)`, `wd.denied=true`);
 await run('plugin_inspect',{path_segments:exact,query:'$& __ARGS_JSON__'},`assert(captured.ok and captured.data.matches==0)`);
 await run('plugin_list',{op:'plugin_create'},`assert(captured.ok and captured.data.read_only)`);
 await run('plugin_inspect',{path_segments:exact,max_nodes:999999,max_depth:999999,query:'NO_MATCH'},`assert(captured.ok and captured.data.visited==400 and captured.data.truncated)`, `for i=1,600 do instance('Item'..i,'Frame',frame)end`);
 await run('plugin_list',{},`assert(captured.ok and captured.data.count==200 and captured.data.truncated)`, `for i=1,300 do instance('Widget'..i,'DockWidgetPluginGui',services.PluginGuiService)end`);
 assert(skills.buildLuau('plugin_inspect',{path_segments:exact,query:']==]'}).err);


 // Regression from the real Studio: several windows share Name=PluginGui.
 const duplicateName=`local other,od=instance('Dock.42','DockWidgetPluginGui',services.PluginGuiService)od.Title='Render Booth Capture'od.Enabled=false`;
 await run('plugin_list',{},`assert(captured.ok and captured.data.count==3)assert(captured.data.items[1].surface_title=='VFX Studio')assert(captured.data.items[2].surface_title=='Render Booth Capture')`,duplicateName);
 await run('plugin_inspect',{path_segments:exact,surface_title:'VFX Studio'},`assert(captured.ok and captured.data.surface_title=='VFX Studio')assert(captured.data.nodes[1].Title=='VFX Studio')assert(captured.data.visited==6)`,duplicateName);
 await run('plugin_inspect',{path_segments:exact,surface_title:'Render Booth Capture'},`assert(captured.ok and captured.data.nodes[1].Title=='Render Booth Capture')assert(captured.data.visited==1)`,duplicateName);
 await run('plugin_inspect',{path_segments:[...exact,'Library'],surface_title:'VFX Studio',query:'fire'},`assert(captured.ok and captured.data.matches==1)assert(captured.data.nodes[1].surface_title=='VFX Studio')`,duplicateName);
 await run('plugin_inspect',{path_segments:exact,surface_title:'Old title'},`assert(not captured.ok)`,duplicateName);
 await run('plugin_inspect',{path_segments:exact,surface_title:'vfx studio'},`assert(not captured.ok)`,duplicateName);
 await run('plugin_inspect',{path_segments:exact,surface_title:'VFX Studio'},`assert(not captured.ok)assert(string.find(captured.error,'ambiguous',1,true))`,duplicateName+` od.Title='VFX Studio'`);
 await run('plugin_inspect',{path_segments:exact,surface_title:'VFX Studio'},`assert(not captured.ok)`, `wd.Title='Changed after listing'`);
 await run('plugin_inspect',{path_segments:['CoreGui','OtherWidget'],surface_title:'VFX Studio'},`assert(not captured.ok)assert(string.find(captured.error,'did not match',1,true))`);
 await run('plugin_inspect',{path_segments:exact,surface_title:'VFX Studio'},`assert(not captured.ok)`, `local old=getmetatable(widget).__index getmetatable(widget).__index=function(self,key)if key=='Title'then error('Title denied')end return old(self,key)end`);
 await run('plugin_inspect',{path_segments:exact,surface_title:'Effects "🐔" . UI'},`assert(captured.ok and captured.data.surface_title=='Effects "🐔" . UI')`, `wd.Title='Effects "🐔" . UI'`);
 await run('plugin_inspect',{path_segments:[...exact,'Library','Fire "🐔"'],surface_title:'VFX Studio'},`assert(not captured.ok)assert(string.find(captured.error,'ambiguous',1,true))`, `instance('Fire "🐔"','TextButton',frame)`);
 await run('plugin_list',{},`assert(captured.ok and captured.data.items[1].surface_title==nil)`, `wd.Title=string.rep('x',1001)`);
 await run('plugin_inspect',{path_segments:exact,surface_title:'x'.repeat(1000)},`assert(not captured.ok)`, `wd.Title=string.rep('x',1001)`);
 assert(skills.buildLuau('plugin_inspect',{path_segments:exact,surface_title:''}).err);
 assert(skills.buildLuau('plugin_inspect',{path_segments:exact,surface_title:5}).err);
 assert(skills.buildLuau('plugin_inspect',{path_segments:exact,surface_title:'x'.repeat(1001)}).err);
 await run('plugin_inspect',{path_segments:[...exact,'Library','Fire "🐔"']},`assert(captured.ok)assert(captured.data.nodes[1].Visible==true)assert(captured.data.nodes[1].ancestor_hidden==true)assert(captured.data.nodes[1].hidden_by=='PluginGuiService.Dock.42')assert(string.find(captured.data.nodes[1].desktop_visibility,'unverified',1,true))`, `wd.Enabled=false`);
 await run('plugin_inspect',{path_segments:[...exact,'Library']},`assert(captured.ok)assert(captured.data.nodes[1].ancestor_hidden==false)assert(captured.data.nodes[2].Visible==true)assert(captured.data.nodes[2].ancestor_hidden==false)assert(string.find(captured.data.nodes[2].desktop_visibility,'unverified',1,true))`);
 assert(skills.buildLuau('plugin_inspect',{}).err);assert(skills.buildLuau('plugin_inspect',{path_segments:[]}).err);assert(skills.buildLuau('plugin_inspect',{path_segments:exact,max_nodes:Infinity}).err);
 console.log(`PASS ${compiled} COMPLETE generated Studio skill chunks compiled; ${runtime} plugin runtime fixtures; read-only invariants, fresh paths, dotted names, access errors, search scope, truncation, argument/operation integrity, mirror parity. Not live VFX Studio UI/import verification.`);
}finally{state.destroy();}
