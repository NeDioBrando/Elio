import base64,gzip,hashlib,json,os,pathlib,subprocess
root=pathlib.Path('.elio-source-transfer')
m=json.loads((root/'manifest.json').read_text())
branch='feat/manual-vault-liquid-glass'
def run(*a): subprocess.run(a,check=True)
def out(*a): return subprocess.check_output(a).decode().strip()
assert out('git','rev-parse','HEAD^')==m['baseline'], 'Unexpected baseline'
assert out('git','rev-parse','HEAD')==os.environ['GITHUB_SHA'], 'Unexpected checkout'
run('git','fetch','origin',branch)
assert out('git','rev-parse','FETCH_HEAD')==os.environ['GITHUB_SHA'], 'Branch advanced; aborting'
p=gzip.decompress(base64.b64decode((root/'patch.b64').read_text()))
assert len(p)<1000000 and hashlib.sha256(p).hexdigest()==m['patch_sha256']
f=pathlib.Path(os.environ['RUNNER_TEMP'])/'elio-source.patch'; f.write_bytes(p)
run('git','apply','--check',str(f)); run('git','apply',str(f))
run('python3','tools/generate_locale_catalog.py')
for name,digest in m['files'].items():
 assert hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()==digest, 'Hash mismatch: '+name
for name in ['core/vault-ui.js','elio-Extension/core/vault-ui.js','test-vault-selection-live.cjs','test-vault-selection-ui.cjs']:
 run('node','--check',name)
run('git','add','--',*m['files'])
run('git','rm','-r','.elio-source-transfer')
run('git','diff','--cached','--check')
run('git','config','user.name','github-actions[bot]')
run('git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com')
run('git','commit','-m','feat: pin AI vault per chat and redesign Liquid Glass-inspired UI')
run('git','push','origin','HEAD:refs/heads/'+branch)
print('Verified and committed all',len(m['files']),'source files')
