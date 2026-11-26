// Ecos · Revisión de accesibilidad: lógica pura (sin DOM). Sirve en el editor (renderer/format.js, renderer/app/a11y-ui.js) y en las pruebas.
// analyze(blocks, opts) recorre los bloques (también los anidados) y devuelve { issues, score, counts, summary }.
// Cada aviso: { id, code, level: 'error'|'aviso'|'sugerencia', blockId, title, why, fix?, info? }.
// applyFix(block, fix) aplica el arreglo automático a un bloque (el editor lo llama dentro de changeBlock).
(function (root) {
  // --- Color -----------------------------------------------------------------------------------------------------
  const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', transparent: 'rgba(0,0,0,0)' };
  function parseColor(c) {
    let s = String(c || '').trim().toLowerCase();
    if (!s) return null;
    if (NAMED[s]) s = NAMED[s];
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    }
    m = s.match(/^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/);
    if (m) {
      const ch = (v, p) => Math.max(0, Math.min(255, Math.round(p ? Number(v) * 2.55 : Number(v))));
      const a = m[7] === undefined ? 1 : Math.max(0, Math.min(1, m[8] ? Number(m[7]) / 100 : Number(m[7])));
      return { r: ch(m[1], m[2]), g: ch(m[3], m[4]), b: ch(m[5], m[6]), a };
    }
    return null;
  }
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  // Color `top` (con su opacidad, o `alpha`) puesto sobre `base` (opaco)
  function blend(top, base, alpha) {
    const a = alpha === undefined ? top.a : alpha;
    return { r: top.r * a + base.r * (1 - a), g: top.g * a + base.g * (1 - a), b: top.b * a + base.b * (1 - a), a: 1 };
  }
  // Luminancia relativa (WCAG 2.1)
  function luminance(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) {
    a = typeof a === 'string' ? parseColor(a) : a; b = typeof b === 'string' ? parseColor(b) : b;
    if (!a || !b) return null;
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  const minRatio = (fg, bgs) => Math.min(...bgs.map((b) => ratio(blend(fg, b), b)));
  function rgb2hsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return { h: 0, s: 0, l };
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h / 6, s, l };
  }
  function hsl2rgb({ h, s, l }) {
    if (!s) return { r: l * 255, g: l * 255, b: l * 255, a: 1 };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
    return { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3), a: 1 };
  }
  // Un color del mismo tono (más oscuro o más claro) que cumple `min` contra todos los fondos; si no se puede, el negro o el blanco
  function suggestColor(fg, bgs, min = 4.5) {
    const c = typeof fg === 'string' ? parseColor(fg) : fg;
    bgs = (Array.isArray(bgs) ? bgs : [bgs]).map((b) => (typeof b === 'string' ? parseColor(b) : b)).filter(Boolean);
    if (!c || !bgs.length) return null;
    const base = rgb2hsl(c), ok = (rgb) => minRatio(rgb, bgs) >= min;
    const tryDir = (dir) => {
      for (let i = 0; i <= 100; i++) {
        const l = Math.max(0, Math.min(1, base.l + dir * i / 100));
        const rgb = hsl2rgb({ ...base, l });
        if (ok(rgb)) return { rgb, steps: i };
        if (l === 0 || l === 1) break;
      }
      return null;
    };
    const dk = tryDir(-1), lt = tryDir(1);
    const best = dk && lt ? (dk.steps <= lt.steps ? dk : lt) : dk || lt;
    if (best) return hex(best.rgb);
    const bk = { r: 0, g: 0, b: 0, a: 1 }, wh = { r: 255, g: 255, b: 255, a: 1 };
    return hex(minRatio(bk, bgs) >= minRatio(wh, bgs) ? bk : wh);
  }

  // --- Texto -----------------------------------------------------------------------------------------------------
  const plain = (h) => String(h ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const words = (h) => { const s = plain(h).trim(); return s ? s.split(/\s+/).length : 0; };
  const TEXT_TYPES = ['paragraph', 'heading', 'list', 'quote', 'mediatext'];
  const textOf = (b) => (b.type === 'list' ? (b.items || []).join(' ') : b.html || '');
  const HEAD_PX = { 1: 40, 2: 32, 3: 26, 4: 22, 5: 18 };
  // «16px», «1.25rem», «120%» → px (null si no se sabe)
  function toPx(v, base = 16) {
    const m = String(v ?? '').trim().match(/^([\d.]+)\s*(px|rem|em|%)?$/i);
    if (!m) return null;
    const n = Number(m[1]), u = (m[2] || 'px').toLowerCase();
    return u === 'px' ? n : u === '%' ? n * base / 100 : n * base;
  }
  const sizeOf = (b) => toPx(b.size) ?? (b.th?.size ? toPx(b.th.size.v) : null) ?? (b.type === 'heading' ? HEAD_PX[b.level || 2] || 32 : b.type === 'quote' ? 18 : 16);
  const GENERIC = /^(aqu[ií]|pincha(\s+aqu[ií])?|pulsa(\s+aqu[ií])?|haz\s+clic(\s+aqu[ií])?|clic(\s+aqu[ií])?|click(\s+here)?|m[aá]s(\s+info(rmaci[oó]n)?)?|info(rmaci[oó]n)?|leer\s+m[aá]s|ver\s+m[aá]s|saber\s+m[aá]s|enlace|link|ver|ir|here|read\s+more|more(\s+info)?|this\s+link)$/i;
  const BAD_BTN = /^(ok|vale|enviar|bot[oó]n|button|click|clic|submit|aceptar|ir|ver|m[aá]s)$/i;
  const NEWWIN = /nueva\s+(ventana|pesta[ñn]a)|(ventana|pesta[ñn]a)\s+nueva|new\s+(window|tab)|se abre fuera/i;
  const FILE_ALT = /(\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)$)|^(img|dsc|dscn|image|imagen|photo|foto|picture|pic|screenshot|captura|whatsapp image)[-_ .]*\d*$|^(imagen|image|foto|photo|picture|sin t[ií]tulo|untitled)$/i;
  const FILE_ALT2 = /^[\w-]+_\d{3,}(\.\w+)?$|^\d{6,}[\w-]*$/;

  // Colores (de fondo) de un degradado
  const gradColors = (g) => (String(g || '').match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || []).map(parseColor).filter(Boolean);
  const themed = (b, k, theme) => b[k] || b.th?.[k]?.v || (b.th?.[k]?.slug && theme?.[b.th[k].slug]) || '';

  // --- Análisis ------------------------------------------------------------------------------------------------------
  function analyze(blocks, opts = {}) {
    const issues = [];
    const pageBg = parseColor(opts.pageBg) || { r: 255, g: 255, b: 255, a: 1 };
    const pageText = parseColor(opts.textColor) || { r: 31, g: 31, b: 31, a: 1 };
    const theme = opts.theme || {};
    const IMG_EST = { r: 128, g: 128, b: 128, a: 1 }; // foto desconocida: gris medio
    let n = 0;
    const add = (code, level, b, title, why, extra = {}) => issues.push({ id: `${code}:${b?.id || 'doc'}:${n++}`, code, level, blockId: b?.id || null, title, why, ...extra });

    const order = []; // títulos en orden de documento
    let run = { words: 0, first: null, flagged: false }; // texto seguido sin título

    // ctx: { bgs: [colores opacos], text: color por defecto, estimated: bool (fondo = foto) }
    function walk(list, ctx) {
      for (const b of list || []) {
        let c = ctx;
        // fondo propio (sección, columnas y bloques de texto con fondo; en los demás tipos es fbg/fgr)
        const bgKey = ['paragraph', 'heading', 'list', 'quote', 'group', 'columns', 'mediatext'].includes(b.type) ? ['bg', 'gradient'] : ['fbg', 'fgr'];
        const own = themed(b, bgKey[0], theme), ownG = b[bgKey[1]];
        if (b.type === 'cover') {
          const ov = parseColor(b.overlay) || { r: 0, g: 0, b: 0, a: 1 };
          const dim = Math.max(0, Math.min(100, Number(b.dim ?? 50))) / 100;
          const photo = !!((b.img && b.img.url) || b.bgVideo);
          const g = gradColors(b.gradient);
          const under = photo ? [IMG_EST] : ctx.bgs;
          const bgs = g.length ? g.map((x) => blend(x, ctx.bgs[0])) : under.map((u) => blend(ov, u, dim));
          const dark = dim < 0.4 && photo ? true : g.length ? true : luminance(ov) < 0.2;
          c = { bgs, text: dark ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 }, estimated: photo };
        } else if (ownG && gradColors(ownG).length) {
          c = { bgs: gradColors(ownG).map((x) => blend(x, ctx.bgs[0])), text: ctx.text, estimated: ctx.estimated };
        } else if (own && parseColor(own)) {
          c = { bgs: ctx.bgs.map((u) => blend(parseColor(own), u)), text: ctx.text, estimated: false };
        }
        // foto de fondo con velo (panel de diseño)
        if (b.bgi && b.bgi.url && b.type !== 'cover') {
          const dim = Math.max(0, Math.min(80, Number(b.bgi.dim) || 0)) / 100;
          c = { bgs: [blend({ r: 0, g: 0, b: 0, a: 1 }, IMG_EST, dim)], text: c.text, estimated: true };
        }
        // el color del texto de una sección/columna se hereda
        if (['group', 'columns'].includes(b.type) && themed(b, 'color', theme) && parseColor(themed(b, 'color', theme))) c = { ...c, text: parseColor(themed(b, 'color', theme)) };

        if (TEXT_TYPES.includes(b.type)) checkText(b, c);
        if (b.type === 'buttons') checkButton(b, c);
        checkImages(b);
        if (b.type === 'video' || (b.type === 'embed' && /youtube|vimeo|video/i.test(b.provider || b.url || ''))) {
          if (!plain(b.caption || '').trim() && !(b.video && (b.video.captions || b.video.tracks))) {
            add('video-sin-subtitulos', 'sugerencia', b, 'Vídeo sin descripción', 'Si el vídeo habla, activa los subtítulos en la plataforma donde lo subas y añade debajo un pie con un resumen: así lo entienden también las personas que no oyen.');
          }
        }
        if (b.an) anim.push(b);
        if (b.type === 'heading') order.push(b);
        // texto largo sin subtítulos
        if (b.type === 'heading') run = { words: 0, first: null, flagged: false };
        else if (['paragraph', 'list', 'quote', 'mediatext'].includes(b.type)) {
          run.words += words(textOf(b)); run.first ||= b;
          if (run.words > 400 && !run.flagged) { run.flagged = true; add('texto-largo', 'sugerencia', run.first, 'Mucho texto seguido', 'Hay más de 400 palabras sin ningún subtítulo. Dividirlo con títulos ayuda a leerlo y a moverse por él con un lector de pantalla.'); }
        }
        if (Array.isArray(b.children)) walk(b.children, c);
        if (Array.isArray(b.cols)) for (const col of b.cols) walk(col.children, c);
      }
    }

    const anim = [];

    function checkText(b, c) {
      const txt = plain(textOf(b));
      checkLinks(b, b.type === 'list' ? (b.items || []).join('\n') : b.html || '');
      if (!txt.trim()) return;
      const px = sizeOf(b);
      const bold = b.type === 'heading';
      const large = px >= 24 || (bold && px >= 18.66);
      const need = large ? 3 : 4.5;
      const fgRaw = themed(b, 'color', theme);
      const fgs = [];
      fgs.push({ val: fgRaw ? parseColor(fgRaw) : c.text, set: !!fgRaw, inline: false });
      // colores puestos a mano dentro del texto
      const inl = new Set();
      for (const m of String(textOf(b)).matchAll(/color\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)) inl.add(m[1]);
      for (const v of inl) fgs.push({ val: parseColor(v), set: true, inline: v });
      const rowBg = c.bgs;
      let reported = false;
      for (const f of fgs) {
        if (!f.val || reported) continue;
        if (f.val.a < 1) f.val = blend(f.val, rowBg[0]);
        const r = minRatio(f.val, rowBg);
        if (r >= need) continue;
        const sug = suggestColor(f.val, rowBg, need);
        const rs = Math.round(r * 10) / 10;
        reported = true;
        const est = c.estimated;
        const vars = { r: String(rs).replace('.', ','), n: String(need).replace('.', ',') };
        add('contraste', r < 3 ? 'error' : 'aviso', b,
          'Poco contraste del texto ({r}:1)', est ? 'Sobre una foto es difícil acertar: con una foto media, el texto se lee con un contraste de {r}:1 y hace falta {n}:1. Oscurece más la foto o cambia el color del texto.' : (large ? 'El texto y su fondo se parecen demasiado ({r}:1; en texto grande hace falta {n}:1). A mucha gente le costará leerlo.' : 'El texto y su fondo se parecen demasiado ({r}:1; hace falta {n}:1). A mucha gente le costará leerlo.'),
          { vars, ratio: rs, need, ...(sug ? { fix: { kind: f.inline ? 'inlinecolor' : 'color', from: f.inline || undefined, to: sug, label: 'Usar un color más legible' } } : {}) });
      }
      // tamaño en móvil
      const mob = Number(b.fsm) || px;
      if (mob < 14) {
        add('texto-pequeno', 'aviso', b, 'Letra muy pequeña en el móvil ({px} px)', 'En el móvil, por debajo de 14 px cuesta leer. Se recomienda 16 px.',
          { vars: { px: Math.round(mob) }, fix: { kind: 'mobilesize', to: 16, label: 'Poner 16 px en móvil' } });
      }
      // mayúsculas largas
      const letters = txt.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
      const typedCaps = letters.length > 60 && txt.length > 80 && letters === letters.toUpperCase();
      if (b.tt === 'uppercase' ? txt.length > 80 : typedCaps) {
        add('mayusculas', 'sugerencia', b, 'Texto largo en mayúsculas', 'Leer frases enteras en MAYÚSCULAS es más lento, y algunos lectores de pantalla deletrean las letras. Reserva las mayúsculas para palabras sueltas.',
          { fix: { kind: b.tt === 'uppercase' ? 'notransform' : 'sentencecase', label: b.tt === 'uppercase' ? 'Quitar las mayúsculas' : 'Pasar a minúsculas' } });
      }
      // listas hechas a mano
      if (b.type === 'paragraph') {
        const lines = String(b.html || '').split(/<br\s*\/?>|\n/i).map((l) => plain(l).trim()).filter(Boolean);
        const dash = lines.length >= 2 && lines.every((l) => /^[-–—•*·]\s+\S/.test(l));
        const num = lines.length >= 2 && lines.every((l) => /^\d{1,2}[.)]\s+\S/.test(l));
        if (dash || num) add('lista-manual', 'aviso', b, 'Lista hecha con guiones', 'Los guiones a mano no son una lista de verdad: un lector de pantalla no avisa de cuántos elementos hay. Conviértela en una lista.', { fix: { kind: 'list', ordered: num, label: 'Convertir en lista' } });
      }
    }

    function checkLinks(b, html) {
      for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const attrs = m[1], inner = m[2];
        const label = plain(inner).replace(/\s+/g, ' ').trim();
        const hasImgAlt = /<img[^>]+alt="[^"]+"/i.test(inner);
        if (!label && !hasImgAlt && !/aria-label="[^"]+"/i.test(attrs)) { add('enlace-vacio', 'error', b, 'Enlace sin texto', 'Este enlace no tiene texto: un lector de pantalla solo dirá «enlace». Escribe qué hay al otro lado.'); continue; }
        if (GENERIC.test(label)) add('enlace-generico', 'aviso', b, 'Enlace con texto poco claro: «{label}»', 'Quien navega con lector de pantalla oye una lista de enlaces sin contexto. Usa un texto que diga a dónde lleva, por ejemplo «Programa de las jornadas».', { vars: { label }, label });
        if (/target\s*=\s*["']?_blank/i.test(attrs) && !NEWWIN.test(label) && !NEWWIN.test(attrs)) {
          add('enlace-ventana', 'sugerencia', b, 'El enlace «{label}» se abre en una ventana nueva', 'Abrir una ventana sin avisar desorienta a algunas personas. Añade «(ventana nueva)» al texto del enlace.', { vars: { label: label.slice(0, 40) }, fix: { kind: 'newwin', label: 'Avisar en el texto' } });
        }
      }
    }

    function checkButton(b, c) {
      const label = plain(b.html || '').trim();
      if (!label) return;
      if (GENERIC.test(label) || BAD_BTN.test(label) || label.length < 3) add('boton-generico', 'aviso', b, 'Botón con texto poco descriptivo: «{label}»', 'El texto del botón debe decir qué pasa al pulsarlo, por ejemplo «Descargar el programa» o «Apuntarme al taller».', { vars: { label } });
      const outline = b.variant === 'outline';
      const fg = themed(b, 'color', theme) ? parseColor(themed(b, 'color', theme)) : null;
      const bg = !outline && themed(b, 'bg', theme) ? parseColor(themed(b, 'bg', theme)) : null;
      let bgs = null, f = fg;
      if (bg && fg) bgs = [bg];
      else if (outline && fg) bgs = c.bgs;
      if (!bgs || !f) return;
      const px = toPx(b.size) || 16;
      const need = px >= 24 ? 3 : 4.5;
      const r = minRatio(f, bgs);
      if (r < need) {
        const sug = suggestColor(f, bgs, need), rs = Math.round(r * 10) / 10;
        add('contraste', r < 3 ? 'error' : 'aviso', b, 'Poco contraste en el botón ({r}:1)', 'El texto del botón y su fondo se parecen demasiado ({r}:1; hace falta {n}:1).', { vars: { r: String(rs).replace('.', ','), n: String(need).replace('.', ',') }, ratio: rs, need, ...(sug ? { fix: { kind: 'color', to: sug, label: 'Usar un color más legible' } } : {}) });
      }
    }

    function checkImages(b) {
      const list = [];
      if (b.type === 'cover') { /* la foto de fondo es decorativa */ } else if (b.img) list.push([b.img, -1]);
      else if (Array.isArray(b.images)) b.images.forEach((im, k) => list.push([im, k]));
      for (const [im, k] of list) {
        if (!im || im.type === 'video') continue;
        const alt = String(im.alt || '').trim();
        const fix = { kind: 'alt', idx: k, label: 'Describir la foto' };
        if (!alt) add('alt-falta', 'error', b, 'Foto sin descripción', 'Las personas ciegas no pueden ver la foto: necesita un texto alternativo que cuente qué se ve.', { fix, imgUrl: im.url, idx: k });
        else if (FILE_ALT.test(alt) || FILE_ALT2.test(alt)) add('alt-malo', 'aviso', b, 'La descripción de la foto no describe nada: «{alt}»', 'Parece el nombre del archivo o una palabra genérica. Cuenta qué se ve en la foto en una frase.', { vars: { alt: alt.slice(0, 40) }, fix, imgUrl: im.url, idx: k });
        else if (alt.length > 150) add('alt-largo', 'sugerencia', b, 'Descripción de la foto muy larga', 'Lo ideal es una frase corta (menos de 125 caracteres). Si hace falta más, ponlo en el pie de foto.', { idx: k });
      }
    }

    walk(blocks, { bgs: [pageBg], text: pageText, estimated: false });

    // orden de los títulos
    let prev = 1; // el tema pone el H1
    order.forEach((h, i) => {
      if (!plain(h.html).trim()) return;
      const lv = Number(h.level) || 2;
      if (lv === 1) { add('titulo-h1', 'aviso', h, 'Hay un título de nivel 1 en el texto', 'El título de la entrada ya es el H1 de la página; solo debe haber uno. Usa H2 para las secciones.', { fix: { kind: 'level', to: 2, label: 'Pasar a H2' } }); prev = Math.max(prev, 1); return; }
      if (lv > prev + 1) {
        const to = prev + 1;
        add('titulo-salto', 'aviso', h, 'Salto de título: de H{a} a H{b}', 'Los títulos van por orden (H2, luego H3…): así se entiende la estructura sin ver la página. Aquí debería ir un H{c}.', { vars: { a: prev, b: lv, c: to }, fix: { kind: 'level', to, label: `Pasar a H${to}` } });
        prev = to;
      } else prev = lv;
    });

    if (anim.length) add('animaciones', 'sugerencia', anim[0], '{n} bloque(s) con animación', 'Las animaciones se desactivan solas para quien tiene activado «reducir movimiento» en su dispositivo, así que no hace falta que hagas nada.', { vars: { n: anim.length }, info: true });

    return summarize(issues);
  }

  const PEN = { error: 10, aviso: 4, sugerencia: 1 };
  function summarize(issues) {
    const counts = { error: 0, aviso: 0, sugerencia: 0 };
    let pen = 0;
    for (const i of issues) { counts[i.level]++; if (!i.info) pen += PEN[i.level]; }
    const score = Math.max(0, Math.min(100, 100 - pen));
    return { issues, score, counts, summary: summaryText({ score, counts }) };
  }
  function summaryText({ score, counts }) {
    const parts = [];
    if (counts.error) parts.push(`${counts.error} ${counts.error === 1 ? 'error' : 'errores'}`);
    if (counts.aviso) parts.push(`${counts.aviso} ${counts.aviso === 1 ? 'aviso' : 'avisos'}`);
    if (counts.sugerencia) parts.push(`${counts.sugerencia} ${counts.sugerencia === 1 ? 'sugerencia' : 'sugerencias'}`);
    return `Accesibilidad: ${score}/100` + (parts.length ? ' · ' + parts.join(' · ') : '');
  }

  // --- Arreglos ----------------------------------------------------------------------------------------------------
  const mapText = (html, fn) => String(html).replace(/(<[^>]*>)|([^<]+)/g, (m, tag, txt) => (tag ? tag : fn(txt)));
  // Minúsculas con la primera letra de cada frase en mayúscula (solo el texto, no las etiquetas)
  const sentence = (html) => {
    let cap = true;
    return mapText(html, (txt) => txt.toLowerCase().replace(/[^.!?¡¿\s]|[.!?¡¿]+/g, (ch) => {
      if (/^[.!?¡¿]/.test(ch)) { cap = true; return ch; }
      if (cap) { cap = false; return ch.toUpperCase(); }
      return ch;
    }));
  };
  // Aplica un arreglo a un bloque (modifica `b`). Devuelve true si cambió algo.
  function applyFix(b, fix) {
    if (!b || !fix) return false;
    switch (fix.kind) {
      case 'color':
        if (!/^#[0-9a-f]{6}$/i.test(fix.to || '')) return false;
        b.color = fix.to;
        if (b.th) { delete b.th.color; if (!Object.keys(b.th).length) delete b.th; }
        return true;
      case 'inlinecolor': {
        const to = fix.to; if (!fix.from || !/^#[0-9a-f]{6}$/i.test(to || '')) return false;
        const rep = (h) => String(h).split(fix.from).join(to);
        if (b.type === 'list') b.items = (b.items || []).map(rep); else b.html = rep(b.html || '');
        return true;
      }
      case 'level': if (![1, 2, 3, 4, 5].includes(fix.to)) return false; b.level = fix.to; return true;
      case 'alt': {
        const im = fix.idx >= 0 ? (b.images || [])[fix.idx] : b.img;
        if (!im || !String(fix.text || '').trim()) return false;
        im.alt = String(fix.text).trim(); return true;
      }
      case 'mobilesize': b.fsm = fix.to || 16; return true;
      case 'notransform': delete b.tt; return true;
      case 'sentencecase': b.html = sentence(b.html || ''); return true;
      case 'newwin': {
        const rep = (h) => String(h).replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (m, attrs, inner) => (/target\s*=\s*["']?_blank/i.test(attrs) && !NEWWIN.test(plain(inner)) ? `<a${attrs}>${inner} (ventana nueva)</a>` : m));
        if (b.type === 'list') b.items = (b.items || []).map(rep); else b.html = rep(b.html || '');
        return true;
      }
      case 'list': {
        const lines = String(b.html || '').split(/<br\s*\/?>|\n/i).map((l) => l.trim()).filter((l) => plain(l).trim());
        if (lines.length < 2) return false;
        b.type = 'list'; b.ordered = !!fix.ordered;
        b.items = lines.map((l) => l.replace(/^((?:<[^>]+>\s*)*)(?:[-–—•*·]|\d{1,2}[.)])\s+/, '$1'));
        delete b.html; delete b.dropCap;
        return true;
      }
      default: return false;
    }
  }

  const api = { parseColor, luminance, ratio, blend, suggestColor, analyze, applyFix, summarize, summaryText, toPx, GENERIC, words, plain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.A11y = api;
})(typeof window !== 'undefined' ? window : globalThis);
