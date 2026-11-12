/*
 * Josh Brett Ideation Machine (/ideas).
 * Outliers: thumbnails that broke out, with notes on why. Video ideas: angle, titles, thumbnail plan, sources, similar videos.
 * Data lives on the Studio site (Netlify Blobs) behind the Studio workspace code: see netlify/functions/ideation.mjs.
 * Links: #outliers · #outliers/<id> · #ideas · #ideas/<id> · #backups
 */
(() => {
'use strict';
const CODE_KEY = 'josh-brett-studio-access-code';        // shared with the Studio: connected there = connected here
const SESSION_KEY = 'josh-brett-studio-access-code-tab';
const WHO_KEY = 'ideation-who';
const IMPORT_KEY = 'ideation-discord-import';
const API = '/.netlify/functions/ideation';
const STATUSES = ['Rough', 'Developing', 'Packaging', 'Greenlit', 'In production', 'Parked'];
const PEOPLE = ['Josh', 'Daisy', 'Rachit', 'Tristan'];
const TAG_IDEAS = ['Face', 'Shock', 'Before/after', 'Big number', 'Text', 'No text', 'High contrast', 'Mystery', 'Comparison', 'Money', 'Celebrity', 'Object', 'Arrow/circle', 'Split screen', 'Dark', 'Minimal', 'Documentary', 'Curiosity gap'];
const CHANNEL_LABEL = { 'outliers': '#outliers', 'mega-viral-outliers': '#mega-viral', 'educational-outliers': '#educational', 'thumbnail-inspo': '#thumbnail-inspo', 'rough-ideas': '#rough-ideas' };

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const store = (area, key, val) => { try { if (val === undefined) return window[area].getItem(key) || ''; if (val === null) window[area].removeItem(key); else window[area].setItem(key, val); } catch { return ''; } return ''; };
const fmtNum = n => { if (n == null || n === '' || !Number.isFinite(Number(n))) return ''; n = Number(n); if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'; return String(n); };
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtWhen = iso => { const d = new Date(iso); if (isNaN(d)) return ''; const mins = (Date.now() - d) / 6e4; if (mins < 1) return 'just now'; if (mins < 60) return Math.round(mins) + ' min ago'; if (mins < 1440) return Math.round(mins / 60) + ' h ago'; return fmtDate(iso); };
const ytId = s => { const m = String(s || '').match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i); return m ? m[1] : ''; };
const ratioOf = o => (o.views && o.subs ? o.views / o.subs : 0);
const statusClass = s => 'status-' + String(s || 'Rough').replace(/\s+/g, '-');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let toastTimer;
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }

/* ---------- state ---------- */
const S = {
  code: '', who: store('localStorage', WHO_KEY), loaded: false, loadedAt: 0,
  outliers: new Map(), ideas: new Map(), imageKey: '', youtube: false, backup: null,
  tab: 'outliers', outFilter: 'all', tagFilter: '', outSort: 'new', outQuery: '', outLimit: 96,
  ideaFilter: 'all', ideaSort: 'updated', ideaQuery: '',
  open: null // { kind: 'outlier'|'idea', id }
};
const img = id => (id && S.imageKey ? API + '?img=' + encodeURIComponent(id) + '&k=' + encodeURIComponent(S.imageKey) : '');
const outThumb = o => img(o.imageSmall) || safeUrl(o.thumbUrl) || img(o.image) || (o.videoId ? 'https://i.ytimg.com/vi/' + o.videoId + '/hqdefault.jpg' : '');
const outFull = o => img(o.image) || safeUrl(o.thumbUrl) || img(o.imageSmall) || (o.videoId ? 'https://i.ytimg.com/vi/' + o.videoId + '/hqdefault.jpg' : '');
const outName = o => o.title || (o.discord ? (CHANNEL_LABEL[o.discord.channel] || '#' + o.discord.channel) + ' · ' + fmtDate(o.createdAt) : 'Untitled outlier');

/* ---------- access code (same storage as the Studio) ---------- */
function savedCode() { return store('localStorage', CODE_KEY) || store('sessionStorage', SESSION_KEY); }
function setCode(code, remember) { store('localStorage', CODE_KEY, null); store('sessionStorage', SESSION_KEY, null); if (remember) store('localStorage', CODE_KEY, code); else store('sessionStorage', SESSION_KEY, code); }

async function api(action, payload = {}) {
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-board-key': S.code }, body: JSON.stringify({ action, by: S.who || 'Someone', ...payload }), cache: 'no-store' });
  let data = {}; try { data = await res.json(); } catch {}
  if (res.status === 401) { setConnected(false); showConnect('That code didn\'t work. Check it with Josh.'); throw new Error('Not connected.'); }
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ').'));
  return data;
}

function setConnected(on) {
  $('#connectionDot').className = 'connection-dot' + (on ? ' connected' : '');
  $('#connectionText').textContent = on ? 'Connected' : 'Not connected';
}
function showConnect(msg = '') { $('#connectError').textContent = msg; $('#connectOverlay').hidden = false; setTimeout(() => $('#accessCode').focus(), 50); }

/* ---------- loading ---------- */
async function load({ quiet = false } = {}) {
  if (!S.code) { showConnect(); return; }
  try {
    const d = await api('list');
    S.outliers = new Map(d.outliers.map(o => [o.id, o]));
    // Keep unsaved local edits on the item that's open.
    const keepIdea = S.open?.kind === 'idea' && pending.size ? S.ideas.get(S.open.id) : null;
    S.ideas = new Map(d.ideas.map(i => [i.id, i]));
    if (keepIdea) S.ideas.set(keepIdea.id, keepIdea);
    S.imageKey = d.imageKey; S.youtube = d.youtube; S.backup = d.backup;
    S.loaded = true; S.loadedAt = Date.now();
    setConnected(true);
    $('#statsBtn').hidden = !S.youtube || ![...S.outliers.values()].some(o => o.videoId);
    renderAll();
    if (!S.who) openWho();
    maybeImport();
  } catch (err) {
    if (!quiet) notice(err.message, true);
  }
}
function notice(msg, error) { const n = $('#globalNotice'); n.hidden = !msg; n.textContent = msg || ''; n.classList.toggle('error', Boolean(error)); }

/* ---------- saving (debounced per item, field by field) ---------- */
const pending = new Map(); // key "kind:id" -> { patch, timer }
function saveState(text, error) { $$('[data-save-state]').forEach(el => { el.textContent = text; el.classList.toggle('error', Boolean(error)); }); }
function queueSave(kind, id, patch, delay = 700) {
  const key = kind + ':' + id;
  const p = pending.get(key) || { patch: {}, timer: 0 };
  Object.assign(p.patch, patch);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => flush(kind, id), delay);
  pending.set(key, p);
  const item = (kind === 'idea' ? S.ideas : S.outliers).get(id);
  if (item) Object.assign(item, patch);
  saveState('Unsaved…');
}
async function flush(kind, id) {
  const key = kind + ':' + id, p = pending.get(key);
  if (!p) return;
  pending.delete(key); clearTimeout(p.timer);
  saveState('Saving…');
  try {
    const { item } = await api(kind === 'idea' ? 'saveIdea' : 'saveOutlier', { id, patch: p.patch });
    const map = kind === 'idea' ? S.ideas : S.outliers;
    const local = map.get(id) || {};
    const stillPending = pending.get(key)?.patch || {};
    map.set(id, { ...item, ...stillPending, ...(local._new ? { _new: true } : {}) });
    saveState('Saved ✓');
    renderLists();
  } catch (err) {
    saveState('Not saved: ' + err.message, true);
    toast('Not saved: ' + err.message, 5000);
  }
}
async function flushAll() { await Promise.all([...pending.keys()].map(k => { const [kind, ...rest] = k.split(':'); return flush(kind, rest.join(':')); })); }
window.addEventListener('beforeunload', e => { if (pending.size) { flushAll(); e.preventDefault(); e.returnValue = ''; } });

/* ---------- images: shrink in the browser before upload ---------- */
async function shrink(blob, maxW, quality) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxW / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/webp', quality);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', quality);
  return url;
}
async function uploadBlob(blob, source = '') {
  if (!blob || !/^image\//.test(blob.type || 'image/')) throw new Error('That isn\'t an image.');
  const [data, small] = await Promise.all([shrink(blob, 1600, 0.86), shrink(blob, 520, 0.8)]);
  return api('uploadImage', { data, small, source });
}

/* ---------- router ---------- */
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const tab = ['outliers', 'ideas', 'backups'].includes(parts[0]) ? parts[0] : 'outliers';
  showTab(tab, false);
  if (parts[1] && S.open?.id === parts[1]) return;
  if (parts[1] && S.loaded) { if (tab === 'outliers' && S.outliers.has(parts[1])) openOutlier(parts[1], false); else if (tab === 'ideas' && S.ideas.has(parts[1])) openIdea(parts[1], false); }
  else if (!parts[1] && S.open) closeDrawers(false);
}
function setHash(h, push = true) { if (location.hash === h) return; try { history[push ? 'pushState' : 'replaceState'](null, '', h); } catch { location.hash = h; } }
function showTab(tab, push = true) {
  S.tab = tab;
  $('#outliersView').hidden = tab !== 'outliers'; $('#ideasView').hidden = tab !== 'ideas'; $('#backupsView').hidden = tab !== 'backups';
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (push) setHash('#' + tab);
  if (tab === 'backups') renderBackups(true);
}

/* ---------- rendering: outliers ---------- */
function outlierMatches(o) {
  const f = S.outFilter;
  if (f === 'archived') { if (!o.archived) return false; } else if (o.archived) return false;
  if (f === 'starred' && !o.starred) return false;
  if (f === 'manual' && o.discord) return false;
  if (f.startsWith('ch:') && o.discord?.channel !== f.slice(3)) return false;
  if (S.tagFilter && !(o.tags || []).includes(S.tagFilter)) return false;
  const q = S.outQuery.trim().toLowerCase();
  if (q) { const hay = [o.title, o.channel, o.why, o.steal, ...(o.tags || []), ...(o.notes || []).map(n => n.text), o.discord?.channel].join(' ').toLowerCase(); if (!q.split(/\s+/).every(w => hay.includes(w))) return false; }
  return true;
}
const hasThoughts = o => Boolean(o.why || o.steal || (o.notes || []).some(n => !(o.discord && n.at === o.discord.postedAt)));
function renderOutliers() {
  const all = [...S.outliers.values()];
  const live = all.filter(o => !o.archived);
  const count = fn => live.filter(fn).length;
  const channels = [...new Set(all.map(o => o.discord?.channel).filter(Boolean))];
  const filters = [['all', 'All', live.length], ['starred', '★ Starred', count(o => o.starred)], ['nonotes', 'Needs notes', count(o => !hasThoughts(o))],
    ...channels.map(c => ['ch:' + c, CHANNEL_LABEL[c] || '#' + c, count(o => o.discord?.channel === c)]), ['manual', 'Added here', count(o => !o.discord)], ['archived', 'Archived', all.length - live.length]];
  $('#outlierFilters').innerHTML = filters.filter(([k, , n]) => n || k === 'all' || k === S.outFilter).map(([k, label, n]) => `<button class="tab" type="button" data-out-filter="${esc(k)}" aria-pressed="${S.outFilter === k}">${esc(label)}<span class="tab-count">${n}</span></button>`).join('');
  const tagCounts = {};
  live.forEach(o => (o.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const tagList = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 30);
  $('#tagFilter').innerHTML = tagList.length ? tagList.map(([t, n]) => `<button class="chip" type="button" data-tag-filter="${esc(t)}" aria-pressed="${S.tagFilter === t}">${esc(t)} <span class="tab-count">${n}</span></button>`).join('') : '';
  // the matching: "Needs notes" uses hasThoughts
  let list = all.filter(o => (S.outFilter === 'nonotes' ? (!o.archived && !hasThoughts(o) && (!S.tagFilter || (o.tags || []).includes(S.tagFilter)) && queryOk(o)) : outlierMatches(o)));
  const by = { new: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)), old: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)), views: (a, b) => (b.views || 0) - (a.views || 0), ratio: (a, b) => ratioOf(b) - ratioOf(a), notes: (a, b) => (b.notes || []).length - (a.notes || []).length };
  list.sort(by[S.outSort] || by.new);
  $('#outlierResults').textContent = list.length === live.length && !S.tagFilter && S.outFilter === 'all' ? `${live.length} outliers` : `Showing ${list.length} of ${live.length}`;
  $('#outlierTabCount').textContent = live.length || '';
  const grid = $('#outlierGrid');
  if (!list.length) { grid.innerHTML = `<div class="empty-state">${S.outliers.size ? 'Nothing matches that.' : 'No outliers yet.'}<small>${S.outliers.size ? 'Try another filter or search.' : 'Paste a screenshot (⌘V) or a YouTube link, or press Add outlier.'}</small></div>`; return; }
  grid.innerHTML = list.slice(0, S.outLimit).map(cardOutlier).join('') + (list.length > S.outLimit ? `<button class="quiet-btn show-more" type="button" data-more-outliers>Show ${Math.min(96, list.length - S.outLimit)} more (${list.length - S.outLimit} left)</button>` : '');
}
function queryOk(o) { const q = S.outQuery.trim().toLowerCase(); if (!q) return true; const hay = [o.title, o.channel, o.why, o.steal, ...(o.tags || []), ...(o.notes || []).map(n => n.text)].join(' ').toLowerCase(); return q.split(/\s+/).every(w => hay.includes(w)); }
function cardOutlier(o) {
  const src = outThumb(o), r = ratioOf(o), notes = (o.notes || []).length;
  const usedIn = [...S.ideas.values()].filter(i => (i.outlierIds || []).includes(o.id)).length;
  return `<button class="out-card" type="button" data-open-outlier="${esc(o.id)}">
    <div class="out-thumb">${src ? `<img loading="lazy" decoding="async" src="${esc(src)}" alt="">` : '<span class="no-img">No image</span>'}
      <div class="out-badges"><span ${o.views ? '' : 'hidden'}>${fmtNum(o.views)} views</span>${r >= 1 ? `<span class="ratio">${r >= 10 ? Math.round(r) : r.toFixed(1)}× subs</span>` : ''}${o.starred ? '<span class="star">★</span>' : ''}</div></div>
    <div class="out-info">
      <p class="out-title ${o.title ? '' : 'empty'}">${esc(o.title || o.channel || 'Untitled · ' + fmtDate(o.discord?.postedAt || o.createdAt))}</p>
      ${o.why ? `<p class="out-why">${esc(o.why)}</p>` : ''}
      <div class="out-foot"><span class="tags">${(o.tags || []).slice(0, 3).map(t => `<span>${esc(t)}</span>`).join('')}${o.discord ? `<span>${esc(CHANNEL_LABEL[o.discord.channel] || '#' + o.discord.channel)}</span>` : ''}</span>
      <span>${usedIn ? `✳ ${usedIn} idea${usedIn > 1 ? 's' : ''} · ` : ''}${notes ? `✎ ${notes}` : hasThoughts(o) ? '' : '<span class="needs-notes">needs notes</span>'}</span></div>
    </div></button>`;
}

/* ---------- rendering: ideas ---------- */
function ideaHay(i) { return [i.title, i.premise, i.hook, i.thumbnailConcept, i.owner, ...(i.tags || []), ...(i.titleOptions || []).map(t => t.text), ...(i.sources || []).flatMap(s => [s.label, s.url, s.note]), ...(i.similar || []).flatMap(v => [v.title, v.channel, v.note]), ...(i.notes || []).map(n => n.text)].join(' ').toLowerCase(); }
function renderIdeas() {
  const all = [...S.ideas.values()];
  const n = s => all.filter(i => (i.status || 'Rough') === s).length;
  const active = all.filter(i => !['Parked', 'In production'].includes(i.status));
  const filters = [['all', 'All active', active.length], ['starred', '★ Starred', all.filter(i => i.starred).length], ...STATUSES.map(s => [s, s, n(s)])];
  $('#ideaFilters').innerHTML = filters.map(([k, label, c]) => `<button class="tab" type="button" data-idea-filter="${esc(k)}" aria-pressed="${S.ideaFilter === k}">${esc(label)}<span class="tab-count">${c}</span></button>`).join('');
  const q = S.ideaQuery.trim().toLowerCase();
  let list = all.filter(i => (S.ideaFilter === 'all' ? !['Parked', 'In production'].includes(i.status) : S.ideaFilter === 'starred' ? i.starred : (i.status || 'Rough') === S.ideaFilter) && (!q || q.split(/\s+/).every(w => ideaHay(i).includes(w))));
  const by = { updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)), new: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)), old: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)), starred: (a, b) => (b.starred - a.starred) || String(b.updatedAt).localeCompare(String(a.updatedAt)), az: (a, b) => String(a.title || '~').localeCompare(String(b.title || '~')) };
  list.sort(by[S.ideaSort] || by.updated);
  $('#ideaResults').textContent = `Showing ${list.length} of ${all.length} ideas`;
  $('#ideaTabCount').textContent = active.length || '';
  const grid = $('#ideaGrid');
  if (!list.length) { grid.innerHTML = `<div class="empty-state">${all.length ? 'No ideas here.' : 'No ideas yet.'}<small>${all.length ? 'Try another status or search.' : 'Press New idea to start one.'}</small></div>`; return; }
  grid.innerHTML = list.map(cardIdea).join('');
}
function ideaThumbs(i) {
  return [...(i.images || []).map(x => img(x.small || x.id)), ...(i.outlierIds || []).map(id => S.outliers.get(id)).filter(Boolean).map(outThumb)].filter(Boolean);
}
function cardIdea(i) {
  const thumbs = ideaThumbs(i).slice(0, 4), fav = (i.titleOptions || []).find(t => t.fav);
  const counts = [[(i.titleOptions || []).length, 'titles'], [(i.sources || []).length, 'sources'], [(i.similar || []).length, 'similar'], [(i.outlierIds || []).length, 'outliers'], [(i.notes || []).length, 'notes']].filter(([n]) => n).map(([n, l]) => [n, n === 1 ? l.replace(/s$/, '') : l]);
  return `<button class="idea-card" type="button" data-open-idea="${esc(i.id)}">
    <div class="idea-top"><span class="status-pill ${statusClass(i.status)}">${esc(i.status || 'Rough')}</span><span>${i.starred ? '★ ' : ''}${i.owner ? esc(i.owner) : ''}</span></div>
    <strong class="${i.title ? '' : 'empty'}">${esc(i.title || 'Untitled idea')}</strong>
    ${fav && fav.text !== i.title ? `<span class="idea-fav-title">★ ${esc(fav.text)}</span>` : ''}
    ${i.premise ? `<p class="idea-premise">${esc(i.premise)}</p>` : ''}
    ${thumbs.length ? `<div class="idea-strip" style="grid-template-columns:repeat(${thumbs.length},1fr)">${thumbs.map(s => `<img loading="lazy" src="${esc(s)}" alt="">`).join('')}</div>` : ''}
    <div class="idea-counts">${counts.length ? counts.map(([n, label]) => `<span><b>${n}</b> ${label}</span>`).join('') : '<span>Nothing added yet</span>'}</div>
  </button>`;
}
function renderLists() { renderOutliers(); renderIdeas(); }
function renderAll() { renderLists(); if (S.tab === 'backups') renderBackups(); route(); }

/* ---------- notes thread (shared by both drawers) ---------- */
function notesHtml(kind, item) {
  const notes = item.notes || [];
  return `<div class="drawer-section"><h3>Notes <small>${notes.length ? notes.length + ' SO FAR' : 'NONE YET'}</small></h3>
    <p class="section-hint">${kind === 'outlier' ? 'Why does this work? What would we do differently? Anyone can add a thought.' : 'Thoughts, questions, leads to chase. Anyone can add one.'}</p>
    <div class="notes-list">${notes.length ? notes.map(n => `<div class="comment"><div class="comment-by"><span><strong>${esc(n.by)}</strong> · ${esc(fmtWhen(n.at))}</span><button class="note-del" type="button" data-del-note="${esc(n.id)}" title="Delete this note">Delete</button></div><p>${esc(n.text)}</p></div>`).join('') : '<p class="comment-empty">No notes yet.</p>'}</div>
    <form class="note-form" data-note-form><textarea rows="3" maxlength="6000" placeholder="Add a note as ${esc(S.who || 'you')}..."></textarea><button class="secondary-btn" type="submit">Add note ↗</button></form></div>`;
}
async function addNote(kind, id, text, form) {
  if (!text.trim()) return;
  const btn = form.querySelector('button'); btn.disabled = true;
  try {
    await flush(kind, id);
    const { item } = await api('addNote', { kind, id, text });
    (kind === 'idea' ? S.ideas : S.outliers).set(id, item);
    renderLists(); kind === 'idea' ? renderIdeaDrawer() : renderOutlierDrawer();
    $(`#${kind}Overlay .note-form textarea`)?.focus();
  } catch (err) { toast(err.message, 5000); btn.disabled = false; }
}
async function deleteNote(kind, id, noteId) {
  if (!confirm('Delete this note?')) return;
  try { const { item } = await api('deleteNote', { kind, id, noteId }); (kind === 'idea' ? S.ideas : S.outliers).set(id, item); renderLists(); kind === 'idea' ? renderIdeaDrawer() : renderOutlierDrawer(); }
  catch (err) { toast(err.message, 5000); }
}
function tagsHtml(tags) {
  return `<div class="field"><span>Tags</span><div class="tag-editor" data-tag-editor>${(tags || []).map(t => `<span class="chip">${esc(t)}<button class="x" type="button" data-del-tag="${esc(t)}" aria-label="Remove ${esc(t)}">×</button></span>`).join('')}<input type="text" maxlength="40" placeholder="Add a tag, press Enter" data-tag-input></div>
    <div class="tag-suggest">${TAG_IDEAS.filter(t => !(tags || []).includes(t)).slice(0, 14).map(t => `<button type="button" data-add-tag="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div></div>`;
}

/* ---------- outlier drawer ---------- */
function openOutlier(id, push = true) {
  if (!S.outliers.has(id)) return;
  closeDrawers(false, true);
  S.open = { kind: 'outlier', id };
  renderOutlierDrawer();
  $('#outlierOverlay').hidden = false;
  $('#outlierOverlay .task-drawer').scrollTop = 0;
  saveState('');
  if (push) setHash('#outliers/' + encodeURIComponent(id));
}
function renderOutlierDrawer() {
  const o = S.outliers.get(S.open?.id); if (!o || S.open.kind !== 'outlier') return;
  const full = outFull(o), d = o.discord;
  const ideas = [...S.ideas.values()], linked = ideas.filter(i => (i.outlierIds || []).includes(o.id));
  const yt = safeUrl(o.url) || (o.videoId ? 'https://www.youtube.com/watch?v=' + o.videoId : '');
  $('#outlierBody').innerHTML = `
    <a class="big-image" href="${esc(full)}" target="_blank" rel="noopener" title="Open full size">${full ? `<img src="${esc(full)}" alt="">` : '<span class="no-img">No image yet</span>'}</a>
    <p class="source-line">${d ? `From <b>${esc(CHANNEL_LABEL[d.channel] || '#' + d.channel)}</b> · posted by ${esc(d.postedBy || 'someone')} · ${esc(fmtDate(d.postedAt))}${safeUrl(d.messageUrl) ? ` · <a href="${esc(d.messageUrl)}" target="_blank" rel="noopener">Open in Discord ↗</a>` : ''}` : `Added by ${esc(o.addedBy || 'someone')} · ${esc(fmtDate(o.createdAt))}`}</p>
    <div class="action-row">
      <button class="star-toggle" type="button" data-act="star" aria-pressed="${Boolean(o.starred)}">${o.starred ? '★ Starred' : '☆ Star'}</button>
      ${yt ? `<a class="quiet-btn small-btn" href="${esc(yt)}" target="_blank" rel="noopener">▶ Watch on YouTube ↗</a>` : ''}
      <button class="quiet-btn small-btn" type="button" data-act="replace-image">⇪ ${full ? 'Replace' : 'Add'} image</button>
      <button class="primary-btn small-btn" type="button" data-act="new-idea">✳ Start an idea from this</button>
    </div>
    <input type="file" accept="image/*" hidden data-file>
    <label class="field">Title <input type="text" maxlength="300" data-f="title" value="${esc(o.title)}" placeholder="The video's title"></label>
    <div class="row3">
      <label class="field">Channel <input type="text" maxlength="150" data-f="channel" value="${esc(o.channel)}" placeholder="Who made it"></label>
      <label class="field">Views <input type="number" min="0" data-f="views" value="${o.views ?? ''}" placeholder="e.g. 448000"></label>
      <label class="field">Channel subs <input type="number" min="0" data-f="subs" value="${o.subs ?? ''}" placeholder="for the × score"></label>
    </div>
    <label class="field">YouTube link <span class="inline-field"><input type="url" maxlength="1500" data-f="url" value="${esc(o.url)}" placeholder="https://www.youtube.com/watch?v=..."><button class="quiet-btn small-btn" type="button" data-act="lookup">Look up</button></span></label>
    <label class="field">Why it works <span class="field-hint">The face, the contrast, the curiosity gap, the promise. What made people click?</span><textarea rows="5" maxlength="6000" data-f="why" placeholder="e.g. Two faces split down the middle, red vs blue, nobody knows who these people are so you have to click.">${esc(o.why)}</textarea></label>
    <label class="field">What we'd steal <textarea rows="3" maxlength="3000" data-f="steal" placeholder="The bit we could use on one of ours.">${esc(o.steal)}</textarea></label>
    ${tagsHtml(o.tags)}
    <div class="drawer-section"><h3>Used in ideas <small>${linked.length}</small></h3>
      <div class="action-row">${linked.map(i => `<a class="chip" href="#ideas/${esc(i.id)}">${esc(i.title || 'Untitled idea')} ↗</a>`).join('') || '<span class="section-hint" style="margin:0">Not linked to an idea yet.</span>'}</div>
      ${ideas.length ? `<div class="add-row"><select class="mini-input" data-link-idea><option value="">Link to an idea…</option>${ideas.filter(i => !linked.includes(i)).sort((a, b) => String(a.title).localeCompare(String(b.title))).map(i => `<option value="${esc(i.id)}">${esc(i.title || 'Untitled idea')}</option>`).join('')}</select></div>` : ''}
    </div>
    ${notesHtml('outlier', o)}
    <div class="drawer-section action-row">
      <button class="quiet-btn small-btn" type="button" data-act="archive">${o.archived ? '↺ Unarchive' : '⌫ Archive'}</button>
      <button class="danger-btn" type="button" data-act="delete">Delete outlier</button>
    </div>`;
}

async function outlierAction(act, o, el) {
  if (act === 'star') { queueSave('outlier', o.id, { starred: !o.starred }, 0); renderOutlierDrawer(); }
  if (act === 'archive') { queueSave('outlier', o.id, { archived: !o.archived }, 0); toast(o.archived ? 'Archived. Find it under the Archived filter.' : 'Back in the grid.'); renderOutlierDrawer(); }
  if (act === 'delete') {
    if (!confirm('Delete this outlier for everyone? It stays in the backups for 30 days.')) return;
    try { pending.delete('outlier:' + o.id); await api('deleteOutlier', { id: o.id }); S.outliers.delete(o.id); S.ideas.forEach(i => { if (i.outlierIds?.includes(o.id)) i.outlierIds = i.outlierIds.filter(x => x !== o.id); }); closeDrawers(); renderLists(); toast('Deleted.'); }
    catch (err) { toast(err.message, 5000); }
  }
  if (act === 'replace-image') $('#outlierBody [data-file]').click();
  if (act === 'lookup') await lookupInto(o, $('#outlierBody [data-f="url"]').value);
  if (act === 'new-idea') await newIdea({ outlierIds: [o.id] });
}
async function setOutlierImage(o, blob) {
  saveState('Uploading…');
  try { const up = await uploadBlob(blob, 'outlier'); queueSave('outlier', o.id, { image: up.id, imageSmall: up.small, thumbUrl: '' }, 0); renderOutlierDrawer(); renderLists(); }
  catch (err) { saveState('Upload failed', true); toast(err.message, 5000); }
}
async function lookupInto(o, link) {
  if (!ytId(link)) { toast('Paste a YouTube link first.'); return; }
  saveState('Looking up…');
  try {
    const { video: v } = await api('youtube', { url: link });
    const patch = { url: v.url, videoId: v.videoId, statsAt: v.statsAt || '' };
    if (!o.title) patch.title = v.title; if (!o.channel) patch.channel = v.channel;
    if (v.views != null) patch.views = v.views; if (v.subs != null) patch.subs = v.subs; if (v.published) patch.published = v.published;
    if (!o.image && !o.imageSmall) patch.thumbUrl = v.thumb;
    queueSave('outlier', o.id, patch, 0); renderOutlierDrawer(); renderLists();
    if (!o.image) api('importImageUrl', { url: 'https://i.ytimg.com/vi/' + v.videoId + '/hqdefault.jpg' }).then(r => queueSave('outlier', o.id, { image: r.id }, 0)).catch(() => {});
  } catch (err) { saveState(''); toast(err.message, 5000); }
}

/* ---------- idea drawer ---------- */
let ppIndex = 0, ppTitle = 0;
async function newIdea(patch = {}) {
  try {
    await flushAll();
    const { item } = await api('saveIdea', { patch: { title: '', ...patch } });
    item._new = true;
    S.ideas.set(item.id, item); renderLists();
    showTab('ideas', false); openIdea(item.id);
    setTimeout(() => $('#ideaBody .title-input')?.focus(), 60);
  } catch (err) { toast(err.message, 5000); }
}
function openIdea(id, push = true) {
  if (!S.ideas.has(id)) return;
  closeDrawers(false, true);
  S.open = { kind: 'idea', id }; ppIndex = 0; ppTitle = 0;
  renderIdeaDrawer();
  $('#ideaOverlay').hidden = false;
  $('#ideaOverlay .task-drawer').scrollTop = 0;
  saveState('');
  if (push) setHash('#ideas/' + encodeURIComponent(id));
}
function packagePreview(i) {
  const thumbs = [...(i.images || []).map(x => img(x.id)), ...(i.outlierIds || []).map(id => S.outliers.get(id)).filter(Boolean).map(outFull)].filter(Boolean);
  const titles = [...(i.titleOptions || []).filter(t => t.fav), ...(i.titleOptions || []).filter(t => !t.fav)].map(t => t.text).filter(Boolean);
  if (i.title && !titles.includes(i.title)) titles.push(i.title);
  const t = thumbs.length ? thumbs[ppIndex % thumbs.length] : '', title = titles.length ? titles[ppTitle % titles.length] : 'Your title goes here';
  return `<div class="package-preview" data-preview>
    <div class="pp-label">HOW IT WOULD LOOK IN THE FEED</div>
    <div><div class="pp-thumb">${t ? `<img src="${esc(t)}" alt="">` : 'Add a mockup or link an outlier to see a thumbnail here'}</div>${thumbs.length > 1 ? `<button class="pp-cycle" type="button" data-act="pp-thumb">Next thumbnail (${(ppIndex % thumbs.length) + 1}/${thumbs.length}) →</button>` : ''}</div>
    <div><div class="pp-text"><span class="pp-avatar"><img src="../assets/josh-logo-original.webp" alt=""></span><div><p class="pp-title">${esc(title)}</p><div class="pp-meta">Josh Brett ✓<br>— views · just now</div></div></div>${titles.length > 1 ? `<button class="pp-cycle" type="button" data-act="pp-title">Next title (${(ppTitle % titles.length) + 1}/${titles.length}) →</button>` : ''}</div>
  </div>`;
}
function renderIdeaDrawer() {
  const i = S.ideas.get(S.open?.id); if (!i || S.open.kind !== 'idea') return;
  const outs = (i.outlierIds || []).map(id => S.outliers.get(id)).filter(Boolean);
  const d = i.discord;
  $('#ideaBody').innerHTML = `
    <div class="action-row" style="margin-top:16px">
      <select class="status-select ${statusClass(i.status)}" data-f="status" aria-label="Status">${STATUSES.map(s => `<option ${s === (i.status || 'Rough') ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="status-select" data-f="owner" aria-label="Owner"><option value="">No owner</option>${[...new Set([...PEOPLE, i.owner].filter(Boolean))].map(p => `<option ${p === i.owner ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <button class="star-toggle" type="button" data-act="star" aria-pressed="${Boolean(i.starred)}">${i.starred ? '★ Starred' : '☆ Star'}</button>
    </div>
    <label class="field"><span class="sr-only">Working title</span><input class="title-input" type="text" maxlength="300" data-f="title" value="${esc(i.title)}" placeholder="Working title"></label>
    ${d ? `<p class="source-line" style="margin-top:8px">From <b>${esc(CHANNEL_LABEL[d.channel] || '#' + d.channel)}</b> · ${esc(fmtDate(d.postedAt))}${safeUrl(d.messageUrl) ? ` · <a href="${esc(d.messageUrl)}" target="_blank" rel="noopener">Open in Discord ↗</a>` : ''}</p>` : ''}
    ${packagePreview(i)}
    <label class="field">The angle <span class="field-hint">What's the story? Why now? Where's the money? What do we know that nobody else has said?</span><textarea rows="6" maxlength="12000" data-f="premise" placeholder="e.g. Everyone covered the drama. Nobody followed the money behind the credential.">${esc(i.premise)}</textarea></label>
    <label class="field">Hook / first line <span class="field-hint">The sniper shot: first sentence plus the visual.</span><textarea rows="3" maxlength="6000" data-f="hook">${esc(i.hook)}</textarea></label>

    <div class="drawer-section"><h3>Title options <small>★ = FAVOURITE</small></h3>
      <div class="list">${(i.titleOptions || []).map(t => `<div class="list-row ${t.fav ? 'fav' : ''}" data-row="${esc(t.id)}"><button class="icon-btn ${t.fav ? 'on' : ''}" type="button" data-title-fav="${esc(t.id)}" title="Favourite">★</button><input type="text" maxlength="300" value="${esc(t.text)}" data-title-text="${esc(t.id)}"><button class="icon-btn del" type="button" data-title-del="${esc(t.id)}" title="Remove">×</button></div>`).join('')}</div>
      <form class="add-row" data-add-title><input class="mini-input" type="text" maxlength="300" placeholder="Write a title option, press Enter"><button class="quiet-btn small-btn" type="submit">Add</button></form>
    </div>

    <div class="drawer-section"><h3>Thumbnail</h3>
      <label class="field">Concept <textarea rows="3" maxlength="6000" data-f="thumbnailConcept" placeholder="What's in it? Face, object, text, colour.">${esc(i.thumbnailConcept)}</textarea></label>
      <div class="field"><span>Our mockups and references <span class="field-hint">paste (⌘V), drop or click to add</span></span>
        <div class="thumb-board">${(i.images || []).map(x => `<div class="thumb-tile"><a class="open" href="${esc(img(x.id))}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(img(x.small || x.id))}" alt=""></a><button class="icon-btn del tile-x" type="button" data-img-del="${esc(x.id)}" title="Remove">×</button></div>`).join('')}
          <button class="thumb-add" type="button" data-act="add-image" data-drop-idea>＋ Add image</button></div>
        <input type="file" accept="image/*" multiple hidden data-file></div>
      <div class="field"><span>Outliers we're borrowing from</span>
        <div class="thumb-board">${outs.map(o => `<div class="thumb-tile"><button class="open" type="button" data-open-outlier="${esc(o.id)}"><img loading="lazy" src="${esc(outThumb(o))}" alt=""><span class="tile-label">${esc(outName(o))}</span></button><button class="icon-btn del tile-x" type="button" data-unlink="${esc(o.id)}" title="Unlink">×</button></div>`).join('')}
          <button class="thumb-add" type="button" data-act="pick">＋ Pick outliers</button></div></div>
    </div>

    <div class="drawer-section"><h3>Sources <small>${(i.sources || []).length}</small></h3>
      <p class="section-hint">Articles, studies, filings, Wayback links, interviews. Anything we'd cite.</p>
      <div class="list">${(i.sources || []).map(s => `<div class="list-row source-row"><div class="fields grow"><input type="text" maxlength="300" value="${esc(s.label)}" placeholder="Name" data-src-label="${esc(s.id)}">${safeUrl(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : ''}<input class="note" type="text" maxlength="2000" value="${esc(s.note)}" placeholder="Why it matters (optional)" data-src-note="${esc(s.id)}"></div><button class="icon-btn del" type="button" data-src-del="${esc(s.id)}" title="Remove">×</button></div>`).join('')}</div>
      <form class="add-row" data-add-source><input class="mini-input" type="url" placeholder="Paste a link" required><input class="mini-input" type="text" maxlength="300" placeholder="Name (optional)"><button class="quiet-btn small-btn" type="submit">Add</button></form>
    </div>

    <div class="drawer-section"><h3>Similar videos <small>${(i.similar || []).length}</small></h3>
      <p class="section-hint">Who's covered this already, and how it did. Paste a YouTube link.</p>
      <div class="list">${(i.similar || []).map(v => `<div class="list-row video-row">${v.thumb || v.videoId ? `<a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(safeUrl(v.thumb) || 'https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg')}" alt=""></a>` : '<span></span>'}<div class="grow"><div class="t">${safeUrl(v.url) ? `<a href="${esc(v.url)}" target="_blank" rel="noopener" style="color:inherit;font-size:13px">${esc(v.title || v.url)}</a>` : esc(v.title)}</div><div class="sub">${esc([v.channel, v.views != null ? fmtNum(v.views) + ' views' : ''].filter(Boolean).join(' · '))}</div><input class="note" type="text" maxlength="2000" value="${esc(v.note)}" placeholder="What they did / missed (optional)" data-sim-note="${esc(v.id)}" style="font-weight:600;font-size:12px"></div><button class="icon-btn del" type="button" data-sim-del="${esc(v.id)}" title="Remove">×</button></div>`).join('')}</div>
      <form class="add-row" data-add-similar><input class="mini-input" type="url" placeholder="Paste a YouTube link" required><button class="quiet-btn small-btn" type="submit">Add</button></form>
    </div>

    ${notesHtml('idea', i)}
    <div class="drawer-section">${tagsHtml(i.tags)}</div>
    <div class="drawer-section action-row"><span class="source-line">Added ${esc(fmtDate(i.createdAt))} by ${esc(i.addedBy || 'someone')}${i.updatedBy ? ` · last edit ${esc(i.updatedBy)}, ${esc(fmtWhen(i.updatedAt))}` : ''}</span><span style="flex:1"></span><button class="danger-btn" type="button" data-act="delete">Delete idea</button></div>`;
}
function refreshPreview() { const i = S.ideas.get(S.open?.id); const el = $('#ideaBody [data-preview]'); if (i && el) el.outerHTML = packagePreview(i); }
const ideaNow = () => S.ideas.get(S.open?.id);
function saveIdeaList(field, list, rerender = true) { const i = ideaNow(); if (!i) return; queueSave('idea', i.id, { [field]: list }, 300); if (rerender) renderIdeaDrawer(); refreshPreview(); }

async function ideaAction(act, i) {
  if (act === 'star') { queueSave('idea', i.id, { starred: !i.starred }, 0); renderIdeaDrawer(); }
  if (act === 'pp-thumb') { ppIndex++; refreshPreview(); }
  if (act === 'pp-title') { ppTitle++; refreshPreview(); }
  if (act === 'add-image') $('#ideaBody [data-file]').click();
  if (act === 'pick') openPicker(i);
  if (act === 'delete') {
    if (!confirm('Delete this idea for everyone? It stays in the backups for 30 days.')) return;
    try { pending.delete('idea:' + i.id); await api('deleteIdea', { id: i.id }); S.ideas.delete(i.id); closeDrawers(); renderLists(); toast('Deleted.'); }
    catch (err) { toast(err.message, 5000); }
  }
}
async function addIdeaImages(files) {
  const i = ideaNow(); if (!i) return;
  const list = [...files].filter(f => /^image\//.test(f.type));
  if (!list.length) return;
  saveState('Uploading…');
  for (const f of list) {
    try { const up = await uploadBlob(f, 'idea'); const cur = ideaNow(); if (!cur) return; saveIdeaList('images', [...(cur.images || []), { id: up.id, small: up.small, caption: '' }]); }
    catch (err) { toast(err.message, 5000); }
  }
}

/* ---------- outlier picker ---------- */
let pickSel = new Set(), pickFor = null;
function openPicker(i) { pickFor = i.id; pickSel = new Set(i.outlierIds || []); $('#pickSearch').value = ''; renderPicker(); $('#pickOverlay').hidden = false; setTimeout(() => $('#pickSearch').focus(), 50); }
function renderPicker() {
  const q = $('#pickSearch').value.trim().toLowerCase();
  const list = [...S.outliers.values()].filter(o => !o.archived && (!q || [o.title, o.channel, o.why, ...(o.tags || [])].join(' ').toLowerCase().includes(q))).sort((a, b) => (pickSel.has(b.id) - pickSel.has(a.id)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  $('#pickCount').textContent = pickSel.size + ' picked';
  $('#pickGrid').innerHTML = list.map(o => `<button class="pick-item" type="button" data-pick="${esc(o.id)}" aria-pressed="${pickSel.has(o.id)}"><img loading="lazy" src="${esc(outThumb(o))}" alt=""><span>${esc(outName(o))}</span></button>`).join('') || '<p class="section-hint">No outliers yet.</p>';
}
function closePicker(save) {
  $('#pickOverlay').hidden = true;
  if (save && pickFor && S.ideas.has(pickFor)) { const i = S.ideas.get(pickFor); const keep = (i.outlierIds || []).filter(id => pickSel.has(id)); const add = [...pickSel].filter(id => !keep.includes(id)); queueSave('idea', i.id, { outlierIds: [...keep, ...add] }, 0); if (S.open?.id === i.id) renderIdeaDrawer(); renderLists(); }
  pickFor = null;
}

/* ---------- add outlier dialog ---------- */
let addBlob = null, addVideo = null;
function openAdd({ blob = null, url = '' } = {}) {
  addBlob = null; addVideo = null;
  $('#addForm').reset(); $('#addPreview').hidden = true; $('#addDropText').hidden = false; $('#addStatus').textContent = ''; $('#addSave').disabled = false;
  $('#addOverlay').hidden = false;
  if (blob) setAddBlob(blob);
  if (url) { $('#addUrl').value = url; addLookup(); } else setTimeout(() => $('#addUrl').focus(), 50);
}
function setAddBlob(blob) { addBlob = blob; const p = $('#addPreview'); p.src = URL.createObjectURL(blob); p.hidden = false; $('#addDropText').hidden = true; }
async function addLookup() {
  const link = $('#addUrl').value.trim();
  if (!ytId(link)) { $('#addStatus').textContent = 'That doesn\'t look like a YouTube link.'; return; }
  $('#addStatus').textContent = 'Looking up…';
  try {
    const { video: v } = await api('youtube', { url: link });
    addVideo = v;
    if (!$('#addTitleInput').value) $('#addTitleInput').value = v.title;
    if (!$('#addChannel').value) $('#addChannel').value = v.channel;
    if (!$('#addViews').value && v.views != null) $('#addViews').value = v.views;
    if (!addBlob) { const p = $('#addPreview'); p.src = v.thumb; p.hidden = false; $('#addDropText').hidden = true; }
    $('#addStatus').textContent = 'Found it ✓';
  } catch (err) { $('#addStatus').textContent = err.message; }
}
async function saveAdd(e) {
  e.preventDefault();
  if (!addBlob && !addVideo && !ytId($('#addUrl').value)) { $('#addStatus').textContent = 'Add a screenshot or a YouTube link first.'; return; }
  $('#addSave').disabled = true; $('#addStatus').textContent = 'Saving…';
  try {
    if (!addVideo && ytId($('#addUrl').value)) await addLookup();
    const patch = { title: $('#addTitleInput').value.trim(), channel: $('#addChannel').value.trim(), why: $('#addWhy').value.trim() };
    const views = $('#addViews').value; if (views !== '') patch.views = Number(views);
    if (addVideo) Object.assign(patch, { url: addVideo.url, videoId: addVideo.videoId, subs: addVideo.subs, published: addVideo.published || '', statsAt: addVideo.statsAt || '', thumbUrl: addBlob ? '' : addVideo.thumb });
    if (addBlob) { const up = await uploadBlob(addBlob, 'outlier'); patch.image = up.id; patch.imageSmall = up.small; }
    else if (addVideo) { try { patch.image = (await api('importImageUrl', { url: 'https://i.ytimg.com/vi/' + addVideo.videoId + '/hqdefault.jpg' })).id; } catch {} }
    const { item } = await api('saveOutlier', { patch });
    S.outliers.set(item.id, item);
    $('#addOverlay').hidden = true;
    S.outFilter = 'all'; S.tagFilter = ''; renderLists();
    toast('Added. Open it any time to write down why it works.');
  } catch (err) { $('#addStatus').textContent = err.message; $('#addSave').disabled = false; }
}
async function quickAddFiles(files) {
  const list = [...files].filter(f => /^image\//.test(f.type));
  if (!list.length) return;
  if (list.length === 1) { openAdd({ blob: list[0] }); return; }
  let done = 0;
  toast(`Adding ${list.length} screenshots…`, 60000);
  for (const f of list) {
    try { const up = await uploadBlob(f, 'outlier'); const { item } = await api('saveOutlier', { patch: { image: up.id, imageSmall: up.small } }); S.outliers.set(item.id, item); done++; toast(`Added ${done} of ${list.length}…`, 60000); }
    catch (err) { toast(err.message, 5000); }
  }
  renderLists(); toast(`Added ${done} outliers. Give them titles and notes when you can.`);
}

/* ---------- backups tab ---------- */
let backupData = null;
async function renderBackups(fetchFresh) {
  const grid = $('#backupGrid');
  if (fetchFresh || !backupData) {
    if (!S.code || !S.loaded) { grid.innerHTML = '<div class="empty-state">Connect first.</div>'; return; }
    grid.innerHTML = '<div class="empty-state">Checking backups…</div>';
    try { backupData = await api('backups'); } catch (err) { grid.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`; return; }
  }
  const st = backupData.status || {}, snaps = backupData.snapshots || [];
  const driveOk = st.driveConfigured && !st.lastDriveError && st.lastDrive;
  grid.innerHTML = `
    <section class="backup-card local"><h3>◷ Daily snapshots (automatic)</h3><div class="body">
      <p>Once a day the whole machine is copied and kept for 30 days, on the same Netlify site. If something gets deleted or overwritten by mistake, restore a day from here.</p>
      <p>${st.lastSnapshot ? `<span class="ok-line">✓ Last snapshot ${esc(fmtWhen(st.lastSnapshot))}</span>` : '<span class="warn-line">No snapshot yet. The first runs within the hour, or press Back up now.</span>'}</p>
      <div class="snap-list">${snaps.map(k => `<div><span>${esc(k.startsWith('daily/') ? fmtDate(k.slice(6)) : 'Before a restore · ' + k.split('/')[1].slice(0, 16).replace('T', ' '))}</span><button class="quiet-btn small-btn" type="button" data-restore="${esc(k)}">Restore</button></div>`).join('') || '<p class="section-hint">None yet.</p>'}</div>
    </div></section>
    <section class="backup-card drive"><h3>☁ Google Drive copy (off-site)</h3><div class="body">
      ${driveOk ? `<p class="ok-line">✓ Copied to Drive ${esc(fmtWhen(st.lastDrive))}</p>` : ''}
      ${st.lastDriveError ? `<p class="warn-line">${esc(st.lastDriveError)}</p>` : ''}
      <p>A readable Google Sheet (every idea and outlier, with your notes), the full data file and every image, in a Drive folder called <b>Josh Brett Ideation Machine backups</b>. Updated every hour when something changes.</p>
      ${st.folderUrl ? `<p><a href="${esc(safeUrl(st.folderUrl))}" target="_blank" rel="noopener">Open the Drive folder ↗</a>${st.sheetUrl ? ` · <a href="${esc(safeUrl(st.sheetUrl))}" target="_blank" rel="noopener">Open the sheet ↗</a>` : ''}</p>` : ''}
      <p>Images on Drive: <b>${st.imagesOnDrive || 0}</b> of <b>${st.imagesTotal || 0}</b>${st.imagesTotal && st.imagesOnDrive < st.imagesTotal ? ' (the rest follow in batches each hour)' : ''}</p>
      ${!driveOk ? `<ol class="setup-steps"><li>Open the Studio bridge script in Google Apps Script and replace Code.gs with the new one from GitHub (google-apps-script/Code.gs).</li><li>Run <b>studioSelfTest</b> and press Allow (it now asks for Google Drive too).</li><li>Deploy → Manage deployments → ✎ → New version → Deploy.</li><li>Come back here and press Back up now.</li></ol>` : ''}
    </div></section>
    <section class="backup-card"><h3>⤓ Download a copy</h3><div class="body">
      <p>Everything as one file: <b>${S.ideas.size}</b> ideas and <b>${S.outliers.size}</b> outliers, with all notes, sources and links. Keep it anywhere.</p>
      <button class="quiet-btn" type="button" data-download>⤓ Download backup</button>
    </div></section>`;
}
async function download() {
  try {
    const data = await api('export');
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ideation-machine-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) { toast(err.message, 5000); }
}

/* ---------- one-time Discord import ----------
 * Started from the Discord tab: it opens this page with #discord-import=<list of posts> in the address.
 * Images are copied from Discord's CDN (the links expire after about a day), shrunk, and saved here. */
function captureImport() {
  if (!location.hash.startsWith('#discord-import=')) return;
  try { const raw = decodeURIComponent(location.hash.slice('#discord-import='.length)); JSON.parse(raw); store('sessionStorage', IMPORT_KEY, raw); } catch { toast('That Discord import link was incomplete.'); }
  setHash('#outliers', false);
}
let importing = false;
async function maybeImport() {
  const raw = store('sessionStorage', IMPORT_KEY); if (!raw || importing || !S.loaded) return;
  let manifest; try { manifest = JSON.parse(raw); } catch { store('sessionStorage', IMPORT_KEY, null); return; }
  const { keys } = await api('discordKeys');
  const done = new Set(keys);
  const todo = (manifest.items || []).filter(x => !done.has(x.k));
  const outs = todo.filter(x => x.kind !== 'idea').length, ideas = todo.filter(x => x.kind === 'idea').length;
  const skipped = (manifest.items || []).length - todo.length;
  const chans = [...new Set(todo.map(x => x.c))].map(c => CHANNEL_LABEL[c] || '#' + c).join(', ');
  $('#importBody').innerHTML = todo.length
    ? `<p class="import-stats">Ready to bring in <b>${outs}</b> outlier screenshot${outs === 1 ? '' : 's'}${ideas ? ` and <b>${ideas}</b> rough idea${ideas === 1 ? '' : 's'}` : ''} from ${esc(chans)}.${skipped ? ` <b>${skipped}</b> already here will be skipped.` : ''}</p><p class="section-hint">It copies every image across, so it takes a few minutes. Keep this tab open.</p><div class="progress"><span id="importBar"></span></div><p class="section-hint" id="importStatus"></p><div class="form-actions"><span></span><button class="primary-btn" type="button" id="importGo">Import now ↗</button></div>`
    : `<p class="import-stats">Everything from Discord is already here ✓</p><div class="form-actions"><span></span><button class="primary-btn" type="button" data-close>Done</button></div>`;
  $('#importOverlay').hidden = false;
  if (!todo.length) store('sessionStorage', IMPORT_KEY, null);
  $('#importGo')?.addEventListener('click', () => runImport(manifest, todo));
}
async function fetchToUpload(u) {
  try { const res = await fetch(u, { mode: 'cors' }); if (!res.ok) throw new Error(String(res.status)); const blob = await res.blob(); return await uploadBlob(blob, 'discord'); }
  catch { const r = await api('importImageUrl', { url: u }); return { id: r.id, small: '' }; }
}
async function runImport(manifest, todo) {
  importing = true;
  const go = $('#importGo'); go.disabled = true; go.textContent = 'Importing…';
  let made = 0, failed = 0, n = 0;
  const batch = [];
  const send = async () => { if (!batch.length) return; const rows = batch.splice(0); const r = await api('importDiscord', { items: rows }); made += r.created; };
  const status = () => { $('#importBar').style.width = Math.round(n / todo.length * 100) + '%'; $('#importStatus').textContent = `${n} of ${todo.length} done${failed ? `, ${failed} couldn't be copied` : ''}`; };
  const queue = todo.slice();
  async function worker() {
    while (queue.length) {
      const x = queue.shift();
      try {
        const images = [];
        for (const u of (x.u || [])) images.push(await fetchToUpload(u));
        const author = /^joshbrett/i.test(x.a || '') ? 'Josh' : (x.a || 'Josh');
        batch.push({ key: x.k, kind: x.kind === 'idea' ? 'idea' : 'outlier', channel: x.c, postedBy: author, postedAt: x.t, messageUrl: x.m, text: x.x || '', title: x.title || '', image: images[0]?.id || '', imageSmall: images[0]?.small || '', images });
        if (batch.length >= 8) await send();
      } catch (err) { failed++; console.warn('import', x.k, err); }
      n++; status();
    }
  }
  try {
    await Promise.all([worker(), worker(), worker()]);
    await send();
    store('sessionStorage', IMPORT_KEY, null);
    $('#importBody').innerHTML = `<p class="import-stats">Done ✓ Brought in <b>${made}</b> from Discord.${failed ? ` <b>${failed}</b> couldn't be copied (their Discord links had probably expired): run the import again from Discord to pick them up.` : ''}</p><div class="form-actions"><span></span><button class="primary-btn" type="button" data-close>Have a look ↗</button></div>`;
    await load({ quiet: true });
  } catch (err) {
    $('#importStatus').textContent = 'Stopped: ' + err.message + '. Press Import now to carry on, nothing is duplicated.';
    go.disabled = false; go.textContent = 'Import now ↗';
  } finally { importing = false; }
}

/* ---------- who is this ---------- */
function openWho() {
  $('#whoChoices').innerHTML = PEOPLE.map(p => `<button type="button" data-who="${esc(p)}" aria-pressed="${S.who === p}">${esc(p)}</button>`).join('');
  $('#whoOther').value = PEOPLE.includes(S.who) ? '' : S.who;
  $('#whoOverlay').hidden = false;
}
function setWho(name) { S.who = String(name || '').trim().slice(0, 40); store('localStorage', WHO_KEY, S.who); $('#whoName').textContent = S.who || '?'; $('#whoOverlay').hidden = true; if (S.open) S.open.kind === 'idea' ? renderIdeaDrawer() : renderOutlierDrawer(); }

/* ---------- closing ---------- */
function closeDrawers(push = true, keepHash = false) {
  const was = S.open;
  if (was) {
    flush(was.kind, was.id);
    if (was.kind === 'idea') { const i = S.ideas.get(was.id); if (i?._new && !i.title && !i.premise && !(i.notes || []).length && !(i.outlierIds || []).length && !(i.images || []).length && !(i.titleOptions || []).length) { api('deleteIdea', { id: i.id }).catch(() => {}); S.ideas.delete(i.id); renderLists(); } else if (i) delete i._new; }
  }
  $('#outlierOverlay').hidden = true; $('#ideaOverlay').hidden = true;
  S.open = null;
  if (push && !keepHash) setHash('#' + S.tab);
}
function closeTop() {
  for (const id of ['pickOverlay', 'addOverlay', 'whoOverlay', 'importOverlay']) if (!$('#' + id).hidden) { if (id === 'pickOverlay') closePicker(true); else $('#' + id).hidden = true; return; }
  if (S.open) closeDrawers();
}

/* ---------- events ---------- */
function bind() {
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => { closeDrawers(false); showTab(b.dataset.tab); }));
  $('#refreshBtn').addEventListener('click', () => load()); $('#refreshBtn2').addEventListener('click', () => load());
  $('#addOutlierBtn').addEventListener('click', () => openAdd());
  $('#newIdeaBtn').addEventListener('click', () => newIdea());
  $('#statsBtn').addEventListener('click', async e => { e.currentTarget.disabled = true; try { const r = await api('refreshStats'); r.items.forEach(o => S.outliers.set(o.id, o)); renderLists(); toast(`Updated views on ${r.items.length} outliers.`); } catch (err) { toast(err.message, 5000); } e.target.closest('button').disabled = false; });
  $('#outlierSearch').addEventListener('input', e => { S.outQuery = e.target.value; S.outLimit = 96; renderOutliers(); });
  $('#outlierSort').addEventListener('change', e => { S.outSort = e.target.value; renderOutliers(); });
  $('#ideaSearch').addEventListener('input', e => { S.ideaQuery = e.target.value; renderIdeas(); });
  $('#ideaSort').addEventListener('change', e => { S.ideaSort = e.target.value; renderIdeas(); });
  $('#downloadBtn').addEventListener('click', download);
  $('#backupNowBtn').addEventListener('click', async e => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Backing up…'; try { await flushAll(); const { result } = await api('backupNow'); toast(result.driveError ? 'Snapshot saved. Drive copy: ' + result.driveError : `Backed up ✓${result.images ? ` (${result.images} images copied to Drive)` : ''}`, 6000); await renderBackups(true); } catch (err) { toast(err.message, 6000); } b.disabled = false; b.textContent = '◷ Back up now'; });

  // connect
  $('#connectionBtn').addEventListener('click', () => { if (!S.code) showConnect(); else load(); });
  $('#connectForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#accessCode').value.trim(); if (!code) return;
    S.code = code; $('#connectError').textContent = 'Checking…';
    try { const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-board-key': code }, body: '{"action":"list"}' }); if (r.status === 401) { $('#connectError').textContent = 'That code didn\'t work.'; S.code = ''; return; } }
    catch { $('#connectError').textContent = 'Couldn\'t reach the site. Check your connection.'; return; }
    setCode(code, $('#rememberDevice').checked); $('#connectOverlay').hidden = true; $('#accessCode').value = ''; load();
  });
  // who
  $('#whoBtn').addEventListener('click', openWho);
  $('#whoChoices').addEventListener('click', e => { const b = e.target.closest('[data-who]'); if (b) setWho(b.dataset.who); });
  $('#whoForm').addEventListener('submit', e => { e.preventDefault(); if ($('#whoOther').value.trim()) setWho($('#whoOther').value); });
  $('#forgetDevice').addEventListener('click', () => { if (!confirm('Forget the Studio access code on this device? You\'ll need it again for the Studio and this page.')) return; setCode('', false); store('sessionStorage', SESSION_KEY, null); S.code = ''; setConnected(false); $('#whoOverlay').hidden = true; showConnect(); });

  // add dialog
  $('#addForm').addEventListener('submit', saveAdd);
  $('#addFetch').addEventListener('click', addLookup);
  $('#addUrl').addEventListener('paste', () => setTimeout(() => { if (ytId($('#addUrl').value)) addLookup(); }, 30));
  const drop = $('#addDrop');
  drop.addEventListener('click', () => $('#addFile').click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#addFile').click(); } });
  $('#addFile').addEventListener('change', e => { if (e.target.files[0]) setAddBlob(e.target.files[0]); });
  ['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('drag-over')));
  drop.addEventListener('drop', e => { e.preventDefault(); const f = [...e.dataTransfer.files].find(x => /^image\//.test(x.type)); if (f) setAddBlob(f); });

  // picker
  $('#pickSearch').addEventListener('input', renderPicker);
  $('#pickGrid').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (!b) return; const id = b.dataset.pick; pickSel.has(id) ? pickSel.delete(id) : pickSel.add(id); b.setAttribute('aria-pressed', String(pickSel.has(id))); $('#pickCount').textContent = pickSel.size + ' picked'; });
  $('#pickDone').addEventListener('click', () => closePicker(true));

  // grid drop (several screenshots at once)
  const grid = $('#outlierGrid');
  ['dragover', 'dragenter'].forEach(t => grid.addEventListener(t, e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); grid.classList.add('drag-over'); } }));
  ['dragleave', 'drop'].forEach(t => grid.addEventListener(t, () => grid.classList.remove('drag-over')));
  grid.addEventListener('drop', e => { e.preventDefault(); quickAddFiles(e.dataTransfer.files); });

  // overlays: close buttons and backdrops
  document.addEventListener('click', e => {
    const close = e.target.closest('[data-close]');
    if (close) { const ov = close.closest('.overlay'); if (ov?.id === 'pickOverlay') closePicker(true); else if (ov?.id === 'outlierOverlay' || ov?.id === 'ideaOverlay') closeDrawers(); else if (ov) ov.hidden = true; return; }
    const t = e.target.closest('[data-out-filter],[data-tag-filter],[data-idea-filter],[data-open-outlier],[data-open-idea],[data-more-outliers],[data-restore],[data-download],[data-copy-link],a[href^="#ideas/"],a[href^="#outliers/"]');
    if (!t) return;
    if (t.dataset.outFilter) { S.outFilter = t.dataset.outFilter; S.outLimit = 96; renderOutliers(); }
    else if (t.dataset.tagFilter) { S.tagFilter = S.tagFilter === t.dataset.tagFilter ? '' : t.dataset.tagFilter; renderOutliers(); }
    else if (t.dataset.ideaFilter) { S.ideaFilter = t.dataset.ideaFilter; renderIdeas(); }
    else if (t.dataset.openOutlier) { if (S.open?.kind === 'idea') { flush('idea', S.open.id); } showTab('outliers', false); openOutlier(t.dataset.openOutlier); }
    else if (t.dataset.openIdea) openIdea(t.dataset.openIdea);
    else if (t.hasAttribute('data-more-outliers')) { S.outLimit += 96; renderOutliers(); }
    else if (t.dataset.restore) { if (confirm('Replace everything with this snapshot? What\'s here now is saved first, so you can undo it.')) api('restore', { key: t.dataset.restore }).then(() => { toast('Restored ✓'); load(); renderBackups(true); }).catch(err => toast(err.message, 6000)); }
    else if (t.hasAttribute('data-download')) download();
    else if (t.hasAttribute('data-copy-link')) { const url = location.origin + location.pathname + location.hash; navigator.clipboard?.writeText(url).then(() => toast('Link copied.'), () => prompt('Copy this link:', url)); }
    else if (t.matches('a[href^="#ideas/"]')) { e.preventDefault(); const id = t.getAttribute('href').split('/')[1]; flush('outlier', S.open?.id || ''); showTab('ideas', false); openIdea(id); }
    else if (t.matches('a[href^="#outliers/"]')) { e.preventDefault(); showTab('outliers', false); openOutlier(t.getAttribute('href').split('/')[1]); }
  });

  // drawers: fields, lists, notes, tags
  for (const kind of ['outlier', 'idea']) {
    const body = $('#' + kind + 'Body');
    const item = () => (kind === 'idea' ? S.ideas : S.outliers).get(S.open?.id);
    body.addEventListener('input', e => {
      const f = e.target.dataset.f; const it = item(); if (!f || !it) return;
      let v = e.target.value;
      if (e.target.type === 'number') v = v === '' ? null : Number(v);
      queueSave(kind, it.id, { [f]: v }, e.target.tagName === 'SELECT' ? 0 : 800);
      if (kind === 'idea' && f === 'title') refreshPreview();
      if (kind === 'idea' && f === 'status') e.target.className = 'status-select ' + statusClass(v);
    });
    body.addEventListener('change', e => {
      const it = item(); if (!it) return;
      if (e.target.matches('[data-file]')) { kind === 'idea' ? addIdeaImages(e.target.files) : e.target.files[0] && setOutlierImage(it, e.target.files[0]); e.target.value = ''; }
      if (e.target.matches('[data-link-idea]') && e.target.value) { const i = S.ideas.get(e.target.value); if (i) { queueSave('idea', i.id, { outlierIds: [...new Set([...(i.outlierIds || []), it.id])] }, 0); renderOutlierDrawer(); renderLists(); toast('Linked to "' + (i.title || 'Untitled idea') + '".'); } }
      const tt = e.target.dataset.titleText, sl = e.target.dataset.srcLabel, sn = e.target.dataset.srcNote, vn = e.target.dataset.simNote;
      if (tt) saveIdeaList('titleOptions', it.titleOptions.map(t => (t.id === tt ? { ...t, text: e.target.value } : t)), false);
      if (sl) saveIdeaList('sources', it.sources.map(s => (s.id === sl ? { ...s, label: e.target.value } : s)), false);
      if (sn) saveIdeaList('sources', it.sources.map(s => (s.id === sn ? { ...s, note: e.target.value } : s)), false);
      if (vn) saveIdeaList('similar', it.similar.map(v => (v.id === vn ? { ...v, note: e.target.value } : v)), false);
    });
    body.addEventListener('click', e => {
      const it = item(); if (!it) return;
      const b = e.target.closest('button,[data-act]'); if (!b) return;
      if (b.dataset.act) { kind === 'idea' ? ideaAction(b.dataset.act, it, b) : outlierAction(b.dataset.act, it, b); return; }
      if (b.dataset.delNote) return deleteNote(kind, it.id, b.dataset.delNote);
      if (b.dataset.delTag) { queueSave(kind, it.id, { tags: (it.tags || []).filter(t => t !== b.dataset.delTag) }, 300); kind === 'idea' ? renderIdeaDrawer() : renderOutlierDrawer(); return; }
      if (b.dataset.addTag) { queueSave(kind, it.id, { tags: [...new Set([...(it.tags || []), b.dataset.addTag])] }, 300); kind === 'idea' ? renderIdeaDrawer() : renderOutlierDrawer(); return; }
      if (kind !== 'idea') return;
      if (b.dataset.titleFav) return saveIdeaList('titleOptions', it.titleOptions.map(t => ({ ...t, fav: t.id === b.dataset.titleFav ? !t.fav : false })));
      if (b.dataset.titleDel) return saveIdeaList('titleOptions', it.titleOptions.filter(t => t.id !== b.dataset.titleDel));
      if (b.dataset.srcDel) return saveIdeaList('sources', it.sources.filter(s => s.id !== b.dataset.srcDel));
      if (b.dataset.simDel) return saveIdeaList('similar', it.similar.filter(v => v.id !== b.dataset.simDel));
      if (b.dataset.imgDel) { if (confirm('Remove this image from the idea?')) saveIdeaList('images', it.images.filter(x => x.id !== b.dataset.imgDel)); return; }
      if (b.dataset.unlink) return saveIdeaList('outlierIds', it.outlierIds.filter(x => x !== b.dataset.unlink));
    });
    body.addEventListener('keydown', e => {
      if (e.target.matches('[data-tag-input]') && e.key === 'Enter') { e.preventDefault(); const it = item(); const v = e.target.value.trim(); if (it && v) { queueSave(kind, it.id, { tags: [...new Set([...(it.tags || []), v])] }, 300); kind === 'idea' ? renderIdeaDrawer() : renderOutlierDrawer(); $(`#${kind}Body [data-tag-input]`)?.focus(); } }
      if (e.target.matches('.note-form textarea') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.form.requestSubmit(); }
    });
    body.addEventListener('submit', async e => {
      e.preventDefault(); const it = item(); if (!it) return;
      const form = e.target;
      if (form.matches('[data-note-form]')) return addNote(kind, it.id, form.querySelector('textarea').value, form);
      if (form.matches('[data-add-title]')) { const v = form.querySelector('input').value.trim(); if (!v) return; saveIdeaList('titleOptions', [...(it.titleOptions || []), { id: uid(), text: v, fav: !(it.titleOptions || []).length }]); $('#ideaBody [data-add-title] input')?.focus(); }
      if (form.matches('[data-add-source]')) {
        const [u, l] = form.querySelectorAll('input'); const link = u.value.trim(); if (!/^https?:\/\//i.test(link)) { toast('Paste a full link starting with http'); return; }
        let label = l.value.trim(); if (!label) { try { label = new URL(link).hostname.replace(/^www\./, ''); } catch {} }
        saveIdeaList('sources', [...(it.sources || []), { id: uid(), label, url: link, note: '' }]);
      }
      if (form.matches('[data-add-similar]')) {
        const input = form.querySelector('input'), link = input.value.trim(), btn = form.querySelector('button');
        if (!ytId(link)) { toast('Paste a YouTube link.'); return; }
        btn.disabled = true;
        try { const { video: v } = await api('youtube', { url: link }); const cur = ideaNow(); saveIdeaList('similar', [...(cur.similar || []), { id: uid(), url: v.url, videoId: v.videoId, title: v.title, channel: v.channel, views: v.views, thumb: 'https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg', note: '' }]); }
        catch (err) { toast(err.message, 5000); btn.disabled = false; }
      }
    });
  }
  // drop images on an idea's mockup tile
  $('#ideaBody').addEventListener('dragover', e => { const z = e.target.closest('[data-drop-idea]'); if (z) { e.preventDefault(); z.classList.add('drag-over'); } });
  $('#ideaBody').addEventListener('dragleave', e => e.target.closest('[data-drop-idea]')?.classList.remove('drag-over'));
  $('#ideaBody').addEventListener('drop', e => { const z = e.target.closest('[data-drop-idea]'); if (z) { e.preventDefault(); addIdeaImages(e.dataTransfer.files); } });

  // paste: screenshots and YouTube links
  document.addEventListener('paste', e => {
    if (!S.loaded) return;
    const typing = e.target.closest('input,textarea,select,[contenteditable]');
    const file = [...(e.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
    const text = e.clipboardData?.getData('text') || '';
    if (!$('#addOverlay').hidden) { if (file) { e.preventDefault(); setAddBlob(file); } return; }
    if (!$('#pickOverlay').hidden || !$('#whoOverlay').hidden || !$('#connectOverlay').hidden || !$('#importOverlay').hidden) return;
    if (S.open?.kind === 'idea') { if (file && !typing) { e.preventDefault(); addIdeaImages([file]); } return; }
    if (S.open?.kind === 'outlier') { if (file && !typing && confirm('Replace this outlier\'s image with the one you pasted?')) { e.preventDefault(); setOutlierImage(S.outliers.get(S.open.id), file); } return; }
    if (typing || S.tab === 'backups') return;
    if (file) { e.preventDefault(); showTab('outliers'); openAdd({ blob: file }); }
    else if (ytId(text)) { e.preventDefault(); showTab('outliers'); openAdd({ url: text.trim() }); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTop(); });
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', () => { captureImport(); route(); maybeImport(); });
  window.addEventListener('focus', () => { if (S.code && S.loaded && !S.open && !pending.size && Date.now() - S.loadedAt > 60000) load({ quiet: true }); });
}

/* ---------- start ---------- */
captureImport();
document.addEventListener('DOMContentLoaded', () => {
  bind();
  $('#whoName').textContent = S.who || '?';
  S.code = savedCode();
  route();
  if (S.code) load(); else showConnect();
});
})();
