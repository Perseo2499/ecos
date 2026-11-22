// Convierte los bloques de Spectra (uagb/*) de una página o entrada en bloques editables de Ecos.
// Lógica pura: recibe los bloques que devuelve parseBlocks (donde Spectra aparece como «raw») y devuelve
// bloques de Ecos equivalentes. Lo que no se puede convertir con seguridad (bloques dinámicos: carrusel de
// entradas, formularios, pestañas…) se queda como «raw», intacto.
const { tokenize, classicBlocks, toBlock } = require('./parseblocks');
const DK = require('../renderer/sections');

let seq = 0;
const bid = () => 's' + Date.now().toString(36) + (seq++).toString(36);
const SPECTRA = /^\s*<!--\s+wp:uagb\//;

// Bloques de Spectra que pintan su contenido al cargar la página (no guardan texto propio): se dejan como están
const DYNAMIC = new Set([
  'post-carousel', 'post-grid', 'post-masonry', 'post-timeline', 'post-title', 'post-image', 'post-excerpt', 'post-button', 'post-meta',
  'forms', 'form', 'slider', 'slider-child', 'tabs', 'tabs-child', 'timeline', 'content-timeline', 'countdown', 'table-of-contents',
  'social-share', 'social-share-child', 'star-rating', 'review', 'lottie', 'modal', 'popup-builder', 'price-list', 'price-list-child',
  'how-to', 'how-to-step', 'inline-notice', 'marketing-button', 'taxonomy-list', 'wp-search', 'cf7-styler', 'gf-styler', 'team',
  'restaurant-menu', 'restaurant-menu-child', 'icon', 'loop-builder', 'login', 'register', 'toc', 'sidebar', 'testimonial-slider',
]);

// --- Utilidades de HTML (sin DOM) --------------------------------------------------------------------------
const decode = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plain = (h) => decode(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const VOID = /^(img|br|hr|input|source|embed|meta|link|col|area|base|wbr|track|param)$/i;

// Elementos con una clase: [{ tag, open, inner }] (con su cierre emparejado)
function byClass(html, cls) {
  html = String(html || '');
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const c = (m[2].match(/\bclass="([^"]*)"/i) || [])[1];
    if (!c || !c.split(/\s+/).includes(cls) || VOID.test(m[1]) || /\/\s*$/.test(m[2])) continue;
    const tag = m[1].toLowerCase(), start = re.lastIndex;
    const tre = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
    tre.lastIndex = start;
    let depth = 1, t, end = -1;
    while ((t = tre.exec(html))) {
      if (t[2] === '/') continue;
      depth += t[1] ? -1 : 1;
      if (!depth) { end = t.index; break; }
    }
    if (end < 0) continue;
    out.push({ tag, open: m[0], inner: html.slice(start, end), index: m.index });
  }
  return out;
}
const first = (html, cls) => byClass(html, cls)[0] || null;
const attrOf = (tagHtml, name) => { const m = String(tagHtml || '').match(new RegExp(`\\b${name}="([^"]*)"`, 'i')); return m ? decode(m[1]) : ''; };
const hasContent = (h) => !!String(h || '').replace(/<(?!img\b|iframe\b|video\b)[^>]+>|&nbsp;|\s/g, '');

// Texto en línea limpio: solo negritas, cursivas, enlaces y saltos de línea
function inlineHtml(html) {
  let h = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(svg|script|style)\b[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<a\b([^>]*)>/gi, (_, at) => { const href = attrOf(at, 'href'); return /^(https?:|mailto:|tel:|\/|#)/i.test(href) ? `<a href="${href.replace(/"/g, '&quot;')}">` : '<a>'; });
  h = h.replace(/<\/?(?!a\b|strong\b|b\b|em\b|i\b|u\b|br\b|sup\b|sub\b|mark\b)[a-z][a-z0-9]*\b[^>]*>/gi, '');
  h = h.replace(/<(\/?)b>/gi, '<$1strong>').replace(/<(\/?)i>/gi, '<$1em>').replace(/<br\s*\/?>/gi, '<br>').replace(/<a>([\s\S]*?)<\/a>/gi, '$1');
  return h.replace(/\s+/g, ' ').replace(/^(\s|<br>)+|(\s|<br>)+$/gi, '').trim();
}
// Texto largo: los saltos dobles (<br><br>) o <p> son párrafos distintos
function paragraphsOf(html) {
  const h = String(html || '').replace(/<\/p>\s*<p\b[^>]*>/gi, '<br><br>').replace(/<\/?p\b[^>]*>/gi, '');
  return inlineHtml(h.replace(/<br\s*\/?>/gi, '<br>')).split(/(?:<br>\s*){2,}/i).map((p) => p.replace(/^(\s|<br>)+|(\s|<br>)+$/gi, '').trim()).filter((p) => plain(p));
}

// --- Colores y degradados ---------------------------------------------------------------------------------
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
// Cualquier color CSS sencillo → #rrggbb (lo semitransparente se mezcla con blanco); '' si no se puede
function colorOf(c, opacity) {
  c = String(c || '').trim();
  let r, g, b, a = 1, m;
  if ((m = c.match(/^#([0-9a-f]{3})$/i))) [r, g, b] = [...m[1]].map((x) => parseInt(x + x, 16));
  else if ((m = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i))) { [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); if (m[2]) a = parseInt(m[2], 16) / 255; }
  else if ((m = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i))) { [r, g, b] = [m[1], m[2], m[3]].map(Number); if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); }
  else return '';
  if (typeof opacity === 'number' && opacity >= 0 && opacity <= 1) a *= opacity;
  if (a <= 0.02) return '';
  const mix = (v) => v * a + 255 * (1 - a);
  return '#' + hex2(mix(r)) + hex2(mix(g)) + hex2(mix(b));
}
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const DIRS = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
// Degradado lineal de CSS → el formato seguro de Ecos (2 o 3 colores #rrggbb con posición)
function gradientOf(css) {
  const m = String(css || '').trim().match(/^linear-gradient\((.*)\)$/i);
  if (!m) return '';
  const parts = splitTop(m[1]);
  let angle = 180;
  if (/^-?[\d.]+deg$/i.test(parts[0])) angle = ((Math.round(parseFloat(parts[0])) % 360) + 360) % 360;
  else if (DIRS[parts[0].toLowerCase()] !== undefined) angle = DIRS[parts[0].toLowerCase()];
  else parts.unshift('');
  const stops = parts.slice(1).map((p) => { const mm = p.match(/^(.*?)(?:\s+(-?[\d.]+)%)?$/); return { c: colorOf(mm[1]), p: mm[2] === undefined ? null : Math.max(0, Math.min(100, Math.round(parseFloat(mm[2])))) }; });
  if (stops.length < 2 || stops.length > 3 || stops.some((s) => !s.c)) return '';
  stops.forEach((s, i) => { if (s.p === null) s.p = Math.round((i / (stops.length - 1)) * 100); });
  const g = `linear-gradient(${angle}deg,${stops.map((s) => `${s.c} ${s.p}%`).join(',')})`;
  return DK.safeGradient(g);
}

// --- Conversor -------------------------------------------------------------------------------------------
const P = (html, extra) => ({ id: bid(), type: 'paragraph', html, ...extra });
const levelOf = (tag) => { const n = Number(String(tag).replace(/\D/g, '')); return n ? Math.min(5, Math.max(2, n)) : 0; };
const alignExtra = (al) => (['center', 'right'].includes(al) ? { align: al } : {});
const colorExtra = (c) => { const x = colorOf(c); return x ? { color: x } : {}; };
const H = (tag, html, extra) => (levelOf(tag) ? { id: bid(), type: 'heading', level: levelOf(tag), html, ...extra } : P(html, extra));
const imgBlock = (url, alt, id, caption) => ({ id: bid(), type: 'image', img: { id: Number(id) || url, url, alt: alt || '' }, caption: caption || '' });
const BTN = (html, url, extra) => ({ id: bid(), type: 'buttons', html, url: /^(https?:|mailto:|tel:)/i.test(url || '') ? url : '', align: 'left', variant: 'fill', ...extra });
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function mapAttrs(a, ctx) { return { a: a || {}, ctx }; }

// Ancho de cada columna → las proporciones que admite Ecos
function snapWidths(ws) {
  const n = ws.length;
  const equal = ws.map(() => 100 / n);
  const known = ws.map((w) => (typeof w === 'number' && w > 0 && w < 100 ? w : null));
  let target;
  if (known.every((w) => w === null) || n > 3 || n < 2) target = equal;
  else {
    const sum = known.reduce((s, w) => s + (w || 0), 0), missing = known.filter((w) => w === null).length;
    const fill = missing ? Math.max(0, 100 - sum) / missing : 0;
    const filled = known.map((w) => (w === null ? fill : w));
    const tot = filled.reduce((s, w) => s + w, 0) || 100;
    target = filled.map((w) => (w / tot) * 100);
  }
  const presets = { 2: [[50, 50], [33.33, 66.66], [66.66, 33.33]], 3: [[33.33, 33.33, 33.33], [25, 50, 25], [50, 25, 25], [25, 25, 50]] }[n];
  let best = equal;
  if (presets) { let bd = Infinity; for (const p of presets) { const d = p.reduce((s, v, i) => s + Math.abs(v - target[i]), 0); if (d < bd) { bd = d; best = p; } } }
  return best.map((v) => `${Math.round(v * 100) / 100}%`);
}

// Aspecto de un contenedor de Spectra: fondo, margen interior, esquinas, sombra y borde
function boxStyle(a) {
  const o = {};
  const bt = a.backgroundType || 'none';
  if (bt === 'color') { const c = colorOf(a.backgroundColor, num(a.backgroundOpacity) ?? undefined); if (c) o.bg = c; }
  else if (bt === 'gradient') {
    let g = gradientOf(a.gradientValue);
    if (!g && a.gradientColor1 && a.gradientColor2 && (a.gradientType || 'linear') === 'linear') g = gradientOf(`linear-gradient(${a.gradientAngle ?? 180}deg, ${a.gradientColor1} ${a.gradientLocation1 ?? 0}%, ${a.gradientColor2} ${a.gradientLocation2 ?? 100}%)`);
    if (g) o.gradient = g; else { const c = colorOf(a.gradientColor1 || a.backgroundColor); if (c) o.bg = c; }
  } else if (bt === 'image') {
    const im = a.backgroundImageDesktop;
    if (im && im.url) {
      o.image = { id: Number(im.id) || im.url, url: im.url, alt: im.alt || '' };
      const ov = a.overlayType && a.overlayType !== 'none';
      const col = ov ? colorOf(a.backgroundImageColor || '#000000') : '';
      o.overlay = col || '#000000';
      o.dim = ov && col ? Math.round(Math.max(0, Math.min(1, num(a.overlayOpacity) ?? 1)) * 10) * 10 : 0;
    }
  }
  const top = num(a.topPaddingDesktop), pu = a.paddingType || 'px';
  const pv = top === null ? 0 : pu === 'em' || pu === 'rem' ? top * 16 : pu === 'px' ? top : 0;
  o.pad = pv < 12 ? 'none' : pv <= 36 ? 's' : pv <= 64 ? 'm' : 'l';
  const rad = Math.max(...['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => num(a['containerBorder' + k + 'Radius']) || 0));
  if (rad > 0) o.radius = Math.min(60, Math.round((a.containerBorderRadiusUnit || 'px') === '%' ? rad * 0.6 : rad));
  if ((num(a.boxShadowBlur) || 0) > 0 || (num(a.boxShadowSpread) || 0) > 0 || num(a.boxShadowHOffset) || num(a.boxShadowVOffset)) o.shadow = true;
  const bw = Math.max(...['Top', 'Right', 'Bottom', 'Left'].map((k) => num(a['containerBorder' + k + 'Width']) || 0));
  const bc = colorOf(a.containerBorderColor);
  if (bw > 0 && bc) o.border = bc;
  const mu = a.marginType || 'px';
  if (mu === 'px') { const mt = num(a.topMarginDesktop), mb = num(a.bottomMarginDesktop); if (mt !== null && mt >= 0) o.mt = Math.min(200, Math.round(mt)); if (mb !== null && mb >= 0) o.mb = Math.min(200, Math.round(mb)); }
  const mh = num(a.minHeightDesktop);
  if (mh && (a.minHeightType || 'px') === 'px') o.height = Math.min(1200, Math.round(mh));
  if (a.contentWidth === 'alignfull' && a.isBlockRootParent) o.width = 'full';
  else if (a.contentWidth === 'alignwide' && a.isBlockRootParent) o.width = 'wide';
  o.decor = !!(o.bg || o.gradient || o.image || o.pad !== 'none' || o.radius || o.shadow || o.border);
  return o;
}

function convertSpectra(blocks) {
  const ctx = { converted: 0, kept: new Map() };
  const keep = (name) => ctx.kept.set(name, (ctx.kept.get(name) || 0) + 1);
  const rawOf = (t) => ({ id: bid(), type: 'raw', markup: t.raw, label: t.name });

  // Bloques de dentro de un fragmento (comentarios de Gutenberg + HTML suelto)
  function kidsOf(inner) {
    const out = [];
    for (const t of tokenize(String(inner || ''))) {
      if (t.name === 'freeform') { if (hasContent(t.inner)) out.push(...walk(classicBlocks(t.inner.replace(/<(svg|script|style)\b[\s\S]*?<\/\1>/gi, '')))); continue; }
      out.push(...tok(t));
    }
    return out;
  }
  const tokensOf = (inner) => tokenize(String(inner || '')).filter((t) => t.name !== 'freeform' || hasContent(t.inner));

  // Un bloque (comentario de Gutenberg): lo convierte o lo deja como «raw»
  function tok(t) {
    if (!/^uagb\//.test(t.name)) {
      const b = toBlock(t);
      return walk(Array.isArray(b) ? b : b ? [b] : []);
    }
    let res = null;
    try { res = conv(t); } catch { res = null; }
    if (res) { ctx.converted++; return res; }
    keep(t.name);
    return [rawOf(t)];
  }

  // Árbol de bloques de Ecos: convierte los «raw» de Spectra, también los que están dentro de secciones y columnas
  function walk(list) {
    const out = [];
    for (const b of list || []) {
      if (b.type === 'raw' && SPECTRA.test(b.markup || '')) {
        const ts = tokenize(b.markup).filter((t) => t.name !== 'freeform');
        if (ts.length === 1 && ts[0].raw.trim() === b.markup.trim()) {
          const r = tok(ts[0]);
          // si no se pudo convertir se conserva el mismo bloque (con su id)
          if (r.length === 1 && r[0].type === 'raw' && r[0].markup === ts[0].raw) out.push(b); else out.push(...r);
          continue;
        }
      }
      if (Array.isArray(b.children)) b.children = walk(b.children);
      if (Array.isArray(b.cols)) b.cols.forEach((c) => { c.children = walk(c.children || []); });
      out.push(b);
    }
    return out;
  }

  function conv(t) {
    const name = t.name.replace(/^uagb\//, ''), a = t.attrs || {}, h = t.inner || '';
    switch (name) {
      case 'container': return container(a, h);
      case 'advanced-heading': return advancedHeading(a, h);
      case 'info-box': return infoBox(a, h);
      case 'buttons': return buttons(a, h);
      case 'buttons-child': return buttons({}, t.raw);
      case 'image': return image(a, h);
      case 'image-gallery': { const b = toBlock(t); return b && b.type !== 'raw' ? [b] : null; }
      case 'icon-list': return iconList(h);
      case 'separator': return [{ id: bid(), type: 'separator' }];
      case 'blockquote': return blockquote(h);
      case 'testimonial': return testimonial(h);
      case 'faq': return faq(h);
      case 'google-map': return map(a);
      case 'counter': return counter(a, h);
      case 'call-to-action': return cta(a, h);
      default: return unknown(name, h);
    }
  }

  // --- Contenedores ---
  function container(a, h) {
    const st = boxStyle(a);
    const row = (a.directionDesktop || 'column') === 'row';
    const ts = tokensOf(h);
    let inside;
    const rowKids = ts.filter((t) => t.name !== 'freeform');
    if (row && rowKids.length >= 2) {
      const widths = rowKids.map((t) => (/^uagb\/container$/.test(t.name) ? num(t.attrs?.widthDesktop) : null));
      const w = snapWidths(widths);
      const cols = rowKids.map((t, i) => ({ width: w[i], children: tok(t) }));
      const c = { id: bid(), type: 'columns', stack: true, cols };
      const va = { 'flex-start': 'top', center: 'center', 'flex-end': 'bottom' }[a.alignItemsDesktop || a.alignItems];
      if (va) c.valign = va;
      inside = [c];
    } else inside = kidsOf(h);
    if (st.image) {
      const cv = { id: bid(), type: 'cover', img: st.image, overlay: st.overlay, dim: st.dim, height: st.height || 0, children: inside };
      if (st.width) cv.width = st.width;
      if (st.gradient) cv.gradient = st.gradient;
      if (st.mt !== undefined) cv.mt = st.mt;
      if (st.mb !== undefined) cv.mb = st.mb;
      return [cv];
    }
    if (!st.decor) return inside;
    const g = { id: bid(), type: 'group', pad: st.pad, children: inside };
    for (const k of ['bg', 'gradient', 'radius', 'shadow', 'border', 'width', 'mt', 'mb']) if (st[k] !== undefined) g[k] = st[k];
    return [g];
  }

  // --- Texto ---
  function advancedHeading(a, h) {
    const out = [];
    const title = first(h, 'uagb-heading-text'), desc = first(h, 'uagb-desc-text');
    const al = alignExtra(a.headingAlign);
    const sz = num(a.headingFontSize) && (a.headingFontSizeType || 'px') === 'px' && a.headingFontSize >= 12 && a.headingFontSize <= 96 ? { size: Math.round(a.headingFontSize) + 'px' } : {};
    const T = title && plain(title.inner) ? H(title.tag, inlineHtml(title.inner), { ...al, ...colorExtra(a.headingColor), ...sz }) : null;
    const D = desc && plain(desc.inner) ? paragraphsOf(desc.inner).map((p) => P(p, { ...al, ...colorExtra(a.subHeadingColor) })) : [];
    if (a.headingDescPosition === 'above-heading') out.push(...D, ...(T ? [T] : [])); else out.push(...(T ? [T] : []), ...D);
    return out.length ? out : null;
  }
  function infoBox(a, h) {
    const al = alignExtra(a.headingAlign || 'center');
    const out = [];
    const prefix = first(h, 'uagb-ifb-title-prefix'), title = first(h, 'uagb-ifb-title'), desc = first(h, 'uagb-ifb-desc');
    const im = first(h, 'uagb-ifb-image-content');
    const img = im && (im.inner.match(/<img\b[^>]*>/i) || [''])[0];
    let image = null;
    if (img && attrOf(img, 'src')) image = imgBlock(attrOf(img, 'src'), attrOf(img, 'alt') || a.imageAlt, Number(((a.iconImage || {}).id)) || 0);
    if (prefix && plain(prefix.inner)) out.push(P(inlineHtml(prefix.inner), { ...al, ...colorExtra(a.prefixColor) }));
    if (title && plain(title.inner)) out.push(H(title.tag, inlineHtml(title.inner), { ...al, ...colorExtra(a.headingColor) }));
    if (desc) out.push(...paragraphsOf(desc.inner).map((p) => P(p, { ...al, ...colorExtra(a.subHeadingColor) })));
    // botón o enlace de la tarjeta
    let btn = null;
    if (a.ctaType === 'text' || a.ctaType === 'button') {
      const link = (byClass(h, 'uagb-ifb-cta')[0] || {}).inner || '';
      const an = (link.match(/<a\b[^>]*>/i) || [''])[0];
      const txt = plain((first(link, 'uagb-inline-editing') || { inner: link }).inner);
      const href = attrOf(an, 'href') || a.ctaLink || '';
      if (txt) btn = BTN(txt, href === '#' ? '' : href, { align: ['center', 'right'].includes(a.headingAlign || 'center') ? (a.headingAlign || 'center') : 'left', variant: a.ctaType === 'text' ? 'outline' : 'fill' });
    }
    if (!out.length && !image && !btn) return null;
    if (!image && !btn) return out;
    // con imagen o botón es una tarjeta (sección con borde y sombra suave)
    if (image) { if ((a.headingAlign || 'center') === 'center') image.align = undefined; out.unshift(image); }
    if (btn) out.push(btn);
    return [{ id: bid(), type: 'group', pad: 's', radius: 12, shadow: true, border: '#e5e7eb', bg: '#ffffff', children: out }];
  }
  function blockquote(h) {
    const d = first(h, 'uagb-blockquote__content'), au = first(h, 'uagb-blockquote__author');
    if (!d || !plain(d.inner)) return null;
    return [{ id: bid(), type: 'quote', html: paragraphsOf(d.inner).join('<br>'), cite: au ? inlineHtml(au.inner) : '' }];
  }
  function testimonial(h) {
    const items = byClass(h, 'uagb-testimonial__wrap').map((w) => {
      const d = first(w.inner, 'uagb-tm__desc'), n = first(w.inner, 'uagb-tm__author-name'), c = first(w.inner, 'uagb-tm__company');
      if (!d || !plain(d.inner)) return null;
      const cite = [n && plain(n.inner), c && plain(c.inner)].filter(Boolean).join(', ');
      return { id: bid(), type: 'quote', html: paragraphsOf(d.inner).join('<br>'), cite };
    }).filter(Boolean);
    return items.length ? items : null;
  }

  // --- Botones ---
  function buttons(pa, h) {
    const kids = /wp:uagb\/buttons-child/.test(h) ? tokensOf(h).filter((t) => t.name === 'uagb/buttons-child') : [];
    const al = ['left', 'center', 'right'].includes(pa.align || 'center') ? (pa.align || 'center') : 'center';
    const out = [];
    for (const k of kids.length ? kids : []) {
      const a = k.attrs || {};
      const link = (k.inner.match(/<a\b[^>]*>/i) || [''])[0];
      const lab = first(k.inner, 'uagb-button__link');
      const text = lab ? inlineHtml(lab.inner) : plain(a.label || '');
      if (!plain(text)) continue;
      let href = attrOf(link, 'href') || a.link || '';
      if (href === '#') href = '';
      const b = BTN(text, href, { align: al });
      const bg = colorOf(a.background), fg = colorOf(a.color);
      const bw = Math.max(...['Top', 'Right', 'Bottom', 'Left'].map((s) => num(a['btnBorder' + s + 'Width']) || 0));
      if (bg) b.bg = bg;
      if (fg) b.color = fg;
      if (!bg && bw > 0) { b.variant = 'outline'; const bcol = colorOf(a.btnBorderColor); if (!fg && bcol) b.color = bcol; }
      const rads = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((s) => num(a['btnBorder' + s + 'Radius'])).filter((v) => v !== null);
      if (rads.length) { const r = Math.max(...rads); b.radius = r === 0 ? 'square' : r >= 40 ? 'pill' : 'round'; }
      else if (num(a.borderRadius) !== null) b.radius = a.borderRadius === 0 ? 'square' : a.borderRadius >= 40 ? 'pill' : 'round';
      out.push(b);
    }
    return out.length ? out : null;
  }

  // --- Imagen ---
  function image(a, h) {
    const tag = (h.match(/<img\b[^>]*>/i) || [''])[0];
    const url = attrOf(tag, 'src') || a.url;
    if (!url) return null;
    const idm = (attrOf(tag, 'class').match(/uag-image-(\d+)/) || [])[1] || a.id;
    const cap = first(h, 'uagb-image-caption');
    const b = imgBlock(url, attrOf(tag, 'alt') || a.alt, idm, cap ? inlineHtml(cap.inner) : '');
    const align = ['left', 'right', 'center'].includes(a.align) ? a.align : '';
    const w = num(a.width) || Number(attrOf(tag, 'width')) || 0;
    if (align) b.align = align;
    if (align && align !== 'center' && w) b.width = w <= 300 ? 33 : w <= 470 ? 50 : w <= 650 ? 75 : 100;
    else if (num(a.width) && a.width > 40) b.w = `${Math.round(a.width)}px`;
    const rads = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((s) => num(a['imageBorder' + s + 'Radius']) || 0);
    const r = Math.max(...rads);
    if (r > 0) b.frame = (a.imageBorderRadiusUnit === '%' && r >= 50) || r >= 200 ? 'circle' : 'rounded';
    if (a.imageHoverEffect === 'zoomin') b.fx = 'zoom'; else if (a.imageHoverEffect === 'grayscale') b.fx = 'bw';
    return [b];
  }

  // --- Listas, preguntas, mapa, cifras y llamadas a la acción ---
  function iconList(h) {
    const items = tokensOf(h).filter((t) => t.name === 'uagb/icon-list-child').map((t) => {
      const l = first(t.inner, 'uagb-icon-list__label');
      return inlineHtml(l ? l.inner : t.attrs?.label || '');
    }).filter((x) => plain(x));
    const kids = items.length ? items : byClass(h, 'uagb-icon-list__label').map((l) => inlineHtml(l.inner)).filter((x) => plain(x));
    return kids.length ? [{ id: bid(), type: 'list', ordered: false, items: kids, icons: kids.map(() => '✔') }] : null;
  }
  function faq(h) {
    const out = [];
    for (const t of tokensOf(h)) {
      if (t.name !== 'uagb/faq-child') continue;
      const q = t.attrs?.question ?? ((first(t.inner, 'uagb-question') || {}).inner || '');
      const an = t.attrs?.answer ?? ((first(t.inner, 'uagb-faq-content') || {}).inner || '');
      if (!plain(q)) continue;
      const ps = paragraphsOf(an);
      out.push({ id: bid(), type: 'details', summary: plain(inlineHtml(q)), html: ps.map((p) => `<p>${p}</p>`).join('') });
      ctx.converted++;
    }
    return out.length ? out : null;
  }
  function map(a) {
    const address = String(a.address || '').replace(/\s+/g, ' ').trim();
    if (!address) return null;
    return [{ id: bid(), type: 'map', address, height: Math.min(800, Math.max(150, num(a.height) || 300)), radius: 0 }];
  }
  function counter(a, h) {
    const n = first(h, 'uagb-counter-block-number');
    const to = n ? attrOf(n.open, 'data-to-value') : '';
    const val = to !== '' ? Number(to) : num(a.endNumber) ?? 80;
    if (!Number.isFinite(val)) return null;
    const pre = first(h, 'uagb-counter-block-prefix'), suf = first(h, 'uagb-counter-block-suffix');
    const delim = n ? attrOf(n.open, 'data-delimiter') : '';
    let s = String(val);
    if (delim && Math.abs(val) >= 1000) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, delim);
    const text = `${pre ? plain(pre.inner) : ''}${s}${suf ? plain(suf.inner) : ''}`;
    const ti = first(h, 'wp-block-uagb-counter__title');
    const kids = [H('h4', text, { align: 'center', size: '56px', color: '#fd9800' })];
    if (ti && plain(ti.inner)) kids.push(P(inlineHtml(ti.inner), { align: 'center' }));
    return [{ id: bid(), type: 'group', pad: 's', children: kids }];
  }
  function cta(a, h) {
    const al = alignExtra(a.textAlign), bal = ['center', 'right'].includes(a.textAlign) ? a.textAlign : 'left';
    const wrap = first(h, 'uagb-cta__wrap');
    const kids = [];
    if (wrap) {
      const tm = wrap.inner.match(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/i);
      if (tm && plain(tm[2])) kids.push(H(tm[1], inlineHtml(tm[2]), al));
      const d = first(wrap.inner, 'uagb-cta__desc');
      if (d) kids.push(...paragraphsOf(d.inner).map((p) => P(p, al)));
    }
    const bs = first(h, 'uagb-cta__buttons');
    if (bs) {
      for (const an of [...bs.inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]) {
        const txt = inlineHtml(an[2]);
        if (!plain(txt)) continue;
        const href = attrOf(an[1], 'href');
        const second = /uagb-cta-second__button/.test(an[1]);
        const b = BTN(txt, href === '#' ? '' : href, { align: bal, variant: second ? 'outline' : 'fill' });
        if (!second) { const bg = colorOf(a.ctaBgColor), fg = colorOf(a.ctaBtnLinkColor); if (bg) b.bg = bg; if (fg) b.color = fg; }
        kids.push(b);
      }
    }
    if (!kids.length) return null;
    return [{ id: bid(), type: 'group', pad: 's', radius: 12, border: '#e5e7eb', children: kids }];
  }

  // Bloque que no conocemos: si no es dinámico y guarda contenido, se rescatan sus textos e imágenes
  function unknown(name, h) {
    if (DYNAMIC.has(name)) return null;
    if (/<!--\s+wp:/.test(h)) { const kids = kidsOf(h); return kids.length ? kids : null; }
    const clean = String(h).replace(/<(svg|script|style|noscript)\b[\s\S]*?<\/\1>/gi, '').trim();
    if (!hasContent(clean)) return null;
    const got = classicBlocks(clean);
    if (!got.length || got.some((b) => b.type === 'raw')) return null;
    return got;
  }

  const result = walk(Array.isArray(blocks) ? blocks : []);
  return { blocks: result, converted: ctx.converted, kept: [...ctx.kept.keys()], keptCounts: Object.fromEntries(ctx.kept) };
}

// Cuántos bloques de Spectra hay (también los de dentro de otros) y cuántos se podrían convertir
function countSpectra(blocks) {
  let n = 0;
  const visit = (list) => {
    for (const b of list || []) {
      if (b.type === 'raw' && SPECTRA.test(b.markup || '')) n += (b.markup.match(/<!--\s+wp:uagb\/[a-z0-9-]+(?=[\s{/])/g) || []).length;
      if (Array.isArray(b.children)) visit(b.children);
      if (Array.isArray(b.cols)) b.cols.forEach((c) => visit(c.children));
    }
  };
  visit(blocks);
  return n;
}

module.exports = { convertSpectra, countSpectra, DYNAMIC, colorOf, gradientOf, snapWidths };
