// Estructura de la web (pestaña Blog → Estructura): un esquema editable de cómo está organizada la web.
//  · Portada: qué muestra la página de inicio y qué página lista las entradas.
//  · Menú: sus elementos en árbol; se reordenan y anidan arrastrando, se quitan con el ojo y se añaden
//    arrastrando una página o una categoría desde las otras columnas (o con «Añadir al menú» / «+ Enlace»).
//  · Páginas: árbol de páginas y subpáginas; se reordenan y anidan arrastrando; el ojo las publica o
//    las pasa a borrador; se crean páginas y subpáginas, se renombran y se mandan a la papelera.
//  · Categorías: cada una con sus entradas; una entrada se lleva a otra categoría arrastrándola (con Ctrl
//    se añade sin quitarla de la suya), se fija arriba con la chincheta y se abre en el editor de Ecos.
//  · Revisión: avisos (páginas fuera del menú, menú con páginas ocultas, categorías vacías).
//  · Mapa: el mismo sitio como diagrama de árbol (Inicio → menú → subpáginas; fuera del menú; categorías).
// Crear páginas/categorías se hace al momento en WordPress; el resto de cambios se acumulan y se guardan
// juntos («Guardar cambios»).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const t = (s, v) => window.I18N.t(s, v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const box = () => $('#b-structure');
  const toast = (m, err) => window.toast?.(m, err);

  const S = { data: null, orig: null, menu: 0, posts: new Map(), postsOrig: new Map(), loaded: new Set(), open: new Set(), tmp: 0, del: new Set(), busy: false, view: 'cols', sel: null, revOpen: true, revAll: false, zoom: null, trail: [], pl: new Map(), fresh: new Set(), plAll: false, pvAnim: false };
  let drag = null; // { kind: 'page'|'menu'|'cat'|'post', id, from? }

  const STATUS = () => ({ publish: [t('Publicada'), 'visibility'], draft: [t('Borrador'), 'visibility_off'], private: [t('Privada'), 'lock'], pending: [t('Pendiente'), 'hourglass_top'], future: [t('Programada'), 'schedule'] });

  // --- Árboles { id, parent, order } -------------------------------------------------------
  const kids = (list, pid) => list.filter((x) => (x.parent || 0) === pid).sort((a, b) => a.order - b.order || String(a.title).localeCompare(String(b.title)));
  const isDesc = (list, id, maybe) => { for (let x = list.find((n) => n.id === maybe); x; x = list.find((n) => n.id === x.parent)) if (x.id === id) return true; return false; };
  const renumber = (list, pid) => kids(list, pid).forEach((x, i) => (x.order = i + 1));
  function move(list, id, target, pos) {
    const node = list.find((n) => n.id === id);
    if (!node || id === target || (target != null && isDesc(list, id, target))) return false;
    const old = node.parent || 0;
    const tgt = list.find((n) => n.id === target);
    const parent = pos === 'inside' ? target : tgt ? tgt.parent || 0 : 0;
    const sib = kids(list, parent).filter((x) => x.id !== id);
    let at = pos === 'inside' || !tgt ? sib.length : sib.indexOf(tgt) + (pos === 'after' ? 1 : 0);
    sib.splice(at, 0, node);
    node.parent = parent;
    sib.forEach((x, i) => (x.order = i + 1));
    if (old !== parent) renumber(list, old);
    if (pos === 'inside') S.open.add(String(target));
    return true;
  }
  const flat = (list, pid = 0, out = []) => { for (const x of kids(list, pid)) { out.push(x); flat(list, x.id, out); } return out; };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // --- Cargar ---------------------------------------------------------------------------------
  async function open(force) {
    if (S.data && !force) { render(); return; }
    box().innerHTML = `<p class="hint pad">${t('Leyendo la estructura de tu web…')}</p>`;
    try {
      const d = await window.api.siteStructure();
      S.data = d; S.orig = clone(d);
      S.posts.clear(); S.postsOrig.clear(); S.loaded.clear(); S.del.clear(); S.menu = 0; S.sel = null;
      for (const p of d.pages) S.open.add('p' + p.id);
      d.menus.forEach((m) => m.items.forEach((i) => S.open.add('m' + i.id)));
      render();
    } catch (e) { box().innerHTML = `<div class="empty"><span class="ms">cloud_off</span><span>${esc(e.message)}</span></div>`; }
  }
  async function loadCat(id) {
    if (S.loaded.has(id)) return;
    const list = await window.api.siteCatPosts(id);
    for (const p of list) if (!S.posts.has(p.id)) { S.posts.set(p.id, p); S.postsOrig.set(p.id, JSON.stringify({ c: [...p.categories].sort(), s: p.sticky })); }
    S.loaded.add(id);
  }

  // --- Cambios pendientes -------------------------------------------------------------------
  function changes() {
    const d = S.data, o = S.orig, ch = { pages: [], categories: [], menuDel: [...S.del], menuAdd: [], menuItems: [], posts: [] };
    const so = o.settings, sn = d.settings;
    if (sn && so && (sn.showOnFront !== so.showOnFront || sn.pageOnFront !== so.pageOnFront || sn.pageForPosts !== so.pageForPosts)) ch.settings = sn;
    for (const p of d.pages) {
      const q = o.pages.find((x) => x.id === p.id);
      if (q && (q.parent !== p.parent || q.order !== p.order || q.status !== p.status || q.title !== p.title)) ch.pages.push({ id: p.id, parent: p.parent, order: p.order, status: p.status, ...(q.title !== p.title ? { title: p.title } : {}) });
    }
    for (const c of d.categories) { const q = o.categories.find((x) => x.id === c.id); if (q && q.name !== c.name) ch.categories.push({ id: c.id, name: c.name }); }
    d.menus.forEach((m, mi) => {
      flat(m.items).forEach((it, i) => {
        const order = i + 1;
        if (typeof it.id === 'string') ch.menuAdd.push({ tmp: it.id, menu: m.id, title: it.title, type: it.type, object: it.object, objectId: it.objectId, url: it.url, parent: it.parent, order });
        else { const q = o.menus[mi].items.find((x) => x.id === it.id); if (q && (q.parent !== it.parent || q.order !== order)) ch.menuItems.push({ id: it.id, parent: it.parent, order }); }
      });
    });
    for (const [id, p] of S.posts) if (S.postsOrig.get(id) !== JSON.stringify({ c: [...p.categories].sort(), s: p.sticky })) ch.posts.push({ id, categories: p.categories, sticky: p.sticky });
    ch.count = (ch.settings ? 1 : 0) + ch.pages.length + ch.categories.length + ch.menuDel.length + ch.menuAdd.length + ch.menuItems.length + ch.posts.length;
    return ch;
  }

  // --- Avisos (lógica pura en sitemap.js) ------------------------------------------------------
  const allMenuItems = () => S.data.menus.flatMap((m) => m.items);
  function review() {
    const d = S.data, SM = window.SiteMap;
    const hasMenus = d.menus.length > 0;
    return {
      hasMenus,
      unlinked: hasMenus ? SM.unlinkedPages(d.pages, allMenuItems(), d.settings) : [],
      problems: SM.menuProblems(d.pages, allMenuItems()),
      empty: SM.emptyCategories(d.categories),
    };
  }

  // --- Diálogo pequeño con campos (nombre, dirección…) ------------------------------------------
  // fields: [{ key, label, value, ph }]; buttons: [{ id, label, cls }] (por defecto «Crear»). → { v, btn } | null
  function form(title, fields, buttons, icon = 'add_circle') {
    buttons = buttons || [{ id: 'ok', label: t('Crear'), cls: 'filled' }];
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const d = document.createElement('div');
      d.className = 'dlg-scrim';
      d.innerHTML = `<div class="dlg st-dlg" role="dialog" aria-modal="true"><span class="ms fill dlg-ic">${icon}</span>
        <p class="dlg-msg">${esc(title)}</p>
        ${fields.map((f, i) => `<label class="st-fld"><span>${esc(f.label)}</span><input type="text" data-f="${f.key}" value="${esc(f.value || '')}" placeholder="${esc(f.ph || '')}" ${i === 0 ? 'autofocus' : ''}></label>`).join('')}
        <div class="dlg-actions st-dlg-act"><button class="btn text" data-b="">${t('Cancelar')}</button>${buttons.map((b) => `<button class="btn ${b.cls || 'filled'}" data-b="${b.id}">${esc(b.label)}</button>`).join('')}</div></div>`;
      const close = (r) => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(r); };
      const go = (btn) => {
        const v = {}; $$('[data-f]', d).forEach((i) => (v[i.dataset.f] = i.value.trim()));
        if (!v[fields[0].key]) { $('[data-f]', d).focus(); return; }
        close({ v, btn });
      };
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } else if (e.key === 'Enter' && e.target.matches?.('input')) { e.preventDefault(); e.stopPropagation(); go(buttons[buttons.length - 1].id); } };
      $$('[data-b]', d).forEach((b) => (b.onclick = () => (b.dataset.b ? go(b.dataset.b) : close(null))));
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(d);
      $('[data-f]', d).focus();
    });
  }

  // --- Dibujo ---------------------------------------------------------------------------------
  function scrollState() { const s = $('.mp-scroll', box()); return s ? [s.scrollLeft, s.scrollTop] : null; }
  function render() {
    const keep = scrollState();
    const d = S.data;
    const ch = changes();
    const m = d.menus[S.menu];
    const pageOpts = (sel) => `<option value="0">—</option>` + flat(d.pages).filter((p) => p.status === 'publish').map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.title)}</option>`).join('');
    box().innerHTML = `
      <div class="st-bar">
        <div><b>${t('Estructura de tu web')}</b><div class="hint">${t('Crea páginas, subpáginas y categorías, y conéctalas con el menú. Arrastra para ordenar o anidar. Los cambios de orden se guardan al pulsar «Guardar cambios».')}</div></div>
        <span class="spacer"></span>
        <div class="st-seg" role="tablist">
          <button class="${S.view === 'cols' ? 'on' : ''}" data-view="cols"><span class="ms">view_column</span>${t('Columnas')}</button>
          <button class="${S.view === 'map' ? 'on' : ''}" data-view="map"><span class="ms">account_tree</span>${t('Mapa')}</button>
        </div>
        <button class="btn text" data-a="reload"><span class="ms">refresh</span>${t('Recargar')}</button>
        <button class="btn text" data-a="discard" ${ch.count ? '' : 'disabled'}>${t('Descartar')}</button>
        <button class="btn filled" data-a="save" ${ch.count ? '' : 'disabled'}><span class="ms">save</span>${ch.count ? t('Guardar cambios ({n})', { n: ch.count }) : t('Sin cambios')}</button>
      </div>
      ${d.settings && !(S.view === 'map' && S.zoom) ? `<div class="st-home">
        <span class="ms fill st-home-ic">home</span>
        <div class="st-home-f"><label>${t('La portada muestra')}</label>
          <select data-set="showOnFront"><option value="posts" ${d.settings.showOnFront === 'posts' ? 'selected' : ''}>${t('Las últimas entradas')}</option><option value="page" ${d.settings.showOnFront === 'page' ? 'selected' : ''}>${t('Una página fija')}</option></select></div>
        ${d.settings.showOnFront === 'page' ? `<div class="st-home-f"><label>${t('Página de inicio')}</label><select data-set="pageOnFront">${pageOpts(d.settings.pageOnFront)}</select></div>
        <div class="st-home-f"><label>${t('Página de entradas')}</label><select data-set="pageForPosts">${pageOpts(d.settings.pageForPosts)}</select></div>` : ''}
      </div>` : ''}
      ${S.view === 'map' && S.zoom ? '' : reviewHtml()}
      ${S.view === 'map' ? (S.zoom ? pageViewHtml() : mapHtml()) : `<div class="st-cols">
        <div class="st-col" data-col="menu">
          <div class="st-col-h"><span class="ms">menu</span><b>${t('Menú')}</b>
            ${d.menus.length > 1 ? `<select data-a="menu">${d.menus.map((x, i) => `<option value="${i}" ${i === S.menu ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : m ? `<span class="hint">${esc(m.name)}</span>` : ''}
            ${m ? `<button class="btn tonal small st-add" data-do="addlink"><span class="ms">add_link</span>${t('+ Enlace')}</button>` : ''}
          </div>
          ${m ? `${m.locations.length ? `<div class="hint st-loc">${t('Se muestra en: {l}', { l: esc(m.locations.join(', ')) })}</div>` : `<div class="hint st-loc">${t('Este menú no está asignado a ninguna zona del tema.')}</div>`}
            <div class="st-tree" data-tree="menu">${tree(m.items, 0, 'menu')}</div>
            <div class="st-drop-end" data-end="menu">${t('Suelta aquí una página o una categoría para añadirla al menú')}</div>`
          : `<div class="st-note">${d.navigation.length ? t('Tu tema usa menús de bloques ({n}); se editan en Apariencia → Editor → Navegación.', { n: esc(d.navigation.map((x) => x.title).join(', ')) }) : t('No se pudieron leer los menús de tu web.')}${d.menuNote ? `<div class="hint">${esc(d.menuNote)}</div>` : ''}</div>`}
        </div>
        <div class="st-col" data-col="pages">
          <div class="st-col-h"><span class="ms">description</span><b>${t('Páginas')}</b><span class="hint">${d.pages.length}</span>
            <button class="btn tonal small st-add" data-do="addpage"><span class="ms">add</span>${t('+ Página')}</button></div>
          <div class="st-tree" data-tree="page">${tree(d.pages, 0, 'page')}</div>
          <div class="st-drop-end" data-end="page">${t('Suelta aquí para dejarla en el nivel principal')}</div>
        </div>
        <div class="st-col" data-col="cats">
          <div class="st-col-h"><span class="ms">category</span><b>${t('Categorías y entradas')}</b>
            <button class="btn tonal small st-add" data-do="addcat"><span class="ms">add</span>${t('+ Categoría')}</button></div>
          <div class="st-tree">${catTree(0)}</div>
        </div>
      </div>`}`;
    wire();
    if (keep) { const s = $('.mp-scroll', box()); if (s) { s.scrollLeft = keep[0]; s.scrollTop = keep[1]; } }
  }

  // Panel «Revisión»
  function reviewHtml() {
    const d = S.data, r = review();
    const front = d.settings?.showOnFront === 'page' ? d.pages.find((p) => p.id === d.settings.pageOnFront) : null;
    const blogp = d.settings?.showOnFront === 'page' ? d.pages.find((p) => p.id === d.settings.pageForPosts) : null;
    const n = r.unlinked.length + r.problems.length + r.empty.length;
    const lim = S.revAll ? 999 : 5;
    const more = (len) => (len > lim ? `<button class="btn text small st-more" data-do="revall">${t('Ver las {n} restantes', { n: len - lim })}</button>` : S.revAll && len > 5 ? `<button class="btn text small st-more" data-do="revall">${t('Ver menos')}</button>` : '');
    return `<details class="st-rev ${n ? 'warn' : 'ok'}" ${S.revOpen ? 'open' : ''}>
      <summary><span class="ms fill">${n ? 'rule' : 'task_alt'}</span><b>${t('Revisión')}</b>
        <span class="st-rev-n">${n ? t('{n} aviso(s)', { n }) : t('Todo en orden')}</span>
        <span class="st-rev-home"><span class="ms">home</span>${d.settings ? (front ? t('Portada: «{p}»', { p: esc(front.title) }) : t('Portada: últimas entradas')) : ''}${blogp ? ` · <span class="ms">article</span>${t('Entradas en: «{p}»', { p: esc(blogp.title) })}` : ''}</span></summary>
      <div class="st-rev-b">
        ${r.hasMenus ? '' : `<div class="hint">${t('No se pueden revisar los enlaces del menú: tu tema usa menús de bloques.')}</div>`}
        ${r.unlinked.length ? `<div class="st-rev-g"><div class="st-rev-t"><span class="ms">link_off</span>${t('Páginas publicadas a las que no se puede llegar desde el menú')} <span class="hint">(${r.unlinked.length})</span>
          ${S.data.menus[S.menu] ? `<button class="btn text small" data-do="addallmenu">${t('Añadir todas al menú')}</button>` : ''}</div>
          ${r.unlinked.slice(0, lim).map((p) => `<div class="st-rev-i"><span class="st-t">${esc(p.title)}</span><span class="spacer"></span>
            <button class="btn tonal small" data-do="addmenu" data-k="page" data-i="${p.id}"><span class="ms">playlist_add</span>${t('Añadir al menú')}</button></div>`).join('')}${more(r.unlinked.length)}</div>` : ''}
        ${r.problems.length ? `<div class="st-rev-g"><div class="st-rev-t"><span class="ms">warning</span>${t('Elementos del menú que apuntan a páginas ocultas o borradas')}</div>
          ${r.problems.map((x) => `<div class="st-rev-i"><span class="st-t">${esc(x.item.title)}</span>
            <span class="st-tag off">${x.why === 'trash' ? t('En la papelera') : esc(STATUS()[x.page.status]?.[0] || x.page.status)}</span><span class="spacer"></span>
            ${x.why === 'draft' ? `<button class="btn tonal small" data-do="publish" data-k="page" data-i="${x.page.id}"><span class="ms">visibility</span>${t('Publicar la página')}</button>` : ''}
            <button class="btn text small" data-do="rmmenu" data-k="mi" data-i="${x.item.id}"><span class="ms">remove_circle_outline</span>${t('Quitar del menú')}</button></div>`).join('')}</div>` : ''}
        ${r.empty.length ? `<div class="st-rev-g"><div class="st-rev-t"><span class="ms">folder_off</span>${t('Categorías vacías')} <span class="hint">(${r.empty.length})</span></div>
          ${r.empty.slice(0, lim).map((c) => `<div class="st-rev-i"><span class="st-t">${esc(c.name)}</span><span class="spacer"></span>
            <button class="btn text small" data-do="newpost" data-k="cat" data-i="${c.id}"><span class="ms">edit_square</span>${t('+ Entrada')}</button>
            <button class="btn text small danger-t" data-do="delcat" data-k="cat" data-i="${c.id}"><span class="ms">delete</span>${t('Borrar')}</button></div>`).join('')}${more(r.empty.length)}</div>` : ''}
      </div></details>`;
  }

  // ¿Ha cambiado respecto a lo que hay en la web? (se marca hasta guardar)
  function changed(kind, n) {
    if (kind === 'page') { const o = S.orig.pages.find((x) => x.id === n.id); return o && (o.parent !== n.parent || o.order !== n.order || o.status !== n.status || o.title !== n.title); }
    if (typeof n.id === 'string') return false;
    const o = S.orig.menus[S.menu]?.items.find((x) => x.id === n.id);
    return o && o.parent !== n.parent;
  }
  const unlinkedIds = () => (S.data.menus.length ? new Set(review().unlinked.map((p) => p.id)) : new Set());
  const problemMap = () => new Map(review().problems.map((x) => [x.item.id, x]));
  function tree(list, pid, kind) {
    const ch = kids(list, pid);
    if (!ch.length) return pid ? '' : `<div class="hint pad">${t('Vacío')}</div>`;
    const un = kind === 'page' ? unlinkedIds() : null, pm = kind === 'menu' ? problemMap() : null;
    return `<ul>${ch.map((n) => {
      const key = (kind === 'menu' ? 'm' : 'p') + n.id;
      const sub = kids(list, n.id).length;
      const st = STATUS()[n.status];
      const front = kind === 'page' && S.data.settings?.showOnFront === 'page' && S.data.settings.pageOnFront === n.id;
      const blogp = kind === 'page' && S.data.settings?.showOnFront === 'page' && S.data.settings.pageForPosts === n.id;
      const icon = kind === 'menu' ? (n.object === 'category' ? 'category' : n.type === 'custom' ? 'link' : 'description') : 'description';
      const pr = pm?.get(n.id);
      return `<li>
        <div class="st-node ${kind === 'page' ? 'st-' + n.status : ''} ${typeof n.id === 'string' ? 'new' : ''} ${changed(kind, n) ? 'changed' : ''}" draggable="true" data-kind="${kind}" data-id="${n.id}">
          ${sub ? `<button class="st-tw" data-tw="${key}"><span class="ms">${S.open.has(key) ? 'expand_more' : 'chevron_right'}</span></button>` : '<span class="st-tw"></span>'}
          <span class="ms st-ic">${icon}</span><span class="st-t" ${kind === 'page' ? `data-do="ren" data-k="page" data-i="${n.id}" data-dbl="1"` : ''}>${esc(n.title)}</span>
          ${front ? `<span class="st-tag home"><span class="ms">home</span>${t('Inicio')}</span>` : ''}${blogp ? `<span class="st-tag"><span class="ms">article</span>${t('Entradas')}</span>` : ''}
          ${kind === 'page' && n.status !== 'publish' ? `<span class="st-tag off">${esc(st?.[0] || n.status)}</span>` : ''}
          ${kind === 'page' && un.has(n.id) ? `<span class="st-tag warn" title="${t('No se puede llegar a ella desde el menú')}"><span class="ms">link_off</span>${t('Fuera del menú')}</span>` : ''}
          ${pr ? `<span class="st-tag warn" title="${t('Apunta a una página oculta o borrada')}"><span class="ms">warning</span>${pr.why === 'trash' ? t('En la papelera') : esc(STATUS()[pr.page.status]?.[0] || pr.page.status)}</span>` : ''}
          ${typeof n.id === 'string' ? `<span class="st-tag new">${t('Nuevo')}</span>` : ''}
          <span class="spacer"></span>
          ${kind === 'page' ? `<span class="st-acts">
            <button class="st-act" data-do="subpage" data-k="page" data-i="${n.id}" title="${t('+ Subpágina')}"><span class="ms">subdirectory_arrow_right</span></button>
            <button class="st-act" data-do="addmenu" data-k="page" data-i="${n.id}" title="${t('Añadir al menú')}"><span class="ms">playlist_add</span></button>
            <button class="st-act" data-do="ren" data-k="page" data-i="${n.id}" title="${t('Renombrar')}"><span class="ms">edit</span></button>
            <button class="st-act" data-do="ecospage" data-k="page" data-i="${n.id}" title="${t('Editar en Ecos')}"><span class="ms">edit_square</span></button>
            <button class="st-act" data-do="web" data-k="page" data-i="${n.id}" title="${t('Ver en la web')}"><span class="ms">public</span></button>
            <button class="st-act" data-do="trash" data-k="page" data-i="${n.id}" title="${t('Mandar a la papelera')}"><span class="ms">delete</span></button></span>
            <button class="st-act" data-vis="${n.id}" title="${n.status === 'publish' ? t('Visible: pulsa para ocultarla (borrador)') : t('Oculta: pulsa para publicarla')}"><span class="ms">${n.status === 'publish' ? 'visibility' : 'visibility_off'}</span></button>`
          : `<button class="st-act" data-rm="${n.id}" title="${t('Quitar del menú')}"><span class="ms">remove_circle_outline</span></button>`}
        </div>
        ${sub && S.open.has(key) ? tree(list, n.id, kind) : ''}
      </li>`;
    }).join('')}</ul>`;
  }

  function catTree(pid) {
    const cats = S.data.categories.filter((c) => c.parent === pid).sort((a, b) => a.name.localeCompare(b.name));
    if (!cats.length) return pid ? '' : `<div class="hint pad">${t('Vacío')}</div>`;
    const emptyIds = new Set(window.SiteMap.emptyCategories(S.data.categories).map((c) => c.id));
    return `<ul>${cats.map((c) => {
      const key = 'c' + c.id;
      const posts = S.loaded.has(c.id) ? [...S.posts.values()].filter((p) => p.categories.includes(c.id)).sort((a, b) => (b.sticky - a.sticky) || String(b.date).localeCompare(String(a.date))) : null;
      const count = posts ? posts.length : c.count;
      return `<li>
        <div class="st-node st-cat ${S.orig.categories.find((x) => x.id === c.id)?.name !== c.name ? 'changed' : ''}" draggable="true" data-kind="cat" data-id="${c.id}">
          <button class="st-tw" data-tw="${key}"><span class="ms">${S.open.has(key) ? 'expand_more' : 'chevron_right'}</span></button>
          <span class="ms st-ic">folder</span><span class="st-t" data-do="ren" data-k="cat" data-i="${c.id}" data-dbl="1">${esc(c.name)}</span><span class="st-count">${count}</span>
          ${emptyIds.has(c.id) ? `<span class="st-tag warn"><span class="ms">folder_off</span>${t('Vacía')}</span>` : ''}
          <span class="spacer"></span><span class="st-acts">
            <button class="st-act" data-do="newpost" data-k="cat" data-i="${c.id}" title="${t('+ Entrada')}"><span class="ms">edit_square</span></button>
            <button class="st-act" data-do="subcat" data-k="cat" data-i="${c.id}" title="${t('+ Subcategoría')}"><span class="ms">create_new_folder</span></button>
            <button class="st-act" data-do="addmenu" data-k="cat" data-i="${c.id}" title="${t('Añadir al menú')}"><span class="ms">playlist_add</span></button>
            <button class="st-act" data-do="ren" data-k="cat" data-i="${c.id}" title="${t('Renombrar')}"><span class="ms">edit</span></button>
            ${emptyIds.has(c.id) ? `<button class="st-act" data-do="delcat" data-k="cat" data-i="${c.id}" title="${t('Borrar categoría vacía')}"><span class="ms">delete</span></button>` : ''}</span>
        </div>
        ${S.open.has(key) ? `<ul class="st-posts">${posts ? posts.map((p) => `<li><div class="st-node st-post st-${p.status} ${S.postsOrig.get(p.id) !== JSON.stringify({ c: [...p.categories].sort(), s: p.sticky }) ? 'changed' : ''}" draggable="true" data-kind="post" data-id="${p.id}" data-cat="${c.id}">
            <span class="ms st-ic">article</span><span class="st-t">${esc(p.title)}</span>
            ${p.status !== 'publish' ? `<span class="st-tag off">${esc(STATUS()[p.status]?.[0] || p.status)}</span>` : ''}
            <span class="spacer"></span>
            <button class="st-act ${p.sticky ? 'on' : ''}" data-pin="${p.id}" title="${p.sticky ? t('Fijada arriba: pulsa para soltarla') : t('Fijar arriba en el blog')}"><span class="ms ${p.sticky ? 'fill' : ''}">push_pin</span></button>
            <button class="st-act" data-ecos="${p.id}" title="${t('Editar en Ecos')}"><span class="ms">edit_square</span></button>
          </div></li>`).join('') || `<li class="hint pad">${t('Sin entradas')}</li>` : `<li class="hint pad">${t('Cargando…')}</li>`}</ul>${catTree(c.id)}` : ''}
      </li>`;
    }).join('')}</ul>`;
  }

  // --- Vista «Mapa» -----------------------------------------------------------------------------
  // Diagrama en árbol de izquierda a derecha, con líneas de conexión en CSS. Pulsar una tarjeta la selecciona.
  function card(key, icon, title, o = {}) {
    const st = o.status && o.status !== 'publish' ? STATUS()[o.status]?.[0] || o.status : '';
    return `<div class="mp-card ${o.cls || ''} ${S.sel === key ? 'sel' : ''}" data-sel="${key}" title="${esc(title)}">
      <span class="ms ${o.fill ? 'fill' : ''}">${icon}</span><span class="mp-t">${esc(title)}</span>
      ${o.badges || ''}${st ? `<span class="mp-b off">${esc(st)}</span>` : ''}${o.n != null ? `<span class="mp-b">${o.n}</span>` : ''}</div>`;
  }
  const node = (cardHtml, kidsHtml) => `<div class="mp-n">${cardHtml}${kidsHtml ? `<div class="mp-kids">${kidsHtml}</div>` : ''}</div>`;
  const kid = (h) => `<div class="mp-kid">${h}</div>`;
  function mapHtml() {
    const d = S.data, r = review(), pages = d.pages, un = new Set(r.unlinked.map((p) => p.id)), pm = problemMap();
    const front = d.settings?.showOnFront === 'page' ? d.settings.pageOnFront : 0;
    const reach = window.SiteMap.reachablePages(pages, allMenuItems());
    const pageNode = (p) => node(
      card('pg' + p.id, 'description', p.title, { status: p.status, cls: 'pg ' + (un.has(p.id) ? 'warn' : ''), badges: (p.id === front ? `<span class="mp-b home"><span class="ms">home</span></span>` : '') + (un.has(p.id) ? `<span class="mp-b warn" title="${t('No se puede llegar a ella desde el menú')}"><span class="ms">link_off</span></span>` : '') }),
      kids(pages, p.id).map((c) => kid(pageNode(c))).join(''));
    const menuNode = (m, it) => {
      const sub = kids(m.items, it.id);
      const isPage = it.object === 'page', pg = isPage ? pages.find((p) => p.id === Number(it.objectId)) : null;
      const subIds = new Set(sub.map((x) => Number(x.objectId)));
      const extra = pg ? kids(pages, pg.id).filter((c) => !subIds.has(c.id)) : [];
      const pr = pm.get(it.id);
      return node(card('mi' + it.id, it.object === 'category' ? 'category' : it.type === 'custom' ? 'link' : 'description', it.title, { cls: 'mi ' + (pr ? 'warn' : ''), status: pg?.status, badges: pr ? `<span class="mp-b warn"><span class="ms">warning</span>${pr.why === 'trash' ? t('En la papelera') : ''}</span>` : '' }),
        sub.map((x) => kid(menuNode(m, x))).join('') + extra.map((c) => kid(pageNode(c))).join(''));
    };
    const m = d.menus[S.menu];
    const frontPg = front ? pages.find((p) => p.id === front) : null;
    const homeKids = m ? kids(m.items, 0).map((it) => kid(menuNode(m, it))).join('') : '';
    const outRoots = pages.filter((p) => !reach.has(p.id) && p.id !== front && (!p.parent || !pages.some((x) => x.id === p.parent)));
    const outCount = pages.filter((p) => !reach.has(p.id) && p.id !== front).length;
    const catNode = (c) => node(card('ct' + c.id, 'folder', c.name, { cls: 'ct', n: c.count, badges: !c.count && c.id !== 1 && !d.categories.some((x) => x.parent === c.id) ? `<span class="mp-b warn" title="${t('Vacía')}"><span class="ms">folder_off</span></span>` : '' }),
      d.categories.filter((x) => x.parent === c.id).sort((a, b) => a.name.localeCompare(b.name)).map((x) => kid(catNode(x))).join(''));
    const topCats = d.categories.filter((c) => !c.parent).sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="st-map">
      <div class="mp-tools">${mapTools()}</div>
      <div class="mp-scroll">
        <div class="mp-group">${node(card('home', 'home', frontPg ? frontPg.title : t('Inicio (últimas entradas)'), { cls: 'root', fill: true }), homeKids || (m ? '' : ''))}</div>
        ${m ? '' : `<div class="hint mp-note">${t('Tu tema usa menús de bloques: no se puede dibujar el menú.')}</div>`}
        ${outRoots.length ? `<div class="mp-group">${node(card('out', 'link_off', t('Fuera del menú'), { cls: 'root warn', n: outCount }), outRoots.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)).map((p) => kid(pageNode(p))).join(''))}</div>` : ''}
        <div class="mp-group">${node(card('cats', 'category', t('Categorías'), { cls: 'root', n: d.categories.length }), topCats.map((c) => kid(catNode(c))).join(''))}</div>
      </div></div>`;
  }
  // Barra de acciones de la tarjeta seleccionada
  function mapTools() {
    const d = S.data, s = S.sel;
    const btn = (act, k, i, ic, label, extra = '') => `<button class="btn tonal small" data-do="${act}" data-k="${k}" data-i="${i}" ${extra}><span class="ms">${ic}</span>${label}</button>`;
    let h = '', title = t('Pulsa una página para entrar en ella y ver adónde lleva cada botón.');
    const pageActs = (p) => (S.zoom ? '' : btn('zoom', 'page', p.id, 'zoom_in', t('Ver dentro'))) + btn('ecospage', 'page', p.id, 'edit_square', t('Abrir en Ecos')) + btn('web', 'page', p.id, 'public', t('Ver en la web'))
      + btn('subpage', 'page', p.id, 'subdirectory_arrow_right', t('+ Subpágina')) + btn('addmenu', 'page', p.id, 'playlist_add', t('Añadir al menú'))
      + btn('ren', 'page', p.id, 'edit', t('Renombrar')) + btn('publish', 'page', p.id, p.status === 'publish' ? 'visibility_off' : 'visibility', p.status === 'publish' ? t('Pasar a borrador') : t('Publicar'))
      + btn('trash', 'page', p.id, 'delete', t('Papelera'));
    const catActs = (c) => btn('newpost', 'cat', c.id, 'edit_square', t('+ Entrada')) + btn('subcat', 'cat', c.id, 'create_new_folder', t('+ Subcategoría'))
      + btn('addmenu', 'cat', c.id, 'playlist_add', t('Añadir al menú')) + btn('ren', 'cat', c.id, 'edit', t('Renombrar')) + (!c.count && !d.categories.some((x) => x.parent === c.id) && c.id !== 1 ? btn('delcat', 'cat', c.id, 'delete', t('Borrar')) : '');
    if (s?.startsWith('pg')) { const p = d.pages.find((x) => x.id === Number(s.slice(2))); if (p) { title = p.title; h = pageActs(p); } }
    else if (s?.startsWith('ct')) { const c = d.categories.find((x) => x.id === Number(s.slice(2))); if (c) { title = c.name; h = catActs(c); } }
    else if (s?.startsWith('mi')) {
      const id = /^mit/.test(s) ? s.slice(2) : Number(s.slice(2)), it = allMenuItems().find((x) => x.id === id);
      if (it) {
        title = it.title; const p = it.object === 'page' ? d.pages.find((x) => x.id === Number(it.objectId)) : null;
        h = btn('rmmenu', 'mi', it.id, 'remove_circle_outline', t('Quitar del menú')) + (p ? btn('ecospage', 'page', p.id, 'edit_square', t('Abrir en Ecos')) + btn('web', 'page', p.id, 'public', t('Ver en la web')) + btn('subpage', 'page', p.id, 'subdirectory_arrow_right', t('+ Subpágina')) + btn('ren', 'page', p.id, 'edit', t('Renombrar')) : '');
      }
    } else if (s === 'home') { title = t('Inicio'); h = btn('addpage', 'page', 0, 'add', t('+ Página')) + (d.menus[S.menu] ? btn('addlink', 'mi', 0, 'add_link', t('+ Enlace')) : ''); }
    else if (s === 'cats') { title = t('Categorías'); h = btn('addcat', 'cat', 0, 'add', t('+ Categoría')); }
    else if (s === 'out') { title = t('Fuera del menú'); h = btn('addallmenu', 'page', 0, 'playlist_add', t('Añadir todas al menú')); }
    return `<b class="mp-sel">${esc(title)}</b><span class="spacer"></span>${h}`;
  }

  // --- Vista de página («entrar» en una página desde el Mapa) -------------------------------------
  // Tarjeta grande en el centro, a la derecha los botones y enlaces que salen de ella (cada uno con una línea
  // hasta su destino), a la izquierda las páginas que llevan a esta. Pulsar un destino entra en él.
  // Los datos vienen de site:pageLinks; añadir, cambiar y quitar botones, de site:buttonOp.
  const plKey = (z) => z.type + z.id;
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const pageOf = (z) => (z.type === 'page' ? S.data.pages.find((p) => p.id === z.id) : null);

  async function ensurePl(z, force) {
    const k = plKey(z), cur = S.pl.get(k);
    if (!force && cur && !cur.err) return;
    S.pl.set(k, { loading: true });
    try { S.pl.set(k, await window.api.sitePageLinks(z.id, z.type)); } catch (e) { S.pl.set(k, { err: e.message }); }
    if (S.zoom && plKey(S.zoom) === k) render();
  }
  // Entra en una página. fromMap: viene del mapa (se anima el zoom desde la tarjeta pulsada y se empieza una miga nueva)
  async function zoomTo(id, type, el, fromMap) {
    const sc = $('.mp-scroll', box());
    if (fromMap && sc && el && !reducedMotion()) {
      const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
      sc.style.transformOrigin = `${r.left + r.width / 2 - b.left + sc.scrollLeft}px ${r.top + r.height / 2 - b.top + sc.scrollTop}px`;
      sc.classList.add('mp-zooming');
      await new Promise((ok) => setTimeout(ok, 220));
    }
    const z = { id, type };
    if (fromMap) S.trail = [];
    const at = S.trail.findIndex((x) => plKey(x) === plKey(z));
    if (at >= 0) S.trail.length = at + 1; else S.trail.push({ ...z, title: pageOf(z)?.title || '' });
    S.zoom = z; S.sel = type === 'page' ? 'pg' + id : null; S.pvAnim = true;
    render();
    ensurePl(z);
  }
  function zoomOut() { S.zoom = null; S.trail = []; render(); }
  // ¿A qué página lleva una tarjeta del mapa? (las de páginas y los elementos de menú que apuntan a una página)
  function cardPage(key) {
    if (/^pg\d+$/.test(key)) return { id: Number(key.slice(2)), type: 'page' };
    if (key === 'home') { const f = S.data.settings?.showOnFront === 'page' ? S.data.settings.pageOnFront : 0; return f && S.data.pages.some((p) => p.id === f) ? { id: f, type: 'page' } : null; }
    if (/^mi\d+$/.test(key)) { const it = allMenuItems().find((x) => x.id === Number(key.slice(2))); if (it && it.object === 'page' && S.data.pages.some((p) => p.id === Number(it.objectId))) return { id: Number(it.objectId), type: 'page' }; }
    return null;
  }

  const stBadge = (s) => (s && s !== 'publish' ? `<span class="mp-b off">${esc(STATUS()[s]?.[0] || s)}</span>` : '');
  // Miniatura esquemática de los bloques
  const KMAP = { heading: 'h', paragraph: 'p', image: 'img', cover: 'img', gallery: 'gal', buttons: 'btn', list: 'list', quote: 'q', video: 'img', embed: 'img', separator: 'sep', spacer: 'sep' };
  const thumb = (outline) => `<div class="pv-thumb" title="${t('Así está organizada la página, de arriba abajo')}">${(outline || []).slice(0, 16).map((b) => `<i class="k-${KMAP[b] || 'o'}"></i>`).join('') || `<em>${t('Página vacía')}</em>`}</div>`;

  // Tarjeta de destino de un botón o enlace
  function destCard(res, d, href) {
    const me = d.type + d.id;
    if (res.kind === 'internal') {
      const self = res.type + res.id === me;
      return `<div class="pv-card pv-dest ${self ? 'self' : ''}" ${self ? '' : `data-go="${res.type}:${res.id}" tabindex="0" role="button"`} title="${esc(res.title)}">
        <span class="ms">${res.type === 'post' ? 'article' : 'description'}</span><span class="pv-ct">${esc(res.title)}${res.frag ? `<small>#${esc(res.frag)}</small>` : ''}</span>${self ? `<span class="mp-b">${t('Esta misma página')}</span>` : ''}${stBadge(res.status)}</div>`;
    }
    const mk = (cls, ic, label, extra = '') => `<div class="pv-card pv-dest ${cls}" ${extra} title="${esc(href)}"><span class="ms">${ic}</span><span class="pv-ct">${esc(label)}</span></div>`;
    if (res.kind === 'external') return mk('ext', 'public', t('Web externa: {d}', { d: res.host }), `data-ext="${esc(href)}" tabindex="0" role="button"`);
    if (res.kind === 'anchor') return mk('anchor', 'tag', t('Un punto de esta página (#{a})', { a: res.frag }));
    if (res.kind === 'mail') return mk('ext', 'mail', t('Correo: {d}', { d: res.to }));
    if (res.kind === 'tel') return mk('ext', 'call', t('Teléfono: {d}', { d: res.to }));
    if (res.kind === 'file') return mk('ext', 'attach_file', t('Archivo: {d}', { d: res.name }));
    if (res.kind === 'home') return mk('ext', 'home', t('Portada de la web'));
    if (res.kind === 'empty') return mk('warn', 'link_off', t('Sin destino'));
    return mk('warn', 'heart_broken', t('Enlace roto: no se encuentra esa página'));
  }

  function pageViewHtml() {
    const z = S.zoom, d = S.pl.get(plKey(z)), pg = pageOf(z);
    const crumbs = `<nav class="pv-crumbs"><a data-pv="back">${t('Mapa')}</a>${S.trail.map((c, i) => `<span class="ms">chevron_right</span>${i === S.trail.length - 1 ? `<b>${esc(c.title || pg?.title || '…')}</b>` : `<a data-pv="crumb" data-i="${i}">${esc(c.title || '…')}</a>`}`).join('')}</nav>`;
    const top = `<div class="pv-top"><button class="btn tonal small" data-pv="back"><span class="ms">arrow_back</span>${t('Volver al mapa')}</button>${crumbs}<span class="spacer"></span>
      ${d && d.id ? `<button class="btn text small" data-pv="reload" title="${t('Volver a leer esta página')}"><span class="ms">refresh</span></button>` : ''}</div>`;
    if (!d || d.loading) return `<div class="st-map st-pv ${S.pvAnim ? 'pv-in' : ''}">${top}<div class="pv-wait"><span class="spin"></span>${t('Leyendo los botones y enlaces de la página…')}</div></div>`;
    if (d.err) return `<div class="st-map st-pv">${top}<div class="empty"><span class="ms">cloud_off</span><span>${esc(d.err)}</span></div></div>`;
    const tools = z.type === 'page' ? `<div class="mp-tools">${mapTools()}</div>` : `<div class="mp-tools"><b class="mp-sel">${esc(d.title)}</b><span class="spacer"></span>
      <button class="btn tonal small" data-pv="ecos"><span class="ms">edit_square</span>${t('Abrir en Ecos')}</button><button class="btn tonal small" data-pv="web"><span class="ms">public</span>${t('Ver en la web')}</button></div>`;
    const row = (l, i, isBtn) => `<div class="pv-row ${isBtn ? '' : 'sm'} ${S.fresh.has(l.text + '|' + l.href) ? 'fresh' : ''}" data-row="${isBtn ? 'b' : 'l'}${i}">
      <div class="pv-chip ${l.variant === 'outline' ? 'outline' : ''}" ${isBtn ? '' : 'data-plain="1"'}><span class="pv-ch-t">${esc(l.text || t('(sin texto)'))}</span>
        ${isBtn ? (l.editable ? `<button class="pv-ico" data-pv="edit" data-i="${i}" title="${t('Cambiar este botón')}"><span class="ms">edit</span></button><button class="pv-ico" data-pv="del" data-i="${i}" title="${t('Quitar este botón')}"><span class="ms">delete</span></button>`
          : `<span class="pv-ico pv-locked" title="${t('Este botón lo puso otro editor de la web (por ejemplo Elementor o el tema). Se cambia en WordPress.')}"><span class="ms">lock</span></span>`) : ''}</div>
      <span class="pv-arrow"><span class="ms">arrow_forward</span></span>${destCard(l.res, d, l.href)}</div>`;
    const lim = S.plAll ? 999 : 10;
    const others = S.data.pages.filter((p) => !(z.type === 'page' && p.id === z.id));
    const locked = d.buttons.filter((b) => !b.editable).length;
    const elem = d.builder === 'elementor';
    const help = `<div class="pv-help"><span class="ms">info</span><span>${t('Aquí ves <b>adónde lleva cada botón</b> de «{p}» (derecha) y <b>desde qué páginas se llega</b> a ella (izquierda). Pulsa cualquier página para entrar en ella. Para unirla con otra, pulsa <b>«+ Añadir botón»</b> o elige la página en la lista de abajo.', { p: esc(d.title) })}</span></div>`
      + (elem ? `<div class="pv-help warn"><span class="ms">design_services</span><span>${t('Esta página está <b>diseñada con Elementor</b>. Ecos te enseña adónde llevan sus botones, pero los que añade Ecos aparecen <b>al final de la página, fuera del diseño</b>. Para añadir, colocar o dar estilo a botones aquí, usa Elementor.')}</span><button class="btn tonal small" data-pv="elementor"><span class="ms">open_in_new</span>${t('Abrir en Elementor')}</button></div>`
        : d.builder === 'spectra' ? `<div class="pv-help warn"><span class="ms">view_quilt</span><span>${t('Esta página está montada con <b>bloques de diseño de Spectra</b> (columnas, contenedores y sus botones). Ecos añade los botones nuevos <b>al final de la página</b>. Para <b>subirlo</b> entre los bloques, ábrela en Ecos y arrástralo; para meterlo <b>dentro de una columna</b> o darle el mismo estilo que los demás botones, usa el editor de WordPress.')}</span><span class="pv-hb"><button class="btn tonal small" data-pv="ecos"><span class="ms">edit_square</span>${t('Abrir en Ecos')}</button><button class="btn text small" data-pv="wpedit"><span class="ms">open_in_new</span>${t('Abrir en WordPress')}</button></span></div>`
        : `<div class="pv-help"><span class="ms">open_with</span><span>${t('¿Quieres <b>mover</b> un botón, ponerlo en otro sitio o cambiar su <b>estilo</b>? Abre la página en Ecos: ahí lo arrastras donde quieras y eliges relleno o contorno y su alineación.')}</span><button class="btn text small" data-pv="ecos"><span class="ms">edit_square</span>${t('Abrir en Ecos')}</button></div>`)
      + (locked && !elem && d.builder !== 'spectra' ? `<div class="pv-help warn"><span class="ms">lock</span><span>${t('{n} de sus botones los puso otro editor de la web (por ejemplo Elementor o el tema), así que Ecos los muestra pero no los cambia.', { n: locked })}</span><button class="btn text small" data-pv="wpedit"><span class="ms">open_in_new</span>${t('Cambiarlos en WordPress')}</button></div>` : '');
    // en páginas de Elementor no se añaden botones desde aquí (quedarían fuera del diseño)
    const canAdd = !elem;
    return `<div class="st-map st-pv ${S.pvAnim ? 'pv-in' : ''}">${top}${tools}${help}
      <div class="pv-stage"><svg class="pv-svg" aria-hidden="true"><defs><marker id="pvAr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="currentColor"/></marker></defs></svg>
        <div class="pv-col pv-inc"><div class="pv-h"><span class="ms">login</span>${t('Llegan aquí desde…')}</div>
          ${d.incoming.length ? d.incoming.map((x) => `<div class="pv-card pv-from" data-go="${x.type}:${x.id}" tabindex="0" role="button" title="${esc(x.title)}"><span class="ms">${x.type === 'post' ? 'article' : 'description'}</span><span class="pv-ct">${esc(x.title)}</span>${stBadge(x.status)}</div>`).join('') : `<div class="hint pv-none">${t('Ninguna otra página enlaza a esta con un botón o un enlace.')}</div>`}</div>
        <div class="pv-mid"><div class="pv-main"><div class="pv-mh"><span class="ms fill">${z.type === 'post' ? 'article' : 'description'}</span><b>${esc(d.title)}</b>${stBadge(d.status) || `<span class="mp-b">${t('Publicada')}</span>`}</div>
          ${thumb(d.outline)}
          <div class="pv-cnt">${t('{b} botón(es) · {l} enlace(s) en el texto', { b: d.buttons.length, l: d.links.length + d.moreLinks })}</div>
          ${canAdd ? `<button class="btn filled small pv-add" data-pv="add">${t('+ Añadir botón')}</button>
          <span class="pv-conn" draggable="true" data-pv-conn title="${t('Arrastra este punto hasta otra página para unirlas con un botón')}"><span class="ms">drag_indicator</span></span>` : `<button class="btn tonal small pv-add" data-pv="elementor"><span class="ms">open_in_new</span>${t('Añadir botones en Elementor')}</button>`}</div></div>
        <div class="pv-col pv-out"><div class="pv-h"><span class="ms">logout</span>${t('Esta página lleva a…')}</div>
          <div class="pv-g">${t('Botones')}</div>
          ${d.buttons.length ? d.buttons.map((b, i) => row(b, i, true)).join('') : `<div class="hint pv-none">${t('No tiene botones. Pulsa «+ Añadir botón» para unirla con otra página.')}</div>`}
          ${d.links.length ? `<div class="pv-g">${t('Enlaces del texto')}</div>${d.links.slice(0, lim).map((l, i) => row(l, i, false)).join('')}
            ${d.links.length > lim ? `<button class="btn text small pv-more" data-pv="more">${t('Ver los {n} restantes', { n: d.links.length - lim })}</button>` : ''}` : ''}</div>
      </div>
      <div class="pv-others" ${canAdd ? '' : 'hidden'}><div class="pv-oh"><span class="ms">add_link</span><b>${t('Añadir un botón que lleve a otra página')}</b><span class="hint">${t('Pulsa la página de destino (o arrastra hasta ella el punto ⋮ de la tarjeta)')}</span></div>
        ${others.map((p) => `<span class="pv-pill" role="button" tabindex="0" data-go="page:${p.id}" data-pill title="${esc(t('Añadir en «{a}» un botón que lleve a «{b}»', { a: d.title, b: p.title }))}"><span class="ms">add</span>${esc(p.title)}</span>`).join('')}</div>
    </div>`;
  }

  // Dibuja las líneas entre la tarjeta central y los botones / páginas que enlazan a ella
  function drawLines() {
    const st = $('.pv-stage', box()); if (!st) return;
    const svg = $('.pv-svg', st), sb = st.getBoundingClientRect();
    const pt = (el, side) => { const r = el.getBoundingClientRect(); return [(side === 'r' ? r.right : r.left) - sb.left + st.scrollLeft, r.top + r.height / 2 - sb.top + st.scrollTop]; };
    const main = $('.pv-main', st); if (!main) return;
    svg.setAttribute('width', st.scrollWidth); svg.setAttribute('height', st.scrollHeight);
    const curve = (a, b) => { const dx = Math.max(24, Math.abs(b[0] - a[0]) / 2); return `M${a[0]} ${a[1]}C${a[0] + dx} ${a[1]} ${b[0] - dx} ${b[1]} ${b[0]} ${b[1]}`; };
    const o = pt(main, 'r'), inn = pt(main, 'l');
    let h = '';
    $$('.pv-row .pv-chip', st).forEach((c) => { h += `<path class="${c.dataset.plain ? 'pl' : ''}" d="${curve(o, pt(c, 'l'))}" marker-end="url(#pvAr)"/>`; });
    $$('.pv-from', st).forEach((c) => { h += `<path class="in" d="${curve(pt(c, 'r'), inn)}" marker-end="url(#pvAr)"/>`; });
    $$('path', svg).forEach((p) => p.remove());
    svg.insertAdjacentHTML('beforeend', h);
  }

  // --- Diálogo «Añadir / cambiar botón» --------------------------------------------------------
  // → { text, href, variant, where } | 'remove' | null
  function buttonDialog({ btn, target, targets }) {
    const edit = !!btn;
    return new Promise((resolve) => {
      const prev = document.activeElement, d = document.createElement('div');
      d.className = 'dlg-scrim';
      let sel = null, variant = btn?.variant === 'outline' ? 'outline' : 'fill', where = 'end';
      if (btn?.href) sel = btn.res?.kind === 'internal' ? { href: btn.href, label: btn.res.title, int: true } : { href: btn.href, label: btn.href };
      if (target) sel = { href: target.link, label: target.title, int: true };
      d.innerHTML = `<div class="dlg st-dlg pv-dlg" role="dialog" aria-modal="true"><span class="ms fill dlg-ic">smart_button</span>
        <p class="dlg-msg">${edit ? t('Cambiar el botón') : t('Añadir un botón a esta página')}</p>
        <label class="st-fld"><span>${t('Texto del botón')}</span><input type="text" data-f="text" value="${esc(btn?.text || '')}" placeholder="${t('Por ejemplo: Colabora')}"></label>
        <div class="st-fld"><span>${t('Adónde lleva')}</span><div class="pv-sel"></div>
          <input type="text" data-f="q" placeholder="${t('Busca una página o entrada, o escribe una dirección web')}" autocomplete="off"><div class="pv-res"></div></div>
        <div class="st-fld"><span>${t('Estilo')}</span><div class="pv-seg" data-seg="variant"><button type="button" data-v="fill"><span class="pv-sw"></span>${t('Relleno')}</button><button type="button" data-v="outline"><span class="pv-sw o"></span>${t('Contorno')}</button></div></div>
        ${edit ? '' : `<div class="st-fld"><span>${t('Dónde ponerlo')}</span><div class="pv-seg" data-seg="where"><button type="button" data-v="end">${t('Al final de la página')}</button><button type="button" data-v="afterFirst">${t('Después del primer párrafo')}</button></div></div>`}
        <div class="dlg-actions st-dlg-act"><button class="btn text" data-b="">${t('Cancelar')}</button>${edit ? `<button class="btn text danger" data-b="remove">${t('Quitar botón')}</button>` : ''}<button class="btn filled" data-b="ok">${edit ? t('Guardar') : t('Añadir botón')}</button></div></div>`;
      const q = $('[data-f="q"]', d), tx = $('[data-f="text"]', d), res = $('.pv-res', d), selBox = $('.pv-sel', d);
      const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const looksUrl = (s) => /^(https?:\/\/|mailto:|tel:)/i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s);
      const paint = () => {
        selBox.innerHTML = sel ? `<span class="pv-chosen"><span class="ms">${sel.int ? 'description' : 'public'}</span><b>${esc(sel.label)}</b><button type="button" data-clear title="${t('Cambiar destino')}"><span class="ms">close</span></button></span>` : `<span class="hint">${t('Todavía no has elegido adónde lleva.')}</span>`;
        const s = norm(q.value.trim());
        let list = targets.filter((x) => !s || norm(x.title).includes(s));
        list = list.slice(0, 8);
        const raw = q.value.trim();
        res.innerHTML = list.map((x, i) => `<button type="button" data-t="${i}"><span class="ms">${x.type === 'post' ? 'article' : 'description'}</span>${esc(x.title)}${x.type === 'post' ? `<small>${t('Entrada')}</small>` : ''}</button>`).join('')
          + (raw && looksUrl(raw) ? `<button type="button" data-u><span class="ms">public</span>${t('Usar la dirección: {u}', { u: esc(raw) })}</button>` : '')
          || `<div class="hint">${t('No hay ninguna página con ese nombre.')}</div>`;
        res.style.display = q.value || !sel ? '' : 'none';
        $$('[data-t]', res).forEach((b) => (b.onclick = () => { const x = list[Number(b.dataset.t)]; sel = { href: x.link, label: x.title, int: true }; if (!tx.value.trim()) tx.value = x.title; q.value = ''; paint(); }));
        const u = $('[data-u]', res); if (u) u.onclick = () => useUrl();
        const c = $('[data-clear]', selBox); if (c) c.onclick = () => { sel = null; paint(); q.focus(); };
        $$('.pv-seg', d).forEach((g) => $$('button', g).forEach((b) => b.classList.toggle('on', b.dataset.v === (g.dataset.seg === 'variant' ? variant : where))));
      };
      const useUrl = () => { let u = q.value.trim(); if (!u) return false; if (!/^[a-z]+:/i.test(u)) u = 'https://' + u; sel = { href: u, label: u }; q.value = ''; paint(); return true; };
      const close = (r) => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(r); };
      const go = () => {
        if (!sel && q.value.trim() && looksUrl(q.value.trim())) useUrl();
        if (!tx.value.trim()) { tx.focus(); return; }
        if (!sel) { q.focus(); return; }
        close({ text: tx.value.trim(), href: sel.href, variant, where });
      };
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } else if (e.key === 'Enter' && e.target.matches?.('input')) { e.preventDefault(); e.stopPropagation(); if (e.target === q && q.value.trim() && !sel) { const f = $('[data-t]', res); if (f) f.click(); else useUrl(); } else go(); } };
      $$('.pv-seg button', d).forEach((b) => (b.onclick = () => { if (b.parentNode.dataset.seg === 'variant') variant = b.dataset.v; else where = b.dataset.v; paint(); }));
      $$('[data-b]', d).forEach((b) => (b.onclick = () => (b.dataset.b === 'ok' ? go() : close(b.dataset.b === 'remove' ? 'remove' : null))));
      q.oninput = paint; q.onfocus = paint;
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(d);
      paint();
      (edit || target ? tx : tx).focus();
    });
  }

  async function pvOp(op, msg) {
    const z = S.zoom, k = plKey(z), old = S.pl.get(k);
    const before = new Set((old?.buttons || []).map((b) => b.text + '|' + b.href));
    const d = await window.api.siteButtonOp(z.id, z.type, op);
    // el resto de páginas pueden haber cambiado (quién enlaza a quién): se vuelven a leer al entrar
    for (const key of [...S.pl.keys()]) if (key !== k) S.pl.delete(key);
    S.pl.set(k, d);
    S.fresh = new Set(d.buttons.map((b) => b.text + '|' + b.href).filter((x) => !before.has(x)));
    S.pvAnim = false;
    toast(msg);
    render();
    setTimeout(() => { S.fresh.clear(); }, 2500);
  }
  async function addButton(target) {
    const d = S.pl.get(plKey(S.zoom)); if (!d || !d.targets) return;
    const r = await buttonDialog({ target, targets: d.targets.filter((x) => !(x.type === d.type && x.id === d.id)) });
    if (!r) return;
    await pvOp({ action: 'add', ...r }, t('Botón «{b}» añadido a la página.', { b: r.text }));
  }
  async function editBtn(i) {
    const d = S.pl.get(plKey(S.zoom)), b = d.buttons[i]; if (!b) return;
    const r = await buttonDialog({ btn: b, targets: d.targets.filter((x) => !(x.type === d.type && x.id === d.id)) });
    if (!r) return;
    if (r === 'remove') return delBtn(i, true);
    await pvOp({ action: 'edit', index: b.index, old: { text: b.text, href: b.href }, text: r.text, href: r.href, variant: r.variant }, t('Botón cambiado.'));
  }
  async function delBtn(i, sure) {
    const d = S.pl.get(plKey(S.zoom)), b = d.buttons[i]; if (!b) return;
    if (!sure && !(await window.ask(t('¿Quitar el botón «{b}» de esta página?', { b: b.text }), { ok: t('Quitar botón'), danger: true }))) return;
    await pvOp({ action: 'remove', index: b.index, old: { text: b.text, href: b.href } }, t('Botón quitado.'));
  }

  let pvDrag = false;
  function wirePv() {
    const root = box();
    if (!S.zoom) return;
    const z = S.zoom, d = S.pl.get(plKey(z));
    const fail = (e) => toast(e.message, true);
    S.pvAnim = false;
    $$('[data-pv]', root).forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const a = b.dataset.pv, i = Number(b.dataset.i);
        if (a === 'back') return zoomOut();
        if (a === 'crumb') { const c = S.trail[i]; S.trail.length = i; return zoomTo(c.id, c.type); }
        if (a === 'reload') return ensurePl(z, true).catch(fail);
        if (a === 'more') { S.plAll = true; return render(); }
        if (a === 'add') return addButton().catch(fail);
        if (a === 'edit') return editBtn(i).catch(fail);
        if (a === 'del') return delBtn(i).catch(fail);
        if (a === 'ecos') return window.openFromWp?.(z.id, null, z.type);
        if (a === 'elementor') return window.api.blogEditUrl(z.id, z.type).then((u) => window.api.open(String(u).replace(/action=edit\b/, 'action=elementor'))).catch(fail);
        if (a === 'wpedit') return window.api.blogEditUrl(z.id, z.type).then((u) => window.api.open(u)).catch(fail);
        if (a === 'web') { if (d?.link) window.api.open(d.link); }
      };
    });
    $$('[data-go]', root).forEach((c) => {
      const [type, id] = c.dataset.go.split(':');
      const go = () => zoomTo(Number(id), type, c, false);
      if (!c.hasAttribute('data-pill')) { c.onclick = go; c.onkeydown = (e) => { if (e.key === 'Enter') go(); }; }
      else c.onclick = () => { const x = d?.targets?.find((y) => y.type === type && y.id === Number(id)); if (x) addButton(x).catch(fail); };
      // soltar el conector aquí: abre el diálogo con este destino
      c.ondragover = (e) => { if (pvDrag) { e.preventDefault(); c.classList.add('pv-over'); } };
      c.ondragleave = () => c.classList.remove('pv-over');
      c.ondrop = (e) => {
        c.classList.remove('pv-over'); if (!pvDrag) return; e.preventDefault(); pvDrag = false;
        const x = d?.targets?.find((y) => y.type === type && y.id === Number(id));
        if (x && !(x.type === z.type && x.id === z.id)) addButton(x).catch(fail);
      };
    });
    $$('[data-ext]', root).forEach((c) => (c.onclick = () => window.api.open(c.dataset.ext)));
    const conn = $('[data-pv-conn]', root);
    if (conn) {
      conn.ondragstart = (e) => { pvDrag = true; e.dataTransfer.effectAllowed = 'link'; e.dataTransfer.setData('text/x-ecos', 'pv'); root.classList.add('pv-dragging'); document.body.classList.add('dragging-internal'); };
      conn.ondragend = () => { pvDrag = false; root.classList.remove('pv-dragging'); document.body.classList.remove('dragging-internal'); };
    }
    if (d && d.buttons) {
      drawLines();
      const st = $('.pv-stage', root);
      if (st && window.ResizeObserver) { S.pvRO?.disconnect(); S.pvRO = new ResizeObserver(() => drawLines()); S.pvRO.observe(st); }
    }
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !S.zoom || document.querySelector('.dlg-scrim') || !box()?.offsetParent) return;
    e.preventDefault(); zoomOut();
  });

  // --- Interacción ---------------------------------------------------------------------------
  function removeMenuItem(id) {
    const d = S.data, m = d.menus.find((x) => x.items.some((i) => i.id === id)) || d.menus[S.menu];
    const it = m.items.find((x) => x.id === id);
    if (!it) return;
    m.items.filter((x) => x.parent === id).forEach((x) => (x.parent = it.parent)); // sus hijos suben un nivel
    m.items = m.items.filter((x) => x.id !== id);
    if (typeof id === 'number') S.del.add(id);
    renumber(m.items, it.parent);
  }
  function addToMenu(kind, id) {
    const m = S.data.menus[S.menu];
    if (!m) { toast(t('Tu tema usa menús de bloques: el menú se edita en Apariencia → Editor → Navegación.'), true); return false; }
    const it = newMenuItem(kind, id);
    m.items.push(it); move(m.items, it.id, null, 'end');
    return true;
  }
  const ecosEditPage = async (p) => {
    if (typeof window.openFromWp === 'function') return window.openFromWp(p.id, null, 'page');
    window.api.open(await window.api.blogEditUrl(p.id, 'page'));
  };

  async function run(a, k, i, el) {
    const d = S.data;
    const page = k === 'page' ? d.pages.find((x) => x.id === i) : null;
    const cat = k === 'cat' ? d.categories.find((x) => x.id === i) : null;
    if (a === 'revall') { S.revAll = !S.revAll; return render(); }
    if (a === 'addpage' || a === 'subpage') {
      const parent = a === 'subpage' ? page : null;
      const r = await form(parent ? t('Nueva subpágina dentro de «{p}»', { p: parent.title }) : t('Nueva página'), [{ key: 'name', label: t('Nombre de la página'), ph: t('Por ejemplo: Quiénes somos') }],
        [{ id: 'empty', label: t('Solo crearla vacía'), cls: 'tonal' }, { id: 'ecos', label: t('Escribirla ahora en Ecos'), cls: 'filled' }], parent ? 'subdirectory_arrow_right' : 'note_add');
      if (!r) return;
      if (r.btn === 'ecos') {
        if (typeof window.newDraft === 'function') return window.newDraft({ type: 'page', title: r.v.name, parent: parent ? parent.id : 0 });
        toast(t('Esta versión todavía no puede abrir un borrador nuevo desde aquí. Se creará vacía.'), true);
      }
      try {
        const p = await window.api.siteCreatePage({ title: r.v.name, parent: parent ? parent.id : 0, status: 'draft' });
        d.pages.push(clone(p)); S.orig.pages.push(clone(p));
        if (parent) S.open.add('p' + parent.id);
        S.sel = 'pg' + p.id;
        toast(t('Página «{p}» creada como borrador.', { p: p.title }));
      } catch (e) { toast(e.message, true); }
      return render();
    }
    if (a === 'addcat' || a === 'subcat') {
      const r = await form(cat ? t('Nueva subcategoría dentro de «{c}»', { c: cat.name }) : t('Nueva categoría'), [{ key: 'name', label: t('Nombre de la categoría') }], null, 'create_new_folder');
      if (!r) return;
      try {
        const c = await window.api.siteCreateCategory({ name: r.v.name, parent: cat ? cat.id : 0 });
        d.categories.push(clone(c)); S.orig.categories.push(clone(c));
        if (cat) S.open.add('c' + cat.id);
        S.sel = 'ct' + c.id;
        toast(t('Categoría «{c}» creada.', { c: c.name }));
      } catch (e) { toast(e.message, true); }
      return render();
    }
    if (a === 'newpost') {
      if (typeof window.newDraft === 'function') return window.newDraft({ type: 'post', categories: [cat.name] });
      return toast(t('Esta versión todavía no puede abrir un borrador nuevo desde aquí.'), true);
    }
    if (a === 'addlink') {
      const m = d.menus[S.menu];
      if (!m) return;
      const r = await form(t('Nuevo enlace en el menú'), [{ key: 'name', label: t('Texto del enlace'), ph: t('Por ejemplo: Tienda') }, { key: 'url', label: t('Dirección (https://…)'), ph: 'https://' }], [{ id: 'ok', label: t('Añadir al menú'), cls: 'filled' }], 'add_link');
      if (!r) return;
      let url = r.v.url; if (url && !/^[a-z]+:|^[/#]/i.test(url)) url = 'https://' + url;
      m.items.push({ id: 't' + ++S.tmp, title: r.v.name, type: 'custom', object: 'custom', objectId: 0, url: url || '#', parent: 0, order: 999 });
      move(m.items, 't' + S.tmp, null, 'end');
      return render();
    }
    if (a === 'addmenu') { if (addToMenu(k, i)) { toast(t('Añadida al menú. Pulsa «Guardar cambios» para publicarlo.')); render(); } return; }
    if (a === 'addallmenu') { const r = review(); let n = 0; for (const p of r.unlinked) if (addToMenu('page', p.id)) n++; if (n) toast(t('{n} página(s) añadidas al menú.', { n })); return render(); }
    if (a === 'rmmenu') { removeMenuItem(/^t/.test(String(i)) ? String(i) : Number(i)); S.sel = null; return render(); }
    if (a === 'publish') { page.status = page.status === 'publish' ? 'draft' : 'publish'; return render(); }
    if (a === 'ren') {
      const cur = page ? page.title : cat.name;
      const r = await form(page ? t('Renombrar la página') : t('Renombrar la categoría'), [{ key: 'name', label: t('Nuevo nombre'), value: cur }], [{ id: 'ok', label: t('Cambiar nombre'), cls: 'filled' }], 'edit');
      if (!r) return;
      if (page) page.title = r.v.name; else cat.name = r.v.name;
      return render();
    }
    if (a === 'zoom') return zoomTo(page.id, 'page', null, !S.zoom);
    if (a === 'ecospage') return ecosEditPage(page);
    if (a === 'web') { if (page?.link) window.api.open(page.link); return; }
    if (a === 'trash') {
      if (d.pages.some((x) => x.parent === page.id)) return toast(t('«{p}» tiene subpáginas. Muévelas o bórralas antes.', { p: page.title }), true);
      if (!(await window.ask(t('¿Mandar «{p}» a la papelera de WordPress? Se puede recuperar desde wp-admin.', { p: page.title }), { ok: t('Mandar a la papelera'), danger: true }))) return;
      try {
        await window.api.siteTrashPage(page.id);
        d.pages = d.pages.filter((x) => x.id !== page.id); S.orig.pages = S.orig.pages.filter((x) => x.id !== page.id); S.sel = null; S.zoom = null; S.trail = [];
        toast(t('Página enviada a la papelera.'));
      } catch (e) { toast(e.message, true); }
      return render();
    }
    if (a === 'delcat') {
      if (cat.count || d.categories.some((x) => x.parent === cat.id)) return toast(t('Solo se pueden borrar categorías vacías y sin subcategorías.'), true);
      if (!(await window.ask(t('¿Borrar la categoría vacía «{c}»?', { c: cat.name }), { ok: t('Borrar'), danger: true }))) return;
      try {
        await window.api.siteDeleteCategory(cat.id);
        d.categories = d.categories.filter((x) => x.id !== cat.id); S.orig.categories = S.orig.categories.filter((x) => x.id !== cat.id); S.sel = null;
        toast(t('Categoría borrada.'));
      } catch (e) { toast(e.message, true); }
      return render();
    }
  }

  function wire() {
    const d = S.data, root = box();
    $$('[data-a]', root).forEach((b) => {
      if (b.dataset.a === 'menu') b.onchange = () => { S.menu = Number(b.value); render(); };
      else b.onclick = () => act(b.dataset.a, b);
    });
    $$('[data-view]', root).forEach((b) => (b.onclick = () => { S.view = b.dataset.view; render(); }));
    $$('details.st-rev', root).forEach((x) => (x.ontoggle = () => { S.revOpen = x.open; }));
    $$('[data-sel]', root).forEach((c) => (c.onclick = () => { const z = cardPage(c.dataset.sel); if (z) return zoomTo(z.id, z.type, c, true); S.sel = S.sel === c.dataset.sel ? null : c.dataset.sel; render(); }));
    $$('[data-do]', root).forEach((b) => {
      const go = (e) => { e.stopPropagation(); const i = b.dataset.i; run(b.dataset.do, b.dataset.k, /^t/.test(i || '') ? i : Number(i), b).catch((err) => toast(err.message, true)); };
      if (b.dataset.dbl) b.ondblclick = go; else b.onclick = go;
    });
    $$('[data-set]', root).forEach((s) => (s.onchange = () => { d.settings[s.dataset.set] = s.dataset.set === 'showOnFront' ? s.value : Number(s.value); render(); }));
    $$('[data-tw]', root).forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const k = b.dataset.tw;
      if (S.open.has(k)) S.open.delete(k); else { S.open.add(k); if (k[0] === 'c') { render(); await loadCat(Number(k.slice(1))).catch((err) => toast(err.message, true)); } }
      render();
    }));
    $$('[data-vis]', root).forEach((b) => (b.onclick = () => { const p = d.pages.find((x) => x.id === Number(b.dataset.vis)); p.status = p.status === 'publish' ? 'draft' : 'publish'; render(); }));
    $$('[data-rm]', root).forEach((b) => (b.onclick = () => { removeMenuItem(/^t/.test(b.dataset.rm) ? b.dataset.rm : Number(b.dataset.rm)); render(); }));
    $$('[data-pin]', root).forEach((b) => (b.onclick = () => { const p = S.posts.get(Number(b.dataset.pin)); p.sticky = !p.sticky; render(); }));
    $$('[data-ecos]', root).forEach((b) => (b.onclick = () => window.openFromWp?.(Number(b.dataset.ecos))));

    wirePv();
    // Arrastrar y soltar
    $$('.st-node[draggable]', root).forEach((el) => {
      el.ondragstart = (e) => {
        const id = el.dataset.id;
        drag = { kind: el.dataset.kind, id: /^t/.test(id) ? id : Number(id), cat: Number(el.dataset.cat) || null };
        e.dataTransfer.effectAllowed = 'copyMove'; e.dataTransfer.setData('text/x-ecos', 'st');
        el.classList.add('dragging'); document.body.classList.add('dragging-internal');
      };
      el.ondragend = () => { drag = null; el.classList.remove('dragging'); document.body.classList.remove('dragging-internal'); $$('.st-over, .st-before, .st-after, .st-inside', root).forEach((x) => x.classList.remove('st-over', 'st-before', 'st-after', 'st-inside')); };
      el.ondragover = (e) => {
        const pos = where(e, el);
        if (!pos) return;
        e.preventDefault();
        el.classList.remove('st-before', 'st-after', 'st-inside'); el.classList.add('st-' + pos);
      };
      el.ondragleave = () => el.classList.remove('st-before', 'st-after', 'st-inside');
      el.ondrop = (e) => { const pos = where(e, el); el.classList.remove('st-before', 'st-after', 'st-inside'); if (!pos) return; e.preventDefault(); drop(el, pos, e); };
    });
    $$('.st-drop-end', root).forEach((z) => {
      z.ondragover = (e) => { if (canEnd(z.dataset.end)) { e.preventDefault(); z.classList.add('st-over'); } };
      z.ondragleave = () => z.classList.remove('st-over');
      z.ondrop = (e) => { z.classList.remove('st-over'); if (!canEnd(z.dataset.end)) return; e.preventDefault(); dropEnd(z.dataset.end); };
    });
  }
  const canEnd = (end) => drag && (end === 'menu' ? ['menu', 'page', 'cat'].includes(drag.kind) && S.data.menus[S.menu] : drag.kind === 'page');

  // ¿Dónde se soltaría? (antes, después o dentro), según el tipo de lo que se arrastra y lo de debajo
  function where(e, el) {
    if (!drag) return null;
    const k = el.dataset.kind, r = el.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    const tri = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
    if (k === 'menu' && ['menu', 'page', 'cat'].includes(drag.kind)) return tri;
    if (k === 'page' && drag.kind === 'page') return tri;
    if (k === 'cat' && drag.kind === 'post') return drag.cat === Number(el.dataset.id) ? null : 'inside';
    return null;
  }

  function newMenuItem(kind, id) {
    if (kind === 'page') { const p = S.data.pages.find((x) => x.id === id); return { id: 't' + ++S.tmp, title: p.title, type: 'post_type', object: 'page', objectId: p.id, parent: 0, order: 999 }; }
    const c = S.data.categories.find((x) => x.id === id);
    return { id: 't' + ++S.tmp, title: c.name, type: 'taxonomy', object: 'category', objectId: c.id, parent: 0, order: 999 };
  }

  function drop(el, pos, e) {
    const d = S.data, k = el.dataset.kind, target = /^t/.test(el.dataset.id) ? el.dataset.id : Number(el.dataset.id);
    if (k === 'menu') {
      const m = d.menus[S.menu];
      if (drag.kind !== 'menu') { const it = newMenuItem(drag.kind, drag.id); m.items.push(it); move(m.items, it.id, target, pos); }
      else move(m.items, drag.id, target, pos);
    } else if (k === 'page') move(d.pages, drag.id, target, pos);
    else if (k === 'cat') {
      const p = S.posts.get(drag.id);
      const keep = e.ctrlKey || e.metaKey; // con Ctrl se añade a la categoría sin quitarla de la suya
      p.categories = [...new Set([...(keep ? p.categories : p.categories.filter((c) => c !== drag.cat)), target])];
      if (!S.loaded.has(target)) loadCat(target).then(render).catch(() => {});
      toast(keep ? t('Añadida también a «{c}».', { c: d.categories.find((c) => c.id === target)?.name }) : t('Movida a «{c}». (Con Ctrl se añade sin quitarla de la suya.)', { c: d.categories.find((c) => c.id === target)?.name }));
    }
    drag = null;
    render();
  }
  function dropEnd(end) {
    const d = S.data;
    if (end === 'menu') {
      const m = d.menus[S.menu];
      if (drag.kind === 'menu') move(m.items, drag.id, null, 'end');
      else { const it = newMenuItem(drag.kind, drag.id); m.items.push(it); move(m.items, it.id, null, 'end'); }
    } else move(d.pages, drag.id, null, 'end');
    drag = null;
    render();
  }

  async function act(a, b) {
    if (a === 'reload') { if (changes().count && !(await window.ask(t('Se perderán los cambios sin guardar. ¿Recargar?')))) return; return open(true); }
    if (a === 'discard') { if (!(await window.ask(t('¿Descartar los cambios sin guardar?')))) return; S.data = clone(S.orig); S.del.clear(); for (const [id, o] of S.postsOrig) { const p = S.posts.get(id), j = JSON.parse(o); p.categories = j.c; p.sticky = j.s; } return render(); }
    if (a === 'save') {
      const ch = changes();
      if (!ch.count) return;
      const hidden = ch.pages.filter((p) => p.status !== 'publish' && S.orig.pages.find((x) => x.id === p.id)?.status === 'publish').length;
      if (!(await window.ask(t('Se guardarán {n} cambio(s) en tu web.', { n: ch.count }) + (hidden ? ' ' + t('{h} página(s) dejarán de verse.', { h: hidden }) : '') + ' ' + t('¿Continuar?')))) return;
      b.disabled = true; b.innerHTML = `<span class="spin"></span>${t('Guardando…')}`;
      try {
        const r = await window.api.siteSave(ch);
        if (r.errors.length) toast(t('Algunos cambios no se pudieron guardar: {e}', { e: r.errors.slice(0, 2).join(' · ') }), true);
        else toast(t('Estructura guardada en tu web.'));
        await open(true);
      } catch (e) { toast(e.message, true); render(); }
    }
  }

  window.SiteStructure = { open, dirty: () => !!S.data && changes().count > 0 };
})();
