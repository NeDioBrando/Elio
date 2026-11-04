import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {LuauState} from '../release-tools/node_modules/luau-web/src/index.js';
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('core/studio_skills.js','utf8')+';this.skills=RobloxScriptSkills',ctx);
const skills=ctx.skills,lib=skills.SKILLS_LIB_LUA;
const fn=lib.slice(lib.indexOf('function api.read_scripts(a)'),lib.indexOf('function api.script_analysis(a)'));
const state=await LuauState.createAsync();let tests=0;
const fixture=String.raw`
local api={} local answer=nil local writes=0
local function fail(error)return {ok=false,error=error}end
local function okdata(data,text)return {ok=true,data=data}end
local function node(name,class,parent,source)
 local d={Name=name,ClassName=class,Parent=parent,Source=source,children={}}
 local n=setmetatable({}, {__index=d,__newindex=function()writes+=1 error('mutation')end})
 function d:IsA(c)return c==class or c=='LuaSourceContainer' and (class=='Script' or class=='ModuleScript' or class=='LocalScript')end
 function d:GetChildren()return d.children end
 function d:FindFirstChild(k)for _,c in ipairs(d.children)do if c.Name==k then return c end end end
 if parent then table.insert(parent.children,n)end
 return n,d
end
local game,gd=node('game','DataModel')
local ss=node('ServerStorage','ServerStorage',game)
local rs=node('ReplicatedStorage','ReplicatedStorage',game)
local core=node('CoreGui','CoreGui',game)
local a,ad=node('A','ModuleScript',ss,'return "Привет 🌍"\n'..string.rep('-- длинная строка 🐔\n',600))
local b,bd=node('B','Script',ss,'return 2')
local c,cd=node('C','ModuleScript',rs,'saved source')
local editor={GetEditorSource=function(_,n)if n==c then return 'unsaved editor buffer' end return n.Source end}
function gd:GetService(name)if name=='ScriptEditorService'then return editor end local n=self:FindFirstChild(name)if not n then error('not present')end return n end
local function pathOf(n)local p={}while n and n~=game do table.insert(p,1,n.Name)n=n.Parent end return table.concat(p,'.')end
local function resolvePath(p)local n=game for s in p:gsub('^game%.',''):gmatch('[^%.]+')do n=n:FindFirstChild(s)if not n then return nil end end return n end
`;
async function run(code){await state.loadstring(fixture+'\n'+fn+'\n'+code+'\nassert(writes==0)\nreturn true','read-scripts-'+tests,true)();tests++;}
try{
 state.loadstring(skills.buildLuau('read_scripts',{}).code,'whole-generated-read-scripts',true);
 await run(`local result=api.read_scripts({list_only=true})assert(result.ok and result.data.total_scripts==3)assert(result.data.scripts[1].source==nil)assert(result.data.read_only)`);
 await run(`local result=api.read_scripts({paths={'ReplicatedStorage.C'}})assert(result.ok)assert(result.data.scripts[1].source=='unsaved editor buffer')`);
 await run(`assert(not api.read_scripts({paths={'CoreGui'}}).ok)assert(not api.read_scripts({paths={'ServerStorage.Missing'}}).ok)assert(not api.read_scripts({max_scripts=1}).ok)`);
 await run(`local text='' local cursor=nil local pages=0 repeat local result=api.read_scripts({paths={'ServerStorage.A'},max_chars=2000,cursor=cursor})assert(result.ok)pages+=1 assert(pages<40)for _,item in ipairs(result.data.scripts)do assert(utf8.len(item.source))text..=item.source end cursor=result.data.next_cursor until not cursor assert(text==ad.Source)assert(pages>1)`);
 await run(`local first=api.read_scripts({paths={'ServerStorage.A'},max_chars=2000})assert(first.ok and first.data.next_cursor)ad.Source..='changed'local next=api.read_scripts({paths={'ServerStorage.A'},max_chars=2000,cursor=first.data.next_cursor})assert(not next.ok and next.error:find('snapshot changed'))`);
 await run(`local result=api.read_scripts({paths={'ServerStorage','ServerStorage.A'},max_chars=2000,line_numbers=true})assert(result.ok and result.data.scripts[1].source:find('1\\t',1,true))assert(#result.data.scripts[1].source<=2000)`);
 await run(`node('A','Script',ss,'duplicate')local result=api.read_scripts({folders={'ServerStorage'}})assert(not result.ok and result.error:find('Ambiguous'))`);
 await run(`local result=api.read_scripts({paths={'ServerStorage.B'}})assert(result.ok and result.data.scripts[1].source=='return 2' and not result.data.next_cursor)`);
 for(const input of [{paths:null},{folders:{}},{max_chars:NaN},{max_scripts:2001},{paths:['CoreGui',1]},{folders:['']},{max_chars:1},{cursor:'x'.repeat(170)}])assert(skills.buildLuau('read_scripts',input).err);
 console.log(`PASS read_scripts: complete generated Luau compiled; ${tests} read-only runtime fixtures, Unicode paging, edited-source cursor refusal, editor buffer, duplicate paths, root guards, scan caps and input validation`);
}finally{state.destroy();}
