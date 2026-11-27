// Ecos · bloques de otros plugins (Spectra «uagb/», Kadence Blocks «kadence/» y GenerateBlocks «generateblocks/») EDITABLES, con
// edición conservadora: el bloque se guarda con su comentario, sus atributos y su HTML originales, y solo se tocan los textos,
// enlaces, imagen, nivel del título, alineación y color que se editan. Nada se vuelve a generar desde cero (el CSS lo crea el plugin a
// partir de los atributos y del block_id/uniqueID, que se conservan). Lógica pura (sin DOM): la usan src/parseblocks.js, src/transform.js,
// la interfaz (renderer/blocks/third.js) y las pruebas. Si algo no encaja con lo esperado, read() devuelve null y el bloque sigue siendo «raw».
//
// Bloque de Ecos: { id, type:'third', name, plugin, open, close, a0, attrs, html | (pre, children, post, sep) | self }
//   open/close: comentarios originales · a0: atributos originales (JSON) · attrs: atributos actuales
//   html: contenido guardado (bloques con HTML propio) · pre/post/children/sep: contenedores (los hijos son bloques de Ecos)
//   self: true en bloques sin HTML guardado (<!-- wp:x {…} /-->), cuyo contenido son solo atributos
(function (root) {
  // --- Lectura del HTML guardado -----------------------------------------------------------------------------------------------
  const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track']);
  const TAGRE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/g;
  const entDec = (s) => String(s).replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const attrEnc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Elementos del HTML en orden: { tag, os, oe, cs, ce, cls[] } (os..oe = etiqueta de apertura; cs..ce = de cierre; cs -1 si no se cierra)
  function scan(html) {
    const out = [], stack = [];
    TAGRE.lastIndex = 0;
    let m;
    while ((m = TAGRE.exec(html))) {
      if (m[0][1] === '-') continue; // comentario
      const closing = m[1] === '/', tag = m[2].toLowerCase();
      if (closing) {
        for (let k = stack.length - 1; k >= 0; k--) if (stack[k].tag === tag) { stack[k].cs = m.index; stack[k].ce = TAGRE.lastIndex; stack.length = k; break; }
        continue;
      }
      const cm = m[3].match(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const el = { tag, os: m.index, oe: TAGRE.lastIndex, cs: -1, ce: -1, cls: cm ? (cm[1] ?? cm[2]).split(/\s+/).filter(Boolean) : [] };
      out.push(el);
      if (m[4] === '/' || VOID.has(tag)) continue;
      if (tag === 'script' || tag === 'style') { const e = html.toLowerCase().indexOf('</' + tag, TAGRE.lastIndex); if (e >= 0) { const end = html.indexOf('>', e) + 1; el.cs = e; el.ce = end; TAGRE.lastIndex = end; } continue; }
      stack.push(el);
    }
    return out;
  }
  // Selector: { cls (texto o lista de alternativas), tag, nth }
  function find(html, sel) {
    if (!sel) return null;
    const classes = [].concat(sel.cls || []);
    const els = scan(html);
    for (const c of classes.length ? classes : [null]) {
      const hit = els.filter((e) => (!c || e.cls.includes(c)) && (!sel.tag || e.tag === sel.tag) && (e.cs >= 0 || VOID.has(e.tag)));
      const e = hit[sel.nth || 0];
      if (e) return e;
    }
    return null;
  }
  const openOf = (html, e) => html.slice(e.os, e.oe);
  function getAttr(open, name) {
    const m = open.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    return m ? entDec(m[1] ?? m[2]) : null;
  }
  function setAttrIn(open, name, val) {
    const re = new RegExp(`(\\s)${name}(\\s*=\\s*)(?:"[^"]*"|'[^']*')`, 'i');
    if (val === null || val === undefined) return open.replace(new RegExp(`\\s${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'))?`, 'i'), '');
    if (re.test(open)) return open.replace(re, (all, sp, eq) => `${sp}${name}${eq}"${attrEnc(val)}"`);
    return open.replace(/\s*(\/?)>$/, (all, sl) => ` ${name}="${attrEnc(val)}"${sl ? ' /' : ''}>`);
  }
  const replaceOpen = (html, e, open) => html.slice(0, e.os) + open + html.slice(e.oe);

  // --- Texto en línea seguro (lo que escribe el editor en un texto editable) --------------------------------------------------
  function cleanInline(h, plain) {
    let s = String(h == null ? '' : h).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/<\/(div|p)>\s*<(div|p)\b[^>]*>/gi, '<br>').replace(/<\/?(div|p)\b[^>]*>/gi, '');
    const keep = plain ? { br: 1 } : { a: 1, strong: 1, b: 1, em: 1, i: 1, u: 1, s: 1, sub: 1, sup: 1, mark: 1, code: 1, br: 1, del: 1 };
    s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (all, close, tag, rest) => {
      tag = tag.toLowerCase();
      if (!keep[tag]) return '';
      const t2 = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;
      if (close) return t2 === 'br' ? '' : `</${t2}>`;
      if (t2 === 'br') return '<br>';
      if (t2 === 'a') {
        const href = (rest.match(/\shref\s*=\s*"([^"]*)"/i) || rest.match(/\shref\s*=\s*'([^']*)'/i) || [])[1];
        if (!href || !/^(https?:|mailto:|tel:|\/|#)/i.test(entDec(href).trim())) return '';
        const tg = /\starget\s*=\s*["']?_blank/i.test(rest);
        return `<a href="${href}"${tg ? ' target="_blank" rel="noreferrer noopener"' : ''}>`;
      }
      return `<${t2}>`;
    });
    return s.replace(/(<br>\s*)+$/i, '');
  }

  // --- Atributos del comentario -------------------------------------------------------------------------------------------------
  // Igual que serialize_block_attributes de WordPress
  const wpJson = (a) => JSON.stringify(a).replace(/--/g, '\\u002d\\u002d').replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\\"/g, '\\u0022');
  const IDENT = new Set(['uniqueID', 'uniqueId', 'block_id', 'className', 'anchor', 'id', 'blockId', 'ref', 'css', 'styles']);
  // Atributos con exactamente el mismo texto que el que se cambia (p. ej. GenerateBlocks 2 guarda el texto también como atributo)
  function syncStrings(attrs, from, to, skip) {
    if (!from || from === to) return;
    const walk = (o) => {
      for (const k of Object.keys(o)) {
        if (IDENT.has(k) || (skip && skip.includes(k))) continue;
        if (typeof o[k] === 'string' && o[k] === from) o[k] = to;
        else if (o[k] && typeof o[k] === 'object') walk(o[k]);
      }
    };
    walk(attrs);
  }
  const setOrDrop = (attrs, k, v) => { if (v === '' || v === undefined || v === null || v === false) delete attrs[k]; else attrs[k] = v; };

  // --- Qué se sabe editar de cada bloque ----------------------------------------------------------------------------------------
  // texts: [{ k, label, sel:{cls,tag}, req, attr?, plain? }]  attr = atributo del comentario que también guarda el texto (no va solo en el HTML)
  // level: { sel, attr, as:'tag'|'num' } · align: { attr, vals } · color/bg: { attr, label }
  // link: { sel, attrUrl?, empty? ('#' si no hay enlace), blank?:{ attr?, as:'bool'|'str', html:'target', on, off }, rel:'tokens'|'fixed', onclick? }
  // img: { sel }  (solo uagb/image) · cont: true (contenedor, los hijos son bloques de Ecos) · self: true (sin HTML guardado)
  const ALIGN3 = ['left', 'center', 'right'];
  const SPECS = {
    // Spectra (uagb/…): bloques de HTML guardado; los textos van en el HTML, los enlaces también en atributos
    'uagb/container': { plugin: 'spectra', label: 'Contenedor', cont: true },
    'uagb/advanced-heading': {
      plugin: 'spectra', label: 'Título avanzado',
      texts: [{ k: 'title', label: 'Título', sel: { cls: 'uagb-heading-text' }, req: true }, { k: 'desc', label: 'Subtítulo', sel: { cls: 'uagb-desc-text' } }],
      level: { sel: { cls: 'uagb-heading-text' }, attr: 'headingTag', as: 'tag' }, align: { attr: 'headingAlign', vals: ALIGN3 }, color: { attr: 'headingColor', label: 'Color del título' },
    },
    'uagb/buttons': { plugin: 'spectra', label: 'Botones', cont: true },
    'uagb/buttons-child': {
      plugin: 'spectra', label: 'Botón',
      texts: [{ k: 'label', label: 'Texto del botón', sel: { cls: 'uagb-button__link' }, attr: 'label', req: true }],
      link: { sel: { cls: 'uagb-buttons-repeater', tag: 'a' }, attrUrl: 'link', empty: '#', blank: { attr: 'opensInNewTab', as: 'bool', html: 'target', on: '_blank', off: '_self' }, rel: 'fixed' },
      color: { attr: 'color', label: 'Color del texto' }, bg: { attr: 'background', label: 'Color del botón' },
    },
    'uagb/info-box': {
      plugin: 'spectra', label: 'Caja de información',
      texts: [{ k: 'prefix', label: 'Antetítulo', sel: { cls: 'uagb-ifb-title-prefix' } }, { k: 'title', label: 'Título', sel: { cls: 'uagb-ifb-title' }, req: true },
        { k: 'desc', label: 'Descripción', sel: { cls: 'uagb-ifb-desc', tag: 'p' } }, { k: 'cta', label: 'Texto del botón', sel: { cls: 'uagb-inline-editing' }, attr: 'ctaText', plain: true }],
      level: { sel: { cls: 'uagb-ifb-title' }, attr: 'headingTag', as: 'tag' }, align: { attr: 'headingAlign', vals: ALIGN3 }, color: { attr: 'headingColor', label: 'Color del título' },
      link: { sel: { cls: 'uagb-infobox-cta-link', tag: 'a' }, attrUrl: 'ctaLink', empty: '#', blank: { attr: 'ctaTarget', as: 'bool', html: 'target', on: '_blank', off: '_self' }, rel: 'fixed', onclick: true },
    },
    'uagb/icon-list': { plugin: 'spectra', label: 'Lista con iconos', cont: true },
    'uagb/icon-list-child': {
      plugin: 'spectra', label: 'Elemento de lista',
      texts: [{ k: 'label', label: 'Texto', sel: { cls: 'uagb-icon-list__label' }, attr: 'label', req: true }],
      link: { sel: { tag: 'a' }, attrUrl: 'link', blank: { attr: 'target', as: 'bool', html: 'target', on: '_blank', off: '_self' }, rel: 'fixed', needAttr: 'disableLink' },
    },
    'uagb/image': {
      plugin: 'spectra', label: 'Imagen',
      texts: [{ k: 'heading', label: 'Título sobre la imagen', sel: { cls: 'uagb-image-heading' }, attr: 'heading' }, { k: 'caption', label: 'Pie de foto', sel: { cls: 'uagb-image-caption' }, attr: 'caption' }],
      img: { sel: { tag: 'img' } },
    },
    // Kadence Blocks (kadence/…)
    'kadence/rowlayout': { plugin: 'kadence', label: 'Fila', cont: true },
    'kadence/column': { plugin: 'kadence', label: 'Columna', cont: true },
    'kadence/advancedheading': {
      plugin: 'kadence', label: 'Título avanzado',
      texts: [{ k: 'text', label: 'Texto', sel: { cls: 'wp-block-kadence-advancedheading' }, req: true }],
      level: { sel: { cls: 'wp-block-kadence-advancedheading' }, attr: 'level', as: 'num', needNoTag: 'htmlTag' }, align: { attr: 'align', vals: ['left', 'center', 'right', 'justify'] }, color: { attr: 'color', label: 'Color del texto' },
      link: { sel: { cls: 'kb-advanced-heading-link', tag: 'a' }, attrUrl: 'link', blank: { attr: 'linkTarget', as: 'bool', html: 'target', on: '_blank', off: null }, rel: 'tokens' },
    },
    'kadence/advancedbtn': { plugin: 'kadence', label: 'Botones', cont: true },
    'kadence/singlebtn': {
      plugin: 'kadence', label: 'Botón', self: true,
      texts: [{ k: 'text', label: 'Texto del botón', attr: 'text', req: true }],
      link: { attrUrl: 'link', blank: { attr: 'target', as: 'str', on: '_blank', off: '_self' } },
      color: { attr: 'color', label: 'Color del texto' }, bg: { attr: 'background', label: 'Color del botón' },
    },
    'kadence/infobox': {
      plugin: 'kadence', label: 'Caja de información',
      texts: [{ k: 'title', label: 'Título', sel: { cls: 'kt-blocks-info-box-title' } }, { k: 'text', label: 'Texto', sel: { cls: 'kt-blocks-info-box-text' } }, { k: 'more', label: 'Enlace «saber más»', sel: { cls: 'kt-blocks-info-box-learnmore' } }],
      align: { attr: 'hAlign', vals: ALIGN3 }, color: { attr: 'titleColor', label: 'Color del título' },
      link: { sel: { cls: 'info-box-link', tag: 'a' }, blank: { html: 'target', on: '_blank', off: null }, rel: 'tokens' },
      anyText: true,
    },
    'kadence/iconlist': { plugin: 'kadence', label: 'Lista con iconos', cont: true },
    'kadence/listitem': {
      plugin: 'kadence', label: 'Elemento de lista',
      texts: [{ k: 'text', label: 'Texto', sel: { cls: 'kt-svg-icon-list-text' }, req: true }],
      link: { sel: { cls: 'kt-svg-icon-link', tag: 'a' }, attrUrl: 'link', blank: { attr: 'target', as: 'str', html: 'target', on: '_blank', off: null }, rel: 'tokens' },
    },
    // GenerateBlocks (generateblocks/…): estructura documentada de las versiones 1.x y 2.x (sin el código del plugin a mano; ver docs/bloques-terceros.md)
    'generateblocks/container': { plugin: 'generateblocks', label: 'Contenedor', cont: true },
    'generateblocks/grid': { plugin: 'generateblocks', label: 'Cuadrícula', cont: true },
    'generateblocks/element': { plugin: 'generateblocks', label: 'Elemento', cont: true },
    'generateblocks/button-container': { plugin: 'generateblocks', label: 'Botones', cont: true },
    'generateblocks/headline': {
      plugin: 'generateblocks', label: 'Título',
      texts: [{ k: 'text', label: 'Texto', sel: { cls: 'gb-headline-text' }, req: true }],
      level: { sel: { cls: 'gb-headline' }, attr: 'element', as: 'tag' }, align: { attr: 'alignment', vals: ['left', 'center', 'right', 'justify'] }, color: { attr: 'textColor', label: 'Color del texto' },
    },
    'generateblocks/button': {
      plugin: 'generateblocks', label: 'Botón',
      texts: [{ k: 'text', label: 'Texto del botón', sel: { cls: ['gb-button-text', 'gb-button'] }, req: true }],
      link: { sel: { cls: 'gb-button', tag: 'a' }, attrUrl: 'url', blank: { attr: 'target', as: 'bool', html: 'target', on: '_blank', off: null }, rel: 'tokens' },
      color: { attr: 'textColor', label: 'Color del texto' }, bg: { attr: 'backgroundColor', label: 'Color del botón' },
    },
    'generateblocks/text': {
      plugin: 'generateblocks', label: 'Texto',
      texts: [{ k: 'text', label: 'Texto', sel: { cls: 'gb-text' }, req: true }],
      level: { sel: { cls: 'gb-text' }, attr: 'tagName', as: 'tag' },
      link: { sel: { cls: 'gb-text', tag: 'a' } },
    },
  };
  const PLUGIN_NAMES = { spectra: 'Spectra', kadence: 'Kadence', generateblocks: 'GenerateBlocks' };
  const isThird = (name) => Object.prototype.hasOwnProperty.call(SPECS, name);

  // --- Leer un bloque ------------------------------------------------------------------------------------------------------------
  // t: { name, attrs, inner, raw } (de tokenize) · env: { bid, tokenize, toBlock } · devuelve el bloque de Ecos o null (= se queda «raw»)
  function read(t, env) {
    const spec = SPECS[t.name];
    if (!spec) return null;
    try { return readSpec(t, spec, env); } catch { return null; }
  }
  function readSpec(t, spec, env) {
    const om = String(t.raw).match(/^<!--\s+wp:([a-z0-9-]+\/[a-z0-9-]+)(?:\s+(\{[\s\S]*?\}))?\s*(\/)?-->/);
    if (!om || om[1] !== t.name) return null;
    const open = om[0], selfClosing = !!om[3];
    let attrs = {};
    if (om[2]) { attrs = JSON.parse(om[2]); if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null; }
    const b = { id: env.bid(), type: 'third', name: t.name, plugin: spec.plugin, open, a0: JSON.stringify(attrs), attrs };
    if (spec.self) {
      if (!selfClosing || t.raw !== open) return null;
      b.self = true;
      for (const x of spec.texts || []) if (x.req && attrs[x.attr] !== undefined && typeof attrs[x.attr] !== 'string') return null;
      return b;
    }
    if (selfClosing) return null;
    const close = String(t.raw).slice(open.length + t.inner.length);
    if (!/^<!--\s+\/wp:[a-z0-9-]+\/[a-z0-9-]+\s*-->$/.test(close) || open + t.inner + close !== t.raw) return null;
    b.close = close;
    if (spec.cont) return readContainer(t, b, env);
    const html = t.inner;
    if (/<!--\s+\/?wp:/.test(html)) return null; // hijos que no esperamos
    b.html = html;
    // todo lo necesario tiene que estar (si no, el bloque es de otra versión)
    for (const x of spec.texts || []) {
      if (x.req && !find(html, x.sel)) return null;
      if (x.sel && find(html, x.sel) && !textFits(html, find(html, x.sel))) return null;
    }
    if (spec.anyText && !(spec.texts || []).some((x) => find(html, x.sel))) return null;
    if (spec.img && !find(html, spec.img.sel)) return null;
    return b;
  }
  // El texto de un hueco no puede llevar etiquetas de bloque (div, ul…) dentro: solo texto en línea
  const textFits = (html, e) => e.cs >= 0 && !/<(div|ul|ol|li|section|figure|p|h[1-6]|table|form|svg|img)\b/i.test(html.slice(e.oe, e.cs));
  function readContainer(t, b, env) {
    const toks = env.tokenize(t.inner);
    const kids = toks.filter((x) => x.name !== 'freeform');
    let pos = 0, first = -1, last = 0;
    const gaps = [];
    const children = [];
    for (const k of kids) {
      const at = t.inner.indexOf(k.raw, pos);
      if (at < 0) return null;
      if (first < 0) first = at; else gaps.push(t.inner.slice(last, at));
      last = at + k.raw.length; pos = last;
      const c = env.toBlock(k);
      if (!c) return null;
      if (Array.isArray(c)) { if (!c.length) return null; children.push(...c); } else children.push(c);
    }
    if (!kids.length) { first = t.inner.length; last = t.inner.length; }
    if (gaps.some((g) => g.trim() || g !== gaps[0])) return null;
    b.pre = t.inner.slice(0, first); b.post = t.inner.slice(last);
    if (/<!--\s+\/?wp:/.test(b.pre + b.post)) return null;
    b.sep = gaps.length ? gaps[0] : '\n\n';
    b.children = children;
    return b;
  }

  // --- Escribir un bloque --------------------------------------------------------------------------------------------------------
  // env: { composeList(blocks) → texto de WordPress }
  function openOf2(b) {
    if (JSON.stringify(b.attrs || {}) === b.a0) return b.open; // atributos intactos: el comentario original, byte a byte
    const json = Object.keys(b.attrs || {}).length ? ' ' + wpJson(b.attrs) : '';
    return `<!-- wp:${b.name}${json}${b.self ? ' /-->' : ' -->'}`;
  }
  function compose(b, env) {
    if (!b || !isThird(b.name) || typeof b.open !== 'string') return '';
    const open = openOf2(b);
    if (b.self) return open;
    const kids = Array.isArray(b.children) ? b.children.map((c) => env.composeList([c])).filter(Boolean).join(b.sep ?? '\n\n') : null;
    const body = kids === null ? b.html || '' : (b.pre || '') + kids + (b.post || '');
    return open + body + b.close;
  }

  // --- Lo que se puede editar (para la interfaz) ------------------------------------------------------------------------------
  const specOf = (b) => SPECS[b.name] || null;
  const attrsOf = (b) => (b.attrs || (b.attrs = {}));
  // Textos: [{ k, label, v (HTML), plain }] de los huecos que existen en el bloque
  function texts(b) {
    const sp = specOf(b);
    const out = [];
    for (const x of (sp && sp.texts) || []) {
      if (b.self) { const v = attrsOf(b)[x.attr]; out.push({ k: x.k, label: x.label, v: v == null ? '' : String(v), plain: !!x.plain }); continue; }
      const e = find(b.html || '', x.sel);
      if (e && textFits(b.html, e)) out.push({ k: x.k, label: x.label, v: b.html.slice(e.oe, e.cs), plain: !!x.plain });
    }
    return out;
  }
  function setText(b, k, value) {
    const sp = specOf(b), x = ((sp && sp.texts) || []).find((y) => y.k === k);
    if (!x) return false;
    const v = cleanInline(value, x.plain);
    const attrs = attrsOf(b);
    if (b.self) { const old = attrs[x.attr]; if (old === v) return true; if (v === '' && !('text' in attrs)) return true; attrs[x.attr] = v; return true; }
    const e = find(b.html, x.sel);
    if (!e || !textFits(b.html, e)) return false;
    const old = b.html.slice(e.oe, e.cs);
    if (old === v) return true;
    b.html = b.html.slice(0, e.oe) + v + b.html.slice(e.cs);
    if (x.attr) { if (v === '') delete attrs[x.attr]; else attrs[x.attr] = v; } // atributo propio (no sale solo del HTML)
    syncStrings(attrs, old, v, x.attr ? [x.attr] : null);
    return true;
  }

  // Enlace
  const REL_TOKENS = ['noopener', 'noreferrer'];
  function linkOf(b) {
    const sp = specOf(b), L = sp && sp.link;
    if (!L) return null;
    const attrs = attrsOf(b);
    if (L.needAttr && !attrs[L.needAttr]) return null;
    if (b.self) {
      const bl = L.blank;
      return { url: attrs[L.attrUrl] || '', blank: !!(bl && (bl.as === 'bool' ? attrs[bl.attr] : attrs[bl.attr] === bl.on)), canBlank: !!L.blank };
    }
    const e = find(b.html || '', L.sel);
    if (!e || e.tag !== 'a') return null;
    const op = openOf(b.html, e);
    let url = getAttr(op, 'href') || '';
    if (L.empty && url === L.empty) url = '';
    const target = getAttr(op, 'target');
    return { url, blank: target === '_blank', canBlank: !!L.blank };
  }
  function setLink(b, patch) {
    const sp = specOf(b), L = sp && sp.link;
    const cur = linkOf(b);
    if (!L || !cur) return false;
    const attrs = attrsOf(b);
    const url = patch.url !== undefined ? String(patch.url).trim() : cur.url;
    if (url && !/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) return false;
    const blank = patch.blank !== undefined && L.blank ? !!patch.blank : cur.blank;
    if (b.self) {
      setOrDrop(attrs, L.attrUrl, url);
      if (L.blank) { if (L.blank.as === 'bool') setOrDrop(attrs, L.blank.attr, blank); else if (blank) attrs[L.blank.attr] = L.blank.on; else delete attrs[L.blank.attr]; }
      return true;
    }
    const e = find(b.html, L.sel);
    let op = openOf(b.html, e);
    if (patch.url !== undefined) {
      const old = getAttr(op, 'href');
      op = setAttrIn(op, 'href', url || L.empty || '');
      if (L.onclick) { const m = op.match(/\s(onclick)\s*=\s*"[^"]*"/i); if (m) op = op.replace(m[0], ` ${m[1]}="${url && url !== '#' ? 'return true;' : 'return false;'}"`); }
      if (L.attrUrl) { setOrDrop(attrs, L.attrUrl, url); }
      syncStrings(attrs, old, url || L.empty || '', L.attrUrl ? [L.attrUrl] : null);
    }
    if (patch.blank !== undefined && L.blank) {
      if (L.blank.html) op = setAttrIn(op, L.blank.html, blank ? L.blank.on : L.blank.off);
      if (L.rel === 'tokens') {
        const toks = (getAttr(op, 'rel') || '').split(/\s+/).filter(Boolean).filter((x) => !REL_TOKENS.includes(x));
        const next = blank ? [...REL_TOKENS, ...toks] : toks;
        op = setAttrIn(op, 'rel', next.length ? next.join(' ') : null);
      }
      if (L.blank.attr) { if (L.blank.as === 'bool') setOrDrop(attrs, L.blank.attr, blank); else if (blank) attrs[L.blank.attr] = L.blank.on; else delete attrs[L.blank.attr]; }
    }
    b.html = replaceOpen(b.html, e, op);
    return true;
  }

  // Nivel del título
  function levelOf(b) {
    const sp = specOf(b), L = sp && sp.level;
    if (!L || b.self) return 0;
    if (L.needNoTag && attrsOf(b)[L.needNoTag] && attrsOf(b)[L.needNoTag] !== 'heading') return 0;
    const e = find(b.html || '', L.sel);
    const m = e && e.tag.match(/^h([1-6])$/);
    return m ? Number(m[1]) : 0;
  }
  function setLevel(b, n) {
    const L = (specOf(b) || {}).level;
    if (!L || !levelOf(b) || !(n >= 1 && n <= 6)) return false;
    const e = find(b.html, L.sel);
    const tag = 'h' + n;
    let html = b.html;
    html = html.slice(0, e.cs) + `</${tag}>` + html.slice(e.ce);
    html = html.slice(0, e.os) + html.slice(e.os, e.oe).replace(/^<[a-zA-Z0-9]+/, '<' + tag) + html.slice(e.oe);
    b.html = html;
    const attrs = attrsOf(b);
    attrs[L.attr] = L.as === 'num' ? n : tag;
    return true;
  }

  // Alineación y colores (atributos sencillos del bloque)
  const alignOf = (b) => { const L = (specOf(b) || {}).align; return L ? attrsOf(b)[L.attr] || '' : ''; };
  function setAlign(b, v) { const L = (specOf(b) || {}).align; if (!L || !(L.vals.includes(v) || v === '')) return false; setOrDrop(attrsOf(b), L.attr, v); return true; }
  const colorOf = (b, which) => { const L = (specOf(b) || {})[which]; const v = L ? attrsOf(b)[L.attr] : ''; return typeof v === 'string' ? v : ''; };
  function setColor(b, which, v) {
    const L = (specOf(b) || {})[which];
    if (!L || (v && !/^#[0-9a-f]{3,8}$/i.test(v))) return false;
    setOrDrop(attrsOf(b), L.attr, v || '');
    return true;
  }

  // Imagen (uagb/image): se cambia la foto en el HTML (src, srcset, clase, alt) y en los atributos (url, id, alt, medidas)
  function imageOf(b) {
    const L = (specOf(b) || {}).img;
    if (!L || b.self) return null;
    const e = find(b.html || '', L.sel);
    if (!e) return null;
    const op = openOf(b.html, e);
    return { url: getAttr(op, 'src') || '', alt: getAttr(op, 'alt') || '' };
  }
  function setImage(b, m) {
    const L = (specOf(b) || {}).img;
    if (!L || !m || !/^https?:\/\//i.test(String(m.url || ''))) return false;
    const e = find(b.html, L.sel);
    if (!e) return false;
    const attrs = attrsOf(b);
    let op = openOf(b.html, e);
    const old = getAttr(op, 'src');
    op = setAttrIn(op, 'src', m.url);
    const ss = getAttr(op, 'srcset');
    if (ss !== null) op = setAttrIn(op, 'srcset', m.url + (/\s$/.test(ss) ? ' ' : ''));
    const cl = getAttr(op, 'class');
    if (cl !== null && /uag-image-\d+/.test(cl)) op = setAttrIn(op, 'class', Number(m.id) ? cl.replace(/uag-image-\d+/, 'uag-image-' + Number(m.id)) : cl.replace(/\s*uag-image-\d+/, '') || null);
    if (m.alt !== undefined && getAttr(op, 'role') !== 'presentation') { op = setAttrIn(op, 'alt', m.alt || ''); setOrDrop(attrs, 'alt', m.alt || ''); }
    if (Number(m.id)) attrs.id = Number(m.id); else delete attrs.id;
    attrs.url = m.url; delete attrs.urlTablet; delete attrs.urlMobile;
    const w = Number(m.width) || 0, h = Number(m.height) || 0;
    if (w && h) { attrs.naturalWidth = w; attrs.naturalHeight = h; if (attrs.width === undefined) op = setAttrIn(setAttrIn(op, 'width', String(w)), 'height', String(h)); }
    else if (attrs.width === undefined) { delete attrs.naturalWidth; delete attrs.naturalHeight; op = setAttrIn(setAttrIn(op, 'width', null), 'height', null); }
    b.html = replaceOpen(b.html, e, op);
    syncStrings(attrs, old, m.url, ['url']);
    return true;
  }
  function setAlt(b, alt) {
    const L = (specOf(b) || {}).img;
    const e = L && !b.self ? find(b.html || '', L.sel) : null;
    if (!e) return false;
    if (getAttr(openOf(b.html, e), 'role') === 'presentation') return false;
    b.html = replaceOpen(b.html, e, setAttrIn(openOf(b.html, e), 'alt', String(alt || '')));
    setOrDrop(attrsOf(b), 'alt', String(alt || ''));
    return true;
  }

  // HTML para la vista del editor: sin scripts, estilos, marcos ni manejadores de eventos
  function previewHtml(b) {
    let h = b.self ? '' : String(b.html || '');
    h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed|noscript)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s(href|src|srcset)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
    return h;
  }
  // Texto plano del bloque (para la lista de capas)
  const plainText = (b) => texts(b).map((x) => x.v).join(' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  const api = { SPECS, PLUGIN_NAMES, isThird, read, compose, texts, setText, linkOf, setLink, levelOf, setLevel, alignOf, setAlign, colorOf, setColor, imageOf, setImage, setAlt, previewHtml, plainText, cleanInline, wpJson, find, scan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ThirdParty = api;
})(typeof window !== 'undefined' ? window : globalThis);
