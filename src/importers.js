// Formas alternativas de obtener publicaciones sin la API de Meta:
//  1) ZIP de «Descargar tu información» (Instagram o Facebook, formato JSON)
//  2) Capturas de pantalla analizadas con Claude
//  3) Entrada manual (texto + fotos)
// Todas devuelven el mismo formato de publicación que src/meta.js, con medios locales ({ path }).
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const AdmZip = require('adm-zip');
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|gif)$/i;

// Meta guarda el texto UTF-8 mal codificado («Ã©» en vez de «é»); esto lo repara
function fixText(s) {
  if (!s) return '';
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    return fixed.includes('�') ? s : fixed;
  } catch { return s; }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function mediaItem(root, uri) {
  if (!uri) return null;
  const p = path.join(root, uri);
  if (!fs.existsSync(p)) return null;
  if (VIDEO_EXT.test(p)) return { type: 'video', path: p };
  if (IMAGE_EXT.test(p)) return { type: 'image', path: p };
  return null;
}

// --- 1) ZIP o carpeta exportada de Meta ---------------------------------------
function importMetaExport(zipOrFolder) {
  let root = zipOrFolder;
  if (zipOrFolder.toLowerCase().endsWith('.zip')) {
    root = path.join(app.getPath('userData'), 'imports', path.basename(zipOrFolder, '.zip'));
    if (!fs.existsSync(root)) new AdmZip(zipOrFolder).extractAllTo(root, true);
  }
  const files = walk(root).filter((f) => f.endsWith('.json'));
  const posts = [];

  // Instagram: posts_1.json, reels.json… (cualquier objeto con media[].uri)
  for (const f of files.filter((f) => /[\\/](posts_\d+|reels|igtv_videos)\.json$/i.test(f))) {
    let json = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(json)) json = Object.values(json).find(Array.isArray) || [];
    for (const entry of json) {
      if (!entry.media?.length) continue;
      const ts = entry.creation_timestamp || entry.media[0].creation_timestamp;
      posts.push({
        source: 'instagram', id: `ig-${ts}-${posts.length}`,
        text: fixText(entry.title || entry.media[0].title || ''),
        date: new Date(ts * 1000).toISOString(), permalink: null,
        media: entry.media.map((m) => mediaItem(root, m.uri)).filter(Boolean),
      });
    }
  }

  // Facebook: your_posts__check_ins__photos_and_videos_1.json / your_posts_1.json
  for (const f of files.filter((f) => /[\\/]your_posts[^\\/]*\.json$/i.test(f))) {
    let json = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(json)) json = Object.values(json).find(Array.isArray) || [];
    for (const entry of json) {
      const text = fixText((entry.data || []).map((d) => d.post).filter(Boolean).join('\n\n'));
      const media = (entry.attachments || []).flatMap((a) => a.data || [])
        .map((d) => d.media && mediaItem(root, d.media.uri)).filter(Boolean);
      if (!text && !media.length) continue;
      posts.push({
        source: 'facebook', id: `fb-${entry.timestamp}-${posts.length}`, text,
        date: new Date(entry.timestamp * 1000).toISOString(), permalink: null, media,
      });
    }
  }

  if (!posts.length) {
    throw new Error('No se encontraron publicaciones. Asegúrate de haber pedido la descarga en formato JSON e incluir «Contenido» / «Publicaciones».');
  }
  return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// --- 2) Capturas de pantalla con Claude ----------------------------------------
const Box = z.object({
  x: z.number().describe('Borde izquierdo, fracción 0-1 del ancho de la captura'),
  y: z.number().describe('Borde superior, fracción 0-1 del alto'),
  width: z.number().describe('Ancho, fracción 0-1'),
  height: z.number().describe('Alto, fracción 0-1'),
});
const ScreenshotResult = z.object({
  network: z.enum(['instagram', 'facebook', 'desconocida']),
  text: z.string().describe('Texto completo de la publicación (pie de foto), sin el nombre de usuario, likes ni comentarios'),
  date: z.string().nullable().describe('Fecha de la publicación en formato AAAA-MM-DD si aparece; null si no'),
  truncated: z.boolean().describe('true si el texto está cortado (por ejemplo termina en «… más»)'),
  photos: z.array(z.object({
    screenshot_index: z.number().int().describe('Índice (desde 0) de la captura donde está la foto'),
    box: Box,
  })).describe('Zona exacta de cada foto o vídeo de la publicación, sin la interfaz de la app'),
});

const PROMPT = `Estas capturas de pantalla muestran UNA publicación de Instagram o Facebook (puede haber varias capturas, por ejemplo una por cada foto de un carrusel).
Extrae:
- El texto de la publicación tal cual, respetando saltos de línea, emojis, hashtags y @menciones. No incluyas el nombre de la cuenta, «Me gusta», comentarios ni botones.
- La fecha si se ve.
- La posición de cada foto de la publicación (solo la imagen, sin barras, iconos ni texto de la app). Si la misma foto aparece en varias capturas, inclúyela una sola vez.`;

async function importScreenshots(paths, apiKey) {
  if (!apiKey) throw new Error('Falta la clave de la API de Anthropic (Configuración → IA)');
  const client = new Anthropic({ apiKey });
  const images = paths.map((p) => {
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) throw new Error(`No se pudo abrir la imagen ${path.basename(p)}`);
    return img;
  });

  const content = [];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `Captura ${i}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: img.toPNG().toString('base64') } });
  });
  content.push({ type: 'text', text: PROMPT });

  let response;
  try {
    response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(ScreenshotResult) },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('La clave de la API de Anthropic no es válida');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Demasiadas peticiones a la IA; espera un momento');
    if (err instanceof Anthropic.APIError) throw new Error(`IA: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new Error('La IA no ha podido procesar estas capturas');
  const r = response.parsed_output;
  if (!r) throw new Error('La IA no devolvió un resultado válido');

  // Recorta cada foto de la captura y la guarda como PNG temporal
  const outDir = path.join(app.getPath('userData'), 'imports', 'capturas-' + Date.now());
  fs.mkdirSync(outDir, { recursive: true });
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const media = r.photos.map((ph, i) => {
    const img = images[ph.screenshot_index] || images[0];
    const { width: W, height: H } = img.getSize();
    const x = Math.round(clamp(ph.box.x) * W), y = Math.round(clamp(ph.box.y) * H);
    const rect = { x, y, width: Math.max(1, Math.min(W - x, Math.round(clamp(ph.box.width) * W))), height: Math.max(1, Math.min(H - y, Math.round(clamp(ph.box.height) * H))) };
    const file = path.join(outDir, `foto-${i + 1}.png`);
    fs.writeFileSync(file, img.crop(rect).toPNG());
    return { type: 'image', path: file };
  });

  return {
    source: r.network === 'facebook' ? 'facebook' : 'instagram',
    id: 'cap-' + Date.now(), text: r.text,
    date: r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
    permalink: null, media, warning: r.truncated ? 'El texto parece cortado («… más»). Despliégalo antes de hacer la captura o complétalo a mano.' : null,
  };
}

// --- 3) Manual -----------------------------------------------------------------
function manualPost({ text, date, source, permalink, files }) {
  return {
    source: source || 'instagram', id: 'man-' + Date.now(), text: text || '',
    date: date ? new Date(date).toISOString() : new Date().toISOString(), permalink: permalink || null,
    media: (files || []).map((p) => (VIDEO_EXT.test(p) ? { type: 'video', path: p } : { type: 'image', path: p })),
  };
}

module.exports = { importMetaExport, importScreenshots, manualPost, fixText };
