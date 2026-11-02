/**
 * Hourly Zoho Mail → Email log sync. Netlify runs this on the schedule below; it is not reachable
 * over HTTP. The same sync can be run on demand from the app ("Sync now" → sponsorships function).
 * Does nothing until the Zoho variables are set in Netlify (see README → Sponsorships tab).
 */
import { runSync, zohoStatus } from '../lib/zoho-sync.mjs';

export default async function handler() {
  const status = zohoStatus();
  if (!status.configured) { console.log('zoho-sync: not configured, skipping (' + status.missing.join(', ') + ')'); return new Response('skipped'); }
  try {
    const result = await runSync({ url: process.env.STUDIO_CALENDAR_SCRIPT_URL, secret: process.env.STUDIO_CALENDAR_SCRIPT_SECRET, pageBudget: 4, trigger: 'schedule' });
    console.log('zoho-sync: ' + JSON.stringify(result));
    return new Response(JSON.stringify(result));
  } catch (error) {
    console.error('zoho-sync failed: ' + String(error.message || error));
    return new Response('failed', { status: 500 });
  }
}

export const config = { schedule: '@hourly' };
