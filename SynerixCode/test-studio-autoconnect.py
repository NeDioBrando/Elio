"""Native startup/reconnection without a browser or process-name detection.

Uses a local MCP protocol fixture, not Roblox Studio; no live Studio claim.
"""
from pathlib import Path
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request

root=Path(__file__).resolve().parent
binary=Path(os.environ.get('SYNERIXCODE_TEST_AGENT',str(root/'agent/target/debug'/('synerixcode.exe' if os.name=='nt' else 'synerixcode'))))
with tempfile.TemporaryDirectory(prefix='synerixcode-autoconnect-') as temporary:
    work=Path(temporary); install=work/'install'; install.mkdir()
    app=install/binary.name;shutil.copy2(binary,app)
    config=work/'config';config.mkdir();available=work/'available';available.write_text('no')
    helper=work/'mcp.py'
    helper.write_text('''import sys,json
from pathlib import Path
available=Path(sys.argv[1])
for line in sys.stdin:
 r=json.loads(line)
 if 'id' not in r:continue
 method=r['method']
 if method=='initialize':out={'protocolVersion':'2025-06-18','capabilities':{'tools':{}},'serverInfo':{'name':'fixture','version':'1'}}
 elif method=='tools/list':out={'tools':[{'name':'get_studio_state','inputSchema':{'type':'object','properties':{}}}]}
 else:out={'isError':available.read_text()!='yes','content':[{'type':'text','text':'Studio ready' if available.read_text()=='yes' else 'Roblox Studio is not connected'}]}
 print(json.dumps({'jsonrpc':'2.0','id':r['id'],'result':out}),flush=True)
''')
    env={**os.environ,'LOCALAPPDATA':str(config),'XDG_CONFIG_HOME':str(config),'SYNERIXCODE_WORKSPACE_ROOT':str(work/'workspace'),'SYNERIXCODE_MCP_COMMAND':f'{sys.executable} {helper} {available}'}
    # Use a separate HTTP port; legacy ports still require stopping our dev agent.
    with (work/'stdout.log').open('w') as log:
        process=subprocess.Popen([str(app),'--headless','--roblox-addr','127.0.0.1:3014'],env=env,stdout=log,stderr=log)
        try:
            def state():
                key=(config/'synerixcode/bridge-key').read_text()
                req=urllib.request.Request('http://127.0.0.1:3014/api/desktop/state',headers={'Authorization':'Bearer '+key})
                with urllib.request.urlopen(req,timeout=2) as response:return json.load(response)
            def wait_for(connected,limit):
                until=time.monotonic()+limit
                while time.monotonic()<until:
                    if process.poll() is not None:raise AssertionError('Agent exited: '+(work/'stdout.log').read_text())
                    try:
                        current=state()
                        if current['roblox_connected']==connected:return current
                    except OSError:pass
                    time.sleep(.2)
                raise AssertionError(f'Native auto-connect did not reach connected={connected}; no browser or named Studio process should be required')
            wait_for(False,8)
            available.write_text('yes')
            wait_for(True,12)
            available.write_text('no')
            wait_for(False,22)
            available.write_text('yes')
            wait_for(True,12)
            print('PASS native MCP fixture: bridge ready before Studio; connects when Studio opens, detects closure, reconnects later without browser or process-name detection.')
        finally:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
