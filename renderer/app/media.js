// Biblioteca de medios de WordPress (solo WordPress propio): ver, limpiar y reutilizar fotos y vídeos.
// Dos usos de la misma rejilla: la vista «Medios» del Blog y el selector «De la biblioteca» del editor.

// Fecha escrita en el nombre del archivo (igual que src/photodate.js): «WhatsApp-Image-2023-02-04…», «IMG_20190512…»
function dateFromFileName(name) {
  let n = String(name || ''); try { n = decodeURIComponent(n); } catch { /* tal cual */ }
  const m = n.split('/').pop().match(/(?<!\d)((?:19|20)\d{2})([-_.]?)(0[1-9]|1[0-2])\2(0[1-9]|[12]\d|3[01])(?!\d)/);
  if (!m || Number(m[1]) < 1990 || Number(m[1]) > new Date().getFullYear()) return null;
  return `${m[1]}-${m[3]}-${m[4]}`;
}
const fmtBytes = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const mediaDate = (d) => { try { return new Date(d).toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

// Rejilla de medios con filtros (tipo, nombre, fechas, «Sin usar»), páginas y selección.
// o = { usage: boolean (biblioteca: etiquetas de uso, fecha original y filtro «Sin usar»), onChange() }
// En la biblioteca se lee la lista entera una vez (es ligera) y se filtra y pagina aquí, para poder filtrar por
// la fecha original (la de la entrada donde se usa cada foto) y por «Sin usar». En el selector del editor se
// piden las páginas a WordPress.
function mediaGrid(host, o = {}) {
  const st = { type: 'all', search: '', unused: false, from: '', to: '', page: 1, per: 40, total: 0, items: [], pool: null,
    sel: new Map(), usage: null, usageErr: false, loading: false, err: '', gen: 0 };
  const yearOpts = (() => { const y = new Date().getFullYear(); let h = ''; for (let k = y; k >= 2005; k--) h += `<option value="y${k}">${k}</option>`; return h; })();
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
    <div class="b-range mg-range">
      <span class="ms">date_range</span>
      <select class="mg-preset" title="${escHtml(t(o.usage ? 'Fecha de la entrada donde se usa (o de subida si no se usa)' : 'Fecha de subida'))}">
        <option value="all">${t('Todas las fechas')}</option><option value="month">${t('Este mes')}</option><option value="year">${t('Este año')}</option>
        ${yearOpts}<option value="custom">${t('De una fecha a otra…')}</option>
      </select>
      <label class="b-date"><span>${t('Desde')}</span><input type="date" class="mg-from"></label>
      <label class="b-date"><span>${t('Hasta')}</span><input type="date" class="mg-to"></label>
      <button class="btn text icon-only mg-range-clear hidden" title="${escHtml(t('Quitar el filtro de fechas'))}"><span class="ms">close</span></button>
      ${o.usage ? `<span class="spacer"></span><button class="btn tonal mg-selall"><span class="ms">select_all</span><span class="mg-selall-l"></span></button>` : ''}
    </div>
    <div class="mg-slot"></div>
    <div class="pager mg-pager">
      <button class="btn text icon-only" data-pg="first" title="${escHtml(t('Primera página'))}"><span class="ms">first_page</span></button>
      <button class="btn text icon-only" data-pg="prev" title="${escHtml(t('Página anterior'))}"><span class="ms">chevron_left</span></button>
      <span class="hint mg-info"></span>
      <button class="btn text icon-only" data-pg="next" title="${escHtml(t('Página siguiente'))}"><span class="ms">chevron_right</span></button>
      <button class="btn text icon-only" data-pg="last" title="${escHtml(t('Última página'))}"><span class="ms">last_page</span></button>
      <span class="pager-sep"></span>
      <label class="pager-go"><span>${t('Ir a la página')}</span><input class="mg-goto" type="number" min="1" inputmode="numeric"><button class="btn tonal small mg-go">${t('Ir')}</button></label>
      <label class="pager-go"><span>${t('Por página')}</span><select class="mg-per"><option>40</option><option>80</option><option>120</option></select></label>
    </div>`;
  const q = (s) => host.querySelector(s);
  const slot = q('.mg-slot');
  const changed = () => { o.onChange?.(); };
  const pages = () => Math.max(1, Math.ceil(st.total / st.per));
  // Fecha original de un medio: la de la primera entrada donde se usa (si se sabe); si no, la de subida
  // Fecha original de un medio y de dónde sale: la entrada donde se usa; la entrada a la que se subió; la fecha
  // escrita en el nombre (WhatsApp, móviles…); si no, la de subida
  const dateInfo = (m) => {
    const u = st.usage?.[m.id];
    const d = (u || []).map((x) => x.date).filter(Boolean).sort()[0];
    if (d) return { date: d, src: 'post', title: u[0]?.title };
    const pd = m.parent && st.usage?._postDates?.[m.parent];
    if (pd) return { date: pd, src: 'parent' };
    const nd = dateFromFileName(m.url || m.name);
    if (nd) return { date: nd + 'T12:00:00', src: 'name' };
    return { date: m.date, src: '' };
  };
  const origDate = (m) => dateInfo(m).date;
  const range = () => {
    const f = st.from ? new Date(st.from + 'T00:00:00') : null;
    const tt = st.to ? new Date(st.to + 'T00:00:00') : null; if (tt) tt.setDate(tt.getDate() + 1);
    return { f, tt };
  };

  function render() {
    q('.mg-count').textContent = st.total ? (st.unused ? t('{n} sin usar', { n: st.total }) : t('{n} archivos', { n: st.total })) : '';
    q('.mg-info').textContent = st.total ? t('página {p} de {t}', { p: st.page, t: pages() }) : '';
    q('[data-pg="first"]').disabled = q('[data-pg="prev"]').disabled = st.page <= 1 || st.loading;
    q('[data-pg="next"]').disabled = q('[data-pg="last"]').disabled = st.page >= pages() || st.loading;
    q('.mg-pager').classList.toggle('hidden', pages() <= 1 && st.per === 40);
    q('.mg-goto').max = pages(); q('.mg-goto').placeholder = String(st.page);
    const dated = !!(st.from || st.to);
    if (q('.mg-selall')) { q('.mg-selall-l').textContent = st.total ? t('Seleccionar las {n}', { n: st.total }) : t('Seleccionar todas'); q('.mg-selall').disabled = !st.total || !st.pool; }
    q('.mg-range').classList.toggle('active', dated); q('.mg-range-clear').classList.toggle('hidden', !dated);
    if (st.loading && !st.items.length) { slot.innerHTML = `<p class="hint pad">${t('Cargando…')}</p>`; return; }
    if (st.err && !st.items.length) {
      slot.innerHTML = `<div class="mg-empty"><span class="ms">error</span><p></p><button class="btn tonal small mg-retry">${t('Reintentar')}</button></div>`;
      slot.querySelector('p').textContent = st.err;
      slot.querySelector('.mg-retry').onclick = () => reload(true);
      return;
    }
    if (!st.items.length) {
      slot.innerHTML = `<div class="mg-empty"><span class="ms">photo_library</span><p>${st.unused ? t('No hay medios sin usar. ¡Todo está en alguna entrada!') : st.search || dated ? t('No hay nada con estos filtros.') : t('Todavía no hay fotos ni vídeos en la biblioteca.')}</p></div>`;
      return;
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
      const di = dateInfo(m), isOrig = di.src && di.date.slice(0, 10) !== String(m.date).slice(0, 10);
      const why = di.src === 'post' ? t('Fecha de la entrada «{x}» · subida el {d}', { x: di.title || '', d: mediaDate(m.date) })
        : di.src === 'parent' ? t('Fecha de la entrada a la que se subió · subida el {d}', { d: mediaDate(m.date) })
        : t('Fecha escrita en el nombre del archivo · subida el {d}', { d: mediaDate(m.date) });
      const dateTxt = isOrig ? `<span class="mg-orig" title="${escHtml(why)}"><span class="ms">event</span>${escHtml(mediaDate(di.date))}</span>` : escHtml(mediaDate(m.date));
      const meta = [m.width ? `${m.width}×${m.height}` : '', fmtBytes(m.size)].filter(Boolean).join(' · ');
      card.innerHTML = `<div class="mg-th">${thumb}</div><label class="mg-check"><input type="checkbox" ${st.sel.has(m.id) ? 'checked' : ''}></label>${tag}
        <div class="mg-meta"><b title="${escHtml(m.name)}">${escHtml(m.name)}</b><span>${dateTxt}${meta ? ' · ' + escHtml(meta) : ''}</span></div>`;
      const toggle = () => { st.sel.has(m.id) ? st.sel.delete(m.id) : st.sel.set(m.id, m); card.classList.toggle('sel', st.sel.has(m.id)); card.querySelector('input').checked = st.sel.has(m.id); changed(); };
      card.onclick = (e) => { if (e.target.closest('.mg-check')) { e.preventDefault(); } toggle(); };
      card.ondblclick = () => openLightbox(st.items.map((x) => ({ type: x.type, src: x.url, poster: x.thumb })), i);
      grid.appendChild(card);
    });
  }

  // Biblioteca: toda la lista una vez (ligera) → filtros y páginas aquí
  async function loadPool(gen, force) {
    const all = await window.api.mediaAll(!!force);
    return gen !== st.gen ? null : all;
  }
  function filtered() {
    const { f, tt } = range(), s = st.search.toLowerCase();
    return st.pool.filter((m) => {
      if (st.type !== 'all' && m.type !== st.type) return false;
      if (s && !`${m.name} ${m.url}`.toLowerCase().includes(s)) return false;
      if (st.unused && st.usage?.[m.id]?.length) return false;
      if (f || tt) { const d = new Date(origDate(m)); if ((f && d < f) || (tt && d >= tt)) return false; }
      return true;
    }).sort((a, b) => new Date(origDate(b)) - new Date(origDate(a)));
  }
  async function load() {
    const gen = ++st.gen;
    st.loading = true; st.err = ''; render();
    try {
      if (o.usage) {
        if (!st.pool) { st.items = []; render(); const p = await loadPool(gen, st.force); st.force = false; if (!p) return; st.pool = p; }
        if (gen !== st.gen) return;
        const list = filtered();
        st.total = list.length;
        st.page = Math.min(st.page, pages());
        st.items = list.slice((st.page - 1) * st.per, st.page * st.per);
      } else {
        const { f, tt } = range();
        const r = await window.api.mediaList({ page: st.page, perPage: st.per, type: st.type, search: st.search, ...(f ? { after: f.toISOString() } : {}), ...(tt ? { before: tt.toISOString() } : {}) });
        if (gen !== st.gen) return;
        st.items = r.items; st.total = r.total || r.items.length;
      }
    } catch (e) {
      if (gen !== st.gen) return;
      st.err = e.message; st.items = [];
    }
    st.loading = false; render();
  }
  // Uso de cada medio (en segundo plano; la rejilla se pinta antes)
  function usageReady(force) {
    if (!o.usage) return Promise.resolve();
    return window.api.mediaUsage(!!force).then((u) => { st.usage = u || {}; st.usageErr = false; }).catch((e) => { st.usage = null; st.usageErr = true; toast(t('No se pudo comprobar qué fotos se usan: {e}', { e: e.message }), true); });
  }
  async function reload(force) {
    st.pool = null; st.force = !!force;
    if (o.usage) { st.usage = null; const p = usageReady(force).then(() => load()); if (st.unused || st.from || st.to) await p; else load(); return p; }
    return load();
  }
  const refilter = () => { st.page = 1; return (o.usage && !st.usage && (st.unused || st.from || st.to)) ? usageReady().then(load) : load(); };

  q('.mg-type').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('.mg-type button', host).forEach((x) => x.classList.toggle('active', x === b));
    st.type = b.dataset.t; refilter();
  };
  let timer; q('.mg-search').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { st.search = e.target.value.trim(); refilter(); }, 300); };
  q('.mg-unused')?.querySelector('input').addEventListener('change', (e) => { st.unused = e.target.checked; refilter(); });
  q('.mg-refresh').onclick = () => reload(true);
  // fechas
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  q('.mg-preset').onchange = (e) => {
    const v = e.target.value, now = new Date();
    if (v === 'all') { st.from = st.to = ''; }
    else if (v === 'month') { st.from = iso(new Date(now.getFullYear(), now.getMonth(), 1)); st.to = iso(now); }
    else if (v === 'year') { st.from = iso(new Date(now.getFullYear(), 0, 1)); st.to = iso(now); }
    else if (/^y\d{4}$/.test(v)) { st.from = `${v.slice(1)}-01-01`; st.to = `${v.slice(1)}-12-31`; }
    else { q('.mg-from').focus(); return; }
    q('.mg-from').value = st.from; q('.mg-to').value = st.to; refilter();
  };
  [q('.mg-from'), q('.mg-to')].forEach((i) => (i.onchange = () => { st.from = q('.mg-from').value; st.to = q('.mg-to').value; q('.mg-preset').value = st.from || st.to ? 'custom' : 'all'; refilter(); }));
  q('.mg-range-clear').onclick = () => { st.from = st.to = ''; q('.mg-from').value = q('.mg-to').value = ''; q('.mg-preset').value = 'all'; refilter(); };
  // todas las que cumplen los filtros (de todas las páginas)
  q('.mg-selall')?.addEventListener('click', () => { if (!st.pool) return; for (const m of filtered()) st.sel.set(m.id, m); render(); changed(); toast(t('{n} seleccionadas', { n: st.sel.size })); });
  // páginas
  const go = (p) => { const n = Math.min(pages(), Math.max(1, Math.round(Number(p) || 1))); q('.mg-goto').value = ''; if (n === st.page) return; st.page = n; load(); host.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  q('.mg-pager').onclick = (e) => { const b = e.target.closest('[data-pg]'); if (!b) return; go({ first: 1, prev: st.page - 1, next: st.page + 1, last: pages() }[b.dataset.pg]); };
  q('.mg-go').onclick = () => { if (q('.mg-goto').value) go(q('.mg-goto').value); };
  q('.mg-goto').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value) go(e.target.value); };
  q('.mg-per').onchange = (e) => { const first = (st.page - 1) * st.per; st.per = Number(e.target.value); st.page = Math.floor(first / st.per) + 1; load(); };

  return {
    sel: st.sel, st, reload, render, origDate, dateInfo,
    clear() { st.sel.clear(); render(); changed(); },
    remove(ids) { const s = new Set(ids); if (st.pool) st.pool = st.pool.filter((m) => !s.has(m.id)); ids.forEach((id) => st.sel.delete(id)); load(); changed(); },
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
    const n = mediaLib.sel.size, sel = [...mediaLib.sel.values()];
    label.textContent = n ? t('{n} seleccionadas', { n }) : t('Pulsa una foto para seleccionarla; doble clic para verla en grande.');
    box.querySelector('.mg-bar').classList.toggle('on', n > 0);
    acts.innerHTML = !n ? `<button class="btn tonal small" data-a="dupes" title="${escHtml(t('Busca la misma foto subida varias veces y deja solo la de mejor calidad'))}"><span class="ms">filter_none</span>${t('Buscar fotos repetidas')}</button>` : `<button class="btn tonal small" data-a="copy"><span class="ms">link</span>${t('Copiar enlace')}</button>
      ${n === 1 ? `<button class="btn tonal small" data-a="alt"><span class="ms">edit_note</span>${t('Editar descripción (alt)')}</button>` : ''}
      ${sel.some((m) => m.type !== 'video') ? `<button class="btn tonal small" data-a="ai"><span class="ms">auto_fix_high</span>${t('Mejorar con IA')}</button>` : ''}
      ${sel.some((m) => m.type !== 'video') ? `<button class="btn tonal small" data-a="dates" title="${escHtml(t('Pone a cada foto su fecha real: la de la entrada donde se usa o se subió, la escrita en su nombre o la que la cámara guardó dentro de la foto'))}"><span class="ms">event</span>${t('Poner fecha original')}</button>` : ''}
      <button class="btn tonal small danger" data-a="del"><span class="ms">delete</span>${t('Borrar de la biblioteca')}</button>
      <button class="btn text icon-only" data-a="clear" title="${escHtml(t('Quitar la selección'))}"><span class="ms">close</span></button>`;
  };
  mediaLib = mediaGrid(box.querySelector('.mg-host'), { usage: true, onChange: sync });
  acts.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const sel = [...mediaLib.sel.values()];
    if (b.dataset.a === 'clear') return mediaLib.clear();
    if (b.dataset.a === 'dupes') return busy(b, () => findDuplicates());
    if (b.dataset.a === 'copy') {
      try { await navigator.clipboard.writeText(sel.map((m) => m.url).join('\n')); toast(sel.length > 1 ? t('{n} enlaces copiados', { n: sel.length }) : t('Enlace copiado')); } catch { toast(t('No se pudo copiar'), true); }
    }
    if (b.dataset.a === 'alt') {
      const m = sel[0], v = await askText(t('Descripción de la foto (alt)'), m.alt, t('Describe la foto para quien no la pueda ver. También ayuda al posicionamiento en buscadores.'));
      if (v === null) return;
      await busy(b, async () => { await window.api.mediaSetAlt(m.id, v); m.alt = v; toast(t('Descripción guardada')); });
      mediaLib.render();
    }
    if (b.dataset.a === 'dates') {
      return busy(b, async () => {
        const known = [], unknown = [];
        for (const m of sel) { const di = mediaLib.dateInfo(m); (di.src ? known : unknown).push({ m, date: di.date }); }
        // sin entrada ni fecha en el nombre: la fecha de captura guardada dentro de la foto
        if (unknown.length) {
          toast(t('Leyendo la fecha de captura de {n} fotos…', { n: unknown.length }));
          const ex = await window.api.mediaExifDates(unknown.map((x) => ({ id: x.m.id, url: x.m.url })));
          for (const x of unknown) if (ex[x.m.id]) known.push({ m: x.m, date: ex[x.m.id] });
        }
        const list = known.filter((x) => String(x.date).slice(0, 10) !== String(x.m.date).slice(0, 10)).map((x) => ({ id: x.m.id, date: x.date }));
        const none = sel.length - known.length;
        const r = list.length ? await window.api.mediaSetDates(list) : { done: 0, failed: 0 };
        toast(t('Fecha original puesta en {n} archivos.', { n: r.done }) + (none ? ' ' + t('{x} no tienen ninguna fecha conocida (ni entrada, ni nombre, ni datos de la cámara).', { x: none }) : '') + (r.failed ? ' ' + t('{e} con error.', { e: r.failed }) : ''), !!r.failed);
        mediaLib.clear(); mediaLib.reload();
      });
    }
    if (b.dataset.a === 'ai') return upscaleSelected(sel.filter((m) => m.type !== 'video'), b);
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

// --- Mejorar fotos con IA (Real-ESRGAN en este ordenador) -----------------------------
const aiIsWindows = () => navigator.userAgent.includes('Windows');
async function upscaleSelected(photos, btn) {
  if (!photos.length) return;
  if (!aiIsWindows()) return void toast(t('Mejorar con IA solo funciona en Windows.'), true);
  let asked = false;
  try { asked = localStorage.getItem('ecosAiEngine') === '1'; } catch { /* sin almacenamiento */ }
  if (!asked) {
    if (!await ask(t('La primera vez se descargará el motor de IA (unos 45 MB, una sola vez). Todo se hace en este ordenador: las fotos no se suben a ningún servicio.'), { ok: t('Continuar') })) return;
    try { localStorage.setItem('ecosAiEngine', '1'); } catch { /* sin almacenamiento */ }
  }
  let changed = 0, entries = 0;
  for (let i = 0; i < photos.length; i++) {
    const r = await upscaleDialog(photos[i], photos.length - i - 1);
    if (r === 'stop') break;
    if (r) { changed++; entries += r.posts; }
  }
  if (changed) {
    toast(t('Foto mejorada y cambiada en {n} entradas.', { n: entries }));
    mediaLib?.clear?.();
    mediaLib?.reload(true);
  }
}
// Un modal por foto: progreso → comparación antes/después. Devuelve {posts} si se aplicó, null si se descartó, 'stop' si se cierra todo.
function upscaleDialog(m, remaining) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'modal mg-ai';
    el.innerHTML = `<div class="modal-box wide"><h2><span class="ms fill modal-icon">auto_fix_high</span>${t('Mejorar con IA')}</h2>
      <p class="hint">${t('La IA amplía la foto y le da nitidez, sin cambiar lo que muestra. Compara antes de usarla.')}</p>
      <div class="ai-busy"><span class="spin"></span><span class="ai-msg">${t('Preparando la foto…')}</span><div class="ai-bar"><i></i></div></div>
      <div class="ai-cmp hidden">
        <div class="ai-ba"><img class="ai-after" alt=""><img class="ai-before" alt=""><span class="ai-line"></span><span class="ai-lbl l">${t('Antes')}</span><span class="ai-lbl r">${t('Después')}</span></div>
        <input type="range" class="ai-range" min="0" max="100" value="50" aria-label="${escHtml(t('Comparar antes y después'))}">
        <div class="hint ai-info"></div>
      </div>
      <div class="modal-actions"><span class="spacer"></span>
        <button class="btn text" data-r="x">${t('Cancelar')}</button>
        <button class="btn text hidden" data-r="next">${t('Siguiente')}</button>
        <button class="btn filled hidden" data-r="use"><span class="ms">check</span>${t('Usar la mejorada')}</button></div></div>`;
    const q = (s) => el.querySelector(s);
    let token = null, gone = false;
    window.api.onUpscaleProgress?.((p) => {
      if (gone || !p) return;
      q('.ai-msg').textContent = t(p.text) + (p.pct != null ? ` ${p.pct} %` : '');
      q('.ai-bar').classList.toggle('on', p.pct != null);
      q('.ai-bar i').style.width = (p.pct || 0) + '%';
    });
    const finish = async (v) => {
      if (gone) return; gone = true;
      el.remove(); document.removeEventListener('keydown', key, true);
      if (token) { try { await window.api.mediaUpscaleDiscard(token); } catch { /* nada */ } }
      resolve(v);
    };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish('stop'); } };
    document.addEventListener('keydown', key, true);
    const setClip = (v) => {
      q('.ai-before').style.clipPath = `inset(0 ${100 - v}% 0 0)`;
      q('.ai-line').style.left = v + '%'; q('.ai-range').value = v;
    };
    q('.ai-range').oninput = (e) => setClip(Number(e.target.value));
    const ba = q('.ai-ba');
    const drag = (e) => { const r = ba.getBoundingClientRect(); setClip(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100))); };
    ba.onpointerdown = (e) => { ba.setPointerCapture(e.pointerId); drag(e); ba.onpointermove = drag; };
    ba.onpointerup = ba.onpointercancel = () => { ba.onpointermove = null; };
    q('[data-r="x"]').onclick = () => finish('stop');
    q('[data-r="next"]').onclick = () => finish(null);
    q('[data-r="use"]').onclick = (e) => busy(e.currentTarget, async () => {
      const r = await window.api.mediaUpscaleApply({ id: m.id, token });
      token = null; // ya consumido
      finish(r);
    });
    document.body.appendChild(el);
    window.api.mediaUpscale(m.id).then((r) => {
      if (gone) { window.api.mediaUpscaleDiscard(r.token).catch(() => {}); return; }
      token = r.token;
      q('.ai-busy').classList.add('hidden'); q('.ai-cmp').classList.remove('hidden');
      q('.ai-before').src = r.before; q('.ai-after').src = r.after;
      q('.ai-info').textContent = `${r.from.width}×${r.from.height} → ${r.to.width}×${r.to.height} · ${fmtBytes(r.bytes)}`;
      q('[data-r="x"]').textContent = t('Descartar');
      q('[data-r="x"]').onclick = () => finish(null);
      q('[data-r="use"]').classList.remove('hidden');
      if (remaining > 0) q('[data-r="next"]').classList.remove('hidden');
      setClip(50);
    }).catch((e) => { if (!gone) { toast(e.message, true); finish('stop'); } });
  });
}

// ---------------------------------------------------------------- Fotos repetidas
async function findDuplicates() {
  toast(t('Buscando fotos repetidas… (la primera vez tarda un poco)'));
  const groups = await window.api.mediaDuplicates();
  const usage = mediaLib?.st.usage || await window.api.mediaUsage(false).catch(() => ({}));
  if (!groups.length) return toast(t('No hay fotos repetidas en la biblioteca.'));
  // Cada grupo: todas sus fotos. Las que se quedan se eligen con un clic (al principio, la de más resolución).
  const items = groups.map((g) => [g.keep, ...g.drop]);
  const kept = groups.map((g) => new Set([g.keep.id]));
  // de las que se quedan, la principal (más resolución) recibe las entradas que usaban las que se borran
  const target = (i) => items[i].filter((m) => kept[i].has(m.id)).sort((x, y) => y.width * y.height - x.width * x.height || (y.size || 0) - (x.size || 0))[0];
  const card = (m, i) => {
    const u = usage?.[m.id] || [], keep = kept[i].has(m.id), main = keep && kept[i].size > 1 && target(i)?.id === m.id;
    return `<button type="button" class="dp-item${keep ? ' keep' : ''}" data-gi="${i}" data-id="${m.id}" title="${escHtml(t('Pulsa para elegir si se queda o se borra'))}"><img src="${escHtml(m.thumb || m.url)}" alt="" loading="lazy">
      <span class="dp-meta"><b>${keep ? (main ? t('Se queda (principal)') : t('Se queda')) : t('Se borra')}</b><span>${m.width}×${m.height} · ${escHtml(fmtBytes(m.size) || '')}</span>
      <span class="mg-tag ${u.length ? 'use' : 'free'}">${u.length ? t('En uso ({n})', { n: u.length }) : t('Sin usar')}</span></span></button>`;
  };
  const row = (i) => `<div class="dp-row">${items[i].map((m) => card(m, i)).join('')}</div>`;
  const d = document.createElement('div');
  d.className = 'dlg-scrim';
  d.innerHTML = `<div class="dlg dp-dlg" role="dialog" aria-modal="true">
    <div class="dp-head"><span class="ms fill">filter_none</span><h2>${t('Fotos repetidas')}</h2></div>
    <p class="hint">${t('Se ha encontrado la misma foto varias veces. Pulsa una foto para cambiar si se queda o se borra (al principio se queda la de más resolución). Las entradas que usaban las que se borran pasan a usar la principal de las que se quedan.')}</p>
    <div class="dp-list">${groups.map((g, i) => `<div class="dp-group"><label class="dp-chk" title="${escHtml(t('Incluir este grupo'))}"><input type="checkbox" data-g="${i}" checked></label><div class="dp-slot" data-slot="${i}">${row(i)}</div></div>`).join('')}</div>
    <div class="dlg-actions"><button class="btn text" data-x>${t('Cancelar')}</button><button class="btn filled" data-ok></button></div></div>`;
  document.body.appendChild(d);
  const ok = d.querySelector('[data-ok]');
  // grupos marcados en los que algo se borra
  const picked = () => [...d.querySelectorAll('[data-g]:checked')].map((c) => Number(c.dataset.g)).filter((i) => items[i].some((m) => !kept[i].has(m.id)));
  const sync = () => { const n = picked().length; ok.disabled = !n; ok.textContent = t('Juntar {n} grupos', { n }); };
  d.querySelectorAll('[data-g]').forEach((c) => (c.onchange = sync)); sync();
  d.querySelector('.dp-list').addEventListener('click', (e) => {
    const b = e.target.closest('.dp-item'); if (!b) return;
    const i = Number(b.dataset.gi), id = Number(b.dataset.id);
    if (kept[i].has(id)) { if (kept[i].size === 1) return toast(t('Al menos una foto de cada grupo tiene que quedarse.'), true); kept[i].delete(id); } else kept[i].add(id);
    d.querySelector(`[data-slot="${i}"]`).innerHTML = row(i);
    sync();
  });
  const close = () => d.remove();
  d.querySelector('[data-x]').onclick = close;
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  ok.onclick = () => busy(ok, async () => {
    const sel = picked().map((i) => ({ keep: target(i).id, drop: items[i].filter((m) => !kept[i].has(m.id)).map((m) => m.id) }));
    if (!await ask(t('Se borrarán {n} fotos repetidas de la biblioteca y las entradas pasarán a usar la principal de las que se quedan. ¿Continuar?', { n: sel.reduce((a, g) => a + g.drop.length, 0) }), { danger: true, ok: t('Juntar') })) return;
    const r = await window.api.mediaMergeDuplicates(sel);
    close();
    toast(t('{d} fotos repetidas borradas; {p} entradas actualizadas.', { d: r.deleted, p: r.posts }) + (r.errors.length ? ' ' + t('{e} con error.', { e: r.errors.length }) : ''), !!r.errors.length);
    mediaLib?.reload(true);
  });
}
