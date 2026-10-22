import asyncio,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await b.new_page(viewport={'width':390,'height':844});errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.add_init_script("""localStorage.setItem('mozilSeen','1');window.__N=[];window.Capacitor={Plugins:{LocalNotifications:{checkPermissions:async()=>({display:'granted'}),requestPermissions:async()=>({display:'granted'}),schedule:async o=>{window.__N.push(...o.notifications)}}}}""")
    async def serve(r):
      u=r.request.url
      if u=='https://zulli.test/':return await r.fulfill(body='<!doctype html><meta charset="utf-8"><body>'+qa.html+'</body>',content_type='text/html; charset=utf-8')
      f=qa.root/u.split('?')[0].replace('https://zulli.test/','')
      if u.startswith('https://zulli.test/') and f.is_file():return await r.fulfill(body=f.read_bytes(),content_type='application/json')
      return await r.fulfill(status=404,body='')
    await pg.route('**/*',serve);await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(4000)
    # put some usual products in the list and turn on
    await pg.evaluate("(()=>{const rows=dealRows(followed().map(c=>c.id),30).slice(0,5);rows.forEach(r=>state.items.push({k:nid(),t:r.v.t,v:r.v.id,q:1}));update()})()")
    await pg.click('[data-tab="mine"]');await pg.wait_for_timeout(800)
    print('toggle',await pg.locator('#pushOn').count())
    await pg.locator('#pushOn').check();await pg.wait_for_timeout(2500)
    n=await pg.evaluate("window.__N.map(n=>n.title+' | '+n.body.slice(0,80)+(n.schedule?' @'+new Date(n.schedule.at).toISOString():''))")
    print(len(n));print('\n'.join(n[:8]))
    print('errors',errs);await b.close()
asyncio.run(main())
