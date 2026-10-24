// SPDX-License-Identifier: GPL-3.0-or-later
// 1.22.1: (1) desktop Model/UI Builder Generate sent creator-send, which the
// extension rejected as "Invalid desktop agent action."; (2) creation_preview
// save failed with "action_id must be a string" when the model omitted the
// blueprint's action_id; (3) models called a Studio MCP `skill` tool with a
// elio tool name ("Unknown skill: creation_preview").
const fs = require('fs'), assert = require('node:assert/strict');
const BG = process.argv[2] || 'background.js', MAIN = process.argv[3] || 'core/main.js', GUARD = process.argv[4] || './core/tool-guard.js';
// (1) Every action the desktop sends and the bridge forwards is accepted by the extension.
const bg = fs.readFileSync(BG, 'utf8');
const list = bg.match(/\[([^\]]*)\]\.includes\(msg\.action\)\)\s*throw new Error\("Invalid desktop agent action\."\)/);
assert(list, 'desktop action whitelist present');
const allowed = new Set([...list[1].matchAll(/"([a-z-]+)"/g)].map(m => m[1]));
const html = fs.readFileSync('agent/src/desktop.html', 'utf8');
const sent = new Set();
for (const m of html.matchAll(/\/api\/desktop\/agent"[^)]*?action:\s*["']([a-z-]+)["']/g)) sent.add(m[1]);
for (const m of html.matchAll(/Desktopaction\(\s*["']([a-z-]+)["']/g)) sent.add(m[1]);
assert(!sent.has('creator-send') && !sent.has('creator-insert'), 'Removed desktop builders must not send creator actions');
const rust = fs.readFileSync('agent/src/main.rs', 'utf8');
for (const a of ['creator-send', 'creator-insert', 'task-send', 'activity-read', 'handoff-export', 'budget-resume', 'media-stage']) {
  assert(rust.includes(`"${a}"`), 'bridge knows ' + a);
  assert(allowed.has(a), `extension accepts desktop action ${a}`);
}
for (const a of sent) if (rust.includes(`"${a}"`) && !/^(check|context|list|export)$/.test(a)) assert(allowed.has(a), `desktop sends ${a} but the extension rejects it`);
// (2) creation_preview fills a valid preview action_id only when it is missing.
const main = fs.readFileSync(MAIN, 'utf8');
assert(/action_id==null\|\|[^;]*action_id===""\)\)[^;]*action_id="preview-"\+crypto\.randomUUID\(\)/.test(main.replace(/\s+/g, '')), 'missing action_id is filled');
const HB = new Function(fs.readFileSync('core/headless-builder.js', 'utf8') + ';return ZSHeadlessBuilder;')();
assert(HB && typeof HB.compile === 'function', 'headless builder loads');
{
  const bp = { build_id: 'crate-1', mode: 'model', operation: 'replace', target_parent: 'game.Workspace', root_name: 'Crate', root_id: 'root', nodes: [{ id: 'root', class: 'Model', name: 'Crate' }, { id: 'p', parent: 'root', class: 'Part', name: 'Box', properties: { Anchored: true } }] };
  assert.equal(HB.compile({ ...bp }).error, 'action_id must be a string', 'reproduces the reported error without an action_id');
  const r = HB.compile({ ...bp, action_id: 'preview-' + require('crypto').randomUUID() });
  assert(r.ok, 'generated preview action_id is valid: ' + r.error);
}
// (3) Knowledge requests must never be silently promoted to other commands.
const G=require(GUARD);
const tools=[{name:'skill',inputSchema:{type:'object',properties:{skill_name:{type:'string'}}}},{name:'headless_build'},{name:'creation_preview'},{name:'execute_luau'}];
for(const args of [{skill_name:'headless_build',studio_id:'studio'},{name:'creation_preview',arguments:{action:'save'}},{skill:'creation_preview',action:'read',build_id:'crate-1'},{name:'/execute_luau',args:'{"code":"return 1"}'},{name:'rbx-debug'}]){
 const call={tool:'skill',arguments:structuredClone(args)};G.repair(call,tools);assert.equal(call.tool,'skill');assert.deepEqual(call.arguments,args);
}
console.log('PASS desktop action contracts, preview action_id generation and skill lookup isolation.');
