/**
 * YouTube Data API v3 (public data only) for the Content calendar.
 * Env: YOUTUBE_API_KEY (required), YOUTUBE_CHANNEL_HANDLE (optional, default "brettjosh").
 *
 * Reads the channel's uploads playlist back to the start of the year, keeps long-form videos
 * (over 3 minutes, so Shorts are ignored) and matches them to calendar entries:
 *   1. a YouTube link saved on the entry, 2. a video published that day (UK time),
 *   3. a video on the same topic (shared title words) up to 14 days either side,
 *   4. the nearest unclaimed video within 3 days (for a publish that slipped a day or two).
 * Costs a handful of quota units per refresh (the free quota is 10,000 a day); cached for 10 minutes.
 *
 * Sponsors: the sponsor's link normally sits in the top line of a video's description. Each video carries
 * .sponsor = { line, url, domain, guess } read from the first lines (Josh's own links and social profiles are skipped,
 * shortened links are followed to the brand's domain). allUploads() lists every long-form upload ever, for the sponsor history.
 */
const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_MS = 10 * 60 * 1000;
const ALL_CACHE_MS = 6 * 60 * 60 * 1000; // the full upload history changes twice a month; Refresh bypasses it
const NEARBY_DAYS = 3;
const SINCE = '2026-01-01';
let cache = { at: 0, key: '', data: null };
let allCache = { at: 0, key: '', data: null };

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
/* ---------- the sponsor link at the top of the description ----------
 * Josh's own sites and social profiles are never sponsors. Add more in Netlify with STUDIO_OWN_DOMAINS="example.com,other.com". */
const OWN_DOMAINS = ['brettjosh.com', 'joshbrett.store', 'kit.com', 'ck.page', 'convertkit.com', 'superwall.app', // Josh's sites, shop, Kit guides and training app
  'youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'facebook.com', 'threads.net', 'threads.com', 'discord.gg', 'discord.com', 'linktr.ee', 'open.spotify.com', 'patreon.com', 'beehiiv.com', 'substack.com',
  'google.com', 'forms.gle', 'notion.so', 'notion.site', 'apple.com']; // app-store and Google links are never the brand either
const ownDomains = () => OWN_DOMAINS.concat(String(process.env.STUDIO_OWN_DOMAINS || '').split(',').map(d => d.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean));
/* Link shorteners and affiliate networks hide the brand: these are followed (HEAD request, up to 4 hops) to find the real domain. */
const SHORTENERS = ['onelink.to', 'app.link', 'page.link', 'smart.link', 'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'geni.us', 'amzn.to', 'amzn.eu', 'prf.hn', 'rebrand.ly', 'shorturl.at', 'cutt.ly', 'go.magik.ly', 'howl.me', 'shop-links.co', 'sjv.io', 'pxf.io', 'impact.com', 'lnk.to', 'rb.gy', 'ow.ly', 'buff.ly', 'tiny.cc', 'is.gd', 't.ly', 'shrsl.com', 'shareasale.com', 'click.linksynergy.com', 'hop.clickbank.net', 'anrdoezrs.net', 'jdoqocy.com', 'kqzyfj.com', 'tkqlhce.com', 'dpbolvw.net', 'awin1.com', 'go.skimresources.com', 'zez.am', 'glnk.io', 'bit.do', 'short.io', 'tidd.ly', 'mavely.app', 'liketk.it', 'partner.bulk.com', 'tracking.bulk.com'];
const TOP_LINES = 3;         // "normally the top line"; a hook sentence or two above it is tolerated
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>()[\]"']+/gi;
export const hostOf = url => { try { return new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const under = (host, list) => list.some(d => host === d || host.endsWith('.' + d));
export const isOwnDomain = host => under(host, ownDomains());
export const isShortener = host => under(host, SHORTENERS);
/* "macrofactorapp.com" -> "macrofactorapp", "bulk.co.uk" -> "bulk" */
export function domainRoot(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return parts.length > 2 && /^(co|com|org|net|ac|gov|edu)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[parts.length - 2];
}
export function sponsorFromDescription(description) {
  const lines = String(description || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, TOP_LINES);
  for (let i = 0; i < lines.length; i++) {
    for (const raw of lines[i].match(URL_RE) || []) {
      const url = (/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).replace(/[.,;:!?]+$/, '');
      const domain = hostOf(url);
      if (!domain || isOwnDomain(domain)) continue;
      return { line: lines[i].slice(0, 220), lineNo: i + 1, url: url.slice(0, 300), domain, shortened: isShortener(domain), finalDomain: '', guess: '' };
    }
  }
  return null;
}
/* Words that start a sponsor line but are never the brand ("Try", "Get 20% off", "Use code", "Sponsored by"). */
const LINE_STOP = new Set('this the a an get try use check out download free code click here sign up start visit go to grab join watch my i thanks thank video videos sponsored sponsor sponsors by for with off your you first order today now at on in of and or link links below more all new best save discount promo exclusive limited offer trial weeks week month months days day year years app website program programs programme programmes full part episode subscribe like follow music source sources references reference head over learn read shop buy support channel train training workout workouts plan plans coaching book call apply percent us uk eu using when we they it are is be was were have has had just also only even still our their its from into that these those what why how who where which than then them there here make made take taken using used please dont don\'t can will would should could get got give given protein creatine supplement supplements shaker bundle gear kit'.split(' '));
/* The brand named in the line itself: the first run of capitalised words that isn't filler or the discount code ("MyProtein (Code BRETT)" -> MyProtein). */
export function brandInLine(line) {
  const text = String(line || '').replace(URL_RE, ' ').replace(/[^\p{L}\p{N}'’&+.\- ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const tokens = text.split(' ').filter(Boolean);
  const names = []; let run = [];
  const flush = () => { if (run.length) names.push(run.join(' ')); run = []; };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/^[.'’&+\-]+|[.'’&+\-]+$/g, '').replace(/['’]s$/, '');
    const prev = (tokens[i - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
    const cap = /^[A-Z0-9]/.test(tok) && /[A-Za-z]/.test(tok) && tok.length >= 2;
    const filler = LINE_STOP.has(tok.toLowerCase()) || prev === 'code' || /^\d+%?$/.test(tok) || /^\d+[A-Za-z]{1,2}$/.test(tok); // 20%, 2Y, 4M
    if (cap && !filler) { if (run.length < 3) run.push(tok); else { flush(); run = [tok]; } }
    else flush();
  }
  flush();
  return names[0] || '';
}
const nice = root => root ? root.charAt(0).toUpperCase() + root.slice(1) : '';
/* Best name for the brand: named in the line, else the domain (after following a shortened link). */
export function guessBrand(sp) {
  if (!sp) return '';
  const inLine = brandInLine(sp.line);
  if (inLine) return inLine;
  const host = sp.finalDomain || (sp.shortened ? '' : sp.domain);
  return host && !isOwnDomain(host) && !isShortener(host) ? nice(domainRoot(host)) : '';
}
/* Shortened links are followed once a day; this never throws and never slows the calendar by more than a few seconds. */
const resolved = new Map(); // url -> { at, host }
const RESOLVE_MS = 24 * 60 * 60 * 1000;
export async function finalHost(url, hops = 4) {
  const hit = resolved.get(url);
  if (hit && Date.now() - hit.at < RESOLVE_MS) return hit.host;
  let current = url, host = '';
  try {
    for (let i = 0; i < hops; i++) {
      let res = await fetch(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(2500), headers: { 'user-agent': 'Mozilla/5.0 (Josh Brett Studio sponsor check)' } });
      if (res.status === 405 || res.status === 403) res = await fetch(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(2500), headers: { 'user-agent': 'Mozilla/5.0 (Josh Brett Studio sponsor check)', range: 'bytes=0-0' } });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
      break;
    }
    host = hostOf(current);
    if (isShortener(host)) host = '';
  } catch { host = ''; }
  resolved.set(url, { at: Date.now(), host });
  return host;
}
export async function addSponsorGuesses(videos) {
  const pending = videos.filter(v => v.sponsor && v.sponsor.shortened && !v.sponsor.finalDomain);
  await Promise.all(pending.map(async v => { v.sponsor.finalDomain = await finalHost(v.sponsor.url); }));
  videos.forEach(v => { if (v.sponsor) v.sponsor.guess = guessBrand(v.sponsor); });
  return videos;
}

/* Topic matching: the plan title vs the YouTube title, after dropping filler words and the "(Sponsor)" bit. */
const STOP = new Set('publish published video videos the a an and or of to in on for with why how what when who you your my me i is are was so do does did this that it its we our vs about tbc part ep episode new doc documentary full official trailer just really most more than then from into over after before every can will not no yes they them their there here be been being have has had get got make made one two'.split(' '));
export function topicWords(text) {
  return new Set(String(text || '').replace(/\([^)]*\)\s*$/, ' ').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .map(w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
    .filter(w => w.length >= 3 && !STOP.has(w)));
}
/* Capitalised words in the plan are usually names ("Dr Mike", "Rich Piana"): one shared name is enough. */
function planNames(text) {
  const body = String(text || '').replace(/\([^)]*\)\s*$/, ' ');
  return new Set([...topicWords((body.match(/\b[A-Z][a-zA-Z']{2,}\b/g) || []).join(' '))]);
}
export function topicScore(planText, videoTitle) {
  const a = topicWords(planText), b = topicWords(videoTitle), names = planNames(planText);
  const shared = [...a].filter(w => b.has(w));
  return shared.length >= 2 || shared.some(w => w.length >= 5 || names.has(w)) ? shared.length : 0;
}
const TITLE_WINDOW = { before: 14, after: 14 };
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
    thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || '',
    sponsor: sponsorFromDescription(v.snippet?.description)
  };
}

const byId = new Map(); // videos fetched by id (e.g. a pasted link outside the uploads list), cached like the channel list
async function videosById(ids, { fresh = false } = {}) {
  const out = [], need = [];
  ids.forEach(id => { const c = byId.get(id); if (!fresh && c && Date.now() - c.at < CACHE_MS) out.push(c.v); else need.push(id); });
  const batches = [];
  for (let i = 0; i < need.length; i += 50) batches.push(need.slice(i, i + 50));
  const pages = await Promise.all(batches.map(batch => yt('/videos', { part: 'snippet,contentDetails,statistics', id: batch.join(','), maxResults: 50 })));
  pages.forEach(data => (data.items || []).forEach(v => { const shaped = shape(v); byId.set(shaped.id, { at: Date.now(), v: shaped }); out.push(shaped); }));
  await addSponsorGuesses(out);
  return out;
}

async function channelAndUploads() {
  const ch = await yt('/channels', { part: 'snippet,contentDetails,statistics', forHandle: '@' + handle() });
  const channel = ch.items?.[0];
  if (!channel) throw new Error('YouTube: no channel found for @' + handle() + '. Set YOUTUBE_CHANNEL_HANDLE in Netlify.');
  return { channel: { id: channel.id, title: channel.snippet?.title || '', subscribers: Number(channel.statistics?.subscriberCount || 0), handle: '@' + handle() }, uploads: channel.contentDetails?.relatedPlaylists?.uploads };
}
/* Video ids from the uploads playlist, newest first, stopping at `since` (or after maxPages pages). */
async function uploadIds(uploads, { since = '', maxPages = 8 } = {}) {
  const ids = []; let pageToken = '';
  for (let page = 0; page < maxPages; page++) {
    const data = await yt('/playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    const items = data.items || [];
    let older = false;
    items.forEach(it => { const at = it.contentDetails?.videoPublishedAt || ''; if (since && at && at < since) older = true; else if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId); });
    pageToken = data.nextPageToken || '';
    if (older || !pageToken) break;
  }
  return ids;
}
const cacheKey = () => handle() + '|' + (process.env.YOUTUBE_API_KEY || '').slice(-6);

/** Channel info + every upload since SINCE (Shorts included; callers filter on .long). */
export async function channelVideos({ fresh = false } = {}) {
  const key = cacheKey();
  if (!fresh && cache.data && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;
  const { channel, uploads } = await channelAndUploads();
  const ids = await uploadIds(uploads, { since: SINCE, maxPages: 8 });
  const videos = await videosById(ids, { fresh: true });
  const data = { channel, videos };
  cache = { at: Date.now(), key, data };
  return data;
}

/** Every upload on the channel, ever (Shorts included; callers filter on .long). Cached for 6 hours; fresh=true reloads. */
export async function allUploads({ fresh = false } = {}) {
  const key = cacheKey();
  if (!fresh && allCache.data && allCache.key === key && Date.now() - allCache.at < ALL_CACHE_MS) return allCache.data;
  const { channel, uploads } = await channelAndUploads();
  const ids = await uploadIds(uploads, { maxPages: 40 }); // up to 2,000 uploads
  const videos = await videosById(ids, { fresh });
  videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const data = { channel, videos };
  allCache = { at: Date.now(), key, data };
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
  // Same topic, published up to 14 days either side (a slipped upload, often with a reworded title).
  const topical = [];
  for (const e of events) {
    if (e.yt || videoIdFrom(e.youtubeUrl)) continue;
    for (const v of longform) {
      if (claimed.has(v.id)) continue;
      const d = dayDiff(v.date, e.date); if (d < -TITLE_WINDOW.before || d > TITLE_WINDOW.after) continue;
      const score = topicScore(e.text, v.title); if (score) topical.push({ e, v, score, d: Math.abs(d) });
    }
  }
  topical.sort((a, b) => b.score - a.score || a.d - b.d);
  for (const { e, v } of topical) { if (e.yt || claimed.has(v.id)) continue; claimed.add(v.id); e.yt = { ...v, matchedBy: 'title' }; }
  // Anything left: the nearest upload within 3 days, whatever its title.
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
