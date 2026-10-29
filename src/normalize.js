// Merge parsed files from all chains into one product catalog keyed by barcode.
//
// db = {
//   updated, chains: { shufersal: { name, stores: { [storeId]: {name, city, address, type} } } },
//   products: { [barcode]: { name, manufacturer, quantity, unit, weighted, names:{chain:name},
//                            prices:{ chain:{ storeId: price } }, promos:{ chain:{ storeId:[promoId] } } } },
//   promos: { chain: { [promoId]: promo } }
// }

// compact: keep only the cheapest price per chain (and how many stores sell it) instead of a price per store.
// A full run covers ~800 stores; per-store prices would not fit in memory.
export function emptyDb({ compact = false } = {}) {
  // compact runs also keep every store's prices as packed [productIndex, agorot] pairs (8 bytes a price),
  // so the summary can give each chain its usual price and each branch only the prices that differ from it
  return { updated: new Date().toISOString(), compact, chains: {}, products: {}, promos: {}, keys: [], storeRows: {} };
}

// Strings cut out of a big XML file keep the whole file alive in memory (V8 "sliced strings").
// Copy them so each file can be freed after it is parsed.
const own = (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8').toString('utf8') : x);

/** Chain-internal codes (ItemType 0, or short codes) are not shared barcodes; prefix them with the chain. */
export function productKey(chainKey, item) {
  const code = item.barcode.replace(/^0+(?=\d{8,})/, '');
  if (item.internal || code.length < 8) return `${chainKey}:${code}`;
  return code;
}

export function addStores(db, chainKey, chainName, parsed) {
  const ch = (db.chains[chainKey] ||= { name: chainName, stores: {} });
  for (const s of parsed.stores) ch.stores[own(String(s.storeId).replace(/^0+(?=\d)/, ''))] = { name: own(s.name), city: own(s.city), address: own(s.address), type: own(s.type) };
}

// lines that some chains list as items but are not products: delivery fees, bottle deposits, bags, coupons, club fees
export const NOT_A_PRODUCT = /^\s*(עלות\s+)?משלוח|דמי\s+משלוח|פיקדון|פקדון|הנחת\s+קופון|קופון\s+הנחה|חידוש\s+מועדון|דמי\s+מנוי|שקית\s+(קניות|ניילון|אל\s*בד)|^\s*שקית\s*$/;

export function addPrices(db, chainKey, chainName, parsed) {
  db.chains[chainKey] ||= { name: chainName, stores: {} };
  const rows = db.compact ? new Int32Array(parsed.items.length * 2) : null;
  let nr = 0;
  for (const it of parsed.items) {
    if (NOT_A_PRODUCT.test(it.name || '')) continue;
    if (!(it.price >= 0.1)) continue; // 0.01 / 0 are placeholders in some chains' files, not prices
    const key = productKey(chainKey, it);
    const p = (db.products[key] ||= {
      name: own(it.name), manufacturer: own(it.manufacturer), quantity: it.quantity, unit: own(it.unitQty),
      weighted: it.weighted, names: db.compact ? undefined : {}, prices: {}, promos: {}, stores: db.compact ? {} : undefined,
    });
    if (!db.compact) p.names[chainKey] ||= it.name;
    // keep the most descriptive name and fill gaps from other chains
    if (it.name && it.name.length > (p.name || '').length) p.name = own(it.name);
    if (!p.manufacturer && it.manufacturer) p.manufacturer = own(it.manufacturer);
    if (p.i == null) { p.i = db.keys.length; db.keys.push(key); }
    if (rows && it.price > 0 && it.price < 20000) { rows[nr++] = p.i; rows[nr++] = Math.round(it.price * 100); }
    if (db.compact) {
      if (p.prices[chainKey] == null || it.price < p.prices[chainKey]) p.prices[chainKey] = it.price;
      p.stores[chainKey] = (p.stores[chainKey] || 0) + 1;
    } else (p.prices[chainKey] ||= {})[parsed.storeId] = it.price;
  }
  if (rows && parsed.storeId != null) (db.storeRows[chainKey] ||= {})[String(parsed.storeId)] = rows.subarray(0, nr);
}

/** The price most of a chain's stores charge for each product (ties go to the lower price): { chain: Map<index, agorot> } */
export function usualPrices(db) {
  const out = {};
  for (const [chain, stores] of Object.entries(db.storeRows || {})) {
    const counts = new Map(); // index*2^21 + agorot -> stores
    for (const rows of Object.values(stores)) for (let j = 0; j < rows.length; j += 2) { const k = rows[j] * 2097152 + rows[j + 1]; counts.set(k, (counts.get(k) || 0) + 1); }
    const best = new Map(), bestN = new Map();
    for (const [k, n] of counts) {
      const i = Math.floor(k / 2097152), a = k % 2097152, bn = bestN.get(i);
      if (bn == null || n > bn || (n === bn && a < best.get(i))) { best.set(i, a); bestN.set(i, n); }
    }
    out[chain] = best;
  }
  return out;
}

/** Same small hash in the app: which branch file a store's prices are in. */
export const BRANCH_BUCKETS = 64;
export function branchBucket(chain, storeId) {
  let h = 5381; const s = `${chain}:${storeId}`;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % BRANCH_BUCKETS;
}

/** Per-branch prices that differ from the chain's usual price: [ { "chain:store": { barcode: price } } ] by bucket. */
export function buildBranches(db, usual = usualPrices(db)) {
  const buckets = Array.from({ length: BRANCH_BUCKETS }, () => ({}));
  for (const [chain, stores] of Object.entries(db.storeRows || {})) {
    const u = usual[chain];
    for (const [sid, rows] of Object.entries(stores)) {
      const diff = {};
      let n = 0;
      for (let j = 0; j < rows.length; j += 2) { if (u.get(rows[j]) !== rows[j + 1]) { diff[db.keys[rows[j]]] = rows[j + 1] / 100; n++; } }
      const id = String(sid).replace(/^0+(?=\d)/, ''); // the same branch is '039' in one file and '39' in another
      buckets[branchBucket(chain, id)][`${chain}:${id}`] = diff;
    }
  }
  return buckets;
}

/** Turn one promotion into a deal for one product: { kind: 'm' (n units for a total price) | 'p' (percent off), n, price | pct }.
 *  Returns null for promotions the app cannot price per product (gifts, odd values).
 *  A deal that needs a minimum basket ("בקנייה מעל 100 ₪") keeps that minimum in deal.min; the app applies it only to a big enough basket. */
export function dealFor(pr, base, now = new Date()) {
  if (!(base > 0) || pr.isGiftItem || pr.isCoupon) return null;
  if (pr.minPurchaseAmount > 2000) return null; // not a shopping basket
  // deals that need a printed coupon or an outside benefit (insurance, credit card voucher) are not shelf prices
  if (/קופון|הטבת|שובר|ביטוח/.test(pr.description || '')) return null;
  const day = (s) => (String(s || '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0]; // a bare hour is not a date
  const today = now.toISOString().slice(0, 10);
  if (pr.end && day(pr.end) && day(pr.end) < today) return null;
  if (pr.start && day(pr.start) && day(pr.start) > today) return null;
  const n = Math.max(1, Math.round(pr.minQty || 1));
  let unit = null, deal = null;
  if (pr.discountedPrice > 0) {
    // DiscountedPrice is usually the total for MinQty units ("3 ב-15"); some chains give the unit price instead
    if (n > 1 && pr.discountedPrice < base * n * 0.98 && pr.discountedPrice >= base * 0.9) { unit = pr.discountedPrice / n; deal = { kind: 'm', n, price: pr.discountedPrice }; }
    else if (pr.discountedPrice < base * 0.98) { unit = pr.discountedPrice; deal = { kind: 'm', n: 1, price: pr.discountedPrice }; }
  } else if (pr.discountRate > 0) {
    let rate = pr.discountRate; if (rate > 100) rate /= 100; // 2000 = 20%
    if (rate >= 1 && rate <= 90) { unit = base * (1 - rate / 100); deal = { kind: 'p', n, pct: rate }; }
  }
  if (!deal || !(unit > base * 0.15) || !(unit < base * 0.98)) return null;
  deal.unit = Math.round(unit * 100) / 100;
  deal.club = pr.clubs.some((c) => String(c) !== '0') ? 1 : 0;
  deal.end = day(pr.end);
  deal.start = day(pr.start); // when the deal began: the app shows new deals first
  deal.desc = String(pr.description || '').trim().slice(0, 60);
  if (pr.minPurchaseAmount > 0) deal.min = Math.round(pr.minPurchaseAmount);
  if (pr.limit >= 1 && pr.limit < 100) deal.lim = Math.round(pr.limit);
  return deal;
}

export function addPromos(db, chainKey, parsed) {
  if (db.compact) {
    // compact runs keep, per product and chain, the best deal open to everyone and the best club-only deal
    for (const pr of parsed.promos) {
      if (pr.barcodes.length > 400) continue; // store-wide promotions are not per-product deals
      for (const bc of pr.barcodes) {
        const p = db.products[productKey(chainKey, { barcode: bc, internal: false })];
        if (!p || p.prices[chainKey] == null) continue;
        const d = dealFor(pr, p.prices[chainKey]);
        if (!d) continue;
        const slot = ((p.deals ||= {})[chainKey] ||= {});
        const k = d.club ? 'c' : 'r';
        if (!slot[k] || d.unit < slot[k].unit) slot[k] = { ...d, desc: own(d.desc) };
      }
    }
    return;
  }
  const store = parsed.storeId;
  const bucket = (db.promos[chainKey] ||= {});
  for (const pr of parsed.promos) {
    const id = pr.id || `${store}-${Object.keys(bucket).length}`;
    bucket[id] = { description: pr.description, start: pr.start, end: pr.end, minQty: pr.minQty, maxQty: pr.maxQty,
      discountedPrice: pr.discountedPrice, discountRate: pr.discountRate, clubs: pr.clubs, rewardType: pr.rewardType };
    for (const bc of pr.barcodes) {
      const key = productKey(chainKey, { barcode: bc, internal: false });
      const p = db.products[key];
      if (!p) continue; // promo for an item we have no price for
      const list = ((p.promos[chainKey] ||= {})[store] ||= []);
      if (!list.includes(id)) list.push(id);
    }
  }
}

/** deal → [kind, n, price|pct, club, end, desc] (+ [min basket ₪, unit limit] when the deal has them, + start date when known) */
export const packDeal = (d) => {
  const a = [d.kind, d.n, d.kind === 'm' ? d.price : d.pct, d.club, d.end, d.desc];
  if (d.min || d.lim || d.start) a.push(d.min || 0, d.lim || 0);
  if (d.start) a.push(d.start);
  return a;
};

/** Small summary the app can load fast: cheapest price per product per chain. */
export function buildSummary(db, usual = usualPrices(db)) {
  const out = {};
  for (const [bc, p] of Object.entries(db.products)) {
    const best = {};
    for (const [chain, stores] of Object.entries(p.prices)) {
      // the price most branches charge; branch files hold the exceptions (the cheapest branch was misleading for most shoppers)
      const a = p.i != null ? usual[chain]?.get(p.i) : undefined;
      if (a != null) { best[chain] = a / 100; continue; }
      const vals = typeof stores === 'number' ? [stores] : Object.values(stores);
      if (vals.length) best[chain] = Math.min(...vals);
    }
    const known = (x) => x && !/^(לא ידוע|unknown)$/i.test(String(x).trim());
    const row = { n: p.name, q: p.quantity, p: best }; // short keys and no empty fields keep the app's file small
    if (known(p.manufacturer)) row.m = p.manufacturer;
    if (known(p.unit)) row.u = p.unit;
    if (p.weighted) row.w = 1;
    // deals: { chain: [kind, n, price|pct, club, end, desc] } — r = open to everyone, c = club members
    if (p.deals) {
      const pack = packDeal;
      for (const [chain, slot] of Object.entries(p.deals)) {
        if (slot.r) (row.d ||= {})[chain] = pack(slot.r);
        if (slot.c && (!slot.r || slot.c.unit < slot.r.unit)) (row.dc ||= {})[chain] = pack(slot.c);
      }
    }
    out[bc] = row;
  }
  // real branches per chain, for the app's location screen: { chain: [{ id, name, city, address }] }
  const stores = {};
  for (const [chain, ch] of Object.entries(db.chains)) {
    stores[chain] = Object.entries(ch.stores || {}).map(([id, st]) => ({ id, name: st.name, city: st.city, address: st.address }));
  }
  return { updated: db.updated, products: out, stores };
}

/** Branch-only deals (see src/branchdeals.js): for one store's deal file, what differs from the chain-wide deals in the summary.
 *  Returns (chain, storeId, parsedPromos) => { d?, c?, x?, xc? } */
export function branchDealDiff(summary, br) {
  const pack = packDeal;
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && Math.abs(a[2] - b[2]) < 0.005 && (a[6] || 0) === (b[6] || 0) && (a[7] || 0) === (b[7] || 0);
  const cd = {};
  const chainDeals = (chain) => cd[chain] ||= { d: Object.keys(summary.products).filter((bc) => summary.products[bc].d?.[chain]), dc: Object.keys(summary.products).filter((bc) => summary.products[bc].dc?.[chain]) };
  return (chain, sid, parsed) => {
    const own = br[`${chain}:${sid}`] || {};
    const best = { r: {}, c: {} };
    for (const pr of parsed.promos) {
      if (pr.barcodes.length > 400) continue; // store-wide promotions are not per-product deals
      for (const bc of pr.barcodes) {
        const base = own[bc] ?? summary.products[bc]?.p?.[chain];
        if (base == null) continue;
        const d = dealFor(pr, base);
        if (!d) continue;
        const k = d.club ? 'c' : 'r';
        if (!best[k][bc] || d.unit < best[k][bc].unit) best[k][bc] = d;
      }
    }
    const o = {};
    for (const [k, field, miss] of [['r', 'd', 'x'], ['c', 'dc', 'xc']]) {
      const add = {};
      for (const [bc, d] of Object.entries(best[k])) { const p = pack(d); if (!same(p, summary.products[bc]?.[field]?.[chain])) add[bc] = p; }
      const lacking = chainDeals(chain)[field].filter((bc) => !best[k][bc]);
      if (Object.keys(add).length) o[k === 'r' ? 'd' : 'c'] = add;
      if (lacking.length) o[miss] = lacking;
    }
    return o;
  };
}
