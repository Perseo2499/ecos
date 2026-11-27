// Convierte una o varias publicaciones en una entrada con bloques de Gutenberg.
// Opciones (Configuración → Formato de las entradas):
//   cleanTitle: quitar emojis y signos sueltos del título        (por defecto sí)
//   footer:     texto del pie; {redes} se sustituye por los enlaces ("" = sin pie)
//   extraTags:  etiquetas que se añaden siempre

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HASHTAG = /#([\p{L}\p{N}_]+)/gu;
const DEFAULT_FOOTER = 'Publicado originalmente en {redes}.';
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i;
const NET = { instagram: 'Instagram', facebook: 'Facebook' };
const DK = require('../renderer/sections');
const TS = require('./themestyles');
const U = require('../renderer/unify');

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

const VID_FRAMES = ['rounded', 'border', 'shadow'];
// Vídeo suelto. Estilo opcional (place): colocación y ancho, recorte por proporción, marco y efecto, todo con clases ecos-v-*
// (su CSS va en el bloque ecos-fx); el contenedor lleva el redondeo y recorta, así el zoom no saca picos
function videoBlock(v, cap = '', place = {}, fx = null) {
  const c = cap && sanitizeParagraphs(cap).join('<br>');
  const cn = [];
  const align = ['left', 'center', 'right'].includes(place.align) ? place.align : '';
  if (align) { cn.push('ecos-v-a-' + align); cn.push('ecos-v-w-' + (IMG_W[place.width] ? place.width : 50)); }
  if (IMG_RATIOS.includes(place.ratio)) cn.push('ecos-v-r-' + place.ratio.replace('/', '-'));
  if (VID_FRAMES.includes(place.frame)) cn.push('ecos-v-' + place.frame);
  if (place.fx === 'zoom') cn.push('ecos-v-zoom'); else if (place.fx === 'bw') cn.push('ecos-v-bw');
  cn.forEach((k) => fx?.add(k.replace('ecos-', '')));
  cn.push('ecos-vp'); fx?.add('vplay');
  const attrs = { autoplay: true, controls: false, loop: true, muted: true, playsInline: true };
  if (v.id) attrs.id = Number(v.id) || v.id;
  attrs.className = cn.join(' ');
  const json = ' ' + JSON.stringify(attrs);
  return `<!-- wp:video${json} -->\n<figure class="${['wp-block-video', ...cn].join(' ')}"><video autoplay loop muted src="${esc(v.url)}" playsinline></video>${c ? `<figcaption class="wp-element-caption">${c}</figcaption>` : ''}</figure>\n<!-- /wp:video -->`;
}

function embedBlock(url, provider) {
  return `<!-- wp:embed {"url":"${url}","type":"rich","providerNameSlug":"${provider}"} -->\n<figure class="wp-block-embed is-type-rich is-provider-${provider} wp-block-embed-${provider}"><div class="wp-block-embed__wrapper">\n${url}\n</div></figure>\n<!-- /wp:embed -->`;
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
    videos: vids.map((m) => uploaded.get(mediaKey(m)) && { poster: m.url && !m.path ? m.url : undefined, ...uploaded.get(mediaKey(m)) }).filter(Boolean),
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
    .replace(/<(\/?)(i|em)\b[^>]*>/gi, '<$1em>')
    .replace(/<(\/?)(s|strike|del)\b[^>]*>/gi, '<$1s>')
    .replace(/<(\/?)(u|code|sub|sup)\b[^>]*>/gi, '<$1$2>');
  // Enlaces: solo href http(s), mailto, tel o un ancla de la propia entrada
  h = h.replace(/<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>/gi, (_m, href) => (/^(https?:|mailto:|tel:|#[\w-]+$)/i.test(href) ? `<a href="${esc(href.replace(/&amp;/g, '&'))}">` : '<a>'));
  // Color y resaltado del texto (formato «has-inline-color» de WordPress)
  h = h.replace(/<mark\b[^>]*>/gi, (m) => {
    const st = (m.match(/style\s*=\s*"([^"]*)"/i) || [])[1] || '';
    const val = (k) => { const v = (st.match(new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*([^;]+)', 'i')) || [])[1]?.trim(); return v && SAFE_COLOR.test(v) ? v : ''; };
    // colores de la web: clases has-<slug>-color / has-<slug>-background-color (la clase manda sobre el color suelto)
    let fgSlug = '', bgSlug = '';
    for (const c of ((m.match(/class\s*=\s*"([^"]*)"/i) || [])[1] || '').split(/\s+/)) {
      let x;
      if ((x = c.match(/^has-([a-z0-9-]+)-background-color$/)) && TS.SLUG.test(x[1])) bgSlug = x[1];
      else if ((x = c.match(/^has-([a-z0-9-]+)-color$/)) && x[1] !== 'inline' && TS.SLUG.test(x[1])) fgSlug = x[1];
    }
    const bg = bgSlug ? '' : val('background-color'), fg = fgSlug ? '' : val('color');
    const cn = ['has-inline-color', fgSlug && `has-${fgSlug}-color`, bgSlug && `has-${bgSlug}-background-color`].filter(Boolean).join(' ');
    return `<mark style="background-color:${bg || 'rgba(0, 0, 0, 0)'}${fg ? ';color:' + fg : ''}" class="${cn}">`;
  });
  h = h.replace(/<(?!\/?(strong|em|a|s|u|code|sub|sup|mark)\b)[^>]*>/gi, ''); // el resto de etiquetas fuera
  h = h.replace(/<a>([\s\S]*?)<\/a>/gi, '$1');
  return h.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.replace(/<[^>]+>|&nbsp;|\s/g, '')).map((p) => p.replace(/\n/g, '<br>'));
}

// Imagen de WordPress que se amplía al pulsarla («Ampliar al hacer clic», de serie desde WordPress 6.4).
// Las fotos de entradas antiguas a veces no tienen número en la biblioteca (solo su dirección): entonces
// van sin «id» (si no, el bloque quedaría roto).
const imgId = (img) => (Number(img.id) > 0 ? Number(img.id) : 0);
function imageBlockAttrs(img) {
  return JSON.stringify({ ...(imgId(img) ? { id: imgId(img) } : {}), sizeSlug: 'large', linkDestination: 'none', lightbox: { enabled: true } });
}
const imgClass = (img) => (imgId(img) ? ` class="wp-image-${imgId(img)}"` : '');
function imageBlockAlt(img) {
  const alt = img.alt ? ` alt="${esc(img.alt)}"` : '';
  return `<!-- wp:image ${imageBlockAttrs(img)} -->\n<figure class="wp-block-image size-large"><img src="${esc(img.url)}"${alt}${imgClass(img)}/></figure>\n<!-- /wp:image -->`;
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

// Título sugerido al juntar varias publicaciones: su primera línea común (si la hay) o «Resumen de…»
function unifyTitle(posts, clean = true) {
  const sorted = [...posts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const line = sorted.length > 1 ? U.firstCommonLine(sorted.map((p) => p.text), (l) => tidyTitle(l).length >= 8) : '';
  if (line) return makeTitle(line, sorted[0].date, clean);
  return summaryTitle(sorted[0].date, sorted[sorted.length - 1].date);
}

// «lunes 12 de noviembre»
const dayLabel = (d) => new Date(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');

// Bloques de varias publicaciones juntas en una entrada (opts.unify: layout days|flow, photos each|end|carousel)
function unifiedBlocks(sections, sorted, u) {
  const keep = (u.photos || 'each') === 'each';
  const all = sections.flatMap((s) => s.images);
  const out = [];
  sections.forEach((sec, i) => {
    if (u.layout === 'flow') { if (i > 0) out.push({ id: bid(), type: 'separator' }); }
    else out.push({ id: bid(), type: 'heading', level: 3, html: esc(`Jornada ${i + 1} · ${dayLabel(sorted[i].date)}`) });
    out.push(...sectionsToBlocks([{ ...sec, images: keep ? sec.images : [] }]));
  });
  const gal = all.length === 1 ? { id: bid(), type: 'image', img: all[0], caption: '' }
    : all.length > 1 ? { id: bid(), type: u.photos === 'carousel' ? 'carousel' : 'gallery', images: all, columns: Math.min(all.length, 3) } : null;
  if (gal && u.photos === 'carousel') out.unshift(gal);
  else if (gal && u.photos === 'end') out.push({ id: bid(), type: 'separator' }, gal);
  return out;
}

function buildDraft(posts, uploaded, opts = {}) {
  const sorted = [...posts].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (opts.unify && sorted.length > 1) return buildUnified(sorted, uploaded, opts);
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
  return {
    title, tags, sections, blocks: sectionsToBlocks(sections), featuredImageId: firstImg?.id,
    date: sorted[sorted.length - 1].date, sourceText: sorted.map((p) => p.text).join('\n\n---\n\n'),
  };
}

function buildUnified(sorted, uploaded, opts) {
  const u = { layout: 'days', photos: 'each', dedupe: true, ...opts.unify };
  const extra = (opts.extraTags || '').split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  const tags = [...new Set([...sorted.flatMap((p) => extractTags(p.text)), ...extra])];
  const title = String(u.title || '').trim() || unifyTitle(sorted, opts.cleanTitle !== false);
  const texts = u.dedupe ? U.removeCommon(sorted.map((p) => p.text)) : sorted.map((p) => p.text);
  const sections = sorted.map((p, i) => postToSection({ ...p, text: texts[i] }, uploaded, opts));
  const firstImg = sections.flatMap((s) => s.images)[0];
  return {
    title, tags, sections, blocks: unifiedBlocks(sections, sorted, u), featuredImageId: firstImg?.id,
    date: sorted[sorted.length - 1].date, sourceText: sorted.map((p) => p.text).join('\n\n---\n\n'),
  };
}

// --- Editor de bloques -----------------------------------------------------------
// Un bloque es un objeto { id, type, ... } que el editor de Ecos modifica y composeBlocks() convierte en
// bloques estándar de WordPress (Gutenberg), así la web los pinta con su propio tema:
//   paragraph {html} · heading {level, html} · quote {html, cite} · list {ordered, items[]}
//   image {img{id,url,alt}, caption} · gallery {images[], columns} · carousel {images[]}
//   mediatext {img, html, right} · video {video{id,url}} · embed {url, provider} · separator {}
let seq = 0;
const bid = () => 'b' + Date.now().toString(36) + (seq++).toString(36);

function sectionsToBlocks(sections) {
  const out = [];
  sections.forEach((sec, i) => {
    if (i > 0) out.push({ id: bid(), type: 'separator' });
    for (const p of sanitizeParagraphs(sec.html)) out.push({ id: bid(), type: 'paragraph', html: p });
    if (sec.images.length === 1) out.push({ id: bid(), type: 'image', img: sec.images[0], caption: '' });
    else if (sec.images.length > 1) out.push({ id: bid(), type: 'gallery', images: sec.images, columns: Math.min(sec.images.length, 3) });
    for (const v of sec.videos) out.push({ id: bid(), type: 'video', video: v });
    if (sec.embed) out.push({ id: bid(), type: 'embed', url: sec.embed.url, provider: sec.embed.provider });
    if (sec.footer) out.push({ id: bid(), type: 'paragraph', html: sec.footer });
  });
  return out;
}

// Texto de una línea (título, cita, elemento de lista): negrita, cursiva, enlaces y saltos de línea
const inline = (html) => sanitizeParagraphs(html).join('<br><br>');
const caption = (c) => (c && inline(c) ? `<figcaption class="wp-element-caption">${inline(c)}</figcaption>` : '');

// Tamaños de una foto colocada a un lado o centrada (en píxeles: el ancho de texto del blog es ~760)
const IMG_W = { 33: 250, 50: 380, 75: 570 };
// Recortes por proporción (aspectRatio + scale:'cover' de core/image, WordPress 6.3+)
const IMG_RATIOS = ['1', '4/3', '3/2', '16/9', '9/16'];
const MT_RATIOS = IMG_RATIOS;
const IMG_SHADOW = '6px 6px 9px rgba(0, 0, 0, 0.2)';
const IMG_FX = { zoom: 'ecos-zoom', bw: 'ecos-bn' };
// Estilos mínimos de los efectos propios (clases ecos-*): van en un bloque HTML con <style> al final del contenido
const FX_CSS = {
  sombra: '.ecos-sombra{text-shadow:1px 2px 4px rgba(0,0,0,.35)}',
  // con esquinas redondeadas, el marco que recorta el zoom también las lleva (si no, al ampliar salen picos)
  zoom: '.wp-block-image.ecos-zoom:has(img[style*="border-radius:16px"]){border-radius:16px;width:fit-content;max-width:100%}.wp-block-image.ecos-zoom.is-style-rounded{border-radius:9999px;width:fit-content;max-width:100%}.wp-block-image.ecos-zoom{overflow:hidden}.wp-block-image.ecos-zoom img{transition:transform .5s cubic-bezier(.2,0,0,1)}.wp-block-image.ecos-zoom:hover img{transform:scale(1.08)}',
  bw: '.wp-block-image.ecos-bn img{filter:grayscale(1)}',
  // texto justificado (clase propia ecos-justify; la de WordPress, has-text-align-justify, de entradas antiguas)
  justify: '.ecos-justify,.has-text-align-justify{text-align:justify}',
  vplay: '.wp-block-video.ecos-vp{position:relative}.wp-block-video.ecos-vp video{display:block;width:100%}',
  iconos: '.wp-block-list.ecos-iconos{list-style:none;padding-left:0}.wp-block-list.ecos-iconos li{margin:.4em 0}.ecos-iconos .ecos-ico{display:inline-block;min-width:1.6em;color:#fd9800;font-weight:700}',
};
// Imagen y texto (clases ecos-mt-*) y carrusel (clases ecos-c*): un trozo de CSS por clase usada
const MT = '.wp-block-media-text';
Object.assign(FX_CSS, {
  'mt-rounded': `${MT}.ecos-mt-rounded .wp-block-media-text__media{border-radius:16px;overflow:hidden}`,
  'mt-circle': `${MT}.ecos-mt-circle .wp-block-media-text__media{border-radius:9999px;overflow:hidden}`,
  'mt-shadow': `${MT}.ecos-mt-shadow .wp-block-media-text__media{box-shadow:6px 6px 9px rgba(0,0,0,.2)}`,
  'mt-border': `${MT}.ecos-mt-border .wp-block-media-text__media{border:2px solid #333333;box-sizing:border-box}`,
  'mt-zoom': `${MT}.ecos-mt-zoom .wp-block-media-text__media{overflow:hidden}${MT}.ecos-mt-zoom img{transition:transform .5s cubic-bezier(.2,0,0,1)}${MT}.ecos-mt-zoom:hover img{transform:scale(1.08)}`,
  'mt-bw': `${MT}.ecos-mt-bn .wp-block-media-text__media{filter:grayscale(1)}`,
  // WordPress deja un 8 % de margen a cada lado del texto: el texto queda metido hacia dentro. Ecos lo alinea con el
  // resto de la página y deja solo una separación entre la foto y el texto (en el móvil, debajo de la foto)
  mt: `${MT}.ecos-mt>.wp-block-media-text__content{padding:0 0 0 2em}${MT}.ecos-mt.has-media-on-the-right>.wp-block-media-text__content{padding:0 2em 0 0}@media (max-width:600px){${MT}.ecos-mt.is-stacked-on-mobile>.wp-block-media-text__content{padding:1em 0 0}}`,
});
for (const r of ['1', '4/3', '3/2', '16/9', '9/16']) { const c = r.replace('/', '-'); FX_CSS['mt-r-' + c] = `${MT}.ecos-mt-r-${c}:not(.is-image-fill):not(.is-image-fill-element) img{aspect-ratio:${r};object-fit:cover;height:auto}`; }
const VC = '.wp-block-video.ecos-v-';
Object.assign(FX_CSS, {
  'v-rounded': `${VC}rounded{border-radius:16px;overflow:hidden}`,
  'v-border': `${VC}border{border:2px solid #333;box-sizing:border-box}`,
  'v-shadow': `${VC}shadow{box-shadow:${IMG_SHADOW}}`,
  'v-zoom': `${VC}zoom{overflow:hidden}${VC}zoom video{transition:transform .5s cubic-bezier(.2,0,0,1)}${VC}zoom:hover video{transform:scale(1.08)}`,
  'v-bw': `${VC}bw video{filter:grayscale(1)}`,
  'v-a-left': `${VC}a-left{margin-left:0;margin-right:auto}`,
  'v-a-center': `${VC}a-center{margin-left:auto;margin-right:auto}`,
  'v-a-right': `${VC}a-right{margin-left:auto;margin-right:0}`,
});
for (const [k, w] of Object.entries(IMG_W)) FX_CSS['v-w-' + k] = `${VC}w-${k}{width:${w}px;max-width:100%}`;
for (const r of IMG_RATIOS) { const c = r.replace('/', '-'); FX_CSS['v-r-' + c] = `${VC}r-${c} video{aspect-ratio:${r};object-fit:cover;width:100%;height:auto}`; }
const CAR_H = { s: '240px', m: '360px', l: '480px', xl: '70vh' };
const CAR_RATIOS = ['1', '4/3', '3/2', '16/9', '3/4'];
const CAR_GAP = { 0: 0, s: 4, l: 14 };
const CAR_SHADOW = '0 10px 30px rgba(0,0,0,.18)';
const CA = '.ecos-carrusel';
Object.entries(CAR_H).forEach(([k, v]) => { FX_CSS['cz-' + k] = `${CA}.ecos-cz-${k} img{height:${v};object-fit:cover}`; });
CAR_RATIOS.forEach((r) => { const c = r.replace('/', '-'); FX_CSS['cr-' + c] = `${CA}.ecos-cr-${c} img{aspect-ratio:${r};object-fit:cover}`; });
Object.assign(FX_CSS, {
  'cz-cr': `${CA}[class*="ecos-cz-"][class*="ecos-cr-"] img{height:auto;width:auto;max-width:100%;margin-inline:auto;display:block}`,
  'cc-round': `${CA}.ecos-cc-round img{border-radius:18px}`,
  // Esquinas redondeadas de verdad en Spectra: se recorta el marco de la foto (no solo la foto). Si no, al ampliar la
  // foto al pasar el ratón las esquinas se rellenan y, sin el ratón, asoma el fondo gris del marco en las esquinas
  'car-clip': `${CA}:is(.ecos-peek,.ecos-cc-round):not(.ecos-cc-sq) .spectra-image-gallery__media{border-radius:18px;overflow:hidden;background:transparent!important;isolation:isolate}`
    + `${CA}:is(.ecos-peek,.ecos-cc-round):not(.ecos-cc-sq) .spectra-image-gallery__media *{border-radius:inherit}`
    + `${CA}:is(.ecos-peek,.ecos-cc-round):not(.ecos-cc-sq) .spectra-image-gallery__media img{border-radius:18px}`,
  'cc-sq': `${CA}.ecos-cc-sq img{border-radius:0}`,
  'cs-on': `${CA}.ecos-cs-on img{box-shadow:${CAR_SHADOW}}`,
  'cs-off': `${CA}.ecos-cs-off img{box-shadow:none}`,
  'cg-0': `${CA}.ecos-cg-0 .slick-slide{padding:0}`,
  'cg-s': `${CA}.ecos-cg-s .slick-slide{padding:0 4px}`,
  'cg-l': `${CA}.ecos-cg-l .slick-slide{padding:0 14px}`,
});
// Panel de diseño universal (renderer/design.js): sus clases ecos-d-*, ecos-hide-*, ecos-anim-*, ecos-m-* y ecos-font-* con su CSS
const Design = require('../renderer/design');
Object.assign(FX_CSS, Design.CSS);
// «Más bloques» (pestañas, cifras, testimonios…): lógica en renderer/moreblocks.js, guion en renderer/morefx.js
const More = require('../renderer/moreblocks');
Object.assign(FX_CSS, More.CSS);
const FX_MARK = 'ecos-fx';
function fxBlock(set, helper = false) {
  const dyn = [...set].filter((k) => /^mt-bc-[0-9a-f]{3,8}$/.test(k)).sort()
    .map((k) => `${MT}.ecos-${k} .wp-block-media-text__media{border-color:#${k.slice(6)}}`).join('');
  // reglas de colores, resaltados e imágenes de fondo del diseño (una por valor usado)
  const dz = [...set].filter((k) => k.startsWith('dyn:')).map((k) => k.slice(4)).sort().join('');
  const css = Object.keys(FX_CSS).filter((k) => set.has(k)).map((k) => FX_CSS[k]).join('') + dyn + dz;
  const js = !helper && set.has('vplay') && VIDEOS_B64() ? `<script class="ecos-vjs">new Function(atob("${VIDEOS_B64()}"))()</script>` : '';
  // animaciones al aparecer: el guion (renderer/anim.js) va codificado igual que los demás; con el complemento lo pone él
  const ajs = !helper && set.has('anim') && ANIM_B64() ? `<script class="ecos-ajs">new Function(atob("${ANIM_B64()}"))()</script>` : '';
  // «Más bloques»: pestañas, contador, copiar, puntos, comparador… (renderer/morefx.js; con el complemento lo pone él)
  const mjs = !helper && set.has('more') && MORE_B64() ? `<script class="ecos-mjs">new Function(atob("${MORE_B64()}"))()</script>` : '';
  return `<!-- wp:html -->\n<style class="${FX_MARK}">${css}</style>${js}${ajs}${mjs}\n<!-- /wp:html -->`;
}
function imageBlockFull(img, cap = '', place = {}, fx = null) {
  const alt = img.alt ? ` alt="${esc(img.alt)}"` : ' alt=""';
  const align = ['left', 'right', 'center'].includes(place.align) ? place.align : '';
  const preset = align && IMG_W[place.width] ? `${IMG_W[place.width]}px` : '';
  const free = /^\d{1,4}(\.\d+)?(px|%)$/.test(place.w || '') ? place.w : '';
  const width = free || preset;
  const ratio = IMG_RATIOS.includes(place.ratio) ? place.ratio : '';
  const frame = ['rounded', 'circle', 'border', 'shadow'].includes(place.frame) ? place.frame : '';
  const effect = IMG_FX[place.fx] ? place.fx : '';
  if (!align && !width && !ratio && !frame && !effect) return `<!-- wp:image ${imageBlockAttrs(img)} -->\n<figure class="wp-block-image size-large"><img src="${esc(img.url)}"${alt}${imgClass(img)}/>${caption(cap)}</figure>\n<!-- /wp:image -->`;
  const attrs = JSON.parse(imageBlockAttrs(img));
  const figCls = ['wp-block-image'], css = [], st = {}, cn = [];
  if (align) { attrs.align = align; figCls.push('align' + align); }
  figCls.push('size-large');
  if (width) { attrs.width = width; figCls.push('is-resized'); css.push('width:' + width); }
  if (ratio) { attrs.aspectRatio = ratio; attrs.scale = 'cover'; css.push('aspect-ratio:' + ratio, 'object-fit:cover'); }
  if (frame === 'circle') cn.push('is-style-rounded');
  if (frame === 'rounded') { st.border = { radius: '16px' }; css.push('border-radius:16px'); }
  if (frame === 'border') {
    const col = SAFE_COLOR.test(place.frameColor || '') ? place.frameColor : '#333333';
    st.border = { color: col, style: 'solid', width: '2px' };
    css.push('border-color:' + col, 'border-style:solid', 'border-width:2px');
  }
  if (frame === 'rounded' || frame === 'border') figCls.push('has-custom-border');
  if (frame === 'shadow') { st.shadow = IMG_SHADOW; css.push('box-shadow:' + IMG_SHADOW); }
  if (effect) { cn.push(IMG_FX[effect]); fx?.add(effect); }
  if (cn.length) attrs.className = cn.join(' ');
  if (Object.keys(st).length) attrs.style = st;
  figCls.push(...cn);
  const cls = [frame === 'border' ? 'has-border-color' : '', imgId(img) ? `wp-image-${imgId(img)}` : ''].filter(Boolean).join(' ');
  return `<!-- wp:image ${JSON.stringify(attrs)} -->\n<figure class="${figCls.join(' ')}"><img src="${esc(img.url)}"${alt}${cls ? ` class="${cls}"` : ''}${css.length ? ` style="${css.join(';')}"` : ''}/>${caption(cap)}</figure>\n<!-- /wp:image -->`;
}

// Carrusel: diapositivas que se deslizan (scroll-snap, funciona sin JavaScript) con la foto activa
// destacada, fondo desenfocado de la propia foto (los carteles no se recortan), flechas, puntos, contador
// y paso automático, que añade renderer/carousel.js incrustado en la entrada.
// Va en un bloque HTML, que WordPress conserva si quien publica puede usar HTML (administradores).
const fs = require('fs');
const path = require('path');
let CAROUSEL_JS = '';
// Guion de los vídeos sueltos (renderer/videos.js), codificado igual que el del carrusel
let vidB64 = null;
const VIDEOS_B64 = () => {
  if (vidB64 !== null) return vidB64;
  try {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'videos.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.trim()).join(' ');
    vidB64 = Buffer.from(src.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')), 'utf8').toString('base64');
  } catch { vidB64 = ''; }
  return vidB64;
};
// Guion de las animaciones al aparecer (renderer/anim.js), codificado igual
let animB64 = null;
const ANIM_B64 = () => {
  if (animB64 !== null) return animB64;
  try {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'anim.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.trim()).join(' ');
    animB64 = Buffer.from(src.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')), 'utf8').toString('base64');
  } catch { animB64 = ''; }
  return animB64;
};
// Guion de «Más bloques» (renderer/morefx.js), codificado igual
let moreB64 = null;
const MORE_B64 = () => {
  if (moreB64 !== null) return moreB64;
  try {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'morefx.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.trim()).join(' ');
    moreB64 = Buffer.from(src.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')), 'utf8').toString('base64');
  } catch { moreB64 = ''; }
  return moreB64;
};
// El script del carrusel, en base64 y solo con caracteres ASCII: WordPress no puede alterarlo al guardar la entrada
let carB64 = '';
const CAROUSEL_B64 = () => carB64 || (carB64 = Buffer.from(CAROUSEL_JS.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')), 'utf8').toString('base64'));
try {
  CAROUSEL_JS = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'carousel.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.trim()).join(' ');
} catch { /* sin script: el carrusel se desliza igualmente */ }

// En la web propia, el carrusel va como galería de Spectra (que la web ya tiene): WordPress la dibuja
// en el servidor con sus propias flechas, puntos y deslizamiento, sin depender de que deje pasar scripts.
// Estilo «vecinas asomando» del carrusel de Spectra: se pega una vez en Apariencia → Personalizar → CSS adicional
const PEEK_CSS = `/* Ecos: carrusel con las fotos vecinas asomando */
.ecos-peek .slick-list{padding:0 14% !important;overflow:hidden}
.ecos-peek .slick-slide{transition:transform .5s cubic-bezier(.2,0,0,1),opacity .5s,filter .5s;transform:scale(.88);opacity:.5;filter:saturate(.6)}
.ecos-peek .slick-slide.slick-active{transform:none;opacity:1;filter:none}
.ecos-peek .slick-slide img{border-radius:18px}
.ecos-peek .spectra-image-gallery__media{border-radius:18px;overflow:hidden;background:transparent!important;isolation:isolate}
@media (max-width:600px){.ecos-peek .slick-list{padding:0 8% !important}}`;
// Opciones del carrusel (b.size, b.ratio o b.squares, b.corners, b.shadow, b.gap, b.arrows, b.dots), validadas
function carOpts(b) {
  const o = {};
  if (CAR_H[b.size]) o.size = b.size;
  const ratio = b.ratio ?? (b.squares ? '1' : '');
  if (CAR_RATIOS.includes(ratio)) o.ratio = ratio;
  if (b.corners === 'round' || b.corners === 'square') o.corners = b.corners;
  if (b.shadow === 'on' || b.shadow === 'off') o.shadow = b.shadow;
  if (['0', 's', 'l'].includes(String(b.gap))) o.gap = String(b.gap);
  if (b.arrows === false) o.arrows = false;
  if (b.dots === false) o.dots = false;
  return o;
}
function spectraCarouselBlock(b, fx = null) {
  const o = carOpts(b);
  const keys = [];
  if (o.size) keys.push('cz-' + o.size);
  if (CAR_RATIOS.includes(b.ratio)) keys.push('cr-' + b.ratio.replace('/', '-')); // «squares» (antiguo) lo hace el propio Spectra
  if (o.size && o.ratio) keys.push('cz-cr');
  if (o.corners) keys.push(o.corners === 'round' ? 'cc-round' : 'cc-sq');
  if (o.shadow) keys.push(o.shadow === 'on' ? 'cs-on' : 'cs-off');
  if (o.gap) keys.push('cg-' + o.gap);
  keys.forEach((k) => fx?.add(k));
  if (b.view === 'peek' || o.corners === 'round') fx?.add('car-clip');
  const hex = require('crypto').createHash('md5').update(String(b.id)).digest('hex').slice(0, 8);
  const media = b.images.map((i) => ({ id: Number(i.id) || 0, url: i.url, alt: i.alt || '', caption: b.captions ? (i.alt || '') : '' }));
  const a = {
    block_id: hex, readyToRender: true, mediaGallery: media, mediaIDs: media.map((m) => m.id).filter(Boolean), feedLayout: 'carousel',
    columnsDesk: b.view === 'multi' ? 3 : 1, columnsTab: b.view === 'multi' ? 2 : 1, columnsMob: 1, carouselSquares: o.ratio === '1', carouselLoop: true, carouselAutoplay: b.autoplay !== false, carouselAutoplaySpeed: 5000,
    carouselPauseOnHover: true, imageClickEvent: 'lightbox', paginateUseArrows: o.arrows !== false, paginateUseDots: o.dots !== false, imageDisplayCaption: !!b.captions, galleryImageSize: 'large', className: ['ecos-carrusel', b.view === 'peek' ? 'ecos-peek' : '', ...keys.filter((k) => k !== 'cz-cr').map((k) => 'ecos-' + k)].filter(Boolean).join(' '),
  };
  return `<!-- wp:uagb/image-gallery ${JSON.stringify(a).replace(/--/g, '\\u002d\\u002d')} /-->`;
}

// Imagen y texto: bloque media-text de WordPress. Tamaño (mediaWidth), alineación vertical e «imageFill» son atributos
// estándar; el marco, el recorte y el efecto de la foto van en clases ecos-mt-* (con su CSS en el bloque ecos-fx)
const MT_FRAMES = ['rounded', 'circle', 'border', 'shadow'];
function mediaTextBlock(b, fx = null) {
  const img = b.img, right = !!b.right;
  const mw = Number.isInteger(Number(b.mediaWidth)) && b.mediaWidth >= 10 && b.mediaWidth <= 90 ? Number(b.mediaWidth) : 50;
  const va = ['top', 'center', 'bottom'].includes(b.valign) ? b.valign : '';
  const fill = !!b.fill;
  const cn = ['ecos-mt'];
  const ratio = MT_RATIOS.includes(b.ratio) ? b.ratio : '';
  if (ratio) cn.push('ecos-mt-r-' + ratio.replace('/', '-'));
  const frame = MT_FRAMES.includes(b.frame) ? b.frame : '';
  if (frame) cn.push('ecos-mt-' + frame);
  // el color del borde no puede ir en un estilo de la foto (WordPress lo daría por inválido): clase por color + su CSS en ecos-fx
  const bcol = frame === 'border' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(b.frameColor || '') && b.frameColor.slice(1).toLowerCase();
  if (bcol && bcol !== '333333') { cn.push('ecos-mt-bc-' + bcol); fx?.add('mt-bc-' + bcol); }
  if (b.fx === 'zoom') cn.push('ecos-mt-zoom'); else if (b.fx === 'bw') cn.push('ecos-mt-bn');
  cn.forEach((c) => !c.startsWith('ecos-mt-bc-') && fx?.add(c === 'ecos-mt-bn' ? 'mt-bw' : c.replace('ecos-', '')));
  const attrs = {};
  if (right) attrs.mediaPosition = 'right';
  if (imgId(img)) attrs.mediaId = imgId(img);
  attrs.mediaLink = img.url; attrs.mediaType = 'image';
  if (mw !== 50) attrs.mediaWidth = mw;
  if (va) attrs.verticalAlignment = va;
  if (fill) attrs.imageFill = true;
  if (cn.length) attrs.className = cn.join(' ');
  // Como el save() de core/media-text: con la foto a la derecha, el texto va ANTES de la foto en el HTML; la foto
  // «rellenar» lleva object-position en la <img> (clase is-image-fill-element); la <img> solo lleva clase si hay número
  const cls = ['wp-block-media-text', ...(cn), ...(right ? ['has-media-on-the-right'] : []), 'is-stacked-on-mobile', ...(va ? ['is-vertically-aligned-' + va] : []), ...(fill ? ['is-image-fill-element'] : [])];
  const grid = mw !== 50 ? ` style="grid-template-columns:${right ? `auto ${mw}%` : `${mw}% auto`}"` : '';
  // el texto lleva el mismo formato que un párrafo (alineación, tamaño, fuente, color…), igual en cada párrafo
  const st = blockStyle(b, { fx });
  const text = sanitizeParagraphs(b.html).map((p) => `<!-- wp:paragraph${st.json} -->\n<p${st.cls ? ` class="${st.cls.trim()}"` : ''}${st.style}>${p}</p>\n<!-- /wp:paragraph -->`).join('\n');
  const imgTag = `<img src="${esc(img.url)}" alt="${esc(img.alt || '')}"${imgId(img) ? ` class="wp-image-${imgId(img)} size-full"` : ''}${fill ? ' style="object-position:50% 50%"' : ''}/>`;
  const media = `<figure class="wp-block-media-text__media">${imgTag}</figure>`;
  const content = `<div class="wp-block-media-text__content">${text}</div>`;
  return `<!-- wp:media-text ${JSON.stringify(attrs).replace(/--/g, '\\u002d\\u002d')} -->\n<div class="${cls.join(' ')}"${grid}>${right ? content + media : media + content}</div>\n<!-- /wp:media-text -->`;
}

function carouselBlock(b, helper = false) {
  const o = carOpts(b);
  const H = CAR_H[o.size] || '', R = o.ratio || '';
  const radius = o.corners === 'square' ? 0 : 18;
  const shadow = o.shadow === 'off' ? 'none' : CAR_SHADOW;
  const gap = o.gap !== undefined ? CAR_GAP[o.gap] : 14;
  // tamaño de cada diapositiva: con altura y proporción, el ancho sale de las dos; solo con altura, ocupa casi todo el ancho
  const slideSize = H && R ? `flex:0 0 auto;height:${H};aspect-ratio:${R};max-width:90%` : H ? `flex:0 0 84%;height:${H}` : `flex:0 0 84%;aspect-ratio:${R || '4/3'}`;
  const dataOpts = Object.entries({ size: o.size, ratio: o.ratio, corners: o.corners, shadow: o.shadow, gap: o.gap }).filter(([, v]) => v !== undefined).map(([k, v]) => ` data-${k}="${v}"`).join('')
    + (o.arrows === false ? ' data-arrows="0"' : '') + (o.dots === false ? ' data-dots="0"' : '');
  const id = 'ecos-c-' + b.id.replace(/[^a-z0-9]/gi, '');
  const S = `#${id}`;
  const css = `${S}{position:relative;margin:2em 0;outline:none;--ec-r:${radius}px}`
    + `${S} .ec-track{position:relative;display:flex;gap:${gap}px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding:4px 8%;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-top:14px;padding-bottom:28px}`
    + `${S} .ec-track::-webkit-scrollbar{display:none}`
    + `${S}.ec-js .ec-track{cursor:grab}${S} .ec-track.ec-dragging{cursor:grabbing;scroll-snap-type:none;scroll-behavior:auto;user-select:none}`
    + `${S} .ec-slide img{-webkit-user-drag:none;user-select:none}`
    + `${S} .ec-slide{position:relative;${slideSize};margin:0;border-radius:var(--ec-r);overflow:hidden;scroll-snap-align:center;background:#111;box-shadow:${shadow};transition:transform .5s cubic-bezier(.2,0,0,1),opacity .5s,filter .5s}`
    + `${S} .ec-bg{transform:scale(1.25)}${S} .ec-sbtn:hover{background-color:#fff}`
    + `${S} .ec-slide figcaption{position:absolute;left:0;right:0;bottom:0;padding:28px 18px 14px;color:#fff;font-size:.85em;background:linear-gradient(transparent,rgba(0,0,0,.65))}`
    + `${S}.ec-js .ec-slide:not(.ec-on){transform:scale(.9);opacity:.5;filter:saturate(.6)}`
    + `${S} .ec-btn{position:absolute;top:calc(50% - 18px);z-index:2;width:46px;height:46px;border:0;border-radius:50%;background:rgba(255,255,255,.88);color:#111;font-size:30px;line-height:1;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);transition:transform .2s,background .2s;padding:0 0 4px}`
    + `${S} .ec-btn:hover{transform:scale(1.1);background:#fff}`
    + `${S} .ec-prev{left:calc(8% - 23px)}${S} .ec-next{right:calc(8% - 23px)}`
    + `${S} .ec-count{position:absolute;top:16px;right:calc(8% + 14px);z-index:2;padding:4px 11px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.5px;backdrop-filter:blur(6px)}`
    + `${S} .ec-bar{display:block;height:3px;margin:-6px 8% 0;border-radius:3px;background:currentColor;opacity:.35;transform:scaleX(0);transform-origin:left}`
    + `${S}.ec-static .ec-bar{display:none}`
    + `${S} .ec-dots{display:flex;justify-content:center;gap:7px;margin-top:12px}`
    + `${S} .ec-dot{width:8px;height:8px;padding:0;border:0;border-radius:8px;background:currentColor;opacity:.25;cursor:pointer;transition:width .3s,opacity .3s}`
    + `${S} .ec-dot.ec-on{width:26px;opacity:.85}`
    + (o.arrows === false ? `${S} .ec-btn,${S} .ec-sbtn{display:none !important}` : '')
    + (o.dots === false ? `${S} .ec-dots{display:none !important}` : '')
    + `@media (max-width:600px){${S} .ec-slide{${H || R ? 'max-width:94%' : 'flex-basis:90%'}}${S} .ec-btn{display:none}}`;
  // Flechas y contador escritos en cada foto, con estilos en línea: funcionan aunque WordPress quite el
  // <script> o el <style> (las flechas son enlaces a la foto anterior y siguiente)
  const n = b.images.length;
  const btn = 'position:absolute;top:50%;margin-top:-22px;z-index:2;width:44px;height:44px;border-radius:50%;background-color:rgba(255,255,255,.9);color:#111;'
    + 'font-size:30px;line-height:40px;text-align:center;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.3)';
  const figs = b.images.map((i, k) => {
    const alt = esc(i.alt || '');
    const prev = `${id}-${((k - 1 + n) % n) + 1}`, next = `${id}-${((k + 1) % n) + 1}`;
    const vid = i.type === 'video';
    const bgUrl = vid ? i.poster : i.url;
    return `<figure class="ec-slide${vid ? ' ec-vslide' : ''}" id="${id}-${k + 1}" style="position:relative;${slideSize};margin:0;border-radius:${radius}px;overflow:hidden;background-color:#111${o.shadow === 'on' ? ';box-shadow:' + CAR_SHADOW : ''}">`
      + (bgUrl ? `<img class="ec-bg" src="${esc(bgUrl)}" alt="" aria-hidden="true" loading="lazy" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;filter:blur(24px) brightness(.7);margin:0"/>` : '')
      + (vid
        ? `<video class="ec-vid" autoplay muted loop playsinline preload="metadata" src="${esc(i.url)}"${i.poster ? ` poster="${esc(i.poster)}"` : ''}${Number(i.id) ? ` data-id="${i.id}"` : ''} style="position:relative;display:block;width:100%;height:100%;object-fit:cover;margin:0;border-radius:0;background-color:#000"></video>`
        : `<img src="${esc(i.url)}" alt="${alt}" loading="lazy"${Number(i.id) ? ` class="wp-image-${i.id}"` : ''} style="position:relative;display:block;width:100%;height:100%;object-fit:contain;margin:0;border-radius:0"/>`)
      + (n > 1 && o.arrows !== false ? `<span class="ec-nav"><a class="ec-sbtn" href="#${prev}" aria-label="Anterior" style="${btn};left:12px">&#8249;</a>`
        + `<a class="ec-sbtn" href="#${next}" aria-label="Siguiente" style="${btn};right:12px">&#8250;</a>`
        + `<span class="ec-scount" style="position:absolute;top:12px;right:12px;z-index:2;padding:3px 11px;border-radius:999px;background-color:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:600;line-height:1.5">${k + 1} / ${n}</span></span>` : '')
      + (b.captions && i.alt ? `<figcaption>${alt}</figcaption>` : '')
      + '</figure>';
  }).join('');
  const auto = b.autoplay === false ? 0 : 5000;
  const script = CAROUSEL_JS && !helper ? `<script>new Function(atob("${CAROUSEL_B64()}"))()</script>` : '';
  return `<!-- wp:html -->\n<div class="ecos-carrusel" id="${id}" data-ecos-carousel data-autoplay="${auto}"${dataOpts} style="position:relative;margin:2em 0"><style>${css}</style><div class="ec-track" style="display:flex;gap:${gap}px;overflow-x:auto;padding:14px 8% 28px">${figs}</div></div>${script}\n<!-- /wp:html -->`;
}

// Estilos de bloque (alineación, tamaño, fuente, colores) con los atributos estándar de WordPress
const FONTS = {
  serif: 'Georgia, Times New Roman, serif', sans: 'Helvetica Neue, Arial, sans-serif', round: 'Trebuchet MS, Segoe UI, sans-serif',
  mono: 'Courier New, monospace', hand: 'Segoe Print, Comic Sans MS, cursive',
};
// Elemento del tema elegido en un bloque (b.th = { color: { slug, v }, … }); vale solo si b[key] sigue siendo el valor del tema
function themeSel(b, key) {
  const t = b.th?.[key];
  return t && TS.SLUG.test(String(t.slug)) && t.v === b[key] ? String(t.slug) : '';
}
// Fuente de la web: b.font = 'wp:<slug>' (familia registrada en el tema → clase has-<slug>-font-family) o 'heading' (fuente de los títulos: la familia va en línea)
function themeFont(b) {
  const f = String(b.font || '');
  if (f.startsWith('wp:') && TS.SLUG.test(f.slice(3))) return { slug: f.slice(3) };
  const fam = b.th?.font?.v;
  if (f === 'heading' && typeof fam === 'string' && /^[\w\s,'"\-.]{1,200}$/.test(fam)) return { family: fam };
  return null;
}
function blockStyle(b, { alignKey = 'align', align = true, dropCap = false, fx = null } = {}) {
  const attrs = {}, cls = [], css = [];
  // «justify» no existe en el bloque de texto de WordPress actual (solo izquierda, centro y derecha): se marca con una clase
  // propia (ecos-justify, CSS en el bloque ecos-fx) para que el bloque siga siendo válido en cualquier versión
  const custom = [];
  if (align && ['center', 'right'].includes(b.align)) { attrs[alignKey] = b.align; cls.push('has-text-align-' + b.align); }
  if (align && b.align === 'justify') { custom.push('ecos-justify'); fx?.add('justify'); }
  if (dropCap && b.dropCap) { attrs.dropCap = true; cls.push('has-drop-cap'); }
  const st = {};
  // Colores, tamaño y fuente de la web (b.th): clases y atributos estándar de WordPress (has-<slug>-color, textColor…);
  // así, si cambia el tema, cambia todo. Solo valen mientras el valor del bloque siga siendo el del tema
  const tc = themeSel(b, 'color'), tb = themeSel(b, 'bg'), tz = themeSel(b, 'size'), tf = themeFont(b);
  if (tc) { attrs.textColor = tc; cls.push(`has-${tc}-color`, 'has-text-color'); }
  if (tb) { attrs.backgroundColor = tb; cls.push(`has-${tb}-background-color`, 'has-background'); }
  const color = !tc && SAFE_COLOR.test(b.color || '') && b.color;
  const grad = !tb && DK.safeGradient(b.gradient), bg = !tb && !grad && SAFE_COLOR.test(b.bg || '') && b.bg;
  if (color || bg || grad) {
    st.color = {};
    if (color) { st.color.text = color; cls.push('has-text-color'); css.push('color:' + color); }
    if (grad) { st.color.gradient = grad; cls.push('has-background'); css.push('background:' + grad); }
    if (bg) { st.color.background = bg; cls.push('has-background'); css.push('background-color:' + bg); }
  }
  // una fuente de Google (ecos-font-*) sustituye a la de sistema; la del tema (b.th) va como fontFamily
  const size = !tz && /^\d{1,3}px$/.test(b.size || '') && b.size, font = !tf && !Design.fontBySlug(b.gf) && FONTS[b.font];
  const spacing = /^\d{1,2}(\.\d)?px$/.test(b.spacing || '') && b.spacing;
  const lh = Design.LH.includes(String(b.lh)) && String(b.lh), tt = Design.TT.includes(b.tt) && b.tt;
  if (tz) { attrs.fontSize = tz; cls.push(`has-${tz}-font-size`); }
  if (tf?.slug) { attrs.fontFamily = tf.slug; cls.push(`has-${tf.slug}-font-family`); }
  const famInline = tf?.family || font;
  if (size || famInline || spacing || lh || tt) {
    st.typography = {};
    if (famInline) { st.typography.fontFamily = famInline; css.push('font-family:' + famInline); }
    if (size) { st.typography.fontSize = size; css.push('font-size:' + size); }
    if (spacing) { st.typography.letterSpacing = spacing; css.push('letter-spacing:' + spacing); }
    if (lh) { st.typography.lineHeight = lh; css.push('line-height:' + lh); }
    if (tt) { st.typography.textTransform = tt; css.push('text-transform:' + tt); }
  }
  // Resaltado de bloque: el color de fondo lleva margen interior y esquinas suaves
  if ((bg || tb || grad) && align) {
    st.spacing = { padding: { top: '14px', right: '18px', bottom: '14px', left: '18px' } };
    st.border = { radius: '10px' };
    css.push('border-radius:10px', 'padding-top:14px', 'padding-right:18px', 'padding-bottom:14px', 'padding-left:18px');
  }
  if (b.shadow && align) { custom.push('ecos-sombra'); fx?.add('sombra'); }
  if (custom.length) { attrs.className = custom.join(' '); cls.push(...custom); }
  if (Object.keys(st).length) attrs.style = st;
  const json = Object.keys(attrs).length ? ' ' + JSON.stringify(attrs) : '';
  return { json, attrs, cls: cls.length ? ' ' + cls.join(' ') : '', style: css.length ? ` style="${css.join(';')}"` : '' };
}

// Anclas de los títulos (para el índice): «Qué hicimos» → «que-hicimos»
const slug = (html) => html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'seccion';
function headingAnchors(blocks) {
  const used = new Map(), out = new Map();
  for (const b of blocks) {
    if (b.type !== 'heading' || !inline(b.html || '')) continue;
    const base = slug(b.html); const n = (used.get(base) || 0) + 1; used.set(base, n);
    out.set(b.id, n > 1 ? `${base}-${n}` : base);
  }
  return out;
}

// Vídeos y contenidos de otras webs (WordPress los inserta con oEmbed a partir del enlace)
const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'dailymotion', 'tiktok', 'videopress'];
function embedFull(b) {
  const prov = (b.provider || '').replace(/[^a-z-]/g, '');
  const video = VIDEO_PROVIDERS.includes(prov);
  const aspect = video && prov !== 'tiktok' ? ' wp-embed-aspect-16-9 wp-has-aspect-ratio' : '';
  const attrs = { url: b.url, type: video ? 'video' : 'rich', providerNameSlug: prov || 'embed-handler' };
  if (video) attrs.responsive = true;
  if (aspect) attrs.className = aspect.trim();
  const cap = b.caption && inline(b.caption) ? `<figcaption class="wp-element-caption">${inline(b.caption)}</figcaption>` : '';
  return `<!-- wp:embed ${JSON.stringify(attrs)} -->\n<figure class="wp-block-embed is-type-${attrs.type} is-provider-${attrs.providerNameSlug} wp-block-embed-${attrs.providerNameSlug}${aspect}"><div class="wp-block-embed__wrapper">\n${esc(b.url)}\n</div>${cap}</figure>\n<!-- /wp:embed -->`;
}

function tableBlock(b) {
  const rows = (b.rows || []).filter((r) => r.length);
  if (!rows.length) return '';
  const cell = (tag, h) => `<${tag}>${inline(h || '')}</${tag}>`;
  const head = b.head ? `<thead><tr>${rows[0].map((c) => cell('th', c)).join('')}</tr></thead>` : '';
  const body = (b.head ? rows.slice(1) : rows).map((r) => `<tr>${r.map((c) => cell('td', c)).join('')}</tr>`).join('');
  const attrs = { hasFixedLayout: false }; if (b.stripes) attrs.className = 'is-style-stripes';
  return `<!-- wp:table ${JSON.stringify(attrs)} -->\n<figure class="wp-block-table${b.stripes ? ' is-style-stripes' : ''}"><table>${head}<tbody>${body}</tbody></table>${b.caption && inline(b.caption) ? `<figcaption class="wp-element-caption">${inline(b.caption)}</figcaption>` : ''}</figure>\n<!-- /wp:table -->`;
}

const BTN_RADIUS = { square: '0px', round: '8px', pill: '9999px' };
const BTN_SIZE = { s: { pad: ['8px', '18px'], font: '14px' }, l: { pad: ['18px', '40px'], font: '20px' } };
function buttonsBlock(b) {
  const text = inline(b.html || '');
  if (!text) return '';
  const href = /^(https?:|mailto:|tel:|#|data:text\/calendar[;,])/i.test(b.url || '') ? ` href="${esc(b.url)}"` : '';
  const full = !!b.full;
  const just = !full && ['center', 'right'].includes(b.align) ? { layout: { type: 'flex', justifyContent: b.align } } : null;
  const outline = b.variant === 'outline';
  // Estilo del botón con atributos estándar de core/button
  const st = {}, aCls = ['wp-block-button__link'], css = [];
  const tb = !outline && themeSel(b, 'bg'), tc = themeSel(b, 'color');
  const bg = !outline && !tb && SAFE_COLOR.test(b.bg || '') && b.bg, fg = !tc && SAFE_COLOR.test(b.color || '') && b.color;
  const rad = BTN_RADIUS[b.radius], sz = BTN_SIZE[b.size];
  if (rad) { st.border = { radius: rad }; css.push('border-radius:' + rad); }
  if (fg || bg) {
    st.color = {};
    if (fg) { st.color.text = fg; aCls.push('has-text-color'); css.push('color:' + fg); }
    if (bg) { st.color.background = bg; aCls.push('has-background'); css.push('background-color:' + bg); }
  }
  if (sz) {
    st.spacing = { padding: { top: sz.pad[0], right: sz.pad[1], bottom: sz.pad[0], left: sz.pad[1] } };
    st.typography = { fontSize: sz.font };
    aCls.push('has-custom-font-size');
    css.push(`padding-top:${sz.pad[0]}`, `padding-right:${sz.pad[1]}`, `padding-bottom:${sz.pad[0]}`, `padding-left:${sz.pad[1]}`, 'font-size:' + sz.font);
  }
  aCls.push('wp-element-button');
  const attrs = {};
  if (tb) { attrs.backgroundColor = tb; aCls.push(`has-${tb}-background-color`, 'has-background'); }
  if (tc) { attrs.textColor = tc; aCls.push(`has-${tc}-color`, 'has-text-color'); }
  if (outline) attrs.className = 'is-style-outline';
  if (full) attrs.width = 100;
  if (Object.keys(st).length) attrs.style = st;
  const divCls = ['wp-block-button'];
  if (outline) divCls.push('is-style-outline');
  if (full) divCls.push('has-custom-width', 'wp-block-button__width-100');
  const attrJson = Object.keys(attrs).length ? ' ' + JSON.stringify(attrs) : '';
  return `<!-- wp:buttons${just ? ' ' + JSON.stringify(just) : ''} -->\n<div class="wp-block-buttons"><!-- wp:button${attrJson} -->\n<div class="${divCls.join(' ')}"><a class="${aCls.join(' ')}"${href}${css.length ? ` style="${css.join(';')}"` : ''}>${text}</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->`;
}

// --- Contenedores: sección (core/group), columnas (core/columns + core/column) y portada (core/cover) ---------------
// Cada contenedor lleva bloques dentro: b.children = [bloques] (sección y portada) o b.cols = [{ width, children }] (columnas).
const kidLists = (b) => (Array.isArray(b.children) ? [b.children] : Array.isArray(b.cols) ? b.cols.map((c) => c.children || []) : []);
function flatBlocks(blocks, out = []) {
  for (const b of blocks || []) { out.push(b); for (const l of kidLists(b)) flatBlocks(l, out); }
  return out;
}
// Margen interior de una sección: arriba y abajo / a los lados, en píxeles
const GROUP_PAD = { s: [24, 24], m: [48, 32], l: [80, 40] };
const GROUP_SHADOW = '6px 6px 9px rgba(0, 0, 0, 0.2)';
const ALIGNS = ['wide', 'full'];
// Proporciones de columnas (porcentajes) según el número de columnas
const COL_PRESETS = {
  1: [[100]], 2: [[50, 50], [33.33, 66.66], [66.66, 33.33]], 3: [[33.33, 33.33, 33.33], [25, 50, 25], [50, 25, 25], [25, 25, 50]], 4: [[25, 25, 25, 25]],
};
const equalCols = (cols) => cols.length < 2 || cols.every((c) => parseFloat(c.width) === parseFloat(cols[0].width));

// Diseño avanzado de contenedores (fase 2): margen exterior arriba/abajo, separación entre columnas y degradado de fondo,
// con los atributos estándar de WordPress (style.spacing.margin, style.spacing.blockGap, style.color.gradient)
const px = (n, max) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
const has = (v) => v !== undefined && v !== null && v !== '';
function marginOf(b) {
  const m = {}, css = [];
  if (has(b.mt)) { const v = px(b.mt, 200); m.top = v + 'px'; css.push(`margin-top:${v}px`); }
  if (has(b.mb)) { const v = px(b.mb, 200); m.bottom = v + 'px'; css.push(`margin-bottom:${v}px`); }
  return { margin: Object.keys(m).length ? m : null, css };
}
const gapOf = (b) => (has(b.gap) ? px(b.gap, 120) + 'px' : '');

function groupBlock(b, opts, ctx) {
  const inner = composeList(b.children || [], opts, ctx);
  const attrs = {}, st = {}, cls = ['wp-block-group'], css = [];
  const align = ALIGNS.includes(b.width) ? b.width : '';
  if (align) { attrs.align = align; cls.push('align' + align); }
  const grad = DK.safeGradient(b.gradient), tb = !grad && themeSel(b, 'bg'), tc = themeSel(b, 'color');
  const bg = !tb && SAFE_COLOR.test(b.bg || '') && b.bg, fg = !tc && SAFE_COLOR.test(b.color || '') && b.color;
  if (tb) { attrs.backgroundColor = tb; cls.push(`has-${tb}-background-color`, 'has-background'); }
  if (tc) { attrs.textColor = tc; cls.push(`has-${tc}-color`, 'has-text-color'); }
  if (bg || fg || grad) {
    st.color = {};
    if (grad) { st.color.gradient = grad; cls.push('has-background'); css.push('background:' + grad); }
    else if (bg) { st.color.background = bg; cls.push('has-background'); css.push('background-color:' + bg); }
    if (fg) { st.color.text = fg; cls.push('has-text-color'); css.push('color:' + fg); }
  }
  const pad = GROUP_PAD[b.pad], mar = marginOf(b);
  if (pad || mar.margin) st.spacing = {};
  if (pad) {
    const [v, h] = pad;
    st.spacing.padding = { top: v + 'px', right: h + 'px', bottom: v + 'px', left: h + 'px' };
    css.push(`padding-top:${v}px`, `padding-right:${h}px`, `padding-bottom:${v}px`, `padding-left:${h}px`);
  }
  if (mar.margin) { st.spacing.margin = mar.margin; css.push(...mar.css); }
  const rad = Math.max(0, Math.min(60, Number(b.radius) || 0));
  const bc = SAFE_COLOR.test(b.border || '') && b.border;
  if (rad || bc) {
    st.border = {};
    if (rad) st.border.radius = rad + 'px';
    if (bc) { st.border.width = '1px'; st.border.color = bc; st.border.style = 'solid'; cls.push('has-border-color'); css.unshift(`border-color:${bc}`, 'border-style:solid', 'border-width:1px'); }
    if (rad) css.unshift(`border-radius:${rad}px`);
  }
  if (b.shadow) { st.shadow = GROUP_SHADOW; css.push('box-shadow:' + GROUP_SHADOW); }
  if (Object.keys(st).length) attrs.style = st;
  attrs.layout = { type: 'constrained' };
  return `<!-- wp:group ${JSON.stringify(attrs)} -->\n<div class="${cls.join(' ')}"${css.length ? ` style="${css.join(';')}"` : ''}>${inner ? '\n' + inner + '\n' : ''}</div>\n<!-- /wp:group -->`;
}

function columnsBlock(b, opts, ctx) {
  const cols = (b.cols || []).filter(Boolean);
  if (!cols.length) return '';
  const valign = ['top', 'center', 'bottom'].includes(b.valign) ? b.valign : '';
  const attrs = {};
  const cls = ['wp-block-columns'], css = [];
  if (valign) { attrs.verticalAlignment = valign; cls.push('are-vertically-aligned-' + valign); }
  if (b.stack === false) { attrs.isStackedOnMobile = false; cls.push('is-not-stacked-on-mobile'); }
  if (ALIGNS.includes(b.width)) { attrs.align = b.width; cls.push('align' + b.width); }
  // diseño: degradado o color de fondo, separación entre columnas y margen exterior
  const st = {}, grad = DK.safeGradient(b.gradient), tb = !grad && themeSel(b, 'bg'), bg = !tb && SAFE_COLOR.test(b.bg || '') && b.bg, gap = gapOf(b), mar = marginOf(b);
  if (tb) { attrs.backgroundColor = tb; cls.push(`has-${tb}-background-color`, 'has-background'); }
  if (grad || bg) { st.color = grad ? { gradient: grad } : { background: bg }; cls.push('has-background'); css.push(grad ? 'background:' + grad : 'background-color:' + bg); }
  if (gap || mar.margin) { st.spacing = {}; if (gap) st.spacing.blockGap = gap; if (mar.margin) { st.spacing.margin = mar.margin; css.push(...mar.css); } }
  if (Object.keys(st).length) attrs.style = st;
  const eq = equalCols(cols);
  const inner = cols.map((c) => {
    const a = {}, cc = ['wp-block-column'];
    const w = !eq && /^\d{1,3}(\.\d+)?%$/.test(c.width || '') ? c.width : '';
    if (valign) { a.verticalAlignment = valign; cc.push('is-vertically-aligned-' + valign); }
    if (w) a.width = w;
    const body = composeList(c.children || [], opts, ctx);
    return `<!-- wp:column${Object.keys(a).length ? ' ' + JSON.stringify(a) : ''} -->\n<div class="${cc.join(' ')}"${w ? ` style="flex-basis:${w}"` : ''}>${body ? '\n' + body + '\n' : ''}</div>\n<!-- /wp:column -->`;
  }).join('\n\n');
  return `<!-- wp:columns${Object.keys(attrs).length ? ' ' + JSON.stringify(attrs) : ''} -->\n<div class="${cls.join(' ')}"${css.length ? ` style="${css.join(';')}"` : ''}>${inner}</div>\n<!-- /wp:columns -->`;
}

// ¿El color es oscuro? (para decidir si el texto de la portada va en blanco o en negro)
function isDarkColor(c) {
  const m = String(c || '').match(/^#([0-9a-f]{3}|[0-9a-f]{6})/i);
  if (!m) return true;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  const [r, g, bl] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * bl) / 255 < 0.55;
}
function coverBlock(b, opts, ctx) {
  const inner = composeList(b.children || [], opts, ctx);
  const overlay = /^#[0-9a-f]{6}$/i.test(b.overlay || '') ? b.overlay : '#000000';
  const dim = Math.max(0, Math.min(100, Math.round(Number(b.dim ?? 50) / 10) * 10));
  const h = Number(b.height) > 0 ? Math.min(1200, Math.round(Number(b.height))) : 0;
  // vídeo de fondo (sin sonido y en bucle): solo si no hay foto
  const vurl = !(b.img && b.img.url) && b.bgVideo && /^https?:\/\/[^\s"'<>]+$/i.test(b.bgVideo.url || '') ? b.bgVideo.url : '';
  const img = b.img && b.img.url ? b.img : null;
  const grad = DK.safeGradient(b.gradient);
  const fpv = (v) => Math.round(Math.max(0, Math.min(1, Number(v))) * 100) / 100;
  const fp = b.focalPoint && Number.isFinite(Number(b.focalPoint.x)) && Number.isFinite(Number(b.focalPoint.y)) ? { x: fpv(b.focalPoint.x), y: fpv(b.focalPoint.y) } : null;
  const focal = img && fp && (fp.x !== 0.5 || fp.y !== 0.5) ? fp : null;
  const parallax = !!b.parallax && !!img;
  const attrs = {};
  if (img) { attrs.url = img.url; if (imgId(img)) attrs.id = imgId(img) }
  if (vurl) { attrs.url = vurl; attrs.backgroundType = 'video'; if (imgId(b.bgVideo)) attrs.id = imgId(b.bgVideo); }
  if (focal) attrs.focalPoint = focal;
  if (parallax) attrs.hasParallax = true;
  attrs.dimRatio = dim; attrs.customOverlayColor = overlay;
  if (grad) attrs.customGradient = grad;
  if (h) { attrs.minHeight = h; attrs.minHeightUnit = 'px'; }
  const dark = dim < 40 && (img || vurl) ? true : grad ? true : isDarkColor(overlay);
  if (!dark) attrs.isDark = false;
  const align = ALIGNS.includes(b.width) ? b.width : '';
  if (align) attrs.align = align;
  const mar = marginOf(b);
  if (mar.margin) attrs.style = { spacing: { margin: mar.margin } };
  if (img && img.alt) attrs.alt = img.alt;
  attrs.layout = { type: 'constrained' };
  const cls = ['wp-block-cover'];
  if (align) cls.push('align' + align);
  if (parallax) cls.push('has-parallax');
  if (!dark) cls.push('is-light');
  // Como el save() de core/cover: primero la foto, luego la capa de color (span) y al final el contenido
  const dimCls = ['wp-block-cover__background', 'has-background-dim'];
  if (grad) dimCls.push('has-background-gradient');
  if (dim !== 50) dimCls.push(`has-background-dim-${dim}`);
  if (img && grad && dim !== 0) dimCls.push('wp-block-cover__gradient-background');
  const pos = focal ? `${Math.round(focal.x * 100)}% ${Math.round(focal.y * 100)}%` : '';
  const wpImg = imgId(img || {}) ? ` wp-image-${imgId(img)}` : '';
  let imgTag = '';
  if (img && parallax) imgTag = `<div${img.alt ? ` role="img"` : ''} class="wp-block-cover__image-background${wpImg} has-parallax" style="background-position:${pos || '50% 50%'};background-image:url(${esc(img.url)})"${img.alt ? ` aria-label="${esc(img.alt)}"` : ''}></div>`;
  else if (img) imgTag = `<img class="wp-block-cover__image-background${wpImg}" alt="${esc(img.alt || '')}" src="${esc(img.url)}"${pos ? ` style="object-position:${pos}"` : ''}/>`;
  const style = [h ? `min-height:${h}px` : '', ...mar.css].filter(Boolean).join(';');
  const veil = `background-color:${overlay}${grad ? ';background:' + grad : ''}`;
  if (vurl) imgTag = `<video class="wp-block-cover__video-background intrinsic-ignore" autoplay muted loop playsinline src="${esc(vurl)}" data-object-fit="cover"></video>`;
  return `<!-- wp:cover ${JSON.stringify(attrs)} -->\n<div class="${cls.join(' ')}"${style ? ` style="${style}"` : ''}>${imgTag}<span aria-hidden="true" class="${dimCls.join(' ')}" style="${veil}"></span><div class="wp-block-cover__inner-container">${inner ? '\n' + inner + '\n' : ''}</div></div>\n<!-- /wp:cover -->`;
}

// Mapa: una dirección en un mapa de Google incrustado (bloque HTML), con alto y esquinas redondeadas
function mapBlock(b) {
  const address = String(b.address || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!address) return '';
  const h = px(b.height || 360, 800) || 360, rad = px(has(b.radius) ? b.radius : 16, 40);
  return `<!-- wp:html -->\n<div class="ecos-mapa" style="border-radius:${rad}px;overflow:hidden;line-height:0"><iframe src="${esc(DK.mapUrl(address))}" width="100%" height="${h}" style="border:0;display:block" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${esc(address)}" allowfullscreen></iframe></div>\n<!-- /wp:html -->`;
}

// Mosaico: fotos de distintos tamaños encajadas en una rejilla (la primera grande). Bloque HTML, como el carrusel.
// Mosaico que se adapta al número de piezas (fotos y vídeos): ver renderer/mosaic.js
const { mosaicLayout } = require('../renderer/mosaic');
const MOS_H = 150, MOS_GAP = 8;
// Foto o vídeo dentro de un mosaico o galería en HTML (los vídeos van en bucle y sin sonido, como en Instagram)
function mediaTag(i, style, { controls = false } = {}) {
  if (i.type === 'video') {
    return `<video src="${esc(i.url)}"${i.poster ? ` poster="${esc(i.poster)}"` : ''}${Number(i.id) ? ` data-id="${i.id}"` : ''} ${controls ? 'controls ' : 'autoplay loop '}muted playsinline preload="metadata" style="${style}"></video>`;
  }
  return `<img src="${esc(i.url)}" alt="${esc(i.alt || '')}" loading="lazy"${Number(i.id) ? ` class="wp-image-${i.id}"` : ''} style="${style}"/>`;
}
// Foto que abre su versión completa al pulsarla (los vídeos tienen sus propios controles)
const zoomLink = (i, tag) => (i.type === 'video' ? tag : `<a href="${esc(i.url)}" class="ec-zoom" style="display:block;width:100%;height:100%">${tag}</a>`);
function mosaicBlock(b) {
  const id = 'ecos-m-' + b.id.replace(/[^a-z0-9]/gi, '');
  const S = `#${id}`;
  const { cells } = mosaicLayout(b.images.length);
  const hgt = (r, h) => r * h + (r - 1) * MOS_GAP;
  const css = `${S} figure{transition:box-shadow .3s}${S} img,${S} video{transition:transform .5s cubic-bezier(.2,0,0,1)}${S} figure:hover img,${S} figure:hover video{transform:scale(1.04)}`
    + `@media (max-width:600px){${S}{grid-auto-rows:90px!important}${S} .r1{height:90px!important}${S} .r2{height:${hgt(2, 90)}px!important}}`;
  const media = 'display:block;width:100%;height:100%;object-fit:cover;margin:0';
  const figs = b.images.map((i, k) => {
    const c = cells[k];
    return `<figure class="r${c.rows}" style="margin:0;overflow:hidden;border-radius:12px;background-color:#ddd;grid-column-start:${c.col};grid-column-end:span ${c.cols};grid-row-start:${c.row};grid-row-end:span ${c.rows};height:${hgt(c.rows, MOS_H)}px">`
      + zoomLink(i, mediaTag(i, media)) + '</figure>';
  }).join('');
  return `<!-- wp:html -->\n<div class="ecos-mosaico" id="${id}" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));grid-auto-rows:${MOS_H}px;gap:${MOS_GAP}px;margin:2em 0"><style>${css}</style>${figs}</div>\n<!-- /wp:html -->`;
}
// Galería en cuadrícula con vídeos (la galería de WordPress solo admite fotos)
function mixedGalleryBlock(b, cols) {
  const id = 'ecos-g-' + b.id.replace(/[^a-z0-9]/gi, '');
  const css = `@media (max-width:600px){#${id}{grid-template-columns:repeat(2,minmax(0,1fr))!important}#${id} figure{height:160px!important}}`;
  const media = 'display:block;width:100%;height:100%;object-fit:cover;margin:0';
  const figs = b.images.map((i) => `<figure style="margin:0;overflow:hidden;border-radius:10px;background-color:#ddd;height:${cols >= 4 ? 170 : 230}px">${zoomLink(i, mediaTag(i, media, { controls: true }))}</figure>`).join('');
  return `<!-- wp:html -->\n<div class="ecos-galeria" id="${id}" data-cols="${cols}" style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:8px;margin:2em 0"><style>${css}</style>${figs}</div>\n<!-- /wp:html -->`;
}

function composeBlocks(blocks, opts = {}) {
  const all = flatBlocks(blocks);
  const ctx = { anchors: headingAnchors(all), all, fx: new Set() };
  const html = composeList(blocks, opts, ctx);
  // efectos propios (sombra de texto, zoom, blanco y negro): su CSS mínimo va en un bloque HTML al final
  const withFx = ctx.fx.size ? (html ? html + '\n\n' : '') + fxBlock(ctx.fx, !!opts.helper) : html;
  // «Fondo de la página» (opts.pageBg): su bloque con el CSS va al final; sin pageBg no cambia nada
  const bg = opts.pageBg ? require('../renderer/pagebg').block(opts.pageBg) : '';
  return bg ? (withFx ? withFx + '\n\n' : '') + bg : withFx;
}

// Corte tras una foto colocada a un lado (lo que sigue empieza por debajo de ella, como en el editor de Ecos)
const CLEAR_BLOCK = '<!-- wp:html -->\n<div class="ecos-clear" style="clear:both"></div>\n<!-- /wp:html -->';
const WRAPS = new Set(['paragraph', 'heading', 'list', 'quote']); // lo que puede ir al lado de la foto
function composeList(blocks, opts, ctx) {
  const out = [];
  const anchors = ctx.anchors;
  let floating = false;
  for (const b of blocks || []) {
    // un bloque que no rodea la foto (o un título, que empieza apartado nuevo): primero el corte
    if (floating && (!WRAPS.has(b.type) || b.type === 'heading')) { out.push(CLEAR_BLOCK); floating = false; }
    if (b.type === 'image' && b.img && (b.align === 'left' || b.align === 'right')) floating = true;
    const first = out.length;
    switch (b.type) {
      case 'paragraph': {
        const st = blockStyle(b, { dropCap: true, fx: ctx.fx });
        for (const p of sanitizeParagraphs(b.html)) out.push(`<!-- wp:paragraph${st.json} -->\n<p${st.cls ? ` class="${st.cls.trim()}"` : ''}${st.style}>${p}</p>\n<!-- /wp:paragraph -->`);
        break;
      }
      case 'heading': {
        const l = [2, 3, 4, 5].includes(b.level) ? b.level : 2;
        if (!inline(b.html)) break;
        const st = blockStyle(b, { alignKey: 'textAlign', fx: ctx.fx });
        const attrs = { ...(l === 2 ? {} : { level: l }), ...st.attrs };
        const id = anchors.get(b.id);
        out.push(`<!-- wp:heading${Object.keys(attrs).length ? ' ' + JSON.stringify(attrs) : ''} -->\n<h${l} class="wp-block-heading${st.cls}"${id ? ` id="${id}"` : ''}${st.style}>${inline(b.html)}</h${l}>\n<!-- /wp:heading -->`);
        break;
      }
      case 'quote': {
        if (!inline(b.html)) break;
        const cite = b.cite && inline(b.cite) ? `<cite>${inline(b.cite)}</cite>` : '';
        const st = blockStyle(b, { align: false });
        if (b.pull) { // cita destacada (centrada y grande)
          out.push(`<!-- wp:pullquote${st.json} -->\n<figure class="wp-block-pullquote${st.cls}"${st.style}><blockquote><p>${sanitizeParagraphs(b.html).join('<br>')}</p>${cite}</blockquote></figure>\n<!-- /wp:pullquote -->`);
        } else {
          out.push(`<!-- wp:quote${st.json} -->\n<blockquote class="wp-block-quote${st.cls}"${st.style}>${sanitizeParagraphs(b.html).map(para).join('\n')}${cite}</blockquote>\n<!-- /wp:quote -->`);
        }
        break;
      }
      case 'list': {
        // con iconos: cada elemento lleva delante su símbolo (clase ecos-iconos; su CSS va en el bloque de efectos)
        const iconic = Array.isArray(b.icons);
        const items = (b.items || []).map((x, k) => ({ html: inline(x), ico: iconic ? DK.safeIcon(b.icons[k]) : '' })).filter((x) => x.html);
        if (!items.length) break;
        const tag = b.ordered && !iconic ? 'ol' : 'ul';
        const st = blockStyle(b, { align: false });
        const attrs = { ...(b.ordered && !iconic ? { ordered: true } : {}), ...st.attrs };
        let cls = st.cls;
        if (iconic) { attrs.className = [attrs.className, 'ecos-iconos'].filter(Boolean).join(' '); cls += ' ecos-iconos'; ctx.fx.add('iconos'); }
        const li = (x) => `<li>${x.ico ? `<span class="ecos-ico" aria-hidden="true">${esc(x.ico)}</span> ` : ''}${x.html}</li>`;
        out.push(`<!-- wp:list${Object.keys(attrs).length ? ' ' + JSON.stringify(attrs) : ''} -->\n<${tag} class="wp-block-list${cls}"${st.style}>${items.map((x) => `<!-- wp:list-item -->\n${li(x)}\n<!-- /wp:list-item -->`).join('\n')}</${tag}>\n<!-- /wp:list -->`);
        break;
      }
      case 'table': out.push(tableBlock(b)); break;
      case 'buttons': out.push(buttonsBlock(b)); break;
      case 'spacer': { const h = Math.max(8, Math.min(200, Number(b.height) || 40)); out.push(`<!-- wp:spacer {"height":"${h}px"} -->\n<div style="height:${h}px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`); break; }
      case 'details': {
        if (!inline(b.summary || '')) break;
        out.push(`<!-- wp:details -->\n<details class="wp-block-details"><summary>${inline(b.summary)}</summary>${sanitizeParagraphs(b.html).map(para).join('\n')}</details>\n<!-- /wp:details -->`);
        break;
      }
      case 'map': { const m = mapBlock(b); if (m) out.push(m); break; }
      case 'toc': {
        const items = ctx.all.filter((h) => h.type === 'heading' && anchors.has(h.id) && (h.level || 2) <= 3);
        if (!items.length) break;
        const head = b.title && inline(b.title) ? `<!-- wp:paragraph -->\n<p><strong>${inline(b.title)}</strong></p>\n<!-- /wp:paragraph -->\n\n` : '';
        out.push(head + `<!-- wp:list -->\n<ul class="wp-block-list">${items.map((h) => `<!-- wp:list-item -->\n<li><a href="#${anchors.get(h.id)}">${inline(h.html).replace(/<[^>]+>/g, '')}</a></li>\n<!-- /wp:list-item -->`).join('\n')}</ul>\n<!-- /wp:list -->`);
        break;
      }
      case 'image': if (b.img) out.push(imageBlockFull(b.img, b.caption, { align: b.align, width: b.width, w: b.w, ratio: b.ratio, frame: b.frame, frameColor: b.frameColor, fx: b.fx }, ctx.fx)); break;
      case 'group': out.push(groupBlock(b, opts, ctx)); break;
      case 'columns': { const c = columnsBlock(b, opts, ctx); if (c) out.push(c); break; }
      case 'cover': out.push(coverBlock(b, opts, ctx)); break;
      case 'gallery': {
        if (!b.images?.length) break;
        if (b.layout === 'mosaic' && b.images.length > 1) { out.push(mosaicBlock(b)); break; }
        if (b.images.length === 1) { out.push(b.images[0].type === 'video' ? videoBlock(b.images[0]) : imageBlockFull(b.images[0])); break; }
        const cols = Math.max(1, Math.min(6, b.columns || 3));
        if (b.images.some((i) => i.type === 'video')) { out.push(mixedGalleryBlock(b, cols)); break; }
        out.push(`<!-- wp:gallery {"columns":${cols},"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images columns-${cols} is-cropped">\n${b.images.map((i) => imageBlockFull(i)).join('\n')}\n</figure>\n<!-- /wp:gallery -->`);
        break;
      }
      case 'carousel': {
        const c = { ...b, images: (b.images || []).filter((i) => i && i.url) };
        // Spectra solo muestra fotos: con algún vídeo, el carrusel HTML propio (que admite los dos)
        if (c.images.length) out.push(opts.spectra && !c.images.some((i) => i.type === 'video') ? spectraCarouselBlock(c, ctx.fx) : carouselBlock(c, !!opts.helper));
        break;
      }
      case 'mediatext': { if (b.img) out.push(mediaTextBlock(b, ctx.fx)); break; }
      case 'video': if (b.video) out.push(videoBlock(b.video, b.caption, { align: b.align, width: b.width, ratio: b.ratio, frame: b.frame, fx: b.fx }, ctx.fx)); break;
      case 'embed': if (b.url) out.push(b.provider === 'instagram' || b.provider === 'facebook' || !b.provider ? embedBlock(b.url, b.provider || 'instagram') : embedFull(b)); break;
      case 'raw': if (b.markup) out.push(b.markup); break; // bloque de WordPress que Ecos conserva sin tocar
      case 'separator': out.push('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->'); break;
      // «Más bloques»: cada uno sale como bloques estándar de WordPress con clases ecos-* (renderer/moreblocks.js)
      case 'tabs': case 'timeline': case 'figures': case 'testimonials': case 'cards': case 'cta': case 'donate': case 'event':
      case 'audio': case 'pdf': case 'hotspots': case 'compare': case 'faq': {
        const m = More.compose(b, moreEnv(opts, ctx));
        if (m) out.push(m);
        break;
      }
      default: break;
    }
    // diseño universal (espaciado, bordes, fondo, dispositivos, animación, tipografía): sobre el bloque ya escrito
    if (b.type !== 'raw' && Design.hasDesign(b)) for (let k = first; k < out.length; k++) out[k] = Design.decorate(out[k], b, (key) => ctx.fx.add(key));
  }
  if (floating) out.push(CLEAR_BLOCK);
  return out.join('\n\n');
}

// Herramientas que usa renderer/moreblocks.js para escribir cada bloque (sin repetir lo que ya hay aquí)
function moreEnv(opts, ctx) {
  return {
    esc, inline, sanitize: sanitizeParagraphs, embedFull, buttonsBlock, mapBlock,
    imageBlock: (img, cap, place) => imageBlockFull(img, cap, place, ctx.fx),
    groupBlock: (g) => groupBlock(g, opts, ctx),
    composeList: (list) => composeList(list, opts, ctx),
    fx: (k) => ctx.fx.add(k),
  };
}

// Todas las imágenes de los bloques (para el texto alternativo y la imagen destacada)
const blockImages = (blocks) => flatBlocks(blocks).flatMap((b) => (b.img ? [b.img] : b.images || [])).filter((i) => i && i.type !== 'video');

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

// Junta la misma publicación hecha en Instagram y en Facebook. Al compartir de una red a otra el texto
// suele cambiar algo (menciones «@cuenta» que pasan a nombres, hashtags quitados, texto recortado, saltos
// de línea, enlaces), así que no se exige el texto idéntico: se puntúa cada pareja Instagram–Facebook por
// parecido del texto, cercanía en el tiempo y (si se conocen) huellas de la primera foto, y se emparejan
// de una en una, de la más segura a la menos.
const DUP_WINDOW = 3 * 864e5;
function dupWords(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/https?:\/\/\S+/g, ' ').replace(/[#@][\p{L}\p{N}_.]+/gu, ' ')
    .split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
}
// Parecido de dos textos: palabras comunes / palabras del más corto (aguanta que uno esté recortado)
const wordCache = new Map();
const wordSet = (t) => { const k = String(t || ''); let v = wordCache.get(k); if (!v) { if (wordCache.size > 5000) wordCache.clear(); v = new Set(dupWords(k)); wordCache.set(k, v); } return v; };
function textOverlap(a, b) {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size || !B.size) return { sim: 0, n: Math.min(A.size, B.size) };
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return { sim: common / Math.min(A.size, B.size), n: Math.min(A.size, B.size) };
}
// hashes: Map(url → huella dHash) de la primera foto (opcional)
function dupScore(p, q, hashes) {
  const dt = Math.abs(new Date(p.date) - new Date(q.date));
  if (!(dt <= DUP_WINDOW)) return 0;
  const ka = norm(p.text), kb = norm(q.text); // eslint-disable-line
  if (ka.length >= 20 && ka === kb) return 1;
  const close = dt < 2 * 3600e3, near = dt < 12 * 3600e3;
  let score = 0;
  const { sim, n } = textOverlap(p.text, q.text);
  if (n >= 4) {
    if (sim >= 0.6) score = sim;
    else if (sim >= 0.4 && near) score = sim + 0.25;
  } else if (n > 0) {
    if (sim >= 0.99 && near) score = 0.8; // textos muy cortos: solo si coinciden del todo y son del mismo día
  } else if (!dupWords(p.text).length && !dupWords(q.text).length && close && p.media.length === q.media.length) score = 0.65; // solo fotos
  const ha = hashes?.get(firstImageUrl(p)), hb = hashes?.get(firstImageUrl(q));
  if (ha && hb) {
    const d = require('./dupes').hamming(ha, hb);
    if (d <= 8) score = Math.max(score, near ? 0.95 : 0.85);
    else if (d > 20 && score < 0.9) score -= 0.3; // fotos claramente distintas: se desconfía del parecido del texto
  }
  return score >= 0.6 ? Math.min(score, 1) : 0;
}
const firstImageUrl = (p) => (p.media || []).find((m) => m.url)?.url || '';
// Parejas Instagram–Facebook candidatas a ser la misma publicación (para pedir sus huellas de foto)
function dupCandidates(posts, max = 120) {
  const ig = posts.filter((p) => p.source === 'instagram'), fb = posts.filter((p) => p.source === 'facebook');
  const out = [];
  for (const a of ig) for (const b of fb) {
    if (Math.abs(new Date(a.date) - new Date(b.date)) <= DUP_WINDOW && firstImageUrl(a) && firstImageUrl(b)) out.push([a, b]);
    if (out.length >= max) return out;
  }
  return out;
}
function mergeDuplicates(posts, { hashes } = {}) {
  const list = posts.map((p) => ({ ...p }));
  const idx = list.map((_, i) => i).filter((i) => !(list[i].alsoOn || []).length);
  // solo se comparan las que están a menos de 3 días (ordenadas por fecha)
  const t = (i) => new Date(list[i].date).getTime() || 0;
  idx.sort((x, y) => t(x) - t(y));
  const pairs = [];
  for (let x = 0; x < idx.length; x++) {
    for (let y = x + 1; y < idx.length && t(idx[y]) - t(idx[x]) <= DUP_WINDOW; y++) {
      const i = Math.min(idx[x], idx[y]), j = Math.max(idx[x], idx[y]);
      if (list[i].source === list[j].source) continue;
      const s = dupScore(list[i], list[j], hashes);
      if (s) pairs.push([s, i, j]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0] || Math.abs(new Date(list[a[1]].date) - new Date(list[a[2]].date)) - Math.abs(new Date(list[b[1]].date) - new Date(list[b[2]].date)));
  const used = new Set(), drop = new Set();
  for (const [, i, j] of pairs) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i); used.add(j);
    const p = list[i], q = list[j];
    const pBetter = p.media.length > q.media.length || (p.media.length === q.media.length && p.source === 'instagram');
    const [main, other] = pBetter ? [p, q] : [q, p];
    const merged = { ...main, alsoOn: [...(main.alsoOn || []), { source: other.source, permalink: other.permalink, id: other.id, media: other.media }] };
    // el texto más completo de los dos (Facebook a veces lo recorta y viceversa)
    if ((other.text || '').length > (main.text || '').length * 1.3) merged.text = other.text;
    list[i] = merged; drop.add(j);
  }
  return list.filter((_, k) => !drop.has(k));
}

// Claves de todas las versiones de una publicación (para marcarla como exportada)
const postKeys = (p) => [p.source + ':' + p.id, ...(p.alsoOn || []).map((a) => a.source + ':' + a.id)];

module.exports = { FX_CSS, PEEK_CSS, FONTS, FX_MARK, COL_PRESETS, GROUP_PAD, flatBlocks, VIDEO_PROVIDERS, composeBlocks, sectionsToBlocks, blockImages, buildDraft, unifyTitle, composeContent, sanitizeParagraphs, summaryTitle, extractTags, mediaKey, makeTitle, tidyTitle, mergeDuplicates, dupCandidates, dupScore, firstImageUrl, postKeys, DEFAULT_FOOTER };
