-- Elio adaptation of user-supplied Eclipse helper. Original: upstream/scripts/.
-- Prepend local SPEC. Edit mode only. Writes an owned AnimSaves draft, not a plugin UI save.
local SPEC = SPEC :: any
assert(not game:GetService("RunService"):IsRunning(), "Close Play mode before authoring")
local function finite(n)
 return type(n) == "number" and n == n and math.abs(n) < math.huge
end
local function label(s)
 return type(s) == "string" and #s > 0 and #s <= 120 and not string.find(s, "[%c%.\\/]")
end
assert(type(SPEC) == "table", "Prepend local SPEC")
assert(label(SPEC.name) and label(SPEC.build_id) and label(SPEC.action_id), "name/build_id/action_id required; no paths")
assert(finite(SPEC.revision) and SPEC.revision >= 0 and SPEC.revision % 1 == 0, "revision required")
assert(SPEC.loop == nil or type(SPEC.loop) == "boolean", "loop must be boolean")
local fps = SPEC.fps or 60
assert(finite(fps) and fps >= 1 and fps <= 240, "fps must be 1..240")
assert(type(SPEC.keys) == "table" and #SPEC.keys >= 2 and #SPEC.keys <= 600, "Provide 2..600 keys")
local priority = Enum.AnimationPriority[SPEC.priority or "Action"]
assert(priority, "Invalid priority")
local path = SPEC.rig
assert(type(path) == "string" and #path < 1000, "rig path required")
path = string.gsub(path, "^game%.", "")
assert(string.sub(path, 1, 10) == "Workspace." and not string.find(path, "%.%."), "Use exact Workspace rig path")
local rig = workspace
for seg in string.gmatch(string.sub(path, 11), "[^%.]+") do
 rig = rig:FindFirstChild(seg)
 assert(rig, "Rig path not found")
end
assert(rig:IsA("Model"), "rig must be a Model")
local parts, allParts, parentOf, seenChildren = {}, {}, {}, {}
local nodes = rig:GetDescendants()
assert(#nodes <= 10000, "Rig exceeds bounded inspection limit")
for _, obj in ipairs(nodes) do
 if obj:IsA("BasePart") then
  allParts[obj] = true
 end
end
for _, j in ipairs(nodes) do
 local a, b
 if j:IsA("Motor6D") then a, b = j.Part0, j.Part1
 elseif j:IsA("AnimationConstraint") then
  a = j.Attachment0 and j.Attachment0.Parent
  b = j.Attachment1 and j.Attachment1.Parent
 end
 if a or b then
  assert(a and b and a:IsA("BasePart") and b:IsA("BasePart"), "Incomplete animatable joint")
  assert(allParts[a] and allParts[b], "Joint points outside rig")
  assert((not parts[a.Name] or parts[a.Name]==a) and (not parts[b.Name] or parts[b.Name]==b) and (a.Name~=b.Name), "Duplicate jointed part name")
  parts[a.Name]=a;parts[b.Name]=b
  assert(a ~= b and not seenChildren[b.Name], "Ambiguous joint parent")
  parentOf[b.Name] = a.Name; seenChildren[b.Name] = true
 end
end
local roots = {}
for child, parent in pairs(parentOf) do
 local seen = {[child] = true}; local cursor = parent
 while cursor do
  assert(not seen[cursor], "Cyclic rig joint tree")
  seen[cursor] = true; cursor = parentOf[cursor]
 end
 if not parentOf[parent] then roots[parent] = true end
end
local rootCount, root = 0, nil
for name in pairs(roots) do rootCount += 1; root = name end
assert(rootCount == 1, "Need one unambiguous joint root")
local styles = {Linear=Enum.PoseEasingStyle.Linear,Constant=Enum.PoseEasingStyle.Constant,Cubic=Enum.PoseEasingStyle.Cubic,Elastic=Enum.PoseEasingStyle.Elastic,Bounce=Enum.PoseEasingStyle.Bounce}
local dirs = {Out=Enum.PoseEasingDirection.In,In=Enum.PoseEasingDirection.Out,InOut=Enum.PoseEasingDirection.InOut}
local function triple(v)
 return type(v) == "table" and #v == 3 and finite(v[1]) and finite(v[2]) and finite(v[3])
end
local first, last, animated, count, previous = {}, {}, {}, 0, -1
for index, key in ipairs(SPEC.keys) do
 assert(type(key)=="table" and finite(key.frame) and key.frame >= 0 and key.frame > previous and key.frame/fps <= 600, "Frames must be ordered, unique and within 600s")
 previous = key.frame
 assert(type(key.poses)=="table", "poses table required")
 assert(key.marker == nil or label(key.marker), "Invalid marker")
 assert(key.name == nil or label(key.name), "Invalid key name")
 for name, data in pairs(key.poses) do
  assert(type(name)=="string" and (name==root or parentOf[name]), "Unknown jointed part: "..tostring(name))
  assert(type(data)=="table" and (data.rot==nil or triple(data.rot)) and (data.pos==nil or triple(data.pos)), "Invalid pose triple")
  assert(styles[data.ease or "Cubic"] and dirs[data.dir or "Out"], "Invalid easing")
  count += 1; assert(count <= 20000, "Pose budget exceeded")
  animated[name] = true
  if index==1 then first[name]=true end
  if index==#SPEC.keys then last[name]=true end
 end
end
assert(SPEC.keys[1].frame==0 and count > 0, "Start at frame 0 with nonempty poses")
for name in pairs(animated) do assert(first[name] and last[name], "Key animated part at both endpoints: "..name) end
-- Deterministic exact payload comparison for action replay, not a lossy hash.
local function canonical(value, depth)
 assert(depth < 16, "SPEC too deeply nested")
 if type(value) ~= "table" then
  assert(type(value)=="string" or type(value)=="boolean" or finite(value), "Unsupported SPEC value")
  return game:GetService("HttpService"):JSONEncode(value)
 end
 local keys={}; for k in pairs(value) do assert(type(k)=="string" or type(k)=="number", "Invalid key"); table.insert(keys,k) end
 table.sort(keys,function(a,b)return type(a)..tostring(a)<type(b)..tostring(b)end)
 local out={}; for _,k in ipairs(keys) do table.insert(out,canonical(k,depth+1)..":"..canonical(value[k],depth+1)) end
 return "{"..table.concat(out,",").."}"
end
local encoded=canonical(SPEC,0);assert(#encoded<=60000,"SPEC exceeds replay safety budget")
local saves=rig:FindFirstChild("AnimSaves")
assert(not saves or saves:IsA("Model") or saves:IsA("Folder"), "AnimSaves is not a container")
local old=saves and saves:FindFirstChild(SPEC.name)
if old then
 assert(old:IsA("KeyframeSequence") and old:GetAttribute("ElioEclipseBuildId")==SPEC.build_id,"Refusing unrelated same-name animation")
 assert(not old:GetAttribute("EclipseBaked") and not old:GetAttribute("EclipseKeyframeData") and not old:FindFirstChild("EclipseKeyframeData"),"Preserve Eclipse-baked save; use a new name")
 if old:GetAttribute("ElioEclipseActionId")==SPEC.action_id then
  assert(old:GetAttribute("ElioEclipseSpec")==encoded,"Action ID reused with changed SPEC")
  return game:GetService("HttpService"):JSONEncode({ok=true,replayed=true,path=old:GetFullName(),revision=old:GetAttribute("ElioEclipseRevision"),plugin_saved=false})
 end
 assert(old:GetAttribute("ElioEclipseRevision")==SPEC.revision,"Stale revision; inspect current owned sequence")
else assert(SPEC.revision==0,"New sequence requires revision 0") end
local ks=Instance.new("KeyframeSequence")
local createdSaves=false
local ok,err=pcall(function()
 ks.Name=SPEC.name;ks.Loop=SPEC.loop==true;ks.Priority=priority
 for _,key in ipairs(SPEC.keys) do
  local kf=Instance.new("Keyframe");kf.Parent=ks;kf.Time=key.frame/fps
  if key.name then kf.Name=key.name end
  if key.marker then local marker=Instance.new("KeyframeMarker");marker.Name=key.marker;marker.Parent=kf end
  local made={}
  local function poseFor(name)
   if made[name] then return made[name] end
   local pose=Instance.new("Pose");pose.Name=name;pose.Weight=0;pose.Parent=kf;made[name]=pose
   if parentOf[name] then pose.Parent=poseFor(parentOf[name]) end
   return pose
  end
  for name,data in pairs(key.poses) do
   local pose=poseFor(name);local r=data.rot or {0,0,0};local t=data.pos or {0,0,0}
   pose.CFrame=CFrame.new(t[1],t[2],t[3])*CFrame.fromEulerAnglesXYZ(math.rad(r[1]),math.rad(r[2]),math.rad(r[3]))
   pose.Weight=1;pose.EasingStyle=styles[data.ease or "Cubic"];pose.EasingDirection=dirs[data.dir or "Out"]
  end
 end
 ks:SetAttribute("ElioEclipseBuildId",SPEC.build_id);ks:SetAttribute("ElioEclipseActionId",SPEC.action_id)
 ks:SetAttribute("ElioEclipseSpec",encoded);ks:SetAttribute("ElioEclipseRevision",SPEC.revision+1)
 if not saves then saves=Instance.new("Model");saves.Name="AnimSaves";createdSaves=true;saves.Parent=rig end
 -- Old data stays intact until a fully constructed replacement can be parented.
 if old then old.Parent=nil end
 ks.Parent=saves
end)
if not ok then
 ks:Destroy()
 if old and old.Parent==nil then old.Parent=saves end
 if createdSaves and #saves:GetChildren()==0 then saves:Destroy() end
 error("Eclipse draft transaction failed: "..tostring(err))
end
if old then old:Destroy() end
local selected=pcall(function()game:GetService("Selection"):Set({rig})end)
return game:GetService("HttpService"):JSONEncode({ok=true,path=ks:GetFullName(),revision=SPEC.revision+1,keyframes=#SPEC.keys,frames=previous,seconds=previous/fps,rig_selected=selected,plugin_saved=false,published=false})
