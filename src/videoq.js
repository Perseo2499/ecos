// Vídeos: mejor versión entre Instagram y Facebook, recompresión a 1080p con ffmpeg y portada.
// Si ffmpeg no está disponible, todo sigue funcionando sin comprimir.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const Q = require('../renderer/vidq');

// ---- ffmpeg ----
let ffCache;
function ffmpegPath() {
  if (ffCache !== undefined) return ffCache;
  ffCache = null;
  const tries = [];
  try { tries.push(require('ffmpeg-static')); } catch { /* sin el paquete */ }
  tries.push('ffmpeg'); // el del sistema (desarrollo)
  for (let p of tries) {
    if (!p) continue;
    p = String(p).replace(/app\.asar(?![.\w])/, 'app.asar.unpacked'); // fuera del paquete asar
    try { if (spawnSync(p, ['-version'], { timeout: 8000 }).status === 0) { ffCache = p; break; } } catch { /* siguiente */ }
  }
  return ffCache;
}
const resetFfmpegCache = () => { ffCache = undefined; };

function run(bin, args, timeout = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let err = '';
    const to = setTimeout(() => { p.kill(); reject(new Error('ffmpeg tardó demasiado')); }, timeout);
    p.stderr.on('data', (d) => { err = (err + d).slice(-60000); });
    p.on('error', (e) => { clearTimeout(to); reject(e); });
    p.on('close', (code) => { clearTimeout(to); resolve({ code, err }); });
  });
}

// Lee ancho, alto y duración de la salida de «ffmpeg -i» (tiene en cuenta el giro del móvil)
function parseInfo(text) {
  const s = String(text || '');
  const line = s.split('\n').find((l) => /Stream #.*Video:/.test(l) && !/attached pic/.test(l));
  let width = 0, height = 0;
  if (line) {
    const m = line.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').match(/[ ,](\d{2,5})x(\d{2,5})[ ,]/);
    if (m) { width = Number(m[1]); height = Number(m[2]); }
  }
  const rot = s.match(/displaymatrix: rotation of (-?[\d.]+) degrees/) || s.match(/rotate\s*:\s*(-?\d+)/);
  if (rot && Math.abs(Math.round(Number(rot[1]) / 90)) % 2 === 1) [width, height] = [height, width];
  const d = s.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return { width, height, duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0 };
}
async function probe(file) {
  const bin = ffmpegPath();
  if (!bin) return null;
  try { return parseInfo((await run(bin, ['-hide_banner', '-i', file], 60000)).err); } catch { return null; }
}

// Procesa un vídeo del disco: mide, comprime si hace falta y saca la portada.
// Nunca falla: si algo no va, devuelve el original. Devuelve { file, width, height, posterFile, transcoded, dir }.
// dir es una carpeta temporal que quien llama borra al terminar.
async function processVideo(file, { name } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-vid-'));
  const res = { file, width: 0, height: 0, posterFile: null, transcoded: false, dir };
  const bin = ffmpegPath();
  if (!bin) return res;
  try {
    const info = await probe(file);
    if (!info) return res;
    res.width = info.width; res.height = info.height;
    const size = fs.statSync(file).size;
    if (info.width && Q.needsTranscode({ width: info.width, height: info.height, size })) {
      const t = Q.targetSize(info.width, info.height);
      const base = String(name || path.basename(file)).replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 60) || 'video';
      const out = path.join(dir, base + '.mp4');
      const r = await run(bin, ['-hide_banner', '-y', '-i', file, '-vf', `scale=${t.width}:${t.height}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
      // solo se usa si salió bien y, de no haber hecho falta reducir las medidas, si pesa menos que el original
      const shrunk = Math.min(info.width, info.height) > Q.MAX_SHORT;
      if (r.code === 0 && fs.existsSync(out) && (shrunk || fs.statSync(out).size < size)) {
        res.file = out; res.transcoded = true; res.width = t.width; res.height = t.height;
      }
    }
    // Portada: fotograma a 1 s (o el primero si dura menos)
    const poster = path.join(dir, 'portada.jpg');
    for (const ss of (info.duration && info.duration < 1.2 ? ['0'] : ['1', '0'])) {
      const pr = await run(bin, ['-hide_banner', '-y', '-ss', ss, '-i', res.file, '-frames:v', '1', '-q:v', '3', poster], 120000).catch(() => null);
      if (pr?.code === 0 && fs.existsSync(poster) && fs.statSync(poster).size > 0) { res.posterFile = poster; break; }
    }
  } catch { /* se queda el original */ }
  return res;
}

// ---- Mejor versión ----
// Tamaño de un archivo remoto: HEAD (Content-Length) o, si no lo da, descarga parcial de 1 byte (Content-Range)
async function sizeOf(url, fetchFn = fetch) {
  try {
    const h = await fetchFn(url, { method: 'HEAD', redirect: 'follow' });
    const n = Number(h.headers?.get?.('content-length'));
    if (h.ok && n > 0) return n;
  } catch { /* se prueba el parcial */ }
  try {
    const r = await fetchFn(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
    const m = /\/(\d+)\s*$/.exec(r.headers?.get?.('content-range') || '');
    if (m) return Number(m[1]);
    const n = Number(r.headers?.get?.('content-length'));
    if (r.ok && r.status === 200 && n > 1) return n;
  } catch { /* sin tamaño */ }
  return 0;
}

// lists: una lista por red, cada una con sus vídeos [{ urls: [candidatas…] }].
// Si todas tienen los mismos vídeos, se elige el mayor de cada posición; si no casan, la lista de mayor tamaño total.
// Devuelve { list, picks: [{ list, item, url, size }] } (list = índice de la lista elegida o -1 si se mezclan).
async function pickBest(lists, sizeFn) {
  const memo = new Map();
  const sz = (u) => { if (!memo.has(u)) memo.set(u, Promise.resolve(sizeFn(u)).catch(() => 0)); return memo.get(u); };
  const best = async (urls) => {
    let top = { url: urls[0], size: -1 };
    for (const u of urls) { const s = await sz(u); if (s > top.size) top = { url: u, size: s }; }
    return { url: top.url, size: Math.max(0, top.size) };
  };
  const per = [];
  for (const l of lists) per.push(await Promise.all(l.map((it) => best((it.urls || []).filter(Boolean)))));
  const n = lists[0]?.length || 0;
  if (lists.length > 1 && lists.every((l) => l.length === n)) {
    const picks = [];
    for (let i = 0; i < n; i++) {
      let w = 0;
      per.forEach((p, li) => { if (p[i].size > per[w][i].size) w = li; });
      picks.push({ list: w, item: i, url: per[w][i].url, size: per[w][i].size });
    }
    return { list: -1, picks };
  }
  let w = 0, wt = -1;
  per.forEach((p, li) => { const tot = p.reduce((a, x) => a + x.size, 0); if (tot > wt) { wt = tot; w = li; } });
  return { list: w, picks: per[w].map((x, i) => ({ list: w, item: i, url: x.url, size: x.size })) };
}

// Devuelve una copia de la publicación con los vídeos de la mejor versión.
// extraUrls(m) puede dar direcciones candidatas adicionales (p. ej. el nodo de vídeo de Facebook).
async function bestVersionPost(post, { sizeFn = sizeOf, extraUrls = async () => [] } = {}) {
  const vids = (p) => (p.media || []).filter((m) => m.type === 'video' && !m.path && m.videoUrl);
  const nets = [post, ...(post.alsoOn || []).filter((a) => a.media)];
  const lists = [];
  for (const n of nets) lists.push(await Promise.all(vids(n).map(async (m) => ({ m, urls: [m.videoUrl, ...(await extraUrls(m).catch(() => []))] }))));
  if (!lists.some((l) => l.length)) return post;
  const r = await pickBest(lists, sizeFn);
  const chosen = r.picks.map((p) => ({ ...lists[p.list][p.item].m, videoUrl: p.url, size: p.size }));
  const own = lists[0].map((x) => x.m);
  let media;
  if (chosen.length === own.length) {
    // mismos vídeos que la publicación principal: cada uno se cambia en su sitio (con su portada y orden)
    let k = 0;
    media = post.media.map((m) => (own.includes(m) ? { ...m, videoUrl: chosen[k].videoUrl, size: chosen[k++].size } : m));
  } else {
    // no casan 1:1: gana la lista de mayor tamaño total y sus vídeos sustituyen a los de la principal
    const first = post.media.findIndex((m) => own.includes(m));
    media = post.media.filter((m) => !own.includes(m));
    media.splice(first < 0 ? media.length : first, 0, ...chosen);
  }
  return { ...post, media };
}

// ---- Nodo de vídeo de Facebook ----
function facebookVideoId(m) {
  if (m.fbVideoId) return String(m.fbVideoId);
  const s = String(m.link || '');
  const a = /\/videos\/(?:[^/?#]+\/)?(\d{6,})/.exec(s) || /[?&]v=(\d{6,})/.exec(s) || /\/reel\/(\d{6,})/.exec(s);
  return a ? a[1] : '';
}
// GET /{video-id}?fields=source,length con el token de página; si falla, no hay candidata extra
async function facebookNodeSource(m, { graph, token, fetchFn = fetch }) {
  const id = facebookVideoId(m);
  if (!id || !token) return [];
  try {
    const r = await fetchFn(`${graph}/${id}?` + new URLSearchParams({ fields: 'source,length', access_token: token }));
    const j = await r.json();
    return j && !j.error && j.source ? [j.source] : [];
  } catch { return []; }
}

module.exports = { ffmpegPath, resetFfmpegCache, parseInfo, probe, processVideo, sizeOf, pickBest, bestVersionPost, facebookVideoId, facebookNodeSource };
