-- SPDX-License-Identifier: GPL-3.0-or-later
-- Prepend local SPEC={paths={"game.ReplicatedStorage.MyEffect"},max_nodes=160}.
-- Selection is opt-in: local SPEC={use_selection=true,max_nodes=160}.
assert(type(SPEC)=="table", "Prepend a complete local SPEC")
local Http = game:GetService("HttpService")
local allowed = {Workspace=true,ReplicatedStorage=true,ServerStorage=true,SoundService=true}
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
 assert(current==game and allowed[names[1]],"Only materialized Workspace/ReplicatedStorage/ServerStorage/SoundService exports are allowed")
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
local result={read_only=true,catalog_scope="materialized DataModel exports only",roots={},rows={},assets={},warnings={},visited=0,scripts=0,truncated=false,copy_candidate=false}
local fields={ParticleEmitter={"Texture"},Beam={"Texture"},Trail={"Texture"},MeshPart={"MeshId","TextureID"},SpecialMesh={"MeshId","TextureId"},Decal={"Texture"},Texture={"Texture"},Sound={"SoundId"},SurfaceAppearance={"ColorMap","MetalnessMap","NormalMap","RoughnessMap"}}
local seen,assetSeen={},{} local unsafe=false
local function warning(text) if #result.warnings<32 then table.insert(result.warnings,bounded(text,240)) end end
local function inside(o)
 for _,root in ipairs(roots) do if o==root or o:IsDescendantOf(root) then return true end end return false
end
local queue={} for _,root in ipairs(roots) do table.insert(result.roots,pathOf(root)) table.insert(queue,root) end
local head=1
while head<=#queue and result.visited<limit do
 local o=queue[head] head+=1
 if not seen[o] then
  seen[o]=true result.visited+=1
  local ok,path=pcall(pathOf,o)
  if not ok then unsafe=true warning(path) path="<ambiguous or inaccessible path>" end
  local row={path=path,class=bounded(o.ClassName,80),name=bounded(o.Name,160),assets={},references={}}
  if o:IsA("LuaSourceContainer") then result.scripts+=1 row.script=true unsafe=true end
  for _,field in ipairs(fields[o.ClassName] or {}) do
   local success,value=pcall(function() return o[field] end)
   if not success then unsafe=true warning("Unreadable property: "..path.."."..field)
   elseif value~=nil and tostring(value)~="" then
    local raw=bounded(value,512)
    local id=string.match(raw,"^rbxassetid://(%d+)$") or string.match(raw,"^https?://www%.roblox%.com/asset/%?id=(%d+)$") or string.match(raw,"^https?://assetdelivery%.roblox%.com/v1/asset/%?id=(%d+)$")
    local asset=id and "rbxassetid://"..id or raw row.assets[field]=asset
    if not assetSeen[asset] then
     assetSeen[asset]=true
     if #result.assets<128 then table.insert(result.assets,asset) else result.truncated=true warning("Asset list limit reached") end
    end
   end
  end
  if o:IsA("Beam") or o:IsA("Trail") then
   for _,field in ipairs({"Attachment0","Attachment1"}) do
    local success,ref=pcall(function()return o[field]end)
    if not success or not ref then unsafe=true row.references[field]="<missing>" warning("Missing/unreadable attachment: "..path.."."..field)
    else
     local refOk,refPath=pcall(pathOf,ref) row.references[field]=refOk and refPath or "<ambiguous>"
     if not refOk or not inside(ref) then unsafe=true warning("External/ambiguous attachment: "..path.."."..field) end
    end
   end
  end
  if o:IsA("ParticleEmitter") then
   local success,enabled,rate=pcall(function()return o.Enabled,o.Rate end)
   if success then row.enabled=enabled row.rate=rate else unsafe=true warning("Unreadable emitter state") end
  end
  table.insert(result.rows,row)
  for _,child in ipairs(o:GetChildren()) do
   if not seen[child] then
    if #queue-head+1<limit-result.visited then table.insert(queue,child)
    else result.truncated=true end
   end
  end
 end
end
if head<=#queue then result.truncated=true end
if result.truncated then warning("Incomplete inventory: narrow the exported roots or inspect with paged motion tools") end
result.copy_candidate=not unsafe and not result.truncated
result.note="Inventory only, not a serialization, source fingerprint, plugin provenance, license, permission or visual verification. Review full source with motion tools before copying."
local encoded=Http:JSONEncode(result)
while #encoded>48000 and #result.rows>0 do
 table.remove(result.rows) result.truncated=true result.copy_candidate=false
 encoded=Http:JSONEncode(result)
end
assert(#encoded<=48000,"Inventory too large; narrow roots")
return encoded
