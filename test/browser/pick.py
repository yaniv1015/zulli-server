import asyncio,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await qa.mkpage(b)
    await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(4000);await qa.close(pg)
    await pg.evaluate("(()=>{addItems(parseLoose(`חלב 3%\\nלחם\\nביצים\\nקוטג'\\nגבינה צהובה\\nעגבניות\\nבננות\\nשמן\\nאורז\\nפסטה\\nקולה\\nבמבה\\nטונה\\nקפה\\nסוכר\\nנייר טואלט`).out,'t');save();go('basket')})()")
    await pg.wait_for_timeout(1200)
    await pg.locator('.cmpcard').scroll_into_view_if_needed();await pg.screenshot(path='../PK1.png')
    await pg.locator('[data-pickc]').nth(2).click();await pg.wait_for_timeout(600)
    await pg.locator('.cmpcard').scroll_into_view_if_needed();await pg.screenshot(path='../PK2.png')
    print(await pg.inner_text('#bestbar'),'|',await pg.get_attribute('#bestbar [data-checkout]','data-checkout'))
    print('errs',pg.errs);await b.close()
asyncio.run(main())
