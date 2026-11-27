// Editor de WordPress dentro de Ecos · lógica pura del lado de la interfaz (sin DOM): cuándo está disponible y cómo se sustituye un bloque.
// La usa renderer/blocks/wpeditor.js y se prueba con `npm test`.
(function (root) {
  const versionLess = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; }
    return false;
  };
  // Solo con «Mi web (wp-admin)» conectada. reason: '' (disponible) | 'mode' (otro modo de WordPress) | 'conn' (sin conectar)
  function availability(cfg) {
    const c = cfg || {};
    if ((c.wpMode || 'wpcom') !== 'selfhosted') return { ok: false, reason: 'mode' };
    if (!c.wpConnected) return { ok: false, reason: 'conn' };
    return { ok: true, reason: '' };
  }
  // ¿El complemento trae la entrada directa (1.6.0)? Sin él también funciona, pero hay que iniciar sesión una vez
  const helperHasEditor = (cfg) => !!cfg?.ecosHelper?.installed && !versionLess(cfg.ecosHelper.version || '0', '1.6.0');
  // Sustituye (en su sitio, también dentro de secciones y columnas) el bloque `id` por `list`. Devuelve true si lo encontró.
  // list vacío = el bloque se quita.
  function replaceBlockIn(arr, id, list) {
    for (let i = 0; i < (arr || []).length; i++) {
      const b = arr[i];
      if (b && b.id === id) { arr.splice(i, 1, ...list); return true; }
      if (Array.isArray(b.children) && replaceBlockIn(b.children, id, list)) return true;
      if (Array.isArray(b.cols)) for (const c of b.cols) if (replaceBlockIn(c.children || [], id, list)) return true;
    }
    return false;
  }
  // Marcado de WordPress de un bloque raw (para abrirlo en el editor); '' si no lo es
  const rawMarkup = (b) => (b && b.type === 'raw' && typeof b.markup === 'string' ? b.markup : '');
  // El resultado del editor: bloques nuevos con ids propios (por si el main devuelve ids repetidos)
  const freshIds = (blocks, mk) => (blocks || []).map((b) => { const c = JSON.parse(JSON.stringify(b)); const walk = (x) => { x.id = mk(); (x.children || []).forEach(walk); (x.cols || []).forEach((k) => (k.children || []).forEach(walk)); }; walk(c); return c; });

  const api = { availability, helperHasEditor, replaceBlockIn, rawMarkup, freshIds, versionLess };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WpEditorLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
