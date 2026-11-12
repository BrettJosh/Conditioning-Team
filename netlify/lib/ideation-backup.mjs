/**
 * Ideation Machine backups.
 *
 * 1. Daily snapshot inside Netlify (store "ideation-backups", key daily/YYYY-MM-DD), last 30 days kept.
 *    Restorable from the page (Backups tab). A restore first saves the current state under before-restore/<time>.
 * 2. Off-site copy to Google Drive through the Studio's existing Apps Script bridge (STUDIO_CALENDAR_SCRIPT_URL):
 *    a readable Google Sheet (Video ideas, Outliers), ideation-machine-latest.json plus a dated copy each day,
 *    and every image as a file. Images go a batch at a time so each hourly run stays well inside Netlify's time limit.
 *    Needs the updated Code.gs (bridge version 6). Until then the Drive copy reports what to do and the snapshots still run.
 */
import { createHash } from 'node:crypto';
import { store, readDb, imageIds, readImage, imageKey, imageExt, replaceAll } from './ideation-store.mjs';

const KEEP_DAYS = 30;
const IMAGE_BATCH_BYTES = 6 * 1024 * 1024;
const IMAGE_BATCH_COUNT = 20;
const londonDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

async function backups() { return store('ideation-backups'); }
async function readState() {
  const s = await backups();
  return (await s.get('state', { type: 'json' }).catch(() => null)) || { driveImages: [] };
}
async function writeState(state) { const s = await backups(); await s.setJSON('state', state); }

export async function backupStatus(known) {
  const st = await readState();
  const db = known || (await readDb()).db;
  const ids = imageIds(db), done = new Set(st.driveImages || []);
  return {
    lastSnapshot: st.lastSnapshot || '', lastDrive: st.lastDrive || '', lastDriveError: st.lastDriveError || '', lastRun: st.lastRun || '',
    driveConfigured: Boolean(process.env.STUDIO_CALENDAR_SCRIPT_URL && process.env.STUDIO_CALENDAR_SCRIPT_SECRET),
    folderUrl: st.folderUrl || '', sheetUrl: st.sheetUrl || '',
    imagesTotal: ids.length, imagesOnDrive: ids.filter(id => done.has(id)).length
  };
}

export async function listSnapshots() {
  const s = await backups();
  const { blobs } = await s.list({ prefix: 'daily/' });
  const before = (await s.list({ prefix: 'before-restore/' })).blobs;
  return [...blobs, ...before].map(b => b.key).sort().reverse();
}

export async function restoreSnapshot(key) {
  if (!/^(daily\/\d{4}-\d\d-\d\d|before-restore\/[\w.:-]+)$/.test(key)) throw Object.assign(new Error('Unknown snapshot.'), { status: 400 });
  const s = await backups();
  const snap = await s.get(key, { type: 'json' });
  if (!snap?.outliers || !snap?.ideas) throw Object.assign(new Error('That snapshot is empty or unreadable.'), { status: 404 });
  const { db: current } = await readDb();
  await s.setJSON('before-restore/' + new Date().toISOString().replace(/[:.]/g, '-'), current);
  await replaceAll(snap);
}

async function callBridge(payload, timeoutMs) {
  const url = process.env.STUDIO_CALENDAR_SCRIPT_URL, secret = process.env.STUDIO_CALENDAR_SCRIPT_SECRET;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, secret }), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  const raw = await res.text();
  let data; try { data = JSON.parse(raw); } catch { throw new Error('Google returned a page instead of data. Re-approve the Studio bridge script (run studioSelfTest) and deploy a new version.'); }
  if (!data.ok) throw new Error(/Unknown calendar action|Unknown/i.test(data.error || '') ? 'The Studio bridge script needs updating to version 6 for Google Drive backups (see README → Ideation Machine).' : (data.error || 'Google Drive backup failed.'));
  return data;
}

/**
 * Run the backup. `force` makes a fresh snapshot and Drive copy even if nothing changed.
 * `budgetMs` is how long this run may take in total (scheduled functions get 30 seconds).
 */
export async function runBackup({ force = false, budgetMs = 24000 } = {}) {
  const started = Date.now(), left = () => budgetMs - (Date.now() - started);
  const { db } = await readDb();
  const state = await readState();
  const s = await backups();
  const today = londonDate(), out = { snapshot: false, drive: false, images: 0 };
  state.lastRun = new Date().toISOString();

  // 1. Daily snapshot (skip an empty workspace so a blank start never pushes out real history).
  const hasData = Object.keys(db.outliers).length + Object.keys(db.ideas).length > 0;
  if (hasData && (force || state.lastSnapshotDay !== today)) {
    await s.setJSON('daily/' + today, db);
    state.lastSnapshotDay = today; state.lastSnapshot = state.lastRun; out.snapshot = true;
    const { blobs } = await s.list({ prefix: 'daily/' });
    const cutoff = londonDate(new Date(Date.now() - KEEP_DAYS * 864e5));
    for (const b of blobs) if (b.key.slice(6) < cutoff) await s.delete(b.key);
    const { blobs: old } = await s.list({ prefix: 'before-restore/' });
    for (const b of old.sort((a, b2) => a.key.localeCompare(b2.key)).slice(0, -10)) await s.delete(b.key);
  }

  // 2. Google Drive copy through the Apps Script bridge.
  if (hasData && process.env.STUDIO_CALENDAR_SCRIPT_URL && process.env.STUDIO_CALENDAR_SCRIPT_SECRET) {
    try {
      const json = JSON.stringify(db);
      const hash = createHash('sha1').update(json).digest('hex');
      if (force || hash !== state.lastDriveHash || state.lastDriveDay !== today) {
        const r = await callBridge({ action: 'ideationBackup', json, day: today, siteUrl: process.env.URL || '', imageKey: imageKey() }, Math.min(15000, left() - 2000));
        Object.assign(state, { lastDriveHash: hash, lastDriveDay: today, lastDrive: new Date().toISOString(), folderUrl: r.folderUrl || state.folderUrl || '', sheetUrl: r.sheetUrl || state.sheetUrl || '', lastDriveError: '' });
        out.drive = true;
      }
      // Images not on Drive yet, a batch at a time.
      const done = new Set(state.driveImages || []);
      const pending = imageIds(db).filter(id => !done.has(id));
      while (pending.length && left() > 9000) {
        const batch = []; let bytes = 0;
        while (pending.length && batch.length < IMAGE_BATCH_COUNT && bytes < IMAGE_BATCH_BYTES) {
          const id = pending.shift();
          const img = await readImage(id).catch(() => null);
          if (!img) { done.add(id); continue; }
          bytes += img.bytes.byteLength;
          batch.push({ id, name: id + '.' + imageExt(img.type), type: img.type, b64: Buffer.from(img.bytes).toString('base64') });
        }
        if (!batch.length) break;
        const r = await callBridge({ action: 'ideationBackupImages', images: batch }, Math.min(20000, left() - 1500));
        (r.saved || batch.map(b => b.id)).forEach(id => done.add(id));
        out.images += batch.length;
      }
      state.driveImages = [...done];
      state.lastDriveError = '';
    } catch (err) {
      state.lastDriveError = String(err.message || err).slice(0, 400);
      out.driveError = state.lastDriveError;
    }
  } else if (hasData) {
    state.lastDriveError = 'Google Drive copy is off: the Studio bridge (STUDIO_CALENDAR_SCRIPT_URL / _SECRET) is not set in Netlify.';
  }

  await writeState(state);
  return out;
}
