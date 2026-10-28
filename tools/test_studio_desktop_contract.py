"""Routing/packaging boundary assertions; not live Windows acceptance."""
from pathlib import Path
import hashlib
R=Path(__file__).resolve().parents[1]
main=(R/'agent/src/main.rs').read_text()
rust=(R/'agent/src/studio_desktop.rs').read_text()
ps=(R/'agent/src/studio_desktop.ps1').read_text()
core=(R/'core/main.js').read_text()
assert main.count('public.extend(studio_desktop::tools())')==1
assert 'public_tools(&self.tools)' in main
route=main[main.index('async fn roblox_tool('):main.index('async fn handle_ws(')]
assert route.index('studio_desktop::call') < route.index('mcp.call_tool')
assert 'name == "studio_ui_action" || name.contains("__")' in main
assert '"screen_capture"|"studio_ui_snapshot"' in main
assert 'state.workspace.full_access()' in rust and 'set_full_access' not in rust
assert 'safety::desktop_policy' in rust
assert rust.index('consume(&mut session') < rust.index('let listing =')
assert 'ids.len() == 1 && ids[0] == studio' in rust
assert '.kill_on_drop(true)' in rust and 'from_secs(25)' in rust
assert 'snapshot.created.elapsed() <= Duration::from_secs(45)' in rust
assert 'Snapshot expired during discovery' in rust and 'deadline_unix_ms' in ps
assert 'include_str!("studio_desktop.ps1")' in rust
assert '"-Command",script' in rust and 'stdin.write_all(&serde_json::to_vec(&request)?)' in rust
assert len(ps.encode('utf-16-le')) < 60000 # -Command, NOT base64 expansion; below CreateProcess command limit
assert "Get-Process -Name RobloxStudioBeta" in ps and '$processes.Count -ne 1' in ps
for guard in ['GetForegroundWindow','GetClientRect','ClientToScreen','WindowFromPoint','GetAncestor','IsWindowEnabled','GetGUIThreadInfo','GetRuntimeId','CopyFromScreen','NoModifiers','SendInput']:
    assert guard in ps,guard
assert 'PrintWindow' not in ps.replace("not PrintWindow's",'')
for f in ['core/main.js','core/studio_skills.js']:
    assert (R/f).read_bytes()==(R/'elio-Extension'/f).read_bytes(),f
for skill in ['vfx-studio','qwinkles-particles-2','emitter2d','eclipse-animator']:
    f=Path('starter-skills')/skill/'SKILL.md'
    assert (R/f).read_bytes()==(R/'elio-Extension'/f).read_bytes()
    assert 'studio_ui_snapshot' in (R/f).read_text()
assert 'STUDIO DESKTOP INPUT' in core and 'Desktop input was not replayed' in core
assert hashlib.sha256((R/'core/config.js').read_bytes()).hexdigest()=='dd12795f341c420c901f0c2c5f7043a0edbdd8c1a72860e94702e5f9302c6448'
assert 'test_studio_desktop.ps1' in (R/'Build-Windows.ps1').read_text()
assert "'.ps1'" in (R/'tools/stamp_build.py').read_text()
print('PASS Studio desktop native route, polling catalogue, non-replay/checkpoint boundaries, explicit permissions, fixed-script stdin separation, resource/build inclusion, plugin skill mirrors and unchanged config. No live Studio interaction.')
