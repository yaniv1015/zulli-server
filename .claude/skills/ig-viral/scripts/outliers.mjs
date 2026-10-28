#!/usr/bin/env node
// Ranks posts by views ÷ the account's median views.
// Usage: node outliers.mjs <file.csv> [--min 3] [--top 10]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : Number(args[i + 1]);
};
const min = opt('min', 3);
const top = opt('top', 10);

if (!file) {
  console.error('Usage: node outliers.mjs <file.csv> [--min 3] [--top 10]');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

function toNumber(v) {
  const m = String(v ?? '').trim().replace(/,/g, '').match(/^([\d.]+)\s*([kKmM])?$/);
  if (!m) return NaN;
  return Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2]?.toLowerCase()] ?? 1);
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const [header, ...lines] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const cols = header.map((h) => h.trim().toLowerCase());
for (const req of ['account', 'views']) {
  if (!cols.includes(req)) {
    console.error(`Missing required column: ${req}`);
    process.exit(1);
  }
}

const posts = lines
  .map((l) => Object.fromEntries(cols.map((c, i) => [c, (l[i] ?? '').trim()])))
  .map((p) => ({ ...p, views: toNumber(p.views) }))
  .filter((p) => p.account && Number.isFinite(p.views));

const byAccount = Map.groupBy(posts, (p) => p.account);
const accounts = [...byAccount].map(([account, list]) => ({
  account,
  posts: list.length,
  medianViews: median(list.map((p) => p.views)),
  lowSample: list.length < 10,
}));
const medians = new Map(accounts.map((a) => [a.account, a.medianViews]));

const outliers = posts
  .map((p) => ({ ...p, multiplier: Math.round((p.views / medians.get(p.account)) * 10) / 10 }))
  .filter((p) => Number.isFinite(p.multiplier) && p.multiplier >= min)
  .sort((a, b) => b.multiplier - a.multiplier)
  .slice(0, top);

console.log(JSON.stringify({ totalPosts: posts.length, threshold: min, accounts, outliers }, null, 2));
