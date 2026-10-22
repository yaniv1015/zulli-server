import asyncio,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await b.new_page(viewport={'width':390,'height':844},device_scale_factor=2);errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.add_init_script("localStorage.setItem('mozilSeen','1')")
    async def serve(r):
      u=r.request.url
      if u=='https://zulli.test/':return await r.fulfill(body='<!doctype html><meta charset="utf-8"><body>'+qa.html+'</body>',content_type='text/html; charset=utf-8')
      f=qa.root/u.split('?')[0].replace('https://zulli.test/','')
      if u.startswith('https://zulli.test/') and f.is_file():return await r.fulfill(body=f.read_bytes(),content_type='application/json')
      return await r.fulfill(status=404,body='')
    await pg.route('**/*',serve);await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(4500)
    await pg.evaluate("state.items=[];update();openPaste()");await pg.wait_for_timeout(400)
    await pg.fill('#paste','קולה זירו פחית - 6 יח׳\nבמבה נוגט\nשמנת חמוצה 15% - 2 יח׳\nחלב');await pg.click('#parseBtn');await pg.wait_for_timeout(900)
    print('items',await pg.evaluate("JSON.stringify(state.items.map(i=>[i.t,i.v,i.q,i.hint]))"))
    for k in range(8):
      h=await pg.evaluate("(()=>{const b=document.querySelector('.sheet');if(!b)return null;return [b.querySelector('.rfhead b')?.textContent,b.querySelector('h3')?.textContent,[...b.querySelectorAll('.rfopt b,.rfpic b')].map(x=>x.textContent.slice(0,26)).slice(0,6).join(' | ')]})()")
      print(k,h)
      if not h:break
      if b and h[1] and 'איזה מוצר' in h[1] and k<3: await pg.screenshot(path=f'../FL{k}.png')
      await pg.locator('.rfopt:not(.any), .rfpic').first.click();await pg.wait_for_timeout(500)
    await pg.wait_for_timeout(600);await pg.locator('.cmpcard').scroll_into_view_if_needed();await pg.screenshot(path='../FLc.png')
    print('rows with price',await pg.locator('.it3 .p').count(),'swaphints',await pg.locator('.it3 .swaphint').count(),'cmp',await pg.locator('.cmpcard li').count())
    print('errors',errs);await b.close()
asyncio.run(main())
