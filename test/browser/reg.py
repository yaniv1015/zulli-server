import asyncio,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await b.new_page(viewport={'width':390,'height':844},device_scale_factor=2);errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    async def serve(r):
      u=r.request.url
      if u=='https://zulli.test/':return await r.fulfill(body='<!doctype html><meta charset="utf-8"><body>'+qa.html+'</body>',content_type='text/html; charset=utf-8')
      f=qa.root/u.split('?')[0].replace('https://zulli.test/','')
      if u.startswith('https://zulli.test/') and f.is_file():return await r.fulfill(body=f.read_bytes(),content_type='application/json')
      return await r.fulfill(status=404,body='')
    await pg.route('**/*',serve);await pg.goto('https://zulli.test/');await pg.wait_for_timeout(6500)
    await pg.wait_for_selector('#tSkip',timeout=30000);await pg.click('#tSkip')  # first run: the welcome tour, then sign-up
    await pg.wait_for_selector('[data-sso]',timeout=30000)
    print('sheet',await pg.evaluate("document.querySelector('#sheetRoot h2')?.innerText"));print('sso',await pg.locator('[data-sso]').count())
    await pg.locator('.sheet .welcome').scroll_into_view_if_needed() if await pg.locator('.sheet .welcome').count() else None
    await pg.locator('[data-sso="google"]').click();await pg.wait_for_timeout(800);print('msg',await pg.locator('#ssoMsg').inner_text())
    await pg.locator('[data-sso]').first.scroll_into_view_if_needed();await pg.screenshot(path='../R1.png')
    await pg.locator('[data-sso="email"]').click();await pg.wait_for_timeout(600);print('focus',await pg.evaluate('document.activeElement.id'))
    print('errors',errs);await b.close()
asyncio.run(main())
