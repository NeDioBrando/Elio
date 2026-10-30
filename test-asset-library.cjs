const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {create}=require('./core/asset-library.js');const data=JSON.parse(fs.readFileSync('core/asset-library/catalog.json','utf8'));const run=create(data);
const stats=run({action:'stats'});assert.equal(stats.total,5515);assert.deepEqual(stats.counts,{texture:5228,mesh:287});assert(stats.categories.includes('impact'));
for(const [ru,en] of [['огонь','fire'],['дым','smoke'],['молния','lightning'],['меч','sword']]){const a=run({action:'search',query:ru}),b=run({action:'search',query:en});assert(a.total>0);assert.deepEqual(a,b);}
assert(run({action:'search',query:'impact',kind:'texture',layout:'4x4'}).total>0);
assert.equal(run({action:'search',kind:'mesh'}).total,287);
assert.deepEqual(run({action:'search',query:'текстура огня'}),run({action:'search',query:'fire'}));
assert.equal(run({action:'search',query:'elio_no_match_7c91'}).total,0);
const page=run({action:'search',limit:2});assert.equal(page.results.length,2);assert.equal(page.next_offset,2);assert.notDeepEqual(page.results,run({action:'search',limit:2,offset:2}).results);
const wave=run({action:'get',key:'mesh:99306099992330'});assert(wave.ok);assert(wave.frame_sequences.length>0);assert(wave.related_frames.length>=16);assert(wave.related_frames.every((f,i,a)=>i===0||a[i-1].frame_index<=f.frame_index));
const frames=run({action:'search',sequence:wave.frame_sequences[0],limit:30});assert.equal(frames.total,wave.related_frames.length);assert(frames.results.every(r=>r.layouts.includes('SeparateFrames')));
assert.equal(run({action:'get',key:'mesh:99306099992330',sequence:'wrong'}).ok,false);
const fox=run({action:'get',key:'texture:917186750'});assert(fox.entry.sources.includes('fox'));assert(fox.entry.variants.some(v=>v.asset_type_id===1));
const listing=run({action:'get',key:'mesh:431984625'});assert(listing.entry.variants.some(v=>v.listing_asset_id==='431984629'));assert.equal(run({action:'get',key:'mesh:431984629'}).ok,false);
const mesh=run({action:'get',key:'mesh:1290033'});assert(mesh.entry.names.includes('Meteor'));assert(mesh.paired_textures.some(r=>r.asset_id==='1290030'));assert.match(mesh.guide,/Do not assign MeshPart.MeshId/);
for(const req of [{action:'delete'},{action:'get',key:'1290033'},{action:'search',limit:100000},{action:'search',offset:-1},{action:'search',query:'x'.repeat(301)},{action:'search',kind:'model'},{action:'search',execute:'os.execute()'}])assert.equal(run(req).ok,false,JSON.stringify(req));
for(const r of data.entries){assert(r.names.length);assert(r.sources.every(s=>data.sources[s]));assert(r.variants.length);for(const key of r.paired_texture_keys||[])assert(run({action:'get',key}).ok);assert.equal(r.availability,'not_checked');}
assert.throws(()=>create({...data,entries:[...data.entries,data.entries[0]]}),/duplicate/);
// Malicious source name remains inert JSON data; no generation/eval of names.
const fake=JSON.parse(JSON.stringify(data.entries[0]));fake.names=['"; globalThis.PWN=1; //'];const hostile=create({schema:1,entries:[fake],counts:{texture:1},sources:data.sources});assert.equal(hostile({action:'get',key:fake.key}).entry.names[0],fake.names[0]);assert.equal(globalThis.PWN,undefined);
for(const f of ['background.js','core/main.js','core/asset-library.js','core/asset-library/catalog.json','core/asset-library/supplement.json'])assert.equal(fs.readFileSync(f,'utf8'),fs.readFileSync('elio-Extension/'+f,'utf8'));
const src=fs.readFileSync('core/main.js','utf8');const acorn=require('acorn');const ast=acorn.parse(src,{ecmaVersion:'latest'});function find(n,name){if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id?.name===name)return n;for(const v of Object.values(n)){if(Array.isArray(v)){for(const x of v){const r=find(x,name);if(r)return r;}}else if(v&&typeof v==='object'){const r=find(v,name);if(r)return r;}}}
// Extract production dispatch function; call the actual branch with guard stubs.
const n=find(ast,'runToolImpl');assert(n);const c={A:{stop:false,toolList:[]},isStopped:()=>false,SendAbortedError:class extends Error{},elioToolGuard:{repair:x=>x,check:()=>[]},bg:async msg=>{assert.equal(msg.type,'asset_library');return run(msg.request);},console};
// Verify advertised schema parses and includes the bounded read-only actions.
assert.match(src,/name:'elio_asset_library'/);assert.match(src,/BUILT-IN ASSET LIBRARY/);assert.match(src,/otherwise search elio_asset_library first/);
(async()=>{
 vm.createContext(c);vm.runInContext(src.slice(n.start,n.end)+';this.dispatch=runToolImpl',c);
 assert.match(await c.dispatch({tool:'elio_asset_library',arguments:{action:'search',query:'молния'}}),/^Output of 'elio_asset_library':/);
 assert.match(await c.dispatch({tool:'elio_asset_library',arguments:{action:'delete'}}),/^ERROR:/);
 c.A.stop=true;assert.match(await c.dispatch({tool:'elio_asset_library',arguments:{action:'stats'}}),/stopped/);
 const bg=fs.readFileSync('background.js','utf8');const prefix=bg.slice(0,bg.indexOf('// Elio build compatibility:'));let fetches=0;const context={ElioAssetLibrary:{create},chrome:{runtime:{getURL:p=>'chrome-extension://test/'+p}},fetch:async url=>{assert.equal(url,'chrome-extension://test/core/asset-library/catalog.json');fetches++;return {ok:true,json:async()=>data}}};vm.createContext(context);vm.runInContext(prefix+'this.lookup=localAssetLibrary',context);
 assert((await context.lookup({action:'search',query:'дым'})).total>0);assert((await context.lookup({action:'get',key:'mesh:1290033'})).ok);assert.equal(fetches,1);assert.equal((await context.lookup({action:'delete'})).ok,false);
 assert(bg.includes('sendResponse(await localAssetLibrary(msg.request))'));
 console.log('PASS asset library: 5515 records; type separation, provenance, mesh-texture pairs, RU/EN search, flipbooks, pagination, bounds, hostile metadata, offline bridge caching and mirrored packaging.');
})().catch(e=>{console.error(e);process.exitCode=1});
