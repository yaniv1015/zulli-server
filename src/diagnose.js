// Checks which price portals answer from where this runs (GitHub's servers are outside Israel),
// and collects the official list of chain portals from gov.il. Writes data/diag.json.
import { mkdir, writeFile } from 'node:fs/promises';
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', accept: 'text/html,application/json,*/*' };
const urls = [
  'https://prices.shufersal.co.il/',
  'https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=0&page=1',
  'https://pricesprodpublic.blob.core.windows.net/',
  'https://laibcatalog.co.il/',
  'https://matrixcatalog.co.il/NBCompetitionRegulations.aspx',
  'https://prices.carrefour.co.il/',
  'https://publishprice.ybitan.co.il/',
  'https://url.publishedprices.co.il/login',
  'https://www.gov.il/he/departments/legalInfo/cpfta_prices_regulations',
];
const out = { at: new Date().toISOString(), checks: [], govLinks: [] };
for (const url of urls) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(90000) });
    const text = await res.text();
    out.checks.push({ url, status: res.status, ms: Date.now() - t, bytes: text.length, finalUrl: res.url, snippet: text.replace(/\s+/g, ' ').slice(0, 300) });
    if (url.includes('gov.il')) out.govLinks = [...new Set([...text.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((h) => !/gov\.il|google|facebook|twitter|youtube|whatsapp|linkedin/.test(h)))];
    if (url.includes('UpdateCategory')) out.shufersalLinks = [...text.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).slice(0, 5);
  } catch (e) {
    out.checks.push({ url, error: String(e.cause?.code || e.name || e.message), ms: Date.now() - t });
  }
}
await mkdir('data', { recursive: true });
await writeFile('data/diag.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.checks.map((c) => [c.url, c.status || c.error, c.ms])));
