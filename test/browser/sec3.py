"""Security checks for inputs added after sec.py/sec2.py: list hints (typed, spoken, read from photos), saved recipe links,
shared-list links, the refine edit box and the accessibility reader. Each injects hostile text and checks that no script ran,
no inline handler reached the page, no iframe points outside the four video sites and no javascript: link exists."""
import asyncio,sys,json,base64
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
X='<img src=x onerror="window.__pwn=(window.__pwn||0)+1">'
res=[]
def ok(n,c,d=''):res.append(c);print(('PASS ' if c else 'FAIL ')+n,'' if c else d)
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await qa.mkpage(b)
    pg.on('dialog',lambda d:(res.append(False),print('FAIL dialog',d.message),asyncio.ensure_future(d.dismiss())))
    await pg.add_init_script("localStorage.setItem('mozilSeen','1')")
    await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(3500);await qa.close(pg)
    async def clean(where):
      n=await pg.evaluate("window.__pwn||0");h=await pg.evaluate("document.querySelectorAll('[onerror],[onload]:not(body),[onclick]:not([data-safe])').length")
      js=await pg.evaluate("[...document.querySelectorAll('a[href],iframe[src]')].filter(e=>/^\\s*javascript:/i.test(e.getAttribute('href')||e.getAttribute('src')||'')).length")
      bad=await pg.evaluate("[...document.querySelectorAll('iframe')].map(f=>f.src).filter(u=>!/^https:\\/\\/www\\.(tiktok|instagram|facebook|youtube)\\.com\\//.test(u))")
      ok(f'{where}: no script ran',n==0,n);ok(f'{where}: no inline handlers',h==0,h);ok(f'{where}: no javascript: links',js==0,js);ok(f'{where}: iframes only from video sites',not bad,bad)
    # 1 hostile list lines (typed / spoken / photo all go through parseLoose)
    await pg.evaluate("(x)=>{addItems(parseLoose('חלב '+x+'\\nבמבה \"><svg onload=window.__pwn=1>\\n'+x).out,'t');save();update()}",X)
    await pg.wait_for_timeout(600);await clean('list with hostile lines')
    await pg.evaluate("refineQueue()");await pg.wait_for_timeout(600)
    if await pg.locator('#rfEdit').count():
      await pg.click('#rfEdit');await pg.fill('#rfName',X);await pg.wait_for_timeout(500);await pg.click('#rfNameGo');await pg.wait_for_timeout(500)
    await clean('refine and edit box');await qa.close(pg)
    # 2 saved recipe links with hostile url / embed / title
    await pg.evaluate("""(x)=>{state.links=[{id:'a',url:'javascript:window.__pwn=1',site:'web',embed:'javascript:window.__pwn=1',title:x,ingr:x},
      {id:'b',url:'https://evil.example/',site:'web',embed:'https://evil.example/frame',title:x,ingr:''},
      {id:'c',url:'https://www.youtube.com/watch?v=abc123',site:'youtube',embed:'https://www.youtube.com/embed/abc123',title:'ok',ingr:''}];save();go('feed')}""",X)
    await pg.wait_for_timeout(900);await clean('feed with hostile saved links')
    n=await pg.evaluate("document.querySelectorAll('.lpost').length");ok('feed drops the javascript: link, keeps the others',n==2,n)
    sb=await pg.evaluate("[...document.querySelectorAll('.lpost iframe')].every(f=>f.hasAttribute('sandbox'))");ok('video frames are sandboxed',sb)
    # 3 shared list with absurd quantity and hostile brand
    data=base64.urlsafe_b64encode(json.dumps({'i':[['t:milk',1e9,X],['t:bamba',-5,'x'*500]]}).encode()).decode().rstrip('=')
    got=await pg.evaluate("(d)=>decodeList(d)",data)
    ok('shared list: quantities bounded',all(0.5<=i['q']<=99 for i in got),got)
    ok('shared list: long brand text dropped',all(not i.get('bh') or len(i['bh'])<=40 for i in got),got)
    await pg.evaluate("(d)=>openSharedList(d)",data);await pg.wait_for_timeout(600);await clean('shared list sheet');await qa.close(pg)
    # 4 reader: hostile text read aloud is text only
    await pg.evaluate("Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{speak:()=>{},cancel:()=>{},getVoices:()=>[]}});window.SpeechSynthesisUtterance=function(t){this.text=t};state.a11y={zoom:1,read:true};applyA11y()")
    await pg.click('#readFab');await pg.wait_for_timeout(300);await clean('read-aloud')
    ok('no page errors',not pg.errs,pg.errs[:3])
    print(f'FAILS {res.count(False)} / {len(res)}');await b.close()
asyncio.run(main())
