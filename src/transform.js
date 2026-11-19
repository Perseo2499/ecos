// Convierte una o varias publicaciones en una entrada con bloques de Gutenberg.
// Opciones (Configuración → Formato de las entradas):
//   cleanTitle: quitar emojis y signos sueltos del título        (por defecto sí)
//   footer:     texto del pie; {redes} se sustituye por los enlaces ("" = sin pie)
//   extraTags:  etiquetas que se añaden siempre

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HASHTAG = /#([\p{L}\p{N}_]+)/gu;
const DEFAULT_FOOTER = 'Publicado originalmente en {redes}.';
const NET = { instagram: 'Instagram', facebook: 'Facebook' };

function extractTags(text) {
  return [...new Set([...text.matchAll(HASHTAG)].map((m) => m[1]))];
}

function cleanText(text, source) {
  // Quita el bloque de hashtags final y enlaza las @menciones y URLs
  let t = text.replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim();
  t = esc(t);
  const base = source === 'instagram' ? 'https://www.instagram.com/' : 'https://www.facebook.com/';
  t = t.replace(/(^|\s)@([\w.]+)/g, (_m, sp, u) => `${sp}<a href="${base}${u}">@${u}</a>`);
  t = t.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  return t;
}

// Quita emojis, símbolos y signos repetidos al principio y al final («‼️ Comunicado ‼️» → «Comunicado»)
const JUNK = String.raw`\s\p{Extended_Pictographic}\p{Emoji_Modifier}️‍‼⁉*•·\-–—~_|:;,"'«»`;
// Al principio también sobran «!», «?» y «.» sueltos (no «¡» ni «¿», que abren frase); al final se conservan «!» y «?»
const EDGE = new RegExp(`^[${JUNK}!?.()\\[\\]]+|[${JUNK}(\\[]+$`, 'gu');
function tidyTitle(s) {
  let t = s.replace(HASHTAG, '').replace(/\s+/g, ' ').trim();
  t = t.replace(EDGE, '').trim();
  t = t.replace(/^([¡¿])\1+/u, '$1'); // «¡¡¡Hola» → «¡Hola»
  // Un «!» o «?» final con sentido se conserva, pero no repetidos
  t = t.replace(/([!?])\1+$/u, '$1'); // «!!!» → «!»
  // Todo en mayúsculas → solo la primera
  if (t.length > 12 && t === t.toUpperCase() && /\p{L}/u.test(t)) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t;
}

function makeTitle(text, date, clean = true) {
  const lines = text.split('\n').map((l) => (clean ? tidyTitle(l) : l.replace(HASHTAG, '').trim()));
  const first = (lines.find((l) => l.length >= 8) || '').split(/(?<=[.!?])\s/)[0].trim();
  if (first.length >= 8) return first.length > 90 ? first.slice(0, 87).replace(/\s+\S*$/, '') + '…' : first;
  return 'Publicación del ' + new Date(date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Clave única de un medio: URL remota (API) o ruta local (importaciones)
const mediaKey = (m) => m.url || m.path;

const para = (html) => `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;

function imageBlock(img) {
  return `<!-- wp:image {"id":${img.id},"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="${img.url}" class="wp-image-${img.id}"/></figure>\n<!-- /wp:image -->`;
}

function galleryBlock(imgs) {
  return `<!-- wp:gallery {"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images columns-default is-cropped">\n${imgs.map(imageBlock).join('\n')}\n</figure>\n<!-- /wp:gallery -->`;
}

function videoBlock(v) {
  return `<!-- wp:video {"id":${v.id}} -->\n<figure class="wp-block-video"><video controls src="${v.url}"></video></figure>\n<!-- /wp:video -->`;
}

function embedBlock(url, provider) {
  return `<!-- wp:embed {"url":"${url}","type":"rich","providerNameSlug":"${provider}"} -->\n<figure class="wp-block-embed is-type-rich is-provider-${provider}"><div class="wp-block-embed__wrapper">\n${url}\n</div></figure>\n<!-- /wp:embed -->`;
}

// Redes donde estaba la publicación (la propia + las duplicadas que se juntaron con ella)
const networksOf = (post) => [{ source: post.source, permalink: post.permalink }, ...(post.alsoOn || [])];

function footerHtml(post, template) {
  if (template === '') return null;
  const links = networksOf(post).map((n) => (n.permalink ? `<a href="${esc(n.permalink)}">${NET[n.source]}</a>` : NET[n.source]));
  const redes = links.length > 1 ? links.slice(0, -1).join(', ') + ' y ' + links[links.length - 1] : links[0];
  return para(`<em>${esc(template || DEFAULT_FOOTER).replace('{redes}', redes)}</em>`);
}

// uploaded: Map(clave del medio -> {id, url}) con los medios ya subidos a WordPress
function postToBlocks(post, uploaded, opts) {
  const blocks = [];
  const imgs = post.media.filter((m) => m.type === 'image').map((m) => uploaded.get(mediaKey(m))).filter(Boolean);
  const videos = post.media.filter((m) => m.type === 'video' && m.path).map((m) => uploaded.get(mediaKey(m))).filter(Boolean);
  const hasRemoteVideo = post.media.some((m) => m.type === 'video' && !m.path);

  const paragraphs = cleanText(post.text, post.source).split(/\n\s*\n/).filter(Boolean);
  for (const p of paragraphs) blocks.push(para(p.replace(/\n/g, '<br>')));

  if (imgs.length === 1) blocks.push(imageBlock(imgs[0]));
  else if (imgs.length > 1) blocks.push(galleryBlock(imgs));
  for (const v of videos) blocks.push(videoBlock(v));
  if (hasRemoteVideo && post.permalink) blocks.push(embedBlock(post.permalink, post.source));

  const foot = footerHtml(post, opts.footer);
  if (foot) blocks.push(foot);
  return blocks.join('\n\n');
}

function buildDraft(posts, uploaded, opts = {}) {
  const sorted = [...posts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const extra = (opts.extraTags || '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  const tags = [...new Set([...sorted.flatMap((p) => extractTags(p.text)), ...extra])];
  const title = sorted.length === 1
    ? makeTitle(sorted[0].text, sorted[0].date, opts.cleanTitle !== false)
    : 'Resumen de nuestras últimas publicaciones';
  const content = sorted.map((p) => postToBlocks(p, uploaded, opts)).join('\n\n<!-- wp:separator -->\n<hr class="wp-block-separator"/>\n<!-- /wp:separator -->\n\n');
  // La primera imagen se usa como imagen destacada
  const firstImg = sorted.flatMap((p) => p.media).filter((m) => m.type === 'image').map((m) => uploaded.get(mediaKey(m))).find(Boolean);
  return { title, content, tags, featuredImageId: firstImg?.id, date: sorted[sorted.length - 1].date };
}

// --- Duplicados: la misma publicación en Instagram y Facebook --------------------
const norm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 160);

// Junta publicaciones de redes distintas con el mismo texto y publicadas con menos de 3 días de diferencia.
// Se queda con la que tiene más fotos (o la de Instagram) y anota la otra en alsoOn.
function mergeDuplicates(posts) {
  const out = [];
  for (const p of posts) {
    const key = norm(p.text);
    const twin = key.length >= 20 && out.find((q) => q.source !== p.source && !(q.alsoOn || []).some((a) => a.source === p.source)
      && norm(q.text) === key && Math.abs(new Date(q.date) - new Date(p.date)) < 3 * 864e5);
    if (!twin) { out.push({ ...p }); continue; }
    const pBetter = p.media.length > twin.media.length || (p.media.length === twin.media.length && p.source === 'instagram');
    const [main, other] = pBetter ? [p, twin] : [twin, p];
    const merged = { ...main, alsoOn: [...(main.alsoOn || []), { source: other.source, permalink: other.permalink, id: other.id }] };
    out[out.indexOf(twin)] = merged;
  }
  return out;
}

// Claves de todas las versiones de una publicación (para marcarla como exportada)
const postKeys = (p) => [p.source + ':' + p.id, ...(p.alsoOn || []).map((a) => a.source + ':' + a.id)];

module.exports = { buildDraft, extractTags, mediaKey, makeTitle, tidyTitle, mergeDuplicates, postKeys, DEFAULT_FOOTER };
