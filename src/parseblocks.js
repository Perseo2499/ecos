// Lee el contenido de una entrada de WordPress (bloques de Gutenberg) y lo convierte en bloques del editor
// de Ecos, para traer al editor los cambios hechos directamente en WordPress. Lo que Ecos no sabe editar
// se conserva tal cual en un bloque «raw», que al enviar se devuelve sin tocar.
const { FONTS, FX_MARK } = require('./transform');
const PageBg = require('../renderer/pagebg');
const DK = require('../renderer/sections');
const Design = require('../renderer/design');

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
  if (st.color?.gradient && DK.safeGradient(st.color.gradient)) o.gradient = st.color.gradient;
  if (st.typography?.lineHeight && Design.LH.includes(String(st.typography.lineHeight))) o.lh = String(st.typography.lineHeight);
  if (Design.TT.includes(st.typography?.textTransform)) o.tt = st.typography.textTransform;
  if (st.typography?.fontSize) o.size = st.typography.fontSize;
  if (st.typography?.fontFamily && FONT_KEY[st.typography.fontFamily]) o.font = FONT_KEY[st.typography.fontFamily];
  if (st.typography?.letterSpacing && /^\d{1,2}(\.\d)?px$/.test(st.typography.letterSpacing)) o.spacing = st.typography.letterSpacing;
  if (/(^|\s)ecos-sombra(\s|$)/.test(a.className || '')) o.shadow = true;
  if (/(^|\s)ecos-justify(\s|$)/.test(a.className || '')) o.align = 'justify';
  return o;
}

// Opciones del carrusel que Ecos escribe como clases ecos-* en la galería de Spectra
function carouselOptsFrom(cn) {
  const o = {};
  for (const c of cn) {
    let m;
    if ((m = c.match(/^cz-(s|m|l|xl)$/))) o.size = m[1];
    else if ((m = c.match(/^cr-(1|4-3|3-2|16-9|3-4)$/))) o.ratio = m[1].replace('-', '/');
    else if (c === 'cc-round') o.corners = 'round';
    else if (c === 'cc-sq') o.corners = 'square';
    else if (c === 'cs-on') o.shadow = 'on';
    else if (c === 'cs-off') o.shadow = 'off';
    else if ((m = c.match(/^cg-(0|s|l)$/))) o.gap = m[1];
  }
  return o;
}

// Diseño universal: bloques que Ecos escribe con clases y atributos de diseño (ver renderer/design.js)
const DESIGN_NAMES = new Set(['paragraph', 'heading', 'list', 'quote', 'pullquote', 'image', 'gallery', 'video', 'embed', 'separator', 'spacer', 'table', 'buttons', 'details', 'group', 'columns', 'cover', 'media-text', 'uagb/image-gallery']);
let BGI = {}; // reglas de imágenes de fondo del bloque de estilos de Ecos de la entrada que se está leyendo
const AUTO_HL = { t: 14, r: 18, b: 14, l: 18 };
function toBlock(t) {
  const n = t.name.replace(/^core\//, '');
  let dz = null;
  if (DESIGN_NAMES.has(n)) {
    dz = Design.read(t.attrs, n, { bgi: BGI });
    if (!dz.ok && !['paragraph', 'heading', 'list', 'quote', 'pullquote'].includes(n)) return { id: bid(), type: 'raw', markup: t.raw, label: n };
    // el margen interior y las esquinas del resaltado de un párrafo o título los pone Ecos solos
    if ((n === 'paragraph' || n === 'heading') && (t.attrs.style?.color?.background || t.attrs.style?.color?.gradient)) {
      if (dz.d.p && ['t', 'r', 'b', 'l'].every((k) => dz.d.p[k] === AUTO_HL[k])) delete dz.d.p;
      if (dz.d.rd === 10) delete dz.d.rd;
    }
    t = { ...t, attrs: dz.rest };
  }
  const b = toBlockCore(t, n, dz && dz.d);
  if (b && !Array.isArray(b) && dz && b.type !== 'raw') {
    // el ancho de secciones, columnas y portadas se guarda como b.width (como siempre); en el resto, b.wd
    if (['group', 'columns', 'cover'].includes(b.type) && dz.d.wd) { b.width = dz.d.wd; delete dz.d.wd; }
    for (const [k, v] of Object.entries(dz.d)) if (b[k] === undefined) b[k] = v;
  }
  return b;
}
function toBlockCore(t, n, d) {
  const a = t.attrs, h = t.inner;
  const raw = () => ({ id: bid(), type: 'raw', markup: t.raw, label: n });
  switch (n) {
    case 'paragraph': return { id: bid(), type: 'paragraph', html: inner(h, 'p'), ...styleFrom(a) };
    case 'heading': { const l = a.level || 2; return { id: bid(), type: 'heading', level: [2, 3, 4, 5].includes(l) ? l : 2, html: inner(h, 'h' + l), ...styleFrom(a) }; }
    case 'list': {
      let items = all(h, 'li').map((x) => x.replace(/<!--[\s\S]*?-->/g, '').trim());
      const b = { id: bid(), type: 'list', ordered: !!a.ordered, items, ...styleFrom({ ...a, align: null }) };
      // lista con iconos de Ecos: el símbolo de cada elemento va en un <span class="ecos-ico"> delante del texto
      if (/(^|\s)ecos-iconos(\s|$)/.test(a.className || '')) {
        b.icons = items.map((x) => (x.match(/^<span class="ecos-ico"[^>]*>([^<]*)<\/span>\s?/) || [])[1] || '');
        b.items = items.map((x) => x.replace(/^<span class="ecos-ico"[^>]*>[^<]*<\/span>\s?/, ''));
        b.ordered = false;
      }
      return b;
    }
    case 'quote': return { id: bid(), type: 'quote', html: all(h, 'p').join('<br>'), cite: inner(h, 'cite'), ...styleFrom({ ...a, align: null }) };
    case 'pullquote': return { id: bid(), type: 'quote', pull: true, html: all(h, 'p').join('<br>'), cite: inner(h, 'cite'), ...styleFrom({ ...a, align: null }) };
    case 'image': {
      const img = imgOf(h);
      if (!img) return raw();
      const b = { id: bid(), type: 'image', img, caption: inner(h, 'figcaption') };
      // colocada a un lado (texto alrededor) o centrada, con un ancho (en px o %)
      if (['left', 'right', 'center'].includes(a.align)) b.align = a.align;
      const wd = String(a.width || '');
      if (/^\d+(\.\d+)?%$/.test(wd)) b.w = wd;
      else if (parseInt(wd, 10)) {
        const px = parseInt(wd, 10), preset = { 250: 33, 380: 50, 570: 75 }[px];
        if (b.align && preset) b.width = preset; else if (/^\d+(\.\d+)?px$/.test(wd)) b.w = wd; else if (b.align) b.width = px <= 300 ? 33 : px <= 470 ? 50 : px <= 650 ? 75 : 100;
      }
      if (['1', '4/3', '3/2', '16/9', '9/16'].includes(String(a.aspectRatio))) b.ratio = String(a.aspectRatio);
      // marco y efecto (atributos estándar y clases propias)
      const cn = String(a.className || '').split(/\s+/);
      const bd = a.style?.border || {};
      if (cn.includes('is-style-rounded')) b.frame = 'circle';
      else if (bd.width) { b.frame = 'border'; if (bd.color) b.frameColor = bd.color; }
      else if (bd.radius) b.frame = 'rounded';
      else if (a.style?.shadow) b.frame = 'shadow';
      if (cn.includes('ecos-zoom')) b.fx = 'zoom'; else if (cn.includes('ecos-bn')) b.fx = 'bw';
      return b;
    }
    case 'gallery': {
      const images = tokenize(h).filter((x) => /(^|\/)image$/.test(x.name)).map((x) => imgOf(x.inner)).filter(Boolean);
      return images.length ? { id: bid(), type: 'gallery', images, columns: a.columns || 3 } : raw();
    }
    case 'video': {
      const src = attr((h.match(/<video\b[^>]*>/i) || [''])[0], 'src');
      if (!src) return raw();
      const b = { id: bid(), type: 'video', video: { id: a.id, url: src }, caption: inner(h, 'figcaption') };
      // colocación, recorte, marco y efecto (clases ecos-v-*)
      for (const c of String(a.className || '').split(/\s+/)) {
        let m;
        if ((m = c.match(/^ecos-v-a-(left|center|right)$/))) b.align = m[1];
        else if ((m = c.match(/^ecos-v-w-(33|50|75)$/))) b.width = Number(m[1]);
        else if ((m = c.match(/^ecos-v-r-(1|4-3|3-2|16-9|9-16)$/))) b.ratio = m[1].replace('-', '/');
        else if ((m = c.match(/^ecos-v-(rounded|border|shadow)$/))) b.frame = m[1];
        else if (c === 'ecos-v-zoom') b.fx = 'zoom';
        else if (c === 'ecos-v-bw') b.fx = 'bw';
      }
      return b;
    }
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
      const ba = btns[0].attrs, bst = ba.style || {};
      const out = { id: bid(), type: 'buttons', html: inner(link, 'a'), url: attr(link, 'href'), align: a.layout?.justifyContent || 'left', variant: /is-style-outline/.test(ba.className || '') ? 'outline' : 'fill' };
      if (bst.color?.background) out.bg = bst.color.background;
      if (bst.color?.text) out.color = bst.color.text;
      const rad = parseInt(bst.border?.radius, 10);
      if (!Number.isNaN(rad)) out.radius = rad === 0 ? 'square' : rad >= 100 ? 'pill' : 'round';
      const pt = parseInt(bst.spacing?.padding?.top, 10);
      if (pt === 8) out.size = 's'; else if (pt === 18) out.size = 'l';
      if (Number(ba.width) === 100) out.full = true;
      return out;
    }
    case 'details': return { id: bid(), type: 'details', summary: inner(h, 'summary'), html: all(h, 'p').map((p) => `<p>${p}</p>`).join('') };
    case 'uagb/image-gallery': {
      // galería de Spectra: en carrusel es el carrusel de Ecos; si no, una galería
      const images = (a.mediaGallery || []).filter((m) => m && m.url).map((m) => ({ id: Number(m.id) || m.url, url: m.url, alt: m.alt || '' }));
      if (!images.length) return raw();
      const view = /\becos-peek\b/.test(a.className || '') ? 'peek' : (a.columnsDesk || 1) > 1 ? 'multi' : 'single';
      const co = carouselOptsFrom(String(a.className || '').split(/\s+/).map((c) => c.replace(/^ecos-/, '')));
      if (a.paginateUseArrows === false) co.arrows = false;
      if (a.paginateUseDots === false) co.dots = false;
      return a.feedLayout === 'carousel' ? { id: bid(), type: 'carousel', images, view, ...co, ...(a.carouselSquares && !co.ratio ? { squares: true } : {}), ...(a.carouselAutoplay === false ? { autoplay: false } : {}), ...(a.imageDisplayCaption ? { captions: true } : {}) }
        : { id: bid(), type: 'gallery', images, columns: a.columnsDesk || 3 };
    }
    case 'html': {
      // diseño en la primera etiqueta (clases ecos-d-*, ecos-hide-*, ecos-anim-*…): se lee y se quita para reconocer el bloque
      const ht = String(h).match(/^(\s*<div class=")([^"]*)(")/);
      if (ht && /ecos-(carrusel|mosaico|galeria|mapa)/.test(ht[2])) {
        const r = Design.read({ className: ht[2] }, 'html', { bgi: BGI });
        if (Object.keys(r.d).length) {
          const b = toBlock({ ...t, inner: h.replace(ht[0], ht[1] + (r.rest.className || '') + ht[3]) });
          if (b && !Array.isArray(b) && b.type !== 'raw') { Object.assign(b, r.d); return b; }
        }
      }
      if (/^\s*<div class="ecos-clear"[^>]*><\/div>\s*$/.test(h)) return null; // corte tras una foto a un lado: se vuelve a poner al enviar
      if (new RegExp(`<style class="${FX_MARK}"`).test(h)) return null; // estilos de los efectos de Ecos: se vuelven a poner al enviar
      if (PageBg.isBlock(h) || /^\s*<div class="ecos-page-bg"[^>]*><\/div>\s*$/.test(h)) return null; // fondo de la página: va a draft.pageBg (PageBg.parse), no es un bloque
      // mapa de Ecos: un iframe de Google Maps con la dirección en el enlace
      if (/class="ecos-mapa"/.test(h)) {
        const src = attr((h.match(/<iframe\b[^>]*>/i) || [''])[0], 'src');
        const address = DK.addressFromMap(src);
        const wrap = (h.match(/<div class="ecos-mapa"[^>]*>/) || [''])[0];
        if (address && /^https:\/\/www\.google\.com\/maps\?/.test(src)) {
          return { id: bid(), type: 'map', address, height: parseInt(attr((h.match(/<iframe\b[^>]*>/i) || [''])[0], 'height'), 10) || 360, radius: parseInt((wrap.match(/border-radius:(\d+)px/) || [])[1], 10) || 0 };
        }
      }
      // carrusel y mosaico de Ecos
      if (/class="ecos-(carrusel|mosaico|galeria)"/.test(h)) {
        // fotos y vídeos en orden (sin las imágenes de fondo desenfocado del carrusel, que repiten cada foto)
        const images = [...h.matchAll(/<(img|video)\b[^>]*>/gi)].filter((m) => !/class="ec-bg"/.test(m[0])).map((m) => {
          if (m[1].toLowerCase() !== 'video') return imgOf(m[0]);
          const url = attr(m[0], 'src');
          return url ? { type: 'video', id: Number(attr(m[0], 'data-id')) || url, url, ...(attr(m[0], 'poster') ? { poster: attr(m[0], 'poster') } : {}) } : null;
        }).filter(Boolean);
        if (images.length) {
          if (/ecos-carrusel/.test(h)) {
            const root = (h.match(/<div class="ecos-carrusel"[^>]*>/) || [''])[0], d = (k) => attr(root, 'data-' + k);
            const co = {};
            if (['s', 'm', 'l', 'xl'].includes(d('size'))) co.size = d('size');
            if (['1', '4/3', '3/2', '16/9', '3/4'].includes(d('ratio'))) co.ratio = d('ratio');
            if (['round', 'square'].includes(d('corners'))) co.corners = d('corners');
            if (['on', 'off'].includes(d('shadow'))) co.shadow = d('shadow');
            if (['0', 's', 'l'].includes(d('gap'))) co.gap = d('gap');
            if (d('arrows') === '0') co.arrows = false;
            if (d('dots') === '0') co.dots = false;
            return { id: bid(), type: 'carousel', images, ...co };
          }
          if (/ecos-galeria/.test(h)) return { id: bid(), type: 'gallery', images, columns: Number((h.match(/data-cols="(\d)"/) || [])[1]) || 3 };
          return { id: bid(), type: 'gallery', layout: 'mosaic', images, columns: 3 };
        }
      }
      return raw();
    }
    case 'media-text': {
      // «Imagen y texto» de Ecos: foto + párrafos, con tamaño, alineación vertical, relleno y estilo de la foto; lo demás se conserva tal cual
      if (!onlyKeys(a, ['mediaPosition', 'mediaId', 'mediaLink', 'mediaType', 'mediaWidth', 'verticalAlignment', 'imageFill', 'className']) || (a.mediaType && a.mediaType !== 'image')) return raw();
      if (a.mediaPosition && a.mediaPosition !== 'right') return raw();
      // la foto va antes del texto (izquierda) o después (derecha, como escribe WordPress); se lee quitando la foto
      const fig = (h.match(/<figure\b[^>]*wp-block-media-text__media[\s\S]*?<\/figure>/i) || [''])[0];
      const img = imgOf(fig);
      const content = (h.replace(fig, '').match(/<div class="wp-block-media-text__content">([\s\S]*)<\/div>\s*<\/div>\s*$/i) || [])[1];
      if (!img || content === undefined) return raw();
      const kids = tokenize(content).filter((x) => x.name !== 'freeform' || x.inner.replace(/<[^>]+>|\s|&nbsp;/g, ''));
      // párrafos con el mismo formato todos (el que pone Ecos): se lee ese formato; si no, se conserva tal cual
      const fmt0 = JSON.stringify(kids[0]?.attrs || {});
      if (kids.some((x) => x.name !== 'paragraph' || JSON.stringify(x.attrs) !== fmt0)) return raw();
      const cn = String(a.className || '').split(/\s+/).filter(Boolean);
      const known = (c) => c === 'ecos-mt' || /^ecos-mt-(r-(1|4-3|3-2|16-9|9-16)|rounded|circle|shadow|border|zoom|bn|bc-[0-9a-f]{3,8})$/.test(c);
      if (!cn.every(known)) return raw();
      const mw = a.mediaWidth === undefined ? 50 : a.mediaWidth;
      if (!Number.isInteger(mw) || mw < 10 || mw > 90) return raw();
      if (a.verticalAlignment !== undefined && !['top', 'center', 'bottom'].includes(a.verticalAlignment)) return raw();
      if (a.imageFill !== undefined && a.imageFill !== true) return raw();
      const b = { id: bid(), type: 'mediatext', img, html: kids.map((x) => inner(x.inner, 'p')).join('<br><br>'), right: a.mediaPosition === 'right', ...(kids[0] ? styleFrom(kids[0].attrs) : {}) };
      if (mw !== 50) b.mediaWidth = mw;
      if (a.verticalAlignment) b.valign = a.verticalAlignment;
      if (a.imageFill) b.fill = true;
      for (const c of cn) {
        const r = c.match(/^ecos-mt-r-(.+)$/);
        if (c === 'ecos-mt') continue;
        if (r) b.ratio = r[1].replace('-', '/');
        else if (c === 'ecos-mt-zoom') b.fx = 'zoom';
        else if (c === 'ecos-mt-bn') b.fx = 'bw';
        else if (c.startsWith('ecos-mt-bc-')) continue; // color del borde: se lee más abajo
        else b.frame = c.slice(8);
      }
      if (b.frame === 'border') b.frameColor = (cn.find((c) => c.startsWith('ecos-mt-bc-')) || '').replace(/^ecos-mt-bc-/, '#') || (h.match(/wp-block-media-text__media"[^>]*border:2px solid (#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))/i) || [])[1] || '#333333';
      return b;
    }
    case 'group': {
      if (!groupKnown(a)) return raw();
      const st = a.style || {}, kids = parseList(h, true);
      if (kids.lossy) return raw();
      const b = { id: bid(), type: 'group', children: kids };
      if (d.wd) { b.width = d.wd; delete d.wd; }
      if (st.color?.gradient) b.gradient = st.color.gradient;
      if (st.color?.background) b.bg = st.color.background;
      if (st.color?.text) b.color = st.color.text;
      // margen interior: uno de los tres tamaños de Ecos o los valores propios (b.p)
      const pad = padPreset(d.p);
      b.pad = pad || 'none';
      if (d.p && !pad) b.p = d.p;
      delete d.p;
      // lo que ya existía antes del panel de diseño (esquinas, borde de 1 px, sombra) conserva su forma
      if (d.rd > 0 && d.rd <= 60) { b.radius = d.rd; delete d.rd; }
      if (d.bw === 1 && !d.bs && d.bc) { b.border = d.bc; delete d.bw; delete d.bc; }
      if (d.sh === 'm') { b.shadow = true; delete d.sh; }
      return b;
    }
    case 'columns': {
      if (!onlyKeys(a, ['verticalAlignment', 'isStackedOnMobile', 'style']) || !columnsStyleKnown(a.style)) return raw();
      const cols = tokenize(h).filter((x) => x.name !== 'freeform' || x.inner.replace(/<[^>]+>|\s|&nbsp;/g, ''));
      if (!cols.length || cols.some((x) => x.name !== 'column' || !onlyKeys(x.attrs, ['width', 'verticalAlignment']))) return raw();
      const eq = pctString(100 / cols.length);
      const lists = cols.map((x) => parseList(x.inner, true));
      if (lists.some((l) => l.lossy)) return raw();
      const b = { id: bid(), type: 'columns', cols: cols.map((x, k) => ({ width: /^\d{1,3}(\.\d+)?%$/.test(x.attrs.width || '') ? x.attrs.width : eq, children: lists[k] })) };
      if (['top', 'center', 'bottom'].includes(a.verticalAlignment)) b.valign = a.verticalAlignment;
      if (a.isStackedOnMobile === false) b.stack = false;
      if (a.style?.color?.gradient) b.gradient = a.style.color.gradient;
      if (a.style?.color?.background) b.bg = a.style.color.background;
      if (a.style?.spacing?.blockGap) b.gap = parseInt(a.style.spacing.blockGap, 10);
      Object.assign(b, marginFrom(a.style?.spacing));
      return b;
    }
    case 'cover': {
      if (!onlyKeys(a, ['url', 'id', 'dimRatio', 'customOverlayColor', 'customGradient', 'minHeight', 'minHeightUnit', 'isDark', 'align', 'layout', 'alt', 'focalPoint', 'hasParallax', 'style', 'backgroundType'])) return raw();
      if (a.backgroundType && a.backgroundType !== 'video') return raw();
      if (a.backgroundType === 'video' && !/^https?:\/\/[^\s"'<>]+$/i.test(a.url || '')) return raw();
      if (a.style && !(onlyKeys(a.style, ['spacing']) && onlyKeys(a.style.spacing, ['margin']) && marginKnown(a.style.spacing.margin))) return raw();
      if (a.customGradient && !DK.safeGradient(a.customGradient)) return raw();
      if (a.focalPoint && !(onlyKeys(a.focalPoint, ['x', 'y']) && [a.focalPoint.x, a.focalPoint.y].every((v) => typeof v === 'number' && v >= 0 && v <= 1))) return raw();
      if (a.hasParallax !== undefined && a.hasParallax !== true) return raw();
      if (a.minHeightUnit && a.minHeightUnit !== 'px') return raw();
      if (a.layout && !(a.layout.type === 'constrained' && Object.keys(a.layout).length === 1)) return raw();
      if (a.customOverlayColor && !/^#[0-9a-f]{6}$/i.test(a.customOverlayColor)) return raw();
      const kids = parseList(h, true);
      if (kids.lossy) return raw();
      const tag = (h.match(/<(?:img|div)\b[^>]*wp-block-cover__image-background[^>]*>/i) || [''])[0];
      const vid = a.backgroundType === 'video';
      const b = { id: bid(), type: 'cover', img: a.url && !vid ? { id: Number(a.id) || a.url, url: a.url, alt: attr(tag, 'alt') || attr(tag, 'aria-label') } : null, overlay: a.customOverlayColor || '#000000', dim: a.dimRatio ?? 100, height: Number(a.minHeight) || 0, children: kids };
      if (vid) b.bgVideo = { id: Number(a.id) || a.url, url: a.url };
      if (ALIGN_OK.includes(a.align)) b.width = a.align;
      if (a.customGradient) b.gradient = a.customGradient;
      if (a.focalPoint) b.focalPoint = { x: a.focalPoint.x, y: a.focalPoint.y };
      if (a.hasParallax) b.parallax = true;
      Object.assign(b, marginFrom(a.style?.spacing));
      return b;
    }
    default: return raw();
  }
}

// --- Contenedores (sección, columnas, portada) ---------------------------------------------------------------
const ALIGN_OK = ['wide', 'full'];
const onlyKeys = (o, keys) => Object.keys(o || {}).every((k) => keys.includes(k));
const pctString = (n) => `${Math.round(n * 100) / 100}%`;
// Solo se convierte en sección lo que Ecos sabe volver a escribir igual; el resto se conserva tal cual (bloque «raw»)
function groupKnown(a) {
  if (!onlyKeys(a, ['style', 'layout'])) return false;
  if (a.layout && !(a.layout.type === 'constrained' && Object.keys(a.layout).length === 1)) return false;
  const st = a.style || {};
  // el espaciado, el borde y la sombra ya los ha leído Design.read (y si traían algo raro, el bloque no llega aquí)
  if (!onlyKeys(st, ['color'])) return false;
  if (!onlyKeys(st.color, ['background', 'text', 'gradient'])) return false;
  if (st.color?.gradient && !DK.safeGradient(st.color.gradient)) return false;
  return true;
}
// Margen exterior (arriba y abajo, en píxeles) y estilos de columnas
const marginKnown = (m) => !!m && typeof m === 'object' && onlyKeys(m, ['top', 'bottom']) && Object.values(m).every((v) => /^\d{1,3}px$/.test(String(v)));
const marginFrom = (sp) => {
  const m = sp?.margin, o = {};
  if (m?.top !== undefined) o.mt = parseInt(m.top, 10);
  if (m?.bottom !== undefined) o.mb = parseInt(m.bottom, 10);
  return o;
};
function columnsStyleKnown(st) {
  if (st === undefined) return true;
  if (!st || !onlyKeys(st, ['color', 'spacing'])) return false;
  if (st.color && !(onlyKeys(st.color, ['gradient', 'background']) && (!st.color.gradient || DK.safeGradient(st.color.gradient)) && (!st.color.background || /^#[0-9a-f]{3,8}$/i.test(st.color.background)))) return false;
  if (st.color?.gradient && st.color?.background) return false;
  if (st.spacing && !(onlyKeys(st.spacing, ['blockGap', 'margin']) && (st.spacing.blockGap === undefined || /^\d{1,3}px$/.test(String(st.spacing.blockGap))) && (st.spacing.margin === undefined || marginKnown(st.spacing.margin)))) return false;
  return true;
}
// ¿El margen interior es uno de los tres tamaños de sección de Ecos (arriba y abajo / a los lados)?
function padPreset(p) {
  if (!p) return 'none';
  for (const [k, [v, h]] of Object.entries({ s: [24, 24], m: [48, 32], l: [80, 40] })) if (p.t === v && p.b === v && p.l === h && p.r === h) return k;
  return '';
}
// Bloques de dentro de un contenedor (los envoltorios <div> sin texto no cuentan)
function parseList(content, nested) {
  const out = [];
  let lossy = false;
  for (const t of tokenize(String(content || ''))) {
    if (t.name === 'freeform') {
      if (nested) { if (!t.inner.replace(/<[^>]+>|&nbsp;|\s/g, '')) continue; lossy = true; } // texto suelto dentro de un contenedor: no es de Gutenberg
      out.push(...classicBlocks(t.inner));
    } else { const b = toBlock(t); if (Array.isArray(b)) out.push(...b); else if (b) out.push(b); }
  }
  const res = out.filter((b) => b.type !== 'paragraph' || (b.html || '').replace(/<[^>]+>|&nbsp;|\s/g, ''));
  if (lossy) res.lossy = true;
  return res;
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
  BGI = Design.parseBgiRules((String(content || '').match(new RegExp(`<style class="${FX_MARK}">[\\s\\S]*?</style>`, 'g')) || []).join(''));
  return parseList(content, false);
}

module.exports = { parseBlocks, tokenize, classicBlocks, toBlock };
