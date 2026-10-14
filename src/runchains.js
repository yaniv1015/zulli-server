// Test run of the real pipeline for some chains, written to data/diag.json (report) and /tmp (summary).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
mkdirSync('data', { recursive: true });
const chains = process.env.CHAINS || 'tivtaam,keshet,stopmarket,freshmarket,polizer,dabach,doralon,kingstore,maayan,shefa,supersapir,shukhayir,zolbegadol,bareket,goodpharm,citymarket,meshnat,wolt';
const child = spawn('node', ['src/fetch.js', `--chains=${chains}`], { env: { ...process.env, SUMMARY_PATH: '/tmp/summary.json', REPORT_PATH: 'data/diag.json', CHAIN_MINUTES: '8' }, stdio: 'inherit' });
await new Promise((r) => child.on('exit', r));
try { const s = JSON.parse(readFileSync('/tmp/summary.json', 'utf8')); const d = JSON.parse(readFileSync('data/diag.json', 'utf8'));
  d.summary = { products: Object.keys(s.products).length, bytes: readFileSync('/tmp/summary.json').length, stores: Object.fromEntries(Object.entries(s.stores).map(([k, v]) => [k, v.length])) };
  writeFileSync('data/diag.json', JSON.stringify(d, null, 1)); writeFileSync('data/new.json', readFileSync('/tmp/summary.json')); } catch (e) { console.log('no summary', e.message); }
