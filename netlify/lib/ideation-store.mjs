/**
 * Josh Brett Ideation Machine: storage shared by the ideation function (the page's API)
 * and the hourly ideation-backup function.
 *
 * Everything lives in Netlify Blobs, attached to this Netlify site. Nothing to sign up for.
 *   store "ideation"          key "db"                the whole workspace: outliers + video ideas (one JSON document)
 *   store "ideation-images"   key "<image id>"        thumbnails and screenshots (binary, content type in metadata)
 *   store "ideation-backups"  key "daily/YYYY-MM-DD"  one snapshot of "db" a day, the last 30 kept
 *                             key "before-restore/…"  a copy taken just before any restore
 *                             key "state"             backup bookkeeping (last Google Drive copy, images already copied)
 *
 * Writes are read-modify-write on "db" guarded by its ETag, so two people saving at once never overwrite each other:
 * the loser re-reads and applies its change again on top.
 *
 * For local testing only: IDEATION_LOCAL_DIR=/some/folder keeps the same stores as files instead.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DB_KEY = 'db';
export const STATUSES = ['Rough', 'Developing', 'Packaging', 'Greenlit', 'In production', 'Parked'];

/* ---------- stores ---------- */
let blobsModule = null;
async function blobs() {
  if (!blobsModule) blobsModule = await import('@netlify/blobs');
  return blobsModule;
}

let localQueue = Promise.resolve(); // local writes one at a time, so conditional writes behave like Netlify's
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
    set(key, value, opts = {}) { const run = localQueue.then(() => this._set(key, value, opts)); localQueue = run.catch(() => {}); return run; },
    async _set(key, value, { metadata, onlyIfMatch, onlyIfNew } = {}) {
      await fs.mkdir(dir, { recursive: true });
      let current = null; try { current = await fs.readFile(file(key)); } catch {}
      if (onlyIfNew && current) return { modified: false };
      if (onlyIfMatch && (!current || tag(current) !== onlyIfMatch)) return { modified: false };
      const buf = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      await fs.writeFile(file(key), buf);
      if (metadata) await fs.writeFile(file(key) + '.meta', JSON.stringify(metadata));
      return { modified: true, etag: tag(buf) };
    },
    async setJSON(key, value, opts) { return this.set(key, JSON.stringify(value), opts); },
    async delete(key) { await fs.rm(file(key), { force: true }); await fs.rm(file(key) + '.meta', { force: true }); },
    async list({ prefix = '' } = {}) {
      let names = []; try { names = await fs.readdir(dir); } catch {}
      return { blobs: names.filter(n => !n.endsWith('.meta')).map(n => decodeURIComponent(n)).filter(k => k.startsWith(prefix)).map(key => ({ key, etag: '' })), directories: [] };
    }
  };
}

export async function store(name) {
  if (process.env.IDEATION_LOCAL_DIR) return localStore(name);
  const { getStore } = await blobs();
  return getStore({ name, consistency: 'strong' });
}

/* ---------- the workspace document ---------- */
export const emptyDb = () => ({ version: 1, outliers: {}, ideas: {}, createdAt: new Date().toISOString(), updatedAt: '' });

export async function readDb() {
  const s = await store('ideation');
  const found = await s.getWithMetadata(DB_KEY, { type: 'json' });
  if (!found) return { db: emptyDb(), etag: null };
  const db = found.data || emptyDb();
  db.outliers ||= {}; db.ideas ||= {};
  return { db, etag: found.etag };
}

/**
 * Apply `change(db)` to the latest copy and save it. If someone else saved in between, start again from theirs.
 * `change` may return a value, which is passed back.
 */
export async function updateDb(change, { attempts = 12 } = {}) {
  const s = await store('ideation');
  for (let i = 0; i < attempts; i++) {
    const { db, etag } = await readDb();
    const result = await change(db);
    db.updatedAt = new Date().toISOString();
    const write = etag ? await s.setJSON(DB_KEY, db, { onlyIfMatch: etag }) : await s.setJSON(DB_KEY, db, { onlyIfNew: true });
    if (write?.modified !== false) return { db, result };
    await new Promise(r => setTimeout(r, 80 + Math.random() * 250));
  }
  throw Object.assign(new Error('Too many people saving at once. Try again in a second.'), { status: 409 });
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

/** Image ids referenced anywhere in the workspace. */
export function imageIds(db) {
  const ids = new Set();
  Object.values(db.outliers || {}).forEach(o => { if (o.image) ids.add(o.image); });
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
