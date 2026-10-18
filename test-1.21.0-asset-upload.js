// Regression for 1.21.0 Toolkit asset upload (fails on 1.20.0: no upload dropdown / typed insert).
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=__dirname;let pass=0,fail=0;
function ok(name,cond){if(cond){pass++;console.log('PASS '+name);}else{fail++;console.log('FAIL '+name);}}
const ui=fs.readFileSync(path.join(root,'core','creator-ui.js'),'utf8');
const uiExt=fs.readFileSync(path.join(root,'elio-Extension','core','creator-ui.js'),'utf8');
const rs=fs.readFileSync(path.join(root,'agent','src','toolkit.rs'),'utf8');
ok('root and extension creator-ui.js match',ui===uiExt);
let compiles=true;try{new vm.Script(ui);}catch(e){compiles=false;console.log(e.message);}
ok('creator-ui.js compiles',compiles);
ok('upload toggle sits next to the asset finder',ui.indexOf('assets.append(assetrow);const uploadKinds')>0);
for(const k of ['model','mesh','animation','sound','image','texture','video','package'])ok('dropdown lists '+k,ui.includes("['"+k+"',"));
ok('dropdown is searchable',ui.includes("aria-label','Search uploadable asset types'")&&ui.includes('uploadsearch.oninput=drawKinds'));
ok('upload sends typed insert request',ui.includes("action:'insert-typed-asset',kind:uploadKind,asset_id:v"));
ok('upload requires a type and id',ui.includes('Choose an asset type first.')&&ui.includes('Enter a Roblox asset ID or link.'));
ok('Rust routes insert-typed-asset',rs.includes('"insert-typed-asset"=>typed_asset_code(req)?'));
ok('Rust validates ids',rs.includes('pub fn parse_asset_id'));
ok('Rust has regression test',rs.includes('fn typed_asset_upload_kinds'));
ok('existing model insert kept',rs.includes('"insert-asset"=>{'));
console.log('\n'+pass+' passed, '+fail+' failed');process.exit(fail?1:0);
