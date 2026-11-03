/**
 * YouTube Data API v3 (public data only) for the Content calendar.
 * Env: YOUTUBE_API_KEY (required), YOUTUBE_CHANNEL_HANDLE (optional, default "brettjosh").
 *
 * Reads the channel's uploads playlist back to the start of the year, keeps long-form videos
 * (over 3 minutes, so Shorts are ignored) and matches them to calendar entries:
 *   1. a YouTube link saved on the entry, 2. a video published that day (UK time),
 *   3. the nearest unclaimed video within 3 days (for a publish that slipped a day or two).
 * Costs a handful of quota units per refresh (the free quota is 10,000 a day); cached for 10 minutes.
 */
const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_MS = 10 * 60 * 1000;
const NEARBY_DAYS = 3;
const SINCE = '2026-01-01';
let cache = { at: 0, key: '', data: null };

export const youtubeConfigured = () => Boolean((process.env.YOUTUBE_API_KEY || '').trim());
const handle = () => (process.env.YOUTUBE_CHANNEL_HANDLE || 'brettjosh').trim().replace(/^@/, '');

async function yt(path, params) {
  const url = new URL(API + path);
  Object.entries({ ...params, key: (process.env.YOUTUBE_API_KEY || '').trim() }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('YouTube: ' + (data.error?.message || 'request failed (' + res.status + ')'));
  return data;
}

export function parseDuration(iso) {
  const m = String(iso || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
export function videoIdFrom(text) {
  const t = String(text || '').trim();
  const m = t.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/|\/video\/)([A-Za-z0-9_-]{11})/) || t.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : '';
}
export const londonDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000);

function shape(v) {
  const seconds = parseDuration(v.contentDetails?.duration);
  const publishedAt = v.snippet?.publishedAt || '';
  return {
    id: v.id, title: v.snippet?.title || '', url: 'https://youtu.be/' + v.id,
    publishedAt, date: publishedAt ? londonDate(publishedAt) : '',
    views: Number(v.statistics?.viewCount || 0), likes: Number(v.statistics?.likeCount || 0), comments: Number(v.statistics?.commentCount || 0),
    seconds, long: seconds > 180, live: v.snippet?.liveBroadcastContent || 'none',
    thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || ''
  };
}

const byId = new Map(); // videos fetched by id (e.g. a pasted link outside the uploads list), cached like the channel list
async function videosById(ids, { fresh = false } = {}) {
  const out = [], need = [];
  ids.forEach(id => { const c = byId.get(id); if (!fresh && c && Date.now() - c.at < CACHE_MS) out.push(c.v); else need.push(id); });
  for (let i = 0; i < need.length; i += 50) {
    const data = await yt('/videos', { part: 'snippet,contentDetails,statistics', id: need.slice(i, i + 50).join(','), maxResults: 50 });
    (data.items || []).forEach(v => { const shaped = shape(v); byId.set(shaped.id, { at: Date.now(), v: shaped }); out.push(shaped); });
  }
  return out;
}

/** Channel info + every upload since SINCE (Shorts included; callers filter on .long). */
export async function channelVideos({ fresh = false } = {}) {
  const key = handle() + '|' + (process.env.YOUTUBE_API_KEY || '').slice(-6);
  if (!fresh && cache.data && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;
  const ch = await yt('/channels', { part: 'snippet,contentDetails,statistics', forHandle: '@' + handle() });
  const channel = ch.items?.[0];
  if (!channel) throw new Error('YouTube: no channel found for @' + handle() + '. Set YOUTUBE_CHANNEL_HANDLE in Netlify.');
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  const ids = []; let pageToken = '';
  for (let page = 0; page < 8; page++) {
    const data = await yt('/playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    const items = data.items || [];
    let older = false;
    items.forEach(it => { const at = it.contentDetails?.videoPublishedAt || ''; if (at && at < SINCE) older = true; else if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId); });
    pageToken = data.nextPageToken || '';
    if (older || !pageToken) break;
  }
  const videos = await videosById(ids, { fresh: true });
  const data = { channel: { id: channel.id, title: channel.snippet?.title || '', subscribers: Number(channel.statistics?.subscriberCount || 0), handle: '@' + handle() }, videos };
  cache = { at: Date.now(), key, data };
  return data;
}

/** Adds .yt to calendar events that have a matching video; returns long-form uploads not on the calendar as extras. */
export async function enrich(events, { fresh = false, prefetched = null } = {}) {
  const { channel, videos } = prefetched || await channelVideos({ fresh });
  const known = new Map(videos.map(v => [v.id, v]));
  const linked = events.map(e => videoIdFrom(e.youtubeUrl)).filter(Boolean);
  const missing = [...new Set(linked.filter(id => !known.has(id)))];
  if (missing.length) (await videosById(missing, { fresh })).forEach(v => known.set(v.id, v));
  const longform = videos.filter(v => v.long && v.live !== 'upcoming');
  const claimed = new Set(linked);
  for (const e of events) { const id = videoIdFrom(e.youtubeUrl); if (id && known.has(id)) e.yt = { ...known.get(id), matchedBy: 'link' }; }
  for (const e of events) {
    if (e.yt || videoIdFrom(e.youtubeUrl)) continue;
    const v = longform.find(x => !claimed.has(x.id) && x.date === e.date);
    if (v) { claimed.add(v.id); e.yt = { ...v, matchedBy: 'date' }; }
  }
  const pairs = [];
  for (const e of events) {
    if (e.yt || videoIdFrom(e.youtubeUrl)) continue;
    for (const v of longform) { if (claimed.has(v.id)) continue; const d = Math.abs(dayDiff(v.date, e.date)); if (d <= NEARBY_DAYS) pairs.push({ e, v, d }); }
  }
  pairs.sort((a, b) => a.d - b.d);
  for (const { e, v } of pairs) { if (e.yt || claimed.has(v.id)) continue; claimed.add(v.id); e.yt = { ...v, matchedBy: 'nearby' }; }
  const extras = longform.filter(v => !claimed.has(v.id) && v.date >= SINCE);
  return { channel, extras };
}
