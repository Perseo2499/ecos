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
// En los vídeos la clave es el propio vídeo (la url es solo su miniatura)
const mediaKey = (m) => (m.type === 'video' ? m.videoUrl || m.path || m.url : m.url || m.path);

const para = (html) => `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;

function videoBlock(v) {
  return `<!-- wp:video {"id":${v.id}} -->\n<figure class="wp-block-video"><video controls preload="metadata" src="${v.url}"></video></figure>\n<!-- /wp:video -->`;
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

// --- Secciones editables --------------------------------------------------------
// Un borrador es { title, tags, date, featuredImageId, sections: [...] }. Cada sección (una por publicación):
//   { html, images: [{id,url,alt}], videos: [{id,url}], embed: {url,provider}|null, footer: html|null }
// El editor de Ecos modifica las secciones y composeContent() genera los bloques de WordPress al enviar.

function postToSection(post, uploaded, opts) {
  const paragraphs = cleanText(post.text, post.source).split(/\n\s*\n/).filter(Boolean);
  // Vídeos subidos al blog; si alguno no se pudo subir, se inserta la publicación original
  const vids = post.media.filter((m) => m.type === 'video');
  const hasRemoteVideo = vids.some((m) => !uploaded.get(mediaKey(m)));
  const foot = footerHtml(post, opts.footer);
  return {
    html: paragraphs.map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join(''),
    images: post.media.filter((m) => m.type === 'image').map((m) => uploaded.get(mediaKey(m))).filter(Boolean).map((i) => ({ ...i, alt: '' })),
    videos: vids.map((m) => uploaded.get(mediaKey(m)) && { ...uploaded.get(mediaKey(m)), poster: m.url && !m.path ? m.url : undefined }).filter(Boolean),
    embed: hasRemoteVideo && post.permalink ? { url: post.permalink, provider: post.source } : null,
    footer: foot ? foot.replace(/<!-- \/?wp:paragraph -->\n?/g, '').trim().replace(/^<p>|<\/p>$/g, '') : null,
  };
}

// Limpia el HTML del editor: solo deja negrita, cursiva, enlaces y saltos de línea; devuelve párrafos
function sanitizeParagraphs(html) {
  let h = String(html || '')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(\/?)(b|strong)\b[^>]*>/gi, '<$1strong>')
    .replace(/<(\/?)(i|em)\b[^>]*>/gi, '<$1em>');
  // Enlaces: solo href http(s) o mailto
  h = h.replace(/<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>/gi, (_m, href) => (/^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href.replace(/&amp;/g, '&'))}">` : '<a>'));
  h = h.replace(/<(?!\/?(strong|em|a)\b)[^>]*>/gi, ''); // el resto de etiquetas fuera
  h = h.replace(/<a>([\s\S]*?)<\/a>/gi, '$1');
  return h.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.replace(/<[^>]+>|&nbsp;|\s/g, '')).map((p) => p.replace(/\n/g, '<br>'));
}

function imageBlockAlt(img) {
  const alt = img.alt ? ` alt="${esc(img.alt)}"` : '';
  return `<!-- wp:image {"id":${img.id},"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="${img.url}"${alt} class="wp-image-${img.id}"/></figure>\n<!-- /wp:image -->`;
}

function composeContent(sections) {
  return sections.map((sec) => {
    const blocks = sanitizeParagraphs(sec.html).map(para);
    const imgs = sec.images || [];
    if (imgs.length === 1) blocks.push(imageBlockAlt(imgs[0]));
    else if (imgs.length > 1) blocks.push(`<!-- wp:gallery {"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images columns-default is-cropped">\n${imgs.map(imageBlockAlt).join('\n')}\n</figure>\n<!-- /wp:gallery -->`);
    for (const v of sec.videos || []) blocks.push(videoBlock(v));
    if (sec.embed) blocks.push(embedBlock(sec.embed.url, sec.embed.provider));
    if (sec.footer) blocks.push(para(sec.footer));
    return blocks.join('\n\n');
  }).join('\n\n<!-- wp:separator -->\n<hr class="wp-block-separator"/>\n<!-- /wp:separator -->\n\n');
}

function buildDraft(posts, uploaded, opts = {}) {
  const sorted = [...posts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const extra = (opts.extraTags || '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  const tags = [...new Set([...sorted.flatMap((p) => extractTags(p.text)), ...extra])];
  const title = sorted.length === 1
    ? makeTitle(sorted[0].text, sorted[0].date, opts.cleanTitle !== false)
    : summaryTitle(sorted[0].date, sorted[sorted.length - 1].date);
  const sections = sorted.map((p) => postToSection(p, uploaded, opts));
  // Si el primer párrafo es el propio título, no se repite en el texto
  if (sorted.length === 1) {
    const plain = (h) => tidyTitle(h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')).toLowerCase();
    const m = sections[0].html.match(/^<p>([\s\S]*?)<\/p>/);
    if (m) {
      const lines = m[1].split('<br>');
      if (plain(lines[0]) === title.toLowerCase()) { // solo si la línea entera es el título
        const rest = lines.slice(1).join('<br>').trim();
        sections[0].html = (rest ? `<p>${rest}</p>` : '') + sections[0].html.slice(m[0].length);
      }
    }
  }
  const firstImg = sections.flatMap((s) => s.images)[0];
  return { title, tags, sections, featuredImageId: firstImg?.id, date: sorted[sorted.length - 1].date, sourceText: sorted.map((p) => p.text).join('\n\n---\n\n') };
}

// «Resumen de noviembre de 2026» / «Resumen del 3 al 16 de noviembre» / «Resumen de octubre y noviembre de 2026»
function summaryTitle(from, to) {
  const a = new Date(from), b = new Date(to);
  const mes = (d) => d.toLocaleDateString('es-ES', { month: 'long' });
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    const first = a.getDate() <= 3, last = b.getDate() >= 27;
    return first && last ? `Resumen de ${mes(a)} de ${a.getFullYear()}` : `Resumen del ${a.getDate()} al ${b.getDate()} de ${mes(a)}`;
  }
  return `Resumen de ${mes(a)}${a.getFullYear() !== b.getFullYear() ? ' de ' + a.getFullYear() : ''} a ${mes(b)} de ${b.getFullYear()}`;
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

module.exports = { buildDraft, composeContent, sanitizeParagraphs, summaryTitle, extractTags, mediaKey, makeTitle, tidyTitle, mergeDuplicates, postKeys, DEFAULT_FOOTER };
