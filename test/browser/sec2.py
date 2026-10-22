import asyncio,pathlib
from playwright.async_api import async_playwright
html=pathlib.Path('../zul-li.html').read_text();root=pathlib.Path('..')
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await b.new_page(viewport={'width':390,'height':844});errs=[];pg.on('pageerror',lambda e:errs.append(str(e)[:200]))
    async def serve(r):
      u=r.request.url
      if 'fonts' in u:return await r.abort()
      if u=='https://zulli.test/':return await r.fulfill(body='<!doctype html><meta charset="utf-8"><body>'+html+'</body>',content_type='text/html; charset=utf-8')
      f=root/u.replace('https://zulli.test/','')
      if f.is_file():return await r.fulfill(body=f.read_bytes(),content_type='application/json')
      return await r.fulfill(status=404,body='')
    await pg.add_init_script("localStorage.setItem('mozilSeen','1')");await pg.route('**/*',serve)
    await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(2000)
    X='"><img src=x onerror="window.__pwn=1">'
    # a malicious shared list arriving from another phone
    await pg.evaluate("""X=>{let cb;FAM.db={doc:()=>({onSnapshot:(f)=>{cb=f;return()=>{}},set:async()=>{},get:async()=>({exists:false})})};state.fam={code:'ABCD12'};famListen('ABCD12');
      cb({exists:true,data:()=>({rev:'r1',by:'other',byName:X,items:[{k:X,t:'milk',q:'2',bh:X,sz:X},{k:'ok1',t:'constructor',q:1},{k:'ok2',t:'__proto__',q:1},{k:'ok3',t:'bamba',q:1e9,v:'nope'},{t:'eggs',q:-5,evil:X}],feed:[{txt:X,ts:1}],members:[{id:'z',name:X}]})})}""",X)
    await pg.wait_for_timeout(800)
    items=await pg.evaluate("state.items")
    print('items:',items)
    print('pwned:',await pg.evaluate("window.__pwn||0"),'injected imgs:',await pg.evaluate("document.querySelectorAll('img[src=\"x\"]').length"))
    await pg.click('[data-tab="mine"]');await pg.wait_for_timeout(300);print('after family tab pwned:',await pg.evaluate("window.__pwn||0"))
    print('errors',errs);await b.close()
asyncio.run(main())
