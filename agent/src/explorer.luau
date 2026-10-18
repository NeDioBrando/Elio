-- elio Explorer: stable object handles, no attributes added to the place.
local Http = game:GetService('HttpService')
local Run = game:GetService('RunService')
if Run:IsRunning() then error('Stop Play mode before using Explorer.') end
local request = Http:JSONDecode(__REQUEST__)
local key = '__elioExplorerV1'
local state = rawget(_G, key)
if not state or state.game ~= game or state.place ~= game.PlaceId then
    state = {game=game, place=game.PlaceId, session=Http:GenerateGUID(false), next=0,
        objects=setmetatable({}, {__mode='v'}), ids=setmetatable({}, {__mode='k'})}
    rawset(_G, key, state)
end
local function handle(object)
    if object == game then return 'root' end
    local id = state.ids[object]
    if not id then state.next += 1; id=tostring(state.next); state.ids[object]=id; state.objects[id]=object end
    return id
end
local function resolve(id)
    if id == 'root' then return game end
    local object = state.objects[id]
    if not object or not object:IsDescendantOf(game) then error('Object was removed. Refresh Explorer.') end
    return object
end
if request.action ~= 'tree' or request.id ~= 'root' then
    if request.session ~= state.session then error('Studio session changed. Refresh Explorer before editing.') end
end
local object = resolve(request.id)
local function properties(instance)
    local p={Name=instance.Name, ClassName=instance.ClassName, Archivable=instance.Archivable}
    local function color(value) return {value.R,value.G,value.B} end
    local function vector(value) return {value.X,value.Y,value.Z} end
    if instance:IsA('BasePart') then
        p.Anchored=instance.Anchored; p.Position=vector(instance.Position); p.Size=vector(instance.Size)
        p.Color=color(instance.Color); p.Material=instance.Material.Name; p.Transparency=instance.Transparency
    elseif instance:IsA('GuiObject') then
        p.Visible=instance.Visible; p.BackgroundTransparency=instance.BackgroundTransparency; p.BackgroundColor3=color(instance.BackgroundColor3)
        local function udim(value) return {value.X.Scale,value.X.Offset,value.Y.Scale,value.Y.Offset} end
        p.Position=udim(instance.Position); p.Size=udim(instance.Size)
        if instance:IsA('TextLabel') or instance:IsA('TextButton') or instance:IsA('TextBox') then
            p.Text=instance.Text; p.TextSize=instance.TextSize; p.TextColor3=color(instance.TextColor3)
        end
    elseif instance:IsA('ScreenGui') then
        p.Enabled=instance.Enabled; p.IgnoreGuiInset=instance.IgnoreGuiInset; p.ResetOnSpawn=instance.ResetOnSpawn
    end
    return p
end
local function typed(name,value,current)
    local function number(v,low,high)
        if type(v)~='number' or v~=v or v<low or v>high then error('Invalid '..name..' value.') end
        return v
    end
    if type(current)=='boolean' then if type(value)~='boolean' then error(name..' must be boolean.') end;return value end
    if type(current)=='number' then return number(value,name=='TextSize' and 1 or 0,name=='TextSize' and 100 or 1) end
    if type(current)=='string' then
        if type(value)~='string' or #value>(name=='Text' and 10000 or 100) or value:find('%z') then error('Invalid '..name..' text.') end
        if name=='ClassName' then error('ClassName is read-only.') end
        if name=='Material' then local material=Enum.Material[value];if not material then error('Unknown Roblox material.') end;return material end
        return value
    end
    if type(value)~='table' or #value~=#current then error('Invalid '..name..' components.') end
    if name:find('Color') then return Color3.new(number(value[1],0,1),number(value[2],0,1),number(value[3],0,1)) end
    if #current==4 then return UDim2.new(number(value[1],-10,10),number(value[2],-100000,100000),number(value[3],-10,10),number(value[4],-100000,100000)) end
    local low=name=='Size' and .001 or -100000;local high=name=='Size' and 2048 or 100000
    return Vector3.new(number(value[1],low,high),number(value[2],low,high),number(value[3],low,high))
end
local output = {ok=true, session=state.session, place_id=tostring(game.PlaceId), name=object.Name, class=object.ClassName}
if request.action == 'tree' then
    local children=object:GetChildren()
    local offset=request.offset or 0
    output.nodes={}
    for index=offset+1, math.min(#children, offset+250) do
        local child=children[index]
        table.insert(output.nodes, {id=handle(child), name=child.Name, class=child.ClassName,
            script=child:IsA('LuaSourceContainer'), children=#child:GetChildren()>0})
    end
    if offset+250 < #children then output.next_offset=offset+250 end
elseif request.action == 'read' or request.action == 'write' then
    output.path=object:GetFullName()
    if object:IsA('LuaSourceContainer') then
        local editor=game:GetService('ScriptEditorService')
        if request.action == 'write' then
            local conflict=false
            local history=game:GetService('ChangeHistoryService')
            local recording=history:TryBeginRecording('elioExplorer', 'Edit '..object.Name)
            if not recording then error('Studio cannot record this edit. Finish the current operation first.') end
            local ok, message=pcall(function()
                editor:UpdateSourceAsync(object, function(current)
                    if current ~= request.expected then conflict=true; return nil end
                    return request.source
                end)
            end)
            history:FinishRecording(recording, ok and not conflict and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel)
            if not ok then error(message) end
            if conflict then error('Source changed in Studio. Your draft is preserved; reload and merge before pushing.') end
        end
        output.source=editor:GetEditorSource(object)
        output.script=true
    else
        local current=properties(object)
        if request.action=='write' then
            if type(request.properties)~='table' or type(request.expected_properties)~='table' then error('Supply object properties and their baseline.') end
            local changes={}
            for name,value in pairs(current) do
                if Http:JSONEncode(request.expected_properties[name])~=Http:JSONEncode(value) then error('Properties changed in Studio. Compare and merge before pushing.') end
                if request.properties[name]==nil then error('Do not remove property '..name..'.') end
                if Http:JSONEncode(request.properties[name])~=Http:JSONEncode(value) then
                    table.insert(changes,{name=name,before=object[name],after=typed(name,request.properties[name],value)})
                end
            end
            for name in pairs(request.properties) do if current[name]==nil then error('Unsupported property '..name..'.') end end
            local history=game:GetService('ChangeHistoryService')
            local recording=history:TryBeginRecording('elioExplorerProperties','Edit '..object.Name)
            if not recording then error('Studio cannot record this edit.') end
            local ok,message=pcall(function() for _,change in ipairs(changes) do object[change.name]=change.after end end)
            if not ok then for index=#changes,1,-1 do local change=changes[index];pcall(function() object[change.name]=change.before end) end end
            history:FinishRecording(recording,ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel)
            if not ok then error(tostring(message)..' Inspect object properties before retrying.') end
        end
        output.properties=properties(object);output.name=object.Name;output.path=object:GetFullName()
    end
else error('Unknown Explorer action.') end
return 'ELIO_EXPLORER:'..Http:JSONEncode(output)
