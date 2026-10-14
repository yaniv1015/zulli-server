// Live check of every chain we do not have yet: Cerberus accounts (file and store counts), Bina portals,
// PublishPrice-style sites and own sites. Also saves the scraper library's engine sources we need. Writes data/diag.json.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const UA = { 'user-agent': 'Mozilla/5.0 (zulli price fetcher)' };
const out = { cerberus: {}, bina: {}, web: {}, src: {} };
const T = (ms) => AbortSignal.timeout(ms);

// 1. library sources for the engines we will implement
try {
  const meta = await (await fetch('https://pypi.org/pypi/il-supermarket-scraper/json')).json();
  const sd = meta.urls.find((u) => u.packagetype === 'sdist');
  writeFileSync('/tmp/pkg.tgz', Buffer.from(await (await fetch(sd.url)).arrayBuffer()));
  execSync('mkdir -p /tmp/lib && cd /tmp/lib && tar xzf /tmp/pkg.tgz');
  for (const n of ['bina.py', 'apsx.py', 'publishprice.py', 'quik.py', 'super_pharm.py', 'wolt.py', 'nativ_hashed.py', 'multipage_web.py']) {
    const f = execSync(`find /tmp/lib -name ${n} | head -1`).toString().trim(); if (f) out.src[n] = readFileSync(f, 'utf8').slice(0, 9000);
  }
} catch (e) { out.srcErr = String(e).slice(0, 200); }

// 2. Cerberus accounts
const base = 'https://url.publishedprices.co.il';
async function cerberus(user) {
  let cookie = ''; const keep = (res) => { const set = res.headers.getSetCookie?.() || []; if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; '); };
  const csrfOf = (h) => (h.match(/name="csrftoken"\s+content="([^"]+)"/) || h.match(/csrftoken"\s*value="([^"]+)"/) || [])[1] || '';
  let res = await fetch(`${base}/login`, { headers: UA, signal: T(30000) }); keep(res); let csrf = csrfOf(await res.text());
  res = await fetch(`${base}/login/user`, { method: 'POST', redirect: 'manual', signal: T(30000), headers: { ...UA, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ r: '', username: user, password: '', Submit: 'Sign in', csrftoken: csrf }) });
  keep(res);
  res = await fetch(`${base}/file`, { headers: { ...UA, cookie }, signal: T(30000) }); keep(res); csrf = csrfOf(await res.text()) || csrf;
  res = await fetch(`${base}/file/json/dir`, { method: 'POST', signal: T(60000), headers: { ...UA, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ sEcho: '1', iDisplayStart: '0', iDisplayLength: '100000', sSearch: '', cd: '/', csrftoken: csrf }) });
  let files = []; try { files = ((await res.json()).aaData || []).map((r) => r.fname); } catch {}
  const pf = files.filter((f) => /^PriceFull/i.test(f));
  return { files: files.length, priceFull: pf.length, stores: new Set(pf.map((f) => f.split('-')[f.split('-').length > 3 ? 2 : 1])).size, hasStores: files.some((f) => /^Stores/i.test(f)), sample: files.filter((f) => /^(PriceFull|Stores)/i.test(f)).slice(0, 3) };
}
for (const u of ['TivTaam', 'Keshet', 'Stop_Market', 'yuda_ho', 'freshmarket', 'politzer', 'SalachD', 'Paz_bo', 'doralon', 'SuperCofixApp']) {
  try { out.cerberus[u] = await cerberus(u); } catch (e) { out.cerberus[u] = { err: String(e).slice(0, 160) }; }
}

// 3. Bina portals (http://<prefix>.binaprojects.com)
const d = new Date(); const dd = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
for (const p of ['kingstore', 'maayan2000', 'shefabirkathashem', 'supersapir', 'shuk-hayir', 'zolvebegadol', 'superbareket', 'goodpharm', 'citymarketkiryatgat', 'ktshivuk']) {
  const o = (out.bina[p] = {});
  for (const u of [`http://${p}.binaprojects.com/Main.aspx`, `http://${p}.binaprojects.com/MainIO_Hok.aspx?WStore=&WDate=${encodeURIComponent(dd)}&WFileType=0`]) {
    try { const r = await fetch(u, { headers: UA, signal: T(40000) }); const t = await r.text(); o[u.includes('MainIO') ? 'list' : 'main'] = { status: r.status, len: t.length, head: t.slice(0, 700) }; }
    catch (e) { o[u.includes('MainIO') ? 'list' : 'main'] = { err: String(e).slice(0, 160) }; }
  }
}

// 4. other sites
for (const u of ['https://prices.quik.co.il/', 'https://quik.co.il/', 'http://prices.super-pharm.co.il/', 'https://wm-gateway.wolt.com/isr-prices/public/v1/index.html', 'https://app.netiv-hesed.com/']) {
  try { const r = await fetch(u, { headers: UA, signal: T(40000) }); const t = await r.text(); out.web[u] = { status: r.status, final: r.url, len: t.length, head: t.slice(0, 1200), links: [...new Set([...t.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]))].slice(0, 25) }; }
  catch (e) { out.web[u] = { err: String(e).slice(0, 160) }; }
}
mkdirSync('data', { recursive: true });
writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.cerberus));
