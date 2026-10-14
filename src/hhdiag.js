// Does Hazi Hinam (chain 7290700100008) also publish on the shared Cerberus portal? Tries likely user names. Writes data/diag.json.
import { writeFileSync, mkdirSync } from 'node:fs';
const base = 'https://url.publishedprices.co.il';
const UA = { 'user-agent': 'Mozilla/5.0 (zulli price fetcher)' };
const out = {};
async function tryUser(user) {
  let cookie = ''; const keep = (res) => { const set = res.headers.getSetCookie?.() || []; if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; '); };
  const csrfOf = (h) => (h.match(/name="csrftoken"\s+content="([^"]+)"/) || h.match(/csrftoken"\s*value="([^"]+)"/) || [])[1] || '';
  let res = await fetch(`${base}/login`, { headers: UA }); keep(res); let csrf = csrfOf(await res.text());
  res = await fetch(`${base}/login/user`, { method: 'POST', redirect: 'manual', headers: { ...UA, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ r: '', username: user, password: '', Submit: 'Sign in', csrftoken: csrf }) });
  keep(res); const loc = res.headers.get('location') || '';
  res = await fetch(`${base}/file`, { headers: { ...UA, cookie } }); keep(res); csrf = csrfOf(await res.text()) || csrf;
  res = await fetch(`${base}/file/json/dir`, { method: 'POST', headers: { ...UA, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ sEcho: '1', iDisplayStart: '0', iDisplayLength: '100000', sSearch: '', cd: '/', csrftoken: csrf }) });
  let files = []; try { files = ((await res.json()).aaData || []).map((r) => r.fname); } catch {}
  return { redirect: loc, files: files.length, chains: [...new Set(files.map((f) => (f.match(/^[A-Za-z]+(\d{13})/) || [])[1]).filter(Boolean))], sample: files.slice(0, 6) };
}
for (const u of ['HaziHinam', 'hazihinam', 'Hazihinam', 'hazi_hinam', 'HaziHinamFresh', 'shukhair', 'ShukHaIr']) {
  try { out[u] = await tryUser(u); } catch (e) { out[u] = { err: String(e).slice(0, 200) }; }
}
mkdirSync('data', { recursive: true });
writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
