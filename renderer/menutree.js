// Lógica pura de los menús de WordPress: árbol ↔ lista plana (parent, menu_order), mover y anidar (hasta 3 niveles),
// diferencias para guardar el mínimo de peticiones, ubicaciones y menús de bloques (wp_navigation).
// Sin pantalla ni red: la usa renderer/app/menus-ui.js y se prueba con node --test.
// Un nodo del árbol es { id, title, url, type, object, objectId, children: [...] } (id numérico = existe en WordPress;
// texto «t1», «n3»… = nuevo todavía sin guardar).
(function (root) {
  const MAX_DEPTH = 3;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const same = (a, b) => String(a) === String(b);

  // Lista plana [{ id, parent, order, ... }] → árbol (ordenado por order; los empates, por su posición)
  function nest(items) {
    const list = (items || []).map((x, i) => ({ ...x, children: [], _i: i }));
    const byId = new Map(list.map((n) => [String(n.id), n]));
    const rootNodes = [];
    for (const n of list) {
      const p = n.parent ? byId.get(String(n.parent)) : null;
      // un padre que no existe (o un ciclo) deja el elemento en el primer nivel
      let cyc = false;
      for (let q = p, k = 0; q && k < 50; q = q.parent ? byId.get(String(q.parent)) : null, k++) if (same(q.id, n.id)) { cyc = true; break; }
      (p && !cyc ? p.children : rootNodes).push(n);
    }
    const sort = (arr) => { arr.sort((a, b) => (a.order || 0) - (b.order || 0) || a._i - b._i); arr.forEach((n) => { sort(n.children); delete n._i; delete n.parent; delete n.order; }); return arr; };
    return sort(rootNodes);
  }
  // Árbol → lista plana en orden de documento; order = 1, 2, 3… en todo el menú (como hace WordPress)
  function flatten(tree) {
    const out = [];
    const walk = (nodes, parent) => nodes.forEach((n) => { const { children, ...rest } = n; out.push({ ...rest, parent, order: out.length + 1 }); walk(children || [], n.id); });
    walk(tree || [], 0);
    return out;
  }
  const walkAll = (tree, fn, parent = null, depth = 1) => (tree || []).forEach((n, i) => { fn(n, parent, depth, i); walkAll(n.children, fn, n, depth + 1); });
  const find = (tree, id) => { let hit = null; walkAll(tree, (n, p, d, i) => { if (!hit && same(n.id, id)) hit = { node: n, parent: p, depth: d, index: i }; }); return hit; };
  const subDepth = (n) => 1 + Math.max(0, ...(n.children || []).map(subDepth));
  const depth = (tree) => Math.max(0, ...(tree || []).map(subDepth));
  const count = (tree) => { let c = 0; walkAll(tree, () => c++); return c; };

  // Mueve un elemento (con sus hijos) a otro padre (null/0 = primer nivel) y posición. { tree, ok, why }
  function move(tree, id, parentId, index) {
    const t = clone(tree), me = find(t, id);
    if (!me) return { tree, ok: false, why: 'missing' };
    const toRoot = parentId === null || parentId === undefined || parentId === 0;
    if (!toRoot && find(me.node.children, parentId)) return { tree, ok: false, why: 'cycle' };
    if (!toRoot && same(parentId, id)) return { tree, ok: false, why: 'cycle' };
    const sibs = me.parent ? me.parent.children : t;
    sibs.splice(me.index, 1);
    let into = t, base = 0;
    if (!toRoot) { const p = find(t, parentId); if (!p) return { tree, ok: false, why: 'missing' }; into = p.node.children; base = p.depth; }
    if (base + subDepth(me.node) > MAX_DEPTH) return { tree, ok: false, why: 'depth' };
    let at = index === undefined || index === null ? into.length : Math.max(0, Math.min(into.length, index));
    // mover dentro de la misma lista hacia abajo: el hueco que deja el propio elemento ya está quitado
    into.splice(at, 0, me.node);
    return { tree: t, ok: true };
  }
  const indent = (tree, id) => {
    const me = find(tree, id); if (!me || me.index === 0) return { tree, ok: false, why: 'first' };
    const sibs = me.parent ? me.parent.children : tree, prev = sibs[me.index - 1];
    return move(tree, id, prev.id, prev.children.length);
  };
  const outdent = (tree, id) => {
    const me = find(tree, id); if (!me || !me.parent) return { tree, ok: false, why: 'top' };
    const up = find(tree, me.parent.id);
    return move(tree, id, up.parent ? up.parent.id : null, up.index + 1);
  };
  const shift = (tree, id, d) => {
    const me = find(tree, id); if (!me) return { tree, ok: false, why: 'missing' };
    const sibs = me.parent ? me.parent.children : tree, to = me.index + d;
    if (to < 0 || to >= sibs.length) return { tree, ok: false, why: 'edge' };
    return move(tree, id, me.parent ? me.parent.id : null, to);
  };
  const up = (tree, id) => shift(tree, id, -1), down = (tree, id) => shift(tree, id, 1);

  // Añade un elemento nuevo (al final del primer nivel o de un padre)
  function add(tree, node, parentId) {
    const t = clone(tree), n = { children: [], ...node };
    if (!parentId) { t.push(n); return { tree: t, ok: true }; }
    const p = find(t, parentId);
    if (!p || p.depth + 1 > MAX_DEPTH) return { tree, ok: false, why: p ? 'depth' : 'missing' };
    p.node.children.push(n);
    return { tree: t, ok: true };
  }
  // Quita un elemento; sus hijos suben a su sitio (WordPress los dejaría huérfanos)
  function remove(tree, id) {
    const t = clone(tree), me = find(t, id);
    if (!me) return tree;
    (me.parent ? me.parent.children : t).splice(me.index, 1, ...me.node.children);
    return t;
  }
  function rename(tree, id, patch) {
    const t = clone(tree), me = find(t, id);
    if (me) Object.assign(me.node, patch);
    return t;
  }

  // Diferencias entre dos listas planas (las de WordPress y las de ahora): lo mínimo que hay que pedir.
  //  del: ids a borrar · add: elementos nuevos (con padres antes que hijos; parent puede ser el «tmp» de otro nuevo) ·
  //  upd: [{ id, parent, order, title, url }] solo con lo que cambió
  const isNew = (id) => typeof id === 'string' && !/^\d+$/.test(id);
  function diff(origItems, curItems) {
    const o = new Map((origItems || []).map((x) => [String(x.id), x]));
    const cur = curItems || [], keep = new Set(cur.map((x) => String(x.id)));
    const del = (origItems || []).filter((x) => !keep.has(String(x.id))).map((x) => x.id);
    const add = [], upd = [];
    for (const c of cur) {
      const p = o.get(String(c.id));
      if (!p || isNew(c.id)) { add.push({ ...c, tmp: c.id }); continue; }
      const ch = {};
      if (!same(p.parent || 0, c.parent || 0)) ch.parent = c.parent || 0;
      if ((p.order || 0) !== c.order) ch.order = c.order;
      if (String(p.title ?? '') !== String(c.title ?? '')) ch.title = c.title;
      if (c.type === 'custom' && String(p.url ?? '') !== String(c.url ?? '')) ch.url = c.url;
      if (Object.keys(ch).length) upd.push({ id: c.id, ...ch });
    }
    return { del, add, upd, count: del.length + add.length + upd.length };
  }

  // Para «Deshacer»: lista plana objetivo = la copia guardada; los elementos que ya no existen se vuelven a crear (ids «r…»)
  function revert(snapshotItems, currentItems) {
    const have = new Set((currentItems || []).map((x) => String(x.id)));
    const map = (id) => (!id ? 0 : have.has(String(id)) ? id : 'r' + id);
    return (snapshotItems || []).map((x) => ({ ...x, id: map(x.id), parent: map(x.parent) }));
  }

  // Ubicaciones: menus = [{ id, locations: [slug] }]. Devuelve [{ id, locations }] solo de los menús que cambian.
  function locationsDiff(orig, cur) {
    const before = new Map((orig || []).map((m) => [String(m.id), [...(m.locations || [])].sort().join('|')]));
    return (cur || []).filter((m) => before.get(String(m.id)) !== [...(m.locations || [])].sort().join('|')).map((m) => ({ id: m.id, locations: [...(m.locations || [])] }));
  }
  // Asigna una ubicación a un menú (y se la quita al que la tuviera: una ubicación solo tiene un menú)
  function assign(menus, menuId, loc, on = true) {
    return menus.map((m) => {
      const has = (m.locations || []).filter((l) => l !== loc);
      return { ...m, locations: same(m.id, menuId) && on ? [...has, loc] : has };
    });
  }

  // ---------------------------------------------------------------- menús de bloques (wp_navigation)
  const ATTR_ESC = (s) => s.replace(/--/g, '\\u002d\\u002d').replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const attrs = (o) => ATTR_ESC(JSON.stringify(o));
  const TOKEN = /<!--\s*(\/)?wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\s+(\{[\s\S]*?\}))?\s*(\/)?-->/g;

  // «core/navigation-link» y «core/navigation-submenu» → árbol; cualquier otro bloque (lista de páginas, buscador…)
  // se conserva tal cual (opaque) para no perderlo al guardar.
  function parseNav(content) {
    const src = String(content || ''), toks = [];
    for (const m of src.matchAll(TOKEN)) toks.push({ close: !!m[1], name: m[2].replace(/^core\//, ''), attrs: m[3], self: !!m[4], start: m.index, end: m.index + m[0].length });
    let seq = 0;
    const out = [];
    const build = (i, stop) => {
      const nodes = [];
      while (i < toks.length) {
        const k = toks[i];
        if (k.close) { if (stop !== null && k.name === stop) return { nodes, next: i + 1, end: k.end }; i++; continue; }
        const isNav = k.name === 'navigation-link' || k.name === 'navigation-submenu';
        let a = {}; try { a = k.attrs ? JSON.parse(k.attrs) : {}; } catch { /* atributos rotos: se conserva en bruto */ }
        let kids = [], next = i + 1, end = k.end;
        if (!k.self) { const r = build(i + 1, k.name); kids = r.nodes; next = r.next; end = r.end || toks[next - 1]?.end || k.end; }
        if (isNav) nodes.push({ id: 'n' + ++seq, title: a.label || '', url: a.url || '', type: a.type || '', object: a.kind || '', objectId: a.id || 0, newTab: !!a.opensInNewTab, children: kids });
        else nodes.push({ id: 'n' + ++seq, opaque: true, title: '', raw: src.slice(k.start, end), children: [] });
        i = next;
      }
      return { nodes, next: i, end: 0 };
    };
    out.push(...build(0, null).nodes);
    return out;
  }
  function navNode(n) {
    if (n.opaque) return n.raw;
    const a = { label: n.title || '' };
    if (n.type) a.type = n.type;
    if (n.objectId) a.id = Number(n.objectId);
    if (n.url) a.url = n.url;
    if (n.object) a.kind = n.object;
    if (n.newTab) a.opensInNewTab = true;
    const kids = n.children || [];
    if (!kids.length) return `<!-- wp:navigation-link ${attrs(a)} /-->`;
    return `<!-- wp:navigation-submenu ${attrs(a)} -->\n${kids.map(navNode).join('\n')}\n<!-- /wp:navigation-submenu -->`;
  }
  const serializeNav = (tree) => (tree || []).map(navNode).join('\n');

  // Elemento de menú o de bloque nuevo a partir de lo que se elige en la pantalla
  // kind: 'page' | 'post' | 'category' | 'custom'
  function newItem(id, kind, o) {
    const title = String(o.title || '').trim(), url = String(o.url || '').trim();
    if (kind === 'custom') return { id, title: title || url, url, type: 'custom', object: 'custom', objectId: 0, children: [] };
    if (kind === 'category') return { id, title, url, type: 'taxonomy', object: 'category', objectId: Number(o.objectId) || 0, children: [] };
    return { id, title, url, type: 'post_type', object: kind === 'post' ? 'post' : 'page', objectId: Number(o.objectId) || 0, children: [] };
  }
  // Los menús de bloques usan otros nombres para el tipo: kind «post-type» / «taxonomy» / «custom» y type page|post|category|custom
  const toNavNode = (n) => ({ ...n, type: n.object === 'custom' ? 'custom' : n.object, object: n.object === 'category' ? 'taxonomy' : n.object === 'custom' ? 'custom' : 'post-type', children: (n.children || []).map(toNavNode) });

  const api = { MAX_DEPTH, nest, flatten, find, depth, count, move, indent, outdent, up, down, add, remove, rename, diff, revert, isNew, locationsDiff, assign, parseNav, serializeNav, newItem, toNavNode, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MenuTree = api;
})(typeof window !== 'undefined' ? window : globalThis);
