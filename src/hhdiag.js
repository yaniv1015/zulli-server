// What does Hazi Hinam's price portal look like? Saves the listing page's forms, links and a sample row. Writes data/diag.json.
import { writeFileSync, mkdirSync } from 'node:fs';
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', 'accept-language': 'he-IL,he;q=0.9' };
const out = {};
async function get(url) {
  try { const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(60000) }); const t = await r.text();
    return { status: r.status, url: r.url, len: t.length, text: t }; } catch (e) { return { err: String(e).slice(0, 200) }; }
}
for (const u of ['https://shop.hazi-hinam.co.il/Prices', 'https://shop.hazi-hinam.co.il/Prices?t=1&p=1', 'https://shop.hazi-hinam.co.il/Prices?t=3']) {
  const r = await get(u); const t = r.text || '';
  out[u] = { status: r.status, final: r.url, len: r.len, err: r.err,
    forms: [...t.matchAll(/<form[\s\S]*?<\/form>/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 1500)).slice(0, 3),
    selects: [...t.matchAll(/<select[\s\S]*?<\/select>/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 800)).slice(0, 4),
    links: [...new Set([...t.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]))].filter((h) => /gz|xml|zip|download|file|Price|p=/i.test(h)).slice(0, 40),
    rows: [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 600)).slice(0, 4),
    head: t.slice(0, 1500) };
}
mkdirSync('data', { recursive: true });
writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out).slice(0, 3000));
