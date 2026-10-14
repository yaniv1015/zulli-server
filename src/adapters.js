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
  async list({ maxStores = Infinity, maxPromoStores = Infinity, maxPages = 60, types = ['PriceFull', 'PromoFull'] } = {}) {
    const cats = { PriceFull: 2, PromoFull: 4, Stores: 5 };
    const urls = [];
    for (const [type, cat] of Object.entries(cats)) {
      if (type !== 'Stores' && !types.includes(type)) continue;
      const stores = new Set();
      for (let page = 1; page <= (type === 'Stores' ? 1 : maxPages); page++) {
        const html = await getText(`https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=${cat}&storeId=0&page=${page}`, { timeout: 120000, retries: 1 });
        const found = [...html.matchAll(/href="(https?:\/\/[^"]+?\.(?:gz|xml|zip)[^"]*)"/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
        if (!found.length) break;
        urls.push(...found);
        for (const f of pickLatest(found)) stores.add(f.store);
        if (stores.size >= (type === 'PromoFull' ? Math.min(maxStores, maxPromoStores) : maxStores)) break;
      }
    }
    return pickLatest(urls);
  },
  // the newest file of one type for one store (the listing can be filtered by store)
  async listStore(type, storeId) {
    const cat = { PriceFull: 2, PromoFull: 4, Stores: 5 }[type];
    const html = await getText(`https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=${cat}&storeId=${storeId}`, { timeout: 120000, retries: 1 });
    return pickLatest([...html.matchAll(/href="(https?:\/\/[^"]+?\.(?:gz|xml|zip)[^"]*)"/gi)].map((m) => m[1].replace(/&amp;/g, '&'))).find((x) => x.type === type) || null;
  },
  // download links are signed and expire after about an hour: if one has expired, ask the site for a fresh link for that store
  async download(f) {
    try { return await fetchBuffer(f.url, { timeout: 120000 }); }
    catch (e) {
      if (!/download 403/.test(e.message)) throw e;
      const cat = { PriceFull: 2, PromoFull: 4, Stores: 5 }[f.type];
      const html = await getText(`https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=${cat}&storeId=${f.store}`, { timeout: 120000, retries: 1 });
      const fresh = pickLatest([...html.matchAll(/href="(https?:\/\/[^"]+?\.(?:gz|xml|zip)[^"]*)"/gi)].map((m) => m[1].replace(/&amp;/g, '&'))).find((x) => x.type === f.type);
      if (!fresh) throw e;
      return fetchBuffer(fresh.url, { timeout: 120000, retries: 1 });
    }
  },
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
      const names = (json.aaData || []).map((r) => r.fname).filter((n) => !chainId || n.includes(chainId));
      return pickLatest(names.map((n) => `${base}/file/d/${n}`));
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

/* ---------- Bina portals (http://<prefix>.binaprojects.com): a JSON file list, and a download page that answers with the real link ---------- */
function bina(key, name, prefix, chainIds) {
  const base = `http://${prefix}.binaprojects.com`;
  let cookie = '';
  const ids = [].concat(chainIds);
  return {
    key, name, chainId: ids[0],
    async list() {
      try { const r = await fetch(`${base}/Main.aspx`, { headers: UA, timeout: 60000 }); const set = r.headers.getSetCookie?.() || []; if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; '); await r.text(); } catch {}
      const names = [];
      // the list needs a date (dd/mm/yyyy): today's files, and yesterday's in case today's are not out yet
      const days = [0, 1].map((b) => { const d = new Date(Date.now() + 3 * 3600e3 - b * 864e5); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; });
      for (const id of ids) for (const day of days) {
        const q = new URLSearchParams({ _: id, wReshet: 'הכל', WFileType: '0', WDate: day, WStore: '' });
        const txt = await getText(`${base}/MainIO_Hok.aspx?${q}`, { timeout: 90000, retries: 1, headers: cookie ? { ...UA, cookie } : UA });
        let rows = []; try { rows = JSON.parse(txt); } catch { continue; }
        for (const r of rows) if (r.FileNm) names.push(r.FileNm);
      }
      // pick the newest file per store by its name, then point at the download page
      return pickLatest([...new Set(names)]).map((f) => ({ ...f, name: f.url, url: `${base}/Download.aspx?FileNm=${encodeURIComponent(f.url)}` }));
    },
    async download(f) {
      const txt = (await fetchBuffer(f.url, { cookie, timeout: 60000, retries: 1 })).toString('utf8');
      let real = null; try { real = JSON.parse(txt)[0]?.SPath; } catch {}
      if (!real) throw new Error('bina: no download link');
      return fetchBuffer(real, { cookie, timeout: 120000, retries: 1 });
    },
  };
}

/* ---------- Wolt Market: a page per day listing the files ---------- */
export const wolt = {
  key: 'wolt', name: 'וולט מרקט', chainId: '7290058249350',
  async list() {
    const base = 'https://wm-gateway.wolt.com/isr-prices/public/v1/';
    const urls = [];
    for (let back = 0; back < 3; back++) {
      const day = new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
      let html = ''; try { html = await getText(`${base}${day}.html`, { timeout: 60000 }); } catch { continue; }
      for (const m of html.matchAll(/href="([^"]+)"/gi)) urls.push(new URL(m[1], base).href);
    }
    return pickLatest(urls);
  },
  download: (f) => fetchBuffer(f.url, { timeout: 120000, retries: 1 }),
};

// more chains on the shared Cerberus portal (user names as published by the chains)
export const tivtaam = cerberus('tivtaam', 'טיב טעם', 'TivTaam', '7290873255550');
export const keshet = cerberus('keshet', 'קשת טעמים', 'Keshet', '7290785400000');
export const stopmarket = cerberus('stopmarket', 'סטופ מרקט', 'Stop_Market', '7290639000004');
export const freshmarket = cerberus('freshmarket', 'פרש מרקט', 'freshmarket', '7290876100000');
export const polizer = cerberus('polizer', 'פוליצר', 'politzer', '7291059100008');
export const dabach = cerberus('dabach', 'סאלח דבאח', 'SalachD', '7290526500006');
export const doralon = cerberus('doralon', 'דור אלון AM:PM', 'doralon', '7290492000005');
// chains on Bina portals
export const kingstore = bina('kingstore', 'קינג סטור', 'kingstore', '7290058108879');
export const maayan = bina('maayan', 'מעיין 2000', 'maayan2000', '7290058159628');
export const shefa = bina('shefa', 'שפע ברכת השם', 'shefabirkathashem', '7290058134977');
export const supersapir = bina('supersapir', 'סופר ספיר', 'supersapir', '7290058156016');
export const shukhayir = bina('shukhayir', 'שוק העיר', 'shuk-hayir', '7290058148776');
export const zolbegadol = bina('zolbegadol', 'זול ובגדול', 'zolvebegadol', '7290058173198');
export const bareket = bina('bareket', 'ברקת', 'superbareket', '7290875100001');
export const goodpharm = bina('goodpharm', 'גוד פארם', 'goodpharm', '7290058197699');
export const citymarket = bina('citymarket', 'סיטי מרקט', 'citymarketkiryatgat', ['7290058288526', '7290058266241', '7290058288090']);
export const meshnat = bina('meshnat', 'משנת יוסף', 'ktshivuk', ['5144744100001', '7290058289400']);

export const ADAPTERS = { shufersal, rami, yochananof, victory, carrefour, osherad,
  tivtaam, keshet, stopmarket, freshmarket, polizer, dabach, doralon,
  kingstore, maayan, shefa, supersapir, shukhayir, zolbegadol, bareket, goodpharm, citymarket, meshnat, wolt };

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
