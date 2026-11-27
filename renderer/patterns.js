// Patrones de la web y bloques sincronizados: lógica pura (sin DOM). La usan renderer/blocks/synced.js (interfaz), main.js
// (datos de WordPress) y se prueba con `npm test`.
(function (root) {
  const str = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(v.raw ?? v.rendered ?? '') : '');
  const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;|&#8217;/g, "'").replace(/\s+/g, ' ').trim();

  // /wp/v2/block-patterns/patterns → [{ name, title, description, categories: [slug], keywords, content, viewport }]
  function normalizePatterns(list) {
    const out = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || typeof p !== 'object' || !p.name || typeof p.content !== 'string' || !p.content.trim()) continue;
      if (p.inserter === false) continue; // patrones que WordPress no ofrece en el insertador
      out.push({
        name: String(p.name), title: plain(p.title) || String(p.name), description: plain(p.description || ''),
        categories: (Array.isArray(p.categories) ? p.categories : []).filter((c) => typeof c === 'string'),
        keywords: (Array.isArray(p.keywords) ? p.keywords : []).filter((c) => typeof c === 'string'),
        content: p.content, viewport: Number(p.viewport_width) || 0,
      });
    }
    return out;
  }
  // /wp/v2/block-patterns/categories → [{ name, label }]
  function normalizeCategories(list) {
    return (Array.isArray(list) ? list : []).filter((c) => c && c.name).map((c) => ({ name: String(c.name), label: plain(c.label) || String(c.name) }));
  }
  // /wp/v2/blocks (wp_block): sincronizados (sync '') o sin sincronizar ('unsynced')
  function normalizeSynced(list) {
    const out = [];
    for (const b of Array.isArray(list) ? list : []) {
      if (!b || !Number.isInteger(b.id)) continue;
      const content = str(b.content);
      const sync = (b.meta?.wp_pattern_sync_status ?? b.wp_pattern_sync_status) === 'unsynced' ? 'unsynced' : '';
      out.push({ id: b.id, title: plain(str(b.title)) || '(sin título)', content, sync, status: b.status || 'publish' });
    }
    return out;
  }
  // Busca por título, descripción y palabras clave; cat = nombre de categoría ('' = todas)
  function filterPatterns(list, { q = '', cat = '' } = {}) {
    const words = plain(q).toLowerCase().split(' ').filter(Boolean);
    return (list || []).filter((p) => {
      if (cat && !(p.categories || []).includes(cat)) return false;
      const hay = (plain(p.title) + ' ' + (p.description || '') + ' ' + (p.keywords || []).join(' ')).toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  // Categorías que realmente tienen patrones (con su cuenta), en el orden de WordPress
  function usedCategories(patterns, cats) {
    const n = {};
    for (const p of patterns || []) for (const c of p.categories || []) n[c] = (n[c] || 0) + 1;
    const known = (cats || []).filter((c) => n[c.name]).map((c) => ({ ...c, count: n[c.name] }));
    const other = Object.keys(n).filter((k) => !known.some((c) => c.name === k)).map((k) => ({ name: k, label: k, count: n[k] }));
    return [...known, ...other];
  }

  // Cuerpo para crear un bloque reutilizable en WordPress (POST /wp/v2/blocks)
  function syncedPayload(title, content, sync) {
    return { title: String(title || '').trim().slice(0, 120) || 'Bloque', content: String(content || ''), status: 'publish', meta: { wp_pattern_sync_status: sync === 'unsynced' ? 'unsynced' : '' } };
  }
  // El bloque de Ecos que hace de referencia
  const syncedRef = (id, title) => ({ type: 'synced', ref: Number(id), ...(title ? { title: String(title) } : {}) });

  // Desvincular: sustituye en el árbol los bloques sincronizados con esa referencia por lo que devuelva make(bloque)
  // (ya con identificadores nuevos). Devuelve cuántos ha cambiado. `ref` null = todos; también puede ser una función que decide.
  function unlinkIn(arr, ref, make) {
    let n = 0;
    for (let i = 0; i < (arr || []).length; i++) {
      const b = arr[i];
      if (b && b.type === 'synced' && (ref == null || (typeof ref === 'function' ? ref(b) : Number(b.ref) === Number(ref)))) {
        const list = make(b);
        arr.splice(i, 1, ...list); i += list.length - 1; n++;
        continue;
      }
      if (Array.isArray(b.children)) n += unlinkIn(b.children, ref, make);
      if (Array.isArray(b.cols)) for (const c of b.cols) n += unlinkIn(c.children || [], ref, make);
    }
    return n;
  }

  const api = { normalizePatterns, normalizeCategories, normalizeSynced, filterPatterns, usedCategories, syncedPayload, syncedRef, unlinkIn, plain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Patterns = api;
})(typeof window !== 'undefined' ? window : globalThis);
