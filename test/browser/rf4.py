import asyncio,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await qa.mkpage(b)
    await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(4000);await qa.close(pg)
    await qa.paste(pg,'חלב שיבולת שועל\nמעדן הגולן בטעם שוקולד\nגבינה צהובה עמק של תנובה\nחבילה נייר טואלט')
    await pg.evaluate("refineQueue()");await pg.wait_for_timeout(600)
    for step in range(30):
      if not await pg.locator('.sheet').count():break
      h=await pg.evaluate("[document.querySelector('.sheet h3')?.innerText, document.querySelector('.rfhead,.sheet .rfit')?.innerText]")
      pics=await pg.evaluate("[...document.querySelectorAll('.rfpic b')].slice(0,5).map(x=>x.innerText)")
      if pics:
        print('GRID',h,pics);await pg.locator('.rfpic').first.click()
      else:
        opts=await pg.evaluate("[...document.querySelectorAll('.sheet .rfopt, .sheet .rfgrid button')].map(x=>x.innerText.replace(/\\n/g,' '))")
        print('Q',h,opts[:6])
        any_=pg.locator('.sheet .rfopt.any, .sheet button:has-text(\"לא משנה לי\")').first
        if await any_.count():await any_.click()
        else:await pg.locator('.sheet .rfgrid button').first.click()
      await pg.wait_for_timeout(400)
    print(await pg.evaluate("state.items.map(i=>i.hint+' => '+(i.v?vLabel(VB[i.v]):'-'))"))
    print('errs',pg.errs);await b.close()
asyncio.run(main())
