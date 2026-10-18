// 1.24.13: the user's tested fixes (fresh Blender screenshots, Studio heal
// guard, honest dashboard Studio status, clean release files) merged with
// test builds 4-6. Guards that none of them is lost in later builds.
const fs=require('fs'),assert=require('node:assert/strict'),{parse}=require('./release-tools/node_modules/acorn');
const bg=fs.readFileSync('background.js','utf8');
for(const copy of ['elio-Extension/background.js'])assert.equal(fs.readFileSync(copy,'utf8'),bg,copy+' matches the root background.js');
parse(bg,{ecmaVersion:'latest'});
// Studio "semi connected" loop: no heal while attaching/linked/closed, 3 misses, 60 s grace, 3 min cooldown, bridge confirmation.
assert.match(bg,/const MCP_HEAL_STREAK = 3;/);assert.match(bg,/const MCP_HEAL_GRACE_MS = 60000;/);assert.match(bg,/const MCP_HEAL_COOLDOWN_MS = 180000;/);
assert.match(bg,/studioProc === false \|\| studioApp === false \|\| studioChecking \|\|\s*robloxEditorConnected === true \|\| studioConnected === true/);
assert.match(bg,/mcpDownStreak >= MCP_HEAL_STREAK && !mcpHealInFlight &&\s*now - lastSocketOpenAt > MCP_HEAL_GRACE_MS &&\s*now - lastMcpHealAt > MCP_HEAL_COOLDOWN_MS/);
assert.match(bg,/send\(\{ type: "mcp_status" \}, 10000\)\.then\(\(st\) => \{\s*if \(!st \|\| !st\.ok \|\| st\.alive !== false/,'restart only after the bridge confirms the helper is dead');
assert.match(bg,/lastSocketOpenAt = Date\.now\(\);/);assert(!/mcpDownStreak >= 1 &&/.test(bg),'old one-miss heal is gone');
// Fresh Blender screenshots.
assert.match(bg,/function blenderShotCode\(filepath, maxSize\)/);assert.match(bg,/type: "execute_code", params: \{ code: blenderShotCode\(shot, a\.max_size\) \}/);
const py=fs.readFileSync('launch_blender_mcp.py','utf8');
assert.match(py,/elio_blender_shot_\{os\.getpid\(\)\}_\{time\.time_ns\(\)\}\.png/,'unique capture file');assert.match(py,/blender_command\("execute_code", \{"code": _SHOT_CODE\.format/);assert.match(py,/GPUOffScreen/);assert.match(py,/screenshot_area/);
// Dashboard: Connected only when the editor link is up.
const html=fs.readFileSync('agent/src/desktop.html','utf8');
assert.match(html,/var Studio = State\.roblox_connected===true;/);assert(!html.includes('var Studio = !!State.studio_running && !!State.mcp_alive;'));
assert.match(html,/Byid\("studioVal"\)\.textContent = Studio \? "Connected" : State\.studio_running \? "Open" : "Offline";/);
// Release files: launcher, SOURCE.txt and Firefox copy come from this source; SHA256SUMS recomputed.
const version=JSON.parse(fs.readFileSync('manifest.json','utf8')).version;
const pack=fs.readFileSync('../../development/'+version+'/package.py','utf8');
assert.match(pack,/'launch_blender_mcp\.py','SOURCE\.txt'/);assert.match(pack,/elio-Extension-Firefox/);assert.match(pack,/SHA256SUMS\.txt/);assert.match(pack,/checksum'/);
const notice=fs.readFileSync('SOURCE.txt','utf8');
assert(notice.includes(version),'Source notice must describe the current manifest version');
assert(notice.includes('https://github.com/stoveez/Elio/'),'Preserve a source retrieval link');
assert.match(notice,/GPL-3\.0-or-later/);
// Builds 4-6 are still present alongside the merged fixes.
const main=fs.readFileSync('core/main.js','utf8'),manifest=fs.readFileSync('manifest.json','utf8');
assert.match(main,/function showSkillSuggestion/);assert.match(main,/SKILL_OFFER_MS=45000/);assert.match(main,/always_use:true/);assert(manifest.includes('core/input-isolation.js'));
console.log('1.24.13 merged fixes: Studio heal guard, fresh Blender screenshots, honest dashboard status, clean release files, plus builds 4-6');
