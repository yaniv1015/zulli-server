// The app is the same single page as the Claude artifact (app/zul-li.html). In the phone app its data files
// (prices, branches, deals, photos) come from GitHub Pages, so relative paths resolve there through <base>.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const DATA = process.env.DATA_URL || 'https://yaniv1015.github.io/zulli-server/';
const body = await readFile(new URL('../app/zul-li.html', import.meta.url), 'utf8');
const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<base href="${DATA}">
<meta name="theme-color" content="#1530C8">
</head><body>${body}</body></html>`;
await mkdir(new URL('./www/', import.meta.url), { recursive: true });
await writeFile(new URL('./www/index.html', import.meta.url), html);
console.log('www/index.html', html.length, 'bytes, data from', DATA);
