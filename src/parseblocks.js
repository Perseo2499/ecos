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
    case 'image': { const img = imgOf(h); return img ? { id: bid(), type: 'image', img, caption: inner(h, 'figcaption') } : raw(); }
    case 'gallery': {
      const images = tokenize(h).filter((x) => /(^|\/)image$/.test(x.name)).map((x) => imgOf(x.inner)).filter(Boolean);
      return images.length ? { id: bid(), type: 'gallery', images, columns: a.columns || 3 } : raw();
    }
    case 'video': { const src = attr((h.match(/<video\b[^>]*>/i) || [''])[0], 'src'); return src ? { id: bid(), type: 'video', video: { id: a.id, url: src }, caption: inner(h, 'figcaption') } : raw(); }
    case 'embed': return a.url ? { id: bid(), type: 'embed', url: a.url, provider: a.providerNameSlug || '', caption: inner(h, 'figcaption') } : raw();
    case 'separator': return { id: bid(), type: 'separator' };
    case 'spacer': return { id: bid(), type: 'spacer', height: parseInt(a.height, 10) || 40 };
    case 'table': {
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
    case 'html': {
      // carrusel y mosaico de Ecos
      if (/class="ecos-(carrusel|mosaico)"/.test(h)) {
        const images = [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => imgOf(m[0])).filter(Boolean);
        if (images.length) return /ecos-carrusel/.test(h) ? { id: bid(), type: 'carousel', images } : { id: bid(), type: 'gallery', layout: 'mosaic', images, columns: 3 };
      }
      return raw();
    }
    default: return raw();
  }
}

function parseBlocks(content) {
  return tokenize(String(content || '')).map(toBlock).filter((b) => b.type !== 'paragraph' || (b.html || '').replace(/<[^>]+>|&nbsp;|\s/g, ''));
}

module.exports = { parseBlocks, tokenize };
