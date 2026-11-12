/**
 * Discord → Ideation Machine: new posts in the JOSH BRETT YOUTUBE server's outlier channels become outliers,
 * and new posts in #rough-ideas become video ideas. A read-only Discord bot does the reading.
 *
 * The bot's token is pasted once on the page (kept in the private "ideation-discord" store and never sent back
 * to the page), or set as DISCORD_BOT_TOKEN in Netlify, which wins if both exist. The scheduled function
 * ideation-discord runs this every 10 minutes; the page's "Check Discord now" runs it on demand.
 *
 * Only posts newer than the last one seen in each channel are read, so an outlier deleted here never comes back,
 * and the same post can't be imported twice (its id comes from the Discord message). Screenshots arrive as they
 * are; the page crops them and reads their titles the next time someone opens it, then finds them on YouTube.
 *
 *   store "ideation-discord"  key "token"  { token, savedBy, savedAt }
 *                             key "state"  { cursors: {channelId: lastMessageId}, lastRun, lastError, check, recent, … }
 */
import { createHash } from 'node:crypto';
import { store, readAll, putItem, updateItem, saveImage, newId, youtubeId, youtubeThumb, MAX_IMAGE_BYTES } from './ideation-store.mjs';
import { videoStats, oembed } from './ideation-youtube.mjs';

export const GUILD_ID = '1505834790572654612'; // JOSH BRETT YOUTUBE
export const CHANNELS = [
  { id: '1505834888568504420', name: 'outliers', kind: 'outlier' },
  { id: '1505841183069573142', name: 'educational-outliers', kind: 'outlier', genre: 'Education' },
  { id: '1505834936849006682', name: 'thumbnail-inspo', kind: 'outlier' },
  { id: '1505841088613843025', name: 'mega-viral-outliers', kind: 'outlier' },
  { id: '1505843218325962762', name: 'rough-ideas', kind: 'idea' }
];
const API = process.env.IDEATION_DISCORD_API || 'https://discord.com/api/v10'; // the override is for local tests only
const PERMISSIONS = 1024 + 65536; // View Channel + Read Message History. Nothing else: it can't post, react or moderate.
const MESSAGE_CONTENT = (1 << 18) | (1 << 19); // the bot's "Message Content Intent" switch (either flavour)
const IMAGES_PER_RUN = 12;
const RECENT_KEPT = 12;

const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 20); // same as the first import: same post, same id
const snowflakeAt = ms => ((BigInt(Math.max(0, ms - 1420070400000))) << 22n).toString();
const later = (a, b) => (BigInt(a) > BigInt(b) ? a : b);
const oops = (message, status = 400) => Object.assign(new Error(message), { status });

export const inviteUrl = appId => `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${PERMISSIONS}&guild_id=${GUILD_ID}&disable_guild_select=true`;

/* ---------- token and state ---------- */
async function tokenInfo() {
  const env = (process.env.DISCORD_BOT_TOKEN || '').trim();
  if (env) return { token: env, from: 'netlify' };
  const s = await store('ideation-discord');
  const t = await s.get('token', { type: 'json' }).catch(() => null);
  return t?.token ? { token: t.token, from: 'page', savedBy: t.savedBy, savedAt: t.savedAt } : null;
}
async function readState() {
  const s = await store('ideation-discord');
  return (await s.get('state', { type: 'json' }).catch(() => null)) || {};
}
async function writeState(state) {
  const s = await store('ideation-discord');
  await s.setJSON('state', state);
}

/* ---------- Discord API ---------- */
async function discord(token, pathname) {
  const res = await fetch(API + pathname, { headers: { authorization: 'Bot ' + token, 'user-agent': 'DiscordBot (https://conditioningteam.netlify.app/ideas/, 1)' }, signal: AbortSignal.timeout(9000) });
  let data = null; try { data = await res.json(); } catch {}
  if (res.status === 429) throw Object.assign(new Error('Discord asked us to slow down. It will carry on in a few minutes.'), { status: 429, rate: true });
  if (!res.ok) throw Object.assign(new Error(data?.message || 'Discord said ' + res.status), { status: res.status, code: data?.code });
  return data;
}
const friendly = e => e.status === 401 ? 'The bot\'s token stopped working (it may have been reset). Paste the new one.'
  : e.status === 403 || e.code === 50001 ? 'The bot can\'t see this channel. Give its role access to it in Discord.'
  : e.message;

/** Who the bot is, whether it's in the server, whether it can read each channel, and whether Message Content is on. */
async function inspect(token) {
  const me = await discord(token, '/users/@me');
  const app = await discord(token, '/applications/@me').catch(() => null);
  const appId = app?.id || me.id;
  const guilds = await discord(token, '/users/@me/guilds').catch(() => []);
  const inServer = Array.isArray(guilds) && guilds.some(g => g.id === GUILD_ID);
  const channels = [];
  for (const c of CHANNELS) {
    if (!inServer) { channels.push({ name: c.name, ok: false }); continue; }
    try { await discord(token, `/channels/${c.id}/messages?limit=1`); channels.push({ name: c.name, ok: true }); }
    catch (e) { channels.push({ name: c.name, ok: false, error: friendly(e) }); }
  }
  return {
    bot: me.global_name || me.username || 'Bot',
    appId,
    intent: app ? Boolean(Number(app.flags || 0) & MESSAGE_CONTENT) : null,
    inServer,
    channels,
    invite: inviteUrl(appId),
    checkedAt: new Date().toISOString()
  };
}

/* ---------- what the page sees (never the token) ---------- */
export async function discordStatus() {
  const t = await tokenInfo().catch(() => null);
  const state = await readState().catch(() => ({}));
  const ready = Boolean(t && state.check?.inServer && state.check?.intent !== false && state.check?.channels?.every(c => c.ok));
  return {
    configured: Boolean(t),
    tokenFrom: t?.from || '',
    ready,
    check: t ? state.check || null : null,
    lastRun: state.lastRun || '',
    lastOk: state.lastOk || '',
    lastError: state.lastError || '',
    imported: state.imported || 0,
    recent: state.recent || [],
    channels: CHANNELS.map(c => '#' + c.name)
  };
}

export async function discordConnect(token, by = 'Someone') {
  token = String(token || '').trim().replace(/^Bot\s+/i, '');
  if (!/^[\w.-]{50,100}$/.test(token)) throw oops('That doesn\'t look like a bot token. In the Discord Developer Portal, open your app → Bot → Reset Token, then copy it.');
  let check;
  try { check = await inspect(token); }
  catch (e) { throw oops(e.status === 401 ? 'Discord didn\'t accept that token. Reset it in the Developer Portal and paste the new one.' : 'Couldn\'t reach Discord: ' + e.message, e.status === 401 ? 400 : 502); }
  const s = await store('ideation-discord');
  await s.setJSON('token', { token, savedBy: String(by).slice(0, 60), savedAt: new Date().toISOString() });
  const state = await readState();
  state.check = check; state.lastError = '';
  await writeState(state);
  return discordStatus();
}

export async function discordDisconnect() {
  const s = await store('ideation-discord');
  await s.delete('token');
  return discordStatus();
}

/* ---------- importing ---------- */
function knownKeys(all) {
  const keys = new Set();
  for (const x of [...Object.values(all.outliers), ...Object.values(all.ideas)]) {
    if (x.discord?.key) keys.add(x.discord.key);
    (x.alsoPosted || []).forEach(d => d?.key && keys.add(d.key));
  }
  return keys;
}
/** The newest message already in here from a channel, so the first run only picks up what's new since the first import. */
function newestKnown(keys, channelId) {
  let best = '';
  for (const k of keys) if (k.startsWith(channelId + '-')) { const m = k.split('-')[1]; if (/^\d+$/.test(m)) best = best ? later(best, m) : m; }
  return best;
}
const isImage = a => /^image\//.test(a.content_type || '') || /\.(png|jpe?g|webp|gif|avif)$/i.test(a.filename || '');
const withQuery = (u, q) => { const x = new URL(u); Object.entries(q).forEach(([k, v]) => x.searchParams.set(k, v)); return x.toString(); };

async function fetchBytes(link) {
  const res = await fetch(link, { signal: AbortSignal.timeout(12000), redirect: 'follow' });
  if (!res.ok) throw new Error('Couldn\'t download an image (' + res.status + ').');
  return res.arrayBuffer();
}
/** Copy a Discord attachment into our image store. Big ones come through Discord's resizer as a 1600px WebP. */
async function saveAttachment(a) {
  const resized = a.proxy_url ? withQuery(a.proxy_url, { format: 'webp', width: '1600' }) : '';
  let bytes = (a.size || 0) < MAX_IMAGE_BYTES - 4096 && a.url ? await fetchBytes(a.url) : null;
  if ((!bytes || bytes.byteLength > MAX_IMAGE_BYTES) && resized) bytes = await fetchBytes(resized);
  if (!bytes) throw new Error('An image was too big to copy.');
  return saveImage(bytes, { source: 'discord:' + String(a.filename || '').slice(0, 120) });
}
async function saveYouTubeThumb(videoId) {
  for (const size of ['maxresdefault', 'hqdefault']) {
    try { const bytes = await fetchBytes(`https://i.ytimg.com/vi/${videoId}/${size}.jpg`); if (bytes.byteLength > 2000) return await saveImage(bytes, { source: 'youtube:' + videoId }); } catch {}
  }
  return null;
}
async function videoInfo(videoId) {
  const stats = (await videoStats([videoId]).catch(() => ({})))[videoId];
  if (stats) return { ...stats, statsAt: new Date().toISOString() };
  const basic = await oembed(videoId);
  return basic ? { ...basic, views: null, subs: null, published: '', statsAt: '' } : null;
}

/** Turn one Discord message into outliers (or an idea). Returns what was added, and how many images it copied. */
async function importMessage(c, m, ctx) {
  const now = new Date().toISOString();
  const text = String(m.content || '').trim();
  const links = [...new Set([...text.matchAll(/https?:\/\/[^\s<>()]+/g)].map(x => x[0]))];
  const vids = [...new Set(links.map(youtubeId).filter(Boolean))].slice(0, 5);
  const note = text.replace(/<?https?:\/\/[^\s<>()]+>?/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
  const pics = (m.attachments || []).filter(isImage).slice(0, 10);
  const postedBy = String(m.author?.global_name || m.author?.username || 'Discord').slice(0, 60);
  const postedAt = m.timestamp || now;
  const messageUrl = `https://discord.com/channels/${GUILD_ID}/${c.id}/${m.id}`;
  const made = [];
  let images = 0;
  const noteFor = stable => (note ? [{ id: 'n_' + stable, by: postedBy, text: note, at: postedAt }] : []);

  if (c.kind === 'idea') {
    const key = `${c.id}-${m.id}`;
    if (ctx.known.has(key) || (!note && !pics.length && !links.length)) return { made, images };
    const stable = sha(key);
    const saved = [];
    for (const a of pics.slice(0, 6)) { saved.push(await saveAttachment(a)); images++; }
    const similar = [];
    for (const v of vids) {
      const info = await videoInfo(v);
      similar.push({ id: newId(), url: 'https://www.youtube.com/watch?v=' + v, videoId: v, title: info?.title || '', channel: info?.channel || '', views: info?.views ?? null, thumb: `https://i.ytimg.com/vi/${v}/mqdefault.jpg`, note: '' });
    }
    const sources = links.filter(l => !youtubeId(l)).slice(0, 20).map(l => { let label = l; try { label = new URL(l).hostname.replace(/^www\./, ''); } catch {} return { id: newId(), label, url: l.slice(0, 1500), note: '' }; });
    const firstLine = note.split('\n').map(x => x.trim()).find(Boolean) || '';
    const title = firstLine.slice(0, 160) || (similar[0]?.title ? 'Ref: ' + similar[0].title : pics.length ? 'Idea from a Discord image' : 'Idea from a Discord link');
    const item = { id: 'idea_d' + stable, createdAt: postedAt, updatedAt: now, addedBy: 'Discord bot', status: 'Rough', title, premise: '', hook: '', thumbnailConcept: '', owner: '', tags: [], titleOptions: [], sources, similar, outlierIds: [], notes: noteFor(stable), images: saved.map(x => ({ id: x.id, small: '', caption: '' })), discord: { key, channel: c.name, postedBy, postedAt, messageUrl } };
    await putItem('ideas', item);
    ctx.known.add(key);
    made.push({ kind: 'idea', id: item.id, title: item.title, channel: c.name, at: now });
    return { made, images };
  }

  // Outlier channels: one outlier per screenshot. A YouTube link next to a single screenshot belongs to it;
  // links on their own become outliers too (with the real thumbnail, title, views and subscribers).
  const linkFor = pics.length === 1 && vids.length === 1 ? vids[0] : '';
  for (let i = 0; i < pics.length; i++) {
    const key = `${c.id}-${m.id}-${i}`;
    if (ctx.known.has(key)) continue;
    const stable = sha(key);
    const up = await saveAttachment(pics[i]); images++;
    const item = { id: 'out_d' + stable, createdAt: postedAt, updatedAt: now, addedBy: 'Discord bot', title: '', channel: '', url: '', videoId: '', views: null, subs: null, why: '', steal: '', tags: [], notes: noteFor(stable), image: up.id, imageSmall: '', starred: false, archived: false, genre: c.genre || '', discord: { key, channel: c.name, postedBy, postedAt, messageUrl } };
    if (linkFor && !ctx.byVideo.has(linkFor)) {
      const info = await videoInfo(linkFor);
      Object.assign(item, { videoId: linkFor, url: 'https://www.youtube.com/watch?v=' + linkFor, title: info?.title || '', channel: info?.channel || '', views: info?.views ?? null, subs: info?.subs ?? null, published: info?.published || '', statsAt: info?.statsAt || '', thumbUrl: youtubeThumb(linkFor) });
      ctx.byVideo.set(linkFor, item.id);
    }
    await putItem('outliers', item);
    ctx.known.add(key);
    made.push({ kind: 'outlier', id: item.id, title: item.title, channel: c.name, at: now });
  }
  for (const v of vids) {
    if (v === linkFor) continue;
    const key = `${c.id}-${m.id}-yt-${v}`;
    if (ctx.known.has(key)) continue;
    const discord = { key, channel: c.name, postedBy, postedAt, messageUrl };
    const twin = ctx.byVideo.get(v);
    if (twin) { // already in here: remember it was posted again, and keep what was said
      await updateItem('outliers', twin, o => {
        (o.alsoPosted ||= []).push(discord);
        if (note && !(o.notes || []).some(n => n.text.trim() === note)) (o.notes ||= []).push({ id: newId('n_'), by: postedBy, text: note, at: postedAt });
        o.updatedAt = now;
      }, saved => (saved.alsoPosted || []).some(d => d.key === key)).catch(() => {});
      ctx.known.add(key);
      continue;
    }
    const stable = sha(key);
    const info = await videoInfo(v);
    const thumb = await saveYouTubeThumb(v); if (thumb) images++;
    const item = { id: 'out_d' + stable, createdAt: postedAt, updatedAt: now, addedBy: 'Discord bot', title: info?.title || '', channel: info?.channel || '', url: 'https://www.youtube.com/watch?v=' + v, videoId: v, views: info?.views ?? null, subs: info?.subs ?? null, published: info?.published || '', statsAt: info?.statsAt || '', thumbUrl: youtubeThumb(v), why: '', steal: '', tags: [], notes: noteFor(stable), image: thumb?.id || '', imageSmall: '', tidiedAt: now, starred: false, archived: false, genre: c.genre || '', discord };
    await putItem('outliers', item);
    ctx.known.add(key); ctx.byVideo.set(v, item.id);
    made.push({ kind: 'outlier', id: item.id, title: item.title, channel: c.name, at: now });
  }
  return { made, images };
}

/**
 * Read every channel's new posts and import them. Stops early (and picks up where it left off next time)
 * when the time budget or the per-run image limit is reached.
 */
export async function syncDiscord({ budgetMs = 22000, recheck = false } = {}) {
  const started = Date.now(), left = () => budgetMs - (Date.now() - started);
  const stopChannel = Math.min(6000, budgetMs * 0.35), stopMessage = Math.min(5000, budgetMs * 0.3); // room left to finish cleanly
  const t = await tokenInfo();
  if (!t) return { configured: false };
  const state = await readState();
  if (state.lockUntil && Date.parse(state.lockUntil) > Date.now()) return { configured: true, busy: true };
  state.lockUntil = new Date(Date.now() + budgetMs + 8000).toISOString();
  await writeState(state);

  const result = { configured: true, added: [], errors: [], more: false };
  try {
    // Check the setup (cheap) every run, so a switched-off Message Content Intent can't silently lose posts.
    try { state.check = await inspect(t.token); }
    catch (e) { throw new Error(friendly(e)); }
    const check = state.check;
    if (!check.inServer) throw new Error('The bot isn\'t in the JOSH BRETT YOUTUBE server yet. Use "Add the bot to the server".');
    if (check.intent === false) throw new Error('Turn on "Message Content Intent" for the bot in the Discord Developer Portal (Bot page), or it can\'t see posts.');

    const all = await readAll();
    const ctx = { known: knownKeys(all), byVideo: new Map(Object.values(all.outliers).filter(o => o.videoId).map(o => [o.videoId, o.id])) };
    state.cursors ||= {};
    let images = 0;
    for (const c of CHANNELS) {
      if (!state.cursors[c.id]) state.cursors[c.id] = newestKnown(ctx.known, c.id) || snowflakeAt(Date.now() - 24 * 3600e3);
      if (!check.channels.find(x => x.name === c.name)?.ok) { result.errors.push('#' + c.name + ': ' + (check.channels.find(x => x.name === c.name)?.error || 'can\'t read it')); continue; }
      if (left() < stopChannel || images >= IMAGES_PER_RUN) { result.more = true; break; }
      let msgs;
      try { msgs = await discord(t.token, `/channels/${c.id}/messages?after=${state.cursors[c.id]}&limit=50`); }
      catch (e) { result.errors.push('#' + c.name + ': ' + friendly(e)); if (e.rate) { result.more = true; break; } continue; }
      msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      if (msgs.length === 50) result.more = true;
      for (const m of msgs) {
        if (left() < stopMessage || images >= IMAGES_PER_RUN) { result.more = true; break; }
        if ([0, 19].includes(m.type) && !m.author?.bot) {
          try { const r = await importMessage(c, m, ctx); result.added.push(...r.made); images += r.images; }
          catch (e) {
            // A post that fails is tried again next run, up to 3 times, so one broken image can't block the channel.
            const k = c.id + '-' + m.id;
            state.failures ||= {};
            state.failures[k] = (state.failures[k] || 0) + 1;
            result.errors.push('#' + c.name + ': ' + e.message);
            if (state.failures[k] < 3) { result.more = true; break; }
            delete state.failures[k];
          }
        }
        state.cursors[c.id] = m.id;
      }
    }
    state.lastOk = new Date().toISOString();
    state.lastError = result.errors.join(' · ').slice(0, 600);
    state.imported = (state.imported || 0) + result.added.length;
    if (result.added.length) state.recent = [...result.added.map(a => ({ kind: a.kind, id: a.id, title: a.title, channel: a.channel, at: a.at })).reverse(), ...(state.recent || [])].slice(0, RECENT_KEPT);
  } catch (e) {
    state.lastError = e.message;
    result.errors.push(e.message);
  } finally {
    state.lastRun = new Date().toISOString();
    state.lockUntil = '';
    await writeState(state);
  }
  return { ...result, status: await discordStatus() };
}
