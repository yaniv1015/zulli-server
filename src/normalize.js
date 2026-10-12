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

/** Chain-internal codes (ItemType 0, or short codes) are not shared barcodes; prefix them with the chain. */
export function productKey(chainKey, item) {
  const code = item.barcode.replace(/^0+(?=\d{8,})/, '');
  if (item.internal || code.length < 8) return `${chainKey}:${code}`;
  return code;
}

export function addStores(db, chainKey, chainName, parsed) {
  const ch = (db.chains[chainKey] ||= { name: chainName, stores: {} });
  for (const s of parsed.stores) ch.stores[s.storeId] = { name: s.name, city: s.city, address: s.address, type: s.type };
}

export function addPrices(db, chainKey, chainName, parsed) {
  db.chains[chainKey] ||= { name: chainName, stores: {} };
  for (const it of parsed.items) {
    const key = productKey(chainKey, it);
    const p = (db.products[key] ||= {
      name: it.name, manufacturer: it.manufacturer, quantity: it.quantity, unit: it.unitQty,
      weighted: it.weighted, names: db.compact ? undefined : {}, prices: {}, promos: {}, stores: db.compact ? {} : undefined,
    });
    if (!db.compact) p.names[chainKey] ||= it.name;
    // keep the most descriptive name and fill gaps from other chains
    if (it.name && it.name.length > (p.name || '').length) p.name = it.name;
    if (!p.manufacturer && it.manufacturer) p.manufacturer = it.manufacturer;
    if (db.compact) {
      if (p.prices[chainKey] == null || it.price < p.prices[chainKey]) p.prices[chainKey] = it.price;
      p.stores[chainKey] = (p.stores[chainKey] || 0) + 1;
    } else (p.prices[chainKey] ||= {})[parsed.storeId] = it.price;
  }
}

export function addPromos(db, chainKey, parsed) {
  if (db.compact) return; // promotions are not in the app's file yet
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
    out[bc] = { n: p.name, m: p.manufacturer, q: p.quantity, u: p.unit, w: p.weighted ? 1 : 0, p: best };
  }
  // real branches per chain, for the app's location screen: { chain: [{ id, name, city, address }] }
  const stores = {};
  for (const [chain, ch] of Object.entries(db.chains)) {
    stores[chain] = Object.entries(ch.stores || {}).map(([id, st]) => ({ id, name: st.name, city: st.city, address: st.address }));
  }
  return { updated: db.updated, products: out, stores };
}
