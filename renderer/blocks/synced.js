// Editor de bloques · «Patrones de tu web» (selector con buscador, categorías y miniaturas), bloques sincronizados
// (referencia a un wp_block de WordPress) y «Guardar como bloque sincronizado». La lógica pura está en renderer/patterns.js.
(function () {
  const E = window.BlockEditor, K = window.BlockKit, P = window.Patterns;
  const { $, $$, t, esc, bid } = K;
  const api = () => window.api;

  // --- Vista previa pequeña con la misma maquetación que el editor ---------------------------------------------------
  // Pinta los bloques como los pinta el editor (sin barras ni interacción) en un lienzo de 900 px y los reduce al ancho de la ficha.
  const PV_W = 900;
  function renderInto(inner, blocks) {
    const arr = JSON.parse(JSON.stringify(blocks || []));
    let ok = 0;
    arr.forEach((b, i) => {
      try {
        const el = E.block(b, i, arr);
        $$('[data-id]', el).forEach((x) => x.removeAttribute('data-id')); el.removeAttribute('data-id');
        $$('[contenteditable]', el).forEach((x) => x.setAttribute('contenteditable', 'false'));
        inner.appendChild(el); ok++;
      } catch { /* un bloque que no se puede dibujar: se omite */ }
    });
    return ok;
  }
  // Ficha de miniatura: devuelve el elemento .pv (alto fijo); `blocks` puede ser una promesa
  function thumb(blocks, { height = 150 } = {}) {
    const pv = document.createElement('span');
    pv.className = 'pv'; pv.style.height = height + 'px'; pv.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.className = 'pv-in ed-page blocks'; inner.style.width = PV_W + 'px'; inner.setAttribute('inert', '');
    pv.appendChild(inner);
    const fit = () => { const w = pv.clientWidth || 200; inner.style.transform = `scale(${w / PV_W})`; };
    const draw = (list) => {
      const n = renderInto(inner, list);
      if (!n && (list || []).length && window.ContentTemplates) {
        inner.style.transform = ''; inner.style.width = '';
        pv.insertAdjacentHTML('beforeend', `<span class="tp-sk">${window.ContentTemplates.sketch(list).map((k) => `<i class="k-${k}"></i>`).join('')}</span>`);
        inner.remove(); return;
      }
      fit(); if (window.ResizeObserver) new ResizeObserver(fit).observe(pv);
    };
    Promise.resolve(blocks).then(draw, () => { pv.classList.add('pv-fail'); });
    return pv;
  }

  // --- Datos: caché de bloques sincronizados ---------------------------------------------------------------------------
  const cache = new Map(); // ref → promesa de { id, title, sync, blocks }
  function getSynced(ref, force = false) {
    if (force || !cache.has(ref)) cache.set(ref, Promise.resolve(api().syncedGet(ref)).catch((e) => { cache.delete(ref); throw e; }));
    return cache.get(ref);
  }
  const fresh = (list) => (list || []).map((b) => E.cloneBlock(b));

  // --- Selector «Patrones de tu web» ------------------------------------------------------------------------------------
  // Devuelve una promesa: null si se cancela o la lista de bloques para insertar
  function open() {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const d = document.createElement('div');
      d.className = 'dlg-scrim';
      d.innerHTML = `<div class="dlg pat-dlg" role="dialog" aria-modal="true" aria-label="${esc(t('Patrones de tu web'))}">
        <div class="pat-head"><h2>${t('Patrones de tu web')}</h2><button class="btn text icon-only" data-r="x" title="${esc(t('Cerrar'))}" aria-label="${esc(t('Cerrar'))}"><span class="ms">close</span></button></div>
        <div class="seg pat-tabs" role="tablist"><button class="active" role="tab" data-tab="patterns" aria-selected="true"><span class="ms">grid_view</span>${t('Patrones')}</button><button role="tab" data-tab="mine" aria-selected="false"><span class="ms">sync</span>${t('Mis bloques')}</button></div>
        <div class="pat-tools"><label class="pat-search"><span class="ms">search</span><input type="search" id="pat-q" placeholder="${esc(t('Buscar patrones…'))}" aria-label="${esc(t('Buscar patrones…'))}" autocomplete="off"></label><div class="pat-cats" id="pat-cats" role="group" aria-label="${esc(t('Categorías'))}"></div></div>
        <div class="pat-grid" id="pat-grid"></div>
        <p class="hint pat-note" id="pat-note"></p>
        <div class="dlg-actions"><button class="btn text" data-r="x">${t('Cancelar')}</button><button class="btn tonal hidden" data-r="copy"><span class="ms">content_copy</span>${t('Insertar como copia')}</button><button class="btn filled" data-r="ok" disabled>${t('Insertar')}</button></div></div>`;
      let tab = 'patterns', cat = '', q = '', sel = null;
      const data = { patterns: null, mine: null };
      const grid = $('#pat-grid', d), note = $('#pat-note', d);
      const items = () => {
        if (tab === 'patterns') return P.filterPatterns(data.patterns?.patterns || [], { q, cat });
        return (data.mine || []).filter((s) => P.plain(s.title).toLowerCase().includes(P.plain(q).toLowerCase()));
      };
      const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); e.target._draw?.(); } }), { root: grid }) : null;
      const parsed = new Map();
      const blocksOf = (it) => (it.blocks ? Promise.resolve(it.blocks) : parsed.get(it.name) || (parsed.set(it.name, Promise.resolve(api().parseBlocks(it.content))), parsed.get(it.name)));
      const key = (it) => (tab === 'patterns' ? it.name : 'w' + it.id);
      function paint() {
        const list = items();
        $$('#pat-cats [data-c]', d).forEach((c) => c.classList.toggle('on', c.dataset.c === cat));
        grid.innerHTML = '';
        list.forEach((it) => {
          const card = document.createElement('button');
          card.type = 'button'; card.className = 'pat-card' + (sel && key(sel) === key(it) ? ' on' : ''); card.dataset.k = key(it);
          const badge = tab === 'mine' ? `<span class="pat-badge ${it.sync ? 'off' : ''}"><span class="ms">${it.sync ? 'link_off' : 'sync'}</span>${it.sync ? t('Sin sincronizar') : t('Sincronizado')}</span>` : '';
          card.innerHTML = `<span class="pat-pv"></span>${badge}<b>${esc(it.title)}</b>${it.description ? `<small>${esc(it.description)}</small>` : ''}`;
          const slot = $('.pat-pv', card);
          const draw = () => slot.appendChild(thumb(blocksOf(it)));
          if (io) { card._draw = draw; io.observe(card); } else draw();
          card.onclick = () => { sel = it; $$('.pat-card', grid).forEach((c) => c.classList.toggle('on', c === card)); sync(); };
          card.ondblclick = () => go(false);
          grid.appendChild(card);
        });
        note.textContent = list.length ? '' : (data[tab === 'patterns' ? 'patterns' : 'mine'] === null ? t('Cargando…') : tab === 'patterns' ? t('Tu web no tiene patrones que coincidan.') : t('No hay bloques guardados que coincidan.'));
      }
      function cats() {
        const box = $('#pat-cats', d);
        if (tab !== 'patterns' || !data.patterns) { box.innerHTML = ''; return; }
        const list = P.usedCategories(data.patterns.patterns, data.patterns.categories);
        box.innerHTML = [{ name: '', label: t('Todos'), count: data.patterns.patterns.length }, ...list].map((c) => `<button type="button" class="pat-cat" data-c="${esc(c.name)}">${esc(c.label)} <small>${c.count}</small></button>`).join('');
        $$('[data-c]', box).forEach((b) => (b.onclick = () => { cat = b.dataset.c; paint(); }));
      }
      function sync() {
        $('[data-r="ok"]', d).disabled = !sel;
        const synced = tab === 'mine' && sel && !sel.sync;
        $('[data-r="copy"]', d).classList.toggle('hidden', !synced);
        $('[data-r="ok"]', d).textContent = synced ? t('Insertar vinculado') : t('Insertar');
      }
      async function load(which) {
        try {
          if (which === 'patterns' && !data.patterns) data.patterns = await api().blockPatterns();
          if (which === 'mine' && !data.mine) data.mine = await api().syncedList();
        } catch (e) { data[which === 'patterns' ? 'patterns' : 'mine'] = which === 'patterns' ? { patterns: [], categories: [] } : []; note.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); cats(); grid.innerHTML = ''; return; }
        if (tab === which) { cats(); paint(); }
      }
      async function go(asCopy) {
        if (!sel) return;
        const btn = $('[data-r="ok"]', d); btn.disabled = true;
        try {
          let list;
          if (tab === 'mine' && !sel.sync && !asCopy) { cache.set(sel.id, Promise.resolve(sel)); list = [{ id: bid(), ...P.syncedRef(sel.id, sel.title) }]; }
          else list = fresh(await blocksOf(sel));
          close(list);
        } catch (e) { btn.disabled = false; note.textContent = String(e.message || e); }
      }
      const key2 = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      };
      function close(v) {
        io?.disconnect();
        d.classList.add('out'); setTimeout(() => d.remove(), 160);
        document.removeEventListener('keydown', key2, true);
        if (prev && prev.focus) prev.focus();
        resolve(v && v.length ? v : null);
      }
      $$('.pat-tabs [data-tab]', d).forEach((b) => (b.onclick = () => {
        tab = b.dataset.tab; sel = null; cat = '';
        $$('.pat-tabs [data-tab]', d).forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', String(x === b)); });
        $('#pat-q', d).placeholder = tab === 'patterns' ? t('Buscar patrones…') : t('Buscar entre tus bloques…');
        cats(); paint(); sync(); load(tab);
      }));
      $('#pat-q', d).oninput = (e) => { q = e.target.value; paint(); };
      $$('[data-r="x"]', d).forEach((b) => (b.onclick = () => close(null)));
      $('[data-r="ok"]', d).onclick = () => go(false);
      $('[data-r="copy"]', d).onclick = () => go(true);
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
      document.addEventListener('keydown', key2, true);
      document.body.appendChild(d);
      paint(); load('patterns');
      $('#pat-q', d).focus();
    });
  }

  // --- Menú de insertar: «Patrones de tu web» abre el selector y devuelve los bloques ------------------------------------
  const openMenu = E.openMenu;
  E.openMenu = function (anchor, pick) {
    openMenu.call(this, anchor, pick);
    const b = $('#ins-menu [data-type="webpatterns"]');
    if (b) b.onclick = () => { $('#ins-menu').classList.add('hidden'); open().then((list) => { if (list) pick('sections', list); }); };
  };

  // --- El bloque «sincronizado» -------------------------------------------------------------------------------------------
  E.types.synced = function (b, i, body) {
    const box = document.createElement('div');
    box.className = 'syn-box';
    box.innerHTML = `<div class="syn-note" role="note"><span class="ms">sync</span><div class="syn-txt"><b class="syn-title"></b><span>${esc(t('Bloque sincronizado: si lo cambias, cambia en todas las páginas'))}</span></div>
      <div class="syn-acts"><button class="btn tonal small" data-a="edit"><span class="ms">edit</span>${t('Editar el original')}</button><button class="btn text small" data-a="unlink"><span class="ms">link_off</span>${t('Desvincular')}</button></div></div>
      <div class="syn-body"><p class="hint">${t('Cargando…')}</p></div>`;
    const title = () => { $('.syn-title', box).textContent = b.title || t('Bloque sincronizado') + ' #' + b.ref; };
    title();
    const content = $('.syn-body', box);
    getSynced(b.ref).then((r) => {
      if (r.title && r.title !== b.title) { b.title = r.title; title(); }
      content.innerHTML = ''; content.classList.add('pv-live');
      const inner = document.createElement('div'); inner.className = 'syn-in'; inner.setAttribute('inert', '');
      if (!renderInto(inner, r.blocks) && (r.blocks || []).length) content.innerHTML = `<p class="hint">${t('Este bloque no se puede mostrar aquí.')}</p>`; else if (!(r.blocks || []).length) content.innerHTML = `<p class="hint">${t('Este bloque está vacío.')}</p>`; else content.appendChild(inner);
    }, (e) => { content.innerHTML = `<p class="hint syn-err">${esc(t('No se ha podido cargar el bloque sincronizado #{n}.', { n: b.ref }))} ${esc(String(e.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))}</p>`; });
    $('[data-a="edit"]', box).onclick = () => window.SyncedEdit?.open(b);
    $('[data-a="unlink"]', box).onclick = () => E.unlinkSynced(b);
    body.appendChild(box);
  };

  Object.assign(E, {
    // Convierte la referencia en bloques normales (copias del contenido de ahora)
    async unlinkSynced(b) {
      let r;
      try { r = await getSynced(b.ref); } catch (e) { K.toast(t('No se ha podido cargar el bloque sincronizado #{n}.', { n: b.ref })); return; }
      let n = 0;
      this.change(() => { n = P.unlinkIn(this.draft.blocks, (x) => x.id === b.id, () => fresh(r.blocks)); });
      if (n) K.info(t('Bloque desvinculado: ahora son bloques normales de esta página.'));
    },
    // Guardar bloques (por id) como bloque sincronizado o patrón sin sincronizar de WordPress
    async saveAsSynced(ids) {
      const top = this.topIds(ids);
      if (!top.length) return;
      if (!this.canGroup(top)) { K.toast(t('Para guardar varios bloques, elígelos del mismo nivel.')); return; }
      const opt = await askSynced(top.length);
      if (!opt) return;
      const blocks = top.map((id) => JSON.parse(JSON.stringify(this.locate(id).b)));
      let r;
      try { r = await api().syncedSave({ title: opt.name, sync: opt.sync, blocks }); } catch (e) { K.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return; }
      if (opt.sync === 'unsynced') { K.info(t('Patrón «{n}» guardado en tu web (sin sincronizar).', { n: opt.name })); return; }
      cache.set(r.id, Promise.resolve({ id: r.id, title: r.title, sync: '', blocks: fresh(blocks) }));
      let ref = null;
      this.change(() => {
        const first = this.locate(top[0]);
        ref = { id: bid(), ...P.syncedRef(r.id, r.title) };
        first.arr.splice(first.i, 0, ref);
        this.deleteIds(top);
      });
      this.setSel?.([ref.id], ref.id);
      K.info(t('Guardado como bloque sincronizado «{n}».', { n: r.title }));
    },
    selSaveSynced() { return this.saveAsSynced(this.sel); },
  });

  // Diálogo: nombre y tipo
  function askSynced(n) {
    return new Promise((resolve) => {
      const d = document.createElement('div');
      d.className = 'dlg-scrim';
      d.innerHTML = `<form class="dlg" role="dialog" aria-modal="true" autocomplete="off"><h2>${t('Guardar como bloque sincronizado')}</h2>
        <p class="hint">${esc(n === 1 ? t('Se guardará 1 bloque en tu web.') : t('Se guardarán {n} bloques en tu web.', { n }))}</p>
        <div class="field"><label for="syn-name">${t('Nombre')}</label><input id="syn-name" maxlength="120" style="width:100%"></div>
        <div class="syn-kinds" role="radiogroup">
          <label class="syn-kind"><input type="radio" name="syn-k" value="" checked><span class="ms">sync</span><span><b>${t('Bloque sincronizado')}</b><small>${t('Si lo cambias, cambia en todas las páginas donde esté.')}</small></span></label>
          <label class="syn-kind"><input type="radio" name="syn-k" value="unsynced"><span class="ms">link_off</span><span><b>${t('Patrón sin sincronizar')}</b><small>${t('Se inserta como una copia que se edita por separado.')}</small></span></label>
        </div>
        <div class="dlg-actions"><button type="button" class="btn text" data-r="0">${t('Cancelar')}</button><button type="submit" class="btn filled">${t('Guardar')}</button></div></form>`;
      const name = $('#syn-name', d);
      const close = (v) => { d.remove(); resolve(v); };
      $('[data-r="0"]', d).onclick = () => close(null);
      $('form', d).onsubmit = (e) => { e.preventDefault(); const v = name.value.trim(); if (!v) { name.focus(); return; } close({ name: v, sync: $('input[name="syn-k"]:checked', d).value }); };
      d.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
      document.body.appendChild(d);
      name.focus();
    });
  }

  window.PatternsUI = { open, thumb, getSynced, invalidate: (ref) => cache.delete(ref), renderInto };
})();
