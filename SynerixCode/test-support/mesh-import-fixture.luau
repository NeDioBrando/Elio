-- Execute the actual generated import transactions with strict Roblox mocks.
local Vector = {}
Vector.__index=Vector
function Vector.new(x,y,z)return setmetatable({X=x,Y=y,Z=z},Vector)end
function Vector.__add(a,b)return Vector.new(a.X+b.X,a.Y+b.Y,a.Z+b.Z)end
function Vector.__sub(a,b)return Vector.new(a.X-b.X,a.Y-b.Y,a.Z-b.Z)end
function Vector.__mul(a,b)return Vector.new(a.X*b,a.Y*b,a.Z*b)end
function Vector.__div(a,b)return Vector.new(a.X/b,a.Y/b,a.Z/b)end
local Vector3={new=Vector.new}
local Vector2={new=function(x,y)return {X=x,Y=y}end}
local Color3={new=function(r,g,b)return{r,g,b}end}
local CFrame={new=function(vector)return vector end}
local Nodes={}
local function node(class)
 local value={ClassName=class,Name=class,attributes={},children={}}
 function value:FindFirstChild(name)for _,child in ipairs(self.children)do if child.Name==name then return child end end end
 function value:GetChildren()return table.clone(self.children)end
 function value:SetAttribute(key,item)self.attributes[key]=item end
 function value:GetAttribute(key)return self.attributes[key]end
 function value:GetFullName()return self.Name end
 function value:Destroy()for _,child in ipairs(table.clone(self.children))do child:Destroy()end;self.Parent=nil;self.destroyed=true end
 return setmetatable(value,{__index=function(self,key)if key=='Parent'then return rawget(self,'parent')end end,__newindex=function(self,key,item)
  if key~='Parent'then rawset(self,key,item);return end
  local previous=rawget(self,'parent');if previous then for i,child in ipairs(previous.children)do if child==self then table.remove(previous.children,i);break end end end
  rawset(self,'parent',item);if item then table.insert(item.children,self)end
 end})
end
local Instance={new=node}
local workspace=node('Workspace')
local storage=node('ServerStorage')
local existing=node('Model');existing.Name='SYNERIXCODE_Imported';existing.Parent=workspace
local meshes={};local failCreate=false
local service={}
function service:CreateEditableMesh()
 local mesh={vertices={},faces={},colors={},uvs={},faceColors={},faceUVs={}};table.insert(meshes,mesh)
 function mesh:AddVertex(point)local id=#self.vertices;table.insert(self.vertices,point);return id end
 function mesh:AddTriangle(a,b,c)assert(a~=b and b~=c and a~=c,'Overwritten vertex IDs');local id=#self.faces;table.insert(self.faces,{a,b,c});return id end
 function mesh:AddColor(color,alpha)local id=#self.colors;table.insert(self.colors,{color,alpha});return id end
 function mesh:AddUV(uv)local id=#self.uvs;table.insert(self.uvs,uv);return id end
 function mesh:SetFaceColors(id,colors)self.faceColors[id+1]=colors end
 function mesh:SetFaceUVs(id,uvs)self.faceUVs[id+1]=uvs end
 function mesh:GetSize()local lo=Vector.new(math.huge,math.huge,math.huge);local hi=Vector.new(-math.huge,-math.huge,-math.huge);for _,v in ipairs(self.vertices)do lo=Vector.new(math.min(lo.X,v.X),math.min(lo.Y,v.Y),math.min(lo.Z,v.Z));hi=Vector.new(math.max(hi.X,v.X),math.max(hi.Y,v.Y),math.max(hi.Z,v.Z))end;return hi-lo end
 function mesh:Destroy()self.destroyed=true end
 return mesh
end
function service:CreateMeshPartAsync(content)if failCreate then error('Mesh permission denied')end;local part=node('MeshPart');part.mesh=content;return part end
local Content={fromObject=function(mesh)return mesh end}
local game={GetService=function(_,name)if name=='AssetService'then return service elseif name=='ServerStorage'then return storage end;error('Unexpected service')end}
__PRODUCTION__
assert(string.find(first(),'Staged mesh 1/2',1,true))
assert(#workspace:GetChildren()==1 and workspace:GetChildren()[1]==existing,'Partial model must not be published')
local stage=storage:FindFirstChild('_synerixcodeMesh_success');assert(stage and stage:GetAttribute('NextMesh')==2)
local before=#meshes;assert(not pcall(first),'A completed command cannot run twice');assert(#meshes==before and stage:GetAttribute('NextMesh')==2)
assert(string.find(second(),'Imported 2 real mesh',1,true));assert(#storage:GetChildren()==0)
local published=workspace:GetChildren()[2];assert(published.Name=='SYNERIXCODE_Imported' and #published:GetChildren()==2)
local part=published:GetChildren()[1];assert(part.CFrame.X==22 and part.CFrame.Y==42 and part.CFrame.Z==60)
assert(part.Size.X==4 and part.Size.Y==4 and part.Size.Z==0.001,'Flat meshes have a valid thickness without altering vertex positions')
local mesh=part.mesh;assert(mesh.faces[1][1]==0 and mesh.faces[1][2]==1 and mesh.faces[1][3]==2)
assert(mesh.vertices[1].X==-2 and mesh.vertices[1].Y==-2 and mesh.vertices[1].Z==0)
assert(#mesh.colors==1 and #mesh.uvs==3 and #mesh.faceColors[1]==3 and #mesh.faceUVs[1]==3)
assert(existing.Parent==workspace and not existing.destroyed,'Existing imported models are preserved')
assert(string.find(failingFirst(),'Staged mesh',1,true));failCreate=true
assert(not pcall(failingSecond),'Failed Studio import must return an error')
assert(not storage:FindFirstChild('_synerixcodeMesh_failure'),'Failed transfer removes its own staging model')
assert(meshes[#meshes].destroyed,'Failed unowned editable mesh is released')
assert(#workspace:GetChildren()==2 and existing.Parent==workspace,'Failure cannot damage existing published models')
print('PASS actual generated Luau mesh transactions: exact geometry/zero-based IDs, UVs/colors, staged publication, no replay and failure cleanup')
