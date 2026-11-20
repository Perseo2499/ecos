// Normalizar formato: deja una entrada con el formato habitual del blog sin cambiar su contenido.
// Sirve para entradas antiguas o restauradas (texto metido en títulos, MAYÚSCULAS, colores y tamaños sueltos,
// fotos una detrás de otra, separadores repetidos…). Se usa en el editor y al restaurar copias.
// Recibe y devuelve bloques del editor de Ecos; create(type, extra) crea un bloque nuevo.
(function (root) {
  const text = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, 'x').replace(/\s+/g, ' ').trim();
  const letters = (s) => s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  const isCaps = (h) => { const l = letters(text(h)); return l.length >= 12 && l === l.toUpperCase(); };
  // MAYÚSCULAS → frase normal (solo el texto, no las etiquetas); se respeta lo que ya estaba en minúsculas
  function sentenceCase(h) {
    let start = true;
    return String(h).split(/(<[^>]+>)/).map((part) => {
      if (part.startsWith('<')) return part;
      return part.toLowerCase().replace(/(^|[.!?¡¿]\s*|\n)([a-záéíóúñü])/g, (m, a, c) => a + c.toUpperCase())
        .replace(/^(\s*)([a-záéíóúñü])/, (m, sp, c) => (start ? sp + c.toUpperCase() : m))
        .replace(/[^\s]/, (c) => { start = false; return c; });
    }).join('');
  }
  // Etiquetas de formato que sobran (span, font, estilos en línea) y espacios raros
  const tidy = (h) => String(h || '')
    .replace(/<\/?(span|font|o:p)\b[^>]*>/gi, '')
    .replace(/\s(style|class|align|face|size|color)="[^"]*"/gi, '')
    .replace(/(&nbsp;| )+/g, ' ')
    .replace(/<(strong|b|em|i)>\s*<\/\1>/gi, '')
    .replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, '')
    .replace(/ {2,}/g, ' ');
  const BULLET = /^\s*(?:[-–—•·*▪►✔✅👉]|\d{1,2}[.)])\s+/;

  function normalizeBlocks(input, create) {
    const notes = new Map();
    const note = (k) => notes.set(k, (notes.get(k) || 0) + 1);
    let blocks = JSON.parse(JSON.stringify(input || []));

    // 1) estilos sueltos fuera, HTML limpio, bloques vacíos fuera
    blocks = blocks.filter((b) => {
      for (const k of ['align', 'size', 'font', 'color', 'bg', 'dropCap']) if (b[k]) { delete b[k]; note('estilos'); }
      if (b.html !== undefined) { const t = tidy(b.html); if (t !== b.html) { b.html = t; note('limpieza'); } }
      if (b.items) b.items = b.items.map(tidy).filter((x) => text(x));
      const empty = (['paragraph', 'heading', 'quote'].includes(b.type) && !text(b.html)) || (b.type === 'list' && !b.items.length)
        || (b.type === 'image' && !b.img) || (['gallery', 'carousel'].includes(b.type) && !(b.images || []).length);
      if (empty) note('vacíos');
      return !empty;
    });

    // 2) texto metido en títulos: frases (acaban en punto), largas o la mayoría del texto en títulos
    const textBlocks = blocks.filter((b) => ['paragraph', 'heading'].includes(b.type));
    const headingHeavy = textBlocks.length >= 4 && textBlocks.filter((b) => b.type === 'heading').length / textBlocks.length > 0.5;
    for (const b of blocks) {
      if (b.type !== 'heading') continue;
      const t = text(b.html), words = t.split(' ').length;
      if (/[.;:,]$/.test(t) || t.length > 90 || words > 12 || (headingHeavy && words > 7)) { b.type = 'paragraph'; delete b.level; note('títulos→párrafos'); }
    }
    // 3) párrafo corto solo en negrita, seguido de texto → subtítulo
    blocks.forEach((b, i) => {
      if (b.type !== 'paragraph') return;
      const t = text(b.html);
      const onlyBold = /^\s*<(strong|b)>[\s\S]*<\/\1>\s*$/i.test(b.html) && !/<(strong|b)>[\s\S]*<\/(strong|b)>[\s\S]+<(strong|b)>/i.test(b.html);
      if (onlyBold && t.length <= 70 && !/[.;,]$/.test(t) && blocks[i + 1]?.type === 'paragraph') { b.type = 'heading'; b.level = 2; b.html = b.html.replace(/<\/?(strong|b)>/gi, ''); note('subtítulos'); }
    });
    // 4) MAYÚSCULAS → frase normal
    for (const b of blocks) {
      if (['paragraph', 'heading', 'quote'].includes(b.type) && isCaps(b.html)) { b.html = sentenceCase(b.html); note('mayúsculas'); }
      if (b.type === 'list') b.items = b.items.map((x) => (isCaps(x) ? (note('mayúsculas'), sentenceCase(x)) : x));
    }
    // 5) niveles de título ordenados: el primero H2 y sin saltos (H2 → H4 pasa a H3)
    let prev = 1;
    for (const b of blocks) {
      if (b.type !== 'heading') continue;
      const want = Math.min(Math.max(2, b.level || 2), prev + 1);
      if (want !== b.level) { b.level = want; note('niveles'); }
      prev = b.level;
    }
    // 6) viñetas escritas a mano → listas
    const out = [];
    for (const b of blocks) {
      if (b.type === 'paragraph') {
        const lines = b.html.split(/<br\s*\/?>/i).map((x) => x.trim()).filter((x) => text(x));
        if (lines.length >= 2 && lines.every((l) => BULLET.test(text(l)))) {
          out.push(create('list', { ordered: /^\s*\d/.test(text(lines[0])), items: lines.map((l) => l.replace(/^(\s|<[^>]+>)*/, (m) => m).replace(BULLET, '')) }));
          note('listas'); continue;
        }
        const prevB = out[out.length - 1];
        if (BULLET.test(text(b.html)) && lines.length === 1) {
          const item = b.html.replace(BULLET, '');
          if (prevB?.type === 'list' && prevB.__fromBullets) { prevB.items.push(item); continue; }
          const l = create('list', { ordered: /^\s*\d/.test(text(b.html)), items: [item] }); l.__fromBullets = true; out.push(l); note('listas'); continue;
        }
      }
      out.push(b);
    }
    out.forEach((b) => { if (b.__fromBullets) { delete b.__fromBullets; if (b.items.length < 2) { b.type = 'paragraph'; b.html = '• ' + b.items[0]; delete b.items; delete b.ordered; } } });
    blocks = out;
    // 7) varias fotos seguidas → galería; separadores repetidos o en los extremos fuera
    const merged = [];
    for (const b of blocks) {
      const last = merged[merged.length - 1];
      if (b.type === 'image' && !text(b.caption) && last) {
        if (last.type === 'image' && !text(last.caption)) { const g = create('gallery', { images: [last.img, b.img], columns: 2 }); g.__auto = true; merged[merged.length - 1] = g; note('galerías'); continue; }
        if (last.type === 'gallery' && last.__auto) { last.images.push(b.img); last.columns = Math.min(3, last.images.length); continue; }
      }
      if (b.type === 'separator' && (!merged.length || last?.type === 'separator')) { note('separadores'); continue; }
      merged.push(b);
    }
    while (merged.length && merged[merged.length - 1].type === 'separator') { merged.pop(); note('separadores'); }
    for (const b of merged) delete b.__auto;
    return { blocks: merged, notes: Object.fromEntries(notes), changes: [...notes.values()].reduce((a, c) => a + c, 0) };
  }

  const api = { normalizeBlocks, sentenceCase, isCaps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Normalize = api;
})(typeof window !== 'undefined' ? window : globalThis);
