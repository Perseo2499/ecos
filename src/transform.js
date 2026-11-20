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

function videoBlock(v, cap = '') {
  const c = cap && sanitizeParagraphs(cap).join('<br>');
  return `<!-- wp:video${v.id ? ` {"id":${v.id}}` : ''} -->\n<figure class="wp-block-video"><video controls preload="metadata" src="${esc(v.url)}"></video>${c ? `<figcaption class="wp-element-caption">${c}</figcaption>` : ''}</figure>\n<!-- /wp:video -->`;
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
    .replace(/<(\/?)(i|em)\b[^>]*>/gi, '<$1em>')
    .replace(/<(\/?)(s|strike|del)\b[^>]*>/gi, '<$1s>')
    .replace(/<(\/?)(u|code|sub|sup)\b[^>]*>/gi, '<$1$2>');
  // Enlaces: solo href http(s), mailto, tel o un ancla de la propia entrada
  h = h.replace(/<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>/gi, (_m, href) => (/^(https?:|mailto:|tel:|#[\w-]+$)/i.test(href) ? `<a href="${esc(href.replace(/&amp;/g, '&'))}">` : '<a>'));
  // Color y resaltado del texto (formato «has-inline-color» de WordPress)
  h = h.replace(/<mark\b[^>]*>/gi, (m) => {
    const st = (m.match(/style\s*=\s*"([^"]*)"/i) || [])[1] || '';
    const val = (k) => { const v = (st.match(new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*([^;]+)', 'i')) || [])[1]?.trim(); return v && SAFE_COLOR.test(v) ? v : ''; };
    const bg = val('background-color'), fg = val('color');
    return `<mark style="background-color:${bg || 'rgba(0, 0, 0, 0)'}${fg ? ';color:' + fg : ''}" class="has-inline-color">`;
  });
  h = h.replace(/<(?!\/?(strong|em|a|s|u|code|sub|sup|mark)\b)[^>]*>/gi, ''); // el resto de etiquetas fuera
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
  return {
    title, tags, sections, blocks: sectionsToBlocks(sections), featuredImageId: firstImg?.id,
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

function imageBlockFull(img, cap = '') {
  const alt = img.alt ? ` alt="${esc(img.alt)}"` : ' alt=""';
  return `<!-- wp:image {"id":${img.id},"sizeSlug":"large","linkDestination":"none"} -->\n<figure class="wp-block-image size-large"><img src="${esc(img.url)}"${alt} class="wp-image-${img.id}"/>${caption(cap)}</figure>\n<!-- /wp:image -->`;
}

// Carrusel sin JavaScript (desplazamiento con «scroll-snap»): se ve igual en cualquier tema.
// Usa un bloque HTML, que WordPress conserva si el usuario puede publicar HTML (administradores).
function carouselBlock(b) {
  const id = 'ecos-c-' + b.id.replace(/[^a-z0-9]/gi, '');
  const css = `#${id}{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px;margin:1.5em 0}`
    + `#${id} figure{flex:0 0 88%;margin:0;scroll-snap-align:center}`
    + `#${id} img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:14px;display:block}`
    + `#${id} figcaption{font-size:.85em;opacity:.75;margin-top:6px}`;
  const figs = b.images.map((i) => `<figure><img src="${esc(i.url)}" alt="${esc(i.alt || '')}" loading="lazy"/></figure>`).join('');
  return `<!-- wp:html -->\n<div class="ecos-carrusel" id="${id}"><style>${css}</style>${figs}</div>\n<!-- /wp:html -->`;
}

// Estilos de bloque (alineación, tamaño, fuente, colores) con los atributos estándar de WordPress
const FONTS = {
  serif: 'Georgia, Times New Roman, serif', sans: 'Helvetica Neue, Arial, sans-serif', round: 'Trebuchet MS, Segoe UI, sans-serif',
  mono: 'Courier New, monospace', hand: 'Segoe Print, Comic Sans MS, cursive',
};
function blockStyle(b, { alignKey = 'align', align = true, dropCap = false } = {}) {
  const attrs = {}, cls = [], css = [];
  if (align && ['center', 'right', 'justify'].includes(b.align)) { attrs[alignKey] = b.align; cls.push('has-text-align-' + b.align); }
  if (dropCap && b.dropCap) { attrs.dropCap = true; cls.push('has-drop-cap'); }
  const st = {};
  const color = SAFE_COLOR.test(b.color || '') && b.color, bg = SAFE_COLOR.test(b.bg || '') && b.bg;
  if (color || bg) {
    st.color = {};
    if (color) { st.color.text = color; cls.push('has-text-color'); css.push('color:' + color); }
    if (bg) { st.color.background = bg; cls.push('has-background'); css.push('background-color:' + bg); }
  }
  const size = /^\d{1,3}px$/.test(b.size || '') && b.size, font = FONTS[b.font];
  if (size || font) {
    st.typography = {};
    if (font) { st.typography.fontFamily = font; css.push('font-family:' + font); }
    if (size) { st.typography.fontSize = size; css.push('font-size:' + size); }
  }
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

function buttonsBlock(b) {
  const text = inline(b.html || '');
  if (!text) return '';
  const href = /^(https?:|mailto:|tel:|#)/i.test(b.url || '') ? ` href="${esc(b.url)}"` : '';
  const just = ['center', 'right'].includes(b.align) ? { layout: { type: 'flex', justifyContent: b.align } } : null;
  const outline = b.variant === 'outline';
  return `<!-- wp:buttons${just ? ' ' + JSON.stringify(just) : ''} -->\n<div class="wp-block-buttons"><!-- wp:button${outline ? ' {"className":"is-style-outline"}' : ''} -->\n<div class="wp-block-button${outline ? ' is-style-outline' : ''}"><a class="wp-block-button__link wp-element-button"${href}>${text}</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->`;
}

function composeBlocks(blocks) {
  const out = [];
  const anchors = headingAnchors(blocks);
  for (const b of blocks) {
    switch (b.type) {
      case 'paragraph': {
        const st = blockStyle(b, { dropCap: true });
        for (const p of sanitizeParagraphs(b.html)) out.push(`<!-- wp:paragraph${st.json} -->\n<p${st.cls ? ` class="${st.cls.trim()}"` : ''}${st.style}>${p}</p>\n<!-- /wp:paragraph -->`);
        break;
      }
      case 'heading': {
        const l = [2, 3, 4, 5].includes(b.level) ? b.level : 2;
        if (!inline(b.html)) break;
        const st = blockStyle(b, { alignKey: 'textAlign' });
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
        const items = (b.items || []).map(inline).filter(Boolean);
        if (!items.length) break;
        const tag = b.ordered ? 'ol' : 'ul';
        const st = blockStyle(b, { align: false });
        const attrs = { ...(b.ordered ? { ordered: true } : {}), ...st.attrs };
        out.push(`<!-- wp:list${Object.keys(attrs).length ? ' ' + JSON.stringify(attrs) : ''} -->\n<${tag} class="wp-block-list${st.cls}"${st.style}>${items.map((i) => `<!-- wp:list-item -->\n<li>${i}</li>\n<!-- /wp:list-item -->`).join('\n')}</${tag}>\n<!-- /wp:list -->`);
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
      case 'toc': {
        const items = blocks.filter((h) => h.type === 'heading' && anchors.has(h.id) && (h.level || 2) <= 3);
        if (!items.length) break;
        const head = b.title && inline(b.title) ? `<!-- wp:paragraph -->\n<p><strong>${inline(b.title)}</strong></p>\n<!-- /wp:paragraph -->\n\n` : '';
        out.push(head + `<!-- wp:list -->\n<ul class="wp-block-list">${items.map((h) => `<!-- wp:list-item -->\n<li><a href="#${anchors.get(h.id)}">${inline(h.html).replace(/<[^>]+>/g, '')}</a></li>\n<!-- /wp:list-item -->`).join('\n')}</ul>\n<!-- /wp:list -->`);
        break;
      }
      case 'image': if (b.img) out.push(imageBlockFull(b.img, b.caption)); break;
      case 'gallery': {
        if (!b.images?.length) break;
        if (b.images.length === 1) { out.push(imageBlockFull(b.images[0])); break; }
        const cols = Math.max(1, Math.min(6, b.columns || 3));
        out.push(`<!-- wp:gallery {"columns":${cols},"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images columns-${cols} is-cropped">\n${b.images.map((i) => imageBlockFull(i)).join('\n')}\n</figure>\n<!-- /wp:gallery -->`);
        break;
      }
      case 'carousel': if (b.images?.length) out.push(carouselBlock(b)); break;
      case 'mediatext': {
        if (!b.img) break;
        const right = b.right ? ' has-media-on-the-right' : '';
        const text = sanitizeParagraphs(b.html).map(para).join('\n');
        out.push(`<!-- wp:media-text {${b.right ? '"mediaPosition":"right",' : ''}"mediaId":${b.img.id},"mediaLink":"${esc(b.img.url)}","mediaType":"image"} -->\n<div class="wp-block-media-text${right} is-stacked-on-mobile"><figure class="wp-block-media-text__media"><img src="${esc(b.img.url)}" alt="${esc(b.img.alt || '')}" class="wp-image-${b.img.id} size-full"/></figure><div class="wp-block-media-text__content">${text}</div></div>\n<!-- /wp:media-text -->`);
        break;
      }
      case 'video': if (b.video) out.push(videoBlock(b.video, b.caption)); break;
      case 'embed': if (b.url) out.push(b.provider === 'instagram' || b.provider === 'facebook' || !b.provider ? embedBlock(b.url, b.provider || 'instagram') : embedFull(b)); break;
      case 'separator': out.push('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->'); break;
      default: break;
    }
  }
  return out.join('\n\n');
}

// Todas las imágenes de los bloques (para el texto alternativo y la imagen destacada)
const blockImages = (blocks) => blocks.flatMap((b) => (b.img ? [b.img] : b.images || []));

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

module.exports = { FONTS, VIDEO_PROVIDERS, composeBlocks, sectionsToBlocks, blockImages, buildDraft, composeContent, sanitizeParagraphs, summaryTitle, extractTags, mediaKey, makeTitle, tidyTitle, mergeDuplicates, postKeys, DEFAULT_FOOTER };
