// Buscar y reemplazar en el texto visible de las entradas (no toca etiquetas ni atributos HTML).
// Lo usan el editor (bloques), el buscador en lote del Blog (main.js, sobre el HTML de la entrada) y las pruebas.
// Las posiciones (start/end) son sobre el texto visible del campo, con &amp; &lt; &gt; ya decodificados.
(function (root) {
  const WORD = '[\\p{L}\\p{N}_]';
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function makeRe(query, { caseSensitive, wholeWord } = {}) {
    if (!query) return null;
    const q = escRe(String(query));
    return new RegExp(wholeWord ? `(?<!${WORD})${q}(?!${WORD})` : q, 'gu' + (caseSensitive ? '' : 'i'));
  }

  // Recorre los nodos de texto de un trozo de HTML (o de un texto plano si html=false).
  // fn(texto decodificado, desplazamiento) devuelve el texto nuevo o null para dejarlo igual.
  function mapText(str, html, fn) {
    str = String(str ?? '');
    if (!html) { const r = fn(str, 0); return r == null ? str : r; }
    let off = 0;
    return str.split(/(<[^>]+>)/).map((part) => {
      if (!part || part.startsWith('<')) return part;
      const txt = decode(part);
      const r = fn(txt, off);
      off += txt.length;
      return r == null ? part : encode(r);
    }).join('');
  }

  // Coincidencias en un texto: [{start, end}]
  function matchesIn(str, query, opts, html = true) {
    const re = makeRe(query, opts);
    const out = [];
    if (!re) return out;
    mapText(str, html, (txt, off) => {
      re.lastIndex = 0;
      for (let m; (m = re.exec(txt));) {
        if (!m[0]) { re.lastIndex++; continue; }
        out.push({ start: off + m.index, end: off + m.index + m[0].length });
      }
      return null;
    });
    return out;
  }

  // Reemplaza en un texto; onlyStart: solo la coincidencia que empieza ahí. → { text, count }
  function replaceIn(str, query, replacement, opts, html = true, onlyStart) {
    const re = makeRe(query, opts);
    str = String(str ?? '');
    if (!re) return { text: str, count: 0 };
    let count = 0;
    const text = mapText(str, html, (txt, off) => {
      re.lastIndex = 0;
      let changed = false;
      const r = txt.replace(re, (m, ...rest) => {
        const idx = rest.find((x) => typeof x === 'number');
        if (!m || (onlyStart != null && off + idx !== onlyStart)) return m;
        count++; changed = true;
        return String(replacement ?? '');
      });
      return changed ? r : null;
    });
    return { text, count };
  }

  const countInHtml = (html, query, opts) => matchesIn(html, query, opts, true).length;
  const replaceInHtml = (html, query, replacement, opts) => {
    const r = replaceIn(html, query, replacement, opts, true);
    return { html: r.text, count: r.count };
  };
  const findInText = (text, query, opts) => matchesIn(text, query, opts, false);
  const replaceInText = (text, query, replacement, opts, onlyStart) => replaceIn(text, query, replacement, opts, false, onlyStart);

  // Campos con texto de un bloque: { field, index?, html, get, set }
  function fieldsOf(b) {
    const out = [];
    const prop = (field) => { if (typeof b[field] === 'string') out.push({ field, html: true, get: () => b[field], set: (v) => (b[field] = v) }); };
    if (['paragraph', 'heading', 'quote', 'mediatext', 'details'].includes(b.type)) prop('html');
    prop('summary'); prop('cite'); prop('caption');
    if (Array.isArray(b.items)) b.items.forEach((it, k) => { if (typeof it === 'string') out.push({ field: 'items', index: k, html: true, get: () => b.items[k], set: (v) => (b.items[k] = v) }); });
    if (Array.isArray(b.rows)) b.rows.forEach((row, r) => (row || []).forEach((c, k) => {
      if (typeof c === 'string') out.push({ field: 'rows', index: r + ',' + k, html: true, get: () => b.rows[r][k], set: (v) => (b.rows[r][k] = v) });
    }));
    if (b.img && typeof b.img.alt === 'string') out.push({ field: 'alt', html: false, get: () => b.img.alt, set: (v) => (b.img.alt = v) });
    if (Array.isArray(b.images)) b.images.forEach((im, k) => { if (im && typeof im.alt === 'string') out.push({ field: 'alt', index: k, html: false, get: () => im.alt, set: (v) => (im.alt = v) }); });
    return out;
  }

  // → [{ blockId, field, index?, start, end }] en el orden del documento
  function findInBlocks(blocks, query, opts) {
    const out = [];
    for (const b of blocks || []) {
      for (const f of fieldsOf(b)) {
        for (const m of matchesIn(f.get(), query, opts, f.html)) {
          const hit = { blockId: b.id, field: f.field, start: m.start, end: m.end };
          if (f.index !== undefined) hit.index = f.index;
          out.push(hit);
        }
      }
    }
    return out;
  }

  // Reemplaza dentro de los bloques (modifica el array que se le pasa; úsalo dentro de BlockEditor.change).
  // onlyMatch: una de las coincidencias de findInBlocks para cambiar solo esa. → { blocks, count }
  function replaceInBlocks(blocks, query, replacement, opts, onlyMatch) {
    let count = 0;
    for (const b of blocks || []) {
      if (onlyMatch && b.id !== onlyMatch.blockId) continue;
      for (const f of fieldsOf(b)) {
        if (onlyMatch && (f.field !== onlyMatch.field || String(f.index ?? '') !== String(onlyMatch.index ?? ''))) continue;
        const r = replaceIn(f.get(), query, replacement, opts, f.html, onlyMatch ? onlyMatch.start : undefined);
        if (r.count) { f.set(r.text); count += r.count; }
      }
    }
    return { blocks, count };
  }

  // Fragmentos de contexto (~radio caracteres) de un HTML: [{ before, match, after }]
  function snippetsInHtml(html, query, opts, radius = 60, max = 3) {
    let plain = ''; mapText(html, true, (txt) => { plain += txt; return null; });
    return matchesIn(html, query, opts, true).slice(0, max).map((m) => ({
      before: (m.start - radius > 0 ? '…' : '') + plain.slice(Math.max(0, m.start - radius), m.start),
      match: plain.slice(m.start, m.end),
      after: plain.slice(m.end, m.end + radius) + (m.end + radius < plain.length ? '…' : ''),
    }));
  }

  const api = { findInBlocks, replaceInBlocks, countInHtml, replaceInHtml, findInText, replaceInText, snippetsInHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FindReplace = api;
})(typeof window !== 'undefined' ? window : globalThis);
