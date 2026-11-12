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
function dominantBorder(px, W, H, box) {
  const counts = new Map(); let total = 0;
  const add = (x, y) => { const i = (y * W + x) * 4, k = key(px[i], px[i + 1], px[i + 2]); counts.set(k, (counts.get(k) || 0) + 1); total++; };
  for (let d = 0; d < 3; d++) {
    for (let x = box.x; x < box.x + box.w; x++) { add(x, box.y + d); add(x, box.y + box.h - 1 - d); }
    for (let y = box.y; y < box.y + box.h; y++) { add(box.x + d, y); add(box.x + box.w - 1 - d, y); }
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
  const bd = dominantBorder(px, W, H, box);
  if (bd.share < 0.3) return null;
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
function cleanLine(l) {
  return l.replace(/[|•·]+/g, ' · ').replace(/[▷►▶]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter((t, i, arr) => !(i === arr.length - 1 && (/^[^\w']{1,4}$/.test(t) || /^(e|o|c|a|s){2,4}$/i.test(t)))).join(' ')
    .replace(/\s*(\.\.\.|…|⋮)\s*$/, '').trim();
}
const META = /\b(views?|ago|watching|streamed|yrs?|years?|mo|months?|weeks?|wks?|days?|hours?|hrs?)\b/i;
function parse(text) {
  const lines = String(text || '').split('\n').map(cleanLine).filter(l => l.length > 1 && /[a-z0-9]/i.test(l));
  const mi = lines.findIndex(l => META.test(l) && /\d/.test(l));
  let title = '', channel = '', views = null, age = '';
  if (mi === -1) title = lines.slice(0, 2).join(' ');
  else {
    const meta = lines[mi], before = lines.slice(0, mi);
    const all = [...meta.matchAll(/(\d+(?:[.,]\d+)?)\s*([kmb])?(?![\w.])(\s*views?)?/gi)];
    const v = all.find(m => m[2] || m[3]);
    if (v) {
      const n = parseFloat(v[1].replace(',', '.')), mult = { k: 1e3, m: 1e6, b: 1e9 }[(v[2] || '').toLowerCase()] || 1;
      if (Number.isFinite(n)) views = Math.round(n * mult);
      const prefix = meta.slice(0, v.index).replace(/[^\w).!?'’]+$/, '').trim();
      if (/[a-z]{2}/i.test(prefix) && prefix.length < 60) channel = prefix;
    }
    const a = meta.match(/(\d+\s*(?:yrs?|years?|mo|months?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?)\s*ago)/i); if (a) age = a[1];
    if (!channel && before.length >= 2 && before.at(-1).length <= 45) { channel = before.at(-1); before.pop(); }
    if (!channel && before.length === 1 && lines[mi + 1] && lines[mi + 1].length <= 45 && !META.test(lines[mi + 1])) channel = lines[mi + 1];
    title = before.join(' ');
  }
  title = title.replace(/\s+/g, ' ').trim().replace(/^(?:[^\w"'“‘(]{1,3}|[O0@©®Q])\s+(?=[A-Z0-9"'“‘$£(])/, ''); // the channel avatar read as a letter
  if (title.length < 6 || (title.match(/[a-z]/gi) || []).length < title.length * 0.5) title = '';
  return { title: title.slice(0, 300), channel: channel.replace(/\s*[✓✔]$/, '').slice(0, 150), views, age };
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
  return data.text || '';
}

async function analyse(src, { readText = true } = {}) {
  const bmp = await toImage(src);
  const W0 = bmp.width, H0 = bmp.height, s = Math.min(1, 420 / W0);
  const W = Math.max(1, Math.round(W0 * s)), H = Math.max(1, Math.round(H0 * s));
  const c = canvasOf(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const found = search(px, W, H, { x: 0, y: 0, w: W, h: H }, 0);
  const out = { crop: null, cropped: null, title: '', channel: '', views: null, age: '', text: '', width: W0, height: H0 };
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
    out.text = await ocr(bmp, full, found.bg);
    Object.assign(out, parse(out.text));
  }
  return out;
}

window.IdeationTidy = { analyse, parse, warm: () => worker() };
})();
