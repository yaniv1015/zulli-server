import asyncio,re,sys,time
sys.path.insert(0,'.')
from qa import mkpage,paste,close
from playwright.async_api import async_playwright
R=[]
def ok(n,c,i=''):R.append(('PASS' if c else 'FAIL',n,str(i)[:200]))
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await mkpage(b);dialogs=[];pg.on('dialog',lambda d:(dialogs.append(d.message),asyncio.ensure_future(d.dismiss())))
    X='<img src=x onerror="window.__x=1">'
    await paste(pg,f'{X}\nחלב <b>bold</b>\n"; alert(1); "')
    await pg.wait_for_timeout(500);ok('XSS in pasted list: nothing runs',not await pg.evaluate("window.__x||0") and not dialogs,dialogs)
    ok('XSS: no injected <img> in page',await pg.evaluate("document.querySelectorAll('img[src=\"x\"]').length")==0)
    await pg.fill('#q',X);await pg.wait_for_timeout(300);ok('XSS in search box',not await pg.evaluate("window.__x||0"))
    await pg.fill('#q','')
    await pg.click('[data-tab="mine"]');await pg.fill('#lname',X);await pg.click('#saveList');await pg.wait_for_timeout(300);await pg.click('[data-tab="mine"]');await pg.wait_for_timeout(300)
    ok('XSS in saved list name',not await pg.evaluate("window.__x||0") and await pg.evaluate("document.querySelectorAll('img[src=\"x\"]').length")==0)
    # long list performance
    await close(pg);await pg.click('[data-tab="basket"]');await pg.evaluate("state.items=[];update()")
    words=['חלב','במבה','ביצים','לחם','קוטג','גבינה צהובה','יוגורט','עגבניות','מלפפון','בננה','עוף','אורז','פסטה','שמן','קפה','טונה','קוקה קולה','מים','שמפו','סבון','נייר טואלט','אקונומיקה','סוכר','מלח','קמח']
    t=time.time();await paste(pg,'\n'.join(words*4));dt=time.time()-t
    n=await pg.evaluate("state.items.length");ok('100-line paste merges duplicates',n<=len(words)+2,n)
    t=time.time();await pg.evaluate("(()=>{for(let i=0;i<5;i++)update()})()");dt2=(time.time()-t)/5
    ok(f're-render with {n} products under 0.5s',dt2<0.5,round(dt2,3))
    t=time.time();await pg.click('#openCompare');await pg.wait_for_selector('.rrow.first');dt3=time.time()-t;ok('comparison opens under 2s',dt3<2,round(dt3,2));await close(pg)
    # quantities merged: bamba should be 4
    q=await pg.evaluate("(state.items.find(i=>i.t==='bamba')||{}).q");ok('duplicates add up (במבה ×4)',q==4,q)
    # rapid double click on order: only one sheet
    await pg.click('#bestbar [data-checkout]');await pg.click('#bestbar [data-checkout]',force=True,timeout=2000) if await pg.locator('#bestbar [data-checkout]').is_visible() else None
    await pg.wait_for_timeout(300);ok('double tap on order opens one window',await pg.locator('.sheet').count()<=1,await pg.locator('.sheet').count());await close(pg)
    # price alert target garbage
    vid=await pg.evaluate("V.find(v=>v.rp&&Object.keys(v.rp).length>4).id")
    await pg.evaluate(f"openWatch('{vid}')");await pg.wait_for_timeout(300)
    tgt=pg.locator('.sheet input[type=number], .sheet input[inputmode=decimal]')
    print('watch inputs:',await tgt.count(),(await pg.inner_text('.sheet'))[:300].replace('\n',' | '))
    await close(pg)
    print('errors',pg.errs)
    for r in R:print(*r)
    await b.close()
asyncio.run(main())
