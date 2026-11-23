// Ecos · calidad de los vídeos y medios externos (lógica pura; la usan el editor y el proceso principal).
(function (root) {
  const MAX_SHORT = 1080;            // lado corto máximo al subir un vídeo
  const MAX_BYTES = 20 * 1024 * 1024; // por encima de este peso también se comprime
  const LOW_SHORT = 720;             // por debajo de este lado corto se avisa de «baja resolución»

  // ¿Hay que recomprimir? Sí si el lado corto pasa de 1080 o el archivo pesa más de 20 MB
  function needsTranscode({ width = 0, height = 0, size = 0 } = {}) {
    const short = Math.min(Number(width) || 0, Number(height) || 0);
    return (short > MAX_SHORT) || (Number(size) > MAX_BYTES);
  }
  // Medidas de salida (pares, que H.264 lo exige): el lado corto baja a 1080 sin ampliar nunca
  function targetSize(width, height) {
    const w = Number(width) || 0, h = Number(height) || 0;
    if (!w || !h) return { width: 0, height: 0 };
    const short = Math.min(w, h), k = short > MAX_SHORT ? MAX_SHORT / short : 1;
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    return { width: even(w * k), height: even(h * k) };
  }
  // ¿Se debe avisar de baja resolución? Solo si se conocen las medidas
  function lowRes(v, min = LOW_SHORT) {
    const w = Number(v?.width) || 0, h = Number(v?.height) || 0;
    return !!(w && h && Math.min(w, h) < min);
  }

  // Direcciones de los CDN de Meta: caducan, hay que subirlas a la biblioteca de la web
  const META_CDN = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:cdninstagram\.com|fbcdn\.net)(?:[:/?#]|$)|^https?:\/\/scontent[a-z0-9.-]*\//i;
  const isMetaCdn = (u) => typeof u === 'string' && META_CDN.test(u);

  const SKIP = new Set(['html', 'caption', 'text']);
  function walk(node, fn, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) { node.forEach((x) => walk(x, fn, depth + 1)); return; }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') { if (!SKIP.has(k) && isMetaCdn(v)) fn(node, k, v); } else walk(v, fn, depth + 1);
    }
  }
  // Direcciones externas que caducan dentro de unos bloques (incluye poster de vídeo y fondos)
  function collectExpiring(blocks) {
    const out = new Set();
    walk(blocks, (_o, _k, v) => out.add(v));
    return [...out];
  }
  // Sustituye (en el sitio) cada dirección por la de su mapa; devuelve cuántas cambió
  function replaceUrls(blocks, map) {
    let n = 0;
    walk(blocks, (o, k, v) => { if (map && map[v]) { o[k] = map[v]; n++; } });
    return n;
  }

  const api = { MAX_SHORT, MAX_BYTES, LOW_SHORT, needsTranscode, targetSize, lowRes, isMetaCdn, collectExpiring, replaceUrls };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VidQ = api;
})(typeof window !== 'undefined' ? window : globalThis);
