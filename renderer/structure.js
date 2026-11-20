// Estructura de la web (pestaña Blog → Estructura): un esquema editable de cómo está organizada la web.
//  · Portada: qué muestra la página de inicio y qué página lista las entradas.
//  · Menú: sus elementos en árbol; se reordenan y anidan arrastrando, se quitan con el ojo y se añaden
//    arrastrando una página o una categoría desde las otras columnas.
//  · Páginas: árbol de páginas y subpáginas; se reordenan y anidan arrastrando; el ojo las publica o
//    las pasa a borrador.
//  · Categorías: cada una con sus entradas; una entrada se lleva a otra categoría arrastrándola (con Ctrl
//    se añade sin quitarla de la suya), se fija arriba con la chincheta y se abre en el editor de Ecos.
// Los cambios se acumulan y se guardan juntos («Guardar cambios»).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const t = (s, v) => window.I18N.t(s, v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const box = () => $('#b-structure');

  const S = { data: null, orig: null, menu: 0, posts: new Map(), postsOrig: new Map(), loaded: new Set(), open: new Set(), tmp: 0, del: new Set(), busy: false };
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

  // --- Cargar ---------------------------------------------------------------------------------
  async function open(force) {
    if (S.data && !force) { render(); return; }
    box().innerHTML = `<p class="hint pad">${t('Leyendo la estructura de tu web…')}</p>`;
    try {
      const d = await window.api.siteStructure();
      S.data = d; S.orig = JSON.parse(JSON.stringify(d));
      S.posts.clear(); S.postsOrig.clear(); S.loaded.clear(); S.del.clear(); S.menu = 0;
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
    const d = S.data, o = S.orig, ch = { pages: [], menuDel: [...S.del], menuAdd: [], menuItems: [], posts: [] };
    const so = o.settings, sn = d.settings;
    if (sn && so && (sn.showOnFront !== so.showOnFront || sn.pageOnFront !== so.pageOnFront || sn.pageForPosts !== so.pageForPosts)) ch.settings = sn;
    for (const p of d.pages) { const q = o.pages.find((x) => x.id === p.id); if (q && (q.parent !== p.parent || q.order !== p.order || q.status !== p.status)) ch.pages.push({ id: p.id, parent: p.parent, order: p.order, status: p.status }); }
    d.menus.forEach((m, mi) => {
      flat(m.items).forEach((it, i) => {
        const order = i + 1;
        if (typeof it.id === 'string') ch.menuAdd.push({ tmp: it.id, menu: m.id, title: it.title, type: it.type, object: it.object, objectId: it.objectId, url: it.url, parent: it.parent, order });
        else { const q = o.menus[mi].items.find((x) => x.id === it.id); if (q && (q.parent !== it.parent || q.order !== order)) ch.menuItems.push({ id: it.id, parent: it.parent, order }); }
      });
    });
    for (const [id, p] of S.posts) if (S.postsOrig.get(id) !== JSON.stringify({ c: [...p.categories].sort(), s: p.sticky })) ch.posts.push({ id, categories: p.categories, sticky: p.sticky });
    ch.count = (ch.settings ? 1 : 0) + ch.pages.length + ch.menuDel.length + ch.menuAdd.length + ch.menuItems.length + ch.posts.length;
    return ch;
  }

  // --- Dibujo ---------------------------------------------------------------------------------
  function render() {
    const d = S.data;
    const ch = changes();
    const m = d.menus[S.menu];
    const pageName = (id) => d.pages.find((p) => p.id === id)?.title || '—';
    const pageOpts = (sel) => `<option value="0">—</option>` + flat(d.pages).filter((p) => p.status === 'publish').map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.title)}</option>`).join('');
    box().innerHTML = `
      <div class="st-bar">
        <div><b>${t('Estructura de tu web')}</b><div class="hint">${t('Arrastra para ordenar o anidar. Lleva páginas o categorías al menú para añadirlas. Los cambios se guardan al pulsar «Guardar cambios».')}</div></div>
        <span class="spacer"></span>
        <button class="btn text" data-a="reload"><span class="ms">refresh</span>${t('Recargar')}</button>
        <button class="btn text" data-a="discard" ${ch.count ? '' : 'disabled'}>${t('Descartar')}</button>
        <button class="btn filled" data-a="save" ${ch.count ? '' : 'disabled'}><span class="ms">save</span>${ch.count ? t('Guardar cambios ({n})', { n: ch.count }) : t('Sin cambios')}</button>
      </div>
      ${d.settings ? `<div class="st-home">
        <span class="ms fill st-home-ic">home</span>
        <div class="st-home-f"><label>${t('La portada muestra')}</label>
          <select data-set="showOnFront"><option value="posts" ${d.settings.showOnFront === 'posts' ? 'selected' : ''}>${t('Las últimas entradas')}</option><option value="page" ${d.settings.showOnFront === 'page' ? 'selected' : ''}>${t('Una página fija')}</option></select></div>
        ${d.settings.showOnFront === 'page' ? `<div class="st-home-f"><label>${t('Página de inicio')}</label><select data-set="pageOnFront">${pageOpts(d.settings.pageOnFront)}</select></div>
        <div class="st-home-f"><label>${t('Página de entradas')}</label><select data-set="pageForPosts">${pageOpts(d.settings.pageForPosts)}</select></div>` : ''}
      </div>` : ''}
      <div class="st-cols">
        <div class="st-col" data-col="menu">
          <div class="st-col-h"><span class="ms">menu</span><b>${t('Menú')}</b>
            ${d.menus.length > 1 ? `<select data-a="menu">${d.menus.map((x, i) => `<option value="${i}" ${i === S.menu ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : m ? `<span class="hint">${esc(m.name)}</span>` : ''}
          </div>
          ${m ? `${m.locations.length ? `<div class="hint st-loc">${t('Se muestra en: {l}', { l: esc(m.locations.join(', ')) })}</div>` : `<div class="hint st-loc">${t('Este menú no está asignado a ninguna zona del tema.')}</div>`}
            <div class="st-tree" data-tree="menu">${tree(m.items, 0, 'menu')}</div>
            <div class="st-drop-end" data-end="menu">${t('Suelta aquí una página o una categoría para añadirla al menú')}</div>`
          : `<div class="st-note">${d.navigation.length ? t('Tu tema usa menús de bloques ({n}); se editan en Apariencia → Editor → Navegación.', { n: esc(d.navigation.map((x) => x.title).join(', ')) }) : t('No se pudieron leer los menús de tu web.')}${d.menuNote ? `<div class="hint">${esc(d.menuNote)}</div>` : ''}</div>`}
        </div>
        <div class="st-col" data-col="pages">
          <div class="st-col-h"><span class="ms">description</span><b>${t('Páginas')}</b><span class="hint">${d.pages.length}</span></div>
          <div class="st-tree" data-tree="page">${tree(d.pages, 0, 'page')}</div>
          <div class="st-drop-end" data-end="page">${t('Suelta aquí para dejarla en el nivel principal')}</div>
        </div>
        <div class="st-col" data-col="cats">
          <div class="st-col-h"><span class="ms">category</span><b>${t('Categorías y entradas')}</b></div>
          <div class="st-tree">${catTree(0)}</div>
        </div>
      </div>`;
    wire();
    void pageName;
  }

  // ¿Ha cambiado respecto a lo que hay en la web? (se marca hasta guardar)
  function changed(kind, n) {
    if (kind === 'page') { const o = S.orig.pages.find((x) => x.id === n.id); return o && (o.parent !== n.parent || o.order !== n.order || o.status !== n.status); }
    if (typeof n.id === 'string') return false;
    const o = S.orig.menus[S.menu]?.items.find((x) => x.id === n.id);
    return o && o.parent !== n.parent;
  }
  function tree(list, pid, kind) {
    const ch = kids(list, pid);
    if (!ch.length) return pid ? '' : `<div class="hint pad">${t('Vacío')}</div>`;
    return `<ul>${ch.map((n) => {
      const key = (kind === 'menu' ? 'm' : 'p') + n.id;
      const sub = kids(list, n.id).length;
      const st = STATUS()[n.status];
      const front = kind === 'page' && S.data.settings?.showOnFront === 'page' && S.data.settings.pageOnFront === n.id;
      const blogp = kind === 'page' && S.data.settings?.showOnFront === 'page' && S.data.settings.pageForPosts === n.id;
      const icon = kind === 'menu' ? (n.object === 'category' ? 'category' : n.type === 'custom' ? 'link' : 'description') : 'description';
      return `<li>
        <div class="st-node ${kind === 'page' ? 'st-' + n.status : ''} ${typeof n.id === 'string' ? 'new' : ''} ${changed(kind, n) ? 'changed' : ''}" draggable="true" data-kind="${kind}" data-id="${n.id}">
          ${sub ? `<button class="st-tw" data-tw="${key}"><span class="ms">${S.open.has(key) ? 'expand_more' : 'chevron_right'}</span></button>` : '<span class="st-tw"></span>'}
          <span class="ms st-ic">${icon}</span><span class="st-t">${esc(n.title)}</span>
          ${front ? `<span class="st-tag home"><span class="ms">home</span>${t('Inicio')}</span>` : ''}${blogp ? `<span class="st-tag"><span class="ms">article</span>${t('Entradas')}</span>` : ''}
          ${kind === 'page' && n.status !== 'publish' ? `<span class="st-tag off">${esc(st?.[0] || n.status)}</span>` : ''}
          ${typeof n.id === 'string' ? `<span class="st-tag new">${t('Nuevo')}</span>` : ''}
          <span class="spacer"></span>
          ${kind === 'page' ? `<button class="st-act" data-vis="${n.id}" title="${n.status === 'publish' ? t('Visible: pulsa para ocultarla (borrador)') : t('Oculta: pulsa para publicarla')}"><span class="ms">${n.status === 'publish' ? 'visibility' : 'visibility_off'}</span></button>
            <button class="st-act" data-wp="${n.id}" title="${t('Editar en WordPress')}"><span class="ms">open_in_new</span></button>`
          : `<button class="st-act" data-rm="${n.id}" title="${t('Quitar del menú')}"><span class="ms">remove_circle_outline</span></button>`}
        </div>
        ${sub && S.open.has(key) ? tree(list, n.id, kind) : ''}
      </li>`;
    }).join('')}</ul>`;
  }

  function catTree(pid) {
    const cats = S.data.categories.filter((c) => c.parent === pid).sort((a, b) => a.name.localeCompare(b.name));
    if (!cats.length) return '';
    return `<ul>${cats.map((c) => {
      const key = 'c' + c.id;
      const posts = S.loaded.has(c.id) ? [...S.posts.values()].filter((p) => p.categories.includes(c.id)).sort((a, b) => (b.sticky - a.sticky) || String(b.date).localeCompare(String(a.date))) : null;
      const count = posts ? posts.length : c.count;
      return `<li>
        <div class="st-node st-cat" draggable="true" data-kind="cat" data-id="${c.id}">
          <button class="st-tw" data-tw="${key}"><span class="ms">${S.open.has(key) ? 'expand_more' : 'chevron_right'}</span></button>
          <span class="ms st-ic">folder</span><span class="st-t">${esc(c.name)}</span><span class="st-count">${count}</span>
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

  // --- Interacción ---------------------------------------------------------------------------
  function wire() {
    const d = S.data, root = box();
    $$('[data-a]', root).forEach((b) => {
      if (b.dataset.a === 'menu') b.onchange = () => { S.menu = Number(b.value); render(); };
      else b.onclick = () => act(b.dataset.a, b);
    });
    $$('[data-set]', root).forEach((s) => (s.onchange = () => { d.settings[s.dataset.set] = s.dataset.set === 'showOnFront' ? s.value : Number(s.value); render(); }));
    $$('[data-tw]', root).forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const k = b.dataset.tw;
      if (S.open.has(k)) S.open.delete(k); else { S.open.add(k); if (k[0] === 'c') { render(); await loadCat(Number(k.slice(1))).catch((err) => window.toast?.(err.message, true)); } }
      render();
    }));
    $$('[data-vis]', root).forEach((b) => (b.onclick = () => { const p = d.pages.find((x) => x.id === Number(b.dataset.vis)); p.status = p.status === 'publish' ? 'draft' : 'publish'; render(); }));
    $$('[data-wp]', root).forEach((b) => (b.onclick = async () => window.api.open(await window.api.blogEditUrl(Number(b.dataset.wp), 'page'))));
    $$('[data-rm]', root).forEach((b) => (b.onclick = () => {
      const m = d.menus[S.menu], id = /^t/.test(b.dataset.rm) ? b.dataset.rm : Number(b.dataset.rm);
      const it = m.items.find((x) => x.id === id);
      m.items.filter((x) => x.parent === id).forEach((x) => (x.parent = it.parent)); // sus hijos suben un nivel
      m.items = m.items.filter((x) => x.id !== id);
      if (typeof id === 'number') S.del.add(id);
      renumber(m.items, it.parent);
      render();
    }));
    $$('[data-pin]', root).forEach((b) => (b.onclick = () => { const p = S.posts.get(Number(b.dataset.pin)); p.sticky = !p.sticky; render(); }));
    $$('[data-ecos]', root).forEach((b) => (b.onclick = () => window.openFromWp?.(Number(b.dataset.ecos))));

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
      window.toast?.(keep ? t('Añadida también a «{c}».', { c: d.categories.find((c) => c.id === target)?.name }) : t('Movida a «{c}». (Con Ctrl se añade sin quitarla de la suya.)', { c: d.categories.find((c) => c.id === target)?.name }));
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
    if (a === 'discard') { if (!(await window.ask(t('¿Descartar los cambios sin guardar?')))) return; S.data = JSON.parse(JSON.stringify(S.orig)); S.del.clear(); for (const [id, o] of S.postsOrig) { const p = S.posts.get(id), j = JSON.parse(o); p.categories = j.c; p.sticky = j.s; } return render(); }
    if (a === 'save') {
      const ch = changes();
      if (!ch.count) return;
      const hidden = ch.pages.filter((p) => p.status !== 'publish' && S.orig.pages.find((x) => x.id === p.id)?.status === 'publish').length;
      if (!(await window.ask(t('Se guardarán {n} cambio(s) en tu web.', { n: ch.count }) + (hidden ? ' ' + t('{h} página(s) dejarán de verse.', { h: hidden }) : '') + ' ' + t('¿Continuar?')))) return;
      b.disabled = true; b.innerHTML = `<span class="spin"></span>${t('Guardando…')}`;
      try {
        const r = await window.api.siteSave(ch);
        if (r.errors.length) window.toast?.(t('Algunos cambios no se pudieron guardar: {e}', { e: r.errors.slice(0, 2).join(' · ') }), true);
        else window.toast?.(t('Estructura guardada en tu web.'));
        await open(true);
      } catch (e) { window.toast?.(e.message, true); render(); }
    }
  }

  window.SiteStructure = { open, dirty: () => !!S.data && changes().count > 0 };
})();
