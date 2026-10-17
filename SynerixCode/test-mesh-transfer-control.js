const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{parse}=require('./release-tools/node_modules/acorn');
const source=fs.readFileSync('core/main.js','utf8'),names=['luauLiteral','studioMeshLuau','runAssetBridgeImport'],found={};function walk(node){if(!node?.type)return;if(node.type==='FunctionDeclaration'&&names.includes(node.id.name))found[node.id.name]=source.slice(node.start,node.end);for(const v of Object.values(node))if(Array.isArray(v))v.forEach(walk);else if(v?.type)walk(v);}walk(parse(source,{ecmaVersion:'latest'}));
const mesh={name:'Triangle',verts:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,2]],face_uvs:[[[0,0],[1,0],[0,1]]],face_colors:[[1,0.5,0,1]]};
(async()=>{for(const mode of ['success','stop','unknown','invalid','asset']){let calls=[],bgCalls=0;const A={bridge:{blender:true},sessionGen:1,stop:false};const box={A,crypto:{randomUUID:()=> 'transfer-id'},P:{conversationKey:()=> 'chat'},activeEngine:()=> 'roblox',feedbackIsError:text=>/^ERROR/.test(text),bg:async()=>{bgCalls++;throw Error('Do not dump supplied meshes twice');},runTool:async call=>{calls.push(call);if(mode==='stop')A.stop=true;return mode==='unknown'?'ERROR: response timed out; edit may have run':'Imported';}};vm.createContext(box);vm.runInContext(names.map(name=>found[name]).join('\n')+';this.run=runAssetBridgeImport;',box);
 const args=mode==='asset'?{asset:'1234'}:{meshes:[structuredClone(mesh),structuredClone(mesh)]};if(mode==='invalid')args.meshes[1].faces=[[0,1,99]];
 const result=await box.run(args);assert.equal(bgCalls,0);
 if(mode==='success'){assert.equal(calls.length,2);assert(calls.every(call=>call.tool==='execute_luau'));assert.equal(result,'Imported');}
 if(mode==='stop'||mode==='unknown'){assert.equal(calls.length,1,'No next command after stop or uncertain result');assert(result.includes('no command was replayed'));}
 if(mode==='invalid'){assert.equal(calls.length,0,'Validate all objects before any Studio mutation');assert(result.includes('invalid mesh triangles'));}
 if(mode==='asset'){assert.equal(calls.length,1);assert(!calls[0].arguments.code.includes('Instance.new("MeshPart")'),'No fake replacement after failed asset load');assert(calls[0].arguments.code.includes('Asset import failed'));}
 }
 console.log('PASS mesh-transfer validation, one command per object, Stop/uncertain-result cancellation, no repeated dump and honest asset import failures.');
})().catch(error=>{console.error(error);process.exitCode=1;});
