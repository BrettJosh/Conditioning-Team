/**
 * Josh Brett Studio — Sponsorships bridge. Runs ONLY server-side on Netlify.
 * Gated by BOARD_ACCESS_CODE like every other function. Sheet actions are proxied to the same
 * Apps Script deployment as the content calendar (STUDIO_CALENDAR_SCRIPT_URL / SECRET);
 * Zoho actions use netlify/lib/zoho-sync.mjs.
 */
import { timingSafeEqual } from 'node:crypto';
import { runSync, exchangeCode, zohoStatus } from '../lib/zoho-sync.mjs';

const fail = (error, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const same = (a, b) => { if (!a || !b) return false; const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
const text = (v, max) => String(v ?? '').slice(0, max);
const TABS = ['brands', 'agencies'];
const FIELDS = {
  brands: ['name', 'status', 'summary', 'nextStep', 'lastActivity', 'firstContact', 'via', 'contact', 'initiatedBy', 'category', 'rate', 'agreedValue', 'history'],
  agencies: ['name', 'status', 'summary', 'lastActivity', 'firstContact', 'contact', 'type', 'terms', 'brands', 'history']
};
const validDate = d => d === '' || (typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) && !Number.isNaN(new Date(d + 'T12:00:00Z').getTime()));

function cleanPatch(tab, patch) {
  const out = {};
  for (const key of FIELDS[tab]) {
    if (!(key in (patch || {}))) continue;
    let value = patch[key];
    if (key === 'lastActivity' || key === 'firstContact') { value = text(value, 10); if (!validDate(value)) throw Object.assign(new Error('Dates must be YYYY-MM-DD.'), { status: 400 }); }
    else if (key === 'agreedValue') { value = value === '' || value == null ? '' : Number(value); if (value !== '' && (!Number.isFinite(value) || value < 0)) throw Object.assign(new Error('Agreed value must be a number.'), { status: 400 }); }
    else value = text(value, key === 'history' ? 6000 : key === 'contact' ? 1500 : 800);
    out[key] = value;
  }
  return out;
}

export default async function handler(request) {
  if (request.method !== 'POST') return fail('POST required.', 405);
  if (!same(request.headers.get('x-board-key'), process.env.BOARD_ACCESS_CODE)) return fail('Invalid workspace access code.', 401);
  let data; try { data = await request.json(); } catch { return fail('Invalid request JSON.'); }
  const action = String(data.action || '');
  const url = process.env.STUDIO_CALENDAR_SCRIPT_URL, secret = process.env.STUDIO_CALENDAR_SCRIPT_SECRET;

  try {
    if (action === 'zohoStatus') return Response.json({ ok: true, ...zohoStatus() }, { headers: { 'Cache-Control': 'no-store' } });
    if (action === 'zohoSetup') {
      const status = zohoStatus();
      if (status.configured && !data.force) return fail('Zoho Mail is already connected. Remove ZOHO_REFRESH_TOKEN in Netlify first if you want to reconnect.');
      const code = text(data.code, 200).trim();
      if (!code) return fail('Paste the grant code from the Zoho API console.');
      const result = await exchangeCode(code);
      return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'zohoSync') {
      const result = await runSync({ url, secret, pageBudget: Math.min(6, Math.max(1, Number(data.pages) || 4)), trigger: 'manual' });
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (!url || !secret) return fail('Sponsorships connection is not configured yet. Follow the sponsorships README to connect Google Sheets.', 503);
    if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(url)) return fail('Invalid Apps Script URL.', 503);

    let payload;
    if (action === 'sponsorList') payload = { action };
    else if (action === 'sponsorUpdate' || action === 'sponsorAdd' || action === 'sponsorNote' || action === 'sponsorAssign') {
      const tab = TABS.includes(data.tab) ? data.tab : 'brands';
      if (action === 'sponsorUpdate') payload = { action, tab, id: text(data.id, 40), patch: cleanPatch(tab, data.patch) };
      if (action === 'sponsorAdd') payload = { action, tab, record: cleanPatch(tab, data.record) };
      if (action === 'sponsorNote') {
        const note = text(data.text, 1500).trim(); if (!note) return fail('Write a note first.');
        const date = text(data.date, 10); if (!validDate(date)) return fail('Dates must be YYYY-MM-DD.');
        payload = { action, tab, id: text(data.id, 40), text: note, date, direction: ['in', 'out', 'note'].includes(data.direction) ? data.direction : 'note' };
      }
      if (action === 'sponsorAssign') payload = { action, tab, id: text(data.id, 40), messageId: text(data.messageId, 80), saveContact: text(data.saveContact, 200) };
    }
    else if (action === 'sponsorAction') payload = { action, row: Number(data.row) || 0, what: text(data.what, 500), done: Boolean(data.done) };
    else return fail('Unsupported sponsorship action.');

    const upstream = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, secret }), redirect: 'follow', signal: AbortSignal.timeout(19000) });
    const raw = await upstream.text(); let parsed; try { parsed = JSON.parse(raw); } catch { return fail('Google Sheets connection returned an unexpected response. Check the Apps Script: run studioSelfTest in the editor, then deploy a new version.', 502); }
    if (!upstream.ok || !parsed.ok) return fail(parsed.error || 'Google Sheets update failed.', upstream.status >= 400 && upstream.status < 500 ? 400 : 502);
    return Response.json(parsed, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(String(e.message || e), e.status || 502);
  }
}
