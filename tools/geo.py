"""Street and branch locations, so the app can find the branch nearest to a shopper's address.

Inputs (downloaded by .github/workflows/geo.yml):
  israel.osm.pbf   OpenStreetMap extract (Geofabrik), © OpenStreetMap contributors, ODbL
  summary.json     the latest price summary (its branch list: chain -> [{id, name, city, address}])
Also fetches the official settlement codes and names (data.gov.il, Population Authority street list).

Outputs:
  data/geo/NN.json      NN = hash bucket of the settlement: { cityKey: { c: [lat, lon], s: { streetKey: [lat, lon] } } }
                        (street = the middle of its named OSM ways inside the settlement)
  data/storegeo.json    { chain: { storeId: [lat, lon, precision] } }  precision 2 = street, 1 = settlement only
  data/geo/report.json  counts
"""
import json, re, sys, os, math, urllib.request
from collections import defaultdict
import osmium
from shapely import wkb
from shapely.geometry import Point
from shapely.strtree import STRtree

PBF, SUMMARY, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
BUCKETS = 32

def bucket(s):  # same hash as the app (djb2 with xor, unsigned 32-bit)
    h = 5381
    for ch in s: h = ((h * 33) ^ ord(ch)) & 0xffffffff
    return h % BUCKETS

def ckey(x):  # same as the app's addrKey
    x = str(x or '').replace('קריית', 'קרית')
    return re.sub(r"[\s\-–'\"״׳()]", '', x)

PREFIX = re.compile(r"^(רחוב|רח['׳]?|שדרות|שד['׳]?|סמטת|סמ['׳]|כיכר|ככר|מעלה|משעול)\s+")
def skey(x):
    x = re.sub(r'\s+', ' ', str(x or '')).strip()
    x = PREFIX.sub('', x)
    return ckey(x)

# ---- official settlements: code -> name
RES = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b'
code_name, official = {}, {}
off = 0
while True:
    url = f'https://data.gov.il/api/3/action/datastore_search?resource_id={RES}&limit=32000&offset={off}'
    req = urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0 (zulli-server)', 'accept': 'application/json'})
    j = json.load(urllib.request.urlopen(req, timeout=120))
    recs = j['result']['records']
    for r in recs:
        name = re.sub(r'\s+', ' ', str(r.get('שם_ישוב') or '')).strip()
        if not name: continue
        code_name[int(r.get('סמל_ישוב') or 0)] = name
        official.setdefault(ckey(name), name)
    off += len(recs)
    if not recs or off >= j['result']['total']: break
print('settlements', len(official), file=sys.stderr)

# ---- OSM: settlement areas, settlement points, named streets
wkbf = osmium.geom.WKBFactory()
areas, places, ways = [], [], []

def heb(tags):
    return tags.get('name:he') or tags.get('name')

class H(osmium.SimpleHandler):
    def area(self, a):
        t = a.tags
        if t.get('boundary') == 'administrative' and t.get('admin_level') in ('8', '9') or t.get('place') in ('city', 'town', 'village', 'hamlet', 'isolated_dwelling') or (t.get('landuse') == 'residential' and t.get('name')):
            n = heb(t)
            if not n or ckey(n) not in official: return
            try: g = wkb.loads(wkbf.create_multipolygon(a), hex=True)
            except Exception: return
            areas.append((ckey(n), g, t.get('boundary') == 'administrative'))
    def node(self, n):
        p = n.tags.get('place')
        if p in ('city', 'town', 'village', 'hamlet', 'isolated_dwelling', 'neighbourhood'):
            name = heb(n.tags)
            if name and ckey(name) in official: places.append((ckey(name), n.location.lat, n.location.lon))
    def way(self, w):
        if 'highway' not in w.tags: return
        name = heb(w.tags)
        if not name: return
        pts = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        if pts: ways.append((skey(name), pts))

H().apply_file(PBF, locations=True)
print('areas', len(areas), 'places', len(places), 'named ways', len(ways), file=sys.stderr)

# administrative areas first; smaller areas (villages inside a regional council) win
areas.sort(key=lambda x: x[1].area)
tree = STRtree([g for _, g, _ in areas])
def city_of(lat, lon):
    p = Point(lon, lat)
    hits = [i for i in tree.query(p) if areas[i][1].contains(p)]
    if hits:
        return areas[min(hits, key=lambda i: areas[i][1].area)][0]
    best, bd = None, 0.03 ** 2  # about 3 km: nearest settlement point
    for k, la, lo in places_near(lat, lon):
        d = (la - lat) ** 2 + ((lo - lon) * 0.85) ** 2
        if d < bd: best, bd = k, d
    return best

grid = defaultdict(list)
for k, la, lo in places: grid[(round(la, 1), round(lo, 1))].append((k, la, lo))
def places_near(lat, lon):
    for dl in (-0.1, 0, 0.1):
        for dn in (-0.1, 0, 0.1):
            yield from grid.get((round(lat + dl, 1), round(lon + dn, 1)), [])

acc = defaultdict(lambda: [0.0, 0.0, 0])     # (city, street) -> sums
for sk, pts in ways:
    la = sum(p[0] for p in pts) / len(pts); lo = sum(p[1] for p in pts) / len(pts)
    c = city_of(la, lo)
    if not c: continue
    a = acc[(c, sk)]; a[0] += la * len(pts); a[1] += lo * len(pts); a[2] += len(pts)

geo = defaultdict(lambda: {'s': {}})
for (c, sk), (sla, slo, n) in acc.items():
    geo[c]['s'][sk] = [round(sla / n, 5), round(slo / n, 5)]
pt = {k: (la, lo) for k, la, lo in places}
for c, g in geo.items():
    if c in pt: g['c'] = [round(pt[c][0], 5), round(pt[c][1], 5)]
    else:
        v = list(g['s'].values()); g['c'] = [round(sum(x[0] for x in v) / len(v), 5), round(sum(x[1] for x in v) / len(v), 5)]
for k, (la, lo) in pt.items():
    if k not in geo: geo[k] = {'c': [round(la, 5), round(lo, 5)], 's': {}}

os.makedirs(os.path.join(OUT, 'geo'), exist_ok=True)
bk = defaultdict(dict)
for c, g in geo.items(): bk[bucket(c)][c] = g
for i in range(BUCKETS):
    with open(os.path.join(OUT, 'geo', f'{i:02d}.json'), 'w') as f: json.dump(bk.get(i, {}), f, ensure_ascii=False, separators=(',', ':'))

# ---- branches
names_by_len = sorted(official, key=len, reverse=True)
def store_city(s):
    raw = str(s.get('city') or '').strip()
    if raw.isdigit() and int(raw) in code_name and ckey(code_name[int(raw)]) in geo: return ckey(code_name[int(raw)])
    if raw and not raw.isdigit() and ckey(raw) in geo: return ckey(raw)
    for txt in (s.get('name') or '', s.get('address') or '', raw):
        t = ckey(txt)
        for k in names_by_len:
            if len(k) >= 3 and k in t and k in geo: return k
    return None

def street_in(city, address):
    a = ckey(PREFIX.sub('', re.sub(r'[\d,./]+', ' ', str(address or '')).strip()))
    if len(a) < 2: return None
    st = geo.get(city, {}).get('s', {})
    if a in st: return st[a]
    best = None
    for k, v in st.items():
        if len(k) >= 3 and (k in a or a in k) and (not best or len(k) > best[0]): best = (len(k), v)
    return best[1] if best else None

summary = json.load(open(SUMMARY))
out, rep = {}, {'stores': 0, 'street': 0, 'city': 0, 'none': 0}
for chain, lst in (summary.get('stores') or {}).items():
    for s in lst:
        rep['stores'] += 1
        c = store_city(s)
        if not c or 'c' not in geo.get(c, {}): rep['none'] += 1; continue
        sid = str(s.get('id', '')).lstrip('0') or '0'
        p = street_in(c, s.get('address')) or street_in(c, s.get('name'))
        if p: out.setdefault(chain, {})[sid] = [p[0], p[1], 2]; rep['street'] += 1
        else: out.setdefault(chain, {})[sid] = [geo[c]['c'][0], geo[c]['c'][1], 1]; rep['city'] += 1
with open(os.path.join(OUT, 'storegeo.json'), 'w') as f: json.dump(out, f, separators=(',', ':'))
rep.update(cities=len(geo), streets=sum(len(g['s']) for g in geo.values()))
with open(os.path.join(OUT, 'geo', 'report.json'), 'w') as f: json.dump(rep, f)
print(json.dumps(rep), file=sys.stderr)
