(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const B = () => window.StudioBoard;
const TODAY = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const VIEWS = [
  { id: 'all', label: 'Everything', icon: '◎' },
  { id: 'brands', label: 'Brands', icon: '✦' },
  { id: 'agencies', label: 'Agencies', icon: '◫' },
  { id: 'actions', label: 'Action list', icon: '↗' },
  { id: 'emails', label: 'Email log', icon: '✉' }
];
const BRAND_STATUSES = ["Awaiting Josh's reply", 'Awaiting their reply', 'In conversation', 'Deal signed', 'No reply', 'Went quiet', 'Declined by brand', 'Declined by Josh', 'Ignored'];
const AGENCY_STATUSES = ["Awaiting Josh's reply", 'Awaiting their reply', 'Active – deal done', 'On file – no brand yet', 'On file – offer declined', 'Went quiet', 'Ignored'];
const FILTERS = {
  all: [['all', 'All'], ['you', 'Waiting on you'], ['them', 'Waiting on them'], ['live', 'In conversation / on file'], ['won', 'Deals'], ['cold', 'No reply'], ['quiet', 'Went quiet'], ['lost', 'Declined / ignored']],
  brands: [['all', 'All'], ['you', 'Waiting on you'], ['them', 'Waiting on them'], ['live', 'In conversation'], ['won', 'Deals signed'], ['cold', 'No reply'], ['quiet', 'Went quiet'], ['lost', 'Declined / ignored']],
  agencies: [['all', 'All'], ['you', 'Waiting on you'], ['them', 'Waiting on them'], ['live', 'On file'], ['won', 'Deal done'], ['lost', 'Declined / ignored'], ['quiet', 'Went quiet']],
  actions: [['all', 'Open'], ['done', 'Completed']],
  emails: [['all', 'All'], ['unmatched', 'Unmatched'], ['in', 'Received'], ['out', 'Sent'], ['week', 'This week']]
};
const GROUP_ORDER = { you: 0, them: 1, live: 2, won: 3, cold: 4, quiet: 5, lost: 6, other: 7 };
const DEMO = {
  brands: [
    { id: 'demo-b1', name: 'MacroFactor', status: 'Deal signed', summary: 'Renewed: 6 videos, signed 22 Sep. Nov–Feb schedule being confirmed.', nextStep: 'Confirm rescheduled dates to Katie.', lastActivity: '2026-10-25', firstContact: '2026-09-11', via: 'Direct', contact: 'Katie\nGrowth Marketing Manager\nkatie@example.com', initiatedBy: 'Josh', category: 'Nutrition app', rate: '$36,000 for 6 videos (renewal)', agreedValue: 36000, history: '• 22 Sep: renewal signed\n• 11 Sep: Josh pitched the renewal' },
    { id: 'demo-b2', name: 'Yesoul Fitness — T5 MAX treadmill', status: 'Awaiting their reply', summary: 'Quoted $7.5k + free treadmill on 19 Oct; chased 22 Oct.', nextStep: 'Chase again if nothing by ~5 Nov.', lastActivity: '2026-10-22', firstContact: '2026-10-09', via: 'Direct', contact: 'Katherine\nMarketing Team\nkatherine@example.com', initiatedBy: 'Brand', category: 'Fitness equipment', rate: '$7,500 USD + treadmill supplied free', agreedValue: '', history: '• 22 Oct: Josh chased\n• 19 Oct: Josh quoted $7.5k\n• 9 Oct: Katherine asked for rates + media kit' },
    { id: 'demo-b3', name: 'Garmin', status: 'No reply', summary: 'Pitch went to the media-only inbox — auto-reply says sponsorships go through the web form.', nextStep: 'Re-submit via the sponsorship web form.', lastActivity: '2026-10-26', firstContact: '2026-10-26', via: 'Direct', contact: 'media@example.com', initiatedBy: 'Josh', category: 'Wearables', rate: '', agreedValue: '', history: '• 26 Oct: pitch → auto-reply' },
    { id: 'demo-b4', name: 'Filmora 15 (verify sender)', status: "Awaiting Josh's reply", summary: 'Paid collab offer — but sent from an unofficial-looking domain.', nextStep: 'Verify the sender before replying.', lastActivity: '2026-10-31', firstContact: '2026-10-31', via: 'Direct (unverified)', contact: 'contact@example.com', initiatedBy: 'Brand', category: 'Tech / software', rate: 'Guaranteed payment + free licence', agreedValue: '', history: '• 31 Oct: single pitch' }
  ],
  agencies: [
    { id: 'demo-a1', name: 'Verda Talent', status: 'Active – deal done', summary: 'Delivered ExpressVPN ($4k + rev share); previously Incogni.', lastActivity: '2026-10-29', firstContact: '2026-08-07', contact: 'Chris\nDirector\nchris@example.com', type: 'Sponsorship agency', terms: 'Brought ExpressVPN at $4,000 flat + 20% rev share', brands: 'ExpressVPN (signed); Incogni (previous)', history: '• 29 Oct: campaign live' },
    { id: 'demo-a2', name: 'Peak Partners', status: "Awaiting Josh's reply", summary: 'Whatnot, Shokz, Away (prospective). Chased 2 Nov.', lastActivity: '2026-11-02', firstContact: '2026-11-01', contact: 'Abdullah\nabdullah@example.com', type: 'Sponsorship agency', terms: '', brands: 'Whatnot, Shokz, Away (prospective)', history: '• 2 Nov: chaser\n• 1 Nov: pitch' }
  ],
  actions: [
    { row: 5, priority: 'High', who: 'MacroFactor', what: 'Confirm rescheduled dates to Katie', why: 'Nov–Feb schedule moved.', lastWrote: '2026-10-25', daysWaiting: 8, done: 'No', tab: 'Brands' },
    { row: 6, priority: 'Medium', who: 'Yesoul', what: 'Chase if nothing by ~5 Nov', why: 'Quoted $7.5k + free treadmill; chased once on 22 Oct.', lastWrote: '2026-10-22', daysWaiting: 11, done: 'No', tab: 'Brands' }
  ],
  completed: [{ row: 15, who: 'Shokz', what: 'Invoice sent', date: '2026-11-02' }],
  emails: [
    { date: '2026-11-02T09:12:00Z', direction: 'in', matchedTo: 'Peak Partners', tab: 'agencies', recordId: 'demo-a2', from: 'Abdullah <abdullah@example.com>', to: 'josh', subject: 'Re: Peak Partners x Josh Brett', snippet: 'Just following up on my note from yesterday…', messageId: 'demo-m1', threadId: 't1', folder: 'Inbox', matchedBy: 'address' },
    { date: '2026-10-25T16:40:00Z', direction: 'out', matchedTo: 'MacroFactor', tab: 'brands', recordId: 'demo-b1', from: 'Josh', to: 'katie@example.com', subject: 'Re: MacroFactor x Josh Brett — Nov–Feb schedule', snippet: 'Here are the dates that work on our side…', messageId: 'demo-m2', threadId: 't2', folder: 'Sent', matchedBy: 'address' },
    { date: '2026-10-24T11:05:00Z', direction: 'in', matchedTo: '', tab: 'unmatched', recordId: '', from: 'Redouan <redouan@example.com>', to: 'josh', subject: 'Sponsorship opportunity — Primalfluence', snippet: 'We put creators forward to brands like…', messageId: 'demo-m3', threadId: 't3', folder: 'Inbox', matchedBy: 'keyword' }
  ]
};
const s = { brands: [], agencies: [], actions: [], completed: [], emails: [], sheetUrl: '', sync: {}, view: 'all', filter: 'all', search: '', sort: { key: '', dir: 1 }, loaded: false, busy: false, demo: true, selected: null, zoho: null };

const connected = () => { const b = B()?.getState(); return Boolean(b && b.mode === 'notion'); };
function notice(text, error = false) { const el = $('sponsorNotice'); el.hidden = !text; el.textContent = text; el.classList.toggle('error', error); }
const toast = m => B()?.toast(m);
async function api(payload) {
  const board = B()?.getState();
  if (!board || board.mode !== 'notion') throw Error('Connect your workspace (top right) to use the shared sponsorship tracker.');
  const resp = await fetch('/.netlify/functions/sponsorships', { method: 'POST', headers: { 'content-type': 'application/json', 'x-board-key': board.code }, body: JSON.stringify(payload), cache: 'no-store' });
  const text = await resp.text(); let data; try { data = JSON.parse(text); } catch { throw Error(resp.status === 502 || resp.status === 504 ? 'The server took too long — press Sync emails again; each run picks up where the last stopped.' : 'Sponsorships server returned an unexpected response.'); }
  if (!resp.ok || data.ok === false) throw Error(data.error || 'Sponsorships request failed.');
  return data;
}
function applyPayload(data) {
  s.brands = data.brands || []; s.agencies = data.agencies || []; s.actions = data.actions || []; s.completed = data.completed || [];
  s.emails = data.emails || []; s.sheetUrl = data.sheetUrl || ''; s.sync = data.sync || {};
  s.loaded = true; render();
}
function loadDemo() { s.demo = true; applyPayload({ ...DEMO, sheetUrl: '', sync: {} }); }
async function refresh(quiet = false) {
  if (!connected()) { loadDemo(); notice('Local demo — sample rows. Connect your workspace to load the shared tracker.'); return; }
  if (s.busy) return; s.busy = true; $('sponsorRefresh').disabled = true;
  if (!quiet) notice('Loading the sponsorship tracker from Google Sheets…');
  try { const r = await api({ action: 'sponsorList' }); s.demo = false; applyPayload(r); notice(''); $('sponsorSetupHelp').hidden = true; }
  catch (e) {
    notice(e.message, true);
    const needsSetup = /not configured|readme|apps script|sheet not found|sponsorships\.gs|unexpected response/i.test(e.message);
    $('sponsorSetupHelp').hidden = !needsSetup;
    if (!s.loaded) loadDemo();
  } finally { s.busy = false; $('sponsorRefresh').disabled = false; }
}

/* ---------- derived data ---------- */
const days = iso => { if (!iso) return null; const d = new Date(iso + 'T12:00:00'); if (Number.isNaN(d.getTime())) return null; return Math.floor((new Date(TODAY() + 'T12:00:00').getTime() - d.getTime()) / 86400000); };
const fmtDate = iso => iso ? new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
const fmtDateTime = iso => { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso; return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
const money = n => (n === '' || n == null || Number.isNaN(Number(n))) ? '' : '$' + Number(n).toLocaleString('en-US');
function group(status) {
  const t = String(status || '').toLowerCase();
  if (t.includes("josh's reply") || t.includes('josh reply') || t.includes('waiting on you')) return 'you';
  if (t.includes('their reply') || t.includes('waiting on them')) return 'them';
  if (t.includes('signed') || t.includes('deal done') || t.includes('active')) return 'won';
  if (t.includes('declined') || t.includes('passed') || t.includes('lost') || t.includes('ignored')) return 'lost';
  if (t.includes('no reply')) return 'cold';
  if (t.includes('quiet')) return 'quiet';
  if (t.includes('conversation') || t.includes('on file') || t.includes('negotiat')) return 'live';
  return 'other';
}
const ADDR = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g;
const addressesIn = text => String(text || '').toLowerCase().match(ADDR) || [];
/* Emails for a record: matched to it by the sync, or to/from any address in its Contact column (an agency contact listed under a brand, say). */
function emailsFor(tab, record) {
  const addrs = new Set(addressesIn(record.contact));
  return s.emails.filter(e => (e.tab === tab && e.recordId === record.id) || (addrs.size && addressesIn(e.from + ' ' + e.to).some(a => addrs.has(a))));
}
function lastEmails() {
  const map = {};
  ['brands', 'agencies'].forEach(tab => records(tab).forEach(r => { const list = emailsFor(tab, r); if (list.length) map[tab + '|' + r.id] = list.reduce((a, b) => (b.date > a.date ? b : a)); }));
  return map;
}
function records(tab) { return tab === 'agencies' ? s.agencies : tab === 'all' ? [...s.brands.map(r => ({ ...r, tab: 'brands' })), ...s.agencies.map(r => ({ ...r, tab: 'agencies' }))] : s.brands; }
const isRecordView = () => s.view === 'brands' || s.view === 'agencies' || s.view === 'all';
function weekAgoIso() { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); }

function filtered() {
  const q = s.search.toLowerCase();
  if (s.view === 'actions') {
    const list = s.filter === 'done' ? s.completed.map(c => ({ ...c, completed: true })) : s.actions;
    return list.filter(a => !q || [a.who, a.what, a.why, a.priority].join(' ').toLowerCase().includes(q));
  }
  if (s.view === 'emails') {
    return s.emails.filter(e => (s.filter === 'all' || (s.filter === 'unmatched' && e.tab === 'unmatched') || (s.filter === 'in' && e.direction === 'in') || (s.filter === 'out' && e.direction === 'out') || (s.filter === 'week' && e.date >= weekAgoIso())) &&
      (!q || [e.matchedTo, e.from, e.to, e.subject, e.snippet].join(' ').toLowerCase().includes(q)));
  }
  const last = lastEmails();
  return records(s.view).map(r => ({ ...r, group: group(r.status), days: days(r.lastActivity), last: last[(r.tab || s.view) + '|' + r.id] || null }))
    .filter(r => (s.filter === 'all' || r.group === s.filter) && (!q || [r.name, r.status, r.summary, r.nextStep, r.via, r.contact, r.category, r.rate, r.terms, r.brands, r.type, r.history].join(' ').toLowerCase().includes(q)));
}
function sorted(list) {
  const key = s.sort.key, dir = s.sort.dir;
  const attention = (a, b) => (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9) || (b.days ?? -1) - (a.days ?? -1) || a.name.localeCompare(b.name);
  if (s.view === 'actions') { const p = { high: 0, medium: 1, low: 2 }; return list.slice().sort((a, b) => key ? cmp(a, b, key, dir) : ((p[String(a.priority).toLowerCase()] ?? 3) - (p[String(b.priority).toLowerCase()] ?? 3) || (b.daysWaiting || 0) - (a.daysWaiting || 0))); }
  if (s.view === 'emails') return list.slice().sort((a, b) => key ? cmp(a, b, key, dir) : b.date.localeCompare(a.date));
  return list.slice().sort((a, b) => key ? cmp(a, b, key, dir) : attention(a, b));
}
function cmp(a, b, key, dir) {
  const va = key === 'last' ? (a.last?.date || '') : key === 'agreedValue' ? Number(a.agreedValue || 0) : (a[key] ?? '');
  const vb = key === 'last' ? (b.last?.date || '') : key === 'agreedValue' ? Number(b.agreedValue || 0) : (b[key] ?? '');
  if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
  return String(va).localeCompare(String(vb), 'en', { numeric: true, sensitivity: 'base' }) * dir;
}

/* ---------- rendering ---------- */
const pill = status => `<span class="sponsor-pill sponsor-pill-${group(status)}">${esc(status || '—')}</span>`;
function lastChip(r) {
  if (!r.last) return '<span class="sponsor-last none">No emails logged</span>';
  const d = days(r.last.date.slice(0, 10));
  const who = r.last.direction === 'in' ? 'They wrote' : 'You wrote';
  const warn = r.last.direction === 'in' && r.group !== 'won' && r.group !== 'lost';
  return `<span class="sponsor-last ${r.last.direction}${warn ? ' warn' : ''}" title="${esc(r.last.subject)}">${r.last.direction === 'in' ? '↙' : '↗'} ${who} · ${d === 0 ? 'today' : d + 'd ago'}</span>`;
}
function daysBadge(r) { if (r.days == null) return '<span class="sponsor-days muted">—</span>'; const hot = r.group === 'you' && r.days >= 3; return `<span class="sponsor-days${hot ? ' hot' : ''}">${r.days}d</span>`; }
function th(label, key, cls = '') { const active = s.sort.key === key; return `<th class="${cls}"><button type="button" class="sponsor-sort${active ? ' active' : ''}" data-sort="${esc(key)}">${esc(label)}<span>${active ? (s.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</span></button></th>`; }
const tp = label => `<th><span class="sponsor-th">${esc(label)}</span></th>`;
const clamp = (text, n = 140) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function renderStats() {
  const all = [...s.brands.map(r => ({ ...r, g: group(r.status) })), ...s.agencies.map(r => ({ ...r, g: group(r.status) }))];
  const brandsWon = s.brands.filter(r => group(r.status) === 'won');
  const value = brandsWon.reduce((n, r) => n + (Number(r.agreedValue) || 0), 0);
  const split = g => { const b = s.brands.filter(r => group(r.status) === g).length, a = s.agencies.filter(r => group(r.status) === g).length; return { n: b + a, sub: `${b} brand${b === 1 ? '' : 's'} · ${a} agenc${a === 1 ? 'y' : 'ies'}` }; };
  const you = split('you'), them = split('them'), cold = s.brands.filter(r => group(r.status) === 'cold').length;
  const week = s.emails.filter(e => e.date >= weekAgoIso()).length, unmatched = s.emails.filter(e => e.tab === 'unmatched').length;
  const synced = s.sync?.lastRun?.at ? 'Synced ' + fmtDateTime(s.sync.lastRun.at) : (s.demo ? 'Sample data' : 'Not synced yet');
  const tiles = [
    { n: brandsWon.length, label: 'deals signed', sub: value ? money(value) + ' agreed' : 'no value recorded', cls: 'won', f: 'won', v: 'brands' },
    { n: you.n, label: 'waiting on you', sub: you.sub, cls: 'you', f: 'you', v: 'all' },
    { n: them.n, label: 'waiting on them', sub: them.sub, cls: 'them', f: 'them', v: 'all' },
    { n: cold, label: 'cold pitches, no reply', sub: 'follow up or drop', cls: 'cold', f: 'cold', v: 'brands' },
    { n: week, label: 'emails this week', sub: (unmatched ? unmatched + ' unmatched · ' : '') + synced, cls: 'mail', f: 'week', v: 'emails' }
  ];
  $('sponsorStats').innerHTML = tiles.map(t => `<button type="button" class="sponsor-stat sponsor-stat-${t.cls}" data-stat-view="${t.v}" data-stat-filter="${t.f}"><b>${t.n}</b><span>${esc(t.label)}</span><small>${esc(t.sub)}</small></button>`).join('');
}
function renderTools() {
  $('sponsorViews').innerHTML = VIEWS.map(v => { const count = v.id === 'actions' ? s.actions.length : v.id === 'emails' ? s.emails.length : records(v.id).length; return `<button type="button" class="tab" data-sponsor-view="${v.id}" aria-pressed="${v.id === s.view}">${v.icon} ${v.label} <span class="tab-count">${count}</span></button>`; }).join('');
  const countFor = id => isRecordView() ? (id === 'all' ? records(s.view).length : records(s.view).filter(r => group(r.status) === id).length) : null;
  $('sponsorFilters').innerHTML = FILTERS[s.view].map(([id, label]) => { const n = countFor(id); return `<button type="button" class="tab sponsor-filter" data-sponsor-filter="${id}" aria-pressed="${id === s.filter}">${esc(label)}${n == null ? '' : ` <span class="tab-count">${n}</span>`}</button>`; }).join('');
  $('sponsorAddBtn').innerHTML = s.view === 'agencies' ? '＋ Add agency' : '＋ Add brand';
  $('sponsorAddBtn').hidden = !isRecordView();
  const link = $('sponsorSheetLink'); link.hidden = !s.sheetUrl; if (s.sheetUrl) link.href = s.sheetUrl;
}
function renderTable() {
  const list = sorted(filtered());
  const table = $('sponsorTable');
  $('sponsorMeta').textContent = list.length + ' ' + (s.view === 'actions' ? (s.filter === 'done' ? 'completed' : 'open') + ' action' + (list.length === 1 ? '' : 's') : s.view === 'emails' ? 'email' + (list.length === 1 ? '' : 's') : s.view === 'all' ? (list.length === 1 ? 'brand or agency' : 'brands and agencies') : (s.view === 'brands' ? 'brand' : 'agenc') + (list.length === 1 ? (s.view === 'brands' ? '' : 'y') : (s.view === 'brands' ? 's' : 'ies'))) + (s.sort.key ? '' : isRecordView() ? ' · most attention needed first' : s.view === 'emails' ? ' · newest first' : ' · by priority');
  if (!list.length) { table.innerHTML = `<tbody><tr><td class="sponsor-empty">${s.view === 'emails' && !s.emails.length ? 'No emails logged yet. Connect Zoho Mail and press Sync emails, or log one from a brand.' : 'Nothing matches this view.'}</td></tr></tbody>`; return; }
  if (s.view === 'all') {
    table.innerHTML = `<thead><tr>${th('Name', 'name')}${th('Type', 'tab')}${th('Status', 'status')}${tp("What's happening")}${tp('Next step')}${th('Last activity', 'lastActivity', 'num')}${th('Last email', 'last')}${th('Via / type', 'via')}</tr></thead><tbody>` +
      list.map(r => `<tr data-open="${esc(r.tab)}" data-id="${esc(r.id)}" tabindex="0"><td class="sponsor-name"><strong>${esc(r.name)}</strong><small>${esc(r.tab === 'brands' ? (r.category || '') : (r.type || ''))}</small></td><td><span class="sponsor-kind ${esc(r.tab)}">${r.tab === 'brands' ? '✦ Brand' : '◫ Agency'}</span></td><td>${pill(r.status)}</td><td class="sponsor-text">${esc(clamp(r.summary))}</td><td class="sponsor-text">${esc(clamp(r.tab === 'brands' ? r.nextStep : r.brands, 110))}</td><td class="num"><span class="sponsor-date">${esc(fmtDate(r.lastActivity))}</span>${daysBadge(r)}</td><td>${lastChip(r)}</td><td class="sponsor-text">${esc(clamp(r.tab === 'brands' ? r.via : r.terms, 60))}</td></tr>`).join('') + '</tbody>';
  } else if (s.view === 'brands') {
    table.innerHTML = `<thead><tr>${th('Brand', 'name')}${th('Status', 'status')}${tp("What's happening")}${tp("Next step")}${th('Last activity', 'lastActivity', 'num')}${th('Last email', 'last')}${th('Via', 'via')}${th('Rate / value', 'agreedValue')}</tr></thead><tbody>` +
      list.map(r => `<tr data-open="brands" data-id="${esc(r.id)}" tabindex="0"><td class="sponsor-name"><strong>${esc(r.name)}</strong><small>${esc(r.category || '')}${r.initiatedBy ? (r.category ? ' · ' : '') + 'via ' + esc(r.initiatedBy.toLowerCase() === 'josh' ? 'your pitch' : r.initiatedBy.toLowerCase()) : ''}</small></td><td>${pill(r.status)}</td><td class="sponsor-text">${esc(clamp(r.summary))}</td><td class="sponsor-text">${esc(clamp(r.nextStep, 110))}</td><td class="num"><span class="sponsor-date">${esc(fmtDate(r.lastActivity))}</span>${daysBadge(r)}</td><td>${lastChip(r)}</td><td class="sponsor-text">${esc(clamp(r.via, 40))}</td><td class="sponsor-text">${r.agreedValue !== '' && r.agreedValue != null && !String(r.rate || '').includes(money(r.agreedValue)) ? '<strong>' + esc(money(r.agreedValue)) + '</strong> ' : ''}${esc(clamp(r.rate, 70))}</td></tr>`).join('') + '</tbody>';
  } else if (s.view === 'agencies') {
    table.innerHTML = `<thead><tr>${th('Agency / network', 'name')}${th('Status', 'status')}${tp("Where it stands")}${th('Last activity', 'lastActivity', 'num')}${th('Last email', 'last')}${th('Type', 'type')}${tp("Terms / rate on file")}${tp("Brands brought")}</tr></thead><tbody>` +
      list.map(r => `<tr data-open="agencies" data-id="${esc(r.id)}" tabindex="0"><td class="sponsor-name"><strong>${esc(r.name)}</strong></td><td>${pill(r.status)}</td><td class="sponsor-text">${esc(clamp(r.summary))}</td><td class="num"><span class="sponsor-date">${esc(fmtDate(r.lastActivity))}</span>${daysBadge(r)}</td><td>${lastChip(r)}</td><td class="sponsor-text">${esc(clamp(r.type, 40))}</td><td class="sponsor-text">${esc(clamp(r.terms, 90))}</td><td class="sponsor-text">${esc(clamp(r.brands, 90))}</td></tr>`).join('') + '</tbody>';
  } else if (s.view === 'actions') {
    const done = s.filter === 'done';
    table.innerHTML = `<thead><tr>${done ? tp('Who') + tp('What was done') + th('Date', 'date', 'num') : th('Priority', 'priority') + th('Who', 'who') + tp('What to do') + tp('Why / context') + th('They last wrote', 'lastWrote', 'num') + th('Waiting', 'daysWaiting', 'num') + tp('Done')}</tr></thead><tbody>` +
      list.map(a => done ? `<tr><td class="sponsor-name"><strong>${esc(a.who)}</strong></td><td class="sponsor-text">${esc(a.what)}</td><td class="num"><span class="sponsor-date">${esc(fmtDate(a.date))}</span></td></tr>`
        : `<tr class="${String(a.done).toLowerCase() === 'yes' ? 'is-done' : ''}"><td><span class="sponsor-priority ${esc(String(a.priority).toLowerCase())}">${esc(a.priority)}</span></td><td class="sponsor-name"><strong>${esc(a.who)}</strong><small>${esc(a.tab || '')}</small></td><td class="sponsor-text"><strong>${esc(a.what)}</strong></td><td class="sponsor-text">${esc(clamp(a.why, 160))}</td><td class="num"><span class="sponsor-date">${esc(fmtDate(a.lastWrote))}</span></td><td class="num">${a.daysWaiting === '' || a.daysWaiting == null ? '—' : esc(a.daysWaiting) + 'd'}</td><td><label class="sponsor-check"><input type="checkbox" data-action-row="${a.row}" data-action-what="${esc(a.what)}" ${String(a.done).toLowerCase() === 'yes' ? 'checked' : ''}> ${String(a.done).toLowerCase() === 'yes' ? 'Done' : 'Mark done'}</label></td></tr>`).join('') + '</tbody>';
  } else {
    const options = `<option value="">Assign to…</option><optgroup label="Brands">${s.brands.map(r => `<option value="brands|${esc(r.id)}">${esc(r.name)}</option>`).join('')}</optgroup><optgroup label="Agencies">${s.agencies.map(r => `<option value="agencies|${esc(r.id)}">${esc(r.name)}</option>`).join('')}</optgroup>`;
    table.innerHTML = `<thead><tr>${th('Date', 'date', 'num')}<th></th>${th('Matched to', 'matchedTo')}${th('From / to', 'from')}${th('Subject', 'subject')}${tp("Snippet")}</tr></thead><tbody>` +
      list.map(e => { const unmatched = e.tab === 'unmatched' || !e.recordId; return `<tr class="${unmatched ? 'is-unmatched' : ''}" ${unmatched ? '' : `data-open="${esc(e.tab)}" data-id="${esc(e.recordId)}" tabindex="0"`}><td class="num"><span class="sponsor-date">${esc(fmtDateTime(e.date))}</span></td><td><span class="sponsor-dir ${esc(e.direction)}" title="${e.direction === 'in' ? 'Received' : 'Sent'}">${e.direction === 'in' ? '↙' : '↗'}</span></td><td class="sponsor-name">${unmatched ? `<select class="sponsor-assign" data-message="${esc(e.messageId)}" data-contact="${esc(((e.direction === 'in' ? e.from : e.to) || '').match(/[^\s<>",]+@[^\s<>",]+/)?.[0] || '')}">${options}</select>` : `<strong>${esc(e.matchedTo)}</strong><small>${esc(e.matchedBy === 'manual' ? 'logged by hand' : 'matched by ' + e.matchedBy)}</small>`}</td><td class="sponsor-text">${esc(clamp(e.direction === 'in' ? e.from : e.to, 60))}</td><td class="sponsor-text"><strong>${esc(clamp(e.subject, 90))}</strong></td><td class="sponsor-text sponsor-snippet">${esc(clamp(e.snippet, 120))}</td></tr>`; }).join('') + '</tbody>';
  }
}
function render() { renderStats(); renderTools(); renderTable(); }

/* ---------- drawer ---------- */
function openRecord(tab, id) {
  const record = id ? records(tab).find(r => r.id === id) : null;
  if (id && !record) { toast('Not found. Try refreshing.'); return; }
  s.selected = { tab, id };
  const brand = tab === 'brands';
  $('sponsorDrawerOverline').textContent = brand ? '/ THE DEAL' : '/ THE INTERMEDIARY';
  $('sponsorDrawerTitle').textContent = record ? record.name + '.' : (brand ? 'New brand.' : 'New agency.');
  $('sponsorDrawerMeta').textContent = record ? [record.status, record.lastActivity ? 'last activity ' + fmtDate(record.lastActivity) : '', record.firstContact ? 'first contact ' + fmtDate(record.firstContact) : ''].filter(Boolean).join(' · ') : 'Saved straight to the Google Sheet.';
  $('sponsorId').value = id || ''; $('sponsorTab').value = tab;
  // Every known status, plus any custom ones already used in the sheet, plus this row's own value if it is something else.
  const known = brand ? BRAND_STATUSES : AGENCY_STATUSES;
  const inUse = [...new Set(records(tab).map(r => r.status).filter(Boolean))].filter(x => !known.includes(x));
  const statuses = [...known, ...inUse];
  if (record?.status && !statuses.includes(record.status)) statuses.push(record.status);
  $('sponsorStatus').innerHTML = statuses.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  document.querySelectorAll('#sponsorOverlay [data-brand-only]').forEach(el => { el.hidden = !brand; });
  document.querySelectorAll('#sponsorOverlay [data-agency-only]').forEach(el => { el.hidden = brand; });
  const f = { name: 'sponsorName', status: 'sponsorStatus', lastActivity: 'sponsorLastActivity', summary: 'sponsorSummary', nextStep: 'sponsorNextStep', firstContact: 'sponsorFirstContact', initiatedBy: 'sponsorInitiatedBy', type: 'sponsorType', via: 'sponsorVia', category: 'sponsorCategory', rate: 'sponsorRate', agreedValue: 'sponsorAgreedValue', terms: 'sponsorTerms', brands: 'sponsorBrands', contact: 'sponsorContact', history: 'sponsorHistory' };
  Object.entries(f).forEach(([key, el]) => { $(el).value = record ? (record[key] ?? '') : (key === 'lastActivity' || key === 'firstContact' ? TODAY() : key === 'status' ? (brand ? 'In conversation' : "Awaiting Josh's reply") : ''); });
  $('sponsorNoteBlock').hidden = !record; $('sponsorEmailsBlock').hidden = !record;
  $('sponsorNoteDate').value = TODAY(); $('sponsorNoteText').value = ''; $('sponsorSaveStatus').textContent = '';
  if (record) renderDrawerEmails(tab, id);
  $('sponsorOverlay').hidden = false; document.body.style.overflow = 'hidden';
  setTimeout(() => $(record ? 'sponsorStatus' : 'sponsorName').focus(), 30);
}
function renderDrawerEmails(tab, id) {
  const record = records(tab).find(r => r.id === id);
  const list = (record ? emailsFor(tab, record) : []).sort((a, b) => b.date.localeCompare(a.date));
  $('sponsorEmailCount').textContent = list.length;
  $('sponsorEmailList').innerHTML = list.length ? list.slice(0, 40).map(e => `<div class="comment sponsor-email ${esc(e.direction)}"><div class="comment-by"><strong>${e.direction === 'in' ? '↙ ' + esc(clamp(e.from, 60)) : '↗ To ' + esc(clamp(e.to, 60))}</strong><span>${esc(fmtDateTime(e.date))}</span></div><p><b>${esc(e.subject || '(no subject)')}</b>${e.snippet ? '<br>' + esc(clamp(e.snippet, 220)) : ''}</p></div>`).join('') : '<p class="comment-empty">No emails matched yet. They appear here after a Zoho sync, or when you log one above.</p>';
}
function closeRecord() { $('sponsorOverlay').hidden = true; s.selected = null; document.body.style.overflow = ''; }
function readForm() {
  const brand = $('sponsorTab').value === 'brands';
  const v = id => $(id).value.trim();
  const base = { name: v('sponsorName'), status: v('sponsorStatus'), summary: v('sponsorSummary'), lastActivity: $('sponsorLastActivity').value, firstContact: $('sponsorFirstContact').value, contact: v('sponsorContact'), history: v('sponsorHistory') };
  return brand ? { ...base, nextStep: v('sponsorNextStep'), via: v('sponsorVia'), initiatedBy: v('sponsorInitiatedBy'), category: v('sponsorCategory'), rate: v('sponsorRate'), agreedValue: $('sponsorAgreedValue').value === '' ? '' : Number($('sponsorAgreedValue').value) }
    : { ...base, type: v('sponsorType'), terms: v('sponsorTerms'), brands: v('sponsorBrands') };
}
async function saveRecord(e) {
  e.preventDefault(); if (s.busy) return;
  const tab = $('sponsorTab').value, id = $('sponsorId').value, patch = readForm();
  if (!patch.name) { toast('Give it a name.'); return; }
  if (!connected()) { toast('Local demo — connect your workspace to save to the sheet.'); return; }
  s.busy = true; $('sponsorSave').disabled = true; $('sponsorSaveStatus').textContent = 'Saving…';
  try { const data = await api(id ? { action: 'sponsorUpdate', tab, id, patch } : { action: 'sponsorAdd', tab, record: patch }); applyPayload(data); closeRecord(); toast(id ? 'Saved to Google Sheets.' : (tab === 'brands' ? 'Brand added.' : 'Agency added.')); }
  catch (err) { $('sponsorSaveStatus').textContent = 'Not saved: ' + err.message; }
  finally { s.busy = false; $('sponsorSave').disabled = false; }
}
async function addNote(e) {
  e.preventDefault(); if (s.busy || !s.selected?.id) return;
  const text = $('sponsorNoteText').value.trim(); if (!text) { toast('Write what happened first.'); return; }
  if (!connected()) { toast('Local demo — connect your workspace to log this.'); return; }
  s.busy = true; const btn = $('sponsorNoteForm').querySelector('button'); btn.disabled = true;
  try { const data = await api({ action: 'sponsorNote', tab: s.selected.tab, id: s.selected.id, text, date: $('sponsorNoteDate').value || TODAY(), direction: $('sponsorNoteDirection').value }); applyPayload(data); const r = records(s.selected.tab).find(x => x.id === s.selected.id); if (r) { $('sponsorHistory').value = r.history || ''; $('sponsorLastActivity').value = r.lastActivity || ''; renderDrawerEmails(s.selected.tab, s.selected.id); } $('sponsorNoteText').value = ''; toast('Added to the history.'); }
  catch (err) { toast('Not logged: ' + err.message); }
  finally { s.busy = false; btn.disabled = false; }
}
async function toggleAction(input) {
  if (!connected()) { input.checked = !input.checked; toast('Local demo — connect your workspace to update the action list.'); return; }
  input.disabled = true;
  try { const data = await api({ action: 'sponsorAction', row: Number(input.dataset.actionRow), what: input.dataset.actionWhat, done: input.checked }); applyPayload(data); toast(input.checked ? 'Marked done in the sheet.' : 'Reopened.'); }
  catch (err) { input.checked = !input.checked; input.disabled = false; toast('Not updated: ' + err.message); }
}
async function assignEmail(select) {
  const value = select.value; if (!value) return;
  if (!connected()) { select.value = ''; toast('Local demo — connect your workspace to assign emails.'); return; }
  const [tab, id] = value.split('|'); select.disabled = true;
  try { await api({ action: 'sponsorAssign', tab, id, messageId: select.dataset.message, saveContact: select.dataset.contact || '' }); toast('Email assigned. Future emails from that address will match automatically.'); await refresh(true); }
  catch (err) { select.disabled = false; select.value = ''; toast('Not assigned: ' + err.message); }
}

/* ---------- Zoho Mail ---------- */
async function openZoho() {
  $('zohoOverlay').hidden = false; document.body.style.overflow = 'hidden';
  $('zohoBody').innerHTML = '<p class="zoho-copy">Checking the connection…</p>';
  if (!connected()) { renderZoho({ configured: false, missing: ['workspace'], demo: true }); return; }
  try { s.zoho = await api({ action: 'zohoStatus' }); } catch (err) { s.zoho = { configured: false, error: err.message }; }
  renderZoho(s.zoho);
}
function closeZoho() { $('zohoOverlay').hidden = true; document.body.style.overflow = ''; }
function renderZoho(z) {
  $('zohoSticker').textContent = z.configured ? '● CONNECTED — HOURLY SYNC' : '● NOT CONNECTED';
  $('zohoSticker').classList.toggle('on', Boolean(z.configured));
  const readme = '<a href="https://github.com/BrettJosh/Conditioning-Team/blob/main/README.md#sponsorships-tab-brand-deals-with-a-live-email-log-from-zoho-mail" target="_blank" rel="noopener noreferrer">the README steps</a>';
  if (z.demo) { $('zohoBody').innerHTML = '<p class="zoho-copy">Connect your workspace (top right) first. Zoho Mail syncing runs on the server and needs the shared connection.</p>'; return; }
  if (z.error) { $('zohoBody').innerHTML = `<p class="zoho-copy">Could not check the connection: ${esc(z.error)}</p>`; return; }
  if (z.configured) {
    const run = s.sync?.lastRun, bf = s.sync?.backfill, err = s.sync?.lastError;
    $('zohoBody').innerHTML = `<p class="zoho-copy">Mailbox <strong>${esc(s.sync?.mailbox || 'connected')}</strong> · region <strong>${esc(z.region)}</strong>. Emails to and from everyone in the tracker are logged automatically once an hour; new senders are kept when the subject looks like a sponsorship so you can assign them.</p>
      <div class="connection-status">${run ? `Last run ${esc(fmtDateTime(run.at))}: ${run.added} new email${run.added === 1 ? '' : 's'} from ${run.scanned} scanned.` : 'No sync has run yet.'}${bf && !(bf.inbox?.done && bf.sent?.done) ? `<br>Still catching up on history back to ${esc(fmtDate(bf.horizon))} — run Sync now a few more times or wait for the hourly runs.` : ''}${err ? `<br><strong>Last error:</strong> ${esc(err.message)} (${esc(fmtDateTime(err.at))})` : ''}</div>
      <button class="primary-btn" type="button" id="zohoSyncNow">⇣ Sync now</button>
      <p class="helper-copy">To reconnect a different mailbox, remove <code>ZOHO_REFRESH_TOKEN</code> in Netlify and come back here.</p>`;
    $('zohoSyncNow').addEventListener('click', () => { closeZoho(); runSync(); });
    return;
  }
  if (!z.canExchange) {
    $('zohoBody').innerHTML = `<p class="zoho-copy"><strong>Step 1 of 2.</strong> In Netlify, add <code>ZOHO_CLIENT_ID</code>, <code>ZOHO_CLIENT_SECRET</code> and <code>ZOHO_REGION</code> from your Zoho API console Self Client, then redeploy. Follow ${readme} — about five minutes.</p><div class="connection-status">Missing in Netlify: ${esc((z.missing || []).join(', '))}</div>`;
    return;
  }
  $('zohoBody').innerHTML = `<p class="zoho-copy"><strong>Step 2 of 2.</strong> In the Zoho API console, open your Self Client → <em>Generate Code</em> with scope <code>ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ</code>, duration 10 minutes, then paste the code here. It is exchanged on the server for a long-lived token that you add to Netlify. <strong>Never paste your Zoho password.</strong></p>
    <form id="zohoSetupForm" class="connection-form"><label>Grant code from Zoho <input id="zohoCode" type="text" autocomplete="off" placeholder="1000.xxxxxxxx…"></label><button class="primary-btn" type="submit">Exchange for a token ↗</button></form><div id="zohoResult"></div>`;
  $('zohoSetupForm').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true; $('zohoResult').innerHTML = '<div class="connection-status">Talking to Zoho…</div>';
    try {
      const r = await api({ action: 'zohoSetup', code: $('zohoCode').value });
      $('zohoResult').innerHTML = `<div class="connection-status">Done. Add this in Netlify as <code>ZOHO_REFRESH_TOKEN</code> (mark it sensitive), redeploy, then press Sync emails.</div><label class="zoho-token-label">Refresh token<textarea id="zohoToken" rows="3" readonly>${esc(r.refreshToken)}</textarea></label><button class="secondary-btn" type="button" id="zohoCopy">Copy token</button>${r.apiDomain && !regionMatches(r.apiDomain, z.region) ? `<p class="helper-copy">Zoho says your API domain is <code>${esc(r.apiDomain)}</code> — set <code>ZOHO_REGION</code> to match (currently <code>${esc(z.region)}</code>).</p>` : ''}`;
      $('zohoCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.refreshToken); toast('Token copied.'); } catch { $('zohoToken').select(); } });
    } catch (err) { $('zohoResult').innerHTML = `<div class="connection-status">${esc(err.message)}</div>`; }
    finally { btn.disabled = false; }
  });
}
const regionMatches = (apiDomain, region) => { try { return new URL(apiDomain).hostname.endsWith('.' + region); } catch { return true; } };
async function runSync() {
  if (!connected()) { openZoho(); return; }
  if (s.busy) return; s.busy = true; const btn = $('sponsorSyncBtn'); btn.disabled = true; notice('Syncing Zoho Mail — this takes a few seconds…');
  let result = null;
  try {
    result = await api({ action: 'zohoSync', pages: 2 });
    notice('');
    toast(`${result.added} new email${result.added === 1 ? '' : 's'} logged (${result.scanned} scanned).${result.backfillDone ? '' : ' Still catching up on history — sync again in a moment.'}`);
  } catch (err) {
    notice('Sync failed: ' + err.message, true);
    if (/not connected yet|Missing:/i.test(err.message)) openZoho();
  } finally { s.busy = false; btn.disabled = false; }
  if (result) await refresh(true);
}

/* ---------- wiring ---------- */
function show(tab) {
  const on = tab === 'sponsorships';
  $('sponsorWorkspace').hidden = !on;
  document.querySelectorAll('[data-view-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.viewTab === tab)));
  if (on) { $('weeklyWorkspace').hidden = true; $('productionWorkspace').hidden = true; $('calendarWorkspace').hidden = true; if (!s.loaded) refresh(); }
}
function boot() {
  document.querySelectorAll('[data-view-tab]').forEach(b => b.addEventListener('click', () => show(b.dataset.viewTab)));
  $('sponsorRefresh').addEventListener('click', () => refresh());
  $('sponsorSyncBtn').addEventListener('click', runSync);
  $('sponsorAddBtn').addEventListener('click', () => openRecord(s.view === 'agencies' ? 'agencies' : 'brands', null));
  $('sponsorZohoBtn').addEventListener('click', openZoho);
  $('sponsorSearch').addEventListener('input', e => { s.search = e.target.value.trim(); renderTable(); });
  $('sponsorViews').addEventListener('click', e => { const b = e.target.closest('[data-sponsor-view]'); if (!b) return; s.view = b.dataset.sponsorView; s.filter = 'all'; s.sort = { key: '', dir: 1 }; render(); });
  $('sponsorFilters').addEventListener('click', e => { const b = e.target.closest('[data-sponsor-filter]'); if (!b) return; s.filter = b.dataset.sponsorFilter; renderTools(); renderTable(); });
  $('sponsorStats').addEventListener('click', e => { const b = e.target.closest('[data-stat-view]'); if (!b) return; s.view = b.dataset.statView; s.filter = b.dataset.statFilter; s.sort = { key: '', dir: 1 }; render(); });
  $('sponsorTable').addEventListener('click', e => {
    const sort = e.target.closest('[data-sort]'); if (sort) { const key = sort.dataset.sort; s.sort = s.sort.key === key ? (s.sort.dir > 0 ? { key, dir: -1 } : { key: '', dir: 1 }) : { key, dir: 1 }; renderTable(); return; }
    if (e.target.closest('input,select,label')) return;
    const row = e.target.closest('[data-open]'); if (row) openRecord(row.dataset.open, row.dataset.id);
  });
  $('sponsorTable').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-open]')) openRecord(e.target.dataset.open, e.target.dataset.id); });
  $('sponsorTable').addEventListener('change', e => { if (e.target.matches('[data-action-row]')) toggleAction(e.target); else if (e.target.matches('.sponsor-assign')) assignEmail(e.target); });
  $('sponsorForm').addEventListener('submit', saveRecord);
  $('sponsorNoteForm').addEventListener('submit', addNote);
  $('sponsorOverlay').addEventListener('click', e => { if (e.target.closest('[data-sponsor-close]')) closeRecord(); });
  $('zohoOverlay').addEventListener('click', e => { if (e.target.closest('[data-zoho-close]')) closeZoho(); });
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('zohoOverlay').hidden) closeZoho(); else if (!$('sponsorOverlay').hidden) closeRecord(); });
  let tab = 'weekly'; try { tab = sessionStorage.getItem('studio-active-tab') || 'weekly'; } catch {}
  show(tab === 'sponsorships' ? 'sponsorships' : 'weekly');
  // Reload when the workspace connection flips (connect / switch to demo) while this tab is open.
  let wasConnected = connected();
  setInterval(() => { const now = connected(); if (now === wasConnected) return; wasConnected = now; s.loaded = false; if (!$('sponsorWorkspace').hidden) refresh(true); }, 1000);
}
window.StudioSponsorships = { refresh, runSync, brandNames: () => (s.loaded && !s.demo ? s.brands.slice().sort((a, b) => (group(a.status) === 'won' ? 0 : 1) - (group(b.status) === 'won' ? 0 : 1) || a.name.localeCompare(b.name)).map(b => b.name) : null) };
boot();
})();
