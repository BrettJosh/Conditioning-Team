/**
 * Hourly Ideation Machine backup. Netlify runs this on the schedule below; it is not reachable over HTTP.
 * Takes the daily snapshot (once a day) and keeps the Google Drive copy current. See ../lib/ideation-backup.mjs.
 * The same backup can be run on demand from the page: Backups → Back up now.
 */
import { runBackup } from '../lib/ideation-backup.mjs';

export default async function handler() {
  try {
    const result = await runBackup({ budgetMs: 25000 });
    console.log('ideation-backup: ' + JSON.stringify(result));
    return new Response(JSON.stringify(result));
  } catch (error) {
    console.error('ideation-backup failed: ' + String(error.message || error));
    return new Response('failed', { status: 500 });
  }
}

export const config = { schedule: '@hourly' };
