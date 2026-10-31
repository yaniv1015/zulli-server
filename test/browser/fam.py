"""Family list security: lists live at fam/<code>/l/main (codes cannot be listed), the old families/ collection is
closed to everyone but the owner, an owner's old list is copied to the new place, and short codes are refused.
The page gets a stand-in for the platform's database that applies the same rules the artifact declares."""
import asyncio,json,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
MOCK=r"""
(()=>{const role=%s;const store=window.__store=%s;
const canRead=p=>!p.startsWith('families/')||role==='owner';
const deny=()=>Promise.reject(Object.assign(new Error('denied'),{code:'invalid_argument'}));
const subs=[];const fire=p=>subs.filter(s=>s.p===p).forEach(s=>s.cb(snap(p)));
const snap=p=>({exists:p in store,data:()=>JSON.parse(JSON.stringify(store[p]))});
const doc=p=>({get:()=>canRead(p)?Promise.resolve(p in store?snap(p):{exists:false,data:()=>null}):deny(),
  set:d=>canRead(p)?(store[p]=JSON.parse(JSON.stringify(d)),fire(p),Promise.resolve()):deny(),
  update:d=>canRead(p)&&p in store?(Object.assign(store[p],JSON.parse(JSON.stringify(d))),fire(p),Promise.resolve()):deny(),
  onSnapshot:(cb,err)=>{if(!canRead(p)){err&&err({code:'invalid_argument'});return()=>{}}const s={p,cb};subs.push(s);setTimeout(()=>cb(p in store?snap(p):{exists:false,data:()=>null}),0);return()=>subs.splice(subs.indexOf(s),1)}});
const coll=()=>{const q={where:()=>q,orderBy:()=>q,limit:()=>q,doc:id=>doc('x/'+id),get:()=>Promise.resolve({docs:[]}),onSnapshot:cb=>{setTimeout(()=>cb({docs:[]}),0);return()=>{}}};return q};
const db={doc,collection:coll};const user={id:async()=>'u_me',email:async()=>null,isOwner:async()=>role==='owner'};
window.claude={use:async n=>n==='db'?db:n==='user'?user:null};})();
"""
async def run(role,store):
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await b.new_page(viewport={'width':390,'height':844});errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    async def serve(r):
      u=r.request.url
      if u=='https://zulli.test/':return await r.fulfill(body='<!doctype html><meta charset="utf-8"><body>'+qa.html+'</body>',content_type='text/html; charset=utf-8')
      f=qa.root/u.split('?')[0].replace('https://zulli.test/','')
      if u.startswith('https://zulli.test/') and f.is_file():return await r.fulfill(body=f.read_bytes(),content_type='application/json')
      return await r.fulfill(status=404,body='')
    await pg.route('**/*',serve);await pg.add_init_script(MOCK%(json.dumps(role),json.dumps(store)))
    await pg.goto('https://zulli.test/');await pg.wait_for_function('typeof FAM!=="undefined"&&FAM.ready&&FAM.db',timeout=60000)
    out={}
    out['short']=await pg.evaluate("famJoin('AB12',false)")
    out['joinOld']=await pg.evaluate("famJoin('OLD234',false)")
    out['create']=await pg.evaluate("famLeave(),famJoin('NEW234',true)")
    await pg.wait_for_timeout(300)
    out['keys']=sorted(await pg.evaluate("Object.keys(window.__store)"))
    out['errs']=errs;await b.close();return out
async def main():
  old={'families/OLD234':{'items':[],'rev':'r1','by':'u_x','byName':'','ts':1,'feed':[],'members':[{'id':'u_x','name':'אבא','ts':1}]}}
  fails=0
  o=await run('owner',dict(old));print('owner',o)
  for name,ok in [('short code refused',o['short'] is False),('old list opens',o['joinOld'] is True),('old list copied',"fam/OLD234/l/main" in o['keys']),
                  ('new list created at new path',o['create'] is True and 'fam/NEW234/l/main' in o['keys']),('nothing new in families/',[k for k in o['keys'] if k.startswith('families/')]==['families/OLD234']),('no page errors',not o['errs'])]:
    print(('ok  ' if ok else 'FAIL'),name);fails+=not ok
  o=await run('interact',dict(old));print('member',o)
  for name,ok in [('old families/ closed to others',o['joinOld'] is False),('member can create at new path',o['create'] is True and 'fam/NEW234/l/main' in o['keys']),('no page errors',not o['errs'])]:
    print(('ok  ' if ok else 'FAIL'),name);fails+=not ok
  print(f'FAILS {fails} ')
asyncio.run(main())
