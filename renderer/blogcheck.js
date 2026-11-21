// Ecos · Lógica pura de la «Revisión» del blog (sirve en la app y en las pruebas):
// entradas sin categoría y primera foto del contenido.
(function (root) {
  const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s-]+/g, ' ');
  // La categoría por defecto de WordPress (según el idioma de la web)
  const DEFAULT_CATS = ['uncategorized', 'sin categoria', 'sin clasificar'];
  const isDefaultCat = (name) => DEFAULT_CATS.includes(strip(name));
  // «Sin categoría»: ninguna categoría, o solo la que WordPress pone por defecto
  const isUncategorized = (names) => {
    const l = (names || []).filter((n) => String(n || '').trim());
    return l.length === 0 || l.every(isDefaultCat);
  };
  // Primera foto de un HTML (ignora emojis de WordPress y fotos sin dirección web).
  // Devuelve { url, id } (id = 0 si no se sabe) o null.
  function firstPhotoHtml(html) {
    const re = /<img\b[^>]*>/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      const tag = m[0];
      if (/wp-smiley|class="[^"]*emoji/i.test(tag)) continue;
      const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!src || !/^(https?:)?\/\//i.test(src)) continue;
      const id = Number((tag.match(/wp-image-(\d+)/) || [])[1]) || 0;
      return { url: src, id };
    }
    return null;
  }
  // Primera foto de una lista de bloques de Ecos (imagen suelta, galería o carrusel, en orden)
  function firstImage(blocks) {
    for (const b of blocks || []) {
      const imgs = b.img ? [b.img] : b.images || [];
      const hit = imgs.find((i) => i && i.type !== 'video' && i.url);
      if (hit) return hit;
    }
    return null;
  }
  const api = { isDefaultCat, isUncategorized, firstPhotoHtml, firstImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BlogCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
