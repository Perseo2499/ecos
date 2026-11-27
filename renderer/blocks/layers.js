// Editor de bloques · panel de capas (árbol de bloques con ocultar, duplicar, borrar y arrastrar) y selección múltiple
// (Mayús+clic: rango · Ctrl/Cmd+clic: añadir o quitar · barra flotante · portapapeles interno de bloques).
// La lógica sin DOM (summary, layerTree, rangeIds, moveBlocks, groupIds, copyIds…) está en core.js.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, esc, TYPES } = K;

  Object.assign(E, { sel: [], anchor: null, hidden: new Set(), collapsed: new Set(), layersSig: '' });

  const CONTAINERS = ['group', 'cover'];
  const editorOpen = () => { const e = document.getElementById('editor'); return !!e && !e.classList.contains('hidden'); };
  const inText = (el) => !!el && (el.isContentEditable || !!el.closest?.('.rt, [contenteditable="true"]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  const blkEl = (id) => document.querySelector(`#d-blocks .blk[data-id="${CSS.escape(String(id))}"]`);
  const toast = (m) => K.toast(m);

  // Repintar el lienzo deja el DOM nuevo: se vuelven a marcar la selección y los bloques ocultos y se actualiza el panel
  for (const name of ['render', 'repaintBlock']) {
    const orig = E[name];
    E[name] = function (...a) { const r = orig.apply(this, a); this.afterPaint(); return r; };
  }
  const mount = E.mount;
  E.mount = function (...a) { this.sel = []; this.anchor = null; this.hidden = new Set(); this.collapsed = new Set(); this.layersSig = ''; return mount.apply(this, a); };

  Object.assign(E, {
    afterPaint() {
      const ids = new Set(this.flat().map((b) => b.id));
      this.sel = this.sel.filter((id) => ids.has(id));
      for (const h of [...this.hidden]) if (!ids.has(h)) this.hidden.delete(h);
      this.markCanvas();
      this.refreshLayers();
      this.renderSelBar();
    },
    markCanvas() {
      const sel = new Set(this.sel);
      $$('#d-blocks .blk').forEach((el) => {
        el.classList.toggle('sel', sel.has(el.dataset.id));
        const h = this.hidden.has(el.dataset.id);
        el.classList.toggle('ed-hidden', h);
        if (h) el.dataset.hiddenLabel = t('Oculto en el editor'); else delete el.dataset.hiddenLabel;
      });
    },
    setSel(ids, anchor) {
      this.sel = ids.filter((id) => this.locate(id));
      if (anchor !== undefined) this.anchor = anchor; else if (!this.sel.includes(this.anchor)) this.anchor = this.sel[this.sel.length - 1] || null;
      this.markCanvas();
      this.syncLayerSel();
      this.renderSelBar();
    },
    // Selección con el ratón: Mayús = rango del mismo nivel, Ctrl/Cmd = añadir o quitar
    pick(id, e) {
      if (e.shiftKey && this.anchor && this.locate(this.anchor)) this.setSel(this.rangeIds(this.anchor, id), this.anchor);
      else if (e.ctrlKey || e.metaKey) this.setSel(this.sel.includes(id) ? this.sel.filter((x) => x !== id) : [...this.sel, id], id);
      else this.setSel([id], id);
    },
    // Lleva el lienzo hasta el bloque y lo resalta un momento
    reveal(id) {
      const el = blkEl(id);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1400);
    },
    toggleHidden(id) {
      if (this.hidden.has(id)) this.hidden.delete(id); else this.hidden.add(id);
      this.markCanvas(); this.refreshLayers(true);
    },

    // --- Acciones sobre la selección (cada una, un solo paso de «deshacer») ------------------------------------------
    selMove(dir) { if (this.sel.length) this.change(() => this.shiftIds(this.sel, dir)); },
    selDup() {
      if (!this.sel.length) return;
      let ids = [];
      this.change(() => { ids = this.duplicateIds(this.sel); });
      this.setSel(ids);
    },
    selDel() {
      if (!this.sel.length) return;
      const ids = this.sel.slice();
      this.sel = []; this.anchor = null;
      this.change(() => this.deleteIds(ids));
    },
    canGroup(ids = this.sel) { const l = this.topIds(ids).map((id) => this.locate(id)); return l.length > 0 && l.every((x) => x.arr === l[0].arr); },
    selGroup() {
      if (!this.sel.length) return;
      if (!this.canGroup()) { toast(t('Para agrupar, elige bloques del mismo nivel.')); return; }
      let g = null;
      this.change(() => { g = this.groupIds(this.sel); });
      if (g) this.setSel([g.id], g.id);
    },
    selCopy() {
      const n = this.copyIds(this.sel);
      if (n) toast(n === 1 ? t('1 bloque copiado.') : t('{n} bloques copiados.', { n }));
      this.renderSelBar();
      return n;
    },
    selCut() { if (this.selCopy()) this.selDel(); },
    selPaste() {
      if (!this.clip.length) return;
      const top = this.topIds(this.sel), after = top[top.length - 1] || this.anchor || null;
      let ids = [];
      this.change(() => { ids = this.pasteClip(after); });
      this.setSel(ids, ids[ids.length - 1]);
      this.reveal(ids[0]);
    },

    // --- Barra flotante de la selección múltiple ---------------------------------------------------------------------
    renderSelBar() {
      let bar = $('#sel-bar');
      const many = this.sel.length >= 2 && editorOpen();
      if (!many) { bar?.classList.add('hidden'); return; }
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'sel-bar'; bar.className = 'sel-bar'; bar.setAttribute('role', 'toolbar');
        $('#editor').appendChild(bar);
        bar.addEventListener('mousedown', (e) => e.preventDefault());
        bar.addEventListener('click', (e) => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (!a) return;
          ({ up: () => this.selMove(-1), down: () => this.selMove(1), dup: () => this.selDup(), group: () => this.selGroup(), copy: () => this.selCopy(), cut: () => this.selCut(),
            paste: () => this.selPaste(), sync: () => this.selSaveSynced?.(), del: () => this.selDel(), clear: () => this.setSel([]) })[a]?.();
        });
      }
      const btn = (a, icon, title, extra = '') => `<button data-a="${a}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}><span class="ms">${icon}</span></button>`;
      bar.classList.remove('hidden');
      bar.innerHTML = `<span class="sel-n">${esc(t('{n} seleccionados', { n: this.topIds(this.sel).length }))}</span><i></i>`
        + btn('up', 'arrow_upward', t('Mover arriba')) + btn('down', 'arrow_downward', t('Mover abajo')) + btn('dup', 'content_copy', t('Duplicar'))
        + btn('group', 'web_asset', t('Agrupar en sección'), this.canGroup() ? '' : 'class="dim"') + btn('sync', 'sync', t('Guardar como bloque sincronizado…'), this.canGroup() ? '' : 'class="dim"') + '<i></i>'
        + btn('copy', 'file_copy', t('Copiar')) + btn('cut', 'content_cut', t('Cortar')) + (this.clip.length ? btn('paste', 'content_paste', t('Pegar')) : '') + '<i></i>'
        + btn('del', 'delete', t('Eliminar bloque')) + btn('clear', 'close', t('Deseleccionar (Esc)'));
    },

    // --- Panel de capas ----------------------------------------------------------------------------------------------
    layersOpen() { return !!$('#ed-layers') && !$('#ed-layers').classList.contains('hidden'); },
    toggleLayers(open = !this.layersOpen()) {
      $('#ed-layers')?.classList.toggle('hidden', !open);
      const b = $('#ed-layers-btn'); if (b) { b.classList.toggle('active', open); b.setAttribute('aria-pressed', String(open)); }
      if (open) this.refreshLayers(true);
    },
    // Filas visibles (sin las de dentro de un contenedor plegado) con su profundidad
    layerRows(nodes = this.layerTree(), depth = 0, out = []) {
      for (const n of nodes) {
        out.push({ ...n, depth, open: !this.collapsed.has(n.id) });
        if (n.kids.length && !this.collapsed.has(n.id)) this.layerRows(n.kids, depth + 1, out);
      }
      return out;
    },
    refreshLayers(force = false) {
      if (!this.layersOpen() || !this.draft) return;
      const list = $('#ed-layers .ly-list'), rows = this.layerRows();
      const sig = JSON.stringify(rows.map((r) => [r.id, r.type, r.summary, r.depth, r.kids.length, r.open, this.hidden.has(r.id)]));
      $('#ed-layers .ly-count').textContent = String(this.flat().length);
      if (sig === this.layersSig && !force) { this.syncLayerSel(); return; }
      this.layersSig = sig;
      const focusId = list.contains(document.activeElement) ? document.activeElement.dataset.id : null, top = list.scrollTop;
      const TY = TYPES();
      list.innerHTML = rows.map((r) => {
        const col = r.type === 'col', T = col ? { icon: 'view_column', name: t('Columna {n}', { n: r.index + 1 }) } : TY[r.type] || { icon: 'help', name: r.type };
        const hid = this.hidden.has(r.id), ex = r.kids.length ? `aria-expanded="${r.open}"` : '';
        const eye = hid ? t('Mostrar en el editor') : t('Ocultar en el editor (no afecta a la web)'), fold = r.open ? t('Plegar') : t('Desplegar');
        return `<div class="ly-row${col ? ' col' : ''}${hid ? ' off' : ''}" role="treeitem" tabindex="-1" data-id="${esc(r.id)}" data-type="${r.type}" aria-level="${r.depth + 1}" ${ex} style="--d:${r.depth}" ${col ? '' : 'draggable="true"'}>`
          + `<button class="ly-caret${r.kids.length ? '' : ' none'}" data-a="fold" tabindex="-1" title="${esc(fold)}" aria-label="${esc(fold)}"><span class="ms">${r.open ? 'expand_more' : 'chevron_right'}</span></button>`
          + `<span class="ms ly-ic">${T.icon}</span><span class="ly-t">${esc(T.name)}</span><span class="ly-s">${esc(r.summary)}</span>`
          + (col ? '' : `<span class="ly-acts"><button data-a="eye" tabindex="-1" title="${esc(eye)}" aria-label="${esc(eye)}"><span class="ms">${hid ? 'visibility_off' : 'visibility'}</span></button>`
            + `<button data-a="dup" tabindex="-1" title="${esc(t('Duplicar'))}" aria-label="${esc(t('Duplicar'))}"><span class="ms">content_copy</span></button>`
            + `<button data-a="del" tabindex="-1" title="${esc(t('Eliminar bloque'))}" aria-label="${esc(t('Eliminar bloque'))}"><span class="ms">delete</span></button></span>`)
          + '</div>';
      }).join('') || `<p class="hint ly-empty">${esc(t('Esta entrada aún no tiene bloques.'))}</p>`;
      list.scrollTop = top;
      this.syncLayerSel();
      if (focusId) this.focusRow(focusId);
      else list.querySelector('.ly-row')?.setAttribute('tabindex', '0');
    },
    syncLayerSel() {
      if (!this.layersOpen()) return;
      const sel = new Set(this.sel);
      $$('#ed-layers .ly-row').forEach((r) => { const on = sel.has(r.dataset.id); r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on)); });
    },
    focusRow(id) {
      const rows = $$('#ed-layers .ly-row');
      const row = rows.find((r) => r.dataset.id === id) || rows[0];
      rows.forEach((r) => r.setAttribute('tabindex', r === row ? '0' : '-1'));
      row?.focus();
    },
  });

  // ------------------------------------------------------------------------------------------------------------------
  function wire() {
    const btn = $('#ed-layers-btn'), panel = $('#ed-layers');
    if (!btn || !panel || panel.dataset.wired) return;
    panel.dataset.wired = '1';
    btn.onclick = () => E.toggleLayers();
    $('.ly-close', panel).onclick = () => { E.toggleLayers(false); btn.focus(); };
    const list = $('.ly-list', panel);

    list.addEventListener('click', (e) => {
      const row = e.target.closest('.ly-row');
      if (!row) return;
      const id = row.dataset.id, a = e.target.closest('[data-a]')?.dataset.a;
      const fold = () => { E.collapsed.has(id) ? E.collapsed.delete(id) : E.collapsed.add(id); E.refreshLayers(true); };
      if (a === 'fold' || row.dataset.type === 'col') { fold(); return; }
      if (a === 'eye') { E.toggleHidden(id); return; }
      if (a === 'dup') { E.setSel([id], id); E.selDup(); return; }
      if (a === 'del') { const next = row.nextElementSibling?.dataset.id || row.previousElementSibling?.dataset.id; E.setSel([id], id); E.selDel(); if (next) E.focusRow(next); return; }
      E.pick(id, e);
      E.focusRow(id);
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) E.reveal(id);
    });
    // teclado: flechas, plegar/desplegar con izquierda/derecha, Intro selecciona, Espacio oculta/muestra, Supr borra
    list.addEventListener('keydown', (e) => {
      const row = e.target.closest('.ly-row');
      if (!row || e.target !== row) return;
      const rows = $$('.ly-row', list), i = rows.indexOf(row), id = row.dataset.id, folds = row.hasAttribute('aria-expanded'), isCol = row.dataset.type === 'col';
      const go = (k) => {
        const r = rows[Math.max(0, Math.min(rows.length - 1, k))];
        if (!r) return;
        E.focusRow(r.dataset.id);
        if (e.shiftKey && !isCol && r.dataset.type !== 'col') E.pick(r.dataset.id, { shiftKey: true });
      };
      const del = () => { if (isCol) return; const next = rows[i + 1]?.dataset.id || rows[i - 1]?.dataset.id; if (!E.sel.includes(id)) E.setSel([id], id); E.selDel(); if (next) E.focusRow(next); };
      const keys = {
        ArrowDown: () => go(i + 1), ArrowUp: () => go(i - 1), Home: () => go(0), End: () => go(rows.length - 1),
        ArrowRight: () => { if (folds && E.collapsed.has(id)) { E.collapsed.delete(id); E.refreshLayers(true); } else go(i + 1); },
        ArrowLeft: () => {
          if (folds && !E.collapsed.has(id)) { E.collapsed.add(id); E.refreshLayers(true); return; }
          const d = +row.getAttribute('aria-level');
          for (let k = i - 1; k >= 0; k--) if (+rows[k].getAttribute('aria-level') < d) { go(k); return; }
        },
        Enter: () => { if (isCol) return; E.pick(id, e); E.reveal(id); },
        ' ': () => { if (!isCol) E.toggleHidden(id); },
        Delete: del, Backspace: del,
      };
      if (keys[e.key]) { e.preventDefault(); e.stopPropagation(); keys[e.key](); }
    });

    // arrastrar filas: reordena dentro y fuera de contenedores (un contenedor no entra en sí mismo)
    let dragIds = null;
    const clearMarks = () => $$('.ly-row', list).forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    // dónde caería: { arr, before, zone } o null
    const target = (row, y) => {
      const id = row.dataset.id, rc = row.getBoundingClientRect(), f = rc.height ? (y - rc.top) / rc.height : 0.5;
      if (row.dataset.type === 'col') {
        const arr = E.locate(id.split('#')[0])?.b.cols?.[+id.split('#')[1]]?.children;
        return arr ? { arr, before: null, zone: 'inside' } : null;
      }
      const loc = E.locate(id);
      if (!loc) return null;
      if (CONTAINERS.includes(loc.b.type) && f > 0.3 && f < 0.7) return { arr: loc.b.children, before: null, zone: 'inside' };
      if (f < 0.5) return { arr: loc.arr, before: id, zone: 'before' };
      return { arr: loc.arr, before: loc.arr[loc.i + 1]?.id || null, zone: 'after' };
    };
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest?.('.ly-row[draggable]');
      if (!row) return;
      const id = row.dataset.id;
      dragIds = E.sel.includes(id) && E.sel.length > 1 ? E.topIds(E.sel) : [id];
      K.drag = { kind: 'block', id, ids: dragIds };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ecos', 'block');
      K.ghost(e, `<span class="ms">${esc(row.querySelector('.ly-ic').textContent)}</span>${esc(row.querySelector('.ly-t').textContent)}${dragIds.length > 1 ? ' +' + (dragIds.length - 1) : ''}`);
      row.classList.add('dragging');
    });
    list.addEventListener('dragover', (e) => {
      if (!dragIds) return;
      const row = e.target.closest('.ly-row');
      clearMarks();
      const tg = row && target(row, e.clientY);
      if (!tg || !E.canMoveTo(dragIds, tg.arr)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-' + tg.zone);
    });
    list.addEventListener('drop', (e) => {
      if (!dragIds) return;
      const row = e.target.closest('.ly-row'), tg = row && target(row, e.clientY), ids = dragIds;
      clearMarks();
      if (!tg || !E.canMoveTo(ids, tg.arr)) return;
      e.preventDefault();
      dragIds = null; K.drag = null; K.endDrag();
      let moved = false;
      E.change(() => { moved = E.moveBlocks(ids, tg.arr, tg.before); });
      if (moved) E.setSel(ids, ids[0]);
    });
    list.addEventListener('dragend', () => { dragIds = null; K.drag = null; clearMarks(); $$('.ly-row.dragging', list).forEach((r) => r.classList.remove('dragging')); K.endDrag(); });
    list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) clearMarks(); });

    // los textos de las filas siguen a lo que se escribe en el lienzo (sin tocar el árbol si nada cambió)
    let tm = 0;
    $('#d-blocks')?.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => E.refreshLayers(), 300); });

    // selección con el ratón en el lienzo
    const canvas = $('#ed-canvas');
    const modifier = (e) => e.shiftKey || e.ctrlKey || e.metaKey;
    const onCanvas = (e) => {
      const blk = e.target.closest?.('#d-blocks .blk');
      return blk && !e.target.closest('.blk-tools, .ins, #ins-menu, #dd-pop') ? blk : null;
    };
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const blk = onCanvas(e);
      if (blk && modifier(e)) { e.preventDefault(); e.stopPropagation(); E.pick(blk.dataset.id, e); getSelection()?.removeAllRanges(); document.activeElement?.blur?.(); return; }
      if (E.sel.length && !e.target.closest('.blk-tools, .blk-handle')) E.setSel([]);
    }, true);
    canvas.addEventListener('click', (e) => { if (modifier(e) && onCanvas(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
    // arrastrar el asa de uno de los seleccionados mueve todos (los soltadores de drag.js y este archivo leen K.drag.ids)
    document.addEventListener('dragstart', (e) => {
      if (!e.target.closest?.('.blk-handle') || !K.drag || K.drag.kind !== 'block' || E.sel.length < 2 || !E.sel.includes(K.drag.id)) return;
      K.drag.ids = E.topIds(E.sel);
    });
    // soltar varios sobre un bloque: antes o después de él (block.js solo conoce un id)
    document.addEventListener('drop', (e) => {
      const d = K.drag;
      if (!d || d.kind !== 'block' || !(d.ids?.length > 1) || dragIds) return;
      const el = e.target.closest?.('#d-blocks .blk');
      if (!el || e.target.closest('.blk') !== el) return;
      const id = el.dataset.id, loc = E.locate(id);
      if (!loc || d.ids.includes(id) || d.ids.some((x) => E.within(x, id))) return;
      e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2, ids = d.ids;
      K.drag = null; K.endDrag();
      $$('#d-blocks .drop-before, #d-blocks .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      E.change(() => E.moveBlocks(ids, loc.arr, after ? loc.arr[loc.i + 1]?.id || null : id));
      E.setSel(ids, ids[0]);
    }, true);
  }
  E.wireLayers = wire;

  // Esc deselecciona · Ctrl/Cmd+C / X / V con el foco fuera de un texto · Supr borra la selección
  document.addEventListener('keydown', (e) => {
    if (!editorOpen()) return;
    if (e.key === 'Escape' && E.sel.length) { e.preventDefault(); E.setSel([]); return; }
    if (inText(e.target) || e.target.closest?.('#ed-layers')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    const textSel = !getSelection()?.isCollapsed;
    if (mod && k === 'c' && E.sel.length && !textSel) { e.preventDefault(); E.selCopy(); }
    else if (mod && k === 'x' && E.sel.length && !textSel) { e.preventDefault(); E.selCut(); }
    else if (mod && k === 'v' && E.clip.length) { e.preventDefault(); E.selPaste(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && E.sel.length >= 1 && !mod) { e.preventDefault(); E.selDel(); }
  });

  wire();
})();
