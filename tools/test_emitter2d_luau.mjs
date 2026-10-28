// SPDX-License-Identifier: GPL-3.0-or-later
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import fs from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(new URL('../release-tools/package.json',import.meta.url));const {LuauState}=await import(pathToFileURL(require.resolve('luau-web')));
const source=fs.readFileSync(new URL('../starter-skills/emitter2d/scripts/inspect_emitter.luau',import.meta.url),'utf8');
const prelude=String.raw`
local checks=0 local function check(x,label)checks+=1 assert(x,label)end
local function encode(v)if type(v)=='nil'then return 'null'end if type(v)=='string'then return string.format('%q',v)end if type(v)=='number'or type(v)=='boolean'then return tostring(v)end local out={}for k,x in pairs(v)do table.insert(out,encode(tostring(k))..':'..encode(x))end table.sort(out)return '{'..table.concat(out,',')..'}'end
local last=nil local Http={JSONEncode=function(_,v)last=v return encode(v)end}
local allocated={}local function node(name,class,parent)
 local o={Name=name,ClassName=class,Parent=parent,children={},attributes={}}
 function o:GetChildren()return self.children end
 function o:GetAttribute(k)return self.attributes[k]end
 function o:GetAttributes()return self.attributes end
 function o:IsA(c)return c==self.ClassName or c=='LuaSourceContainer'and(self.ClassName=='ModuleScript'or self.ClassName=='Script'or self.ClassName=='LocalScript')end
 function o:IsDescendantOf(other)local p=self.Parent while p do if p==other then return true end p=p.Parent end return false end
 if parent then table.insert(parent.children,o)end table.insert(allocated,o)return o
end
local function detach(o)if o.Parent then for i,x in ipairs(o.Parent.children)do if x==o then table.remove(o.Parent.children,i)break end end end o.Parent=nil end
local game=node('Game','DataModel')local workspace=node('Workspace','Workspace',game)local storage=node('ReplicatedStorage','ReplicatedStorage',game)local server=node('ServerStorage','ServerStorage',game)local sound=node('SoundService','SoundService',game)local private=node('PluginGuiService','PluginGuiService',game)
local selection={};function game:GetService(n)if n=='HttpService'then return Http elseif n=='Selection'then return{Get=function()return selection end}end for _,c in ipairs(self.children)do if c.Name==n then return c end end error('unknown service')end
local effect=node('Effect','Model',storage)local custom=node('MeshEmitter','MeshPart',effect)custom.MeshId='rbxassetid://456'custom.TextureID='rbxassetid://123'custom.attributes={Transformed=true,EmitCount=1,EmitDuration=0}
local cfg=node('PartIcleProperties','Configuration',custom)cfg.attributes={Lifetime='authored graph stays unchanged'}local template=node('RenderTemplate','MeshPart',custom)template.MeshId='rbxassetid://456'template.TextureID='rbxassetid://123'
local native=node('Sparks','ParticleEmitter',template)native.Texture='rbxassetid://789'native.Enabled=false native.Rate=20
local link=node('Link','ObjectValue',custom)link.Value=template
local originalCount=#allocated
`;
const run=String.raw`
local function scan(spec)local text=inspect(spec)return last,text end
function nodeGui(name,class,parent)local n=node(name,class,parent)local isa=n.IsA function n:IsA(c)return c=='GuiObject' and self.ClassName=='Frame' or isa(self,c)end function n:GetAttributes()return self.attributes end return n end
local starter=nodeGui('StarterGui','StarterGui',game)local gui=nodeGui('Hud','Frame',starter)local emitter=nodeGui('Confetti','Frame',gui)emitter.attributes={ClassName='Emitter2D',Version='observed-version',EmissionRate='encoded-range',LifeTime='encoded-lifetime',Enabled=false}
for _,name in ipairs({'Emit','TimeStep','Clear','SetSeeds'})do nodeGui(name,'BindableEvent',emitter)end
local spec={paths={'game.StarterGui.Hud'}} local r,text=scan(spec)
check(r.read_only and r.emitters==1,'marker discovery')check(r.structure_candidate,'valid structure')check(not r.runtime_verified and not r.plugin_installation_verified and not r.visual_verified,'no unearned proof')check(r.rows[2].attributes.EmissionRate.observed_type=='string','observed encoding')check(emitter.attributes.LifeTime=='encoded-lifetime','attributes unchanged')
selection={gui}r=scan({use_selection=true})check(r.emitters==1,'selection opt in')selection={}check(not pcall(inspect,{use_selection=true}),'empty selection')check(not pcall(inspect,{paths=spec.paths,use_selection=true}),'exclusive roots')
for _,p in ipairs({'game.PluginGuiService','game.Players','game','../Hud','StarterGui..Hud','StarterGui.Missing'})do check(not pcall(inspect,{paths={p}}),'private/invalid path')end
local duplicate=nodeGui('Emit','BindableEvent',emitter)r=scan(spec)check(not r.structure_candidate,'duplicate event')detach(duplicate)
local event=emitter.children[1]event.ClassName='Folder'r=scan(spec)check(not r.structure_candidate,'wrong event type')event.ClassName='BindableEvent'
detach(event)r=scan(spec)check(not r.structure_candidate,'missing event')event.Parent=emitter table.insert(emitter.children,event)
local old=gui.ClassName gui.ClassName='ScreenGui'r=scan(spec)check(not r.structure_candidate,'GUI ancestor required')gui.ClassName=old
local script=nodeGui('Unsafe','LocalScript',gui)local reads=0 setmetatable(script,{__index=function(_,k)if k=='Source'then reads+=1 error('no Source')end end})r=scan(spec)check(r.scripts==1 and not r.structure_candidate and reads==0,'no source execution')detach(script)
r=scan({paths=spec.paths,max_nodes=2})check(r.visited==2 and r.truncated and not r.structure_candidate,'bounded nodes')check(not pcall(inspect,{paths=spec.paths,max_nodes=0/0}),'NaN')check(not pcall(inspect,{paths=spec.paths,max_nodes=math.huge}),'infinity')
nodeGui('Duplicate','Frame',starter)nodeGui('Duplicate','Frame',starter)check(not pcall(inspect,{paths={'StarterGui.Duplicate'}}),'ambiguous path')
emitter.attributes.ClassName=nil r=scan(spec)check(r.emitters==0 and not r.structure_candidate,'no false provenance')emitter.attributes.ClassName='Emitter2D'
emitter.attributes.Huge=string.rep('x',2000)r=scan(spec)check(r.truncated and not r.structure_candidate,'bounded attribute')emitter.attributes.Huge=nil
local huge=nodeGui('Huge','Frame',starter)for i=1,500 do nodeGui('N'..i,'Frame',huge)end r=scan({paths={'StarterGui.Huge'},max_nodes=99999})check(r.visited==400 and r.truncated,'hard cap')
local long=nodeGui('Long','Frame',starter)for i=1,300 do nodeGui(string.rep('x',150)..i,'Frame',long)end r,text=scan({paths={'StarterGui.Long'},max_nodes=400})check(#text<=48000 and r.truncated and not r.structure_candidate,'output cap')
local unicode=nodeGui('Эффект🐔','Frame',starter)r,text=scan({paths={'StarterGui.Эффект🐔'}})check(string.find(text,'Эффект🐔',1,true)~=nil,'unicode')
r=scan(spec)check(r.structure_candidate and reads==0 and emitter.attributes.Enabled==false,'recovery, no mutations')
return checks
`;
const state=await LuauState.createAsync();try{const result=await state.loadstring(prelude+'\nlocal function inspect(SPEC)\n'+source+'\nend\n'+run,'emitter2d-inspector-tests',true)();assert(result[0]>=29);console.log(`PASS Emitter2D actual Luau inspector: ${result[0]} checks; simulated export structure, not installed plugin/runtime/UI.`);}finally{state.destroy();}
