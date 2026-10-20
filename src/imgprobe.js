// Diagnostic: which image sizes the Rami Levy image server has for a few barcodes → data/diag.json
import { mkdir, writeFile } from 'node:fs/promises';
const codes = (process.env.CODES || '7290112002136,7290000066318,7290011194246').split(',');
const sizes = ['small', 'medium', 'large', 'original', 'big', 'xl'];
const out = {};
function jpegSize(b){let i=2;while(i<b.length){if(b[i]!==0xFF)return null;const m=b[i+1];const len=b.readUInt16BE(i+2);if(m>=0xC0&&m<=0xC3)return `${b.readUInt16BE(i+7)}x${b.readUInt16BE(i+5)}`;i+=2+len}return null}
for (const bc of codes) for (const s of sizes) {
  const url = `https://img.rami-levy.co.il/product/${bc}/${s}.jpg`;
  try { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } }); const b = Buffer.from(await r.arrayBuffer());
    const dim = jpegSize(b);
    out[url] = { status: r.status, type: r.headers.get('content-type'), bytes: b.length, dim };
  } catch (e) { out[url] = { error: e.message }; }
}
await mkdir('data', { recursive: true }); await writeFile('data/diag.json', JSON.stringify(out, null, 1)); console.log(out);
