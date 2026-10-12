// Where each chain publishes its files. The Israeli Food Law (price transparency)
// requires every large chain to publish Prices/PricesFull/Promos/PromosFull/Stores files,
// but every chain hosts them differently. Each adapter returns download URLs per file type.
//
// ⚠️ Endpoints, usernames and file-name patterns change from time to time. Before going live,
// open each portal in a browser and check them against the official list published by the
// Ministry of Economy (gov.il → "שקיפות מחירים ברשתות השיווק").

const UA = { 'user-agent': 'Mozilla/5.0 (zulli price fetcher)' };
// every request has a time limit and is logged, so one slow server can never stall the whole run
const fetch = (url, opts = {}) => {
  console.log('  GET', String(url).slice(0, 140));
  return globalThis.fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 60000) });
};
const TYPES = ['PriceFull', 'PromoFull', 'Stores'];

/** Return the newest URL per (type, store) from a list of file names / URLs. */
export function pickLatest(urls) {
  const best = new Map();
  for (const url of urls) {
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]);
    // e.g. PriceFull7290027600007-001-413-202610110600.gz · PriceFull7290058140886-039-202610110300.gz
    //      PromoFull7290803800003-001-005-20261011-030000.xml.gz · Stores7290027600007-000-202610110201.gz
    const m = name.match(/^(PriceFull|PromoFull|Stores)(\d+(?:-\d+)*)/i);
    if (!m) continue;
    const type = TYPES.find((t) => t.toLowerCase() === m[1].toLowerCase());
    const parts = m[2].split('-');
    let stamp = '0';
    if (parts.length >= 2 && /^\d{6}$/.test(parts.at(-1)) && /^\d{8}$/.test(parts.at(-2))) stamp = parts.splice(-2).join('');
    else if (/^\d{10,14}$/.test(parts.at(-1)) && parts.length > 1) stamp = parts.pop();
    // remaining: [chainId, subChain?, store?]
    const store = type === 'Stores' ? '0' : (parts.length >= 3 ? parts[2] : parts[1] || '0').replace(/^0+(?=\d)/, '');
    const key = `${type}|${store}`;
    if (!best.has(key) || best.get(key).stamp < stamp) best.set(key, { type, store, stamp, url, name });
  }
  return [...best.values()];
}

/* ---------- Shufersal: public listing pages with links to blob storage ---------- */
// The listing site is slow (10–20 s per page), so we stop paging as soon as we have enough stores.
export const shufersal = {
  key: 'shufersal', name: 'שופרסל', chainId: '7290027600007',
  async list({ maxStores = Infinity, maxPages = 60 } = {}) {
    const cats = { PriceFull: 2, PromoFull: 4, Stores: 5 };
    const urls = [];
    for (const [type, cat] of Object.entries(cats)) {
      const stores = new Set();
      for (let page = 1; page <= (type === 'Stores' ? 1 : maxPages); page++) {
        const html = await getText(`https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=${cat}&storeId=0&page=${page}`, { timeout: 120000, retries: 1 });
        const found = [...html.matchAll(/href="(https?:\/\/[^"]+?\.(?:gz|xml|zip)[^"]*)"/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
        if (!found.length) break;
        urls.push(...found);
        for (const f of pickLatest(found)) stores.add(f.store);
        if (stores.size >= maxStores) break;
      }
    }
    return pickLatest(urls);
  },
  download: (f) => fetchBuffer(f.url, { timeout: 120000, retries: 1 }),
};

/* ---------- Cerberus portal (url.publishedprices.co.il): many chains share it ---------- */
function cerberus(key, name, user, chainId) {
  const base = 'https://url.publishedprices.co.il';
  let cookie = '', csrf = '';
  const keepCookie = (res) => {
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  };
  const csrfFrom = (html) => (html.match(/name="csrftoken"\s+content="([^"]+)"/) || html.match(/csrftoken"\s*value="([^"]+)"/) || [])[1] || '';
  async function login() {
    let res = await fetch(`${base}/login`, { headers: UA });
    keepCookie(res); csrf = csrfFrom(await res.text());
    res = await fetch(`${base}/login/user`, {
      method: 'POST', redirect: 'manual',
      headers: { ...UA, cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ r: '', username: user, password: '', Submit: 'Sign in', csrftoken: csrf }),
    });
    keepCookie(res);
    res = await fetch(`${base}/file`, { headers: { ...UA, cookie } });
    keepCookie(res); csrf = csrfFrom(await res.text()) || csrf;
  }
  return {
    key, name, chainId,
    async list() {
      await login();
      const res = await fetch(`${base}/file/json/dir`, {
        method: 'POST',
        headers: { ...UA, cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ sEcho: '1', iDisplayStart: '0', iDisplayLength: '100000', sSearch: '', cd: '/', csrftoken: csrf }),
      });
      if (!res.ok) throw new Error(`${key} dir ${res.status}`);
      const json = await res.json();
      return pickLatest((json.aaData || []).map((r) => `${base}/file/d/${r.fname}`));
    },
    download: (f) => fetchBuffer(f.url, { cookie }),
  };
}
export const rami = cerberus('rami', 'רמי לוי', 'RamiLevi', '7290058140886');
export const yochananof = cerberus('yochananof', 'יוחננוף', 'yohananof', '7290803800003');

/* ---------- PublishPrice portals (prices.<chain>.co.il): the page script holds `const files = [...]` ---------- */
export function parsePublishPrice(html, base) {
  const m = html.match(/const\s+files\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('file list not found on the page');
  const files = JSON.parse(m[1]);
  const path = ((html.match(/const\s+path\s*=\s*['"`]([^'"`]*)['"`]/) || [])[1] || '').replace(/^\.?\/+|\/+$/g, '');
  const root = base.replace(/\/+$/, '');
  return files.map((f) => (typeof f === 'string' ? f : f.name)).filter(Boolean)
    .map((name) => (path ? `${root}/${path}/${name}` : `${root}/${name}`));
}
function publishPrice(key, name, site, chainId) {
  const base = `https://prices.${site}.co.il/`;
  return {
    key, name, chainId,
    async list() { return pickLatest(parsePublishPrice(await getText(base, { timeout: 90000, retries: 1 }), base)); },
    download: (f) => fetchBuffer(f.url, { timeout: 120000, retries: 1 }),
  };
}
export const carrefour = publishPrice('carrefour', 'קרפור', 'carrefour', '7290055700007');

/* ---------- Victory: laibcatalog API. Its server does not answer GitHub's (non-Israeli) servers, see README ---------- */
export const victory = {
  key: 'victory', name: 'ויקטורי', chainId: '7290696200003',
  async list() {
    const base = 'https://laibcatalog.co.il';
    let json;
    try { json = JSON.parse(await getText(`${base}/webapi/api/getfiles?edi=7290696200003`, { timeout: 30000 })); }
    catch (e) { throw new Error(`ויקטורי: השרת שלהם לא עונה מחוץ לישראל (${e.name === 'TimeoutError' ? 'timeout' : e.message})`); }
    const list = Array.isArray(json) ? json : json.files || json.data || [];
    return pickLatest(list.map((f) => `${base}/webapi/7290696200003/${f.fileName || f.FileName}`));
  },
  download: (f) => fetchBuffer(f.url, { timeout: 120000 }),
};

export const osherad = cerberus('osherad', 'אושר עד', 'osherad', ''); // verify username on the Cerberus portal

export const ADAPTERS = { shufersal, rami, yochananof, victory, carrefour, osherad };

async function withRetry(fn, retries) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= retries) throw e; console.log(`  retry after: ${e.message}`); await new Promise((r) => setTimeout(r, 3000)); }
  }
}
export async function getText(url, { timeout = 60000, retries = 0, headers = UA } = {}) {
  return withRetry(async () => {
    const res = await fetch(url, { headers, timeout });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
    return res.text();
  }, retries);
}
export async function fetchBuffer(url, { cookie, timeout = 60000, retries = 0 } = {}) {
  return withRetry(async () => {
    const res = await fetch(url, { headers: cookie ? { ...UA, cookie } : UA, timeout });
    if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 80)}`);
    return Buffer.from(await res.arrayBuffer());
  }, retries);
}
