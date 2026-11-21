// Lee el contenido de una entrada de WordPress (bloques de Gutenberg) y lo convierte en bloques del editor
// de Ecos, para traer al editor los cambios hechos directamente en WordPress. Lo que Ecos no sabe editar
// se conserva tal cual en un bloque «raw», que al enviar se devuelve sin tocar.
const { FONTS } = require('./transform');

const FONT_KEY = Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [v, k]));
let seq = 0;
const bid = () => 'w' + Date.now().toString(36) + (seq++).toString(36);
const decode = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const inner = (html, tag) => { const m = String(html).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')); return m ? m[1].trim() : ''; };
const all = (html, tag) => [...String(html).matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map((m) => m[1].trim());
const attr = (tagHtml, name) => { const m = String(tagHtml).match(new RegExp(`\\b${name}="([^"]*)"`, 'i')); return m ? decode(m[1]) : ''; };
const imgOf = (html) => {
  const tag = (String(html).match(/<img\b[^>]*>/i) || [''])[0];
  if (!tag) return null;
  const id = Number((tag.match(/wp-image-(\d+)/) || [])[1]) || attr(tag, 'src');
  return { id, url: attr(tag, 'src'), alt: attr(tag, 'alt') };
};

// Divide el contenido en bloques de primer nivel: [{ name, attrs, inner, raw }]
function tokenize(content) {
  const re = /<!--\s+(\/)?wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)\s*(\{[\s\S]*?\})?\s*(\/)?-->/g;
  const out = [];
  let depth = 0, start = 0, open = null, last = 0, m;
  const free = (to) => { const txt = content.slice(last, to); if (txt.trim()) out.push({ name: 'freeform', attrs: {}, inner: txt, raw: txt }); };
  while ((m = re.exec(content))) {
    const [whole, closing, name, json, selfClose] = m;
    if (!closing && selfClose) {
      if (depth === 0) { free(m.index); out.push({ name, attrs: safeJson(json), inner: '', raw: whole }); last = re.lastIndex; }
      continue;
    }
    if (!closing) {
      if (depth === 0) { free(m.index); open = { name, attrs: safeJson(json), from: re.lastIndex }; start = m.index; }
      depth++;
    } else {
      depth--;
      if (depth === 0 && open) {
        out.push({ name: open.name, attrs: open.attrs, inner: content.slice(open.from, m.index), raw: content.slice(start, re.lastIndex) });
        open = null; last = re.lastIndex;
      }
    }
  }
  free(content.length);
  return out;
}
function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

// Estilos de bloque (los mismos que escribe Ecos)
function styleFrom(a) {
  const st = a.style || {}, o = {};
  if (a.align || a.textAlign) o.align = a.align || a.textAlign;
  if (a.dropCap) o.dropCap = true;
  if (st.color?.text) o.color = st.color.text;
  if (st.color?.background) o.bg = st.color.background;
  if (st.typography?.fontSize) o.size = st.typography.fontSize;
  if (st.typography?.fontFamily && FONT_KEY[st.typography.fontFamily]) o.font = FONT_KEY[st.typography.fontFamily];
  return o;
}

function toBlock(t) {
  const n = t.name.replace(/^core\//, '');
  const a = t.attrs, h = t.inner;
  const raw = () => ({ id: bid(), type: 'raw', markup: t.raw, label: n });
  switch (n) {
    case 'paragraph': return { id: bid(), type: 'paragraph', html: inner(h, 'p'), ...styleFrom(a) };
    case 'heading': { const l = a.level || 2; return { id: bid(), type: 'heading', level: [2, 3, 4, 5].includes(l) ? l : 2, html: inner(h, 'h' + l), ...styleFrom(a) }; }
    case 'list': return { id: bid(), type: 'list', ordered: !!a.ordered, items: all(h, 'li').map((x) => x.replace(/<!--[\s\S]*?-->/g, '').trim()), ...styleFrom({ ...a, align: null }) };
    case 'quote': return { id: bid(), type: 'quote', html: all(h, 'p').join('<br>'), cite: inner(h, 'cite'), ...styleFrom({ ...a, align: null }) };
    case 'pullquote': return { id: bid(), type: 'quote', pull: true, html: all(h, 'p').join('<br>'), cite: inner(h, 'cite'), ...styleFrom({ ...a, align: null }) };
    case 'image': {
      const img = imgOf(h);
      if (!img) return raw();
      const b = { id: bid(), type: 'image', img, caption: inner(h, 'figcaption') };
      // colocada a un lado (texto alrededor) o centrada a un tamaño
      if (['left', 'right', 'center'].includes(a.align)) {
        b.align = a.align;
        const px = parseInt(a.width, 10);
        if (px) b.width = px <= 300 ? 33 : px <= 470 ? 50 : px <= 650 ? 75 : 100;
      }
      return b;
    }
    case 'gallery': {
      const images = tokenize(h).filter((x) => /(^|\/)image$/.test(x.name)).map((x) => imgOf(x.inner)).filter(Boolean);
      return images.length ? { id: bid(), type: 'gallery', images, columns: a.columns || 3 } : raw();
    }
    case 'video': { const src = attr((h.match(/<video\b[^>]*>/i) || [''])[0], 'src'); return src ? { id: bid(), type: 'video', video: { id: a.id, url: src }, caption: inner(h, 'figcaption') } : raw(); }
    case 'embed': return a.url ? { id: bid(), type: 'embed', url: a.url, provider: a.providerNameSlug || '', caption: inner(h, 'figcaption') } : raw();
    case 'separator': return { id: bid(), type: 'separator' };
    case 'spacer': return { id: bid(), type: 'spacer', height: parseInt(a.height, 10) || 40 };
    case 'table': {
      if (/<img\b/i.test(h)) return layoutTable(h);
      const rows = all(h, 'tr').map((tr) => [...tr.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1].trim()));
      return rows.length ? { id: bid(), type: 'table', rows, head: /<thead/i.test(h), stripes: /is-style-stripes/.test(a.className || ''), caption: inner(h, 'figcaption') } : raw();
    }
    case 'buttons': {
      const btns = tokenize(h).filter((x) => /(^|\/)button$/.test(x.name));
      if (btns.length !== 1) return raw();
      const link = (btns[0].inner.match(/<a\b[^>]*>[\s\S]*?<\/a>/i) || [''])[0];
      return { id: bid(), type: 'buttons', html: inner(link, 'a'), url: attr(link, 'href'), align: a.layout?.justifyContent || 'left', variant: /is-style-outline/.test(btns[0].attrs.className || '') ? 'outline' : 'fill' };
    }
    case 'details': return { id: bid(), type: 'details', summary: inner(h, 'summary'), html: all(h, 'p').map((p) => `<p>${p}</p>`).join('') };
    case 'uagb/image-gallery': {
      // galería de Spectra: en carrusel es el carrusel de Ecos; si no, una galería
      const images = (a.mediaGallery || []).filter((m) => m && m.url).map((m) => ({ id: Number(m.id) || m.url, url: m.url, alt: m.alt || '' }));
      if (!images.length) return raw();
      const view = /\becos-peek\b/.test(a.className || '') ? 'peek' : (a.columnsDesk || 1) > 1 ? 'multi' : 'single';
      return a.feedLayout === 'carousel' ? { id: bid(), type: 'carousel', images, view, ...(a.carouselSquares ? { squares: true } : {}), ...(a.carouselAutoplay === false ? { autoplay: false } : {}), ...(a.imageDisplayCaption ? { captions: true } : {}) }
        : { id: bid(), type: 'gallery', images, columns: a.columnsDesk || 3 };
    }
    case 'html': {
      // carrusel y mosaico de Ecos
      if (/class="ecos-(carrusel|mosaico|galeria)"/.test(h)) {
        // fotos y vídeos en orden (sin las imágenes de fondo desenfocado del carrusel, que repiten cada foto)
        const images = [...h.matchAll(/<(img|video)\b[^>]*>/gi)].filter((m) => !/class="ec-bg"/.test(m[0])).map((m) => {
          if (m[1].toLowerCase() !== 'video') return imgOf(m[0]);
          const url = attr(m[0], 'src');
          return url ? { type: 'video', id: Number(attr(m[0], 'data-id')) || url, url, ...(attr(m[0], 'poster') ? { poster: attr(m[0], 'poster') } : {}) } : null;
        }).filter(Boolean);
        if (images.length) {
          if (/ecos-carrusel/.test(h)) return { id: bid(), type: 'carousel', images };
          if (/ecos-galeria/.test(h)) return { id: bid(), type: 'gallery', images, columns: Number((h.match(/data-cols="(\d)"/) || [])[1]) || 3 };
          return { id: bid(), type: 'gallery', layout: 'mosaic', images, columns: 3 };
        }
      }
      return raw();
    }
    default: return raw();
  }
}

// --- Contenido «clásico» (sin bloques: editor clásico, importaciones, copias de seguridad) ------------
// Se separa en elementos de primer nivel (párrafos, títulos, listas, citas, imágenes, tablas…) y cada uno
// pasa a ser un bloque editable de Ecos. Lo que no se reconoce queda como bloque «raw» (se conserva igual).
const VIDEO_URL = /^(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|open\.spotify\.com|soundcloud\.com)\S*)$/i;
const providerOf = (u) => (u.match(/youtube|youtu\.be|vimeo|dailymotion|tiktok|spotify|soundcloud/i)?.[0] || '').toLowerCase().replace('youtu.be', 'youtube');

// Trocea el HTML en elementos de primer nivel: [{ tag, html }] (texto suelto: tag '')
function topLevel(html) {
  const out = [];
  const re = /<\/?([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;
  const VOID = /^(img|br|hr|input|source|embed)$/i;
  let depth = 0, start = 0, top = null, last = 0, m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase(), closing = m[0][1] === '/', self = m[2] === '/' || VOID.test(tag);
    if (depth === 0) {
      if (closing) continue;
      const txt = html.slice(last, m.index); if (txt.trim()) out.push({ tag: '', html: txt });
      if (self) { out.push({ tag, html: m[0] }); last = re.lastIndex; continue; }
      if (/^(a|strong|b|em|i|span|u|s|sub|sup|code|mark|small|font)$/.test(tag)) { continue; } // en línea: parte del texto
      top = tag; start = m.index; depth = 1;
      continue;
    }
    if (self) continue;
    if (tag === top) depth += closing ? -1 : 1;
    if (depth === 0) { out.push({ tag: top, html: html.slice(start, re.lastIndex) }); last = re.lastIndex; top = null; }
  }
  const rest = html.slice(depth ? start : last); if (rest.trim()) out.push({ tag: depth ? top : '', html: rest });
  // el texto suelto se une con lo que va en línea a su alrededor
  const merged = [];
  for (const x of out) {
    if (x.tag === '' && merged.length && merged[merged.length - 1].tag === '') merged[merged.length - 1].html += x.html;
    else merged.push(x);
  }
  return merged;
}

// Tablas usadas para maquetar fotos (muy habitual en entradas antiguas): una celda con la foto y otra
// con su pie. No son tablas de datos: cada foto pasa a ser un bloque de imagen con su pie, y el resto de
// texto, párrafos normales. Devuelve null si la tabla no tiene fotos (entonces es una tabla de verdad).
function layoutTable(html) {
  if (!/<img\b/i.test(html)) return null;
  const out = [];
  const plain = (h) => h.replace(/<[^>]+>|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const cells = [...String(html).matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1]);
  for (const cell of cells) {
    const imgs = (cell.match(/<img\b[^>]*>/gi) || []).map(imgOf).filter(Boolean);
    for (const img of imgs) out.push({ id: bid(), type: 'image', img, caption: '' });
    const text = cell.replace(/<a\b[^>]*>\s*(<img\b[^>]*>)\s*<\/a>/gi, '').replace(/<img\b[^>]*>/gi, '').trim();
    if (!plain(text)) continue;
    const last = out[out.length - 1];
    // texto corto justo después de una foto (o en su misma celda): es su pie
    if (last?.type === 'image' && !last.caption && plain(text).length <= 300 && !/<(p|div|h\d|ul|ol)\b[\s\S]*<(p|div|h\d|ul|ol)\b/i.test(text)) {
      last.caption = text.replace(/<\/?(p|div|span|font|center)[^>]*>/gi, ' ').replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, '').replace(/\s{2,}/g, ' ').trim();
    } else out.push(...classicBlocks(text));
  }
  return out;
}

function classicBlocks(html) {
  const blocks = [];
  const raw = (h, label = 'html') => blocks.push({ id: bid(), type: 'raw', markup: `<!-- wp:html -->\n${h.trim()}\n<!-- /wp:html -->`, label });
  const para = (h) => {
    // un enlace de vídeo solo en su línea: el vídeo
    const plain = h.replace(/<[^>]+>/g, '').trim();
    if (VIDEO_URL.test(plain)) { blocks.push({ id: bid(), type: 'embed', url: plain, provider: providerOf(plain), caption: '' }); return; }
    // imágenes dentro del párrafo: van aparte
    for (const im of h.match(/<img\b[^>]*>/gi) || []) { const img = imgOf(im); if (img) blocks.push({ id: bid(), type: 'image', img, caption: '' }); }
    const text = h.replace(/<a\b[^>]*>\s*(<img\b[^>]*>)\s*<\/a>/gi, '').replace(/<img\b[^>]*>/gi, '').trim();
    if (text.replace(/<[^>]+>|&nbsp;|\s/g, '')) blocks.push({ id: bid(), type: 'paragraph', html: text.replace(/^<br\s*\/?>|<br\s*\/?>$/gi, '') });
  };
  for (const el of topLevel(String(html))) {
    const inner = el.html.replace(/^<[^>]+>|<\/[a-z0-9]+>$/gi, '');
    const align = (el.html.match(/text-align:\s*(center|right|justify)/i) || [])[1];
    switch (el.tag) {
      case '':
        for (const ptxt of el.html.split(/\n\s*\n/)) if (ptxt.trim()) para(ptxt.trim().replace(/\n/g, '<br>'));
        break;
      case 'p': case 'div': case 'span': case 'center': {
        if (el.tag === 'div' && /<(p|h[1-6]|ul|ol|table|blockquote)\b/i.test(inner)) { classicBlocks(inner).forEach((b) => blocks.push(b)); break; }
        const n = blocks.length; para(inner);
        if (align) for (const b of blocks.slice(n)) if (b.type === 'paragraph') b.align = align;
        break;
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const l = Math.min(5, Math.max(2, Number(el.tag[1])));
        if (inner.replace(/<[^>]+>|\s/g, '')) blocks.push({ id: bid(), type: 'heading', level: l, html: inner.replace(/<\/?(h\d|span)[^>]*>/gi, ''), ...(align ? { align } : {}) });
        break;
      }
      case 'ul': case 'ol': blocks.push({ id: bid(), type: 'list', ordered: el.tag === 'ol', items: all(el.html, 'li').map((x) => x.replace(/<\/?(p|ul|ol)[^>]*>/gi, ' ').trim()).filter(Boolean) }); break;
      case 'blockquote': blocks.push({ id: bid(), type: 'quote', html: (all(inner, 'p').join('<br>') || inner).trim(), cite: inner.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i)?.[1] || '' }); break;
      case 'img': { const img = imgOf(el.html); if (img) blocks.push({ id: bid(), type: 'image', img, caption: '' }); break; }
      case 'a': case 'figure': {
        const imgs = (el.html.match(/<img\b[^>]*>/gi) || []).map(imgOf).filter(Boolean);
        if (imgs.length === 1) blocks.push({ id: bid(), type: 'image', img: imgs[0], caption: (el.html.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i) || [])[1] || '' });
        else if (imgs.length > 1) {
          // fotos con su propio pie: una imagen con su pie cada una (la galería no guarda pies)
          const figs = [...el.html.matchAll(/<figure\b[^>]*>\s*(<img\b[^>]*>)\s*(?:<figcaption[^>]*>([\s\S]*?)<\/figcaption>)?\s*<\/figure>/gi)];
          if (figs.some((f) => f[2])) for (const f of figs) { const img = imgOf(f[1]); if (img) blocks.push({ id: bid(), type: 'image', img, caption: (f[2] || '').trim() }); }
          else blocks.push({ id: bid(), type: 'gallery', images: imgs, columns: 3 });
        }
        else if (el.tag === 'a') para(el.html); else raw(el.html);
        break;
      }
      case 'hr': blocks.push({ id: bid(), type: 'separator' }); break;
      case 'iframe': {
        const src = attr(el.html, 'src');
        const yt = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/);
        if (yt) blocks.push({ id: bid(), type: 'embed', url: `https://www.youtube.com/watch?v=${yt[1]}`, provider: 'youtube', caption: '' });
        else raw(el.html, 'iframe');
        break;
      }
      case 'br': break;
      case 'table': {
        const lay = layoutTable(el.html);
        if (lay) { blocks.push(...lay); break; }
        const rows = all(el.html, 'tr').map((tr) => [...tr.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1].trim()));
        if (rows.length && rows.every((r) => r.length)) blocks.push({ id: bid(), type: 'table', rows, head: /<th\b/i.test(el.html), stripes: false, caption: '' });
        else raw(el.html, 'table');
        break;
      }
      default: raw(el.html, el.tag);
    }
  }
  return blocks;
}

function parseBlocks(content) {
  const out = [];
  for (const t of tokenize(String(content || ''))) {
    if (t.name === 'freeform') out.push(...classicBlocks(t.inner)); else { const b = toBlock(t); if (Array.isArray(b)) out.push(...b); else out.push(b); }
  }
  return out.filter((b) => b.type !== 'paragraph' || (b.html || '').replace(/<[^>]+>|&nbsp;|\s/g, ''));
}

module.exports = { parseBlocks, tokenize, classicBlocks };
