// SPDX-License-Identifier: GPL-3.0-or-later
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import fs from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(new URL('../release-tools/package.json',import.meta.url));
const {LuauState}=await import(pathToFileURL(require.resolve('luau-web')));
const source=fs.readFileSync(new URL('../starter-skills/vfx-studio/scripts/inspect_asset.luau',import.meta.url),'utf8');
const prelude=String.raw`
local checks=0 local function check(x,label)checks+=1 assert(x,label)end
local function encode(v)
 if type(v)=='nil' then return 'null' end
 if type(v)=='string' then return string.format('%q',v) end
 if type(v)=='number' or type(v)=='boolean' then return tostring(v) end
 local out={}for k,x in pairs(v)do table.insert(out,encode(tostring(k))..':'..encode(x))end table.sort(out)return '{'..table.concat(out,',')..'}'
end
local lastResult=nil
local Http={JSONEncode=function(_,v)lastResult=v return encode(v)end}
local allocated={}
local function node(name,class,parent)
 local o={Name=name,ClassName=class,Parent=parent,children={}}
 function o:GetChildren()return self.children end
 function o:IsA(c)return self.ClassName==c or c=='LuaSourceContainer' and (self.ClassName=='ModuleScript' or self.ClassName=='Script' or self.ClassName=='LocalScript')end
 function o:IsDescendantOf(other)local p=self.Parent while p do if p==other then return true end p=p.Parent end return false end
 if parent then table.insert(parent.children,o)end table.insert(allocated,o)return o
end
local game=node('Game','DataModel')
local workspace=node('Workspace','Workspace',game)
local storage=node('ReplicatedStorage','ReplicatedStorage',game)
local server=node('ServerStorage','ServerStorage',game)
local sound=node('SoundService','SoundService',game)
local private=node('PluginGuiService','PluginGuiService',game)
local selection={}
function game:GetService(n)if n=='HttpService'then return Http elseif n=='Selection'then return {Get=function()return selection end}end for _,c in ipairs(self.children)do if c.Name==n then return c end end error('unknown service')end
local effect=node('Effect','Model',storage)
local emitter=node('Sparks','ParticleEmitter',effect)emitter.Texture='rbxassetid://123'emitter.Enabled=false emitter.Rate=20
local mesh=node('Ring','MeshPart',effect)mesh.MeshId='rbxassetid://456'mesh.TextureID='rbxassetid://123'
local a=node('A','Attachment',effect)local b=node('B','Attachment',effect)
local beam=node('Beam','Beam',effect)beam.Texture='rbxassetid://789'beam.Attachment0=a beam.Attachment1=b
local originalCount=#allocated
`;
const run=String.raw`
local function scan(spec)local text=inspect(spec)return lastResult,text end
check(not pcall(inspect,{paths={}}),'empty roots rejected')
check(not pcall(inspect,{paths={'Workspace','Workspace','Workspace','Workspace','Workspace','Workspace','Workspace','Workspace','Workspace'}}),'too many roots rejected')
local r,text=scan({paths={'game.ReplicatedStorage.Effect'}})
check(r.visited==6,'root inclusive')check(r.read_only,'read only receipt')check(r.copy_candidate,'safe candidate')check(#r.assets==3,'deduplicated IDs')check(r.rows[1].path=='game.ReplicatedStorage.Effect','root path')check(#allocated==originalCount,'no allocated instances')check(emitter.Enabled==false and emitter.Rate==20,'state preserved')
selection={effect}r=scan({use_selection=true})check(r.visited==6,'explicit selection')
check(not pcall(inspect,{use_selection=true,paths={'game.Workspace'}}),'selection/paths conflict')
selection={}check(not pcall(inspect,{use_selection=true}),'empty selection')
r=scan({paths={'ReplicatedStorage.Effect'},max_nodes=2})check(r.truncated and not r.copy_candidate,'budget incomplete')check(r.visited==2,'budget enforced')
for _,p in ipairs({'game.PluginGuiService','game.Players','../Effect','game.ReplicatedStorage..Effect','game','game.ReplicatedStorage.Missing'})do check(not pcall(inspect,{paths={p}}),'reject unsafe/missing '..p)end
local script=node('Untrusted','ModuleScript',effect)
local sourceReads=0 setmetatable(script,{__index=function(_,k)if k=='Source' then sourceReads+=1 error('Source must never be read')end end})
r=scan({paths={'ReplicatedStorage.Effect'}})check(r.scripts==1 and not r.copy_candidate,'unknown module blocked')check(sourceReads==0,'source never read')
local external=node('External','Attachment',workspace)beam.Attachment1=external
r=scan({paths={'ReplicatedStorage.Effect'}})check(#r.warnings>0 and not r.copy_candidate,'external reference warning')
beam.Attachment1=nil r=scan({paths={'ReplicatedStorage.Effect'}})check(#r.warnings>0,'missing attachment warning')beam.Attachment1=b
node('Duplicate','Folder',storage)node('Duplicate','Folder',storage)
check(not pcall(inspect,{paths={'game.ReplicatedStorage.Duplicate'}}),'duplicate exact roots rejected')
node('A','Attachment',effect)r=scan({paths={'ReplicatedStorage.Effect'}})check(not r.copy_candidate,'ambiguous descendant')
local unicode=node('Эффект🐔','Model',workspace)
r,text=scan({paths={'game.Workspace.Эффект🐔'}})check(string.find(text,'Эффект🐔',1,true)~=nil,'unicode retained')
local huge=node('Huge','Model',server)for i=1,450 do node('N'..i,'Folder',huge)end
r=scan({paths={'ServerStorage.Huge'},max_nodes=99999})check(r.visited==400 and r.truncated,'hard cap')
check(not pcall(inspect,{paths={'game.Workspace'},max_nodes=0/0}),'nan rejected')
local long=node('Long','Model',sound)for i=1,300 do node(string.rep('x',150)..i,'Folder',long)end
r,text=scan({paths={'game.SoundService.Long'},max_nodes=400})check(#text<=48000 and r.truncated and not r.copy_candidate,'output bounded')
check(emitter.Enabled==false and beam.Attachment0==a,'read-only final invariant')
return checks
`;
const state=await LuauState.createAsync();try{const result=await state.loadstring(prelude+'\nlocal function inspect(SPEC)\n'+source+'\nend\n'+run,'vfx-inspector-tests',true)();assert(result[0]>=30);console.log(`PASS VFX actual Luau inspector: ${result[0]} checks; simulated DataModel, not live plugin UI.`);}finally{state.destroy();}
