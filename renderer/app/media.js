// Biblioteca de medios de WordPress (solo WordPress propio): ver, limpiar y reutilizar fotos y vídeos.
// Dos usos de la misma rejilla: la vista «Medios» del Blog y el selector «De la biblioteca» del editor.

const fmtBytes = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const mediaDate = (d) => { try { return new Date(d).toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

// Rejilla con filtros, búsqueda, «Cargar más» y selección. o = { usage: boolean (etiquetas y filtro «Sin usar»), onChange() }
function mediaGrid(host, o = {}) {
  const st = { type: 'all', search: '', unused: false, page: 0, totalPages: 1, total: 0, items: [], sel: new Map(), usage: null, usageErr: false, loading: false, err: '', gen: 0 };
  host.innerHTML = `<div class="mg-tools">
      <div class="seg mg-type">
        <button data-t="all" class="active">${t('Todo')}</button>
        <button data-t="image"><span class="ms">image</span>${t('Fotos')}</button>
        <button data-t="video"><span class="ms">movie</span>${t('Vídeos')}</button>
      </div>
      <div class="field search"><span class="ms">search</span><input type="search" class="mg-search" placeholder="${escHtml(t('Buscar por nombre…'))}"></div>
      ${o.usage ? `<label class="switch mg-unused"><input type="checkbox"><span>${t('Sin usar')}</span></label>` : ''}
      <button class="btn text icon-only mg-refresh" title="${escHtml(t('Actualizar'))}"><span class="ms">refresh</span></button>
      <span class="spacer"></span>
      <span class="hint mg-count"></span>
    </div>
    <div class="mg-slot"></div>
    <div class="mg-more"><button class="btn tonal small mg-more-btn"><span class="ms">expand_more</span>${t('Cargar más')}</button></div>`;
  const q = (s) => host.querySelector(s);
  const slot = q('.mg-slot'), moreBox = q('.mg-more');

  const changed = () => { o.onChange?.(); };
  function render() {
    const loadingFirst = st.loading && !st.items.length;
    q('.mg-count').textContent = !st.items.length ? '' : st.unused ? t('{n} sin usar', { n: st.items.length }) : t('{n} de {total}', { n: st.items.length, total: st.total });
    if (loadingFirst) { slot.innerHTML = `<p class="hint pad">${t('Cargando…')}</p>`; moreBox.classList.add('hidden'); return; }
    if (st.err && !st.items.length) {
      slot.innerHTML = `<div class="mg-empty"><span class="ms">error</span><p></p><button class="btn tonal small mg-retry">${t('Reintentar')}</button></div>`;
      slot.querySelector('p').textContent = st.err;
      slot.querySelector('.mg-retry').onclick = () => load(true);
      moreBox.classList.add('hidden'); return;
    }
    if (!st.items.length) {
      slot.innerHTML = `<div class="mg-empty"><span class="ms">photo_library</span><p>${st.unused ? t('No hay medios sin usar. ¡Todo está en alguna entrada!') : st.search ? t('No hay nada con ese nombre.') : t('Todavía no hay fotos ni vídeos en la biblioteca.')}</p></div>`;
      moreBox.classList.add('hidden'); return;
    }
    slot.innerHTML = '<div class="mg-grid"></div>';
    const grid = slot.firstChild;
    st.items.forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'mg-card' + (st.sel.has(m.id) ? ' sel' : '');
      card.dataset.id = m.id;
      const thumb = m.type === 'video'
        ? `<video src="${escHtml(m.url)}#t=0.1" muted preload="metadata"></video><span class="ms fill play">play_circle</span>`
        : `<img src="${escHtml(m.thumb || m.url)}" alt="${escHtml(m.alt)}" loading="lazy" draggable="false">`;
      const uses = st.usage ? st.usage[m.id] : null;
      const tag = !o.usage || !st.usage ? '' : uses?.length
        ? `<span class="mg-tag use" title="${escHtml(uses.map((u) => u.title).join('\n'))}">${t('En uso ({n})', { n: uses.length })}</span>`
        : `<span class="mg-tag free">${t('Sin usar')}</span>`;
      const meta = [mediaDate(m.date), m.width ? `${m.width}×${m.height}` : '', fmtBytes(m.size)].filter(Boolean).join(' · ');
      card.innerHTML = `<div class="mg-th">${thumb}</div><label class="mg-check"><input type="checkbox" ${st.sel.has(m.id) ? 'checked' : ''}></label>${tag}
        <div class="mg-meta"><b title="${escHtml(m.name)}">${escHtml(m.name)}</b><span>${escHtml(meta)}</span></div>`;
      const toggle = () => { st.sel.has(m.id) ? st.sel.delete(m.id) : st.sel.set(m.id, m); card.classList.toggle('sel', st.sel.has(m.id)); card.querySelector('input').checked = st.sel.has(m.id); changed(); };
      card.onclick = (e) => { if (e.target.closest('.mg-check')) { e.preventDefault(); } toggle(); };
      card.ondblclick = () => openLightbox(st.items.map((x) => ({ type: x.type, src: x.url, poster: x.thumb })), i);
      grid.appendChild(card);
    });
    moreBox.classList.toggle('hidden', st.page >= st.totalPages);
    q('.mg-more-btn').disabled = st.loading;
  }

  async function load(reset) {
    if (reset) { st.gen++; st.page = 0; st.totalPages = 1; st.total = 0; st.items = []; st.err = ''; }
    const gen = st.gen;
    st.loading = true; render();
    try {
      if (st.unused && !st.usage) await usageReady();
      let added = 0;
      do {
        const r = await window.api.mediaList({ page: st.page + 1, perPage: 40, type: st.type, search: st.search });
        if (gen !== st.gen) return;
        st.page++; st.totalPages = r.totalPages || 1; st.total = r.total || 0;
        const fresh = st.unused ? r.items.filter((m) => !(st.usage?.[m.id]?.length)) : r.items;
        st.items.push(...fresh); added += fresh.length;
      } while (st.unused && added < 20 && st.page < st.totalPages);
      st.err = '';
    } catch (e) {
      if (gen !== st.gen) return;
      st.err = e.message;
      if (st.items.length) toast(e.message, true);
    }
    st.loading = false; render();
  }
  // Uso de cada medio (en segundo plano; la rejilla se pinta antes)
  let usageP = null;
  function usageReady(force) {
    if (!o.usage) return Promise.resolve();
    usageP = window.api.mediaUsage(!!force).then((u) => { st.usage = u || {}; st.usageErr = false; }).catch((e) => { st.usage = null; st.usageErr = true; toast(t('No se pudo comprobar qué fotos se usan: {e}', { e: e.message }), true); });
    return usageP;
  }
  async function reload(force) {
    if (o.usage) { st.usage = null; const p = usageReady(force); p.then(() => { if (!st.unused) render(); }); if (st.unused) await p; }
    return load(true);
  }

  q('.mg-type').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('.mg-type button', host).forEach((x) => x.classList.toggle('active', x === b));
    st.type = b.dataset.t; load(true);
  };
  let timer; q('.mg-search').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { st.search = e.target.value.trim(); load(true); }, 350); };
  q('.mg-unused')?.querySelector('input').addEventListener('change', async (e) => {
    st.unused = e.target.checked;
    if (st.unused && !st.usage) { st.loading = true; st.items = []; render(); await usageReady(); if (!st.usage) { st.unused = false; e.target.checked = false; } }
    load(true);
  });
  q('.mg-refresh').onclick = () => reload(true);
  q('.mg-more-btn').onclick = () => load(false);

  return {
    sel: st.sel, st, reload, render,
    clear() { st.sel.clear(); render(); changed(); },
    remove(ids) { const s = new Set(ids); st.items = st.items.filter((m) => !s.has(m.id)); ids.forEach((id) => st.sel.delete(id)); st.total = Math.max(0, st.total - ids.length); render(); changed(); },
  };
}

// --- Vista «Medios» del Blog ---------------------------------------------------------
let mediaLib = null;
function renderMediaLib() {
  const box = $('#b-media');
  if (CFG.wpMode !== 'selfhosted') {
    mediaLib = null;
    box.innerHTML = `<div class="mg-empty"><span class="ms">photo_library</span><p>${t('La biblioteca de medios solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.')}</p></div>`;
    return;
  }
  if (mediaLib) return; // ya está montada; «Actualizar» recarga
  box.innerHTML = `<div class="mg-bar"><span class="mg-sel">${t('Pulsa una foto para seleccionarla; doble clic para verla en grande.')}</span><span class="mg-acts"></span></div><div class="mg-host"></div>`;
  const acts = box.querySelector('.mg-acts'), label = box.querySelector('.mg-sel');
  const sync = () => {
    const n = mediaLib.sel.size;
    label.textContent = n ? t('{n} seleccionadas', { n }) : t('Pulsa una foto para seleccionarla; doble clic para verla en grande.');
    box.querySelector('.mg-bar').classList.toggle('on', n > 0);
    acts.innerHTML = n ? `<button class="btn tonal small" data-a="copy"><span class="ms">link</span>${t('Copiar enlace')}</button>
      ${n === 1 ? `<button class="btn tonal small" data-a="alt"><span class="ms">edit_note</span>${t('Editar descripción (alt)')}</button>` : ''}
      <button class="btn tonal small danger" data-a="del"><span class="ms">delete</span>${t('Borrar de la biblioteca')}</button>
      <button class="btn text icon-only" data-a="clear" title="${escHtml(t('Quitar la selección'))}"><span class="ms">close</span></button>` : '';
  };
  mediaLib = mediaGrid(box.querySelector('.mg-host'), { usage: true, onChange: sync });
  acts.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const sel = [...mediaLib.sel.values()];
    if (b.dataset.a === 'clear') return mediaLib.clear();
    if (b.dataset.a === 'copy') {
      try { await navigator.clipboard.writeText(sel.map((m) => m.url).join('\n')); toast(sel.length > 1 ? t('{n} enlaces copiados', { n: sel.length }) : t('Enlace copiado')); } catch { toast(t('No se pudo copiar'), true); }
    }
    if (b.dataset.a === 'alt') {
      const m = sel[0], v = await askText(t('Descripción de la foto (alt)'), m.alt, t('Describe la foto para quien no la pueda ver. También ayuda al posicionamiento en buscadores.'));
      if (v === null) return;
      await busy(b, async () => { await window.api.mediaSetAlt(m.id, v); m.alt = v; toast(t('Descripción guardada')); });
      mediaLib.render();
    }
    if (b.dataset.a === 'del') {
      const used = sel.filter((m) => mediaLib.st.usage?.[m.id]?.length);
      let msg = sel.length === 1 ? t('¿Borrar «{name}» de la biblioteca? No se puede deshacer.', { name: sel[0].name }) : t('¿Borrar {n} archivos de la biblioteca? No se puede deshacer.', { n: sel.length });
      if (used.length) msg += '\n\n' + t('Atención: {n} se usan en alguna entrada y dejarán de verse allí.', { n: used.length });
      if (!await ask(msg, { ok: t('Borrar'), danger: true })) return;
      await busy(b, async () => {
        const r = await window.api.mediaDelete(sel.map((m) => m.id));
        mediaLib.remove(r.done);
        if (r.failed.length) toast(t('No se han podido borrar {n}: {e}', { n: r.failed.length, e: r.failed[0].error }), true);
        else toast(t('{n} borrados', { n: r.done.length }));
      });
    }
  };
  sync();
  mediaLib.reload();
}
// Diálogo con un campo de texto. Devuelve el texto o null si se cancela.
function askText(title, value = '', hint = '') {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    d.innerHTML = `<div class="dlg mg-dlg" role="dialog" aria-modal="true"><span class="ms fill dlg-ic">edit_note</span><b class="dlg-title"></b>
      <p class="hint"></p><textarea rows="3" maxlength="500"></textarea>
      <div class="dlg-actions"><button class="btn text" data-r="0">${t('Cancelar')}</button><button class="btn filled" data-r="1">${t('Guardar')}</button></div></div>`;
    d.querySelector('.dlg-title').textContent = title; d.querySelector('.hint').textContent = hint;
    const ta = d.querySelector('textarea'); ta.value = value || '';
    const close = (v) => { d.remove(); document.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); close(ta.value.trim()); } };
    d.querySelector('[data-r="0"]').onclick = () => close(null);
    d.querySelector('[data-r="1"]').onclick = () => close(ta.value.trim());
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(d); ta.focus(); ta.select();
  });
}

// --- Selector «De la biblioteca» del editor ------------------------------------------
function openMediaPicker() {
  if (CFG.wpMode !== 'selfhosted') return toast(t('La biblioteca de medios solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.'), true);
  const m = document.createElement('div');
  m.className = 'modal mg-modal';
  m.innerHTML = `<div class="modal-box wide"><h2><span class="ms fill modal-icon">photo_library</span>${t('De la biblioteca')}</h2>
    <div class="mg-host"></div>
    <div class="modal-actions"><span class="hint mg-picked"></span><span class="spacer"></span><button class="btn text" data-r="0">${t('Cancelar')}</button><button class="btn filled" data-r="1" disabled><span class="ms">add</span>${t('Añadir a la entrada')}</button></div></div>`;
  const add = m.querySelector('[data-r="1"]');
  const sync = () => { const n = g.sel.size; add.disabled = !n; m.querySelector('.mg-picked').textContent = n ? t('{n} seleccionadas', { n }) : ''; };
  const g = mediaGrid(m.querySelector('.mg-host'), { usage: false, onChange: sync });
  const close = () => { m.remove(); document.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape' && !$('#lightbox:not(.hidden)')) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', key, true);
  m.querySelector('[data-r="0"]').onclick = close;
  m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
  add.onclick = () => {
    const picked = [...g.sel.values()].map((x) => ({ id: x.id, url: x.type === 'video' ? x.url : (x.large || x.url), type: x.type, alt: x.alt || '' }));
    draft.extraMedia = [...(draft.extraMedia || []), ...picked.filter((p) => !(draft.extraMedia || []).some((e) => e.id === p.id))];
    window.BlockEditor.media = mediaPool(); window.BlockEditor.renderMedia();
    toast(t('{n} archivo(s) añadidos a la bandeja', { n: picked.length }));
    close();
  };
  document.body.appendChild(m);
  g.reload();
}
$('#d-media-lib')?.addEventListener('click', openMediaPicker);
