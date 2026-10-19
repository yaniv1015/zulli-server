"""Split a full price summary into the app's files:
   prices.json         national chains (prices, deals), every chain's branches, and a list of the chain files
   chains/<id>.json    one neighborhood chain: {p, d?, dc?} for products in prices.json, the full product otherwise
usage: split.py summary.json [extra_summary.json ...] outdir"""
import json, sys, os
CORE = {'shufersal', 'rami', 'yochananof', 'carrefour', 'osherad', 'victory'}
*srcs, out = sys.argv[1:]
full = {'updated': None, 'products': {}, 'stores': {}}
for f in srcs:                       # merge several summaries (e.g. a run per group of chains)
    s = json.load(open(f))
    full['updated'] = max(filter(None, [full['updated'], s.get('updated')]))
    for bc, p in s['products'].items():
        q = full['products'].get(bc)
        if not q: full['products'][bc] = p; continue
        q['p'].update(p.get('p', {}))
        for k in ('d', 'dc'):
            if p.get(k): q.setdefault(k, {}).update(p[k])
        if len(p.get('n') or '') > len(q.get('n') or ''): q['n'] = p['n']
        for k in ('m', 'u', 'q', 'w'):
            if p.get(k) and not q.get(k): q[k] = p[k]
    full['stores'].update(s.get('stores', {}))
core = {'updated': full['updated'], 'products': {}, 'stores': full['stores'], 'chainFiles': {}}
local = {}
for bc, p in full['products'].items():
    cp = {c: v for c, v in p['p'].items() if c in CORE}
    if cp:
        e = {k: v for k, v in p.items() if k not in ('p', 'd', 'dc')}; e['p'] = cp
        for k in ('d', 'dc'):
            sub = {c: v for c, v in (p.get(k) or {}).items() if c in CORE}
            if sub: e[k] = sub
        core['products'][bc] = e
    for c, v in p['p'].items():
        if c in CORE: continue
        e = {'p': v}
        if (p.get('d') or {}).get(c): e['d'] = p['d'][c]
        if (p.get('dc') or {}).get(c): e['dc'] = p['dc'][c]
        if not cp:                                   # the app does not know this product yet: send it whole
            e.update({k: v2 for k, v2 in p.items() if k in ('n', 'q', 'u', 'w', 'm')})
        local.setdefault(c, {})[bc] = e
os.makedirs(os.path.join(out, 'chains'), exist_ok=True)
for c, prods in local.items():
    path = f'chains/{c}.json'
    with open(os.path.join(out, path), 'w') as f: json.dump({'chain': c, 'updated': full['updated'], 'products': prods}, f, ensure_ascii=False, separators=(',', ':'))
    core['chainFiles'][c] = {'file': path, 'products': len(prods), 'kb': os.path.getsize(os.path.join(out, path)) // 1024}
with open(os.path.join(out, 'prices.json'), 'w') as f: json.dump(core, f, ensure_ascii=False, separators=(',', ':'))
print('prices.json', os.path.getsize(os.path.join(out, 'prices.json')) // 1024, 'KB ·', len(core['products']), 'products')
for c, m in sorted(core['chainFiles'].items(), key=lambda x: -x[1]['kb']): print(f'  {c}: {m["products"]} products, {m["kb"]} KB')
