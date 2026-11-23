// Fotos más ligeras antes de subirlas: se reducen a 2560 px por el lado largo (lo que de sobra necesita una
// web) y las JPEG se vuelven a comprimir con calidad 85. Solo se usa el resultado si pesa menos.
// Las PNG (pueden tener transparencia) se reducen pero siguen siendo PNG; los GIF y vídeos no se tocan.
const MAX = 2560;
let isEnabled = () => true;
const setEnabled = (fn) => { isEnabled = fn; };
let webpOn = () => true;
const setWebp = (fn) => { webpOn = fn; };
const WEBP_Q = 82, WEBP_MIN = 40 * 1024;

// ---- Conversión a WebP -----------------------------------------------------------------------------------
// ¿Tiene la PNG canal de transparencia? 0 no, 1 sí (soporta alfa o paleta con tRNS)
function pngAlphaCapable(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || buf.toString('latin1', 1, 4) !== 'PNG') return false;
  const ct = buf[25];
  if (ct === 4 || ct === 6) return true;
  if (ct !== 3) return false;
  for (let p = 8; p + 8 <= buf.length;) { const len = buf.readUInt32BE(p), id = buf.toString('latin1', p + 4, p + 8); if (id === 'tRNS') return true; if (id === 'IDAT') return false; p += 12 + len; }
  return false;
}
// ¿Se ve realmente la transparencia? (con Electron se mira si algún punto no es opaco; sin él se supone que sí)
function pngAlphaRelevant(buf) {
  if (!pngAlphaCapable(buf)) return false;
  try {
    const img = require('electron').nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return true;
    const bmp = img.toBitmap();
    for (let i = 3; i < bmp.length; i += 4) if (bmp[i] < 250) return true;
    return false;
  } catch { return true; }
}
// Decisión pura: 'webp' (intentar convertir) o 'legacy' (solo la reducción de siempre). kind: 'jpeg'|'png'|'webp'|null
function decide({ kind, size, alpha = false, enabled = true, webp = true }) {
  if (!webp || !enabled) return 'legacy';
  if (kind !== 'jpeg' && kind !== 'png') return 'legacy';
  if (size < WEBP_MIN) return 'legacy';
  if (kind === 'png' && alpha) return 'legacy';
  return 'webp';
}
const kindOf = (type = '', name = '') => (/png/i.test(type) || /\.png$/i.test(name) ? 'png' : /jpe?g/i.test(type) || /\.jpe?g$/i.test(name) ? 'jpeg' : /webp/i.test(type) || /\.webp$/i.test(name) ? 'webp' : null);

function runFfmpeg(bin, args) {
  return new Promise((resolve) => {
    const p = require('child_process').spawn(bin, args, { windowsHide: true, stdio: 'ignore' });
    const to = setTimeout(() => { p.kill(); resolve(false); }, 60000);
    p.on('error', () => { clearTimeout(to); resolve(false); });
    p.on('close', (c) => { clearTimeout(to); resolve(c === 0); });
  });
}
// Convierte con ffmpeg (calidad 82, lado mayor ≤ 2560). → Buffer WebP o null si no se puede
async function toWebp(buf, ext) {
  const bin = require('./videoq').ffmpegPath();
  if (!bin) return null;
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-webp-'));
  try {
    const inp = path.join(dir, 'in.' + ext), out = path.join(dir, 'out.webp');
    fs.writeFileSync(inp, buf);
    const vf = `scale=w='min(${MAX},iw)':h='min(${MAX},ih)':force_original_aspect_ratio=decrease:flags=lanczos`;
    const ok = await runFfmpeg(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inp, '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-quality', String(WEBP_Q), '-compression_level', '6', out]);
    return ok && fs.existsSync(out) ? fs.readFileSync(out) : null;
  } catch { return null; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporal */ } }
}

// Prepara una foto para subirla: WebP si compensa (y conserva la fecha de captura en su EXIF); si no, la reducción de siempre.
// → { buf, type, name, fallback() }: fallback() da la versión sin WebP (para reintentar si WordPress rechaza el .webp)
async function prepare(buf, type = '', name = '') {
  const legacy = () => optimize(buf, type, name);
  try {
    const kind = kindOf(type, name);
    if (decide({ kind, size: Buffer.isBuffer(buf) ? buf.length : 0, alpha: kind === 'png' && pngAlphaRelevant(buf), enabled: true, webp: webpOn() }) === 'webp') {
      const w = await toWebp(buf, kind === 'png' ? 'png' : 'jpg');
      if (w && w.length < buf.length) {
        const PD = require('./photodate');
        const date = kind === 'jpeg' ? PD.exifDate(buf) : null;
        const out = date ? PD.webpWithDate(w, date) : w;
        return { buf: out, type: 'image/webp', name: name.replace(/\.[^.]+$/, '') + '.webp', saved: buf.length - out.length, webp: true, fallback: legacy };
      }
    }
  } catch { /* se sube como siempre */ }
  return { ...legacy(), fallback: legacy };
}


function optimize(buf, type = '', name = '') {
  try {
    if (!isEnabled() || !Buffer.isBuffer(buf) || buf.length < 150 * 1024) return { buf, type, name };
    const kind = /png/i.test(type) || /\.png$/i.test(name) ? 'png' : /jpe?g/i.test(type) || /\.jpe?g$/i.test(name) ? 'jpeg' : /webp/i.test(type) || /\.webp$/i.test(name) ? 'webp' : null;
    if (!kind) return { buf, type, name };
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return { buf, type, name };
    const { width, height } = img.getSize();
    const scale = Math.min(1, MAX / Math.max(width, height));
    if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' });
    let out, outType = type, outName = name;
    if (kind === 'png') { if (scale === 1) return { buf, type, name }; out = img.toPNG(); }
    else { out = img.toJPEG(85); outType = 'image/jpeg'; outName = name.replace(/\.(webp|jpe?g)$/i, '') + '.jpg'; }
    if (out.length >= buf.length && scale === 1) return { buf, type, name }; // no se gana nada
    return { buf: out, type: outType, name: outName, saved: buf.length - out.length };
  } catch {
    return { buf, type, name };
  }
}

module.exports = { optimize, prepare, decide, kindOf, pngAlphaCapable, setEnabled, setWebp, MAX };
