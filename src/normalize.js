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
  return { updated: new Date().toISOString(), compact, chains: {}, products: {}, promos: {} };
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
  for (const s of parsed.stores) ch.stores[own(s.storeId)] = { name: own(s.name), city: own(s.city), address: own(s.address), type: own(s.type) };
}

export function addPrices(db, chainKey, chainName, parsed) {
  db.chains[chainKey] ||= { name: chainName, stores: {} };
  for (const it of parsed.items) {
    const key = productKey(chainKey, it);
    const p = (db.products[key] ||= {
      name: own(it.name), manufacturer: own(it.manufacturer), quantity: it.quantity, unit: own(it.unitQty),
      weighted: it.weighted, names: db.compact ? undefined : {}, prices: {}, promos: {}, stores: db.compact ? {} : undefined,
    });
    if (!db.compact) p.names[chainKey] ||= it.name;
    // keep the most descriptive name and fill gaps from other chains
    if (it.name && it.name.length > (p.name || '').length) p.name = own(it.name);
    if (!p.manufacturer && it.manufacturer) p.manufacturer = own(it.manufacturer);
    if (db.compact) {
      if (p.prices[chainKey] == null || it.price < p.prices[chainKey]) p.prices[chainKey] = it.price;
      p.stores[chainKey] = (p.stores[chainKey] || 0) + 1;
    } else (p.prices[chainKey] ||= {})[parsed.storeId] = it.price;
  }
}

/** Turn one promotion into a deal for one product: { kind: 'm' (n units for a total price) | 'p' (percent off), n, price | pct }.
 *  Returns null for promotions the app cannot price per product (gifts, basket thresholds, odd values). */
export function dealFor(pr, base, now = new Date()) {
  if (!(base > 0) || pr.isGiftItem || (pr.minPurchaseAmount > 0)) return null;
  const day = (s) => String(s || '').slice(0, 10);
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
  deal.desc = String(pr.description || '').trim().slice(0, 60);
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

/** Small summary the app can load fast: cheapest price per product per chain. */
export function buildSummary(db) {
  const out = {};
  for (const [bc, p] of Object.entries(db.products)) {
    const best = {};
    for (const [chain, stores] of Object.entries(p.prices)) {
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
      const pack = (d) => [d.kind, d.n, d.kind === 'm' ? d.price : d.pct, d.club, d.end, d.desc];
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
