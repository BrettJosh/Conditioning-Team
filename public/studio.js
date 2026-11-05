/*
 * Josh Brett Studio - shared glue, loaded before the other scripts.
 *  - Auth: remembers the workspace access code on this device (or only for this browser session on a shared computer).
 *  - Router: one place that switches tabs and keeps the address bar in step, so every tab and every open item has a link:
 *      #overview · #daisy · #josh · #archive · #production · #calendar · #sponsorships
 *      #josh/task/<notion id> · #production/video/<id> · #production/blocked · #calendar/2026-11-12
 *      #sponsorships/brands/<id> · #sponsorships/agencies/<id> · #sponsorships/waiting-on-you · #sponsorships/actions
 *  - Events: studio:tab (tab shown), studio:connection (connected / disconnected), studio:data (a module's data changed).
 */
(() => {
'use strict';
const CODE_KEY = 'josh-brett-studio-access-code';          // localStorage: remembered on this device
const SESSION_KEY = 'josh-brett-studio-access-code-tab';    // sessionStorage: "don't remember this device"
const TAB_KEY = 'studio-active-tab';
const area = name => { try { return window[name]; } catch { return null; } };
const get = (name, key) => { try { return area(name)?.getItem(key) || ''; } catch { return ''; } };
const put = (name, key, value) => { try { area(name).setItem(key, value); return true; } catch { return false; } };
const del = (name, key) => { try { area(name)?.removeItem(key); } catch {} };

/* ---------- the workspace code ---------- */
const Auth = {
  get() {
    const local = get('localStorage', CODE_KEY), tab = get('sessionStorage', SESSION_KEY);
    if (local || tab) return local || tab;
    // The old site kept the code per browser session under CODE_KEY: carry it over to "remembered" so nobody is asked again.
    const legacy = get('sessionStorage', CODE_KEY);
    if (legacy) { del('sessionStorage', CODE_KEY); put('localStorage', CODE_KEY, legacy) || put('sessionStorage', SESSION_KEY, legacy); }
    return legacy;
  },
  remembered: () => Boolean(get('localStorage', CODE_KEY)),
  set(code, remember = true) {
    Auth.clear();
    if (remember && put('localStorage', CODE_KEY, code)) return;
    put('sessionStorage', SESSION_KEY, code);
  },
  clear() { del('localStorage', CODE_KEY); del('sessionStorage', SESSION_KEY); del('sessionStorage', CODE_KEY); }
};

/* ---------- events ---------- */
const emit = (name, detail = {}) => document.dispatchEvent(new CustomEvent('studio:' + name, { detail }));
const on = (name, fn) => document.addEventListener('studio:' + name, e => fn(e.detail || {}));

/* ---------- connection readiness ----------
 * app.js tries the saved code on load. Anything that needs the shared data waits for that first attempt,
 * so a link opened straight into the calendar doesn't fail with "connect first" while the code is being checked. */
let markReady;
const ready = new Promise(resolve => { markReady = resolve; });
let mode = 'demo', isReady = false;
function setMode(next) {
  const changed = next !== mode; mode = next;
  if (!isReady) { isReady = true; markReady(mode); return; }
  if (changed) emit('connection', { mode });
}
const connected = () => mode === 'notion';

/* ---------- router ---------- */
const TABS = ['today', 'weekly', 'josh', 'archive', 'production', 'calendar', 'sponsorships'];
const SLUG = { weekly: 'daisy', today: 'overview' }; // address-bar names for internal tab ids
const ALIAS = { daisy: 'weekly', overview: 'today' }; // #today still works for links shared before the rename
const fromSlug = slug => ALIAS[slug] || (TABS.includes(slug) ? slug : null);
const WORKSPACE = { today: 'todayWorkspace', weekly: 'weeklyWorkspace', josh: 'weeklyWorkspace', archive: 'weeklyWorkspace', production: 'productionWorkspace', calendar: 'calendarWorkspace', sponsorships: 'sponsorWorkspace' };
const handlers = {}; // tab -> { open(itemParts), close() }
let current = null, linkItem = null; // linkItem: { tab, item } for the drawer that is open now

function parse(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  const tab = fromSlug((parts[0] || '').toLowerCase());
  return tab ? { tab, item: parts.slice(1) } : null;
}
const hashFor = (tab, item) => '#' + [SLUG[tab] || tab, ...(item || [])].map(encodeURIComponent).join('/');
const link = (tab, item) => location.origin + location.pathname + hashFor(tab, item);
let handled = null; // the hash the page already reflects, so popstate + hashchange for one navigation run once
function writeHash(tab, item, push) {
  const h = hashFor(tab, item);
  handled = h;
  if (location.hash === h) return;
  try { history[push ? 'pushState' : 'replaceState'](null, '', h); } catch { location.hash = h; }
}

function show(tab, { push = true, item = null } = {}) {
  if (!TABS.includes(tab)) tab = 'today';
  const changed = tab !== current;
  if (changed && current) closeDrawers();
  current = tab;
  const target = WORKSPACE[tab];
  new Set(Object.values(WORKSPACE)).forEach(id => { const el = document.getElementById(id); if (el) el.hidden = id !== target; });
  document.querySelectorAll('[data-view-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.viewTab === tab)));
  put('sessionStorage', TAB_KEY, tab);
  writeHash(tab, item && item.length ? item : null, push && changed);
  if (changed) { emit('tab', { tab }); if (push) window.scrollTo({ top: Math.min(window.scrollY, document.querySelector('.studio-tabs')?.offsetTop || 0) }); }
  if (item && item.length) openItem(tab, item);
}
async function openItem(tab, item) {
  const h = handlers[tab]; if (!h?.open) return;
  try { await ready; await h.open(item); }
  catch (err) { window.StudioBoard?.toast('Could not open that link: ' + (err?.message || err)); }
}
function closeDrawers() {
  Object.values(handlers).forEach(h => { try { h.close?.(); } catch {} });
}
/** Called by a module when one of its drawers opens (item = path parts) or closes (item = null). */
function setItem(tab, item) {
  linkItem = item && item.length ? { tab, item } : null;
  document.querySelectorAll('[data-copy-link]').forEach(b => { b.hidden = !linkItem; });
  // The address bar follows the drawer only when it belongs to the tab on screen; a drawer opened from the Overview leaves #overview in place.
  if (tab === current || (['weekly', 'josh', 'archive'].includes(tab) && ['weekly', 'josh', 'archive'].includes(current))) writeHash(current, linkItem ? linkItem.item : null, false);
}
function register(tabs, handler) { [].concat(tabs).forEach(t => { handlers[t] = handler; }); }

function fromLocation(force) {
  if (force !== true && location.hash === handled) return;
  handled = location.hash;
  const route = parse(location.hash);
  if (route) show(route.tab, { push: false, item: route.item });
  else show('today', { push: false });
}
async function copyLink() {
  if (!linkItem) return;
  const url = link(linkItem.tab, linkItem.item);
  try { await navigator.clipboard.writeText(url); window.StudioBoard?.toast('Link copied. Paste it anywhere to open this.'); }
  catch { window.prompt('Copy this link:', url); }
}

function boot() {
  // A "Copy link" button beside the close button on every side drawer.
  document.querySelectorAll('.task-drawer .drawer-top').forEach(top => {
    const close = top.querySelector('.icon-close'); if (!close || top.querySelector('[data-copy-link]')) return;
    const group = document.createElement('div'); group.className = 'drawer-top-actions';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'copy-link-btn'; btn.dataset.copyLink = ''; btn.hidden = true;
    btn.innerHTML = '⧉ <span>Copy link</span>'; btn.title = 'Copy a link that opens this straight away';
    btn.addEventListener('click', copyLink);
    close.replaceWith(group); group.append(btn, close);
  });
  document.querySelectorAll('[data-view-tab]').forEach(b => b.addEventListener('click', () => show(b.dataset.viewTab)));
  // Plain #links anywhere on the page (the Overview uses them) go through the router too.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const route = parse(a.getAttribute('href')); if (!route) return;
    e.preventDefault(); show(route.tab, { item: route.item });
  });
  window.addEventListener('popstate', fromLocation);
  window.addEventListener('hashchange', fromLocation);
  fromLocation(true);
}
// Deferred scripts run in order before DOMContentLoaded, so every module has registered by the time the first route runs.
document.addEventListener('DOMContentLoaded', boot);

window.Studio = { Auth, on, emit, ready, isReady: () => isReady, setMode, connected, show, setItem, register, link, current: () => current, closeDrawers };
})();
