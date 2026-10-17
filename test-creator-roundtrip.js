const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx=vm.createContext({crypto:require('node:crypto').webcrypto,console});
vm.runInContext(fs.readFileSync('core/headless-builder.js','utf8')+'\n'+fs.readFileSync('core/creator.js','utf8')+'\nthis.C=synerixcodeCreator;this.H=ZSHeadlessBuilder',ctx);
const {C,H}=ctx;
for(const mode of ['model','ui']){
 const req={action_id:'shape',build_id:'roundtrip-'+mode,mode,operation:'replace',target_parent:mode==='ui'?'game.StarterGui':'game.Workspace',root_name:'Roundtrip',root_id:'root',nodes:[{id:'root',class:mode==='ui'?'ScreenGui':'Model'},{id:'body',class:mode==='ui'?'Frame':'Part',parent:'root',properties:mode==='ui'?{Size:{type:'UDim2',xs:0,xo:200,ys:0,yo:100}}:{Size:{type:'Vector3',x:2,y:2,z:2},Material:{type:'Enum',value:'Enum.Material.Wood'}}}]};
 const saved=C.merge(null,req),before=JSON.stringify(saved);
 assert.equal(saved.nodes[0].parent,'');assert(saved.nodes.some(n=>n.name===''));
 for(const pass of C.batches(saved))assert.equal(H.compile(pass).ok,true);
 assert.equal(JSON.stringify(saved),before,'Insertion must preserve the saved draft');
 assert(C.xml(saved).includes('Roundtrip'));
 const reloaded=C.merge(null,saved);assert.equal(reloaded.nodes.length,2);
 const patch=C.merge(saved,{...req,operation:'patch',action_id:'edit',nodes:[{id:'body',class:'',parent:'',name:'',properties:{Transparency:.25}}]});
 assert.equal(patch.nodes[1].properties.Transparency,.25);for(const pass of C.batches(patch))assert(H.compile(pass).ok);
 assert.throws(()=>C.merge(null,{...saved,version:999}),/version/);
 assert.throws(()=>C.merge(saved,{...req,operation:'patch',nodes:[{id:'body',class:'Part',parent:'root',properties:{}}]}),/omit class/);
 const prompt=C.prompt({mode,description:'A detailed requested design',style:'Clean'});
 const start=prompt.indexOf('requested design): ')+18,end=prompt.indexOf('. Use every coordinate field',start);
 const example=JSON.parse(prompt.slice(start,end));example.action_id='sample';assert(H.compile(example).ok);
 assert.equal(C.tool.inputSchema.properties.blueprint.additionalProperties,false);
 assert(C.tool.inputSchema.properties.blueprint.properties.nodes.items.properties.class);
}
console.log('PASS saved model/UI preview insertion, export, reload and patch round trips; strict validation and valid AI examples.');

const ui={build_id:'sizes',action_id:'sizes',mode:'ui',operation:'replace',target_parent:'game.StarterGui',root_name:'Sizes',nodes:[{id:'root',class:'ScreenGui'},{id:'panel',class:'Frame',parent:'root',properties:{Size:{xScale:.5,yOffset:44},Position:[0,20,0,30]}}]};
const fixed=C.merge(null,ui);const size=fixed.nodes.find(n=>n.id==='panel').properties.Size;assert.equal(size.type,'UDim2');assert.equal(size.xs,.5);assert.equal(size.xo,0);assert.equal(size.ys,0);assert.equal(size.yo,44);
const edit=C.merge(fixed,{...ui,operation:'patch',nodes:[{id:'panel',properties:{Size:{type:'UDim2',xo:100,yo:50}}}]});assert.equal(edit.nodes.find(n=>n.id==='panel').properties.Size.xs,0);
assert.throws(()=>C.merge(null,{...ui,nodes:[ui.nodes[0],{...ui.nodes[1],properties:{Size:{width:5,height:5}}}]}),/type/);
console.log('PASS screenshot Size cases: explicit UI shorthand and omitted UDim2 coordinates; ambiguous objects still rejected.');
