import asyncio,pathlib,re,json
from playwright.async_api import async_playwright
root=pathlib.Path('..');html=(root/'zul-li.html').read_text()
R=[]
def ok(name,cond,info=''):R.append(('PASS' if cond else 'FAIL',name,str(info)[:220]))
async def mkpage(b,w=390,scheme='light'):
  pg=await b.new_page(viewport={'width':w,'height':844},color_scheme=scheme);pg.errs=[]
  pg.on('pageerror',lambda e:pg.errs.append(str(e)[:200]))
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
  # tests start as a returning user: no first-run sign-up page
  await pg.add_init_script("try{localStorage.setItem('mozilSeen','1')}catch(e){}")
  await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q',timeout=30000);await pg.wait_for_timeout(2000)
  return pg
async def close(pg):
  for _ in range(3):
    if await pg.locator('#sx').count():await pg.click('#sx')
async def paste(pg,txt):
  await close(pg);await pg.click('[data-tab="basket"]')
  await pg.evaluate("document.querySelector('.moreadd')&&(document.querySelector('.moreadd').open=true)")
  await pg.click('#pasteBtn');await pg.fill('#paste',txt);await pg.click('#parseBtn');await pg.wait_for_timeout(600);await close(pg);await pg.wait_for_timeout(1500)
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await mkpage(b)
    # --- paste parser edge cases
    await paste(pg,'[16/10/2026, 01:56] Yaniv: חלב\n- במבה x3\n• 2 קוקה קולה\n\n🍅 עגבניות 1.5 ק״ג\n1. לחם\nביצים ×2\n   \nקוטג׳ 5% 250 גרם')
    items=await pg.evaluate("state.items.map(i=>({t:i.t,q:i.q,v:i.v,sz:i.sz,bh:i.bh}))")
    types=[i['t'] for i in items]
    ok('paste: 7 products (blank lines ignored)',len(items)==7,items)
    ok('paste: whatsapp prefix stripped (milk)', 'milk' in types, types)
    q=lambda t:[i['q'] for i in items if i['t']==t]
    ok('paste: "במבה x3" qty 3',q('bamba')==[3],q('bamba'))
    ok('paste: "2 קוקה קולה" qty 2',[x for x in q('cola')]==[2] or 2 in [i['q'] for i in items if 'cola' in i['t'] or i['t'] in ('cola','coke','soda')],items)
    ok('paste: "ביצים ×2" qty 2',q('eggs')==[2],q('eggs'))
    ok('paste: tomatoes 1.5 kg',q('tomato')==[1.5],q('tomato'))
    ok('paste: "1. לחם" qty 1 (list number is not quantity)',q('bread')==[1],q('bread'))
    # --- totals consistency
    data=await pg.evaluate("""(()=>{const res=evaluate();return res.map(r=>({c:r.c.id,sub:r.sub,lines:r.lines.reduce((a,L)=>a+L.tot,0),fee:r.fee,total:r.total,off:r.coupon?r.coupon.off:0}))})()""")
    bad=[d for d in data if abs(d['sub']-d['lines'])>0.01 or abs(d['total']-(d['sub']-d['off']+d['fee']))>0.01]
    ok('basket math: sub = sum of lines, total = sub - coupon + fee (all chains)',not bad,bad[:2])
    linebad=await pg.evaluate("""(()=>{const out=[];for(const r of evaluate())for(const L of r.lines){if(!L.promo&&Math.abs(L.tot-L.p*L.q)>0.01)out.push([r.c.id,L.vid,L.p,L.q,L.tot])}return out.slice(0,3)})()""")
    ok('line math: no-deal line = price × qty',not linebad,linebad)
    bar=await pg.inner_text('#bestbar .bestinfo');await pg.click('#openCompare');await pg.wait_for_selector('.race .rrow');await pg.wait_for_timeout(1500)
    bar=await pg.inner_text('#bestbar .bestinfo');first=await pg.inner_text('.rrow.first')
    bt=re.findall(r'₪[\d,.]+',bar)[0];ft=re.findall(r'₪[\d,.]+',first)
    ok('bestbar total = comparison winner total',bt in ft,(bt,ft))
    # sorted ascending
    totals=[float(re.findall(r'₪([\d,.]+)',t.split('\n')[0] if False else await l.inner_text())[0].replace(',','')) for l in [pg.locator('.rrow .rtotal').nth(i) for i in range(await pg.locator('.rrow .rtotal').count())]]
    mz=await pg.evaluate("[...document.querySelectorAll('.rrow')].map(r=>r.classList.contains('heavy'))")
    fz=[t for t,m in zip(totals,mz) if not m]
    ok('comparison: sorted cheap → expensive (estimate included), chains lacking much last',fz==sorted(fz) and mz==sorted(mz),totals[:6])
    await close(pg)
    # --- quantity buttons
    k=await pg.evaluate("state.items.find(i=>i.t==='bread').k")
    await pg.click(f'[data-inc="{k}"]');await pg.wait_for_timeout(200);ok('+ adds one',await pg.evaluate(f"state.items.find(i=>i.k==='{k}').q")==2)
    await pg.click(f'[data-dec="{k}"]');await pg.wait_for_timeout(200);ok('− removes one',await pg.evaluate(f"state.items.find(i=>i.k==='{k}').q")==1)
    kt=await pg.evaluate("state.items.find(i=>i.t==='tomato').k")
    await pg.click(f'[data-inc="{kt}"]');await pg.wait_for_timeout(200);ok('kg item + adds half kilo',await pg.evaluate(f"state.items.find(i=>i.k==='{kt}').q")==2.0)
    # delete + undo keeps position
    order=await pg.evaluate("state.items.map(i=>i.k)");await pg.click(f'[data-del="{order[2]}"]');await pg.wait_for_timeout(200)
    ok('✕ deletes',await pg.evaluate("state.items.length")==len(order)-1)
    await pg.click('.toast button');await pg.wait_for_timeout(200);ok('undo restores at same position',await pg.evaluate("state.items.map(i=>i.k)")==order)
    # persistence after reload
    n=await pg.evaluate("state.items.length");await pg.reload();await pg.wait_for_selector('#q');await pg.wait_for_timeout(2000)
    ok('list survives reload',await pg.evaluate("state.items.length")==n,await pg.evaluate("state.items.length"))
    # --- search does not add; + adds
    n=await pg.evaluate("state.items.length");await pg.fill('#q','שוקולד פרה');await pg.wait_for_timeout(300);await pg.locator('#qres [data-chk]').first.click();await pg.wait_for_selector('.pcard')
    ok('search tap opens price check without adding',await pg.evaluate("state.items.length")==n)
    await pg.click('#pqPlus');await pg.click('#pqPlus');await pg.click('#prodAdd');await pg.wait_for_timeout(200)
    last=await pg.evaluate("state.items.at(-1)");ok('price check: add with qty 3',last['q']==3,last)
    await close(pg)
    await pg.fill('#q','');await pg.fill('#q','zzzzqqq');await pg.wait_for_timeout(300);ok('search: no results message',await pg.locator('#qres').inner_text()!='',await pg.locator('#qres').inner_text())
    await pg.fill('#q','');
    # barcode search
    bc=await pg.evaluate("V.find(v=>v.bc&&v.bc.length===13&&v.rp&&Object.keys(v.rp).length>3).bc");await pg.fill('#q',bc);await pg.wait_for_timeout(300)
    ok('search by barcode finds the product',await pg.locator('#qres [data-chk]').count()>=1,bc);await pg.fill('#q','')
    # --- branch check total = sum of lines
    await pg.click('#moreList');await pg.click('#mBranch');await pg.wait_for_selector('.blist');await pg.fill('#bq','רמי לוי');await pg.wait_for_timeout(200);await pg.locator('[data-badd]').first.click();await pg.wait_for_selector('.bcard .btot',timeout=30000);await pg.wait_for_timeout(500)
    if not await pg.locator('.blines').count():await pg.locator('[data-bopen]').first.click()
    tot=float(re.sub(r'[^\d.]','',await pg.inner_text('.bcard .btot')));ls=[float(re.sub(r'[^\d.]','',x.split('₪')[-1])) for x in await pg.locator('.blines li .num').all_inner_texts() if '₪' in x]
    lines=await pg.locator('.blines li').all_inner_texts()
    s=sum(float(re.findall(r'₪([\d.,]+)',x)[-1].replace(',','')) for x in lines if '₪' in x)
    ok('branch check: total = sum of product lines',abs(tot-s)<0.05,(tot,s))
    await close(pg)
    # --- branch race first is cheapest
    await pg.evaluate("state.raceBy='branch'");await pg.click('#openCompare');await pg.wait_for_selector('.chsum',timeout=60000)
    rt=[float(re.sub(r'[^\d.]','',x)) for x in await pg.locator('.rrow .rtotal').all_inner_texts()]
    miss=await pg.evaluate("[...document.querySelectorAll('.rrow')].map(r=>!!r.querySelector('.pill.warn'))")
    full=[t for t,m in zip(rt,miss) if not m]
    ok('branch race: complete baskets sorted cheapest first',full==sorted(full),full[:6])
    await pg.evaluate("state.raceBy='chain'");await close(pg)
    # --- clubs: marking a club in deals is the same setting as in account
    await pg.click('[data-tab="deals"]');await pg.click('[data-pf="club"]');await pg.click('[data-clubt="tivtaam"]');await pg.wait_for_timeout(200)
    await pg.click('[data-tab="account"]');await pg.wait_for_timeout(300);txt=await pg.inner_text('#screen')
    ok('club marked in deals shows in account',('1 מועדונים' in txt) or ('מועדון אחד' in txt) or ('טיב טעם' in txt),re.findall(r'.{0,30}מועדונ.{0,30}',txt)[:3])
    await pg.click('[data-tab="deals"]');await pg.click('[data-clubt="tivtaam"]');await pg.click('[data-pf="all"]')
    # --- saved lists
    await pg.click('[data-tab="mine"]');await pg.wait_for_timeout(300);await pg.fill('#lname','בדיקה QA');await pg.click('#saveList');await pg.wait_for_timeout(300)
    ok('save list with a name',await pg.evaluate("state.lists[0].name")=='בדיקה QA',await pg.evaluate("state.lists[0].name"))
    nitems=await pg.evaluate("state.lists[0].items.length");ok('saved list has all products',nitems==await pg.evaluate("state.items.length"),nitems)
    # --- order flow
    await pg.click('[data-tab="basket"]');cid=await pg.evaluate("evaluate()[0].c.id");before=await pg.evaluate("state.orders.length")
    await pg.click('#bestbar [data-checkout]');await pg.wait_for_timeout(500)
    if await pg.locator('#ordGo').count():
      await pg.click('#ordGo');await pg.wait_for_timeout(500)
      if not await pg.locator('#ordDone').count():print('AFTER ordGo SHEET:',(await pg.inner_text('.sheet'))[:600] if await pg.locator('.sheet').count() else 'no sheet');await pg.screenshot(path='../bug/ordgo.png')
      await pg.click('#ordDone',timeout=3000);await pg.wait_for_timeout(400)
      ok('order saved',await pg.evaluate("state.orders.length")==before+1)
      ok('list emptied after order',await pg.evaluate("state.items.length")==0)
      o=await pg.evaluate("state.orders[0]");ok('order saving not negative / total positive',o['saved']>=0 and o['total']>0,(o['saved'],o['total']))
      await pg.click('[data-tab="mine"]');await pg.click('[data-mine="orders"]');await pg.wait_for_timeout(300)
      ok('chart shows the order',await pg.locator('.chbars').count()==1 and 'הזמנ' in await pg.inner_text('.chsum'),await pg.inner_text('.chsum') if await pg.locator('.chsum').count() else 'no chart')
    else: ok('checkout opens order sheet',False,await pg.inner_text('.sheet') if await pg.locator('.sheet').count() else 'no sheet')
    await close(pg)
    # --- registration validation
    await pg.click('[data-tab="account"]');await pg.wait_for_timeout(200)
    regb=pg.locator('button:has-text("הרשמה")').first
    if await regb.count():
      await regb.click();await pg.wait_for_timeout(300);t=await pg.inner_text('.sheet')
      ok('registration sheet opens',len(t)>20)
    await close(pg)
    print('page errors:',pg.errs)
    # --- narrow screen + dark mode overflow
    for w,sch in [(320,'light'),(390,'dark')]:
      p2=await mkpage(b,w,sch);await paste(p2,'במבה\nחלב\nקוקה קולה 1.5 ליטר')
      for t in ['basket','deals','mine','account']:
        await p2.click(f'[data-tab="{t}"]');await p2.wait_for_timeout(300)
        o=await p2.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
        ok(f'{w}px {sch}: no sideways scroll on {t}',o<=1,o)
        await p2.screenshot(path=f'../bug/{w}_{sch}_{t}.png')
      print(w,sch,'errors',p2.errs)
    for r in R:print(*r)
    print('FAILS',sum(1 for r in R if r[0]=='FAIL'),'/',len(R))
    await b.close()
if __name__=="__main__":asyncio.run(main())
