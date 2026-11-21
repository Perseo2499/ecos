// Mejorar fotos con IA en este ordenador (Real-ESRGAN ncnn Vulkan). Gratis y sin subir nada a ningún servicio.
// Solo Windows. El programa (unos 45 MB) se descarga la primera vez y se guarda en la carpeta de datos de Ecos.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const yauzl = require('yauzl');
const { replaceLinkInHtml } = require('../renderer/linkutil');

const ENGINE_URL = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip';
const EXE = 'realesrgan-ncnn-vulkan.exe';
// Archivos que se sacan del zip (en la raíz o en models/)
const WANTED = [EXE, 'vcomp140.dll', 'models/realesrgan-x4plus.bin', 'models/realesrgan-x4plus.param'];
const TIMEOUT = 10 * 60 * 1000;

const isWindows = () => process.platform === 'win32';
const needWindows = () => { if (!isWindows()) throw new Error('Mejorar fotos con IA solo funciona en Windows. En este sistema no está disponible.'); };

// --- Lógica pura (se prueba sin Windows) ---------------------------------------------
// Tamaño final tras ampliar: lado largo como mucho max(2 × original, 1600) y nunca más de 2560 px.
// La IA amplía ×4; si eso se pasa del límite, se reduce manteniendo la proporción.
function targetSize(w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const long = Math.max(w, h);
  const cap = Math.min(Math.max(2 * long, 1600), 2560);
  const scale = Math.min(4, cap / long);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
// ¿Es un PNG con canal de transparencia (RGBA, gris+alfa o tRNS)?
function pngHasAlpha(buf) {
  if (!buf || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return false;
  const ct = buf[25];
  if (ct === 4 || ct === 6) return true;
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    pos += 12 + len;
  }
  return false;
}
// Cambia una foto por otra dentro del contenido de una entrada: direcciones (en href/src, srcset y comentarios
// de bloque), clase wp-image-{id} e "id":{id} de los comentarios de bloque.
function swapMediaInHtml(html, { oldUrls = [], newUrl, oldId, newId }) {
  let out = String(html ?? '');
  const urls = [...new Set(oldUrls.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const u of urls) out = replaceLinkInHtml(out, u, newUrl);
  // srcset que aún nombra direcciones antiguas: se quita (el navegador usa entonces el src nuevo)
  out = out.replace(/\s+srcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (all, a, b) => {
    const v = (a ?? b ?? '').replace(/&#0?38;|&#x26;|&amp;/gi, '&');
    return urls.some((u) => v.includes(u)) ? '' : all;
  });
  const idRe = (key) => new RegExp(`("${key}"\\s*:\\s*)${oldId}(?!\\d)`, 'g');
  out = out.replace(/<!--\s*wp:[\s\S]*?-->/g, (c) => {
    for (const u of urls) c = c.split(u).join(newUrl).split(u.replace(/\//g, '\\/')).join(newUrl.replace(/\//g, '\\/'));
    return c.replace(idRe('id'), `$1${newId}`).replace(idRe('mediaId'), `$1${newId}`);
  });
  return out.replace(new RegExp(`wp-image-${oldId}(?!\\d)`, 'g'), `wp-image-${newId}`);
}

// --- Motor: descarga e instalación -----------------------------------------------------
const engineDir = () => path.join(require('electron').app.getPath('userData'), 'ai-upscale');
const engineReady = (dir) => WANTED.every((f) => fs.existsSync(path.join(dir, f)));
const hasEngine = () => { try { return isWindows() && engineReady(engineDir()); } catch { return false; } };

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar el motor de IA (error ${res.status}).`);
  const total = Number(res.headers.get('content-length') || 0);
  let got = 0, last = -1;
  const out = fs.createWriteStream(dest);
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const pct = total ? Math.min(100, Math.floor(got * 100 / total)) : 0;
      if (pct !== last) { last = pct; onProgress?.({ text: 'Descargando el motor de IA…', pct: total ? pct : undefined }); }
    }
    await new Promise((ok, rej) => { out.end((e) => (e ? rej(e) : ok())); });
  } catch (e) { out.destroy(); throw e; }
}
function extract(zipFile, dir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const done = new Set();
      zip.on('error', reject);
      zip.on('end', () => (WANTED.every((k) => done.has(k)) ? resolve() : reject(new Error('El motor de IA descargado está incompleto.'))));
      zip.on('entry', (e) => {
        const name = e.fileName.replace(/\\/g, '/');
        const key = WANTED.find((k) => name === k || name.endsWith('/' + k));
        if (!key || name.endsWith('/')) return zip.readEntry();
        zip.openReadStream(e, (er, st) => {
          if (er) return reject(er);
          const target = path.join(dir, key);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const ws = fs.createWriteStream(target + '.part');
          st.on('error', reject); ws.on('error', reject);
          ws.on('finish', () => { fs.renameSync(target + '.part', target); done.add(key); zip.readEntry(); });
          st.pipe(ws);
        });
      });
      zip.readEntry();
    });
  });
}
let ensuring = null;
// → ruta del .exe (lo descarga la primera vez)
function ensureEngine(onProgress) {
  needWindows();
  if (ensuring) return ensuring;
  ensuring = (async () => {
    const dir = engineDir();
    const exe = path.join(dir, EXE);
    if (engineReady(dir)) return exe;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, 'descarga.zip.part');
    try {
      onProgress?.({ text: 'Descargando el motor de IA…', pct: 0 });
      await download(ENGINE_URL, tmp, onProgress);
      await extract(tmp, dir);
    } catch (e) {
      for (const f of WANTED) { try { fs.rmSync(path.join(dir, f + '.part'), { force: true }); } catch { /* nada */ } }
      throw new Error('No se pudo instalar el motor de IA: ' + e.message);
    } finally { try { fs.rmSync(tmp, { force: true }); } catch { /* nada */ } }
    return exe;
  })().finally(() => { ensuring = null; });
  return ensuring;
}

// --- Ampliar ------------------------------------------------------------------------
const run = (exe, args, cwd) => new Promise((resolve, reject) => {
  execFile(exe, args, { cwd, windowsHide: true, timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024 }, (err, _o, stderr) => {
    if (err) return reject(Object.assign(err, { stderr: String(stderr || '') }));
    resolve();
  });
});
// buf: foto original (JPEG, PNG, WebP…). → { buf, type, name, width, height }
async function upscale(buf, { onProgress } = {}) {
  needWindows();
  const { nativeImage } = require('electron');
  const exe = await ensureEngine(onProgress);
  const src = nativeImage.createFromBuffer(buf);
  const { width: w0, height: h0 } = src.getSize();
  if (!w0 || !h0) throw new Error('No se puede leer la foto.');
  const keepPng = pngHasAlpha(buf);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-ia-'));
  try {
    const inp = path.join(tmp, 'in.png'), outp = path.join(tmp, 'out.png');
    fs.writeFileSync(inp, src.toPNG());
    const args = ['-i', inp, '-o', outp, '-n', 'realesrgan-x4plus', '-s', '4', '-f', 'png'];
    const cwd = path.dirname(exe);
    onProgress?.({ text: 'Mejorando la foto…' });
    try {
      await run(exe, args, cwd);
      if (!fs.existsSync(outp)) throw new Error('sin resultado');
    } catch (e) {
      if (e.killed) throw new Error('La mejora ha tardado demasiado y se ha cancelado.');
      const why = String(e.stderr || '') + ' ' + String(e.message || '');
      // El motor necesita una tarjeta gráfica con Vulkan (casi todas las de Intel, AMD y NVIDIA de los últimos años)
      if (/vkCreateInstance|invalid gpu|vulkan/i.test(why)) throw new Error('Este ordenador no tiene una tarjeta gráfica compatible con la IA (Vulkan). Actualiza los controladores de la tarjeta gráfica (Intel, AMD o NVIDIA, desde su web o Windows Update) y vuelve a intentarlo.');
      throw new Error('No se pudo mejorar la foto con la IA: ' + (why.trim().split('\n').pop() || 'error desconocido'));
      if (!fs.existsSync(outp)) throw new Error('La IA no ha generado ninguna imagen.');
    }
    let img = nativeImage.createFromPath(outp);
    const big = img.getSize();
    if (!big.width || !big.height) throw new Error('La IA no ha generado ninguna imagen.');
    const t = targetSize(w0, h0);
    if (t.width !== big.width || t.height !== big.height) img = img.resize({ width: t.width, height: t.height, quality: 'best' });
    const size = img.getSize();
    return keepPng
      ? { buf: img.toPNG(), type: 'image/png', name: 'mejorada.png', width: size.width, height: size.height }
      : { buf: img.toJPEG(92), type: 'image/jpeg', name: 'mejorada.jpg', width: size.width, height: size.height };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* nada */ } }
}

module.exports = { ensureEngine, hasEngine, upscale, targetSize, swapMediaInHtml, pngHasAlpha, isWindows, ENGINE_URL };
