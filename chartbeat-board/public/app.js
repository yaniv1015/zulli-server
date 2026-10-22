const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const n = (v) => (v == null ? '—' : fmt.format(Math.round(v)));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const COLORS = ['#5fd6e8', '#f2d65c', '#a9b4f5', '#7fe0a3', '#c0c9d6'];
const LABELS = {
  sources: { internal: 'פנימי', direct: 'ישיר', search: 'חיפוש', social: 'סושיאל', links: 'קישורים' },
  devices: { desktop: 'מחשב', mobile: 'מובייל' },
  readers: { returning: 'חוזרים', new: 'חדשים' },
};

let refreshMs = 15000;
let timer = null;
let last = null;
let prevPeople = new Map();

// ---------- שעון ----------
function tick() {
  $('clock').textContent = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
}
tick();
setInterval(tick, 1000);

// ---------- הסתרת דפי נחיתה ----------
try { $('hideLanding').checked = localStorage.getItem('hideLanding') !== '0'; } catch {}
$('hideLanding').addEventListener('change', (e) => {
  try { localStorage.setItem('hideLanding', e.target.checked ? '1' : '0'); } catch {}
  if (last) renderPages(last);
});

// ---------- ציור ----------
function animateNumber(el, to) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = to;
  if (from === to) { el.textContent = n(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 800);
    el.textContent = n(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function compare(el, now, then, label) {
  if (now == null || !then) { el.innerHTML = ''; return; }
  const pct = Math.round(((now - then) / then) * 100);
  const up = pct >= 0;
  el.className = 'cmp ' + (up ? 'up' : 'down');
  el.innerHTML = `${up ? '▲' : '▼'} ${Math.abs(pct)}% ${up ? 'יותר' : 'פחות'} ${label}<small>אותו יום ושעה: ${n(then)}</small>`;
}

function renderSplit(id, data) {
  const ul = $(id);
  if (!data) { ul.innerHTML = '<li>—</li>'; return; }
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  ul.innerHTML = Object.entries(LABELS[id])
    .map(([k, label], i) => `<li><span><i class="dot" style="background:${COLORS[i]}"></i>${label}</span>` +
      `<b>${Math.round(((data[k] ?? 0) / total) * 100)}%</b></li>`)
    .join('');
}

function renderPages(d) {
  const hide = $('hideLanding').checked;
  const rows = d.pages.filter((p) => !hide || !p.landing).slice(0, d.topLimit ?? 10);
  const host = d.host && !d.demo ? `https://${d.host}` : null;
  $('pages').innerHTML = rows
    .map((p, i) => {
      const fresh = prevPeople.has(p.path) && prevPeople.get(p.path) !== p.people ? ' class="fresh"' : '';
      const title = esc(p.title || p.path);
      const link = host ? `<a href="${esc(host + p.path)}" target="_blank" rel="noopener">${title}</a>` : title;
      return `<tr${fresh}><td>${i + 1}</td><td title="${title}">${link}</td><td>${n(p.people)}</td></tr>`;
    })
    .join('');
  prevPeople = new Map(d.pages.map((p) => [p.path, p.people]));
}

function render(d) {
  last = d;
  const [first, ...rest] = String(d.title || 'CHART BEET').split(' ');
  $('brand').innerHTML = esc(first) + (rest.length ? `<br><span>${esc(rest.join(' '))}</span>` : '');
  if (d.people != null) animateNumber($('people'), d.people);
  compare($('cmpWeek'), d.people, d.lastWeek, 'משבוע שעבר');
  compare($('cmp4w'), d.people, d.avg4w, 'מממוצע 4 שבועות');
  $('pageviews').textContent = n(d.pageviews);
  $('uniques').textContent = n(d.uniques);
  $('recirc').textContent = d.recircPct == null ? '—' : d.recircPct.toFixed(1) + '%';
  const s = d.engagedSeconds;
  $('engaged').textContent = s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  renderPages(d);
  renderSplit('sources', d.sources);
  renderSplit('devices', d.devices);
  renderSplit('readers', d.readers);

  const st = $('status');
  const time = new Date(d.updated).toLocaleTimeString('he-IL');
  if (d.errors?.length) {
    st.className = 'status err';
    st.textContent = `עודכן ${time} · חלק מהנתונים לא התקבלו: ${d.errors.join(' | ')}`;
  } else {
    st.className = 'status';
    st.textContent = d.demo
      ? (d.configured ? 'מצב הדגמה' : 'מצב הדגמה — לחצו על ⚙ כדי להזין מפתח Chartbeat')
      : `עודכן ${time} · ${d.host}`;
  }
}

// ---------- רענון ----------
async function load() {
  clearTimeout(timer);
  try {
    const res = await fetch('/api/dashboard', { cache: 'no-store' });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || res.status);
    render(d);
  } catch (e) {
    $('status').className = 'status err';
    $('status').textContent = 'אין חיבור לשרת: ' + e.message;
  }
  timer = setTimeout(load, refreshMs);
}

// ---------- הגדרות ----------
async function readConfig() {
  const cfg = await (await fetch('/api/config')).json();
  refreshMs = Math.max(5, Number(cfg.refreshSeconds) || 15) * 1000;
  return cfg;
}

$('openSettings').addEventListener('click', async () => {
  const cfg = await readConfig();
  const f = $('settingsForm');
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = Boolean(cfg[el.name]);
    else el.value = cfg[el.name] ?? '';
  }
  $('settings').showModal();
});

$('settings').addEventListener('close', async () => {
  if ($('settings').returnValue !== 'save') return;
  const f = $('settingsForm');
  const body = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    body[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
  }
  await fetch('/api/config', { method: 'POST', body: JSON.stringify(body) });
  await readConfig();
  load();
});

readConfig().catch(() => {}).finally(load);
