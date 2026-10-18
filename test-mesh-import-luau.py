"""Execute the shipped JS-generated Studio mesh transactions in official Luau."""
from pathlib import Path
import os, subprocess, tempfile, json
root=Path(__file__).resolve().parent
script=r'''
const fs=require('fs'),vm=require('vm'),{parse}=require('./release-tools/node_modules/acorn');
const source=fs.readFileSync('core/main.js','utf8'),found={};
function walk(node){if(!node?.type)return;if(node.type==='FunctionDeclaration'&&['luauLiteral','studioMeshLuau'].includes(node.id.name))found[node.id.name]=source.slice(node.start,node.end);for(const v of Object.values(node))if(Array.isArray(v))v.forEach(walk);else if(v?.type)walk(v);}walk(parse(source,{ecmaVersion:'latest'}));
const box={};vm.createContext(box);vm.runInContext(found.luauLiteral+'\n'+found.studioMeshLuau+';this.make=studioMeshLuau;',box);
const mesh={name:'Triangle',verts:[[10,20,30],[12,20,30],[10,22,30]],faces:[[0,1,2]],face_uvs:[[[0,0],[1,0],[0,1]]],face_colors:[[1,0.5,0.25,1]]};
const cases=[['first','success',0],['second','success',1],['failingFirst','failure',0],['failingSecond','failure',1]];
process.stdout.write(cases.map(([name,id,index])=>'local function '+name+'()\n'+box.make([mesh],'Workspace',2,id,index,2)+'\nend\n').join('\n'));
'''
production=subprocess.run(['node','-e',script],cwd=root,check=True,capture_output=True,text=True).stdout
fixture=(root/'test-support/mesh-import-fixture.luau').read_text().replace('__PRODUCTION__',production)
with tempfile.TemporaryDirectory(prefix='elio-mesh-luau-') as temporary:
 path=Path(temporary)/'mesh-import.luau';path.write_text(fixture)
 subprocess.run([os.environ.get('ELIO_LUAU','luau'),str(path)],check=True,timeout=30)
