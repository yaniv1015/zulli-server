// After each price run: open (or update) a GitHub issue when something went wrong, and close it when all is well again.
// GitHub emails the repository owner about new issues and comments, so a silent failure does not leave old prices in the app.
// Usage (in the workflow): RUN_OUTCOME=<success|failure> node tools/health.js
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const KNOWN_BLOCKED = new Set(['victory']);          // blocks requests from outside Israel; not news
const LABEL = 'prices-alert';
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' }).trim();

const problems = [];
if (process.env.RUN_OUTCOME && process.env.RUN_OUTCOME !== 'success') problems.push(`שלב משיכת המחירים הסתיים ב-${process.env.RUN_OUTCOME}.`);
let report = null;
try { report = JSON.parse(readFileSync('data/report.json', 'utf8')); } catch { problems.push('לא נוצר קובץ דוח (data/report.json).'); }
if (report) {
  if (!report.finished) problems.push('הריצה לא הגיעה לסוף (אין זמן סיום בדוח).');
  for (const [key, r] of Object.entries(report.chains || {})) {
    if (KNOWN_BLOCKED.has(key) || r.splitFrom) continue;
    const errs = (r.errors || []).filter((e) => !/^[^:]+\.(xml|gz)(\.gz)?:/i.test(e)).slice(0, 2);   // a few bad files in a big chain are normal
    if (r.keptPrevious) problems.push(`${key}: חזרו פחות מוצרים מהרגיל (${r.keptPrevious.newProducts} במקום ${r.keptPrevious.prevProducts}), נשארו המחירים הקודמים.`);
    else if (!r.products) problems.push(`${key}: לא התקבלו מחירים. ${errs.join(' | ')}`.trim());
    else if (errs.some((e) => /time budget/.test(e))) problems.push(`${key}: נגמר הזמן לפני שכל הסניפים נקראו (${r.stores ?? '?'} סניפים).`);
  }
}

const run = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
let open = [];
try { open = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number')); } catch (e) { console.log('cannot list issues:', e.message); }
try { gh('label', 'create', LABEL, '--color', 'D93F0B', '--description', 'עדכון המחירים נכשל או חלקי'); } catch {}

if (problems.length) {
  const body = `בעיה בעדכון המחירים (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC):\n\n${problems.map((p) => '- ' + p).join('\n')}\n\nהריצה: ${run}`;
  if (open.length) gh('issue', 'comment', String(open[0].number), '--body', body);
  else gh('issue', 'create', '--title', 'עדכון המחירים: יש בעיה', '--label', LABEL, '--body', body);
  console.log('problems:\n' + problems.join('\n'));
} else {
  for (const i of open) gh('issue', 'close', String(i.number), '--comment', `העדכון חזר לעבוד כרגיל. ${run}`);
  console.log('all good');
}
