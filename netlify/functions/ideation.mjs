/**
 * Josh Brett Ideation Machine API (the /ideas page).
 *
 * POST /.netlify/functions/ideation   with header x-board-key: BOARD_ACCESS_CODE and a JSON body {action, ...}
 * GET  /.netlify/functions/ideation?img=<id>&k=<image key>   serves a stored thumbnail or screenshot
 *
 * Storage is Netlify Blobs (see ../lib/ideation-store.mjs). No extra Netlify variables are needed:
 * it uses the Studio's BOARD_ACCESS_CODE, and YOUTUBE_API_KEY (already set for the calendar) for view counts.
 */
import { timingSafeEqual, createHash } from 'node:crypto';
import { STATUSES, readDb, readAll, putItem, updateItem, deleteItem, newId, validId, imageKey, saveImage, readImage, youtubeId, youtubeThumb } from '../lib/ideation-store.mjs';
import { runBackup, backupStatus, listSnapshots, restoreSnapshot } from '../lib/ideation-backup.mjs';

const send = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status = 400) => send({ error: message }, status);
const oops = (message, status = 400) => Object.assign(new Error(message), { status });
function same(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------- field rules ---------- */
const str = (v, max, label) => {
  if (v == null) return '';
  if (typeof v !== 'string') throw oops(label + ' must be text.');
  if (v.length > max) throw oops(label + ' is too long (' + max + ' characters max).');
  return v;
};
const num = (v, label) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw oops(label + ' must be a number.');
  return Math.round(n);
};
const bool = v => Boolean(v);
const url = (v, label) => {
  const s = str(v, 1500, label).trim();
  if (s && !/^https?:\/\//i.test(s)) throw oops(label + ' must start with http:// or https://');
  return s;
};
const imgRef = (v, label) => {
  if (v == null || v === '') return '';
  if (!validId(v)) throw oops(label + ' is not a valid image.');
  return v;
};
const tags = v => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 25) throw oops('Up to 25 tags.');
  return [...new Set(v.map(t => str(t, 40, 'A tag').trim()).filter(Boolean))];
};
const list = (v, max, label, each) => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw oops(label + ' must be a list.');
  if (v.length > max) throw oops('Up to ' + max + ' ' + label.toLowerCase() + '.');
  return v.map(each);
};
const itemId = v => (validId(v) ? v : newId());

const OUTLIER_FIELDS = {
  title: v => str(v, 300, 'Title'),
  channel: v => str(v, 150, 'Channel'),
  url: v => url(v, 'Video link'),
  videoId: v => { const s = str(v, 20, 'Video id'); if (s && !/^[A-Za-z0-9_-]{11}$/.test(s)) throw oops('Invalid YouTube video id.'); return s; },
  views: v => num(v, 'Views'),
  subs: v => num(v, 'Subscribers'),
  published: v => { const s = str(v, 30, 'Published date'); if (s && Number.isNaN(Date.parse(s))) throw oops('Invalid published date.'); return s; },
  why: v => str(v, 6000, 'Why it works'),
  steal: v => str(v, 3000, 'What we\'d steal'),
  tags,
  image: v => imgRef(v, 'Image'),
  imageSmall: v => imgRef(v, 'Image'),
  thumbUrl: v => url(v, 'Thumbnail link'),
  originalImage: v => imgRef(v, 'Image'),
  originalSmall: v => imgRef(v, 'Image'),
  tidiedAt: v => str(v, 30, 'Tidied date'),
  multiplier: v => { if (v === '' || v == null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100000) throw oops('Outlier score must be a number.'); return Math.round(n * 10) / 10; },
  starred: bool,
  archived: bool,
  statsAt: v => str(v, 30, 'Stats date')
};
const IDEA_FIELDS = {
  title: v => str(v, 300, 'Title'),
  status: v => { const s = str(v, 30, 'Status') || 'Rough'; if (!STATUSES.includes(s)) throw oops('Status must be one of: ' + STATUSES.join(', ')); return s; },
  owner: v => str(v, 60, 'Owner'),
  premise: v => str(v, 12000, 'The angle'),
  hook: v => str(v, 6000, 'Hook'),
  thumbnailConcept: v => str(v, 6000, 'Thumbnail concept'),
  tags,
  starred: bool,
  titleOptions: v => list(v, 40, 'Title options', o => ({ id: itemId(o?.id), text: str(o?.text, 300, 'A title option'), fav: bool(o?.fav) })),
  sources: v => list(v, 150, 'Sources', o => ({ id: itemId(o?.id), label: str(o?.label, 300, 'A source name'), url: url(o?.url, 'A source link'), note: str(o?.note, 2000, 'A source note') })),
  similar: v => list(v, 80, 'Similar videos', o => ({ id: itemId(o?.id), url: url(o?.url, 'A similar video link'), videoId: OUTLIER_FIELDS.videoId(o?.videoId || ''), title: str(o?.title, 300, 'A video title'), channel: str(o?.channel, 150, 'A channel'), views: num(o?.views, 'Views'), thumb: url(o?.thumb, 'A thumbnail link'), note: str(o?.note, 2000, 'A note') })),
  outlierIds: v => [...new Set(list(v, 150, 'Linked outliers', id => { if (!validId(id)) throw oops('Invalid outlier.'); return id; }))],
  images: v => list(v, 40, 'Images', o => ({ id: imgRef(o?.id, 'Image'), small: imgRef(o?.small, 'Image'), caption: str(o?.caption, 300, 'A caption') })).filter(o => o.id)
};
function clean(patch, rules) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw oops('Nothing to save.');
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!rules[k]) throw oops('Unknown field: ' + k);
    out[k] = rules[k](v);
  }
  return out;
}
const who = v => str(v, 60, 'Your name').trim() || 'Someone';
const kindOf = k => (k === 'idea' ? 'ideas' : k === 'outlier' ? 'outliers' : null);

/* ---------- YouTube lookups ---------- */
async function oembed(videoId) {
  try {
    const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = await res.json();
    return { title: d.title || '', channel: d.author_name || '' };
  } catch { return null; }
}
async function ytApi(pathname, params) {
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!key) return null;
  const u = new URL('https://www.googleapis.com/youtube/v3' + pathname);
  Object.entries({ ...params, key }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) return null;
  return res.json();
}
/** Title, channel, views, publish date and the channel's subscriber count for up to 50 videos. */
async function videoStats(ids) {
  const out = {};
  const data = await ytApi('/videos', { part: 'snippet,statistics', id: ids.join(','), maxResults: 50 }).catch(() => null);
  if (!data) return out;
  const channels = new Set();
  (data.items || []).forEach(v => {
    out[v.id] = { title: v.snippet?.title || '', channel: v.snippet?.channelTitle || '', channelId: v.snippet?.channelId || '', published: v.snippet?.publishedAt || '', views: Number(v.statistics?.viewCount) || null };
    if (v.snippet?.channelId) channels.add(v.snippet.channelId);
  });
  const ch = await ytApi('/channels', { part: 'statistics', id: [...channels].slice(0, 50).join(','), maxResults: 50 }).catch(() => null);
  const subs = {};
  (ch?.items || []).forEach(c => { subs[c.id] = c.statistics?.hiddenSubscriberCount ? null : Number(c.statistics?.subscriberCount) || null; });
  Object.values(out).forEach(v => { v.subs = subs[v.channelId] ?? null; delete v.channelId; });
  return out;
}
async function lookupVideo(link) {
  const videoId = youtubeId(link);
  if (!videoId) throw oops('That doesn\'t look like a YouTube link.');
  const [stats, basic] = await Promise.all([videoStats([videoId]).then(s => s[videoId]).catch(() => null), oembed(videoId)]);
  const v = stats || basic;
  if (!v) throw oops('Couldn\'t find that video on YouTube. Is it public?', 404);
  return { videoId, url: 'https://www.youtube.com/watch?v=' + videoId, title: v.title || '', channel: v.channel || '', views: stats?.views ?? null, subs: stats?.subs ?? null, published: stats?.published || '', thumb: youtubeThumb(videoId), statsAt: stats ? new Date().toISOString() : '' };
}

/* ---------- images from other sites (Discord screenshots, YouTube thumbnails) ---------- */
const IMAGE_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net', 'i.ytimg.com', 'img.youtube.com'];
async function importImageUrl(link) {
  let u; try { u = new URL(link); } catch { throw oops('Invalid image link.'); }
  if (u.protocol !== 'https:' || !IMAGE_HOSTS.includes(u.hostname)) throw oops('Images can only be copied from Discord or YouTube links.');
  const res = await fetch(u, { signal: AbortSignal.timeout(12000), redirect: 'follow' });
  if (!res.ok) throw oops(res.status === 404 || res.status === 403 ? 'That image link has expired. Reopen it in Discord and try again.' : 'Could not download that image (' + res.status + ').', 502);
  const bytes = await res.arrayBuffer();
  return saveImage(bytes, { source: u.origin + u.pathname });
}
function fromDataUrl(data) {
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(String(data || ''));
  if (!m) throw oops('Image upload was not readable.');
  const buf = Buffer.from(m[1], 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

/* ---------- actions ---------- */
async function act(input) {
  const action = String(input.action || '');
  const now = new Date().toISOString();

  if (action === 'list') {
    const { db } = await readDb();
    return { outliers: Object.values(db.outliers), ideas: Object.values(db.ideas), updatedAt: db.updatedAt || '', imageKey: imageKey(), youtube: Boolean((process.env.YOUTUBE_API_KEY || '').trim()), backup: await backupStatus(db).catch(() => null) };
  }

  if (action === 'saveOutlier' || action === 'saveIdea') {
    const isIdea = action === 'saveIdea', table = isIdea ? 'ideas' : 'outliers';
    const patch = clean(input.patch, isIdea ? IDEA_FIELDS : OUTLIER_FIELDS);
    const by = who(input.by);
    if (!input.id) {
      const item = { id: newId(isIdea ? 'idea_' : 'out_'), createdAt: now, addedBy: by, notes: [], tags: [], ...(isIdea ? { status: 'Rough', titleOptions: [], sources: [], similar: [], outlierIds: [], images: [] } : {}), ...patch, updatedAt: now, updatedBy: by };
      return { item: await putItem(table, item) };
    }
    if (!validId(input.id)) throw oops('Invalid id.');
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const item = await updateItem(table, input.id, it => { Object.assign(it, patch, { updatedAt: now, updatedBy: by }); }, saved => Object.keys(patch).every(k => same(saved[k], patch[k])));
    return { item };
  }

  if (action === 'deleteOutlier' || action === 'deleteIdea') {
    const table = action === 'deleteIdea' ? 'ideas' : 'outliers';
    if (!validId(input.id)) throw oops('Invalid id.');
    await deleteItem(table, input.id);
    if (table === 'outliers') {
      const { ideas } = await readAll();
      for (const i of Object.values(ideas)) if (i.outlierIds?.includes(input.id)) await updateItem('ideas', i.id, it => { it.outlierIds = (it.outlierIds || []).filter(x => x !== input.id); }, saved => !(saved.outlierIds || []).includes(input.id)).catch(() => {});
    }
    return { ok: true };
  }

  if (action === 'addNote' || action === 'deleteNote') {
    const table = kindOf(input.kind);
    if (!table || !validId(input.id)) throw oops('Invalid item.');
    const text = action === 'addNote' ? str(input.text, 6000, 'Note').trim() : '';
    if (action === 'addNote' && !text) throw oops('Write something first.');
    const note = { id: newId('n_'), by: who(input.by), text, at: now };
    const item = await updateItem(table, input.id, it => {
      it.notes ||= [];
      if (action === 'addNote') { if (!it.notes.some(n => n.id === note.id)) it.notes.push(note); }
      else it.notes = it.notes.filter(n => n.id !== input.noteId);
      if (it.notes.length > 300) throw oops('That\'s a lot of notes. Delete a few old ones first.');
    }, saved => (action === 'addNote' ? (saved.notes || []).some(n => n.id === note.id) : !(saved.notes || []).some(n => n.id === input.noteId)));
    return { item };
  }

  if (action === 'uploadImage') {
    const main = await saveImage(fromDataUrl(input.data), { source: str(input.source, 300, 'Source') });
    const small = input.small ? await saveImage(fromDataUrl(input.small), { source: 'small:' + main.id }) : null;
    return { id: main.id, small: small?.id || '' };
  }

  if (action === 'importImageUrl') {
    const img = await importImageUrl(String(input.url || ''));
    return { id: img.id };
  }

  if (action === 'youtube') return { video: await lookupVideo(String(input.url || '')) };

  if (action === 'refreshStats') {
    if (!(process.env.YOUTUBE_API_KEY || '').trim()) throw oops('Add YOUTUBE_API_KEY in Netlify to pull view counts (it\'s the same key the content calendar uses).', 503);
    const { db } = await readDb();
    const wanted = (Array.isArray(input.ids) && input.ids.length ? input.ids : Object.keys(db.outliers)).filter(id => db.outliers[id]?.videoId).slice(0, 200);
    const vids = [...new Set(wanted.map(id => db.outliers[id].videoId))];
    const stats = {};
    for (let i = 0; i < vids.length; i += 50) Object.assign(stats, await videoStats(vids.slice(i, i + 50)));
    const changed = [];
    for (const id of wanted) {
      const s = stats[db.outliers[id].videoId]; if (!s) continue;
      changed.push(await updateItem('outliers', id, o => { Object.assign(o, { views: s.views, subs: s.subs, published: s.published || o.published, title: o.title || s.title, channel: o.channel || s.channel, statsAt: now }); }, o => o.statsAt === now));
    }
    return { items: changed };
  }

  /* One-time import of the Discord channels. Items already imported (same Discord key) are skipped. */
  if (action === 'importDiscord') {
    const rows = Array.isArray(input.items) ? input.items.slice(0, 60) : [];
    const all = await readAll();
    const known = new Set([...Object.values(all.outliers), ...Object.values(all.ideas)].map(x => x.discord?.key).filter(Boolean));
    let created = 0;
    for (const r of rows) {
      const key = str(r.key, 80, 'Discord key');
      if (!key || known.has(key)) continue;
      known.add(key);
      const stable = createHash('sha1').update(key).digest('hex').slice(0, 20); // same Discord post, same id: re-running can't duplicate
      const discord = { key, channel: str(r.channel, 60, 'Channel'), postedBy: str(r.postedBy, 60, 'Posted by'), postedAt: str(r.postedAt, 40, 'Posted at'), messageUrl: url(r.messageUrl, 'Message link') };
      const notes = r.text ? [{ id: 'n_' + stable, by: discord.postedBy || 'Discord', text: str(r.text, 4000, 'Text'), at: discord.postedAt || now }] : [];
      if (r.kind === 'idea') {
        await putItem('ideas', { id: 'idea_d' + stable, createdAt: discord.postedAt || now, updatedAt: now, addedBy: 'Discord import', status: 'Rough', title: str(r.title, 300, 'Title'), premise: '', hook: '', thumbnailConcept: '', owner: '', tags: [], titleOptions: [], sources: [], similar: [], outlierIds: [], notes, images: (Array.isArray(r.images) ? r.images.slice(0, 20) : r.image ? [{ id: r.image, small: r.imageSmall }] : []).map(x => ({ id: imgRef(x?.id, 'Image'), small: imgRef(x?.small, 'Image'), caption: '' })).filter(x => x.id), discord });
      } else {
        await putItem('outliers', { id: 'out_d' + stable, createdAt: discord.postedAt || now, updatedAt: now, addedBy: 'Discord import', title: str(r.title, 300, 'Title'), channel: '', url: '', videoId: '', views: null, subs: null, why: '', steal: '', tags: [], notes, image: imgRef(r.image, 'Image'), imageSmall: imgRef(r.imageSmall, 'Image'), starred: false, archived: false, discord });
      }
      created++;
    }
    return { created };
  }

  if (action === 'discordKeys') {
    const { db } = await readDb();
    return { keys: [...Object.values(db.outliers), ...Object.values(db.ideas)].map(x => x.discord?.key).filter(Boolean) };
  }

  if (action === 'export') {
    const { db } = await readDb();
    return { exportedAt: now, site: process.env.URL || '', imageKey: imageKey(), db };
  }

  if (action === 'backups') return { status: await backupStatus(), snapshots: await listSnapshots() };
  if (action === 'backupNow') return { result: await runBackup({ force: true, budgetMs: 22000 }) };
  if (action === 'restore') {
    const key = str(input.key, 120, 'Snapshot');
    await restoreSnapshot(key);
    return { ok: true };
  }

  throw oops('Unknown action.');
}

export default async function handler(request) {
  const u = new URL(request.url);
  if (request.method === 'GET') {
    const id = u.searchParams.get('img'), k = u.searchParams.get('k');
    if (!id || !same(k || '', imageKey())) return new Response('Not found', { status: 404 });
    const img = await readImage(id).catch(() => null);
    if (!img) return new Response('Not found', { status: 404 });
    // Image ids never change content, so browsers and Netlify's edge keep them for a year (fewer function runs).
    return new Response(img.bytes, { headers: { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Netlify-CDN-Cache-Control': 'public, max-age=31536000, immutable, durable', 'Netlify-Vary': 'query=img|k', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (request.method !== 'POST') return fail('POST only.', 405);
  if (!process.env.BOARD_ACCESS_CODE) return fail('BOARD_ACCESS_CODE is not set in Netlify.', 503);
  if (!same(request.headers.get('x-board-key') || '', process.env.BOARD_ACCESS_CODE)) return fail('Invalid workspace access code.', 401);
  if (Number(request.headers.get('content-length')) > 5_500_000) return fail('That upload is too big. Try a smaller image.', 413);
  let input; try { input = await request.json(); } catch { return fail('Invalid JSON.'); }
  try {
    return send(await act(input || {}));
  } catch (err) {
    if (!err.status) console.error('ideation:', err);
    return fail(err.message || 'Something went wrong.', Number.isInteger(err.status) ? err.status : 500);
  }
}

