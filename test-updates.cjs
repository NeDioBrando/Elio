// SPDX-License-Identifier: GPL-3.0-or-later
const assert=require('node:assert/strict'),fs=require('node:fs');
const version=require('./core/version.js');
assert.equal(version.compare('1.10.0','1.9.9'),1);
let view=version.describe('1.0.1',{current:'1.0.1',latest:'1.0.2',outdated:true,supported:true});
assert.equal(view.outdated,true);assert.equal(view.title,'Version outdated · Outdated');assert.equal(view.action,'install');assert.equal(view.button,'Update');
view=version.describe('1.0.2',{current:'1.0.1',latest:'1.0.2',outdated:true});assert.equal(view.outdated,true);assert.equal(view.action,'install');
view=version.describe('1.0.1',{current:'1.0.2',latest:'1.0.2',outdated:false});assert.equal(view.reload,true);assert.equal(view.action,'reload');
view=version.describe('1.0.1',{current:'1.0.1',latest:'1.0.2',outdated:true,installing:true,phase:'downloading',size:100,downloaded:40});assert(view.disabled);assert.match(view.text,/40%/);
view=version.describe('1.0.1',{current:'1.0.1',latest:'1.0.1',outdated:false});assert.equal(view.visible,false);
view=version.describe('1.0.1',{phase:'error',error:'Offline'});assert.equal(view.outdated,false);assert.equal(view.action,'check');assert.equal(view.text,'Offline');
view=version.describe('1.0.1',{current:'1.0.1',latest:'1.0.2',outdated:true,error:'Offline',phase:'error'});assert.equal(view.outdated,true);assert.equal(view.notes,'Offline');
for(const file of ['background.js','core/main.js','core/version.js','popup.js','manifest.json'])assert.equal(fs.readFileSync(file,'utf8'),fs.readFileSync('elio-Extension/'+file,'utf8'));
const rust=fs.readFileSync('agent/src/update_service.rs','utf8');assert(rust.includes('NeDioBrando/Elio'));assert(!rust.includes('stoveez'));assert(rust.includes('Download checksum/size mismatch'));assert(rust.includes('begin_tool'));assert(rust.includes('prepared.is_file()'));
const helper=fs.readFileSync('updater/apply-update.ps1','utf8');for(const token of ['Get-FileHash','SHA256','ReparsePoint','Duplicate ZIP file','elio-Extension','Extension version mismatch','Native version mismatch','backup','ROLLBACK FAILED','prepared','ParentPid'])assert(helper.includes(token),token);
assert(!helper.includes('RobloxStudioBeta.exe'));assert(!helper.includes('taskkill'));
console.log('PASS updates: shared Outdated/action state, progress, extension reload, no false current, own channel, native/helper guard contracts');
