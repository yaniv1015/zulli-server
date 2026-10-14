// Read the open-source il-supermarket-scraper package (PyPI) to learn each chain's portal and user name.
// Writes data/diag.json: { file: { classLine, lines with urls / user names / chain ids } }.
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const meta = await (await fetch('https://pypi.org/pypi/il-supermarket-scraper/json')).json();
const sdist = meta.urls.find((u) => u.packagetype === 'sdist') || meta.urls[0];
const buf = Buffer.from(await (await fetch(sdist.url)).arrayBuffer());
mkdirSync('/tmp/lib', { recursive: true }); writeFileSync('/tmp/lib/pkg' + (sdist.filename.endsWith('.whl') ? '.zip' : '.tgz'), buf);
execSync(sdist.filename.endsWith('.whl') ? 'cd /tmp/lib && unzip -q -o pkg.zip' : 'cd /tmp/lib && tar xzf pkg.tgz');
const find = execSync('find /tmp/lib -path "*scrappers*" -name "*.py"').toString().trim().split('\n');
const out = { version: meta.info.version, files: {} };
for (const f of find) {
  const src = readFileSync(f, 'utf8'); const name = f.split('/').pop();
  out.files[name] = src.split('\n').filter((l) => /class |username|user_name|url|chain_id|http|folder_name|DumpFolderNames|super\(\)|__init__\(/i.test(l)).map((l) => l.trim()).slice(0, 25);
}
const eng = execSync('find /tmp/lib -path "*engines*" -name "*.py"').toString().trim().split('\n');
out.engines = Object.fromEntries(eng.map((f) => [f.split('/').pop(), readFileSync(f, 'utf8').split('\n').filter((l) => /http|url|class /i.test(l)).map((l) => l.trim()).slice(0, 20)]));
mkdirSync('data', { recursive: true });
writeFileSync('data/diag.json', JSON.stringify(out, null, 1));
console.log(Object.keys(out.files).join(' '));
