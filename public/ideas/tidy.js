/*
 * Ideation Machine: "tidy" a screenshot of a YouTube video card.
 * Finds the thumbnail inside the screenshot (the biggest 16:9-ish block that stands out from the page background,
 * looking inside a coloured card if there is one), crops to it, and reads the title / channel / views / age from the
 * text beside or below it with Tesseract (self-hosted in ./vendor/tesseract, loaded only when this runs).
 *
 * window.IdeationTidy.analyse(blobOrImageUrl) -> { crop: {x,y,w,h} | null, cropped: Blob | null, title, channel, views, age, text }
 */
(() => {
'use strict';
const VENDOR = new URL('./vendor/tesseract/', document.currentScript?.src || location.href).href;
let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src)); document.head.appendChild(s); });
}
async function worker() {
  if (!workerPromise) workerPromise = (async () => {
    if (!window.Tesseract) await loadScript(VENDOR + 'tesseract.min.js');
    return window.Tesseract.createWorker('eng', 1, { workerPath: VENDOR + 'worker.min.js', corePath: VENDOR, langPath: VENDOR, gzip: true, cacheMethod: 'write' });
  })().catch(err => { workerPromise = null; throw err; });
  return workerPromise;
}

async function toImage(src) {
  const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  return bmp;
}
function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

/* ---------- finding the thumbnail ---------- */
const key = (r, g, b) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
function dominantBorder(px, W, H, box, sides = 'tblr') {
  const counts = new Map(); let total = 0;
  const add = (x, y) => { const i = (y * W + x) * 4, k = key(px[i], px[i + 1], px[i + 2]); counts.set(k, (counts.get(k) || 0) + 1); total++; };
  for (let d = 0; d < 3; d++) {
    for (let x = box.x; x < box.x + box.w; x++) { if (sides.includes('t')) add(x, box.y + d); if (sides.includes('b')) add(x, box.y + box.h - 1 - d); }
    for (let y = box.y; y < box.y + box.h; y++) { if (sides.includes('l')) add(box.x + d, y); if (sides.includes('r')) add(box.x + box.w - 1 - d, y); }
  }
  let best = -1, n = 0; counts.forEach((c, k) => { if (c > n) { n = c; best = k; } });
  // average real colour of that bucket
  let r = 0, g = 0, b = 0, m = 0;
  for (let y = box.y; y < box.y + box.h; y += 2) for (let x = box.x; x < box.x + box.w; x += 2) {
    if (!(y < box.y + 3 || y >= box.y + box.h - 3 || x < box.x + 3 || x >= box.x + box.w - 3)) continue;
    const i = (y * W + x) * 4; if (key(px[i], px[i + 1], px[i + 2]) !== best) continue; r += px[i]; g += px[i + 1]; b += px[i + 2]; m++;
  }
  return { share: n / Math.max(1, total), color: m ? [r / m, g / m, b / m] : [0, 0, 0] };
}
function components(px, W, H, box, bg) {
  const mask = new Uint8Array(W * H);
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const i = (y * W + x) * 4;
    if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 42) mask[y * W + x] = 1;
  }
  // close 1px gaps inside the thumbnail (dilate once)
  const dil = new Uint8Array(W * H);
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    if (mask[y * W + x]) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= box.x && xx < box.x + box.w && yy >= box.y && yy < box.y + box.h) dil[yy * W + xx] = 1; } }
  }
  const seen = new Uint8Array(W * H), comps = [], stack = [];
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const p = y * W + x; if (!dil[p] || seen[p]) continue;
    let minX = x, maxX = x, minY = y, maxY = y, count = 0;
    seen[p] = 1; stack.push(p);
    while (stack.length) {
      const q = stack.pop(), qx = q % W, qy = (q - qx) / W; count++;
      if (qx < minX) minX = qx; if (qx > maxX) maxX = qx; if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
      const nb = [q - 1, q + 1, q - W, q + W];
      for (let k = 0; k < 4; k++) { const n = nb[k], nx = n % W, ny = (n - nx) / W; if (nx < box.x || nx >= box.x + box.w || ny < box.y || ny >= box.y + box.h || Math.abs(nx - qx) > 1) continue; if (dil[n] && !seen[n]) { seen[n] = 1; stack.push(n); } }
    }
    comps.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count });
  }
  return comps;
}
/** Look for a thumbnail inside `box`; if the biggest block is a card (not 16:9), look inside that card too. */
function search(px, W, H, box, depth) {
  let bd = dominantBorder(px, W, H, box);
  if (bd.share < 0.3) {
    // tight screenshot: the thumbnail touches some edges, so take the page colour from the side that's plain (under or beside it)
    bd = ['b', 'r', 't', 'l'].map(side => dominantBorder(px, W, H, box, side)).sort((a, b) => b.share - a.share)[0];
    if (bd.share < 0.6) return null;
  }
  const comps = components(px, W, H, box, bd.color).filter(c => c.w * c.h >= box.w * box.h * 0.05 && c.w > 24 && c.h > 14);
  comps.sort((a, b) => b.w * b.h - a.w * a.h);
  const thumbish = c => { const r = c.w / c.h; return r >= 1.45 && r <= 2.1 && c.count / (c.w * c.h) > 0.55; };
  const hit = comps.find(thumbish);
  if (hit && hit.w * hit.h < box.w * box.h * 0.93) return { thumb: hit, container: box, bg: bd.color };
  if (depth < 2 && comps[0] && comps[0].w * comps[0].h < box.w * box.h * 0.97) {
    const c = comps[0];
    return search(px, W, H, { x: c.x + 2, y: c.y + 2, w: c.w - 4, h: c.h - 4 }, depth + 1);
  }
  return null;
}

/** Dark thumbnails on a dark page lose their edges to the background. Grow each side while the next row or column
 *  isn't flat page colour (screenshots of a UI have a perfectly flat background; thumbnails almost never do). */
function grow(px, W, H, t, box, bg) {
  const flat = (x, y) => { const i = (y * W + x) * 4; return Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) <= 12; };
  const rowFlat = (y, x0, x1) => { let f = 0; for (let x = x0; x <= x1; x++) f += flat(x, y); return f / (x1 - x0 + 1); };
  const colFlat = (x, y0, y1) => { let f = 0; for (let y = y0; y <= y1; y++) f += flat(x, y); return f / (y1 - y0 + 1); };
  let x0 = t.x, y0 = t.y, x1 = t.x + t.w - 1, y1 = t.y + t.h - 1;
  const minX = box.x, minY = box.y, maxX = box.x + box.w - 1, maxY = box.y + box.h - 1;
  for (let n = 0, moved = true; moved && n < 400; n++) {
    moved = false;
    if (y0 > minY && rowFlat(y0 - 1, x0, x1) < 0.85) { y0--; moved = true; }
    if (y1 < maxY && rowFlat(y1 + 1, x0, x1) < 0.85) { y1++; moved = true; }
    if (x0 > minX && colFlat(x0 - 1, y0, y1) < 0.85) { x0--; moved = true; }
    if (x1 < maxX && colFlat(x1 + 1, y0, y1) < 0.85) { x1++; moved = true; }
    const r = (x1 - x0 + 1) / (y1 - y0 + 1);
    if (r < 1.3 || r > 2.3) return t; // grew into text or the card: keep what we found
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, count: t.count };
}

/* ---------- reading the text ---------- */
const UI_PHRASES = /\b(from your watch later playlist|from your search history|recommended for you|new video|members only|premiere|enable inline keywords)\b/gi;
const REAL_LOWER = new Set('a i an the how why what who is are was my we so if and but to in on at of it me you your our no do did can now all this that these those when where one two top big new old bad'.split(' '));
/** Tidy a title read by machine: badges, avatar letters, stray symbols. */
function cleanTitle(t) {
  let tok = String(t || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const junk = x => /[=<>~§«»{}\[\]]/.test(x) || (/#/.test(x) && !/^#\w+$/.test(x)) || (/%/.test(x) && !/\d%/.test(x)) || (/^\W+$/.test(x) && !/^(?:[&+\-–—|:/]|\|\|)$/.test(x));
  // in front: avatar letters, "(59x)", "(29", "o.8x", "2" before Why/The/How, lowercase scraps like "mre"
  for (let guard = 0; guard < 6 && tok.length > 2; guard++) {
    const a = tok[0], b = tok[1];
    if (junk(a) || /\w#/.test(a) || /^\(?\w{0,2}\d+(?:\.\d+)?%?x?\)?$/i.test(a) && /[x%()]/i.test(a) || /^\w?\.?\d+(?:\.\d+)?x$/i.test(a) || /^\([A-Z0-9%.,]{1,6}\)$/.test(a) || /^[a-z][A-Z]$/.test(a)
      || (/^\d$/.test(a) && /^(Why|The|How|What|When|Who)$/.test(b)) || (/^[a-z]{1,4}:?$/.test(a) && !REAL_LOWER.has(a) && /^["“'‘(A-Z]/.test(b))
      || /^(?:[OQ0@©®]|[£$€@]\w?)$/.test(a) && /^["“'‘(A-Z0-9]/.test(b)) { tok.shift(); continue; }
    break;
  }
  if (tok[0] === '1' && /^[A-Z][a-z]+$/.test(tok[1] || '') && !/^(Year|Day|Week|Month|Hour|Minute|Thing|Way|Man|Woman|Habit|Rule|Trick)s?$/.test(tok[1])) tok[0] = 'I';
  // inside: stray symbols, "|" standing in for "I" before a lowercase word
  tok = tok.filter((x, i) => !(i > 0 && junk(x))).map((x, i, arr) => (x === '|' && arr[i + 1] && /^[a-z]/.test(arr[i + 1]) ? 'I' : x));
  // at the end: scraps like "ree", "i.", "H", "- 002", trailing ":" or ".."
  while (tok.length > 3) {
    const z = tok[tok.length - 1];
    if (junk(z) || /^[a-z]\.$/.test(z) || (/^[a-z]{1,3}\.?$/.test(z) && !REAL_LOWER.has(z.replace('.', ''))) || /^-?\d{3}$/.test(z) && tok[tok.length - 2] === '-') { tok.pop(); continue; }
    if (z === '-' ) { tok.pop(); continue; }
    break;
  }
  return tok.join(' ').replace(/\s*:\.+$/, '').replace(/\s*:$/, '').replace(/\s+([,.!?])/g, '$1').trim();
}
const WORDY = t => /^[A-Za-z0-9"“”'‘’$£€#(][A-Za-z0-9'’"“”.,!?:;&$£€%#()/+-]*$/.test(t) && /[A-Za-z0-9]/.test(t) && !/^[0-9.]+x$/i.test(t) && !/^[^(]*\)$/.test(t);
function cleanLine(l) {
  return String(l || '').replace(UI_PHRASES, ' ').replace(/(^|\b(?:how|why|what|when|where|so|and|but|then|if|as|until|after|before|now|today|here's|why|did|have|was|am|can|should|would|could|will)\s)\|(?=\s)/gi, '$1I').replace(/[•]+/g, ' · ').replace(/[▷►▶]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter((t, i, arr) => !(i === arr.length - 1 && (/^[^\w']{1,4}$/.test(t) || /^(e|o|c|a|s){2,4}$/i.test(t)))).join(' ')
    .replace(/\s*(\.\.\.|…|⋮)\s*$/, '').trim();
}
/** Drop badge / avatar junk in front of a title: start at the first run of three real words (or two, for short titles). */
function trimFront(t) {
  const tok = t.split(' ');
  // the channel avatar read as a letter, outlier-tool badges like "(37%)", "(EZ)", "13x"
  while (tok.length > 2 && (/^(?:[OQ0@©®]|[£$€@]\w?|\W{1,3})$/.test(tok[0]) || /^\([A-Z0-9%.,]{1,6}\)$/.test(tok[0]) || /^\w{0,3}\d+(?:\.\d)?x$/i.test(tok[0])) && /^["“'‘(A-Za-z0-9]/.test(tok[1])) tok.shift();
  for (let i = 0; i < tok.length; i++) {
    const need = Math.min(3, tok.length - i);
    if (need >= 2 && tok.slice(i, i + need).every(WORDY)) return tok.slice(i).join(' ');
    if (need === 1 && WORDY(tok[i]) && i === 0) return t;
  }
  return t;
}
const META = /\d[\d.,]*\s*[kmb]?\s*(?:views?|watching)\b|\d+\s*(?:yrs?|years?|mo|months?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?)\s+ago\b|\b(?:streamed|premiered)\b/i;
const num = (n, unit) => { const v = parseFloat(String(n).replace(',', '.')), m = { k: 1e3, m: 1e6, b: 1e9 }[String(unit || '').toLowerCase()] || 1; return Number.isFinite(v) ? Math.round(v * m) : null; };
function parse(text, rawLines) {
  const all = String(text || '');
  const out = { title: '', channel: '', views: null, age: '', subs: null, multiplier: null };
  const subs = all.match(/(\d+(?:[.,]\d+)?)\s*([kmb])\s*subs(?:cribers)?/i); if (subs) out.subs = num(subs[1], subs[2]);
  let lines = (rawLines && rawLines.length ? rawLines : all.split('\n').map(t => ({ text: t, h: 0 }))).map(l => ({ ...l, text: cleanLine(l.text) })).filter(l => l.text.length > 1 && /[a-z0-9]/i.test(l.text));
  const isMeta = l => META.test(l.text);
  const mi = lines.findIndex(isMeta);
  if (mi >= 0) {
    const meta = lines[mi].text;
    const nums = [...meta.matchAll(/(\d+(?:[.,]\d+)?)\s*([kmb])?(?![\w.])(\s*views?)?/gi)];
    const v = nums.find(m => (m[2] || m[3]) && !/^\s*subs/i.test(meta.slice(m.index + m[0].length)));
    if (v) {
      out.views = num(v[1], v[2]);
      const prefix = meta.slice(0, v.index).replace(/[^\w).!?'’]+$/, '').trim();
      if (/[a-z]{2}/i.test(prefix) && prefix.length < 60 && !META.test(prefix)) out.channel = trimFront(prefix);
    }
    const a = meta.match(/(\d+\s*(?:yrs?|years?|mo|months?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?)\s*ago)/i); if (a) out.age = a[1];
  }
  // the title is the run of biggest-text lines at the top; the channel is the next, smaller line
  let head = mi >= 0 ? lines.slice(0, mi) : lines;
  const subsAt = head.findIndex(l => /\d\s*[kmb]\s*subs(?:cribers)?\b/i.test(l.text));
  let subsLine = '';
  if (subsAt > 0) { subsLine = head[subsAt].text; head = head.slice(0, subsAt); } // a "1.6M subscribers" line ends the title
  if (head.length) {
    const hs = head.map(l => l.h).filter(Boolean);
    const big = hs.length ? Math.max(...hs) : 0;
    const inks = head.map(l => l.ink).filter(v => v != null);
    const darkest = inks.length ? Math.min(...inks) : null;
    const titleLike = l => (!big || l.h >= big * 0.72) && (darkest == null || l.ink == null || l.ink <= darkest + 40);
    let start = big ? head.findIndex(titleLike) : 0; if (start < 0) start = 0;
    let endI = start;
    while (endI + 1 < head.length && (!big || titleLike(head[endI + 1]))) endI++;
    if (!big && head.length >= 2 && mi >= 0) {
      // no sizes to go on: treat a short last line as the channel unless it obviously continues the title
      const last = head.at(-1).text, prev = head.at(-2).text;
      const continues = /^[a-z(]/.test(last) || ((prev.match(/\(/g) || []).length > (prev.match(/\)/g) || []).length);
      endI = continues || last.length > 30 ? head.length - 1 : head.length - 2;
    }
    if (!big && subsLine && endI === head.length - 2 && head.length >= 1) endI = head.length - 1; // the subs line was the channel, so every line above is title
    const rawTitle = head.slice(start, endI + 1).map(l => l.text).join(' ');
    const mult = rawTitle.match(/^(?:\S{1,4}\s)?(\d{1,4}(?:\.\d)?)\s?x\s/i); // outlier tools put "63.5x" in front of the title
    if (mult) out.multiplier = parseFloat(mult[1]);
    out.title = cleanTitle(trimFront(rawTitle));
    const pm = rawTitle.match(/^\S{0,4}\s?\((\d{1,4}(?:\.\d)?)x\)\s/i); if (pm && out.multiplier == null) out.multiplier = parseFloat(pm[1]); // "(59x) Title"
    const rest = head.slice(endI + 1).map(l => l.text).find(t => /[a-z]{2}/i.test(t)) || subsLine;
    if (!out.channel && rest && rest.length <= 60) out.channel = trimFront(rest.replace(/\s*[@·-]?\s*\d+(?:[.,]\d+)?\s*[kmb]\s*subs(?:cribers)?.*$/i, '').replace(/\s*@\s*[\d.]+[kmb]?\s*$/i, ''));
  }
  if (!out.channel && mi >= 0 && lines[mi + 1] && lines[mi + 1].text.length <= 45 && !isMeta(lines[mi + 1])) out.channel = lines[mi + 1].text;
  out.title = out.title.replace(/\s+/g, ' ').replace(/\s*[·-]\s*$/, '').trim();
  if (out.title.length < 6 || (out.title.match(/[a-z]/gi) || []).length < out.title.length * 0.5) out.title = '';
  out.title = out.title.slice(0, 300);
  out.channel = out.channel.replace(/\S*\s?VPH\b.*$/i, '').replace(/\s+\S*\d+(?:\.\d)?x\b.*$/i, '').replace(/\s+@\s*$/, '').trim();
  if ((out.channel.match(/[a-z]/gi) || []).length < 3) out.channel = '';
  out.channel = out.channel.replace(/\s*[✓✔]$/, '').replace(/^@?\W+(?=\w)/, m => (m.startsWith('@') ? '@' : '')).slice(0, 150);
  return out;
}
async function ocr(bmp, region, bg) {
  const scale = Math.min(3, Math.max(1.5, 900 / region.w));
  const c = canvasOf(region.w * scale, region.h * scale), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, region.x, region.y, region.w, region.h, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  const dark = (bg[0] * 0.299 + bg[1] * 0.587 + bg[2] * 0.114) < 128;
  for (let i = 0; i < p.length; i += 4) { let l = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114; if (dark) l = 255 - l; p[i] = p[i + 1] = p[i + 2] = l; }
  g.putImageData(d, 0, 0);
  const w = await worker();
  const { data } = await w.recognize(c);
  // a line's size = the median height of its words (so a round avatar read as "O" doesn't make a line look huge)
  const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  // and its "ink": how dark its darkest pixels are. Titles are full-contrast; channel names and view counts are grey.
  const ink = b => { const v = []; for (let y = Math.max(0, b.y0); y < Math.min(c.height, b.y1); y += 1) for (let x = Math.max(0, b.x0); x < Math.min(c.width, b.x1); x += 2) v.push(p[(y * c.width + x) * 4]); v.sort((a, z) => a - z); return v.length ? v[Math.floor(v.length * 0.03)] : 255; };
  const lines = (data.lines || []).map(l => ({ text: l.text.trim(), h: median((l.words || []).filter(w => /[A-Za-z0-9]{2,}/.test(w.text)).map(w => w.bbox.y1 - w.bbox.y0)) || (l.bbox.y1 - l.bbox.y0), ink: ink(l.bbox), y: l.bbox.y0 / scale })).filter(l => l.text);
  return { text: data.text || '', lines };
}

async function analyse(src, { readText = true } = {}) {
  const bmp = await toImage(src);
  const W0 = bmp.width, H0 = bmp.height, s = Math.min(1, 420 / W0);
  const W = Math.max(1, Math.round(W0 * s)), H = Math.max(1, Math.round(H0 * s));
  const c = canvasOf(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const found = search(px, W, H, { x: 0, y: 0, w: W, h: H }, 0);
  const out = { crop: null, cropped: null, title: '', channel: '', views: null, age: '', subs: null, multiplier: null, text: '', lines: [], width: W0, height: H0 };
  if (!found) return out;
  const t = grow(px, W, H, found.thumb, found.container, found.bg), k = 1 / s, inset = 1;
  out.crop = { x: Math.round((t.x + inset) * k), y: Math.round((t.y + inset) * k), w: Math.round((t.w - inset * 2) * k), h: Math.round((t.h - inset * 2) * k) };
  const cc = canvasOf(out.crop.w, out.crop.h);
  cc.getContext('2d').drawImage(bmp, out.crop.x, out.crop.y, out.crop.w, out.crop.h, 0, 0, cc.width, cc.height);
  out.cropped = await new Promise(r => cc.toBlob(r, 'image/png'));
  if (!readText) return out;
  // where's the text? beside the thumbnail (list / search layout) or under it (grid layout)
  const box = found.container, right = t.x + t.w, bottom = t.y + t.h;
  let region = null;
  if (box.x + box.w - right > box.w * 0.25) region = { x: right + 3, y: box.y, w: box.x + box.w - right - 3, h: Math.min(box.y + box.h, bottom + t.h * 0.15) - box.y };
  else if (box.y + box.h - bottom > 12) region = { x: box.x, y: bottom + 2, w: box.w, h: box.y + box.h - bottom - 2 };
  if (region && region.w > 20 && region.h > 10) {
    const full = { x: Math.round(region.x * k), y: Math.round(region.y * k), w: Math.round(region.w * k), h: Math.round(region.h * k) };
    const read = await ocr(bmp, full, found.bg);
    out.text = read.text; out.lines = read.lines;
    Object.assign(out, parse(read.text, read.lines));
  }
  return out;
}

window.IdeationTidy = { analyse, parse, cleanTitle, warm: () => worker() };
})();
