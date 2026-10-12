// Basket pricing across chains, with promotions, loyalty clubs and delivery fees.
// The same logic the app uses, now driven by the real data built by normalize.js.

/** Is a promotion active now and available to this shopper? */
export function promoUsable(p, { now = new Date(), clubs = [] } = {}) {
  const t = (s) => (s ? new Date(s.replace(' ', 'T')) : null);
  const start = t(p.start), end = t(p.end);
  if (start && !isNaN(start) && start > now) return false;
  if (end && !isNaN(end) && end < now) return false;
  return p.clubs.includes('0') || p.clubs.some((c) => clubs.includes(c));
}

/**
 * Price of `qty` units of one product given its regular price and candidate promotions.
 * Handles the common reward types: fixed bundle price ("2 ב-15"), percentage discount,
 * and "the N-th unit at X% off". Picks whichever promotion is cheapest.
 */
export function linePrice(price, qty, promos = [], opts = {}) {
  let best = { total: round(price * qty), promo: null };
  for (const p of promos) {
    if (!promoUsable(p, opts)) continue;
    const n = Math.max(1, p.minQty || 1);
    if (qty < n) continue;
    const cap = p.maxQty ? Math.min(qty, p.maxQty) : qty;
    const bundles = Math.floor(cap / n);
    const rest = qty - bundles * n;
    let total = null;
    if (p.discountedPrice != null && p.discountedPrice < price * n) {
      // DiscountedPrice is the price of the whole bundle of MinQty units
      total = bundles * p.discountedPrice + rest * price;
    } else if (p.discountRate != null && p.discountRate > 0) {
      // DiscountRate is usually in hundredths of a percent (2000 = 20%) or a plain percent
      const rate = p.discountRate > 100 ? p.discountRate / 10000 : p.discountRate / 100;
      if (n >= 2 && /השני|השלישי|ה-?\d/.test(p.description)) {
        total = bundles * (price * (n - 1) + price * (1 - rate)) + rest * price; // N-th unit discounted
      } else {
        total = bundles * n * price * (1 - rate) + rest * price;
      }
    }
    if (total != null && total < best.total) best = { total: round(total), promo: p };
  }
  return best;
}

/**
 * Price a basket in one store.
 * @param db       output of normalize.js
 * @param chainKey e.g. 'shufersal'
 * @param storeId  store id within the chain
 * @param basket   [{ barcode, qty }]
 * @param opts     { clubs, delivery: { fee, freeOver, min } }
 */
export function priceBasket(db, chainKey, storeId, basket, opts = {}) {
  const lines = [], missing = [];
  let sub = 0, regular = 0;
  for (const { barcode, qty } of basket) {
    const prod = db.products[barcode];
    const price = prod?.prices?.[chainKey]?.[storeId];
    if (price == null) { missing.push(barcode); continue; }
    const promos = (prod.promos?.[chainKey]?.[storeId] || []).map((id) => db.promos[chainKey][id]).filter(Boolean);
    const lp = linePrice(price, qty, promos, opts);
    sub += lp.total; regular += price * qty;
    lines.push({ barcode, name: prod.name, qty, price, total: lp.total, promo: lp.promo?.description || null, weighted: prod.weighted });
  }
  const d = opts.delivery || {};
  const fee = d.freeOver && sub >= d.freeOver ? 0 : d.fee || 0;
  return { chain: chainKey, storeId, lines, missing, sub: round(sub), promoSave: round(regular - sub), fee, total: round(sub + fee), belowMin: d.min ? sub < d.min : false };
}

/** Compare every store given in `candidates` and sort cheapest first (stores missing items sink). */
export function compareBasket(db, candidates, basket, opts = {}) {
  return candidates
    .map(({ chain, storeId, delivery }) => priceBasket(db, chain, storeId, basket, { ...opts, delivery }))
    .sort((a, b) => (a.missing.length - b.missing.length) || (a.belowMin - b.belowMin) || (a.total - b.total));
}

const round = (n) => Math.round(n * 100) / 100;
