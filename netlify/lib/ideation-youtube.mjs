/**
 * YouTube lookups for the Ideation Machine (shared by the page's API and the Discord sync).
 * Uses the Studio's YOUTUBE_API_KEY when it's set; oEmbed (no key) gives title and channel otherwise.
 */
export async function oembed(videoId) {
  try {
    const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = await res.json();
    return { title: d.title || '', channel: d.author_name || '' };
  } catch { return null; }
}
export async function ytApi(pathname, params) {
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!key) return null;
  const u = new URL('https://www.googleapis.com/youtube/v3' + pathname);
  Object.entries({ ...params, key }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { signal: AbortSignal.timeout(7000) });
  if (!res.ok) return null;
  return res.json();
}
/** Title, channel, views, publish date and the channel's subscriber count for up to 50 videos. */
export async function videoStats(ids) {
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
