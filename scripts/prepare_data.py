"""Pinned CC BY 4.0 / KOGL Type 1 source; outputs an offline SVG-path dataset.
Run: python scripts/prepare_data.py (pyarrow, shapely required).
No runtime fetch of third-party map data is needed.
"""
import json, sys, urllib.request, hashlib
sys.stdout.reconfigure(encoding='utf-8')
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import pyarrow.parquet as pq
from shapely import from_wkb, union_all, make_valid
from shapely.ops import transform

COMMIT = 'd5d5a821c8de6cc337d47eeca604d7af76271c9b'
BASE = f'https://raw.githubusercontent.com/vuski/admdongkor/{COMMIT}/'
cache = ROOT / '.tools/data'
cache.mkdir(parents=True, exist_ok=True)
hashes = {}
for level in ['sido','sgg']:
    name = f'{level}_20261001_light.parquet'
    path = cache / name
    if not path.exists(): urllib.request.urlretrieve(BASE+'parquet/simplified/'+name, path)
    hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()

def rows(level):
    table = pq.read_table(cache / f'{level}_20261001_light.parquet')
    print(level, table.schema.names)
    result = table.to_pylist()
    print('sample properties', {k:v for k,v in result[0].items() if k != 'geometry'})
    return result

if '--inspect' in sys.argv:
    rows('sido'); rows('sgg'); sys.exit()

def project(x,y,z=None): return ((x-124.4)*100*0.79, (38.8-y)*100)
def geometry(row): return make_valid(from_wkb(row['geometry']))
def coords(g):
    if g.geom_type == 'Polygon': return [g]
    if hasattr(g,'geoms'): return [p for c in g.geoms for p in coords(c)]
    return []
def svg_path(g):
    projected = transform(project, g)
    path = []
    for poly in coords(projected):
        for ring in [poly.exterior, *poly.interiors]:
            points = list(ring.coords)
            if len(points)<4: continue
            path.append('M'+'L'.join(f'{x:.2f},{y:.2f}' for x,y in points)+'Z')
    return ''.join(path)
def visual(g):
    p = transform(project,g)
    largest = max(coords(p), key=lambda q:q.area)
    a = largest.representative_point()
    return {'path':svg_path(g),'bounds':[round(v,2) for v in p.bounds], 'labelPoint':[round(a.x,2),round(a.y,2)]}

province_rows, district_rows = rows('sido'), rows('sgg')
provinces = []
for row in province_rows:
    # The source schema is checked by --inspect before authoring the conversion.
    code, name = str(row['sidocd']), row['sidonm']
    g = geometry(row)
    destinations = []
    groups = {}
    for d in district_rows:
        if str(d['sidocd']) != code: continue
        local = d['sggnm']
        # General districts are merged into one travel city, not extra chances.
        city = local.split('시')[0]+'시' if '시' in local and local.endswith('구') else local
        groups.setdefault(city, []).append(d)
    if name == '세종특별자치시':
        destinations = [{'id':code, 'name':name, 'provinceId':code, **visual(g)}]
    else:
        for city, ds in groups.items():
            dest_geometry = union_all([geometry(d) for d in ds])
            dest_code = str(ds[0]['sggcd']) if len(ds)==1 else code+'-city-'+city
            destinations.append({'id':dest_code,'name':city,'provinceId':code,**visual(dest_geometry)})
    short = name.replace('특별자치도','').replace('특별자치시','').replace('특별시','').replace('광역시','').replace('통합','')
    provinces.append({'id':code,'name':name,'shortName':short,'singleStage':name=='세종특별자치시',**visual(g),'destinations':sorted(destinations,key=lambda d:d['name'])})
provinces.sort(key=lambda p:p['id'])
data = {'version':'2026-10-01','sourceCommit':COMMIT,'coordinateSystem':'WGS84 → equirectangular SVG, longitude scale cos(37.8°) ≈ 0.79','viewBox':[0,0,640,650], 'source':'통계청 SGIS / vuski·VW LAB admdongkor', 'sourceUrl':'https://github.com/vuski/admdongkor','license':'CC BY 4.0 + 공공누리 제1유형(출처표시)', 'inputSha256':hashes,'provinces':provinces}
out = ROOT / 'public/data/regions.json'
out.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':')),encoding='utf-8')
for name in ['LICENSE-DATA']:
    urllib.request.urlretrieve(BASE+name, ROOT/'public/data'/name)
print('Saved',out.stat().st_size,'bytes;',len(provinces),'provinces;',sum(len(p['destinations']) for p in provinces),'destinations')
