import asyncio,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await qa.mkpage(b)
    await pg.add_init_script("window.__said=[];Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speak:u=>{window.__said.push(u.text);setTimeout(()=>u.onend&&u.onend(),50)},cancel:()=>{},getVoices:()=>[{lang:'he-IL',name:'he'}]}});window.SpeechSynthesisUtterance=function(t){this.text=t}")
    await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(4000);await qa.close(pg)
    await pg.click('[data-tab="account"]');await pg.wait_for_timeout(600)
    await pg.click('#a11yCard .accbtn');await pg.wait_for_timeout(300);await pg.locator('#a11yCard').scroll_into_view_if_needed();await pg.screenshot(path='../A11.png')
    await pg.click('[data-a11yz="1.3"]');await pg.wait_for_timeout(500)
    print('zoom',await pg.evaluate("document.documentElement.style.zoom"))
    await pg.check('#a11yR');await pg.wait_for_timeout(400)
    await pg.click('[data-tab="basket"]');await pg.wait_for_timeout(800);await pg.screenshot(path='../A12.png')
    await pg.evaluate("window.__said=[]")
    await pg.locator('#screen label.f.big').first.click();await pg.wait_for_timeout(300)
    print('tap',await pg.evaluate("window.__said"))
    await pg.evaluate("state.a11y.zoom=1;applyA11y()");await pg.wait_for_timeout(300)
    bt=pg.locator('#screen button').filter(has_text='הדבק רשימה').first;await bt.scroll_into_view_if_needed();bb=await bt.bounding_box()
    await pg.mouse.move(bb['x']+bb['width']/2,bb['y']+bb['height']/2);await pg.mouse.down();await pg.wait_for_timeout(800);await pg.mouse.up();await pg.wait_for_timeout(300)
    print('bb',bb,await pg.evaluate(f"document.elementFromPoint({bb['x']+bb['width']/2},{bb['y']+bb['height']/2})?.outerHTML.slice(0,120)"));print('long',await pg.evaluate("window.__said.slice(-1)"),'sheet',await pg.locator('#sx').count())
    await pg.click('#readFab');await pg.wait_for_timeout(300);print('fab',(await pg.evaluate("window.__said.slice(-1)[0]||''"))[:150])
    await pg.check('#a11yC') if await pg.locator('#a11yC').count() else None
    await pg.click('[data-tab="account"]');await pg.wait_for_timeout(500);await pg.check('#a11yC');await pg.wait_for_timeout(300);await pg.screenshot(path='../A13.png')
    print('errs',pg.errs);await b.close()
asyncio.run(main())
