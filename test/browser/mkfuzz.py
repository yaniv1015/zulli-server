"""Builds a poisoned copy of the app data for sec.py: the chains' price files, branch files and deals are data the app does
not control, so one in every N names (products, brands, chains, branches, cities, deal texts) gets an HTML/script payload
appended. Photos are copied as they are. Usage: python3 mkfuzz.py <data dir> <out dir> [N]"""
import json,os,shutil,sys,zlib,re
src,out=sys.argv[1],sys.argv[2];N=int(sys.argv[3]) if len(sys.argv)>3 else 25
P='"><img src=x onerror="window.__pwn=(window.__pwn||[]).concat(\'data\')"><svg onload="window.__pwn=(window.__pwn||[]).concat(\'svg\')">'
HEB=re.compile('[֐-׿]')
n=[0]
def poison(x):
  if isinstance(x,str):
    if len(x)>=3 and HEB.search(x) and zlib.crc32(x.encode())%N==0:n[0]+=1;return x+P
    return x
  if isinstance(x,list):return [poison(v) for v in x]
  if isinstance(x,dict):return {k:poison(v) for k,v in x.items()}
  return x
shutil.rmtree(out,ignore_errors=True)
for d,_,fs in os.walk(src):
  rel=os.path.relpath(d,src);os.makedirs(os.path.join(out,rel),exist_ok=True)
  for f in fs:
    a,b=os.path.join(d,f),os.path.join(out,rel,f)
    if f.endswith('.json') and not rel.startswith('img'):
      try:j=json.load(open(a,encoding='utf-8'))
      except Exception:shutil.copy(a,b);continue
      json.dump(poison(j),open(b,'w',encoding='utf-8'),ensure_ascii=False)
    else:shutil.copy(a,b)
print('poisoned strings:',n[0])
