// Ecos · Blog → Menús y widgets. Editor de menús (árbol arrastrable de hasta 3 niveles, ubicaciones, menús de bloques)
// y de widgets (zonas, reordenar y mover, widgets de bloque con el editor de Ecos). Lógica pura en menutree.js y
// widgetlogic.js. Todo se guarda junto con confirmación y con copia previa para «Deshacer» (en este ordenador).
const MenusUI = (() => {
  const MT = window.MenuTree, WL = window.WidgetLogic;
  const S = { loaded: false, busy: false, tab: 'menus', data: null, menus: [], orig: [], navs: [], zones: [], origZones: [], sel: null, created: [], seq: 0, add: 'pages', q: '', found: [], note: '', open: null, drag: null };
  const box = () => $('#b-menus');
  const esc = (s) => escHtml(String(s ?? ''));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const UNDO_KEY = 'ecos-menus-undo';
  const getUndo = () => { try { return JSON.parse(localStorage.getItem(UNDO_KEY) || 'null'); } catch { return null; } };
  const setUndo = (v) => { try { localStorage.setItem(UNDO_KEY, JSON.stringify(v)); } catch { /* sin almacenamiento: no habrá «Deshacer» */ } };
  const msg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ------------------------------------------------------------ carga
  async function load() {
    S.busy = true; render();
    try {
      const [m, w] = await Promise.all([window.api.menusLoad(), window.api.widgetsLoad()]);
      S.data = m; S.note = m.note === 'none' && w.note === 'none' ? 'none' : (m.note || w.note || '');
      S.orig = (m.menus || []).map((x) => ({ id: x.id, name: x.name, locations: [...x.locations], items: clone(x.items) }));
      S.menus = S.orig.map((x) => ({ id: x.id, name: x.name, locations: [...x.locations], tree: MT.nest(x.items) }));
      S.navs = (m.navigation || []).map((n) => ({ id: n.id, title: n.title, content: n.content, tree: MT.parseNav(n.content) }));
      S.zones = WL.normalize(w.sidebars || [], w.widgets || []); S.origZones = clone(S.zones);
      if (!S.sel || !curTree()) S.sel = S.menus.length ? S.menus[0].id : S.navs.length ? 'nav:' + S.navs[0].id : null;
      S.loaded = true;
    } catch (e) { S.note = msg(e); }
    S.busy = false; render();
  }
  async function open() { if (S.loaded) return render(); return load(); }

  const isNav = () => String(S.sel).startsWith('nav:');
  const curMenu = () => S.menus.find((m) => String(m.id) === String(S.sel));
  const curNav = () => S.navs.find((n) => 'nav:' + n.id === String(S.sel));
  const curTree = () => (isNav() ? curNav()?.tree : curMenu()?.tree);
  const setTree = (tree) => { if (isNav()) curNav().tree = tree; else curMenu().tree = tree; };

  // ------------------------------------------------------------ cambios pendientes
  function plan() {
    const menus = [], p = { menus, locs: [], navs: [], widgets: null, count: 0 };
    for (const m of S.menus) {
      const o = S.orig.find((x) => x.id === m.id); if (!o) continue;
      const d = MT.diff(o.items, MT.flatten(m.tree));
      if (d.count) menus.push({ menu: m, d });
    }
    p.locs = MT.locationsDiff(S.orig, S.menus);
    for (const n of S.navs) { const out = MT.serializeNav(n.tree); if (out !== MT.serializeNav(MT.parseNav(n.content))) p.navs.push({ nav: n, content: out }); }
    const wd = WL.diff(S.origZones, S.zones);
    p.widgets = wd.count ? wd : null;
    p.count = menus.reduce((s, x) => s + x.d.count, 0) + p.locs.length + p.navs.length + (wd.count || 0);
    return p;
  }
  const dirty = () => plan().count > 0;
  function summary(p) {
    const L = [];
    for (const { menu, d } of p.menus) {
      const bits = [];
      if (d.add.length) bits.push(t('{n} nuevo(s)', { n: d.add.length }));
      if (d.upd.length) bits.push(t('{n} movido(s) o renombrado(s)', { n: d.upd.length }));
      if (d.del.length) bits.push(t('{n} quitado(s)', { n: d.del.length }));
      L.push(t('Menú «{m}»: {b}', { m: menu.name, b: bits.join(', ') }));
    }
    for (const l of p.locs) { const m = S.menus.find((x) => x.id === l.id); L.push(t('Ubicaciones de «{m}»: {l}', { m: m?.name || l.id, l: l.locations.map(locName).join(', ') || t('ninguna') })); }
    for (const n of p.navs) L.push(t('Menú de bloques «{m}»: se actualiza', { m: n.nav.title }));
    if (p.widgets) {
      const w = p.widgets, bits = [];
      if (w.add.length) bits.push(t('{n} nuevo(s)', { n: w.add.length }));
      if (w.upd.length) bits.push(t('{n} editado(s)', { n: w.upd.length }));
      if (w.del.length) bits.push(t('{n} quitado(s)', { n: w.del.length }));
      if (w.order.length) bits.push(t('orden o zona cambiados en {n} zona(s)', { n: w.order.length }));
      L.push(t('Widgets: {b}', { b: bits.join(', ') }));
    }
    return L;
  }
  const locName = (slug) => S.data?.locations?.find((l) => l.slug === slug)?.name || slug;

  // Diálogo de confirmación con la lista de cambios
  function confirmList(title, lines, okLabel, danger) {
    return new Promise((resolve) => {
      const prev = document.activeElement, d = document.createElement('div');
      d.className = 'dlg-scrim';
      d.innerHTML = `<div class="dlg mn-dlg" role="alertdialog" aria-modal="true"><span class="ms fill dlg-ic${danger ? ' danger' : ''}">${danger ? 'warning' : 'help'}</span><b class="dlg-title">${esc(title)}</b>
        <ul class="mn-sum">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <p class="hint">${t('Antes de guardar se hace una copia del estado actual: podrás volver atrás con «Deshacer cambios».')}</p>
        <div class="dlg-actions"><button class="btn text" data-r="0">${t('Cancelar')}</button><button class="btn filled${danger ? ' danger-fill' : ''}" data-r="1">${esc(okLabel)}</button></div></div>`;
      const close = (v) => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); } };
      $$('[data-r]', d).forEach((b) => (b.onclick = () => close(b.dataset.r === '1')));
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(false); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(d); $('[data-r="1"]', d).focus();
    });
  }

  // Aplica un plan; devuelve los errores
  async function apply(p) {
    const errors = [];
    for (const { menu, d } of p.menus) { const r = await window.api.menusSave(menu.id, d); errors.push(...(r.errors || [])); }
    if (p.locs.length) { const r = await window.api.menusLocations(p.locs); errors.push(...(r.errors || [])); }
    for (const n of p.navs) { try { await window.api.menusNavSave({ id: n.nav.id, content: n.content }); } catch (e) { errors.push(msg(e)); } }
    if (p.widgets) { const r = await window.api.widgetsSave(p.widgets); errors.push(...(r.errors || [])); }
    return errors;
  }
  async function save() {
    const p = plan(); if (!p.count) return;
    if (!await confirmList(t('¿Guardar estos cambios en tu web?'), summary(p), t('Guardar en la web'))) return;
    setUndo({ at: Date.now(), site: CFG.wpUrl || '', menus: S.orig, created: S.created, navs: S.navs.map((n) => ({ id: n.id, content: n.content })), zones: S.origZones });
    S.busy = true; render();
    let errors = [];
    try { errors = await apply(p); } catch (e) { errors = [msg(e)]; }
    S.created = []; S.busy = false;
    await load();
    if (errors.length) toast(t('Algunos cambios no se pudieron guardar: {e}', { e: errors.slice(0, 2).join(' · ') }), true);
    else toast(t('Menús y widgets guardados en tu web.'));
  }
  async function undo() {
    const u = getUndo(); if (!u) return;
    S.busy = true; render();
    try {
      const [m, w] = await Promise.all([window.api.menusLoad(), window.api.widgetsLoad()]);
      const p = { menus: [], locs: [], navs: [], widgets: null, count: 0 };
      for (const o of u.menus) {
        const cur = (m.menus || []).find((x) => x.id === o.id); if (!cur) continue;
        const d = MT.diff(cur.items, MT.revert(o.items, cur.items));
        if (d.count) p.menus.push({ menu: { id: o.id, name: o.name }, d });
      }
      p.locs = MT.locationsDiff((m.menus || []).map((x) => ({ id: x.id, locations: x.locations })), u.menus.map((o) => ({ id: o.id, locations: o.locations })));
      for (const n of u.navs) { const cur = (m.navigation || []).find((x) => x.id === n.id); if (cur && MT.serializeNav(MT.parseNav(cur.content)) !== MT.serializeNav(MT.parseNav(n.content))) p.navs.push({ nav: { id: n.id, title: cur.title }, content: n.content }); }
      const wd = WL.diff(WL.normalize(w.sidebars || [], w.widgets || []), WL.revert(u.zones, WL.normalize(w.sidebars || [], w.widgets || [])));
      p.widgets = wd.count ? wd : null;
      const lines = summary(p);
      for (const id of u.created || []) if ((m.menus || []).some((x) => x.id === id)) lines.push(t('Se borra el menú creado después ({n})', { n: (m.menus.find((x) => x.id === id) || {}).name }));
      S.busy = false;
      if (!lines.length) { toast(t('No hay nada que deshacer: la web ya está como estaba.')); setUndo(null); return render(); }
      if (!await confirmList(t('¿Deshacer los últimos cambios de menús y widgets?'), lines, t('Deshacer cambios'), true)) return render();
      S.busy = true; render();
      const errors = await apply(p);
      for (const id of u.created || []) { try { await window.api.menusDelete(id); } catch (e) { errors.push(msg(e)); } }
      setUndo(null);
      await load();
      toast(errors.length ? t('Algunos cambios no se pudieron deshacer: {e}', { e: errors.slice(0, 2).join(' · ') }) : t('Cambios deshechos.'), !!errors.length);
    } catch (e) { S.busy = false; render(); toast(msg(e), true); }
  }
  function discard() { return ask(t('¿Descartar los cambios sin guardar?'), { ok: t('Descartar') }).then((ok) => { if (ok) { S.created = S.created; load(); } }); }

  // ------------------------------------------------------------ árbol de un menú
  const icon = (n) => (n.opaque ? 'extension' : n.object === 'category' || n.object === 'taxonomy' ? 'category' : n.type === 'custom' || n.object === 'custom' ? 'link' : n.object === 'post' ? 'article' : 'description');
  function treeHtml(nodes, depth = 1) {
    if (!nodes.length) return '';
    return `<ul class="mn-ul">${nodes.map((n, i) => `<li data-id="${esc(n.id)}"><div class="mn-row${n.opaque ? ' opaque' : ''}" draggable="${n.opaque ? 'false' : 'true'}" data-id="${esc(n.id)}">
      <span class="ms mn-grip" aria-hidden="true">drag_indicator</span><span class="ms mn-ic">${icon(n)}</span>
      <span class="mn-title">${n.opaque ? esc(t('Bloque especial (se conserva)')) : esc(n.title || t('(sin título)'))}${!n.opaque && (n.type === 'custom' || n.object === 'custom') && n.url ? `<small>${esc(n.url)}</small>` : ''}</span>
      <span class="mn-acts">
        <button class="btn text icon-only small" data-a="up" data-id="${esc(n.id)}" title="${esc(t('Subir'))}" aria-label="${esc(t('Subir'))}" ${i === 0 ? 'disabled' : ''}><span class="ms">arrow_upward</span></button>
        <button class="btn text icon-only small" data-a="down" data-id="${esc(n.id)}" title="${esc(t('Bajar'))}" aria-label="${esc(t('Bajar'))}" ${i === nodes.length - 1 ? 'disabled' : ''}><span class="ms">arrow_downward</span></button>
        <button class="btn text icon-only small" data-a="indent" data-id="${esc(n.id)}" title="${esc(t('Meter en el anterior (un nivel más)'))}" aria-label="${esc(t('Anidar'))}" ${i === 0 || depth >= MT.MAX_DEPTH ? 'disabled' : ''}><span class="ms">format_indent_increase</span></button>
        <button class="btn text icon-only small" data-a="outdent" data-id="${esc(n.id)}" title="${esc(t('Sacar un nivel'))}" aria-label="${esc(t('Sacar un nivel'))}" ${depth === 1 ? 'disabled' : ''}><span class="ms">format_indent_decrease</span></button>
        ${n.opaque ? '' : `<button class="btn text icon-only small" data-a="rename" data-id="${esc(n.id)}" title="${esc(t('Renombrar'))}" aria-label="${esc(t('Renombrar'))}"><span class="ms">edit</span></button>`}
        <button class="btn text icon-only small" data-a="del" data-id="${esc(n.id)}" title="${esc(t('Quitar del menú'))}" aria-label="${esc(t('Quitar del menú'))}"><span class="ms">close</span></button>
      </span></div>${treeHtml(n.children || [], depth + 1)}</li>`).join('')}</ul>`;
  }

  // ------------------------------------------------------------ pantalla
  function menusPane() {
    const d = S.data;
    if (S.note === 'none' || (!S.menus.length && !S.navs.length && d && !d.blockTheme && S.note)) return `<div class="st-note">${t('No se pueden leer los menús de tu web. Hace falta WordPress 5.9 o posterior y una cuenta de administrador.')}</div>`;
    const opts = [...S.menus.map((m) => `<option value="${m.id}" ${String(S.sel) === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`), ...S.navs.map((n) => `<option value="nav:${n.id}" ${String(S.sel) === 'nav:' + n.id ? 'selected' : ''}>${esc(n.title)} · ${t('menú de bloques')}</option>`)].join('');
    const m = curMenu(), tree = curTree() || [];
    const locs = !isNav() && m && d.locations.length ? `<div class="mn-locs"><span class="hint">${t('Mostrar este menú en:')}</span>${d.locations.map((l) => `<label class="chip"><input type="checkbox" data-loc="${esc(l.slug)}" ${m.locations.includes(l.slug) ? 'checked' : ''}><span>${esc(l.name)}</span></label>`).join('')}</div>` : '';
    const note = d.blockTheme ? `<div class="hint mn-theme">${t('Tu tema usa menús de bloques (wp_navigation): aquí se editan como lista de enlaces y submenús.')}</div>` : '';
    return `<div class="mn-bar"><label class="mn-sel"><span class="hint">${t('Menú')}</span><select id="mn-sel" ${opts ? '' : 'disabled'}>${opts || `<option>${t('No hay menús')}</option>`}</select></label>
        ${isNav() ? '' : `<button class="btn tonal small" data-a="newmenu"><span class="ms">add</span>${t('Nuevo menú')}</button>`}</div>
      ${note}${locs}
      <div class="mn-cols">
        <div class="mn-tree-wrap"><div class="mn-tree" id="mn-tree" data-tree>${tree.length ? treeHtml(tree) : `<div class="st-note">${S.sel ? t('Este menú está vacío: añade páginas, entradas, categorías o enlaces.') : t('Crea un menú para empezar.')}</div>`}</div>
          <div class="hint">${t('Arrastra para reordenar: suelta en el centro de otra fila para anidar (hasta 3 niveles). También puedes usar las flechas.')}</div></div>
        <div class="mn-add">${S.sel ? addPane() : ''}</div></div>`;
  }
  function addPane() {
    const tabs = [['pages', 'description', t('Páginas')], ['posts', 'article', t('Entradas')], ['cats', 'category', t('Categorías')], ['link', 'link', t('Enlace')]];
    const d = S.data, q = S.q.toLowerCase();
    let body = '';
    const row = (kind, id, title, url, extra = '') => `<div class="mn-pick"><span class="mn-pick-t">${esc(title)}${extra}</span><button class="btn tonal small" data-a="pick" data-k="${kind}" data-i="${esc(id)}" data-t="${esc(title)}" data-u="${esc(url || '')}"><span class="ms">add</span>${t('Añadir')}</button></div>`;
    const used = new Set(MT.flatten(curTree() || []).map((x) => x.objectId + ':' + x.object));
    if (S.add === 'pages') body = `<input id="mn-q" type="search" placeholder="${esc(t('Buscar página…'))}" value="${esc(S.q)}" autocomplete="off">` + (d.pages.filter((p) => !q || p.title.toLowerCase().includes(q)).slice(0, 40).map((p) => row('page', p.id, p.title, p.url, used.has(p.id + ':page') || used.has(p.id + ':post-type') ? `<small>${t('ya está')}</small>` : '')).join('') || `<div class="hint">${t('No hay páginas.')}</div>`);
    if (S.add === 'posts') body = `<input id="mn-q" type="search" placeholder="${esc(t('Buscar entrada por título…'))}" value="${esc(S.q)}" autocomplete="off">` + (S.found.map((p) => row(p.subtype === 'page' ? 'page' : 'post', p.id, p.title, p.url)).join('') || `<div class="hint">${S.q ? t('Sin resultados.') : t('Escribe para buscar entradas.')}</div>`);
    if (S.add === 'cats') body = (d.categories.map((c) => row('category', c.id, c.name, c.url)).join('') || `<div class="hint">${t('No hay categorías.')}</div>`);
    if (S.add === 'link') body = `<div class="field"><label for="mn-lt">${t('Texto del enlace')}</label><input id="mn-lt" autocomplete="off"></div><div class="field"><label for="mn-lu">${t('Dirección (URL)')}</label><input id="mn-lu" placeholder="https://" autocomplete="off" spellcheck="false"></div><button class="btn filled small" data-a="addlink"><span class="ms">add_link</span>${t('Añadir enlace')}</button>`;
    return `<div class="seo-tabs mn-tabs" role="tablist">${tabs.map(([k, ic, l]) => `<button role="tab" class="${S.add === k ? 'on' : ''}" data-a="addtab" data-k="${k}">${l}</button>`).join('')}</div><div class="mn-picks">${body}</div>`;
  }

  function widgetsPane() {
    if (S.note === 'none' && !S.zones.length) return `<div class="st-note">${t('No se pueden leer los widgets de tu web. Hace falta WordPress 5.8 o posterior y una cuenta de administrador.')}</div>`;
    if (!S.zones.length) return `<div class="st-note">${t('Tu tema no tiene zonas de widgets.')}</div>`;
    const zoneOpts = (cur) => S.zones.map((z) => `<option value="${esc(z.id)}" ${z.id === cur ? 'selected' : ''}>${esc(z.name)}</option>`).join('');
    return `<div class="mn-zones">${S.zones.map((z) => `<section class="mn-zone${z.inactive ? ' inactive' : ''}" data-zone="${esc(z.id)}"><div class="mn-zone-h"><b>${esc(z.name)}</b>${z.description ? `<small>${esc(z.description)}</small>` : ''}
        ${z.inactive ? '' : `<button class="btn tonal small" data-a="addwidget" data-z="${esc(z.id)}"><span class="ms">add</span>${t('Widget de bloque')}</button>`}</div>
        <div class="mn-wlist" data-zone="${esc(z.id)}">${z.widgets.map((w, i) => widgetRow(w, z, i, zoneOpts)).join('') || `<div class="mn-empty">${t('Sin widgets')}</div>`}</div></section>`).join('')}</div>`;
  }
  const KIND = () => ({ block: [t('Bloque'), 'widgets'], text: [t('Texto'), 'notes'], html: [t('HTML'), 'code'], image: [t('Imagen'), 'image'], other: [t('Solo lectura'), 'lock'] });
  function widgetRow(w, z, i, zoneOpts) {
    const [kn, ic] = KIND()[w.kind] || KIND().other, editing = S.open === w.id;
    const form = editing && WL.FORM[w.kind] ? `<div class="mn-wform">${WL.FORM[w.kind].map(([f, ty]) => `<div class="field"><label>${esc({ title: t('Título'), text: t('Texto'), content: t('Contenido HTML'), url: t('Dirección de la imagen'), alt: t('Texto alternativo'), caption: t('Pie'), link_url: t('Enlace') }[f] || f)}</label>${ty === 'area' ? `<textarea rows="4" data-wf="${f}" data-w="${esc(w.id)}">${esc(w.raw[f])}</textarea>` : `<input data-wf="${f}" data-w="${esc(w.id)}" value="${esc(w.raw[f])}" autocomplete="off">`}</div>`).join('')}</div>` : '';
    return `<div class="mn-w" data-w="${esc(w.id)}"><div class="mn-row" draggable="true" data-w="${esc(w.id)}">
      <span class="ms mn-grip" aria-hidden="true">drag_indicator</span><span class="ms mn-ic">${ic}</span>
      <span class="mn-title">${esc(WL.label(w))}<small>${esc(kn)}${w.isNew ? ' · ' + t('nuevo') : ''}</small></span>
      <span class="mn-acts">
        <button class="btn text icon-only small" data-a="wup" data-w="${esc(w.id)}" aria-label="${esc(t('Subir'))}" title="${esc(t('Subir'))}" ${i === 0 ? 'disabled' : ''}><span class="ms">arrow_upward</span></button>
        <button class="btn text icon-only small" data-a="wdown" data-w="${esc(w.id)}" aria-label="${esc(t('Bajar'))}" title="${esc(t('Bajar'))}" ${i === z.widgets.length - 1 ? 'disabled' : ''}><span class="ms">arrow_downward</span></button>
        <select class="mn-moveto" data-w="${esc(w.id)}" aria-label="${esc(t('Mover a otra zona'))}" title="${esc(t('Mover a otra zona'))}">${zoneOpts(z.id)}</select>
        ${w.kind === 'block' || WL.FORM[w.kind] ? `<button class="btn text icon-only small" data-a="wedit" data-w="${esc(w.id)}" aria-label="${esc(t('Editar'))}" title="${esc(t('Editar'))}"><span class="ms">${w.kind === 'block' ? 'edit_square' : editing ? 'expand_less' : 'edit'}</span></button>` : ''}
        <button class="btn text icon-only small" data-a="wdel" data-w="${esc(w.id)}" aria-label="${esc(t('Quitar'))}" title="${esc(t('Quitar'))}"><span class="ms">delete</span></button></span></div>${form}</div>`;
  }

  function render() {
    const b = box(); if (!b) return;
    if (!S.loaded && !S.busy && !S.note) { b.innerHTML = ''; return; }
    const un = getUndo(), p = S.loaded ? plan() : { count: 0 };
    b.innerHTML = `<div class="mn-head"><div class="seg" id="mn-tabs"><button data-a="tab" data-k="menus" class="${S.tab === 'menus' ? 'active' : ''}"><span class="ms">menu</span>${t('Menús')}</button><button data-a="tab" data-k="widgets" class="${S.tab === 'widgets' ? 'active' : ''}"><span class="ms">widgets</span>${t('Widgets')}</button></div>
        <span class="spacer"></span>
        <button class="btn text small" data-a="undo" ${un && !S.busy ? '' : 'disabled'} title="${esc(un ? t('Copia del {d}', { d: new Date(un.at).toLocaleString() }) : t('Aún no hay ninguna copia'))}"><span class="ms">undo</span>${t('Deshacer cambios')}</button>
        <button class="btn text small" data-a="discard" ${p.count && !S.busy ? '' : 'disabled'}>${t('Descartar')}</button>
        <button class="btn filled small" data-a="save" ${p.count && !S.busy ? '' : 'disabled'}><span class="ms">save</span>${t('Guardar cambios')}${p.count ? ` (${p.count})` : ''}</button></div>
      ${S.busy ? `<div class="st-note">${t('Un momento…')}</div>` : ''}
      ${S.loaded ? (S.tab === 'menus' ? menusPane() : widgetsPane()) : S.note && !S.busy ? `<div class="st-note">${esc(S.note)}</div>` : ''}`;
    wire();
  }

  // ------------------------------------------------------------ eventos
  const toastWhy = (why) => toast(why === 'depth' ? t('Los menús admiten hasta 3 niveles.') : why === 'cycle' ? t('No se puede meter un elemento dentro de sí mismo.') : t('No se puede mover ahí.'), true);
  const tryMove = (r) => { if (!r.ok) { if (!['edge', 'first', 'top'].includes(r.why)) toastWhy(r.why); return false; } setTree(r.tree); return true; };
  const idOf = (v) => { const tr = curTree() || []; const f = MT.flatten(tr).find((x) => String(x.id) === String(v)); return f ? f.id : v; };

  async function onClick(e) {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const a = el.dataset.a;
    if (a === 'tab') { S.tab = el.dataset.k; return render(); }
    if (a === 'save') return save();
    if (a === 'undo') return undo();
    if (a === 'discard') return discard();
    if (a === 'addtab') { S.add = el.dataset.k; S.q = ''; S.found = []; return render(); }
    if (a === 'newmenu') {
      const name = await askText(t('Nombre del nuevo menú'), '', t('Se crea en tu web al momento; no se muestra hasta que lo asignes a una ubicación.'));
      if (!name) return;
      try { const m = await window.api.menusCreate(name); S.created.push(m.id); S.orig.push({ id: m.id, name: m.name, locations: [], items: [] }); S.menus.push({ id: m.id, name: m.name, locations: [], tree: [] }); S.sel = m.id; toast(t('Menú «{n}» creado.', { n: m.name })); render(); } catch (ex) { toast(msg(ex), true); }
      return;
    }
    if (!S.sel && a !== 'addwidget') return;
    const id = el.dataset.id !== undefined ? idOf(el.dataset.id) : null, tr = curTree();
    if (a === 'up') { if (tryMove(MT.up(tr, id))) render(); return; }
    if (a === 'down') { if (tryMove(MT.down(tr, id))) render(); return; }
    if (a === 'indent') { if (tryMove(MT.indent(tr, id))) render(); return; }
    if (a === 'outdent') { if (tryMove(MT.outdent(tr, id))) render(); return; }
    if (a === 'del') { setTree(MT.remove(tr, id)); return render(); }
    if (a === 'rename') {
      const n = MT.find(tr, id)?.node; if (!n) return;
      const v = await askText(t('Nombre en el menú'), n.title);
      if (v) { setTree(MT.rename(tr, id, { title: v })); render(); }
      return;
    }
    if (a === 'pick') {
      const kind = el.dataset.k, it = MT.newItem('t' + ++S.seq, kind, { title: el.dataset.t, url: el.dataset.u, objectId: el.dataset.i });
      const r = MT.add(tr, isNav() ? MT.toNavNode(it) : it);
      setTree(r.tree); toast(t('«{n}» añadido al menú. Guarda para publicarlo.', { n: el.dataset.t })); return render();
    }
    if (a === 'addlink') {
      const title = $('#mn-lt').value.trim(), url = $('#mn-lu').value.trim();
      if (!/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(url)) return toast(t('Escribe una dirección que empiece por https://'), true);
      const it = MT.newItem('t' + ++S.seq, 'custom', { title: title || url, url });
      setTree(MT.add(tr, isNav() ? MT.toNavNode(it) : it).tree); return render();
    }
  }
  async function widgetClick(e) {
    const el = e.target.closest('[data-a]'); if (!el) return false;
    const a = el.dataset.a, wid = el.dataset.w;
    const at = () => WL.locate(S.zones, wid);
    if (a === 'addwidget') { window.WidgetEdit.open({ content: '', title: t('Widget de bloque nuevo'), onSave: (content) => { S.zones = WL.addBlock(S.zones, el.dataset.z, content, 'new-' + ++S.seq).zones; S.tab = 'widgets'; render(); } }); return true; }
    if (!wid) return false;
    if (a === 'wup' || a === 'wdown') { const l = at(); if (l) { S.zones = WL.move(S.zones, wid, l.zone.id, l.index + (a === 'wup' ? -1 : 1)).zones; render(); } return true; }
    if (a === 'wdel') { S.zones = WL.remove(S.zones, wid); render(); return true; }
    if (a === 'wedit') {
      const l = at(); if (!l) return true;
      if (l.widget.kind === 'block') window.WidgetEdit.open({ content: l.widget.raw.content || '', title: WL.label(l.widget), onSave: (content) => { S.zones = WL.setRaw(S.zones, wid, { content }); S.tab = 'widgets'; render(); } });
      else { S.open = S.open === wid ? null : wid; render(); }
      return true;
    }
    return false;
  }
  function wire() {
    const b = box();
    if (!b.dataset.wired) {
      b.dataset.wired = '1';
      b.addEventListener('click', async (e) => { if (S.tab === 'widgets' || e.target.closest('[data-w]')) { if (await widgetClick(e)) return; } onClick(e); });
      b.addEventListener('change', (e) => {
        const el = e.target;
        if (el.id === 'mn-sel') { S.sel = el.value.startsWith('nav:') ? el.value : Number(el.value); S.q = ''; return render(); }
        if (el.dataset.loc) { S.menus = MT.assign(S.menus.map((m) => ({ ...m })), curMenu().id, el.dataset.loc, el.checked); return render(); }
        if (el.classList.contains('mn-moveto')) { S.zones = WL.move(S.zones, el.dataset.w, el.value).zones; return render(); }
        if (el.dataset.wf) S.zones = WL.setRaw(S.zones, el.dataset.w, { [el.dataset.wf]: el.value });
      });
      b.addEventListener('input', (e) => {
        const el = e.target;
        if (el.dataset.wf) { S.zones = WL.setRaw(S.zones, el.dataset.w, { [el.dataset.wf]: el.value }); const s = $('[data-a="save"]', b); if (s) { s.disabled = false; } return; }
        if (el.id === 'mn-q') { S.q = el.value; clearTimeout(S.tm); const pos = el.selectionStart; S.tm = setTimeout(async () => { if (S.add === 'posts' && S.q.trim().length > 1) { try { S.found = await window.api.menusSearch(S.q.trim()); } catch { S.found = []; } } else if (S.add === 'posts') S.found = []; render(); const n = $('#mn-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, S.add === 'posts' ? 300 : 0); }
      });
      dnd(b);
    }
  }

  // Arrastrar y soltar (menús y widgets): arriba = antes, abajo = después, en medio = dentro (solo menús)
  function dnd(b) {
    const zoneOf = (e, rowSel) => { const r = e.target.closest(rowSel); if (!r) return null; const bb = r.getBoundingClientRect(), f = (e.clientY - bb.top) / bb.height; return { r, pos: f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'in' }; };
    const clear = () => $$('.mn-drop-before,.mn-drop-after,.mn-drop-in,.mn-drop-end', b).forEach((x) => x.classList.remove('mn-drop-before', 'mn-drop-after', 'mn-drop-in', 'mn-drop-end'));
    b.addEventListener('dragstart', (e) => {
      const r = e.target.closest?.('.mn-row'); if (!r || r.getAttribute('draggable') !== 'true') return;
      S.drag = r.dataset.w ? { w: r.dataset.w } : { id: r.dataset.id };
      e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', r.dataset.w || r.dataset.id); } catch { /* nada */ }
      r.classList.add('mn-dragging');
    });
    b.addEventListener('dragend', () => { S.drag = null; clear(); $$('.mn-dragging', b).forEach((x) => x.classList.remove('mn-dragging')); });
    b.addEventListener('dragover', (e) => {
      if (!S.drag) return;
      const z = zoneOf(e, '.mn-row');
      if (S.drag.w) {
        const list = e.target.closest('.mn-wlist');
        if (!list) return; e.preventDefault(); clear();
        if (z && z.r.dataset.w !== S.drag.w) z.r.classList.add(z.pos === 'after' ? 'mn-drop-after' : 'mn-drop-before'); else if (!z) list.classList.add('mn-drop-end');
        return;
      }
      if (!z) { if (e.target.closest('#mn-tree')) { e.preventDefault(); clear(); } return; }
      if (z.r.dataset.id === String(S.drag.id)) return;
      e.preventDefault(); clear(); z.r.classList.add('mn-drop-' + z.pos);
    });
    b.addEventListener('drop', (e) => {
      if (!S.drag) return; e.preventDefault();
      const d = S.drag; S.drag = null; clear();
      if (d.w) {
        const list = e.target.closest('.mn-wlist'); if (!list) return;
        const z = zoneOf(e, '.mn-row');
        const to = list.dataset.zone; let idx = null;
        if (z && z.r.dataset.w !== d.w) { const l = WL.locate(S.zones, z.r.dataset.w), src = WL.locate(S.zones, d.w); idx = l.index + (z.pos === 'after' ? 1 : 0); if (src && src.zone.id === l.zone.id && src.index < idx) idx--; }
        S.zones = WL.move(S.zones, d.w, to, idx).zones; return render();
      }
      const tr = curTree(), z = zoneOf(e, '.mn-row');
      const src = MT.find(tr, idOf(d.id)); if (!src) return;
      if (!z) return tryMove(MT.move(tr, src.node.id, null, null)) && render();
      const tgt = MT.find(tr, idOf(z.r.dataset.id)); if (!tgt || tgt.node.id === src.node.id) return;
      let r;
      if (z.pos === 'in') r = MT.move(tr, src.node.id, tgt.node.id, null);
      else {
        let idx = tgt.index + (z.pos === 'after' ? 1 : 0);
        const sameList = (src.parent ? src.parent.id : 0) === (tgt.parent ? tgt.parent.id : 0);
        if (sameList && src.index < idx) idx--;
        r = MT.move(tr, src.node.id, tgt.parent ? tgt.parent.id : null, idx);
      }
      if (tryMove(r)) render();
    });
  }

  return { open, load, dirty, plan, state: S };
})();
window.MenusUI = MenusUI;
