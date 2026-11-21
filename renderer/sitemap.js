// Lógica pura de la estructura de la web: qué páginas no se alcanzan desde el menú, qué elementos del menú
// apuntan a páginas ocultas, categorías vacías... La usan la pestaña Estructura (renderer) y las pruebas.
(function (root) {
  const byId = (list) => new Map(list.map((x) => [x.id, x]));

  // Ids de páginas a las que se llega desde el menú: las que están en él y las que cuelgan de una de ellas.
  function reachablePages(pages, menuItems) {
    const map = byId(pages), inMenu = new Set(menuItems.filter((i) => i.object === 'page').map((i) => Number(i.objectId)));
    const ok = new Set();
    for (const p of pages) {
      const seen = new Set();
      for (let x = p; x && !seen.has(x.id); x = map.get(x.parent)) { seen.add(x.id); if (inMenu.has(x.id)) { ok.add(p.id); break; } }
    }
    return ok;
  }
  // Páginas publicadas a las que no se puede llegar desde el menú (la portada fija se excluye).
  function unlinkedPages(pages, menuItems, settings) {
    const ok = reachablePages(pages, menuItems);
    const front = settings && settings.showOnFront === 'page' ? settings.pageOnFront : 0;
    return pages.filter((p) => p.status === 'publish' && !ok.has(p.id) && p.id !== front);
  }
  // Elementos del menú que apuntan a una página en borrador/privada/pendiente o a una que ya no existe (papelera).
  function menuProblems(pages, menuItems) {
    const map = byId(pages), out = [];
    for (const i of menuItems) {
      if (i.object !== 'page') continue;
      const p = map.get(Number(i.objectId));
      if (!p) out.push({ item: i, why: 'trash' });
      else if (p.status !== 'publish') out.push({ item: i, why: 'draft', page: p });
    }
    return out;
  }
  // Categorías sin entradas y sin subcategorías (la «Sin categoría» por defecto, id 1, no cuenta).
  function emptyCategories(cats) {
    return cats.filter((c) => c.id !== 1 && !c.count && !cats.some((x) => x.parent === c.id));
  }
  const api = { reachablePages, unlinkedPages, menuProblems, emptyCategories };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SiteMap = api;
})(typeof self !== 'undefined' ? self : this);
