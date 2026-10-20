// Price history: the regular price of every product at every chain, one entry per change.
//
//   hist/NN.json = { "<barcode>": { "<chain>": [[day, price], ...] } }, NN = barcode's last 4 digits % CHUNKS
//   hist/index.json = { first: day, last: day, products, entries }
// day = days since 1970-01-01 (UTC). A new entry is written only when the price changed, so a year of
// history stays small. Entries older than KEEP_DAYS are dropped, except the last one before that edge
// (it is still the price in force at the start of the window).
// Lets the app say "lowest price in 90 days" or "the price went up just before this deal".
//
// Usage: node tools/hist.js data/summary.json prev/hist out/hist
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const [SUMMARY = 'data/summary.json', PREV = 'prev/hist', OUT = 'out/hist'] = process.argv.slice(2);
const CHUNKS = 64, KEEP_DAYS = 400;
const chunkOf = (bc) => Number(String(bc).slice(-4)) % CHUNKS;
const sum = JSON.parse(readFileSync(SUMMARY, 'utf8'));
const today = Math.floor(new Date(sum.updated || Date.now()).getTime() / 864e5);
const chunks = Array.from({ length: CHUNKS }, (_, i) => {
  const f = `${PREV}/${String(i).padStart(2, '0')}.json`; try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; } catch { return {}; }
});
let index = {}; try { index = JSON.parse(readFileSync(`${PREV}/index.json`, 'utf8')); } catch {}
let changed = 0, added = 0;
for (const [bc, p] of Object.entries(sum.products)) {
  if (!/^\d{8,14}$/.test(bc) || !p.p) continue;
  const c = chunks[chunkOf(bc)]; const h = (c[bc] ||= {});
  for (const [ch, price] of Object.entries(p.p)) {
    if (typeof price !== 'number' || !(price > 0)) continue;
    const L = (h[ch] ||= []); const last = L[L.length - 1];
    if (!last) { L.push([today, price]); added++; }
    else if (Math.abs(last[1] - price) > 0.004) { if (last[0] === today) last[1] = price; else L.push([today, price]); changed++; }
  }
}
// trim old entries
const edge = today - KEEP_DAYS; let entries = 0, products = 0;
for (const c of chunks) for (const [bc, h] of Object.entries(c)) {
  for (const [ch, L] of Object.entries(h)) {
    let i = 0; while (i + 1 < L.length && L[i + 1][0] <= edge) i++;
    if (i) h[ch] = L.slice(i); entries += h[ch].length;
  }
  products++;
}
mkdirSync(OUT, { recursive: true });
chunks.forEach((c, i) => writeFileSync(`${OUT}/${String(i).padStart(2, '0')}.json`, JSON.stringify(c)));
const out = { first: Math.min(index.first ?? today, today), last: today, products, entries, chunks: CHUNKS, changedToday: changed, newToday: added };
writeFileSync(`${OUT}/index.json`, JSON.stringify(out));
console.log(JSON.stringify(out));
