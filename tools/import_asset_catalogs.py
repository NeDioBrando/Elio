import json,re,pathlib,collections,hashlib,argparse
a=argparse.ArgumentParser(description='Merge public metadata without executing Luau or downloading asset binaries.');a.add_argument('--openvfx',type=pathlib.Path,required=True);a.add_argument('--forum-text',type=pathlib.Path,required=True);args=a.parse_args()
R=pathlib.Path(__file__).resolve().parents[1]; out=R/'core/asset-library';out.mkdir(exist_ok=True)
p=args.openvfx.read_text(encoding='utf-8');d=json.loads(p[p.index('[[')+2:p.rindex(']]')]); rows={}
sources={'openvfx':{'url':'https://github.com/Bloodhundur/OpenVFX','data_url':'https://raw.githubusercontent.com/Bloodhundur/OpenVFX/main/plugin_folder/VFXJSON.luau','sha256':hashlib.sha256(p.encode()).hexdigest(),'terms':'README permits using/adding/modifying library. No formal asset license supplied; underlying asset rights/access not verified.'},'forum':{'url':'https://www.robloxforum.com/threads/110388/','author':'Porky8211','terms':'Public named ID reference. No asset license grant. Mesh/type/name mappings are community-reported, not independently verified.'}}
def add(kind,aid,name,cat,source,**meta):
 if not re.fullmatch(r'[1-9][0-9]{0,17}',str(aid)):raise ValueError(aid)
 key=kind+':'+str(aid); row=rows.setdefault(key,{'key':key,'kind':kind,'asset_id':str(aid),'uri':'rbxassetid://'+str(aid),'names':[],'categories':[],'sources':[],'variants':[],'availability':'not_checked','rights':'check_asset_permissions'})
 for f,v in [('names',name.strip()[:200]),('categories',cat),('sources',source)]:
  if v not in row[f]:row[f].append(v)
 if meta and meta not in row['variants']:row['variants'].append(meta)
for cat,vs in d['Textures'].items():
 for name,v in vs.items():add('texture',v['Texture'].split('://')[-1],name,cat.lower(),'openvfx',layout=('Static' if v.get('Type','Static').lower()=='static' else v.get('Type','Static')),resolution=v.get('Resolution',''),credits=v.get('Credits','?'),usage='particle')
for name,v in d['Beams'].items():add('texture',v['Texture'].split('://')[-1],name,'beam','openvfx',layout=('Static' if v.get('Type','Static').lower()=='static' else v.get('Type','Static')),resolution=v.get('Resolution',''),credits=v.get('Credits','?'),usage='beam_trail')
for artist,vs in d['Artists'].items():
 for name,v in vs.items():add('texture',v['Texture'].split('://')[-1],name,'artist','openvfx',layout=('Static' if v.get('Type','Static').lower()=='static' else v.get('Type','Static')),resolution=v.get('Resolution',''),credits=v.get('Credits',artist),usage='particle')
text=args.forum_text.read_text(encoding='utf-8'); pairs=collections.defaultdict(lambda:{'mesh':[],'texture':[]})
for line in text.splitlines():
 m=re.match(r'^(.*?)\s*(Mesh|Texture)\s*ID\d*(?:\s*\([^)]*\))?\s*:\s*(\d+)',line,re.I)
 if not m:continue
 name,kind,aid=m.groups();kind=kind.lower();add(kind,aid,name,'reference_props','forum',usage='mesh_surface' if kind=='texture' else 'mesh',mapping='community_reported');pairs[name.lower()][kind].append(aid)
for v in pairs.values():
 for aid in v['mesh']:
  rows['mesh:'+aid]['paired_texture_keys']=['texture:'+x for x in dict.fromkeys(v['texture'])]
# Do not silently reinterpret secondary parenthesized IDs, model IDs or ambiguous community labels.
data={'schema':1,'sources':sources,'counts':dict(collections.Counter(r['kind'] for r in rows.values())),'entries':sorted(rows.values(),key=lambda r:r['key'])}
if (out/'supplement.json').exists():
 from merge_asset_library import merge
 data=merge(data,json.loads((out/'supplement.json').read_text(encoding='utf-8')))
(out/'catalog.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print('Merged:',data['counts'],'total',len(data['entries']),'bytes',(out/'catalog.json').stat().st_size)
