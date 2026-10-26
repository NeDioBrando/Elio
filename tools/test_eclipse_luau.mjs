// SPDX-License-Identifier: GPL-3.0-or-later
// Runs the actual shipped helpers in Luau; Roblox DataModel/geometry below are simulated.
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import fs from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire(new URL('../release-tools/package.json',import.meta.url));
const {LuauState}=await import(pathToFileURL(require.resolve('luau-web')));
const root=fileURLToPath(new URL('../',import.meta.url));
const build=fs.readFileSync(root+'starter-skills/eclipse-animator/scripts/build_sequence.luau','utf8');
const inspect=fs.readFileSync(root+'starter-skills/eclipse-animator/scripts/inspect_pose.luau','utf8');
const prelude=String.raw`
local function json(v)
 if type(v)=='nil' then return 'null' end
 if type(v)=='string' then return string.format('%q',v) end
 if type(v)=='number' or type(v)=='boolean' then return tostring(v) end
 local parts={} for k,x in pairs(v) do table.insert(parts,json(tostring(k))..':'..json(x)) end table.sort(parts) return '{'..table.concat(parts,',')..'}'
end
local allocated={};local failParent=false;local playing=false
local function instance(name,class,parent)
 local data={Name=name,ClassName=class,children={},attributes={}}
 local o=setmetatable({}, {__index=data,__newindex=function(self,k,v)
  if k=='Parent' then
   if failParent and data.ClassName=='KeyframeSequence' and v then failParent=false;error('injected commit failure') end
   if data.Parent then for i,c in ipairs(data.Parent.children) do if c==self then table.remove(data.Parent.children,i) break end end end
   data.Parent=v;if v then table.insert(v.children,self) end
  else data[k]=v end
 end})
 table.insert(allocated,o)
 function o:IsA(c)return c==self.ClassName or c=='BasePart' and self.ClassName=='Part'end
 function o:FindFirstChild(n)for _,c in ipairs(self.children)do if c.Name==n then return c end end end
 function o:GetFullName()local names={self.Name}local p=self.Parent while p do table.insert(names,1,p.Name)p=p.Parent end return table.concat(names,'.')end
 function o:GetChildren()return self.children end
 function o:GetDescendants()local out={}for _,c in ipairs(self.children)do table.insert(out,c)for _,n in ipairs(c:GetDescendants())do table.insert(out,n)end end return out end
 function o:GetAttribute(k)return self.attributes[k]end
 function o:SetAttribute(k,v)self.attributes[k]=v end
 function o:Destroy()local children=table.clone(self.children)for _,c in ipairs(children)do c:Destroy()end self.Parent=nil self.Destroyed=true end
 o.Parent=parent;return o
end
local Instance={new=function(class)return instance(class,class)end}
local enum=function(names)local t={}for name in string.gmatch(names,'[^,]+')do t[name]=name end return t end
local Enum={AnimationPriority=enum('Core,Idle,Movement,Action,Action2,Action3,Action4'),PoseEasingStyle=enum('Linear,Constant,Cubic,Elastic,Bounce'),PoseEasingDirection=enum('In,Out,InOut')}
local vectorMethods={}
local vectorMeta={__index=function(self,k)if k=='Magnitude'then return math.sqrt(self.X*self.X+self.Y*self.Y+self.Z*self.Z)elseif k=='Unit'then local m=self.Magnitude return setmetatable({X=self.X/m,Y=self.Y/m,Z=self.Z/m},getmetatable(self))else return vectorMethods[k]end end}
local function vec(x,y,z)return setmetatable({X=x,Y=y,Z=z},vectorMeta)end
vectorMeta.__unm=function(v)return vec(-v.X,-v.Y,-v.Z)end
vectorMeta.__sub=function(a,b)return vec(a.X-b.X,a.Y-b.Y,a.Z-b.Z)end
function vectorMethods:Dot(b)return self.X*b.X+self.Y*b.Y+self.Z*b.Z end
local cfMeta={__mul=function(a,b)return a end}
local function cf()return setmetatable({UpVector=vec(0,1,0),RightVector=vec(1,0,0),LookVector=vec(0,0,-1),PointToObjectSpace=function(_,v)return v end},cfMeta)end
local CFrame={new=cf,fromEulerAnglesXYZ=cf}
local workspace=instance('Workspace','Workspace')
local selection={Set=function()end}
local game={GetService=function(_,name)if name=='RunService'then return {IsRunning=function()return playing end}elseif name=='HttpService'then return {JSONEncode=function(_,v)return json(v)end}elseif name=='Selection'then return selection end error('Unknown service')end}
local rig=instance('Rig','Model',workspace)
local torso=instance('Torso','Part',rig);torso.CFrame=cf();torso.Position=vec(0,0,0)
local arm=instance('Right Arm','Part',rig);arm.CFrame=cf();arm.Position=vec(0,0,0)
local joint=instance('Shoulder','Motor6D',torso);joint.Part0=torso;joint.Part1=arm
local function spec(name)
 return {rig='game.Workspace.Rig',name=name or 'ElioTest',build_id='test-owner',action_id='action1',revision=0,fps=60,priority='Action',keys={{frame=0,poses={['Right Arm']={rot={0,0,0}}}},{frame=12,marker='Hit',poses={['Right Arm']={rot={65,0,0}}}},{frame=24,poses={['Right Arm']={rot={0,0,0}}}}}}
end
`;
const run=String.raw`
local checks=0
local function check(v,message)assert(v,message)checks+=1 end
local function rejected(s,pattern)local before=#rig:GetDescendants()local ok,err=pcall(build,s)check(not ok and string.find(tostring(err),pattern),tostring(err))check(#rig:GetDescendants()==before,'mutation on rejection')end
local s=spec();local result=build(s);local saves=rig:FindFirstChild('AnimSaves');local seq=saves:FindFirstChild('ElioTest')
check(seq and #seq:GetChildren()==3,'sequence not built')check(seq:GetAttribute('ElioEclipseRevision')==1,'revision')
local middle=seq:GetChildren()[2];check(middle.Time==0.2,'time')check(middle:FindFirstChild('Hit')~=nil,'marker')
local rootPose=middle:FindFirstChild('Torso');check(rootPose.Weight==0,'placeholder')check(rootPose:FindFirstChild('Right Arm').Weight==1,'keyed weight')
check(rootPose:FindFirstChild('Right Arm').EasingDirection=='In','tween direction mapping')
check(string.find(result,'"plugin_saved":false')~=nil,'truthful plugin receipt')
check(string.find(build(s),'"replayed":true')~=nil,'exact replay')check(#saves:GetChildren()==1,'duplicate replay')
local changed=spec();changed.keys[2].frame=11;rejected(changed,'changed SPEC')
local stale=spec();stale.action_id='action2';rejected(stale,'Stale revision')
local update=spec();update.action_id='action2';update.revision=1;build(update);seq=saves:FindFirstChild('ElioTest');check(seq:GetAttribute('ElioEclipseRevision')==2,'replacement')
seq:SetAttribute('EclipseBaked',true);local baked=spec();baked.action_id='action3';baked.revision=2;rejected(baked,'baked');seq:SetAttribute('EclipseBaked',nil)
local metadata=instance('EclipseKeyframeData','Folder',seq);rejected(baked,'baked');metadata:Destroy()
local hand=instance('HandMade','KeyframeSequence',saves);rejected(spec('HandMade'),'unrelated');check(not hand.Destroyed,'handmade lost')
local invalid=spec('Invalid');invalid.fps=0;rejected(invalid,'fps')
invalid=spec('Invalid');invalid.keys[2].frame=0;rejected(invalid,'Frames')
invalid=spec('Invalid');invalid.keys[2].poses={Missing={rot={0,0,0}}};rejected(invalid,'Unknown jointed')
invalid=spec('Invalid');invalid.keys[2].poses['Right Arm'].rot={0,0,0/0};rejected(invalid,'triple')
invalid=spec('Invalid');invalid.keys[3].poses={};rejected(invalid,'endpoints')
invalid=spec('Invalid');invalid.keys[2].poses['Right Arm'].ease='Nope';rejected(invalid,'easing')
local handle1=instance('Handle','Part',rig);local handle2=instance('Handle','Part',rig);build(spec('AccessorySafe'));check(saves:FindFirstChild('AccessorySafe')~=nil,'unanimated accessory names must not block authoring');handle1:Destroy();handle2:Destroy()
local duplicate=instance('Right Arm','Part',rig);local dj=instance('OtherShoulder','Motor6D',rig);dj.Part0=torso;dj.Part1=duplicate;rejected(spec('Invalid'),'Duplicate jointed');dj:Destroy();duplicate:Destroy()
local cycle=instance('Cycle','Motor6D',rig);cycle.Part0=arm;cycle.Part1=torso;rejected(spec('Invalid'),'Cyclic');cycle:Destroy()
playing=true;rejected(spec('Invalid'),'Play mode');playing=false
-- Actual AnimationConstraint path works as well as classic Motor6D.
joint:Destroy();local constraint=instance('Shoulder','AnimationConstraint',rig);local a0=instance('A0','Attachment',torso);local a1=instance('A1','Attachment',arm);constraint.Attachment0=a0;constraint.Attachment1=a1
build(spec('Constraint'));check(saves:FindFirstChild('Constraint')~=nil,'constraint support')
-- Failure while parenting a NEW draft leaves no attached sequence.
failParent=true;rejected(spec('CommitFail'),'transaction failed');failParent=false;check(saves:FindFirstChild('CommitFail')==nil,'partial sequence')
-- Replacing owned draft: inject a one-shot commit failure; old root must be restored.
local old=saves:FindFirstChild('Constraint');local replacement=spec('Constraint');replacement.action_id='replacement';replacement.revision=1
failParent=true;rejected(replacement,'transaction failed');check(saves:FindFirstChild('Constraint')==old and not old.Destroyed,'old draft not restored')
local r15=instance('R15','Model',workspace);local root15=instance('HumanoidRootPart','Part',r15);local hips=instance('LowerTorso','Part',r15);local chest=instance('UpperTorso','Part',r15);local upper=instance('RightUpperArm','Part',r15);local hand15=instance('RightHand','Part',r15)
for _,part in ipairs({root15,hips,chest,upper,hand15})do part.CFrame=cf();part.Position=vec(0,0,0)end
for _,pair in ipairs({{root15,hips},{hips,chest},{chest,upper},{upper,hand15}})do local j=instance('Joint','Motor6D',r15);j.Part0=pair[1];j.Part1=pair[2]end
local s15=spec('R15Test');s15.rig='Workspace.R15';for _,key in ipairs(s15.keys)do key.poses.RightUpperArm=key.poses['Right Arm'];key.poses['Right Arm']=nil end
build(s15);check(r15:FindFirstChild('AnimSaves'):FindFirstChild('R15Test')~=nil,'R15 authoring')
local read15=inspect('Workspace.R15');check(string.find(read15,'RightArm')~=nil and not string.find(read15,'nan'),'R15 coincident positions stay finite')
local poseText=inspect('game.Workspace.Rig');check(string.find(poseText,'RightArm')~=nil,'pose read')check(not string.find(poseText,'nan'),'finite pose read')
check(torso.CFrame~=nil and arm.CFrame~=nil,'rig preserved')
return checks
`;
const state=await LuauState.createAsync();
try{
 const code=prelude+'\nlocal function build(SPEC)\n'+build+'\nend\nlocal function inspect(RIG)\n'+inspect+'\nend\n'+run;
 const result=await state.loadstring(code,'eclipse-helper-tests',true)();
 assert(result[0]>=40);console.log(`PASS Eclipse actual Luau helpers: ${result[0]} checks on simulated DataModel (R6/R15 Motor6D/AnimationConstraint, keys/markers/easing, replay/conflicts, preservation, malformed input, commit failure, read-only pose inspection). Real Eclipse UI not exercised.`);
}finally{state.destroy();}
