/*
 * Overview (internally the "today" tab) — the landing screen. One page that answers "what needs us right now?" by reading what the other tabs
 * already load: tasks (Notion), Production (Notion Video Projects), the content plan (Google Sheet + YouTube)
 * and the sponsorship tracker (Google Sheet + Zoho). Nothing here is stored; every row opens the real item.
 */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (text, n) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const todayIso = () => new Date().toLocaleDateString('en-CA');
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number), x = new Date(y, m - 1, d, 12); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const between = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
const fmtDay = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const plural = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many);
/** "today", "tomorrow", "Fri", "Mon 17 Nov"; for the past "yesterday", "3 days late". */
function when(iso, lateWord = 'late') {
  const d = between(todayIso(), iso);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return plural(-d, 'day') + ' ' + lateWord;
  if (d < 7) return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' });
  return fmtDay(iso);
}
/** A chip that adds to the date beside it rather than repeating it: "Today", "Tomorrow", "Friday", "In 12 days". */
function relative(iso) { const d = between(todayIso(), iso); return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d > 1 && d < 7 ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }) : d >= 7 ? 'In ' + d + ' days' : when(iso); }
function nextLabel(iso) { const d = between(todayIso(), iso); return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d < 7 ? 'on ' + new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }) : 'on ' + fmtDay(iso); }
function mondayAfter(iso) { const [y, m, d] = iso.split('-').map(Number), x = new Date(y, m - 1, d, 12); x.setDate(x.getDate() - ((x.getDay() + 6) % 7) + 7); return x.toLocaleDateString('en-CA'); }

const M = { board: () => window.StudioBoard, prod: () => window.StudioProduction, cal: () => window.StudioCalendar, spon: () => window.StudioSponsorships };
const t = { loading: false, loadedAt: 0, frame: 0 };
const ROWS = 6;

/* ---------- loading ---------- */
async function load(force = false) {
  if (!window.Studio.connected()) { render(); return; }
  if (t.loading) return;
  t.loading = true; $('todayRefresh').disabled = true; render();
  const jobs = force
    ? [M.board()?.refreshNotion(), M.prod()?.refresh(), M.cal()?.refresh(true), M.spon()?.refresh(true)]
    : [M.prod()?.ensureLoaded(), M.cal()?.ensureLoaded(), M.spon()?.ensureLoaded()];
  await Promise.allSettled(jobs);
  t.loading = false; t.loadedAt = Date.now(); $('todayRefresh').disabled = false; render();
}
const visible = () => window.Studio.current() === 'today';
function soon() { if (!visible() || t.frame) return; t.frame = requestAnimationFrame(() => { t.frame = 0; render(); }); }

/* ---------- pieces ---------- */
const chip = (text, tone = '') => `<span class="today-chip${tone ? ' ' + tone : ''}">${esc(text)}</span>`;
function card({ id, icon, title, count, tone = '', link, linkText, body, wide = false }) {
  return `<section class="today-card${wide ? ' wide' : ''}" id="${id}" aria-labelledby="${id}Title">
    <header class="today-card-head"><h3 id="${id}Title"><span class="today-icon" aria-hidden="true">${icon}</span>${esc(title)}${count != null ? ` <span class="today-count ${tone}">${count}</span>` : ''}</h3>${link ? `<a class="today-more" href="${link}">${esc(linkText)} →</a>` : ''}</header>
    ${body}</section>`;
}
const waiting = (what, loading) => `<p class="today-empty${loading ? ' loading' : ''}">${loading ? 'Loading ' + esc(what) + '…' : esc(what)}</p>`;
const failed = (what, msg) => `<p class="today-empty error"><strong>Couldn’t load ${esc(what)}.</strong> ${esc(msg)}</p>`;
const allClear = text => `<p class="today-empty clear">✓ ${esc(text)}</p>`;
function row({ attrs, main, sub = '', side = '' }) {
  return `<li><button type="button" class="today-row" ${attrs}><span class="today-row-main"><strong>${main}</strong>${sub ? `<small>${sub}</small>` : ''}</span>${side ? `<span class="today-row-side">${side}</span>` : ''}</button></li>`;
}
const more = (n, href, text) => (n > 0 ? `<a class="today-overflow" href="${href}">+ ${plural(n, text)} more →</a>` : '');

/* ---------- tasks: due or overdue, per person ---------- */
function tasksModel() {
  const st = M.board()?.getState(); if (!st) return null;
  if (!st.tasksLoaded) return { error: st.taskError, loading: !st.taskError };
  const today = todayIso(), end = mondayAfter(today);
  const people = new Map([['Josh', []], ['Daisy', []]]);
  st.tasks.filter(x => ['todo', 'doing', 'waiting'].includes(x.status) && x.due && x.due < end).forEach(x => {
    const raw = String(x.owner || '').trim(), name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Daisy';
    if (!people.has(name)) people.set(name, []);
    people.get(name).push({ ...x, unassigned: !raw, late: x.due < today });
  });
  people.forEach(list => list.sort((a, b) => a.due.localeCompare(b.due) || (b.priority === 'critical') - (a.priority === 'critical')));
  const all = [...people.values()].flat();
  return { people, overdue: all.filter(x => x.late).length, dueToday: all.filter(x => x.due === today).length, total: all.length };
}
function tasksCard(m) {
  let body;
  if (!m || m.loading) body = waiting('tasks', true);
  else if (m.error) body = failed('tasks from Notion', m.error);
  else {
    body = '<div class="today-people">' + [...m.people.entries()].map(([name, list]) => {
      const tab = name.toLowerCase() === 'josh' ? 'josh' : 'daisy';
      const late = list.filter(x => x.late).length;
      const rows = list.slice(0, ROWS + 2).map(x => row({
        attrs: `data-today-task="${esc(x.id)}"`,
        main: esc(x.title),
        sub: [x.project && x.project !== 'General' ? esc(x.project) : '', x.status === 'waiting' ? 'waiting on a decision' : x.status === 'doing' ? 'in progress' : '', x.unassigned && name === 'Daisy' ? 'unassigned' : ''].filter(Boolean).join(' · '),
        side: chip(when(x.due), x.late ? 'late' : x.due === todayIso() ? 'now' : '') + (x.priority === 'critical' ? chip('Urgent', 'late') : x.priority === 'high' ? chip('High', 'warn') : '')
      })).join('');
      return `<div class="today-person"><div class="today-person-head"><a href="#${tab}"><strong>${esc(name)}</strong></a><span>${list.length ? plural(list.length, 'task') + ' this week' + (late ? ` · <b class="late-text">${late} overdue</b>` : '') : ''}</span></div>${list.length ? `<ul class="today-list">${rows}</ul>${more(list.length - (ROWS + 2), '#' + tab, 'task')}` : allClear('Nothing due this week.')}</div>`;
    }).join('') + '</div>';
  }
  return card({ id: 'todayTasks', icon: '✳', title: 'Due this week', count: m && !m.loading && !m.error ? m.total : null, tone: m?.overdue ? 'late' : '', link: '#daisy', linkText: 'Boards', body, wide: true });
}

/* ---------- production: blocked, late, gone quiet, due soon ---------- */
function productionModel() {
  const p = M.prod(); if (!p) return null;
  if (!p.loaded()) return { error: p.error(), loading: !p.error() || t.loading };
  const today = todayIso(), week = addDays(today, 7), order = { blocked: 0, late: 1, stale: 2, soon: 3 };
  const list = p.projects().map(v => ({ v, why: v.blocker ? 'blocked' : v.nextDue && v.nextDue < today ? 'late' : p.isStale(v) ? 'stale' : v.nextDue && v.nextDue <= week ? 'soon' : '' }))
    .filter(x => x.why).sort((a, b) => order[a.why] - order[b.why] || (a.v.nextDue || '9999').localeCompare(b.v.nextDue || '9999'));
  return { list, blocked: list.filter(x => x.why === 'blocked').length, stale: p.projects().filter(p.isStale).length, active: p.projects().length };
}
function productionCard(m) {
  let body;
  if (!m || m.loading) body = waiting('videos', true);
  else if (m.error) body = failed('Production', m.error);
  else if (!m.list.length) body = allClear(m.active ? `All ${plural(m.active, 'active video')} are moving and up to date.` : 'No active videos in Production.');
  else {
    const today = todayIso();
    body = '<ul class="today-list">' + m.list.slice(0, ROWS).map(({ v, why }) => {
      const confirmed = v.lastConfirmed ? between(v.lastConfirmed, today) : null;
      const side = why === 'blocked' ? chip('Blocked', 'late') : why === 'late' ? chip('Due ' + when(v.nextDue), 'late') : why === 'stale' ? chip(confirmed == null ? 'Never updated' : 'Not updated in ' + confirmed + 'd', 'warn') : chip('Due ' + when(v.nextDue), v.nextDue === today ? 'now' : '');
      const sub = why === 'blocked' ? esc(clamp(v.blocker, 100)) : [esc(v.stage), v.currentlyWith ? 'with ' + esc(v.currentlyWith) : '', v.nextDeliverable ? 'next: ' + esc(clamp(v.nextDeliverable, 60)) : ''].filter(Boolean).join(' · ');
      return row({ attrs: `data-today-video="${esc(v.id)}"`, main: esc(v.title), sub, side });
    }).join('') + '</ul>' + more(m.list.length - ROWS, m.blocked ? '#production/blocked' : '#production/needs-update', 'video');
  }
  return card({ id: 'todayProduction', icon: '▣', title: 'Production needs', count: m && !m.loading && !m.error ? m.list.length : null, tone: m?.blocked ? 'late' : m?.list?.length ? 'warn' : '', link: '#production', linkText: 'Production', body });
}

/* ---------- publishing: what's next, what slipped, which slots have no sponsor ---------- */
function calendarModel() {
  const c = M.cal(); if (!c) return null;
  if (!c.loaded()) return { error: c.error(), loading: !c.error() || t.loading };
  const today = todayIso(), horizon = addDays(today, 56), back = addDays(today, -30);
  const events = c.events();
  const next = events.filter(e => c.stateOf(e) === 'scheduled' && e.date >= today && e.date <= horizon).sort((a, b) => a.date.localeCompare(b.date));
  const missed = events.filter(e => c.stateOf(e) === 'overdue' && e.date >= back).sort((a, b) => b.date.localeCompare(a.date));
  // Open release slots (every other Friday with nothing planned that fortnight) sit in the list alongside planned videos.
  const slots = c.openSlots ? c.openSlots(today, horizon) : [];
  const upcoming = [...next.map(e => ({ e, date: e.date })), ...slots.map(date => ({ slot: true, date }))].sort((a, b) => a.date.localeCompare(b.date));
  const unsold = upcoming.filter(x => x.slot || !c.sponsorOf(x.e));
  // Money: sponsored videos that are live. "Live, not invoiced" = status blank or In progress; "Invoiced" = waiting to be paid.
  const live = events.filter(e => e.sponsor && c.stateOf(e) === 'published').map(e => ({ e, liveFor: Math.max(0, between(c.shownOn(e), today)) }));
  const toInvoice = live.filter(x => !x.e.sponsorStatus || x.e.sponsorStatus === 'In progress').sort((a, b) => b.liveFor - a.liveFor);
  const toBePaid = live.filter(x => x.e.sponsorStatus === 'Invoiced').sort((a, b) => b.liveFor - a.liveFor);
  return { c, next, slots, upcoming, missed, unsold, toInvoice, toBePaid };
}
function calendarCard(m) {
  let body;
  if (!m || m.loading) body = waiting('the content plan', true);
  else if (m.error) body = failed('the content plan', m.error);
  else {
    const { c } = m;
    const title = e => c.isUntitled(e) ? '<span class="today-untitled">+ Add a title</span>' : esc(c.shortTitle(e, c.sponsorOf(e)?.name));
    const missed = m.missed.slice(0, 3).map(e => row({ attrs: `data-today-slot="${esc(e.date)}"`, main: title(e), sub: 'Planned ' + esc(fmtDay(e.date)) + ' — not on YouTube yet', side: chip('Not live', 'late') })).join('');
    const slotRow = date => row({ attrs: `data-today-open-slot="${esc(date)}"`, main: '<span class="today-untitled">+ Add a title</span>', sub: esc(fmtDay(date)) + ' · open release slot', side: chip('Open slot', 'open') + chip(relative(date), date === todayIso() ? 'now' : '') });
    const next = m.upcoming.slice(0, ROWS).map(({ e, slot, date }) => { if (slot) return slotRow(date); const sp = c.sponsorOf(e); return row({ attrs: `data-today-slot="${esc(e.date)}"`, main: title(e), sub: esc(fmtDay(e.date)) + (sp ? ' · ◆ ' + esc(sp.name) + (sp.saved ? '' : ' (suggested)') : ''), side: (sp ? '' : chip('No sponsor', 'open')) + chip(relative(e.date), e.date === todayIso() ? 'now' : '') }); }).join('');
    body = (missed ? `<p class="today-sub">Past their date, not live</p><ul class="today-list">${missed}</ul>` : '') +
      (m.upcoming.length ? `<p class="today-sub">Next 8 weeks${m.unsold.length ? ` · <b>${m.unsold.length} of ${m.upcoming.length} without a sponsor</b>` : ' · all sponsored'}</p><ul class="today-list">${next}</ul>${more(m.upcoming.length - ROWS, '#calendar', 'upload')}` : allClear('Nothing scheduled in the next 8 weeks — time to plan some uploads.'));
  }
  const count = m && !m.loading && !m.error ? m.upcoming.length : null;
  return card({ id: 'todayCalendar', icon: '▦', title: 'Publishing', count, tone: m?.missed?.length ? 'late' : '', link: '#calendar', linkText: 'Calendar', body });
}
function moneyCard(m) {
  let body;
  if (!m || m.loading) body = waiting('sponsor payments', true);
  else if (m.error) body = failed('sponsor payments', m.error);
  else if (!m.toInvoice.length && !m.toBePaid.length) body = allClear('Every live sponsored video is marked paid.');
  else {
    const { c } = m;
    const line = ({ e, liveFor }, invoiced) => row({
      attrs: `data-today-slot="${esc(e.date)}"`,
      main: '◆ ' + esc(e.sponsor),
      sub: esc(c.shortTitle(e, e.sponsor)) + ' · live ' + esc(fmtDay(c.shownOn(e))),
      side: invoiced ? chip(liveFor >= 45 ? 'Chase · ' + liveFor + 'd' : 'Invoiced · ' + liveFor + 'd live', liveFor >= 45 ? 'late' : 'warn') : chip('Invoice it', liveFor >= 14 ? 'late' : 'warn')
    });
    body = (m.toInvoice.length ? `<p class="today-sub">Live, not invoiced yet</p><ul class="today-list">${m.toInvoice.slice(0, 4).map(x => line(x, false)).join('')}</ul>${more(m.toInvoice.length - 4, '#calendar', 'video')}` : '') +
      (m.toBePaid.length ? `<p class="today-sub">Invoiced, waiting to be paid</p><ul class="today-list">${m.toBePaid.slice(0, 4).map(x => line(x, true)).join('')}</ul>${more(m.toBePaid.length - 4, '#calendar', 'invoice')}` : '') +
      '<p class="today-note">From each video’s sponsor status in the calendar. Set it to Paid once the money lands.</p>';
  }
  const count = m && !m.loading && !m.error ? m.toInvoice.length + m.toBePaid.length : null;
  return card({ id: 'todayMoney', icon: '£', title: 'Sponsor money', count, tone: count ? 'warn' : '', link: '#calendar', linkText: 'Calendar', body });
}

/* ---------- sponsorships: replies waiting on Josh ---------- */
function sponsorModel() {
  const s = M.spon(); if (!s) return null;
  if (!s.loaded()) return { error: s.error(), loading: !s.error() || t.loading };
  const actions = s.actions().filter(a => String(a.done).toLowerCase() !== 'yes');
  return { list: s.waitingOnYou(), actions, high: actions.filter(a => /high/i.test(a.priority)).length };
}
function sponsorCard(m) {
  let body;
  if (!m || m.loading) body = waiting('the sponsorship tracker', true);
  else if (m.error) body = failed('the sponsorship tracker', m.error);
  else {
    const rows = m.list.slice(0, ROWS).map(r => row({
      attrs: r.kind === 'flag' ? 'data-today-flag' : `data-today-deal="${esc(r.tab)}|${esc(r.id)}"`,
      main: esc(r.name) + (r.kind === 'flag' ? ' <em class="today-new">new</em>' : ''),
      sub: esc(clamp(r.subject, 80)) || esc(r.status),
      side: (r.flags ? chip('⚑ Flagged', 'late') : '') + (r.days != null ? chip(r.days === 0 ? 'Today' : r.days + 'd', r.days >= 3 ? 'late' : 'warn') : '')
    })).join('');
    body = (m.list.length ? `<ul class="today-list">${rows}</ul>${more(m.list.length - ROWS, '#sponsorships/waiting-on-you', 'reply')}` : allClear('No sponsor emails waiting on you.')) +
      (m.actions.length ? `<a class="today-foot-link" href="#sponsorships/actions">Action list: ${plural(m.actions.length, 'open item')}${m.high ? ` · <b>${m.high} high priority</b>` : ''} →</a>` : '');
  }
  const count = m && !m.loading && !m.error ? m.list.length : null;
  return card({ id: 'todaySponsors', icon: '✦', title: 'Replies waiting on you', count, tone: count ? 'late' : '', link: '#sponsorships/waiting-on-you', linkText: 'Sponsorships', body });
}

/* ---------- the page ---------- */
function pulse(tasks, prod, cal, spon) {
  const bits = [];
  if (tasks && !tasks.loading && !tasks.error) bits.push(tasks.overdue ? [plural(tasks.overdue, 'task') + ' overdue', 'late', 'todayTasks'] : tasks.dueToday ? [plural(tasks.dueToday, 'task') + ' due today', 'now', 'todayTasks'] : ['No overdue tasks', 'ok', 'todayTasks']);
  if (spon && !spon.loading && !spon.error) bits.push(spon.list.length ? [plural(spon.list.length, 'reply', 'replies') + ' waiting on you', 'late', 'todaySponsors'] : ['Inbox clear', 'ok', 'todaySponsors']);
  if (prod && !prod.loading && !prod.error) bits.push(prod.blocked ? [plural(prod.blocked, 'video') + ' blocked', 'late', 'todayProduction'] : prod.list.length ? [plural(prod.list.length, 'video') + ' need a look', 'warn', 'todayProduction'] : ['Production on track', 'ok', 'todayProduction']);
  if (cal && !cal.loading && !cal.error) {
    const n = cal.next[0];
    const gap = cal.slots[0];
    bits.push(n && (!gap || n.date <= gap) ? ['Next upload ' + nextLabel(n.date), n.date === todayIso() ? 'now' : '', 'todayCalendar'] : gap ? ['Next release slot ' + nextLabel(gap) + ' has no video', 'warn', 'todayCalendar'] : ['Nothing scheduled', 'warn', 'todayCalendar']);
    const owed = cal.toInvoice.length + cal.toBePaid.length;
    if (owed) bits.push([plural(owed, 'sponsor payment') + ' to chase', 'warn', 'todayMoney']);
  }
  return bits.map(([text, tone, target]) => `<button type="button" class="today-pulse-item ${tone}" data-scroll="${target}">${esc(text)}</button>`).join('');
}
function render() {
  if (!$('todayWorkspace')) return;
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  $('todayDate').textContent = '/ ' + date.toUpperCase();
  if (!window.Studio.isReady()) { $('todayPulse').innerHTML = ''; $('todayUpdated').textContent = 'Connecting…'; $('todayGrid').innerHTML = tasksCard(null) + sponsorCard(null) + productionCard(null) + calendarCard(null) + moneyCard(null); return; }
  if (!window.Studio.connected()) {
    $('todayPulse').innerHTML = ''; $('todayUpdated').textContent = '';
    $('todayGrid').innerHTML = `<section class="today-card wide today-connect"><h3>Connect once on this device to see the overview.</h3><p>Tasks due for each of you, videos that are stuck, the next uploads, sponsor replies waiting and money still to come in — all on one page. The site remembers this device after you connect, so you won’t be asked again.</p><button type="button" class="primary-btn" data-today-connect>Connect ↗</button></section>`;
    return;
  }
  const tasks = tasksModel(), prod = productionModel(), cal = calendarModel(), spon = sponsorModel();
  $('todayPulse').innerHTML = pulse(tasks, prod, cal, spon);
  $('todayUpdated').textContent = t.loading ? 'Updating…' : t.loadedAt ? 'Updated ' + new Date(t.loadedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  $('todayGrid').innerHTML = tasksCard(tasks) + sponsorCard(spon) + productionCard(prod) + calendarCard(cal) + moneyCard(cal);
}

function boot() {
  if (!$('todayWorkspace')) return;
  window.Studio.on('tab', ({ tab }) => { if (tab === 'today') { render(); window.Studio.ready.then(() => load(false)); } });
  window.Studio.on('connection', () => { t.loadedAt = 0; if (visible()) load(false); else render(); });
  window.Studio.on('data', soon);
  $('todayRefresh').addEventListener('click', () => load(true));
  // Back on a tab that's been sitting open a while (yesterday's overview, say): refresh quietly.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && visible() && t.loadedAt && Date.now() - t.loadedAt > 15 * 60000) load(true); });
  $('todayWorkspace').addEventListener('click', e => {
    const go = e.target.closest('[data-scroll]'); if (go) { $(go.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (e.target.closest('[data-today-connect]')) { M.board()?.openConnection(); return; }
    const task = e.target.closest('[data-today-task]'); if (task) { M.board()?.openTask(task.dataset.todayTask); return; }
    const video = e.target.closest('[data-today-video]'); if (video) { M.prod()?.open(video.dataset.todayVideo); return; }
    const slot = e.target.closest('[data-today-slot]'); if (slot) { M.cal()?.open(slot.dataset.todaySlot); return; }
    const open = e.target.closest('[data-today-open-slot]'); if (open) { M.cal()?.openSlot(open.dataset.todayOpenSlot); return; }
    const deal = e.target.closest('[data-today-deal]'); if (deal) { const [tab, id] = deal.dataset.todayDeal.split('|'); M.spon()?.open(tab, id); return; }
    if (e.target.closest('[data-today-flag]')) window.Studio.show('sponsorships', { item: ['waiting-on-you'] });
  });
}
boot();
window.StudioToday = { load, render };
})();
