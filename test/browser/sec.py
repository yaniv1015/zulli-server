import asyncio,pathlib,re
from playwright.async_api import async_playwright
root=pathlib.Path('../fuzz');html=pathlib.Path('../zul-li.html').read_text()
hits=set()
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await b.new_page(viewport={'width':390,'height':844});errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)[:150]));pg.on('dialog',lambda d:(hits.add('DIALOG '+d.message),asyncio.ensure_future(d.dismiss())))
    pg.on('popup',lambda pp:asyncio.ensure_future(pp.close()))
    async def serve(r):
      u=r.request.url
      if 'fonts' in u:return await r.abort()
      if u=='https://zulli.test/':return await r.fulfill(body='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body>'+html+'</body>',content_type='text/html; charset=utf-8')
      if not u.startswith('https://zulli.test/'):return await r.fulfill(status=404,body='')
      f=root/u.replace('https://zulli.test/','')
      if f.is_file():return await r.fulfill(body=f.read_bytes(),content_type='application/json' if f.suffix=='.json' else 'application/javascript')
      return await r.fulfill(status=404,body='')
    await pg.route('**/*',serve)
    await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q',timeout=60000);await pg.wait_for_timeout(3000)
    async def chk(where):
      v=await pg.evaluate("[...(window.__pwn||[])]");n=await pg.evaluate("document.querySelectorAll('[onerror],[onmouseover],[onload]:not(body)').length")
      for x in v:hits.add(f'{x} @ {where}')
      if n:hits.add(f'DOM has {n} inline-handler elements @ {where}')
      await pg.evaluate("window.__pwn=[]")
    async def close():
      for _ in range(3):
        if await pg.locator('#sx').count():await pg.click('#sx')
    try:
     await chk('home')
     # load all chains so chain-file names show up
     await pg.evaluate("Promise.all(CH.map(c=>ensureChain(c.id))).then(()=>update())");await pg.wait_for_timeout(3000);await chk('home+chains')
     for t in ['deals','mine','account','basket']:
       await pg.click(f'[data-tab="{t}"]');await pg.wait_for_timeout(500);await chk(t)
     await pg.click('[data-tab="deals"]');await pg.click('[data-pf="club"]');await pg.wait_for_timeout(300);await chk('deals club')
     for _ in range(3):
       if await pg.locator('#pmore').count():await pg.click('#pmore');await pg.wait_for_timeout(300)
     await chk('deals more')
     await pg.click('[data-tab="basket"]')
     # search for payload products and add them
     for q in ['במבה','חלב','שוקולד','קפה','שמפו','טונה']:
       await pg.fill('#q',q);await pg.wait_for_timeout(300);await chk('search '+q)
       for i in range(3):
         await pg.fill('#q',q);await pg.wait_for_timeout(250)
         if await pg.locator('#qres .srmain').count()>i:await pg.locator('#qres .srmain').nth(i).click(timeout=5000);await pg.wait_for_timeout(300);await chk('after add '+q);await close()
       await pg.fill('#q',q);await pg.wait_for_timeout(200)
       await pg.locator('#qres [data-chk]').first.click();await pg.wait_for_timeout(500);await chk('price check '+q)
       await pg.click('[data-pcm="city"]');await pg.wait_for_selector('.pcard .pbig,.pcard .unk',timeout=60000);await chk('price check city '+q)
       await pg.click('[data-pcm="chain"]');await close()
     await pg.fill('#q','');await pg.wait_for_timeout(1500);await chk('list')
     for k in await pg.evaluate("state.items.map(i=>i.k)"):
       pass
     await pg.click('#openCompare');await pg.wait_for_selector('.rrow');await pg.wait_for_timeout(2000);await chk('compare')
     await pg.click('[data-cmpby="city"]');await pg.wait_for_timeout(4000);await chk('compare city')
     await pg.click('[data-cmpby="address"]');await pg.wait_for_timeout(2000)
     if await pg.locator('[data-pickbr]').count():await pg.locator('[data-pickbr]').first.click();await pg.wait_for_timeout(500);await chk('branch picker')
     await close();await pg.click('#openCompare');await pg.click('[data-raceby="branch"]');await pg.wait_for_selector('.chsum',timeout=90000);await chk('branch race')
     for i in range(3):
       if await pg.locator('[data-bopen]').count()>i:await pg.locator('[data-bopen]').nth(i).click();await pg.wait_for_timeout(200)
     await chk('branch race detail');await pg.click('[data-raceby="chain"]');await pg.wait_for_timeout(1000);await close()
     await pg.click('#moreList');await pg.click('#mBranch');await pg.wait_for_selector('.blist');await chk('branch check list')
     for q in ['תל','רמי','שופרסל','חיפה']:
       await pg.fill('#bq',q);await pg.wait_for_timeout(300);await chk('branch search '+q)
       if await pg.locator('[data-badd]').count():await pg.locator('[data-badd]').first.click(force=True);await pg.wait_for_timeout(2500);await chk('branch card '+q)
     if await pg.locator('[data-bopen]').count():await pg.locator('[data-bopen]').first.click();await pg.wait_for_timeout(300);await chk('branch card lines')
     await close()
     # order / invoice / location sheets
     await pg.click('#bestbar [data-checkout]');await pg.wait_for_timeout(500);await chk('checkout')
     await close();await pg.click('[data-tab="account"]');await pg.wait_for_timeout(300)
     for sel in ['button:has-text("שנה מיקום")','button:has-text("ניהול מועדונים")']:
       if await pg.locator(sel).count():await pg.locator(sel).first.click();await pg.wait_for_timeout(800);await chk(sel)
       await close()
     # picker sheet for a generic item
     await pg.click('[data-tab="basket"]')
     if await pg.locator('[data-pick]').count():await pg.locator('[data-pick]').first.click();await pg.wait_for_timeout(500);await chk('variant picker');await close()
     # user input fields
     X='"><img src=x onerror="window.__pwn=(window.__pwn||[]).concat(\'userinput\')">'
     await pg.evaluate("document.querySelector('.moreadd')&&(document.querySelector('.moreadd').open=true)");await pg.click('#pasteBtn');await pg.fill('#paste',X+'\nחלב '+X);await pg.click('#parseBtn');await pg.wait_for_timeout(600);await chk('paste');await close()
     await pg.evaluate(f"state.profile.name={X!r};state.profile.street={X!r};state.profile.notes={X!r};update()");await pg.click('[data-tab="account"]');await pg.wait_for_timeout(300);await chk('profile fields')
     # family feed from another user (shared db data)
     await pg.evaluate(f"FAM.remote={{members:[{{id:'z',name:{X!r}}}],feed:[{{txt:{X!r},ts:Date.now()}}]}};state.fam={{code:'ABC123'}};FAM.db={{}};state.mine='lists'");await pg.click('[data-tab="mine"]');await pg.wait_for_timeout(300);await chk('family feed')
    except Exception as e:print('STOPPED:',str(e)[:200])
    print('page errors:',errs[:5])
    print('HITS:' if hits else 'NO HITS');[print(' ',h) for h in sorted(hits)]
    await b.close()
asyncio.run(main())
