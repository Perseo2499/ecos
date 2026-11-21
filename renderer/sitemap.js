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
  // ---------------------------------------------------------------------------------------------
  // Enlaces de una página: botones y enlaces del texto, y a qué página o entrada lleva cada uno.
  const decode = (s) => String(s).replace(/&nbsp;/g, ' ').replace(/&#0?38;|&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&#8217;/g, "'").replace(/&#8211;/g, '–');
  const plain = (h) => decode(String(h).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i')); return m ? decode(m[2] ?? m[3]) : null; };
  const BTN_RE = /<!--\s*wp:button(?:\s+(\{[\s\S]*?\}))?\s*-->([\s\S]*?)<!--\s*\/wp:button\s*-->/g;
  const A_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  // Botones («bloque botón» de WordPress) y enlaces del texto de un HTML. Cada botón lleva su número (index)
  // para poder editarlo o quitarlo; los «botones» que no son bloque (de un plugin, del editor clásico…) salen
  // con editable:false.
  function extractLinks(html) {
    html = String(html || '');
    const buttons = [], links = [], inBtn = [];
    let m, i = 0;
    BTN_RE.lastIndex = 0;
    while ((m = BTN_RE.exec(html))) {
      inBtn.push([m.index, m.index + m[0].length]);
      A_RE.lastIndex = 0;
      const a = A_RE.exec(m[2]);
      let cfg = {}; try { cfg = m[1] ? JSON.parse(m[1]) : {}; } catch { /* sin opciones */ }
      const outline = /is-style-outline/.test(cfg.className || '') || /is-style-outline/.test(m[2]);
      buttons.push({ index: i++, text: a ? plain(a[2]) : '', href: a ? attr('<a' + a[1] + '>', 'href') || '' : '', variant: outline ? 'outline' : 'fill', editable: !!a });
    }
    A_RE.lastIndex = 0;
    while ((m = A_RE.exec(html))) {
      if (inBtn.some(([s, e]) => m.index >= s && m.index < e)) continue;
      const tag = '<a' + m[1] + '>', href = attr(tag, 'href');
      if (href == null) continue;
      const text = plain(m[2]) || (/<img/i.test(m[2]) ? '(imagen)' : '');
      if (/class\s*=\s*"[^"]*(button|btn)/i.test(tag)) buttons.push({ index: -1, text, href, variant: 'fill', editable: false });
      else links.push({ text, href });
    }
    return { buttons, links };
  }

  // Esquema de los bloques de primer nivel (para dibujar una miniatura): ['heading','paragraph','image','buttons'…]
  function blockOutline(html, max = 40) {
    const out = []; let depth = 0, m;
    const re = /<!--\s*(\/)?wp:([a-z0-9/-]+)(?:\s+\{[\s\S]*?\})?\s*(\/)?-->/g;
    while ((m = re.exec(String(html || ''))) && out.length < max) {
      if (m[1]) { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0) out.push(m[2].replace(/^core\//, ''));
      if (!m[3]) depth++;
    }
    return out;
  }

  // Dirección sin protocolo, sin «www», sin barra final ni parámetros, en minúsculas (para comparar)
  function normUrl(u) {
    return String(u || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
  const hostOf = (u) => normUrl(u).split('/')[0];
  const pathOf = (u) => { const n = normUrl(u), i = n.indexOf('/'); let p = i < 0 ? '' : n.slice(i); try { p = decodeURIComponent(p); } catch { /* tal cual */ } return p; };

  // Crea la función que dice adónde lleva una dirección. items: [{ id, type:'page'|'post', title, status, link, slug }];
  // base: la dirección de la web. Devuelve {kind:'internal', type, id, title, status, link, frag} o
  // {kind:'external', host} | 'anchor' | 'mail' | 'tel' | 'file' | 'home' | 'empty' | 'broken'
  function makeResolver(items, base) {
    const site = hostOf(base || (items.find((x) => x.link) || {}).link || '');
    const byPath = new Map(), bySlug = new Map(), byId = new Map();
    for (const it of items) {
      byId.set(it.type + it.id, it);
      const p = pathOf(it.link);
      if (p && !byPath.has(p)) byPath.set(p, it);
      if (it.slug) { const k = String(it.slug).toLowerCase(); if (!bySlug.has(k) || it.type === 'page') bySlug.set(k, it); }
    }
    const pack = (it, frag) => ({ kind: 'internal', type: it.type, id: it.id, title: it.title, status: it.status, link: it.link, frag: frag || '' });
    return function resolve(href) {
      href = String(href || '').trim();
      if (!href) return { kind: 'empty' };
      if (href[0] === '#') return { kind: 'anchor', frag: href.slice(1) };
      if (/^mailto:/i.test(href)) return { kind: 'mail', to: href.slice(7).split('?')[0] };
      if (/^tel:/i.test(href)) return { kind: 'tel', to: href.slice(4) };
      if (/^(javascript|data):/i.test(href)) return { kind: 'empty' };
      const frag = (href.match(/#(.*)$/) || [])[1] || '';
      const abs = /^([a-z][a-z0-9+.-]*:)?\/\//i.test(href);
      if (abs && hostOf(href) !== site) return { kind: 'external', host: hostOf(href) };
      const rel = abs ? href : href.replace(/^\.?\//, '/');
      const q = rel.match(/[?&](page_id|p)=(\d+)/);
      if (q) { const id = Number(q[2]); const it = byId.get('page' + id) || (q[1] === 'p' ? byId.get('post' + id) : null); return it ? pack(it, frag) : { kind: 'broken' }; }
      const path = abs ? pathOf(href) : pathOf(site + (rel[0] === '/' ? '' : '/') + rel);
      if (!path) return { kind: 'home' };
      if (/^\/wp-(content|includes)\//.test(path) || /\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|webp|mp4|mp3)$/.test(path)) return { kind: 'file', name: path.split('/').pop() };
      const hit = byPath.get(path);
      if (hit) return pack(hit, frag);
      const sl = bySlug.get(path.split('/').pop());
      if (sl) return pack(sl, frag);
      return { kind: 'broken' };
    };
  }

  // --- Escribir botones (contenido en bruto de WordPress). `block` es el HTML del botón ya hecho. ---
  // Añade un botón al final o después del primer párrafo.
  function insertBlock(content, block, where) {
    content = String(content || '');
    if (where === 'afterFirst') {
      const m = /<!--\s*\/wp:paragraph\s*-->/.exec(content);
      if (m) { const at = m.index + m[0].length; return content.slice(0, at) + '\n\n' + block + content.slice(at); }
    }
    return (content.trimEnd() ? content.trimEnd() + '\n\n' : '') + block;
  }
  // Dónde está el botón número n (rango del bloque y del grupo de botones que lo contiene)
  function buttonRange(content, n) {
    let m, i = 0; BTN_RE.lastIndex = 0;
    while ((m = BTN_RE.exec(content))) {
      if (i++ !== n) continue;
      const start = m.index, end = m.index + m[0].length;
      const gre = /<!--\s*wp:buttons(?:\s+\{[\s\S]*?\})?\s*-->[\s\S]*?<!--\s*\/wp:buttons\s*-->/g; let g;
      while ((g = gre.exec(content))) if (g.index <= start && g.index + g[0].length >= end) {
        const inside = (g[0].match(/<!--\s*wp:button(?:\s|-->)/g) || []).length;
        return { start, end, group: [g.index, g.index + g[0].length], only: inside === 1, block: m[0] };
      }
      return { start, end, group: null, only: false, block: m[0] };
    }
    return null;
  }
  const STALE = 'La página ha cambiado desde que la abriste. Vuelve a abrirla.';
  // Cambia el texto, el destino o el estilo de un botón. old: { text, href } (para asegurarse de que es el mismo).
  function editButton(content, n, old, next) {
    const r = buttonRange(content, n);
    if (!r) throw new Error('No se encuentra ese botón en la página.');
    const cur = extractLinks(r.block).buttons[0];
    if (!cur || !cur.editable || (old && ((old.text != null && cur.text !== old.text) || (old.href != null && cur.href !== old.href)))) throw new Error(STALE);
    const escA = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const escT = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let b = r.block.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/i, (all, at, inner) => {
      if (next.href != null) at = /\shref\s*=/.test(at) ? at.replace(/(\shref\s*=\s*)("[^"]*"|'[^']*')/i, (x, a) => a + '"' + escA(next.href) + '"') : at + ` href="${escA(next.href)}"`;
      if (next.text != null && next.text !== cur.text) inner = escT(next.text);
      return `<a${at}>${inner}</a>`;
    });
    if (next.variant && next.variant !== cur.variant) {
      b = next.variant === 'outline'
        ? b.replace(/<!--\s*wp:button\s*-->/, '<!-- wp:button {"className":"is-style-outline"} -->').replace(/class="wp-block-button"/, 'class="wp-block-button is-style-outline"')
        : b.replace(/<!--\s*wp:button\s+\{"className":"is-style-outline"\}\s*-->/, '<!-- wp:button -->').replace(/\s+is-style-outline/, '');
    }
    return content.slice(0, r.start) + b + content.slice(r.end);
  }
  // Quita un botón (y su grupo, si era el único)
  function removeButton(content, n, old) {
    const r = buttonRange(content, n);
    if (!r) throw new Error('No se encuentra ese botón en la página.');
    const cur = extractLinks(r.block).buttons[0];
    if (cur && old && ((old.text != null && cur.text !== old.text) || (old.href != null && cur.href !== old.href))) throw new Error(STALE);
    const [s, e] = r.only && r.group ? r.group : [r.start, r.end];
    const a = content.slice(0, s).replace(/\s+$/, ''), b = content.slice(e).replace(/^\s+/, '');
    return a && b ? a + '\n\n' + b : a + b;
  }
  const api = { reachablePages, unlinkedPages, menuProblems, emptyCategories, extractLinks, blockOutline, normUrl, makeResolver, insertBlock, editButton, removeButton };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SiteMap = api;
})(typeof self !== 'undefined' ? self : this);
