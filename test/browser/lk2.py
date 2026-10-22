import asyncio,sys
sys.path.insert(0,'.')
import qa
from playwright.async_api import async_playwright
MOCK=r"""localStorage.setItem('mozilSeen','1');
const fn=async()=>({text:''});fn.limits=async()=>({images:true});
fn.json=async(p)=>({ok:true,dish:'פסטה רוזה',note:'לפי טקסט הפוסט.',ingredients:[{name:'פסטה פנה',amount:'500 גרם',pantry:false},{name:'שמנת מתוקה',amount:'1',pantry:false},{name:'רסק עגבניות',amount:'',pantry:false},{name:'מלח',amount:'',pantry:true}]});
window.claude={use:async n=>n==='sample'?fn:null};
window.__SR=null;window.SpeechRecognition=window.webkitSpeechRecognition=function(){const r=this;window.__SR=r;r.start=()=>setTimeout(()=>{r.onresult&&r.onresult({results:[[{transcript:window.__SAY}]]});r.onend&&r.onend()},100);r.stop=()=>{}};"""
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch();pg=await b.new_page(viewport={'width':390,'height':844},device_scale_factor=2);errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.add_init_script(MOCK)
    async def serve(r):
      u=r.request.url
      if u=='https://zulli.test/':return await r.fulfill(body='<!doctype html><meta charset="utf-8"><body>'+qa.html+'</body>',content_type='text/html; charset=utf-8')
      f=qa.root/u.split('?')[0].replace('https://zulli.test/','')
      if u.startswith('https://zulli.test/') and f.is_file():return await r.fulfill(body=f.read_bytes(),content_type='application/json')
      return await r.fulfill(status=404,body='')
    await pg.route('**/*',serve);await pg.goto('https://zulli.test/');await pg.wait_for_selector('#q');await pg.wait_for_timeout(4000)
    await pg.click('[data-tab="feed"]');await pg.wait_for_timeout(600);await pg.click('#feedLink');await pg.wait_for_timeout(300)
    await pg.fill('#lkUrl','https://www.tiktok.com/@chef/video/7350000000000000000');await pg.wait_for_timeout(700);print('site',await pg.inner_text('#lkSite'))
    await pg.fill('#lkTitle','פסטה רוזה');await pg.click('#lkAi');await pg.wait_for_timeout(500);print('ingr',await pg.input_value('#lkIngr'))
    await pg.click('#lkGo');await pg.wait_for_timeout(900);print('ingr sheet',await pg.locator('.sheet .ri').count())
    await pg.evaluate("closeSheet()");await pg.wait_for_timeout(400);print('saved',await pg.locator('.lpost').count(),await pg.locator('.lpost iframe').get_attribute('src'))
    await pg.screenshot(path='../LK.png')
    for say in ['כמה עולה במבה','מבצעים על קפה','חלב ביצים ולחם']:
      await pg.click('[data-tab="basket"]');await pg.wait_for_timeout(500);await pg.evaluate(f"window.__SAY={say!r}");print('mic',await pg.locator('#micBtn').count());await pg.evaluate("startVoice(document.getElementById('micBtn'))");await pg.wait_for_timeout(900)
      print(say,'→',await pg.evaluate("(()=>{const s=document.querySelector('.sheet h2,.sheet .shead b,.sheet');return (document.querySelector('.sheet')?document.querySelector('.sheet').innerText.slice(0,60).replace(/\\n/g,' '):'no sheet')+' | items '+state.items.length})()"))
      await pg.evaluate("closeSheet&&closeSheet()");await pg.wait_for_timeout(300)
    print('errors',errs);await b.close()
asyncio.run(main())
