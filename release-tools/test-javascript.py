import subprocess,glob,sys
skip={'test-v115.js','test-bridges.js','test-design-visual.js'}
failed=[]
for name in sorted(glob.glob('test-*.js')):
 if name in skip:continue
 result=subprocess.run(['node',name],capture_output=True,text=True,timeout=300 if name=='test-notion-startup-small-paste.js' else 120)
 print(name, 'PASS' if result.returncode==0 else 'FAIL',flush=True)
 if result.returncode:print(result.stdout,result.stderr);failed.append(name)
print('Regression summary:',len(failed),'failures',failed,flush=True)
sys.exit(1 if failed else 0)



