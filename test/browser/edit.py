import asyncio,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await qa.mkpage(b)
    await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(4000);await qa.close(pg)
    await qa.paste(pg,'שוקולד נוטלה\nחלב')
    await pg.evaluate("refineQueue()");await pg.wait_for_timeout(600)
    print(await pg.inner_text('.rfhead'))
    await pg.click('#rfEdit');await pg.fill('#rfName','ממרח נוטלה');await pg.wait_for_timeout(600)
    print('found',await pg.evaluate("[...document.querySelectorAll('#rfFound .rfpic b')].map(x=>x.innerText).slice(0,4)"))
    await pg.screenshot(path='../ED1.png')
    await pg.click('#rfNameGo');await pg.wait_for_timeout(500)
    print('after',await pg.inner_text('.rfhead'),'|',await pg.evaluate("state.items.map(i=>i.t+':'+i.hint)"))
    await pg.click('#rfEdit');await pg.fill('#rfName','נוטלה 750');await pg.wait_for_timeout(600)
    await pg.locator('#rfFound .rfpic').first.click();await pg.wait_for_timeout(500)
    print('picked',await pg.evaluate("state.items.map(i=>i.t+':'+(i.v?vLabel(VB[i.v]):i.hint))"),'now',await pg.inner_text('.rfhead'))
    print('errs',pg.errs);await b.close()
asyncio.run(main())
