/**
 * Josh Brett Ideation Machine: storage shared by the ideation function (the page's API)
 * and the hourly ideation-backup function.
 *
 * Everything lives in Netlify Blobs, attached to this Netlify site. Nothing to sign up for.
 *   store "ideation"          keys "o/<id>", "i/<id>"  one outlier / one video idea each (legacy/… holds the old single-blob version)
 *   store "ideation-images"   key "<image id>"        thumbnails and screenshots (binary, content type in metadata)
 *   store "ideation-backups"  key "daily/YYYY-MM-DD"  one snapshot of "db" a day, the last 30 kept
 *                             key "before-restore/…"  a copy taken just before any restore
 *                             key "state"             backup bookkeeping (last Google Drive copy, images already copied)
 *
 * Each save touches only its own item, and is read back and re-applied if another save landed on top of it.
 *
 * For local testing only: IDEATION_LOCAL_DIR=/some/folder keeps the same stores as files instead.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DB_KEY = 'db'; // the first version's single blob, migrated away on first use
export const STATUSES = ['Rough', 'Developing', 'Packaging', 'Greenlit', 'In production', 'Parked'];

/* ---------- stores ---------- */
let blobsModule = null;
async function blobs() {
  if (!blobsModule) blobsModule = await import('@netlify/blobs');
  return blobsModule;
}

/** A tiny file-backed stand-in with the same calls, used only when IDEATION_LOCAL_DIR is set (tests). */
function localStore(name) {
  const dir = path.join(process.env.IDEATION_LOCAL_DIR, name);
  const file = key => path.join(dir, encodeURIComponent(key));
  const tag = buf => '"' + createHash('md5').update(buf).digest('hex') + '"';
  return {
    async getWithMetadata(key, { type } = {}) {
      let buf; try { buf = await fs.readFile(file(key)); } catch { return null; }
      let metadata = {}; try { metadata = JSON.parse(await fs.readFile(file(key) + '.meta', 'utf8')); } catch {}
      const data = type === 'json' ? JSON.parse(buf.toString('utf8')) : type === 'arrayBuffer' ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) : buf.toString('utf8');
      return { data, etag: tag(buf), metadata };
    },
    async get(key, opts = {}) { const r = await this.getWithMetadata(key, opts); return r ? r.data : null; },
    async getMetadata(key) { try { const buf = await fs.readFile(file(key)); let metadata = {}; try { metadata = JSON.parse(await fs.readFile(file(key) + '.meta', 'utf8')); } catch {} return { etag: tag(buf), metadata }; } catch { return null; } },
    async set(key, value, { metadata, onlyIfMatch, onlyIfNew } = {}) {
      await fs.mkdir(dir, { recursive: true });
      let current = null; try { current = await fs.readFile(file(key)); } catch {}
      if (onlyIfNew && current) return { modified: false };
      if (onlyIfMatch && (!current || tag(current) !== onlyIfMatch)) return { modified: false };
      const buf = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      const tmp = file(key) + '.' + randomBytes(4).toString('hex') + '.tmp'; await fs.writeFile(tmp, buf); await fs.rename(tmp, file(key)); // atomic, like a blob PUT
      if (metadata) await fs.writeFile(file(key) + '.meta', JSON.stringify(metadata));
      return { modified: true, etag: tag(buf) };
    },
    async setJSON(key, value, opts) { return this.set(key, JSON.stringify(value), opts); },
    async delete(key) { await fs.rm(file(key), { force: true }); await fs.rm(file(key) + '.meta', { force: true }); },
    async list({ prefix = '' } = {}) {
      let names = []; try { names = await fs.readdir(dir); } catch {}
      const keys = names.filter(n => !n.endsWith('.meta') && !n.endsWith('.tmp')).map(n => decodeURIComponent(n)).filter(k => k.startsWith(prefix));
      return { blobs: await Promise.all(keys.map(async key => ({ key, etag: tag(await fs.readFile(file(key))) }))), directories: [] };
    }
  };
}

export async function store(name) {
  if (process.env.IDEATION_LOCAL_DIR) return localStore(name);
  const { getStore } = await blobs();
  return getStore({ name, consistency: 'strong' });
}

/* ---------- outliers and ideas: one blob each ----------
 * key "o/<id>" for an outlier, "i/<id>" for an idea. Two people saving different items never touch the same blob.
 * For the same item, every change is written, read back and re-applied if someone else's save landed on top of it. */
export const TABLES = { outliers: 'o/', ideas: 'i/' };
const memo = new Map(); // blob key -> { etag, data }: warm function instances only download items that changed
const tagOf = e => String(e || '').replace(/^W\//, '').replace(/"/g, '');
let migrated = false;

async function pool(list, size, fn) {
  const queue = list.slice();
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

/** The first version kept everything in one blob ("db"). Split it into one blob per item, once, and keep the old blob as legacy/. */
async function migrate(s) {
  if (migrated) return;
  const legacy = await s.get(DB_KEY, { type: 'json' }).catch(() => null);
  if (legacy && (legacy.outliers || legacy.ideas)) {
    const items = [...Object.values(legacy.outliers || {}).map(x => ['outliers', x]), ...Object.values(legacy.ideas || {}).map(x => ['ideas', x])];
    await pool(items, 24, async ([table, item]) => {
      const key = TABLES[table] + item.id;
      if (!(await s.getMetadata(key).catch(() => null))) await s.setJSON(key, item);
    });
    await s.setJSON('legacy/db-' + new Date().toISOString().replace(/[:.]/g, '-'), legacy);
    await s.delete(DB_KEY);
  }
  migrated = true;
}

/** Everything, as { outliers: {id: item}, ideas: {id: item} }. */
export async function readAll() {
  const s = await store('ideation');
  await migrate(s);
  const out = { outliers: {}, ideas: {} };
  for (const [table, prefix] of Object.entries(TABLES)) {
    const { blobs } = await s.list({ prefix });
    const live = new Set(blobs.map(b => b.key));
    await pool(blobs, 32, async b => {
      let m = memo.get(b.key);
      if (!m || !b.etag || tagOf(m.etag) !== tagOf(b.etag)) {
        const r = await s.getWithMetadata(b.key, { type: 'json' }).catch(() => null);
        if (!r?.data) return;
        m = { etag: r.etag || b.etag, data: r.data };
        memo.set(b.key, m);
      }
      out[table][m.data.id] = m.data;
    });
    for (const k of memo.keys()) if (k.startsWith(prefix) && !live.has(k)) memo.delete(k);
  }
  return out;
}

/** The whole workspace as one document (backups, export). */
export async function readDb() {
  const all = await readAll();
  const stamps = [...Object.values(all.outliers), ...Object.values(all.ideas)].map(x => x.updatedAt || '').sort();
  return { db: { version: 2, outliers: all.outliers, ideas: all.ideas, updatedAt: stamps.at(-1) || '' } };
}

export async function getItem(table, id) {
  if (!TABLES[table] || !validId(id)) return null;
  const s = await store('ideation');
  await migrate(s);
  return s.get(TABLES[table] + id, { type: 'json' }).catch(() => null);
}
export async function putItem(table, item) {
  const s = await store('ideation');
  await migrate(s);
  await s.setJSON(TABLES[table] + item.id, item);
  return item;
}
export async function deleteItem(table, id) {
  const s = await store('ideation');
  await migrate(s);
  await s.delete(TABLES[table] + id);
  memo.delete(TABLES[table] + id);
}

/**
 * Change one item: read it, apply `change(item)` (which edits it in place, or throws), save, read back.
 * If `landed(saved)` says our change isn't there (another save overwrote it in between), apply it again on top.
 */
export async function updateItem(table, id, change, landed = () => true) {
  for (let i = 0; i < 6; i++) {
    const item = await getItem(table, id);
    if (!item) throw Object.assign(new Error('That item was deleted by someone else. Refresh the page.'), { status: 404 });
    await change(item);
    await putItem(table, item);
    await new Promise(r => setTimeout(r, 40 + Math.random() * 60));
    const saved = await getItem(table, id);
    if (saved && landed(saved)) return saved;
  }
  throw Object.assign(new Error('Lots of people are saving this at once. Try again in a second.'), { status: 409 });
}

/** Replace everything with a snapshot ({outliers, ideas}): used by Restore. */
export async function replaceAll(snapshot) {
  const current = await readAll();
  for (const table of Object.keys(TABLES)) {
    const keep = snapshot[table] || {};
    await pool(Object.values(keep), 24, item => putItem(table, item));
    await pool(Object.keys(current[table]).filter(id => !keep[id]), 24, id => deleteItem(table, id));
  }
}

/* ---------- ids, images ---------- */
export const newId = (prefix = '') => prefix + Date.now().toString(36) + randomBytes(5).toString('hex');
export const validId = id => typeof id === 'string' && /^[a-z0-9_-]{6,48}$/i.test(id);

/** Image links carry this key so <img> tags work without sending the access code in a header. */
export function imageKey() {
  const code = process.env.BOARD_ACCESS_CODE || '';
  return code ? createHmac('sha256', code).update('ideation-images-v1').digest('base64url').slice(0, 24) : '';
}

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
export const imageExt = type => IMAGE_TYPES[type] || 'jpg';
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function sniffType(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/avif';
  return '';
}

export async function saveImage(bytes, { source = '' } = {}) {
  const type = sniffType(bytes);
  if (!type) throw Object.assign(new Error('That file is not an image (JPG, PNG, WebP or GIF).'), { status: 400 });
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw Object.assign(new Error('That image is over 4 MB. Try a smaller screenshot.'), { status: 413 });
  const id = newId('img_');
  const s = await store('ideation-images');
  await s.set(id, bytes, { metadata: { type, bytes: bytes.byteLength, source: String(source).slice(0, 300), at: new Date().toISOString() } });
  return { id, type, bytes: bytes.byteLength };
}

export async function readImage(id) {
  if (!validId(id)) return null;
  const s = await store('ideation-images');
  const found = await s.getWithMetadata(id, { type: 'arrayBuffer' });
  if (!found) return null;
  return { bytes: found.data, type: found.metadata?.type || 'image/jpeg' };
}

/** Size of a stored image in bytes (a rough guide to which copy is sharper), or 0. */
export async function imageBytes(id) {
  if (!validId(id)) return 0;
  const s = await store('ideation-images');
  const m = await s.getMetadata(id).catch(() => null);
  return Number(m?.metadata?.bytes) || 0;
}

/** Image ids referenced anywhere in the workspace. */
export function imageIds(db) {
  const ids = new Set();
  Object.values(db.outliers || {}).forEach(o => { if (o.image) ids.add(o.image); if (o.originalImage) ids.add(o.originalImage); });
  Object.values(db.ideas || {}).forEach(i => (i.images || []).forEach(x => { if (x?.id) ids.add(x.id); }));
  return [...ids];
}

/* ---------- YouTube ---------- */
export function youtubeId(text) {
  const s = String(text || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  return m ? m[1] : '';
}
export const youtubeThumb = id => id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : '';
