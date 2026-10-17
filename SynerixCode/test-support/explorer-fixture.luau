-- Mocks Roblox services only; the production Explorer code runs unchanged.
local _G={}
local request,lastOutput,running,recordings,cancels,writes = {},nil,false,0,0,0
local function encode(value)
    local kind=type(value)
    if kind=='nil' then return 'null' end
    if kind=='string' then return string.format('%q',value) end
    if kind~='table' then return tostring(value) end
    local keys={};for key in pairs(value) do table.insert(keys,key) end
    table.sort(keys,function(a,b)return tostring(a)<tostring(b) end)
    local result={};for _,key in ipairs(keys) do table.insert(result,tostring(key)..':'..encode(value[key])) end
    return '{'..table.concat(result,',')..'}'
end
local Http={JSONDecode=function()return request end,JSONEncode=function(_,value)lastOutput=value;return encode(value)end,GenerateGUID=function()return 'session-one'end}
local Vector3={new=function(x,y,z)return {X=x,Y=y,Z=z}end}
local Color3={new=function(r,g,b)return {R=r,G=g,B=b}end}
local UDim2={new=function(sx,ox,sy,oy)return {X={Scale=sx,Offset=ox},Y={Scale=sy,Offset=oy}}end}
local Enum={Material={Plastic={Name='Plastic'},SmoothPlastic={Name='SmoothPlastic'}},FinishRecordingOperation={Commit='Commit',Cancel='Cancel'}}
local game,script,part
local failSetter=false
local function instance(class,name,extra)
    local values={ClassName=class,Name=name,Archivable=true,Parent=nil}
    for key,value in pairs(extra or {}) do values[key]=value end
    local object={}
    local methods={GetChildren=function()return values.Children or {}end,IsDescendantOf=function()return values.Parent==game end,GetFullName=function()return 'game.'..values.Name end,IsA=function(_,kind)return class==kind or (class=='Script' and kind=='LuaSourceContainer') or (class=='Part' and kind=='BasePart')end}
    setmetatable(object,{__index=function(_,key)return methods[key] or values[key]end,__newindex=function(_,key,value)if failSetter and key=='Transparency' then error('setter rejected') end;values[key]=value end})
    return object,values
end
script=instance('Script','ServerScript',{Source='print("old")'})
part=instance('Part','Part',{Anchored=true,Transparency=0,Material=Enum.Material.Plastic,Color=Color3.new(1,1,1),Position=Vector3.new(0,0,0),Size=Vector3.new(4,1,2)})
game=instance('DataModel','game',{PlaceId=12,Children={script,part}});script.Parent=game;part.Parent=game
local editor={GetEditorSource=function(_,object)return object.Source end,UpdateSourceAsync=function(_,object,callback)local next=callback(object.Source);if next~=nil then object.Source=next;writes+=1 end end}
local history={TryBeginRecording=function()recordings+=1;return 'record-'..recordings end,FinishRecording=function(_,_,operation)if operation=='Cancel' then cancels+=1 end end}
game.GetService=function(_,name)if name=='HttpService' then return Http elseif name=='RunService' then return {IsRunning=function()return running end} elseif name=='ScriptEditorService' then return editor elseif name=='ChangeHistoryService' then return history end;error('Unexpected service '..name)end
local function execute(value)
    request=value
    local function production()
__PRODUCTION__
    end
    local success,result=pcall(production)
    return success,result,lastOutput
end
local function call(value)local ok,error,out=execute(value);assert(ok,tostring(error));return out end
local tree=call({action='tree',id='root'});assert(#tree.nodes==2 and tree.session=='session-one')
local scriptId,partId=tree.nodes[1].id,tree.nodes[2].id
local draft=call({action='read',id=scriptId,session=tree.session});assert(draft.source=='print("old")')
local changed=call({action='write',id=scriptId,session=tree.session,expected=draft.source,source='print("new")'});assert(changed.source=='print("new")' and writes==1)
local ok,error=execute({action='write',id=scriptId,session=tree.session,expected='print("old")',source='print("wrong")'});assert(not ok and tostring(error):find('Source changed'));assert(script.Source=='print("new")' and writes==1 and cancels==1)
ok,error=execute({action='write',id=scriptId,session='other-session',expected='print("new")',source='bad'});assert(not ok and tostring(error):find('session changed'));assert(writes==1)
local props=call({action='read',id=partId,session=tree.session}).properties
local desired=table.clone(props);desired.Name='EditedPart';desired.Anchored=false;desired.Color={1,0,0};desired.Material='SmoothPlastic';desired.Size={6,2,3}
local edited=call({action='write',id=partId,session=tree.session,expected_properties=props,properties=desired});assert(edited.properties.Name=='EditedPart' and edited.properties.Anchored==false and part.Size.X==6 and part.Material.Name=='SmoothPlastic')
ok,error=execute({action='write',id=partId,session=tree.session,expected_properties=props,properties=desired});assert(not ok and tostring(error):find('Properties changed'))
local before=call({action='read',id=partId,session=tree.session}).properties
local invalid=table.clone(before);invalid.Source='malicious';local count=recordings
ok=execute({action='write',id=partId,session=tree.session,expected_properties=before,properties=invalid});assert(not ok and recordings==count,'Unsupported property must fail before mutation')
invalid=table.clone(before);invalid.Size={-1,2,3};ok=execute({action='write',id=partId,session=tree.session,expected_properties=before,properties=invalid});assert(not ok and part.Size.X==6)
invalid=table.clone(before);invalid.Name='Temporary';invalid.Transparency=0.5;failSetter=true
ok,error=execute({action='write',id=partId,session=tree.session,expected_properties=before,properties=invalid});failSetter=false;assert(not ok and part.Name=='EditedPart' and part.Transparency==0 and cancels==2)
part.Parent=nil;ok,error=execute({action='read',id=partId,session=tree.session});assert(not ok and tostring(error):find('removed'));part.Parent=game
running=true;ok,error=execute({action='tree',id='root'});assert(not ok and tostring(error):find('Stop Play'));running=false
print('PASS production Luau: stable handles, source conflicts, session isolation, typed property edits, stale baselines, reserved fields, invalid geometry, setter rollback, removed instances and Play mode rejection.')
