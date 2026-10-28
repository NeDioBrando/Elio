// SPDX-License-Identifier: GPL-3.0-or-later
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import fs from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(new URL('../release-tools/package.json',import.meta.url));const {LuauState}=await import(pathToFileURL(require.resolve('luau-web')));
const source=fs.readFileSync(new URL('../starter-skills/qwinkles-particles-2/scripts/inspect_effect.luau',import.meta.url),'utf8');
const prelude=String.raw`
local checks=0 local function check(x,label)checks+=1 assert(x,label)end
local function encode(v)if type(v)=='nil'then return 'null'end if type(v)=='string'then return string.format('%q',v)end if type(v)=='number'or type(v)=='boolean'then return tostring(v)end local out={}for k,x in pairs(v)do table.insert(out,encode(tostring(k))..':'..encode(x))end table.sort(out)return '{'..table.concat(out,',')..'}'end
local last=nil local Http={JSONEncode=function(_,v)last=v return encode(v)end}
local allocated={}local function node(name,class,parent)
 local o={Name=name,ClassName=class,Parent=parent,children={},attributes={}}
 function o:GetChildren()return self.children end
 function o:GetAttribute(k)return self.attributes[k]end
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
local spec={paths={'game.ReplicatedStorage.Effect'}}
local r,text=scan(spec)
check(r.read_only,'read only')check(r.qp2_custom_emitters==1,'custom markers')check(r.qp2_missing_structure==0,'required pieces')check(r.qp2_structure_candidate,'structure candidate')check(not r.runtime_module_checked,'no runtime check claimed')check(r.copy_candidate,'script-free internal refs candidate')check(#r.assets==3,'IDs dedup')check(#allocated==originalCount,'no allocation')check(native.Enabled==false and native.Rate==20,'properties unchanged')check(cfg.attributes.Lifetime=='authored graph stays unchanged','graphs unchanged')check(custom.attributes.EmitCount==1,'attributes unchanged')
selection={effect}r=scan({use_selection=true})check(r.qp2_custom_emitters==1,'selection opt in')check(not pcall(inspect,{paths=spec.paths,use_selection=true}),'no conflicting roots')
selection={}check(not pcall(inspect,{use_selection=true}),'empty selection')check(not pcall(inspect,{paths={}}),'empty paths')
for _,p in ipairs({'game.PluginGuiService','game.Players','../Effect','game.ReplicatedStorage..Effect','game','game.ReplicatedStorage.Missing'})do check(not pcall(inspect,{paths={p}}),'invalid/private path')end
r=scan({paths=spec.paths,max_nodes=2})check(r.truncated and not r.qp2_structure_candidate and not r.copy_candidate,'partial never ready')check(r.visited==2,'node cap')
local saved=template.Name template.Name='Other' r=scan(spec)check(r.qp2_missing_structure==1 and not r.qp2_structure_candidate,'missing template')template.Name=saved
local duplicate=node('RenderTemplate','Part',custom)r=scan(spec)check(not r.qp2_structure_candidate,'duplicate template')detach(duplicate)
cfg.ClassName='Folder'r=scan(spec)check(not r.qp2_structure_candidate,'wrong config class')cfg.ClassName='Configuration'
local external=node('Elsewhere','Part',workspace)link.Value=external r=scan(spec)check(not r.copy_candidate and not r.qp2_structure_candidate,'external ObjectValue blocked')link.Value=nil r=scan(spec)check(r.qp2_structure_candidate,'optional unset reference')link.Value=template
local events=node('Events','Folder',cfg)local event=node('OnEmit','Configuration',events)r=scan(spec)check(r.qp2_event_containers==1 and not r.qp2_structure_candidate,'events need separate review')detach(events)
local script=node('Handler','ModuleScript',effect)local reads=0 setmetatable(script,{__index=function(_,k)if k=='Source'then reads+=1 error('no source')end end})r=scan(spec)check(r.scripts==1 and not r.qp2_structure_candidate,'script flagged')check(reads==0,'Source never read')detach(script)
custom.attributes.EmitCount=0 r=scan(spec)check(#r.warnings>0,'zero-burst diagnostic')custom.attributes.EmitCount=1 custom.attributes.AnimateLoop=true r=scan(spec)check(#r.warnings>0,'loop cleanup diagnostic')custom.attributes.AnimateLoop=nil
local raw=node('Raw','Model',server)r=scan({paths={'game.ServerStorage.Raw'}})check(r.qp2_custom_emitters==0 and not r.qp2_structure_candidate,'no claimed QP provenance')
local unicode=node('Эффект🐔','Model',workspace)r,text=scan({paths={'game.Workspace.Эффект🐔'}})check(string.find(text,'Эффект🐔',1,true)~=nil,'unicode')
node('Duplicate','Folder',storage)node('Duplicate','Folder',storage)check(not pcall(inspect,{paths={'ReplicatedStorage.Duplicate'}}),'ambiguous root')
local huge=node('Huge','Model',server)for i=1,500 do node('N'..i,'Folder',huge)end r=scan({paths={'ServerStorage.Huge'},max_nodes=99999})check(r.visited==400 and r.truncated,'hard cap')check(not pcall(inspect,{paths=spec.paths,max_nodes=0/0}),'nan rejected')
local long=node('Long','Model',sound)for i=1,300 do node(string.rep('x',150)..i,'Folder',long)end r,text=scan({paths={'SoundService.Long'},max_nodes=400})check(#text<=48000 and r.truncated and not r.qp2_structure_candidate,'output budget')
r=scan(spec)check(r.qp2_structure_candidate,'recovery after diagnostics')check(native.Enabled==false and link.Value==template and reads==0,'no state changes or Source read')
return checks
`;
const state=await LuauState.createAsync();try{const result=await state.loadstring(prelude+'\nlocal function inspect(SPEC)\n'+source+'\nend\n'+run,'qp2-inspector-tests',true)();assert(result[0]>=38);console.log(`PASS QP2 actual Luau inspector: ${result[0]} checks; simulated export structure, not installed plugin/runtime/UI.`);}finally{state.destroy();}
