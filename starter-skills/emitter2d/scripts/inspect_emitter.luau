-- SPDX-License-Identifier: GPL-3.0-or-later
-- Prepend local SPEC={paths={"game.ReplicatedStorage.MyEffect"},max_nodes=160}.
-- Selection is opt-in: local SPEC={use_selection=true,max_nodes=160}.
assert(type(SPEC)=="table", "Prepend a complete local SPEC")
local Http = game:GetService("HttpService")
local allowed = {Workspace=true,ReplicatedStorage=true,ServerStorage=true,StarterGui=true,StarterPlayer=true}
local limit = tonumber(SPEC.max_nodes) or 160
assert(limit==limit and limit~=math.huge and limit~=-math.huge,"Invalid max_nodes")
limit = math.clamp(math.floor(limit),1,400)
local function bounded(s,n) return string.sub(tostring(s),1,n) end
local function pathOf(o)
 local names={} local current=o
 while current and current~=game do
  assert(#names<128,"Hierarchy too deep")
  assert(not string.find(current.Name,"[.%c]") and current.Name~="", "Ambiguous instance name")
  local parent=current.Parent
  assert(parent,"Detached instance")
  local count=0 for _,sibling in ipairs(parent:GetChildren()) do if sibling.Name==current.Name then count+=1 end end
  assert(count==1,"Ambiguous duplicate name: "..bounded(current.Name,120))
  table.insert(names,1,current.Name) current=parent
 end
 assert(current==game and allowed[names[1]],"Only materialized Workspace/ReplicatedStorage/ServerStorage/StarterGui/StarterPlayer exports are allowed")
 local path="game."..table.concat(names,".") assert(#path<=1000,"Path too long") return path
end
local function resolve(path)
 assert(type(path)=="string" and #path>0 and #path<=1000 and not string.find(path,"%c"),"Invalid path")
 if string.sub(path,1,5)=="game." then path=string.sub(path,6) end
 assert(not string.find(path,"..",1,true) and string.sub(path,1,1)~="." and string.sub(path,-1)~=".","Invalid path segments")
 local o=game
 for name in string.gmatch(path,"[^.]+") do
  local found=nil
  for _,child in ipairs(o:GetChildren()) do if child.Name==name then assert(not found,"Ambiguous duplicate path") found=child end end
  assert(found,"Missing exported path: "..bounded(path,160)) o=found
 end
 pathOf(o) return o
end
local roots={}
if SPEC.use_selection==true then
 assert(SPEC.paths==nil,"Choose paths OR selection")
 local selected=game:GetService("Selection"):Get()
 assert(#selected>0 and #selected<=8,"Select 1-8 exported roots")
 for _,o in ipairs(selected) do pathOf(o) table.insert(roots,o) end
else
 assert(type(SPEC.paths)=="table" and #SPEC.paths>0 and #SPEC.paths<=8,"Provide 1-8 exact exported paths")
 for _,path in ipairs(SPEC.paths) do table.insert(roots,resolve(path)) end
end
local result={read_only=true,roots={},rows={},warnings={},visited=0,emitters=0,scripts=0,truncated=false,structure_candidate=false,runtime_verified=false,plugin_installation_verified=false,visual_verified=false}
local unsafe=false
local function warning(text) if #result.warnings<32 then table.insert(result.warnings,bounded(text,240)) end end
local function describe(v)
 local t=typeof(v) local value
 if t=="number" then if v==v and v~=math.huge and v~=-math.huge then value=v else value="<nonfinite>" unsafe=true end
 elseif t=="boolean" then value=v
 elseif t=="string" then value=bounded(v,512) if #v>512 then result.truncated=true end
 else local raw=tostring(v) value=bounded(raw,512) if #raw>512 then result.truncated=true end end
 return {observed_type=t,value=value}
end
local seen,queue={},{} for _,root in ipairs(roots) do table.insert(result.roots,pathOf(root)) table.insert(queue,root) end
local head=1
while head<=#queue and result.visited<limit do
 local o=queue[head] head+=1
 if not seen[o] then
  seen[o]=true result.visited+=1
  local ok,path=pcall(pathOf,o)
  if not ok then unsafe=true warning(path) path="<ambiguous or inaccessible>" end
  local row={path=path,class=bounded(o.ClassName,80),name=bounded(o.Name,160)}
  if o:IsA("LuaSourceContainer") then result.scripts+=1 row.script=true warning("Script requires separate review: "..path) end
  if o:GetAttribute("ClassName")=="Emitter2D" then
   result.emitters+=1 row.emitter2d_marker=true row.attributes={} row.events={}
   local attrs=o:GetAttributes() local keys={} for k in pairs(attrs) do table.insert(keys,k) end table.sort(keys)
   if #keys>64 then result.truncated=true warning("Attribute limit reached") end
   for i=1,math.min(#keys,64) do local k=keys[i] if #k>120 then result.truncated=true end row.attributes[bounded(k,120)]=describe(attrs[k]) end
   local gui=o.Parent local depth=0
   while gui and not gui:IsA("GuiObject") and depth<64 do gui=gui.Parent depth+=1 end
   row.gui_ancestor=gui~=nil and gui:IsA("GuiObject")
   if not row.gui_ancestor then unsafe=true warning("Emitter has no confirmed GuiObject ancestor: "..path) end
   for _,name in ipairs({"Emit","TimeStep","Clear","SetSeeds"}) do
    local matches=0 local valid=0
    for _,child in ipairs(o:GetChildren()) do if child.Name==name then matches+=1 if child:IsA("BindableEvent") then valid+=1 end end end
    row.events[name]={matches=matches,bindable_events=valid}
    if matches~=1 or valid~=1 then unsafe=true warning("Missing/ambiguous BindableEvent "..name..": "..path) end
   end
   if attrs.Enabled==false then warning("Enabled=false may be intentional for manual bursts") end
   if attrs.Paused==true or attrs.TimeScale==0 then warning("Paused/zero TimeScale: verify intended preview behavior") end
   if attrs.Texture=="" then warning("Empty texture: inspect intended rendering") end
  end
  table.insert(result.rows,row)
  for _,child in ipairs(o:GetChildren()) do if not seen[child] then
   if #queue-head+1<limit-result.visited then table.insert(queue,child) else result.truncated=true end
  end end
 end
end
if head<=#queue then result.truncated=true end
if result.truncated then warning("Incomplete inventory; narrow roots. No readiness claim.") end
result.structure_candidate=result.emitters>0 and not unsafe and not result.truncated and result.scripts==0
result.note="Observed attributes/events only, not serialization, plugin identity, client installation, license, execution permission or runtime/visual proof. No Source read; no events fired."
local encoded=Http:JSONEncode(result)
while #encoded>48000 and #result.rows>0 do
 table.remove(result.rows) result.truncated=true result.structure_candidate=false encoded=Http:JSONEncode(result)
end
assert(#encoded<=48000,"Inventory too large; narrow roots")
return encoded
