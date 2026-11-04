"""Deterministic metadata-only merge. No network, scripts or asset execution."""
import json,re,copy,collections,pathlib

def merge(base,supplement):
    assert base['schema']==supplement['schema']==1
    data=copy.deepcopy(base);rows={r['key']:r for r in data['entries']};data['sources'].update(copy.deepcopy(supplement['sources']))
    for item in supplement['entries']:
        assert re.fullmatch(r'(mesh|texture):[1-9][0-9]{0,17}',item['key']) and item['key']==item['kind']+':'+item['asset_id'] and item['uri']=='rbxassetid://'+item['asset_id']
        assert item['names'] and all(s in data['sources'] for s in item['sources'])
        if item['key'] not in rows:rows[item['key']]=copy.deepcopy(item);continue
        row=rows[item['key']]
        for field in ['names','categories','sources','variants','paired_texture_keys']:
            for value in item.get(field,[]):
                if value not in row.setdefault(field,[]):row[field].append(copy.deepcopy(value))
    for r in rows.values():
        for k in r.get('paired_texture_keys',[]):assert k in rows and rows[k]['kind']=='texture'
    data['entries']=sorted(rows.values(),key=lambda r:r['key']);data['counts']=dict(collections.Counter(r['kind'] for r in rows.values()));return data

if __name__=='__main__':
    root=pathlib.Path(__file__).resolve().parents[1];folder=root/'core/asset-library'
    data=merge(json.loads((folder/'catalog.json').read_text(encoding='utf-8')),json.loads((folder/'supplement.json').read_text(encoding='utf-8')))
    for prefix in ['', 'elio-Extension/']:
        (root/prefix/'core/asset-library/catalog.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(data['counts'],'total',len(data['entries']))
