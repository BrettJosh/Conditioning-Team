/**
 * Zoho Mail → Sponsorships "Email log" sync. Server-side only (Netlify functions).
 *
 * Environment variables (Netlify → Project configuration → Environment variables):
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET  — from the Self Client in the Zoho API console
 *   ZOHO_REFRESH_TOKEN                  — produced once by the "Connect Zoho Mail" step in the app
 *   ZOHO_REGION                         — data centre of the mailbox: eu (default), com, in, com.au, jp, ca, sa, com.cn, ae
 *   ZOHO_OWN_ADDRESSES (optional)       — extra comma-separated addresses that count as "Josh"
 *   STUDIO_CALENDAR_SCRIPT_URL / STUDIO_CALENDAR_SCRIPT_SECRET — the existing Apps Script bridge
 *
 * How it works: every run lists the newest messages in Inbox and Sent, matches each one to a brand
 * or agency in the tracker (by contact address, company domain, or an already-matched thread), and
 * appends the new ones to the sheet's Email log. The first runs walk backwards through the mailbox
 * until the backfill horizon (BACKFILL_FROM, default 2026-07-01), a few pages per run, so the hourly
 * schedule (or the Sync now button) finishes the history over a handful of runs.
 */
const REGIONS = {
  com: { accounts: 'https://accounts.zoho.com', mail: 'https://mail.zoho.com' },
  eu: { accounts: 'https://accounts.zoho.eu', mail: 'https://mail.zoho.eu' },
  in: { accounts: 'https://accounts.zoho.in', mail: 'https://mail.zoho.in' },
  'com.au': { accounts: 'https://accounts.zoho.com.au', mail: 'https://mail.zoho.com.au' },
  jp: { accounts: 'https://accounts.zoho.jp', mail: 'https://mail.zoho.jp' },
  ca: { accounts: 'https://accounts.zohocloud.ca', mail: 'https://mail.zohocloud.ca' },
  sa: { accounts: 'https://accounts.zoho.sa', mail: 'https://mail.zoho.sa' },
  'com.cn': { accounts: 'https://accounts.zoho.com.cn', mail: 'https://mail.zoho.com.cn' },
  ae: { accounts: 'https://accounts.zoho.ae', mail: 'https://mail.zoho.ae' }
};
const FREEMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'pm.me', 'aol.com', 'mail.com', 'msn.com', 'zoho.com', 'zohomail.com', 'zohomail.eu', 'ymail.com', 'gmx.com', 'fastmail.com', 'hey.com']);
// "Brand x Josh Brett", "Josh x Subs", "Josh Brett x Brand" all count as sponsorship subjects.
const KEYWORDS = /\b(sponsor(ship|ed|s)?|partnership|partner with|partnering|collab(oration|orate)?|brand deal|paid (promotion|partnership|collab|opportunity)|integration|media kit|rate card|your rates?|influencer|creator (program|partnership|team)|campaign|ambassador|affiliate program|product seeding|gifting)\b|\bjosh(?: brett)? x \S|\S x josh\b/i;
const AUTOMATED = /^(no-?reply|noreply|do-?not-?reply|notifications?|newsletter|mailer-daemon|postmaster|bounce|alerts?|updates?|hello@(substack|medium)|digest|security|account-?security|verify|verification)/i;
// Zoho's own account notices ("Backup email address…") are never sponsorship mail, even when flagged.
const SYSTEM_DOMAIN = /(^|\.)(zoho\.(com|eu|in|jp|sa|ae|com\.au|com\.cn)|zohocorp\.com|zohomail\.(com|eu)|zohocloud\.ca|zohoaccounts\.com)$/i;
const isAutomated = address => AUTOMATED.test(String(address || '').split('@')[0] || '') || SYSTEM_DOMAIN.test(String(address || '').split('@')[1] || '');
/** Zoho returns flagid "flag_not_set" for unflagged mail and "info" / "important" / "followup" for the three flags. */
export const isFlagged = message => { const f = String(message?.flagid ?? '').trim().toLowerCase(); return f !== '' && f !== 'flag_not_set' && f !== '0' && f !== 'none'; };
const FLAG_STATE_MAX_CHARS = 7000; // keeps the whole sync state well inside the sheet's 20,000-character meta cell
const FLAG_CATCHUP_DAYS = 21;
const PAGE_SIZE = 200;
const OVERLAP = 20;
const RECENT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const HORIZON_DEFAULT = '2026-07-01';

let tokenCache = { token: '', expires: 0, key: '' };

export function zohoConfig() {
  const regionKey = String(process.env.ZOHO_REGION || 'eu').trim().toLowerCase();
  const region = REGIONS[regionKey] || REGIONS.eu;
  return {
    regionKey: REGIONS[regionKey] ? regionKey : 'eu',
    accounts: region.accounts,
    mail: region.mail,
    clientId: (process.env.ZOHO_CLIENT_ID || '').trim(),
    clientSecret: (process.env.ZOHO_CLIENT_SECRET || '').trim(),
    refreshToken: (process.env.ZOHO_REFRESH_TOKEN || '').trim(),
    ownExtra: String(process.env.ZOHO_OWN_ADDRESSES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    horizon: /^\d{4}-\d\d-\d\d$/.test(String(process.env.ZOHO_BACKFILL_FROM || '')) ? process.env.ZOHO_BACKFILL_FROM : HORIZON_DEFAULT
  };
}

export function zohoStatus() {
  const cfg = zohoConfig();
  const missing = [];
  if (!cfg.clientId) missing.push('ZOHO_CLIENT_ID');
  if (!cfg.clientSecret) missing.push('ZOHO_CLIENT_SECRET');
  if (!cfg.refreshToken) missing.push('ZOHO_REFRESH_TOKEN');
  return { configured: missing.length === 0, missing, region: cfg.regionKey, canExchange: Boolean(cfg.clientId && cfg.clientSecret), horizon: cfg.horizon };
}

async function tokenRequest(cfg, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(cfg.accounts + '/oauth/v2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(12000) });
  let data; try { data = await res.json(); } catch { throw new Error('Zoho accounts server returned an unreadable response.'); }
  if (!res.ok || data.error) throw new Error('Zoho OAuth: ' + (data.error_description || data.error || res.status) + (data.error === 'invalid_code' ? ' (the code expires in minutes — generate a fresh one)' : ''));
  return data;
}

/** One-time: exchange a Self Client grant code for a refresh token. The token is shown to the person, never stored here. */
export async function exchangeCode(code) {
  const cfg = zohoConfig();
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in Netlify first, then redeploy.');
  const data = await tokenRequest(cfg, { grant_type: 'authorization_code', client_id: cfg.clientId, client_secret: cfg.clientSecret, code: String(code || '').trim() });
  if (!data.refresh_token) throw new Error('Zoho did not return a refresh token. Generate the code again with scopes ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.folders.READ and retry within its expiry window.');
  return { refreshToken: data.refresh_token, apiDomain: data.api_domain || cfg.mail, region: cfg.regionKey };
}

async function accessToken(cfg) {
  const key = cfg.refreshToken.slice(-12) + cfg.regionKey;
  if (tokenCache.token && tokenCache.key === key && Date.now() < tokenCache.expires) return tokenCache.token;
  const data = await tokenRequest(cfg, { grant_type: 'refresh_token', client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken });
  if (!data.access_token) throw new Error('Zoho OAuth: no access token returned. Check ZOHO_REFRESH_TOKEN and ZOHO_REGION.');
  tokenCache = { token: data.access_token, expires: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000, key };
  return tokenCache.token;
}

async function zohoGet(cfg, token, path, params = {}) {
  const url = new URL(cfg.mail + path);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });
  const res = await fetch(url, { headers: { Authorization: 'Zoho-oauthtoken ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  let data; try { data = await res.json(); } catch { throw new Error('Zoho Mail returned an unreadable response for ' + path + '.'); }
  if (!res.ok || (data.status && data.status.code && data.status.code >= 400)) throw new Error('Zoho Mail ' + path + ': ' + (data.status?.description || data.data?.errorCode || data.data?.moreInfo || res.status));
  return data.data;
}

export const decodeEntities = s => String(s ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
export const parseAddresses = text => Array.from(new Set((decodeEntities(text).match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(a => a.toLowerCase().replace(/^'+|'+$/g, ''))));
export const domainOf = address => String(address || '').split('@')[1] || '';

/** Address and domain lookup built from the tracker's Contact columns. Agencies are indexed first: an address that
 * belongs to an agency is primarily the agency's, and the brands it represents are bumped as secondary matches. */
export function buildIndex(ctx) {
  const index = { address: new Map(), domain: new Map() };
  const push = (map, key, hit) => { const list = map.get(key) || []; if (!list.some(h => h.tab === hit.tab && h.id === hit.id)) list.push(hit); map.set(key, list); };
  const add = (tab, record) => {
    const hit = { tab, id: record.id, name: record.name };
    parseAddresses(record.contact).forEach(address => {
      push(index.address, address, hit);
      const domain = domainOf(address);
      if (domain && !FREEMAIL.has(domain)) push(index.domain, domain, hit);
    });
  };
  (ctx.agencies || []).forEach(r => add('agencies', r));
  (ctx.brands || []).forEach(r => add('brands', r));
  return index;
}

/** Decides whether a Zoho message belongs in the Email log, and to which record. Returns null to skip it.
 * options.force keeps an unmatched email even without sponsorship wording (used for flagged emails and replies to them). */
export function matchMessage(message, index, threads, own, options = {}) {
  const from = parseAddresses(message.fromAddress)[0] || '';
  const tos = parseAddresses(message.toAddress);
  const ccs = parseAddresses(message.ccAddress === 'Not Provided' ? '' : message.ccAddress);
  const direction = own.has(from) ? 'out' : 'in';
  const others = [from, ...tos, ...ccs].filter(a => a && !own.has(a));
  const subject = decodeEntities(message.subject || '').trim();
  const snippet = decodeEntities(message.summary || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  let hits = [], by = '';
  for (const a of others) { if (index.address.has(a)) { hits = hits.concat(index.address.get(a)); by = by || 'address'; } }
  if (!hits.length) for (const a of others) { const d = domainOf(a); if (d && index.domain.has(d)) { hits = hits.concat(index.domain.get(d)); by = by || 'domain'; } }
  if (!hits.length && message.threadId && threads && threads[message.threadId]) { hits = [threads[message.threadId]]; by = 'thread'; }
  const seen = new Set(); hits = hits.filter(h => { const k = h.tab + '|' + h.id; if (seen.has(k)) return false; seen.add(k); return true; });
  const hit = hits[0] || null;
  if (!hit) {
    if (direction === 'in' && isAutomated(from)) return null;
    if (options.force) by = 'flagged';
    else {
      if (!KEYWORDS.test(subject) && !KEYWORDS.test(snippet.slice(0, 160))) return null;
      if (/unsubscribe|view (this|in) browser|manage preferences/i.test(snippet)) return null;
      by = 'keyword';
    }
  }
  const ms = Number(message.receivedTime || message.sentDateInGMT || 0);
  const date = ms ? new Date(ms).toISOString() : '';
  const senderName = decodeEntities(message.sender || '').trim();
  return {
    date, direction,
    matchedTo: hit ? hit.name : '', tab: hit ? hit.tab : 'unmatched', recordId: hit ? hit.id : '',
    from: senderName && senderName.toLowerCase() !== from ? senderName + ' <' + from + '>' : from,
    to: tos.join(', '), subject, snippet,
    messageId: String(message.messageId || ''), threadId: String(message.threadId || ''), folder: message.folderLabel || '', matchedBy: by,
    also: hits.slice(1).map(h => ({ tab: h.tab, id: h.id, name: h.name }))
  };
}

async function callScript(url, secret, payload) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, secret }), redirect: 'follow', signal: AbortSignal.timeout(19000) });
  const raw = await res.text(); let data; try { data = JSON.parse(raw); } catch { throw new Error('Google Sheets bridge returned an unexpected response. Check the Apps Script deployment.'); }
  if (!res.ok || !data.ok) throw new Error(data.error || 'Google Sheets bridge failed.');
  return data;
}

function ownAddresses(account, cfg) {
  const own = new Set(cfg.ownExtra);
  if (account) {
    [account.primaryEmailAddress, account.mailboxAddress, account.incomingUserName].forEach(a => { if (a && String(a).includes('@')) own.add(String(a).toLowerCase()); });
    (account.emailAddress || []).forEach(e => { if (e?.mailId) own.add(String(e.mailId).toLowerCase()); });
    (account.sendMailDetails || []).forEach(s => { if (s?.fromAddress) own.add(String(s.fromAddress).toLowerCase()); });
  }
  return own;
}

async function resolveAccount(cfg, token, state) {
  if (state.accountId && Array.isArray(state.own) && state.own.length && state.folders?.inbox && state.folders?.sent) return state;
  const accounts = await zohoGet(cfg, token, '/api/accounts');
  const account = (accounts || []).find(a => a.primaryEmailAddress) || (accounts || [])[0];
  if (!account?.accountId) throw new Error('No Zoho Mail account found for this token. Check the scopes include ZohoMail.accounts.READ.');
  const folders = await zohoGet(cfg, token, '/api/accounts/' + account.accountId + '/folders');
  const find = (names, types) => (folders || []).find(f => types.includes(String(f.folderType || '').toLowerCase()) || names.includes(String(f.folderName || f.path || '').toLowerCase().replace(/^\//, '')));
  const inbox = find(['inbox'], ['inbox']);
  const sent = find(['sent', 'sent items', 'sent mail'], ['sent']);
  if (!inbox || !sent) throw new Error('Could not find the Inbox and Sent folders in Zoho (found: ' + (folders || []).map(f => f.folderName).join(', ') + ').');
  return { ...state, accountId: String(account.accountId), mailbox: account.primaryEmailAddress || '', own: Array.from(ownAddresses(account, cfg)), folders: { inbox: String(inbox.folderId), sent: String(sent.folderId) } };
}

/**
 * Runs one sync chunk. options: { url, secret } for the Apps Script, pageBudget (pages across both folders).
 * Returns a summary for the UI; the sheet keeps the state between runs.
 */
/** Netlify stops a web request after ~10 s, so a manual run stops fetching once this much time has gone and writes what it has. */
const TIME_BUDGET_MS = { manual: 4500, schedule: 6500 };
export async function runSync({ url, secret, pageBudget = 4, trigger = 'schedule' } = {}) {
  const cfg = zohoConfig();
  const status = zohoStatus();
  if (!status.configured) throw Object.assign(new Error('Zoho Mail is not connected yet. Missing: ' + status.missing.join(', ') + '.'), { status: 503 });
  if (!url || !secret) throw Object.assign(new Error('Google Sheets bridge is not configured (STUDIO_CALENDAR_SCRIPT_URL / SECRET).'), { status: 503 });
  const started = Date.now();
  const ctx = await callScript(url, secret, { action: 'sponsorSyncContext' });
  const index = buildIndex(ctx);
  const known = new Set(ctx.knownMessageIds || []);
  const threads = ctx.threads || {};
  let state = ctx.sync && typeof ctx.sync === 'object' ? { ...ctx.sync } : {};
  try {
    const token = await accessToken(cfg);
    state = await resolveAccount(cfg, token, state);
    const own = new Set(state.own || []);
    const horizonMs = new Date(cfg.horizon + 'T00:00:00Z').getTime();
    state.backfill = state.backfill && state.backfill.horizon === cfg.horizon ? state.backfill : { horizon: cfg.horizon, startedAt: new Date(started).toISOString(), inbox: { start: 1, done: false }, sent: { start: 1, done: false } };
    const backfilling = !(state.backfill.inbox.done && state.backfill.sent.done);
    const sinceMs = state.lastSyncAt ? new Date(state.lastSyncAt).getTime() - RECENT_LOOKBACK_MS : horizonMs;
    const found = [];
    const keep = hit => { found.push(hit); known.add(hit.messageId); if (hit.tab !== 'unmatched' && hit.threadId && !threads[hit.threadId]) threads[hit.threadId] = { tab: hit.tab, id: hit.recordId, name: hit.matchedTo }; };
    const msOf = message => Number(message.receivedTime || message.sentDateInGMT || 0);

    // Zoho flags = "I need to reply to this". Every run takes a fresh snapshot of the flagged Inbox emails, so clearing
    // a flag in Zoho clears it here too. Each flagged email is logged even when it doesn't read like a sponsorship,
    // and so are later emails in its thread and Josh's replies to that sender, which is how the app knows it was answered.
    let flagItems = null;
    const flagThreads = new Set(), flagSenders = new Set();
    try {
      const page = await zohoGet(cfg, token, '/api/accounts/' + state.accountId + '/messages/view', { folderId: state.folders.inbox, start: 1, limit: PAGE_SIZE, sortBy: 'date', sortorder: false, includeto: true, flaggedMails: true });
      flagItems = [];
      for (const message of (Array.isArray(page) ? page : [])) {
        const id = String(message.messageId || ''), ms = msOf(message);
        const from = parseAddresses(message.fromAddress)[0] || '';
        if (!id || !isFlagged(message) || (ms && ms < horizonMs) || own.has(from) || isAutomated(from)) continue;
        if (!known.has(id)) { const hit = matchMessage({ ...message, folderLabel: 'Inbox' }, index, threads, own, { force: true }); if (!hit) continue; keep(hit); }
        const thread = String(message.threadId || '');
        flagItems.push({ m: id, t: thread, a: from, f: String(message.flagid), d: ms ? new Date(ms).toISOString() : '' });
        flagThreads.add(id); if (thread) flagThreads.add(thread); if (from) flagSenders.add(from);
      }
      delete state.flagError;
    } catch (error) {
      state.flagError = { at: new Date().toISOString(), message: String(error.message || error) }; // the normal sync still runs
    }
    const flagRelated = message => {
      const thread = String(message.threadId || '');
      if (thread && flagThreads.has(thread)) return true;
      return parseAddresses([message.fromAddress, message.toAddress, message.ccAddress].join(',')).some(a => flagSenders.has(a));
    };
    // The first run that reads flags also looks back through Sent (up to three weeks) so replies already sent count.
    const oldestFlag = (flagItems || []).reduce((min, f) => Math.min(min, f.d ? new Date(f.d).getTime() : min), Infinity);
    const catchupMs = !backfilling && flagItems && flagItems.length && !state.flagCatchupDone ? Math.max(oldestFlag, started - FLAG_CATCHUP_DAYS * 86400000) : 0;
    let catchupDone = !catchupMs;

    let pagesUsed = 0, scanned = 0;
    for (const key of ['inbox', 'sent']) {
      const folderId = state.folders[key];
      const label = key === 'inbox' ? 'Inbox' : 'Sent';
      const bf = state.backfill[key];
      let start = backfilling ? (bf.done ? null : bf.start) : 1;
      if (start === null) continue;
      const floor = backfilling ? horizonMs : (key === 'sent' && catchupMs ? Math.min(sinceMs, catchupMs) : sinceMs);
      while (pagesUsed < pageBudget) {
        if (Date.now() - started > (TIME_BUDGET_MS[trigger] || TIME_BUDGET_MS.manual)) break;
        const page = await zohoGet(cfg, token, '/api/accounts/' + state.accountId + '/messages/view', { folderId, start, limit: PAGE_SIZE, sortBy: 'date', sortorder: false, includeto: true });
        pagesUsed++;
        const list = Array.isArray(page) ? page : [];
        scanned += list.length;
        let stop = list.length < PAGE_SIZE;
        for (const message of list) {
          const ms = msOf(message);
          if (ms && ms < floor) { stop = true; break; }
          if (known.has(String(message.messageId))) continue;
          const hit = matchMessage({ ...message, folderLabel: label }, index, threads, own, { force: flagRelated(message) });
          if (hit) keep(hit);
        }
        if (backfilling) { bf.start = start + PAGE_SIZE - OVERLAP; if (stop) bf.done = true; }
        if (stop) { if (key === 'sent') catchupDone = true; break; }
        start += PAGE_SIZE - OVERLAP;
      }
    }
    if (flagItems) {
      flagItems.sort((a, b) => b.d.localeCompare(a.d));
      while (flagItems.length && JSON.stringify(flagItems).length > FLAG_STATE_MAX_CHARS) flagItems.pop();
      state.flags = { at: new Date().toISOString(), items: flagItems };
      if (catchupMs && catchupDone) state.flagCatchupDone = true;
    }
    const nowBackfillDone = state.backfill.inbox.done && state.backfill.sent.done;
    // Steady state scans from the last successful run; a just-finished backfill resumes from the moment it began,
    // so mail that arrived while the history was being walked is still picked up.
    if (!backfilling) state.lastSyncAt = new Date(started).toISOString();
    else if (nowBackfillDone) state.lastSyncAt = state.backfill.startedAt || new Date(started).toISOString();
    state.lastRun = { at: new Date().toISOString(), trigger, added: 0, scanned, pagesUsed, backfillDone: nowBackfillDone, flagged: flagItems ? flagItems.length : null, ms: Date.now() - started };
    delete state.lastError;
    found.sort((a, b) => a.date.localeCompare(b.date));
    if (found.length > 250) { // write the rest next run: the pages are re-walked thanks to the overlap + known-id dedupe
      for (const key of ['inbox', 'sent']) { const bf = state.backfill[key]; if (bf && !bf.done) bf.start = Math.max(1, bf.start - PAGE_SIZE); }
      found.length = 250;
    }
    const result = await callScript(url, secret, { action: 'sponsorEmails', emails: found, state: { ...state, lastRun: { ...state.lastRun, added: found.length } } });
    return { ok: true, added: result.added, skipped: result.skipped, touched: result.touched, scanned, pagesUsed, backfillDone: nowBackfillDone, flagged: flagItems ? flagItems.length : null, backfillRemaining: nowBackfillDone ? 0 : (pagesUsed >= pageBudget ? 1 : 0), mailbox: state.mailbox, lastSyncAt: state.lastSyncAt || '' };
  } catch (error) {
    state.lastError = { at: new Date().toISOString(), message: String(error.message || error) };
    try { await callScript(url, secret, { action: 'sponsorSyncState', state }); } catch {}
    throw error;
  }
}
