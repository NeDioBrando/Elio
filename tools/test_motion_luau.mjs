import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../release-tools/package.json',import.meta.url));
const {LuauState}=await import(pathToFileURL(require.resolve('luau-web')));
const root=fileURLToPath(new URL('../',import.meta.url));
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const ctx=vm.createContext({console});vm.runInContext(fs.readFileSync(root+'core/motion-interchange.js','utf8')+';this.api=ZSMotionInterchange',ctx);
const state=await LuauState.createAsync();
const prelude=`
local function json(v)
 if type(v)=='nil' then return 'null' end
 if type(v)=='string' then return string.format('%q',v) end
 if type(v)=='number' or type(v)=='boolean' then return tostring(v) end
 local parts={} if #v>0 then for _,x in ipairs(v) do table.insert(parts,json(x)) end return '['..table.concat(parts,',')..']' end
 for k,x in pairs(v) do table.insert(parts,json(tostring(k))..':'..json(x)) end table.sort(parts) return '{'..table.concat(parts,',')..'}'
end
local HttpService={JSONEncode=function(_,v) return json(v) end}
local CollectionService={GetTags=function()return {}end}
local function instance(name,class,parent)
 local data={Name=name,ClassName=class,children={},attributes={}}
 local o=setmetatable({}, {__index=data,__newindex=function(self,k,v)
  if k=='Parent' then
   if data.Parent then for i,c in ipairs(data.Parent.children) do if c==self then table.remove(data.Parent.children,i) break end end end
   data.Parent=v;if v then table.insert(v.children,self)end
  else data[k]=v end
 end})
 function o:FindFirstChild(n) for _,c in ipairs(self.children) do if c.Name==n then return c end end end
 function o:GetAttributes()return self.attributes end
 function o:GetAttribute(k)return self.attributes[k]end
 function o:SetAttribute(k,v)self.attributes[k]=v end
 function o:IsA(c)return c==self.ClassName or (c=='BasePart' and self.ClassName=='Part')end
 function o:GetChildren()return self.children end
 function o:GetDescendants()local t={} for _,c in ipairs(self.children)do table.insert(t,c) for _,d in ipairs(c:GetDescendants())do table.insert(t,d)end end return t end
 function o:IsDescendantOf(root)local x=self.Parent while x do if x==root then return true end x=x.Parent end return false end
 function o:Destroy()self.Parent=nil self.Destroyed=true end
 function o:Clone()local clone=instance(self.Name,self.ClassName)for k,v in pairs(data)do if k~='Parent' and k~='children' and k~='attributes' and type(v)~='function' then clone[k]=v end end for k,v in pairs(self.attributes)do clone:SetAttribute(k,v)end for _,child in ipairs(self.children)do local c=child:Clone()c.Parent=clone end return clone end
 o.Parent=parent;return o
end
local Instance={new=function(class)return instance(class,class)end}
local game=instance('Game','DataModel')
function game:GetService(name)if name=='HttpService' then return HttpService elseif name=='CollectionService'then return CollectionService else return self:FindFirstChild(name)end end
local workspace=instance('Workspace','Workspace',game)
local storage=instance('ServerStorage','ServerStorage',game)
local baseplate=instance('Baseplate','Part',workspace)
baseplate.Anchored=true;baseplate.Transparency=0;baseplate.CanCollide=true
local texture=instance('Texture','Texture',baseplate);texture.Texture='rbxassetid://6372755229';texture.Transparency=0.8
`;
try{
 for(const [action,path,expectOK] of [['read_vfx','game.Workspace.Baseplate',true],['read_vfx','game.Workspace.Missing',false],['read_animation','game.Workspace.Baseplate',false]]){
  const c=ctx.api.compileScan({action,path});assert(c.ok);const result=await state.loadstring(prelude+c.code,'motion-read',true)();const receipt=JSON.parse(result[0]);assert.equal(receipt.ok,expectOK,JSON.stringify(receipt));if(expectOK){assert.equal(receipt.total_records,2);assert.equal(receipt.complete,true);assert.equal(receipt.format,'elio-motion-bundle/v2')}console.log('PASS actual generated Luau returned receipt:',action,path,receipt.ok);
 }
 const copy=ctx.api.compileCopy({action_id:'audit-copy',build_id:'audit',kind:'vfx',source_path:'game.Workspace.Baseplate',target_parent:'game.ServerStorage',root_name:'Audit'});assert(copy.ok);
 const integrate=ctx.api.compileIntegration({action_id:'audit-integrate',build_id:'audit',profile:'skill',target_parent:'game.ServerStorage',module_name:'AuditRuntime',animation_id:'123'});assert(integrate.ok);
 const sequence=prelude+'\nlocal function copy()\n'+copy.code+'\nend\nlocal function integrate()\n'+integrate.code+'\nend\n'+`
 local first=copy()local second=copy()
 assert(storage:FindFirstChild('Audit')~=nil)assert(#storage:FindFirstChild('Audit'):GetDescendants()==1)
 local integration=integrate()local replay=integrate()
 local module=storage:FindFirstChild('AuditRuntime')assert(module and module.Source)
 local count=0 for _,x in ipairs(storage:GetChildren())do if x.Name=='Audit' then count+=1 end end assert(count==1)
 assert(#workspace:GetDescendants()==2)
 return first,second,integration,replay,module.Source
 `;
 const result=await state.loadstring(sequence,'motion-transactions',true)();
 const [first,second,integration,replay]=result.slice(0,4).map(JSON.parse);
 assert(first.ok);assert.equal(first.verified_fidelity,true);assert.equal(first.replayed,false);assert.equal(second.replayed,true);assert(integration.ok);assert.equal(integration.replayed,false);assert.equal(replay.replayed,true);
 state.loadstring(result[4],'installed-motion-runtime',true);
 console.log('PASS actual generated Luau on mock DataModel: exact copy/fidelity, duplicate replay, runtime install/replay, generated module syntax, untouched source');

} finally {state.destroy()}
