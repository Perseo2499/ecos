// Ecos · Pantalla «Blog»: calendario y lista de entradas y páginas.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- Calendario de publicaciones
// Un mes de un vistazo: publicadas, programadas y borradores en su día; se abren en Ecos o en WordPress.
const calState = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), mode: 'month' };
function renderCalendar() {
  const box = $('#b-calendar');
  const self = CFG.wpMode === 'selfhosted';
  const canDrag = self; // cambiar la fecha solo funciona con WordPress propio
  box.innerHTML = `<div class="cal-layout"><div class="cal-main"></div>
    <aside class="cal-tray${calState.trayOpen === false ? ' closed' : ''}" id="cal-tray">
      <button class="cal-tray-h" id="cal-tray-h" aria-expanded="${calState.trayOpen !== false}"><span class="ms">inbox</span><b>${t('Sin fecha')}</b><span class="cal-tray-n" id="cal-tray-n"></span><span class="ms cal-tray-chev">expand_more</span></button>
      <div class="cal-tray-b">
        <button class="btn tonal small cal-tray-new" id="cal-new"><span class="ms">add</span>${t('Nueva entrada para este mes')}</button>
        <p class="hint cal-tray-hint">${t('Arrastra un borrador a un día para programarlo.')}</p>
        <div class="cal-tray-list" id="cal-tray-list"><p class="hint">${t('Cargando…')}</p></div>
      </div></aside></div>`;
  const main = $('.cal-main', box);
  $('#cal-tray-h').onclick = () => { calState.trayOpen = calState.trayOpen === false; $('#cal-tray').classList.toggle('closed', calState.trayOpen === false); $('#cal-tray-h').setAttribute('aria-expanded', calState.trayOpen !== false); };
  $('#cal-new').onclick = () => newDraft({ type: 'post' });

  const cache = new Map(); // «desde» → entradas de ese tramo (se modifican al arrastrar, sin volver a pedirlas)
  let cur = null, tray = [];
  const mk = (it) => ({ id: it.id, date: it.date, status: it.status, title: decodeEntities(it.title), cls: 'st-' + it.status, thumb: it.image || '',
    badge: it.status === 'future' ? '<span class="ms cal-clk" title="' + escHtml(t('Programada')) + '">schedule</span>' : '',
    draggable: canDrag && ['publish', 'draft', 'future'].includes(it.status) });
  const restyle = (c) => { c.cls = 'st-' + c.status; c.badge = c.status === 'future' ? '<span class="ms cal-clk" title="' + escHtml(t('Programada')) + '">schedule</span>' : ''; };
  const refresh = () => calendarView(main, calState, opts);

  function drawTray() {
    $('#cal-tray-n').textContent = tray.length ? String(tray.length) : '';
    const list = $('#cal-tray-list');
    if (!tray.length) { list.innerHTML = `<p class="hint">${t('No hay borradores.')}</p>`; return; }
    list.innerHTML = '';
    for (const it of tray) {
      const el = document.createElement('div');
      el.className = 'cal-tray-it'; el.draggable = canDrag; el.dataset.id = it.id; el.title = it.title;
      el.innerHTML = `${it.thumb ? `<img src="${escHtml(it.thumb)}" alt="" loading="lazy">` : '<span class="noimg"><span class="ms">image</span></span>'}<span class="cal-t"></span>`;
      $('.cal-t', el).textContent = it.title || t('(sin título)');
      el.onclick = () => busy(el, () => openFromWp(it.id));
      el.ondragstart = (e) => calStartDrag(e, it, el);
      el.ondragend = calEndDrag;
      list.appendChild(el);
    }
  }
  (async () => {
    try {
      const r = await window.api.blogList({ type: 'post', status: 'draft', page: 1, number: 50, orderby: 'modified' });
      tray = r.items.slice().sort((a, b) => new Date(b.modified || 0) - new Date(a.modified || 0))
        .map((it) => ({ id: it.id, status: 'draft', title: decodeEntities(it.title), thumb: it.image || '', fromTray: true, draggable: canDrag }));
      drawTray();
    } catch (e) { $('#cal-tray-list').innerHTML = `<p class="hint">${escHtml(friendlyError(e).text)}</p>`; }
  })();

  const when = (d) => d.toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  async function onDrop(item, day) {
    const list = cache.get(cur) || [];
    const date = calNewDate(item.fromTray ? null : item.date, day);
    const dec = calDropDecision(item.status, date);
    let status = dec.status;
    const name = item.title || t('(sin título)'), d = when(date);
    if (!item.fromTray && date.getTime() === new Date(item.date).getTime()) return;
    if (dec.action === 'confirm') {
      const msg = t('¿Cambiar la fecha de publicación de «{x}» al {d}?', { x: name, d }) + '\n'
        + (status === 'future' ? t('Esa fecha es futura: la entrada pasará a estar programada y dejará de verse hasta entonces.') : t('Cambiará el orden de las entradas en el blog.'));
      if (!(await ask(msg, { ok: t('Cambiar la fecha') }))) return;
    } else if (dec.action === 'past') {
      if (await ask(t('El {d} ya ha pasado. ¿Publicar «{x}» con esa fecha?', { x: name, d }), { ok: t('Publicar con esa fecha'), cancel: t('No publicar') })) status = 'publish';
      else if (await ask(t('¿Dejar «{x}» como borrador con la fecha del {d}?', { x: name, d }), { ok: t('Dejar en borrador'), cancel: t('No mover') })) status = 'draft';
      else return;
    }
    // Cambio al momento en la vista; si WordPress lo rechaza, todo vuelve a su sitio
    const iso = date.toISOString();
    let entry = item, was = null, trayAt = -1;
    if (item.fromTray) {
      trayAt = tray.findIndex((x) => x.id === item.id);
      if (trayAt >= 0) tray.splice(trayAt, 1);
      entry = { id: item.id, title: item.title, thumb: item.thumb, draggable: canDrag, date: iso, status };
      restyle(entry); list.push(entry); drawTray();
    } else {
      was = { date: item.date, status: item.status };
      item.date = iso; item.status = status; restyle(item);
    }
    refresh();
    try {
      await window.api.blogSetDate(entry.id, iso, status);
      toast(status === 'future' ? t('«{x}» programada para el {d}.', { x: name, d }) : status === 'publish' ? t('«{x}» publicada con fecha del {d}.', { x: name, d }) : t('«{x}» queda en borrador con fecha del {d}.', { x: name, d }));
    } catch (e) {
      if (item.fromTray) { list.splice(list.indexOf(entry), 1); tray.splice(Math.max(trayAt, 0), 0, item); drawTray(); }
      else { Object.assign(item, was); restyle(item); }
      refresh();
      toast(t('No se pudo cambiar la fecha: {m}', { m: friendlyError(e).text }), true);
    }
  }

  const opts = {
    legend: `<i class="publish"></i>${t('Publicada')}<i class="future"></i>${t('Programada')}<i class="draft"></i>${t('Borrador')}${canDrag ? `<span class="cal-drag-hint"><span class="ms">drag_indicator</span>${t('Arrastra para cambiar el día')}</span>` : ''}`,
    async load(from, to) {
      const key = from.getTime() + '-' + to.getTime();
      cur = key;
      if (cache.has(key)) return cache.get(key);
      const items = [];
      for (let page = 1; page <= 10; page++) {
        const r = await window.api.blogList({ type: 'post', status: 'any', page, number: 100, after: from.toISOString(), before: to.toISOString() });
        items.push(...r.items);
        if (items.length >= r.found || !r.items.length) break;
      }
      const out = items.map(mk);
      cache.set(key, out);
      return out;
    },
    footer: (items, from, to, year) => (year ? t('{n} entradas en {y} · pulsa un mes para verlo.', { n: items.length, y: from.getFullYear() })
      : t('{n} entradas este mes · pulsa una para editarla en Ecos (con Ctrl, en WordPress).', { n: items.length })),
    onItem: (it, e, b) => busy(b, async () => {
      if (e.ctrlKey || e.metaKey) return window.api.open(await window.api.blogEditUrl(it.id, 'post'));
      await openFromWp(it.id);
    }),
  };
  if (canDrag) {
    opts.onDrop = onDrop;
    opts.onAdd = (day) => newDraft({ type: 'post', scheduleAt: calLocalInput(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0)) });
  }
  return refresh();
}

// ---------------------------------------------------------------- Pestaña Blog
const blog = { loaded: false, type: 'post', page: 1, per: 20, found: 0, problem: null, order: dlOrder('blog'), dates: null, datesSig: '' }; // problem: { kind, ids } = filtro de la «Revisión»
// Línea temporal lateral: los meses salen de las fechas de TODAS las entradas que cumplen los filtros (una petición ligera, aparte de la página que se ve);
// al elegir un mes se calcula en qué página cae, se pide esa página a WordPress y se baja hasta su encabezado.
const blogLane = createDateLane({
  name: 'blog', label: t('Línea temporal del blog'), liveDrag: false,
  isActive: () => $('#tab-blog').classList.contains('active') && ['post', 'page'].includes(blog.type) && !$('#b-list').classList.contains('hidden') && !document.body.classList.contains('editing'),
  stickyEl: () => $('#tab-blog .b-head'), padEl: () => $$('#b-list, #b-listhead, #b-bulk, #b-health'), list: () => $('#b-list'),
  watch: () => [$('#b-list')],
  async jump(key, o) {
    const page = DateLane.pageOfMonth(blogLane.counts(), key, blog.per);
    const sticky = () => $('#tab-blog .b-head');
    if (page !== blog.page || !$(`#b-list [data-dl="${key}"]`)) { blog.page = page; await loadBlog(); dlScrollTo($('#b-list'), key, sticky, false); return; }
    dlScrollTo($('#b-list'), key, sticky, o.smooth);
  },
});
function blogLaneUpdate() {
  const counts = DateLane.countsByMonth(blog.dates || [], blog.order);
  blogLane.update(counts, { order: blog.order });
}
// Pide las fechas de todas las entradas del filtro actual (solo si cambió el filtro o el total)
function loadBlogDates(found) {
  const f = blogFilters();
  const sig = JSON.stringify(f);
  if (sig === blog.datesSig && (blog.datesFound === found || blog.datesBusy)) return;
  blog.datesSig = sig; blog.datesBusy = true; blog.datesFound = found;
  Promise.resolve(window.api.blogDates?.(f)).then((r) => {
    if (blog.datesSig !== sig) return; // se cambió el filtro mientras llegaban
    blog.datesBusy = false;
    blog.dates = Array.isArray(r) ? r : null;
    blogLaneUpdate();
  }).catch(() => { if (blog.datesSig === sig) { blog.datesBusy = false; blog.dates = null; blogLaneUpdate(); } });
}
const STATUS = () => ({ publish: t('Publicada'), draft: t('Borrador'), future: t('Programada'), pending: t('Pendiente'), private: t('Privada'), trash: t('Papelera') });
async function loadBlog() {
  syncMine();
  const list = $('#b-list');
  list.innerHTML = `<p class="hint pad">${t('Cargando…')}</p>`;
  try {
    const r = await window.api.blogList({ ...blogFilters(), page: blog.page, number: blog.per, order: blog.order });
    blog.loaded = true; blog.found = r.found; syncRange(); syncFindBtn();
    renderBlog(r.items); bhSync();
    if (r.cached) list.insertAdjacentHTML('afterbegin', `<p class="hint pad cache-note"><span class="ms">history</span> ${escHtml(Net.cacheNote(r.cached.at))}</p>`);
    loadBlogDates(r.found); blogLane.bind();
  } catch (e) { errBox(list, e, loadBlog); }
}
// Menú emergente «⋯» (accesible con teclado: flechas, Inicio/Fin, Esc; se cierra al pulsar fuera)
let popEl = null;
function closePop(refocus) {
  if (!popEl) return;
  const { el, anchor, off } = popEl; popEl = null; off(); el.remove();
  anchor.setAttribute('aria-expanded', 'false');
  if (refocus) anchor.focus();
}
function openPop(anchor, items) {
  if (popEl && popEl.anchor === anchor) return closePop(true);
  closePop();
  const el = document.createElement('div');
  el.className = 'pop-menu'; el.setAttribute('role', 'menu');
  items.forEach((x) => {
    if (x.sep) { const d = document.createElement('div'); d.className = 'pop-sep'; d.setAttribute('role', 'separator'); el.appendChild(d); return; }
    const b = document.createElement('button');
    b.className = 'pop-it' + (x.danger ? ' danger' : ''); b.setAttribute('role', 'menuitem'); b.tabIndex = -1;
    b.innerHTML = `<span class="ms">${x.icon || ''}</span><span class="pop-l"></span>`;
    b.querySelector('.pop-l').textContent = x.label;
    b.onclick = () => { closePop(false); x.fn(); };
    el.appendChild(b);
  });
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  el.style.top = (r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  const its = () => [...el.querySelectorAll('.pop-it')];
  const down = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(false); };
  const key = (e) => {
    const l = its(), i = l.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); l[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); l[l.length - 1].focus(); }
    else if (e.key === 'Tab') closePop(false);
  };
  const away = () => closePop(false);
  document.addEventListener('mousedown', down, true);
  el.addEventListener('keydown', key);
  window.addEventListener('resize', away); window.addEventListener('scroll', away, true);
  popEl = { el, anchor, off: () => { document.removeEventListener('mousedown', down, true); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); } };
  its()[0]?.focus();
}
// Ejecuta una acción del menú con el botón «⋯» ocupado (y los errores, en un aviso)
async function runPopItem(anchor, fn) {
  anchor.disabled = true; anchor.classList.add('working');
  try { await fn(); } catch (e) { toastError(e); } finally { anchor.disabled = false; anchor.classList.remove('working'); }
}
function renderBlog(items) {
  const list = $('#b-list');
  const pages = Math.max(1, Math.ceil(blog.found / blog.per));
  $('#b-info').textContent = t(blog.type === 'page' ? '{n} páginas · página {p} de {t}' : '{n} entradas · página {p} de {t}', { n: blog.found, p: blog.page, t: pages });
  $('#b-prev').disabled = $('#b-first').disabled = blog.page <= 1; $('#b-next').disabled = $('#b-last').disabled = blog.page >= pages;
  $('#b-goto').max = pages; $('#b-goto').placeholder = String(blog.page);
  if (!items.length) { bItems = []; renderBulk(); list.innerHTML = `<div class="empty"><span class="ms">inbox</span><span>${t('No hay nada con estos filtros.')}</span></div>`; return; }
  list.innerHTML = '';
  // Orden por fecha y encabezados por mes y, si hay varias en el mes, por día
  const groups = DateLane.groupByMonth(items, (x) => x.date, blog.order);
  const flat = [];
  for (const g of groups) for (const d of g.days) for (const x of d.items) flat.push({ it: x, g, d });
  items = flat.map((x) => x.it);
  bItems = items; bLast = -1;
  renderBulk();
  let lastG = null, lastD = null;
  for (const { it, g, d } of flat) {
    if (g !== lastG) { list.appendChild(dlMonthHeader(g)); lastG = g; lastD = null; }
    if (g.showDays && d !== lastD) { list.appendChild(dlDayHeader(d)); lastD = d; }
    const row = document.createElement('div');
    row.className = 'b-row';
    // Fecha de la entrada (también en borradores); la de última modificación queda en el texto emergente
    const when = `<span title="${escHtml(t('Última modificación: {d}', { d: fmtDay(it.modified) }))}">${fmtDay(it.date)}</span>`;
    const fromEcos = Object.values(exported).some((r) => r.postId === it.id);
    const restored = !fromEcos && Object.values(CFG.restored || {}).some((r) => r.postId === it.id);
    row.classList.toggle('ecos-made', fromEcos || restored);
    row.dataset.id = it.id;
    row.classList.toggle('sel', bsel.has(it.id));
    row.innerHTML = `
      <label class="b-check"><input type="checkbox"${bsel.has(it.id) ? ' checked' : ''}></label>
      ${it.image ? `<img src="${escHtml(it.image)}" loading="lazy" alt="">` : `<div class="noimg"><span class="ms">image</span></div>`}
      <div><div class="b-title"></div>
        <div class="b-meta"><span class="st ${escHtml(it.status)}">${STATUS()[it.status] || escHtml(it.status)}</span>${fromEcos ? `<span class="st ecos" title="${t('Entrada creada desde Ecos')}"><img src="assets/logo-mark.svg" alt="">${t('Creada con Ecos')}</span>` : ''}${restored ? `<span class="st restored" title="${t('Recuperada de una copia de seguridad con Ecos')}"><span class="ms">settings_backup_restore</span>${t('Restaurada')}</span>` : ''}${bhChips(it)}${authorHtml(it.author)}${when}${it.categories.length ? ' · ' + escHtml(it.categories.join(', ')) : ''}</div>
        <div class="b-ex"></div></div>
      <div class="b-actions"></div>`;
    const title = decodeEntities(it.title);
    row.querySelector('.b-title').textContent = title;
    // selección (Mayús + clic selecciona un tramo)
    row.querySelector('.b-check input').onclick = (e) => {
      const rows = $$('#b-list .b-row'), idx = rows.indexOf(row);
      const on = e.target.checked;
      const from = e.shiftKey && bLast >= 0 ? Math.min(bLast, idx) : idx, to = e.shiftKey && bLast >= 0 ? Math.max(bLast, idx) : idx;
      for (let k = from; k <= to; k++) { const it2 = bItems[k]; if (on) bsel.set(it2.id, it2); else bsel.delete(it2.id); }
      bLast = idx;
      renderBulk();
    };
    row.querySelector('.b-ex').textContent = decodeEntities(it.excerpt);
    const actions = row.querySelector('.b-actions');
    const btn = (label, fn, cls = 'text') => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label; b.onclick = () => busy(b, fn); actions.appendChild(b);
    };
    const kind = it.type === 'page' ? 'page' : 'post';
    const trashed = it.status === 'trash';
    const doStatus = async (st, msg) => { exported = await window.api.blogSetStatus(it.id, st, it.type); toast(msg); loadBlog(); renderFeed(); };
    // A la vista: la acción principal (Editar en Ecos) y «Ver» si está publicada; el resto, en el menú «⋯»
    // (cualquier entrada se puede editar en Ecos: el HTML antiguo se convierte en bloques)
    if (!trashed) btn(t('Editar'), () => openFromWp(it.id, null, kind), 'tonal');
    else btn(t('Restaurar como borrador'), () => doStatus('draft', t('Restaurada como borrador')), 'tonal');
    if (it.status === 'publish') btn(t('Ver'), async () => window.api.open(it.url));
    const menu = [];
    if (!trashed) menu.push({ icon: 'transform', label: it.type === 'page' ? t('Convertir en página de Ecos') : t('Convertir en entrada de Ecos'), fn: () => openFromWp(it.id, null, kind, { convert: true }) });
    if (!trashed) menu.push({ icon: 'open_in_new', label: t('Editar en WordPress'), fn: async () => window.api.open(await window.api.blogEditUrl(it.id, it.type)) });
    if (!trashed && CFG.wpMode === 'selfhosted') menu.push({ icon: 'content_copy', label: t('Duplicar'), fn: () => duplicateItems([it]) });
    if (['draft', 'pending', 'private'].includes(it.status)) menu.push({ icon: 'public', label: t('Publicar'), fn: async () => {
      if (!await ask(t('¿Publicar «{x}»? Será visible en la web.', { x: title }))) return;
      await doStatus('publish', t('Publicada'));
    } });
    if (it.status === 'publish') menu.push({ icon: 'edit_note', label: t('Pasar a borrador'), fn: async () => {
      if (!await ask(t('¿Retirar «{x}» de la web y dejarla como borrador?', { x: title }), { danger: true })) return;
      await doStatus('draft', t('Ahora es un borrador'));
    } });
    menu.push({ sep: true });
    if (!trashed) menu.push({ icon: 'delete', danger: true, label: t('Papelera'), fn: async () => {
      if (!await ask(t('¿Mover «{x}» a la papelera? Podrás recuperarla durante 30 días.', { x: title }), { danger: true })) return;
      exported = await window.api.blogTrash(it.id, it.type); toast(t('Movida a la papelera')); loadBlog(); renderFeed();
    } });
    // Borrar para siempre (también sin pasar por la papelera); pide confirmación dos veces si está publicada
    menu.push({ icon: 'delete_forever', danger: true, label: t('Borrar definitivamente'), fn: async () => {
      if (!await ask(t('¿Borrar «{x}» definitivamente? Desaparecerá de tu web y de la papelera, y no se podrá recuperar. (Las fotos se quedan en la biblioteca de medios.)', { x: title }), { danger: true, ok: t('Borrar definitivamente') })) return;
      if (it.status === 'publish' && !await ask(t('«{x}» está publicada y visible en la web. ¿Seguro que quieres borrarla para siempre?', { x: title }), { danger: true, ok: t('Sí, borrarla') })) return;
      exported = await window.api.blogDelete(it.id, it.type); toast(t('Borrada definitivamente')); loadBlog(); renderFeed();
    } });
    const more = document.createElement('button');
    more.className = 'btn text icon-only b-more'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-label', t('Más acciones')); more.title = t('Más acciones');
    more.innerHTML = '<span class="ms">more_horiz</span>';
    more.onclick = (e) => { e.stopPropagation(); openPop(more, menu.map((m) => (m.sep ? m : { ...m, fn: () => runPopItem(more, m.fn) }))); };
    actions.appendChild(more);
    list.appendChild(row);
  }
}
$$('#b-type button').forEach((b) => b.onclick = async () => {
  if (blog.type === 'structure' && b.dataset.type !== 'structure' && window.SiteStructure.dirty() && !await ask(t('Tienes cambios de estructura sin guardar. ¿Salir sin guardarlos?'))) return;
  $$('#b-type button').forEach((x) => x.classList.toggle('active', x === b));
  if (b.dataset.type !== 'post') blog.problem = null;
  const st = b.dataset.type === 'structure', cal = b.dataset.type === 'calendar', med = b.dataset.type === 'media';
  // Estructura y Calendario: en lugar de la lista
  $$('#tab-blog .b-filters, #b-status, #tab-blog .field.search, #b-refresh, #b-new-wrap, #b-list, #b-health, #b-health-btn, #b-bulk, #b-listhead, #b-range, #tab-blog .pager').forEach((x) => x.classList.toggle('hidden', st || cal || med));
  $('#b-structure').classList.toggle('hidden', !st);
  $('#b-calendar').classList.toggle('hidden', !cal);
  $('#b-media').classList.toggle('hidden', !med);
  blog.type = b.dataset.type;
  syncFindBtn();
  bsel.clear();
  if (st) return window.SiteStructure.open();
  if (cal) return renderCalendar();
  if (med) return renderMediaLib();
  blog.page = 1; loadBlog();
});
$('#b-status').onchange = () => { blog.page = 1; loadBlog(); };
$('#b-order').value = blog.order;
$('#b-order').onchange = (e) => { blog.order = e.target.value === 'asc' ? 'asc' : 'desc'; dlSetOrder('blog', blog.order); blog.page = 1; loadBlog(); blogLaneUpdate(); };
// «Solo las mías»: solo con web propia y sabiendo quién eres; se recuerda en este ordenador
const mineOn = () => { try { return localStorage.getItem('ecos-only-mine') === '1' && !!CFG.wpMe?.id && CFG.wpMode === 'selfhosted'; } catch { return false; } };
function syncMine() {
  const show = CFG.wpMode === 'selfhosted' && !!CFG.wpMe?.id;
  $('#b-mine-wrap').classList.toggle('hidden', !show || blog.type !== 'post' && blog.type !== 'page');
  $('#b-mine').checked = mineOn();
}
$('#b-mine').onchange = (e) => { try { localStorage.setItem('ecos-only-mine', e.target.checked ? '1' : '0'); } catch { /* sin almacenamiento */ } blog.page = 1; loadBlog(); };
let bTimer; $('#b-search').oninput = () => { clearTimeout(bTimer); bTimer = setTimeout(() => { blog.page = 1; loadBlog(); }, 400); };
$('#b-refresh').onclick = () => { blog.datesFound = -1; loadBlog(); };
$('#b-prev').onclick = () => { blog.page--; loadBlog(); };
$('#b-next').onclick = () => { blog.page++; loadBlog(); };
// «Nueva»: en Entradas, un menú (entrada o página en Ecos, o WordPress); en Páginas, una página nueva directamente
const newMenu = () => $('#b-new-menu');
const closeNewMenu = () => newMenu().classList.add('hidden');
$('#b-new').onclick = (e) => {
  e.stopPropagation();
  if (blog.type === 'page') return newDraft({ type: 'page' });
  newMenu().classList.toggle('hidden');
};
document.addEventListener('click', closeNewMenu);
$$('#b-new-menu [data-new]').forEach((x) => (x.onclick = () => {
  closeNewMenu();
  if (x.dataset.new === 'wp') return openNewInWp();
  newDraft({ type: x.dataset.new });
}));
function openNewInWp() {
  if (CFG.wpMode === 'selfhosted') {
    const base = (CFG.wpUrl || '').replace(/\/$/, '');
    return window.api.open(`${/^https?:/.test(base) ? base : 'https://' + base}/wp-admin/post-new.php${blog.type === 'page' ? '?post_type=page' : ''}`);
  }
  window.api.open(`https://wordpress.com/${blog.type === 'page' ? 'page' : 'post'}/${CFG.wpSite}`);
}

// Duplicar: copia en borrador (mismo contenido, extracto, categorías, etiquetas, imagen destacada o página superior)
async function duplicateItems(items) {
  const done = [], errors = [];
  for (const it of items) {
    try { done.push(await window.api.blogDuplicate(it.id, it.type === 'page' ? 'page' : 'post')); }
    catch (e) { errors.push(`«${decodeEntities(it.title)}»: ${friendlyError(e).text}`); }
  }
  loadBlog();
  if (errors.length) toast(t('{e} con error: {m}', { e: errors.length, m: errors.slice(0, 2).join(' · ') }), true);
  if (done.length === 1 && items.length === 1) {
    toast(t('Copia creada: «{x}». Está como borrador.', { x: '(copia) ' + decodeEntities(items[0].title) }));
    if (await ask(t('¿Abrir la copia en Ecos?'), { ok: t('Abrir en Ecos') })) await openFromWp(done[0].id, null, done[0].type);
  } else if (done.length) toast(t('{n} copias creadas.', { n: done.length }));
}

// --- Selección y acciones en lote --------------------------------------------------
const bsel = new Map(); // id → entrada (se mantiene al cambiar de página)
let bItems = [], bLast = -1;
function renderBulk() {
  const n = bsel.size, bar = $('#b-bulk');
  const listView = blog.type === 'post' || blog.type === 'page'; // la selección solo tiene sentido en la lista de entradas o páginas
  bar.classList.toggle('hidden', !listView || !n); // la barra flotante solo sale con algo seleccionado
  $('#b-listhead').classList.toggle('hidden', !listView || !bItems.length);
  bar.classList.toggle('on', n > 0);
  $$('#b-list .b-row').forEach((r) => { const on = bsel.has(Number(r.dataset.id)); r.classList.toggle('sel', on); const c = r.querySelector('.b-check input'); if (c) c.checked = on; });
  const here = bItems.filter((x) => bsel.has(x.id)).length;
  $('#b-all').checked = here > 0 && here === bItems.length;
  $('#b-all').indeterminate = here > 0 && here < bItems.length;
  $('#b-count').textContent = n ? t('{n} seleccionadas', { n }) : t('Seleccionar');
  const items = [...bsel.values()];
  const has = (f) => items.some(f);
  const acts = [];
  if (n) {
    if (has((i) => ['draft', 'pending', 'private', 'trash'].includes(i.status))) acts.push(['publish', 'public', t('Publicar')]);
    if (has((i) => ['publish', 'future', 'pending', 'private'].includes(i.status))) acts.push(['draft', 'edit_note', t('Pasar a borrador')]);
    if (has((i) => i.status === 'trash')) acts.push(['restore', 'restore_from_trash', t('Restaurar como borrador')]);
    if (blog.type !== 'page' && CFG.wpMode === 'selfhosted') acts.push(['cat-add', 'new_label', t('Añadir categoría')], ['cat-del', 'label_off', t('Quitar categoría')]);
    if (CFG.wpMode === 'selfhosted' && has((i) => i.status !== 'trash')) acts.push(['links', 'link', t('Revisar enlaces')]);
    if (blog.type !== 'page' && has((i) => i.status !== 'trash')) acts.push(['normalize', 'format_paint', t('Normalizar formato')]);
    if (blog.type !== 'page' && CFG.wpMode === 'selfhosted' && has((i) => i.status !== 'trash')) acts.push(['origimg', 'high_quality', t('Recuperar fotos originales')]);
    if (CFG.wpMode === 'selfhosted' && has((i) => i.status !== 'trash')) acts.push(['duplicate', 'content_copy', t('Duplicar')]);
    if (has((i) => i.status !== 'trash')) acts.push(['trash', 'delete', t('Papelera')]);
    acts.push(['delete', 'delete_forever', t('Borrar definitivamente')]);
  }
  $('#b-bulk-actions').innerHTML = acts.map(([k, ic, l]) => `<button class="btn ${k === 'delete' || k === 'trash' ? 'text danger' : 'tonal'} small" data-bulk="${k}"><span class="ms">${ic}</span>${escHtml(l)}</button>`).join('');
  $$('[data-bulk]').forEach((b) => (b.onclick = () => busy(b, () => runBulk(b.dataset.bulk))));
}
$('#b-all').onclick = (e) => { for (const it of bItems) { if (e.target.checked) bsel.set(it.id, it); else bsel.delete(it.id); } renderBulk(); };
$('#b-clear').onclick = () => { bsel.clear(); renderBulk(); };

// Elegir una categoría de la web
async function pickCategory(title) {
  const cats = await window.api.wpCategories();
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    d.innerHTML = `<div class="dlg"><span class="ms fill dlg-ic">label</span><p class="dlg-msg"></p>
      <div class="b-catlist">${cats.map((c) => `<button class="chip" data-n="${escHtml(c.name)}">${escHtml(c.name)}</button>`).join('')}</div>
      <div class="dlg-actions"><button class="btn text" data-x>${t('Cancelar')}</button></div></div>`;
    $('.dlg-msg', d).textContent = title;
    const close = (v) => { d.remove(); resolve(v); };
    $$('[data-n]', d).forEach((b) => (b.onclick = () => close(b.dataset.n)));
    $('[data-x]', d).onclick = () => close(null);
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
    document.body.appendChild(d);
  });
}

async function runBulk(kind) {
  let items = [...bsel.values()];
  const n = items.length;
  if (kind === 'links') return linksBulk(items);
  if (kind === 'duplicate') { items = items.filter((i) => i.status !== 'trash'); bsel.clear(); renderBulk(); return duplicateItems(items); }
  let cat = null;
  if (kind === 'cat-add' || kind === 'cat-del') {
    cat = await pickCategory(kind === 'cat-add' ? t('¿Qué categoría quieres añadir a las {n} entradas?', { n }) : t('¿Qué categoría quieres quitar de las {n} entradas?', { n }));
    if (!cat) return;
  }
  if (kind === 'publish') { items = items.filter((i) => i.status !== 'publish'); if (!await ask(t('¿Publicar {n} entradas? Serán visibles en la web.', { n: items.length }))) return; }
  if (kind === 'draft') { items = items.filter((i) => i.status !== 'draft' && i.status !== 'trash'); if (!await ask(t('¿Pasar {n} entradas a borrador? Dejarán de verse en la web.', { n: items.length }), { danger: true })) return; }
  if (kind === 'restore') items = items.filter((i) => i.status === 'trash');
  if (kind === 'trash') { items = items.filter((i) => i.status !== 'trash'); if (!await ask(t('¿Mover {n} entradas a la papelera? Podrás recuperarlas durante 30 días.', { n: items.length }), { danger: true })) return; }
  if (kind === 'normalize') { items = items.filter((i) => i.status !== 'trash'); if (!await ask(t('Se normalizará el formato de {n} entradas en tu web (bloques de WordPress y formato habitual; el texto no cambia). ¿Continuar?', { n: items.length }))) return; }
  if (kind === 'delete') {
    if (!await ask(t('¿Borrar {n} entradas definitivamente? Desaparecerán de tu web y de la papelera, y no se podrán recuperar. (Las fotos se quedan en la biblioteca de medios.)', { n }), { danger: true, ok: t('Borrar definitivamente') })) return;
    const pub = items.filter((i) => i.status === 'publish').length;
    if (pub && !await ask(t('{n} de ellas están publicadas y visibles en la web. ¿Seguro que quieres borrarlas para siempre?', { n: pub }), { danger: true, ok: t('Sí, borrarlas') })) return;
  }
  if (kind === 'origimg') {
    items = items.filter((i) => i.status !== 'trash');
    // hace falta una copia de seguridad abierta: la de Restaurar o se elige ahora
    let st = await window.api.backupStatus();
    if (!st.open) {
      if (!await ask(t('Para recuperar las fotos originales, elige la copia de seguridad de la que salieron estas entradas (ZIP, XML, SQL o carpeta). Las fotos de Blogger se traen igualmente a tamaño completo.'), { ok: t('Elegir copia') })) return;
      const paths = await window.api.backupPick('files');
      if (!paths) return;
      toast(t('Leyendo la copia de seguridad…'));
      await window.api.backupAnalyze(paths);
      st = await window.api.backupStatus();
    }
    if (!await ask(t('Ecos buscará en la copia «{c}» la foto original de cada imagen de {n} entradas y la pondrá en su lugar, a resolución completa y sin recomprimir. ¿Continuar?', { c: st.name || t('abierta'), n: items.length }), { ok: t('Recuperar fotos') })) return;
    $('#b-count').textContent = t('Recuperando fotos…');
    const r = await window.api.backupRestoreImages(items.map((i) => i.id));
    toast(t('{p} fotos recuperadas en {n} entradas.', { p: r.photos, n: r.done })
      + (r.notFound ? ' ' + t('{x} fotos no están en la copia.', { x: r.notFound }) : '')
      + (r.unmatched ? ' ' + t('{x} entradas no aparecen en la copia.', { x: r.unmatched }) : '')
      + (r.errors.length ? ' ' + t('{e} con error.', { e: r.errors.length }) : ''), r.errors.length > 0);
    bsel.clear(); loadBlog();
    return;
  }
  const errors = [];
  let done = 0;
  const label = $('#b-count');
  // Estado de cada entrada antes de tocarla (para poder deshacer)
  const before = new Map(items.map((i) => [i.id, { id: i.id, type: i.type, status: i.status, cats: [...(i.categories || [])], title: i.title }]));
  const okIds = [];
  if (kind === 'normalize') {
    label.textContent = t('Normalizando {n}…', { n: items.length });
    const r = await window.api.backupNormalize(items.map((i) => i.id));
    done = r.done; errors.push(...r.errors);
  } else {
    for (const it of items) {
      label.textContent = t('{a} de {b}…', { a: done + 1, b: items.length });
      try {
        if (kind === 'publish') exported = await window.api.blogSetStatus(it.id, 'publish', it.type);
        else if (kind === 'draft' || kind === 'restore') exported = await window.api.blogSetStatus(it.id, 'draft', it.type);
        else if (kind === 'trash') exported = await window.api.blogTrash(it.id, it.type);
        else if (kind === 'delete') exported = await window.api.blogDelete(it.id, it.type);
        else if (kind === 'cat-add' || kind === 'cat-del') await window.api.blogCategory(it.id, cat, kind === 'cat-add');
        done++; okIds.push(it.id);
      } catch (e) { errors.push(`«${decodeEntities(it.title)}»: ${friendlyError(e).text}`); }
    }
  }
  const msg = t('Hecho en {n} entradas.', { n: done }) + (errors.length ? ' ' + t('{e} con error: {m}', { e: errors.length, m: errors.slice(0, 2).join(' · ') }) : '')
    + (kind === 'normalize' && done ? ' ' + t('Si no te convence, puedes volver atrás con el Historial de cada entrada.') : '');
  const undo = bulkUndoFor(kind, cat, okIds.map((id) => before.get(id)));
  toast(msg, errors.length > 0, undo ? { action: { label: t('Deshacer'), onClick: undo }, duration: 8000 } : undefined);
  bsel.clear();
  loadBlog(); renderFeed();
  if (['cat-add', 'cat-del', 'trash', 'delete', 'restore'].includes(kind)) bhRefresh(true);
}
// Deshacer una acción en lote: devuelve la función que revierte, o null si esa acción no se puede deshacer así
// (borrar definitivamente y normalizar no). snap = estado anterior de cada entrada que se cambió.
function bulkUndoFor(kind, cat, snap) {
  if (!snap.length || !['trash', 'draft', 'publish', 'restore', 'cat-add', 'cat-del'].includes(kind)) return null;
  return async () => {
    const errs = []; let n = 0;
    for (const s of snap) {
      try {
        if (kind === 'cat-add') { if (!s.cats.includes(cat)) await window.api.blogCategory(s.id, cat, false); }
        else if (kind === 'cat-del') { if (s.cats.includes(cat)) await window.api.blogCategory(s.id, cat, true); }
        else if (kind === 'restore' || s.status === 'trash') exported = await window.api.blogTrash(s.id, s.type);
        else exported = await window.api.blogSetStatus(s.id, s.status, s.type);
        n++;
      } catch (e) { errs.push(`«${decodeEntities(s.title)}»: ${friendlyError(e).text}`); }
    }
    toast(t('Deshecho en {n} entradas.', { n }) + (errs.length ? ' ' + t('{e} con error: {m}', { e: errs.length, m: errs.slice(0, 2).join(' · ') }) : ''), errs.length > 0);
    loadBlog(); renderFeed(); bhRefresh(true);
  };
}

// ---------------------------------------------------------------- Buscar y reemplazar en todo el blog (WordPress propio)
const bfr = { results: [], query: '', type: 'post' };
function syncFindBtn() { $('#b-find').classList.toggle('hidden', CFG.wpMode !== 'selfhosted' || blog.type === 'structure' || blog.type === 'calendar' || blog.type === 'media'); }
const bfrOpts = () => ({ caseSensitive: $('#bfr-case').checked, wholeWord: $('#bfr-word').checked });
function bfrOpen() {
  $('#bfr-scope [value="sel"]').disabled = !bsel.size;
  $('#bfr-scope [value="sel"]').textContent = bsel.size ? t('Solo las seleccionadas') + ` (${bsel.size})` : t('Solo las seleccionadas');
  $('#bfr-scope').value = bsel.size ? 'sel' : blog.type === 'page' ? 'page' : 'post';
  $('#bfr-res').innerHTML = ''; $('#bfr-apply').classList.add('hidden'); bfr.results = [];
  $('#bfr-modal').classList.remove('hidden'); $('#bfr-q').focus();
}
const bfrClose = () => $('#bfr-modal').classList.add('hidden');
function bfrMark(s) { return escHtml(s.before) + '<mark>' + escHtml(s.match) + '</mark>' + escHtml(s.after); }
function bfrRender() {
  const box = $('#bfr-res'), rs = bfr.results;
  if (!rs.length) { box.innerHTML = `<p class="hint pad">${t('No se ha encontrado ese texto.')}</p>`; $('#bfr-apply').classList.add('hidden'); return; }
  box.innerHTML = rs.map((r, k) => `<label class="bfr-item"><input type="checkbox" data-k="${k}" checked>
    <div><div class="bfr-t">${escHtml(r.title)}</div>
    <div class="bfr-m">${escHtml(STATUS()[r.status] || r.status)} · ${t(r.count === 1 ? '1 coincidencia' : '{n} coincidencias', { n: r.count })}</div>
    ${r.snippets.map((s) => `<div class="bfr-s">${bfrMark(s)}</div>`).join('')}</div></label>`).join('');
  $$('input', box).forEach((c) => (c.onchange = bfrCount));
  bfrCount();
}
const bfrChecked = () => $$('#bfr-res input:checked').map((c) => bfr.results[Number(c.dataset.k)]);
function bfrCount() {
  const n = bfrChecked().length, b = $('#bfr-apply');
  b.classList.remove('hidden'); b.disabled = !n;
  b.textContent = t('Reemplazar en {n} entradas', { n });
}
$('#b-find').onclick = bfrOpen;
$('#bfr-close').onclick = bfrClose;
$('#bfr-modal').addEventListener('keydown', (e) => { if (e.key === 'Escape') bfrClose(); if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') $('#bfr-go').click(); });
$('#bfr-go').onclick = (e) => busy(e.currentTarget, async () => {
  const query = $('#bfr-q').value;
  if (!query.trim()) throw new Error(t('Escribe el texto que quieres buscar'));
  const sc = $('#bfr-scope').value;
  bfr.query = query; bfr.type = sc === 'page' ? 'page' : 'post';
  const r = await window.api.blogFindText({ query, opts: bfrOpts(), type: bfr.type, ids: sc === 'sel' ? [...bsel.keys()] : undefined });
  bfr.results = r.results; bfrRender();
});
$('#bfr-apply').onclick = (e) => busy(e.currentTarget, async () => {
  const sel = bfrChecked(), n = sel.length, rep = $('#bfr-r').value;
  if (!n) return;
  if (!await ask(t('¿Reemplazar «{a}» por «{b}» en {n} entradas? Se guardará directamente en tu web y no se puede deshacer desde Ecos.', { a: bfr.query, b: rep, n }), { danger: true, ok: t('Reemplazar') })) return;
  const r = await window.api.blogReplaceText({ query: bfr.query, replacement: rep, opts: bfrOpts(), ids: sel.map((x) => x.id), type: bfr.type });
  bfrClose();
  toast(r.errors.length ? t('{n} entradas cambiadas; {e} con error', { n: r.done, e: r.errors.length }) : t('{n} entradas cambiadas', { n: r.done }), !!r.errors.length);
  loadBlog();
});

// ---------------------------------------------------------------- Filtro por fechas y «seleccionar todas»
// Los filtros actuales de la lista (estado, búsqueda y periodo) para pedírselos a WordPress
function blogFilters() {
  const f = { type: blog.type, status: $('#b-status').value, search: $('#b-search').value.trim() };
  if (mineOn() && CFG.wpMe?.id) f.author = CFG.wpMe.id; // «Solo las mías»
  if (blog.problem && blog.type === 'post') f.include = blog.problem.ids;
  const from = $('#b-from').value, to = $('#b-to').value;
  if (from) f.after = new Date(from + 'T00:00:00').toISOString();
  if (to) { const d = new Date(to + 'T00:00:00'); d.setDate(d.getDate() + 1); f.before = d.toISOString(); }
  return f;
}
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
// Años sueltos en el desplegable (del actual hacia atrás), para llegar rápido a entradas antiguas
(() => {
  const sel = $('#b-preset'), y = new Date().getFullYear();
  const custom = sel.querySelector('[value="custom"]');
  for (let k = y - 1; k >= 2005; k--) { const o = document.createElement('option'); o.value = 'y' + k; o.textContent = String(k); sel.insertBefore(o, custom); }
})();
function applyPreset(v) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  let from = '', to = '';
  if (v === 'month') { from = isoDay(new Date(y, m, 1)); to = isoDay(now); }
  else if (v === 'lastmonth') { from = isoDay(new Date(y, m - 1, 1)); to = isoDay(new Date(y, m, 0)); }
  else if (v === '3m') { from = isoDay(new Date(y, m - 2, 1)); to = isoDay(now); }
  else if (v === 'year') { from = isoDay(new Date(y, 0, 1)); to = isoDay(now); }
  else if (/^y\d{4}$/.test(v)) { const k = Number(v.slice(1)); from = `${k}-01-01`; to = `${k}-12-31`; }
  if (v !== 'custom') { $('#b-from').value = from; $('#b-to').value = to; }
  else { $('#b-dates').classList.remove('hidden'); if (!$('#b-from').value) $('#b-from').focus(); }
}
function syncRange() {
  const on = !!($('#b-from').value || $('#b-to').value);
  $('#b-range').classList.toggle('active', on);
  $('#b-range-clear').classList.toggle('hidden', !on);
  $('#b-dates').classList.toggle('hidden', $('#b-preset').value !== 'custom'); // las dos fechas solo con «De una fecha a otra…»
  $('#b-selrange-l').textContent = blog.found ? t(on ? 'Seleccionar las {n} de estas fechas' : 'Seleccionar las {n}', { n: blog.found }) : t('Seleccionar todas');
  $('#b-selrange').disabled = !blog.found;
}
const reloadRange = () => { blog.page = 1; syncRange(); loadBlog(); };
$('#b-preset').onchange = (e) => { applyPreset(e.target.value); reloadRange(); };
$$('#b-from, #b-to').forEach((i) => (i.onchange = () => { $('#b-preset').value = $('#b-from').value || $('#b-to').value ? 'custom' : 'all'; reloadRange(); }));
$('#b-range-clear').onclick = () => { $('#b-preset').value = 'all'; $('#b-from').value = ''; $('#b-to').value = ''; reloadRange(); };
// Selecciona todas las entradas que cumplen los filtros (de todas las páginas, no solo la que se ve)
$('#b-selrange').onclick = (e) => busy(e.currentTarget, async () => {
  const f = blogFilters();
  let n = 0;
  for (let page = 1; page <= 50; page++) {
    const r = await window.api.blogList({ ...f, page, number: 100 });
    for (const it of r.items) { bsel.set(it.id, it); n++; }
    if (n >= r.found || !r.items.length) break;
  }
  renderBulk();
  toast(t('{n} entradas seleccionadas', { n }));
});

// ---------------------------------------------------------------- Saltar de página
const blogPages = () => Math.max(1, Math.ceil(blog.found / blog.per));
function goToPage(n) {
  const p = Math.min(blogPages(), Math.max(1, Math.round(Number(n) || 1)));
  $('#b-goto').value = '';
  if (p === blog.page) return;
  blog.page = p; loadBlog();
  $('#b-list').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
$('#b-first').onclick = () => goToPage(1);
$('#b-last').onclick = () => goToPage(blogPages());
$('#b-go').onclick = () => { if ($('#b-goto').value) goToPage($('#b-goto').value); };
$('#b-goto').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value) goToPage(e.target.value); };
$('#b-per').onchange = (e) => {
  // se mantiene a la vista la primera entrada de la página actual
  const first = (blog.page - 1) * blog.per;
  blog.per = Number(e.target.value); blog.page = Math.floor(first / blog.per) + 1; loadBlog();
};

// ---------------------------------------------------------------- Revisión: entradas sin categoría o sin imagen destacada
// Panel plegable sobre la lista de Entradas (WordPress propio). Cuenta en toda la web (no solo en la página visible),
// con «Ver» (filtra la lista), «Seleccionar todas» y arreglos rápidos (categoría, sugerencia con IA, primera foto).
const bh = { data: null, loading: false, err: '' };
const bhOn = () => blog.type === 'post' && CFG.wpMode === 'selfhosted';
const bhPref = () => { try { const v = localStorage.getItem('ecos.bh.open'); return v === null ? null : v === '1'; } catch { return bh.openMem ?? null; } };
const bhTitle = (x) => decodeEntities(x.title || '');
// Chips de aviso de cada fila de la lista
function bhChips(it) {
  if (!bhOn() || it.status === 'trash') return '';
  let h = '';
  if (BlogCheck.isUncategorized(it.categories)) h += `<span class="st warn" title="${escHtml(t('Esta entrada no tiene categoría'))}"><span class="ms">label_off</span>${t('Sin categoría')}</span>`;
  if (!it.image && !it.featured) h += `<span class="st warn" title="${escHtml(t('Esta entrada no tiene imagen destacada'))}"><span class="ms">image_not_supported</span>${t('Sin imagen')}</span>`;
  return h;
}
function bhSync() {
  $('#b-health-btn').classList.toggle('hidden', !bhOn());
  if (!bhOn()) { $('#b-health').classList.add('hidden'); return; }
  if (!bh.data && !bh.loading) return bhRefresh(false);
  bhRender();
}
const bhIds = (kind) => (bh.data ? (kind === 'nocat' ? bh.data.noCat : bh.data.noImg).map((x) => x.id) : []);
async function bhRefresh(force) {
  if (!bhOn() || bh.loading) return;
  bh.loading = true; bh.err = ''; bhRender();
  try { const r = await window.api.blogHealth(!!force); bh.data = { total: 0, at: Date.now(), ...(r || {}), noCat: r?.noCat || [], noImg: r?.noImg || [] }; } catch (e) { bh.err = friendlyError(e).text; }
  bh.loading = false; bhRender();
  // si la lista está filtrada por un aviso, se pone al día
  if (blog.problem && bh.data) {
    const ids = bhIds(blog.problem.kind);
    if (ids.join() !== blog.problem.ids.join()) { blog.problem = ids.length ? { kind: blog.problem.kind, ids } : null; blog.page = 1; loadBlog(); }
  }
}
function bhRender() {
  const box = $('#b-health');
  if (!bhOn()) return;
  const d = bh.data;
  const nc = d ? d.noCat.length : 0, ni = d ? d.noImg.length : 0, np = d ? d.noImg.filter((x) => x.photo).length : 0;
  const ok = !!d && !nc && !ni;
  const pref = bhPref();
  const open = !!pref; // el panel se despliega con el botón «Revisión» de la cabecera
  box.classList.toggle('ok', ok); box.classList.toggle('open', open); box.classList.toggle('busy', bh.loading);
  box.classList.toggle('hidden', !open);
  const hb = $('#b-health-btn'), badge = $('#b-health-badge'), nw = nc + ni;
  hb.setAttribute('aria-expanded', open ? 'true' : 'false'); hb.classList.toggle('open', open); hb.classList.toggle('has-warn', !!d && !ok); hb.classList.toggle('busy', bh.loading);
  badge.classList.toggle('hidden', !d || ok); badge.textContent = nw > 99 ? '99+' : String(nw);
  hb.title = !d ? t('Comprobando todas las entradas…') : ok ? t('Todo en orden · {n} entradas revisadas', { n: d.total }) : t('{n} avisos en la revisión', { n: nw });
  const sum = bh.loading && !d ? t('Comprobando todas las entradas…')
    : bh.err ? t('No se ha podido comprobar: {m}', { m: bh.err })
    : ok ? t('Todo en orden · {n} entradas revisadas', { n: d.total })
    : [nc ? t(nc === 1 ? '1 sin categoría' : '{n} sin categoría', { n: nc }) : '', ni ? t(ni === 1 ? '1 sin imagen destacada' : '{n} sin imagen destacada', { n: ni }) : ''].filter(Boolean).join(' · ');
  const when = d ? t('Comprobado a las {h}', { h: new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : '';
  const row = (kind, icon, label, acts) => `<div class="bh-row"><span class="ms">${icon}</span><span class="bh-t">${label}</span><span class="bh-acts">
    <button class="btn text small" data-bh="view" data-k="${kind}"><span class="ms">filter_alt</span>${t('Ver')}</button>
    <button class="btn text small" data-bh="all" data-k="${kind}"><span class="ms">select_all</span>${t('Seleccionar todas')}</button>${acts}</span></div>`;
  const small = (k, ic, l) => `<button class="btn tonal small" data-bh="${k}"><span class="ms">${ic}</span>${escHtml(l)}</button>`;
  let body = '';
  if (d && nc) body += row('nocat', 'label_off', `<b>${nc}</b> ${t(nc === 1 ? 'entrada sin categoría' : 'entradas sin categoría')}`,
    small('catadd', 'new_label', t('Añadir categoría')) + (CFG.aiConfigured ? small('ai', 'auto_awesome', t('Sugerir con IA')) : ''));
  if (d && ni) body += row('noimg', 'image_not_supported', `<b>${ni}</b> ${t(ni === 1 ? 'entrada sin imagen destacada' : 'entradas sin imagen destacada')}`
    + (np ? ` <span class="hint">${t(np === 1 ? '(1 tiene fotos en el contenido)' : '({n} tienen fotos en el contenido)', { n: np })}</span>` : ''),
    np ? small('photo', 'add_photo_alternate', t('Poner la primera foto como destacada')) : '');
  const filt = blog.problem ? `<div class="bh-filter"><span class="ms">filter_alt</span>${t('Mostrando solo: {x}', { x: blog.problem.kind === 'nocat' ? t('sin categoría') : t('sin imagen destacada') })}
    <button class="btn text small" data-bh="unfilter">${t('Quitar filtro')}</button></div>` : '';
  box.innerHTML = `<div class="bh-head" data-bh="toggle"><span class="ms">${ok ? 'task_alt' : 'fact_check'}</span><b>${t('Revisión')}</b><span class="bh-sum">${escHtml(sum)}</span><span class="spacer"></span>
      <button class="btn text small" data-bh="reco"><span class="ms">category</span>${t('Recomendar categorías')}</button>
      <button class="btn text icon-only" data-bh="reload" title="${escHtml(t('Volver a comprobar') + (when ? ' · ' + when : ''))}"><span class="ms">refresh</span></button>
      <span class="ms bh-chev">expand_more</span></div>${filt}${body ? `<div class="bh-body">${body}</div>` : ''}`;
}
function bhToggle() {
  const open = !bhPref();
  bh.openMem = open;
  try { localStorage.setItem('ecos.bh.open', open ? '1' : '0'); } catch { /* sin almacenamiento */ }
  bhRender();
  if (open) $('#b-health').scrollIntoView?.({ block: 'nearest' });
}
$('#b-health-btn').onclick = bhToggle;
$('#b-health').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bh]');
  if (!b) return;
  const k = b.dataset.bh;
  if (k === 'toggle') { if (e.target.closest('button')) return; return bhToggle(); }
  if (k === 'reload') return busy(b, () => bhRefresh(true));
  if (k === 'view') { blog.problem = { kind: b.dataset.k, ids: bhIds(b.dataset.k) }; blog.page = 1; bsel.clear(); return loadBlog(); }
  if (k === 'unfilter') { blog.problem = null; blog.page = 1; return loadBlog(); }
  if (k === 'all') return bhSelectAll(b.dataset.k);
  if (k === 'catadd') return busy(b, () => { bhSelectTarget('nocat'); return runBulk('cat-add'); });
  if (k === 'ai') return busy(b, bhSuggest);
  if (k === 'photo') return busy(b, bhPhotos);
  if (k === 'reco') return busy(b, bhRecommend);
});
const bhEntry = (x) => bsel.get(x.id) || { id: x.id, type: 'post', status: x.status, title: x.title, date: x.date, categories: [], excerpt: '' };
function bhSelectAll(kind) {
  for (const x of kind === 'nocat' ? bh.data.noCat : bh.data.noImg) bsel.set(x.id, bhEntry(x));
  renderBulk();
  toast(t('{n} entradas seleccionadas', { n: bsel.size }));
}
// Entradas sobre las que actuar: las seleccionadas de ese aviso, o todas las del aviso si no hay ninguna seleccionada
function bhTarget(kind, onlyPhoto) {
  const list = (kind === 'nocat' ? bh.data.noCat : bh.data.noImg).filter((x) => !onlyPhoto || x.photo);
  const sel = list.filter((x) => bsel.has(x.id));
  return sel.length ? sel : list;
}
function bhSelectTarget(kind) {
  const tg = bhTarget(kind);
  bsel.clear();
  for (const x of tg) bsel.set(x.id, bhEntry(x));
  renderBulk();
}
// Diálogo propio (mismas clases que ask())
function bhDialog(html, cls = '') {
  const d = document.createElement('div');
  d.className = 'dlg-scrim';
  d.innerHTML = `<div class="dlg bh-dlg ${cls}">${html}</div>`;
  document.body.appendChild(d);
  const close = () => { d.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  return { el: d, close };
}
// Asigna categorías (se AÑADEN a las que ya tiene la entrada). jobs: [{ id, names: [] }]
async function bhApplyCats(jobs, btn) {
  const total = jobs.reduce((n, j) => n + j.names.length, 0);
  let k = 0, done = 0; const errors = [];
  for (const j of jobs) for (const name of j.names) {
    if (btn) btn.textContent = t('{a} de {b}…', { a: ++k, b: total });
    try { await window.api.blogCategory(j.id, name, true); done++; } catch (e) { errors.push(`${j.id}: ${friendlyError(e).text}`); }
  }
  return { done, errors };
}
const bhSummary = (msg, errors) => toast(msg + (errors.length ? ' ' + t('{e} con error: {m}', { e: errors.length, m: errors.slice(0, 2).join(' · ') }) : ''), errors.length > 0);

// --- Sugerir categorías con IA (solo entre las que ya existen) ---
async function bhSuggest() {
  const tg = bhTarget('nocat');
  if (!tg.length) return;
  const sugs = await window.api.blogSuggestCategories(tg.map((x) => x.id));
  const cats = (await window.api.wpCategories()).map((c) => c.name).filter((n) => !BlogCheck.isDefaultCat(n));
  const rows = sugs.map((s) => ({ id: s.id, title: s.title || (tg.find((x) => x.id === s.id) || {}).title, names: [...s.categories], on: s.categories.length > 0 }));
  const dlg = bhDialog(`<span class="ms fill dlg-ic">auto_awesome</span><p class="dlg-msg">${t('Categorías sugeridas por la IA')}</p>
    <p class="hint">${t('Revisa las sugerencias: quita o cambia las categorías y desmarca las entradas que no quieras tocar. Solo se usan categorías que ya existen.')}</p>
    <div class="bh-rv"></div><div class="dlg-actions"><button class="btn text" data-x>${t('Cancelar')}</button><button class="btn filled" data-ok></button></div>`, 'wide');
  const list = $('.bh-rv', dlg.el), ok = $('[data-ok]', dlg.el);
  const count = () => { const n = rows.filter((r) => r.on && r.names.length).length; ok.disabled = !n; ok.textContent = t('Aplicar a {n} entradas', { n }); };
  const draw = () => {
    list.innerHTML = rows.map((r, i) => `<div class="bh-rv-row" data-i="${i}"><input type="checkbox"${r.on ? ' checked' : ''}>
      <span class="bh-rv-t">${escHtml(decodeEntities(r.title || ''))}</span>
      <span class="bh-rv-c">${r.names.map((n, j) => `<span class="chip bh-chip">${escHtml(n)}<button data-rm="${j}" title="${escHtml(t('Quitar'))}"><span class="ms">close</span></button></span>`).join('')}
        <select data-add><option value="">${t('+ Categoría')}</option>${cats.filter((c) => !r.names.includes(c)).map((c) => `<option>${escHtml(c)}</option>`).join('')}</select></span></div>`).join('');
    count();
  };
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; const r = rows[Number(b.closest('.bh-rv-row').dataset.i)]; r.names.splice(Number(b.dataset.rm), 1); if (!r.names.length) r.on = false; draw(); });
  list.addEventListener('change', (e) => {
    const r = rows[Number(e.target.closest('.bh-rv-row').dataset.i)];
    if (e.target.matches('[data-add]')) { if (e.target.value) { r.names.push(e.target.value); r.on = true; } draw(); }
    else { r.on = e.target.checked; count(); }
  });
  $('[data-x]', dlg.el).onclick = dlg.close;
  ok.onclick = () => busy(ok, async () => {
    const jobs = rows.filter((r) => r.on && r.names.length).map((r) => ({ id: r.id, names: r.names }));
    const r = await bhApplyCats(jobs, ok);
    dlg.close(); bsel.clear();
    bhSummary(t('Categorías asignadas: {n}.', { n: r.done }), r.errors);
    loadBlog(); bhRefresh(true);
  });
  draw();
}

// --- Primera foto del contenido como destacada ---
async function bhPhotos() {
  const tg = bhTarget('noimg', true);
  if (!tg.length) return toast(t('Ninguna de estas entradas tiene fotos en el contenido.'));
  if (!await ask(t('Ecos pondrá la primera foto del contenido como imagen destacada de {n} entradas. La foto se queda también en el texto. ¿Continuar?', { n: tg.length }), { ok: t('Poner como destacada') })) return;
  const r = await window.api.blogAutoFeatured(tg.map((x) => x.id));
  bsel.clear();
  bhSummary(t('{n} entradas con imagen destacada.', { n: r.done.length }) + (r.skipped.length ? ' ' + t('{x} sin cambios.', { x: r.skipped.length }) : ''), r.errors);
  loadBlog(); bhRefresh(true);
}

// --- Recomendar categorías a partir del contenido (algoritmo propio; con IA se afina) ---
async function bhRecommend() {
  const r = await window.api.blogRecommendCategories();
  if (!r.proposals.length) return toast(t('No he encontrado temas con suficientes entradas para proponer categorías.'));
  const reco = { orig: r.proposals, props: [] };
  const load = (list) => { reco.props = list.map((p) => ({ ...p, on: true, sel: new Set(p.posts.map((x) => x.id)) })); };
  load(r.proposals);
  const dlg = bhDialog(`<span class="ms fill dlg-ic">category</span><p class="dlg-msg">${t('Categorías recomendadas')}</p>
    <p class="hint bh-reco-info"></p><div class="bh-cards"></div>
    <div class="dlg-actions"><button class="btn text" data-x>${t('Cancelar')}</button>${CFG.aiConfigured ? `<button class="btn tonal" data-ai><span class="ms">auto_awesome</span>${t('Afinar con IA')}</button>` : ''}<button class="btn filled" data-ok></button></div>`, 'wide');
  const cards = $('.bh-cards', dlg.el), ok = $('[data-ok]', dlg.el);
  const count = () => {
    const ps = reco.props.filter((p) => p.on && p.name.trim() && p.sel.size);
    const n = new Set(ps.flatMap((p) => [...p.sel])).size;
    ok.disabled = !ps.length; ok.textContent = t('Crear y asignar ({n} entradas)', { n });
    $('.bh-reco-info', dlg.el).textContent = t('Analizadas {n} entradas · {m} propuestas. Cambia nombres, desmarca lo que no quieras y pulsa «Crear y asignar». Las categorías se añaden a las que ya tienen las entradas.', { n: r.total, m: reco.props.length });
  };
  const draw = () => {
    cards.innerHTML = reco.props.map((p, i) => `<div class="bh-card" data-i="${i}">
      <div class="bh-card-h"><input type="checkbox" data-on${p.on ? ' checked' : ''}><input type="text" class="bh-name" value="${escHtml(p.name)}">
        <span class="st ${p.isNew ? 'new' : 'ex'}">${p.isNew ? t('Nueva') : t('Existente')}</span></div>
      <div class="bh-kw">${p.keywords.slice(0, 6).map((k) => `<span class="chip bh-chip">${escHtml(k)}</span>`).join('')}</div>
      <div class="bh-posts">${p.posts.map((x) => `<label><input type="checkbox" data-p="${x.id}"${p.sel.has(x.id) ? ' checked' : ''}><span>${escHtml(decodeEntities(x.title))}</span></label>`).join('')}</div></div>`).join('');
    count();
  };
  cards.addEventListener('input', (e) => { if (e.target.matches('.bh-name')) { reco.props[Number(e.target.closest('.bh-card').dataset.i)].name = e.target.value; count(); } });
  cards.addEventListener('change', (e) => {
    const p = reco.props[Number(e.target.closest('.bh-card').dataset.i)];
    if (e.target.matches('[data-on]')) p.on = e.target.checked;
    else if (e.target.matches('[data-p]')) { const id = Number(e.target.dataset.p); if (e.target.checked) p.sel.add(id); else p.sel.delete(id); }
    count();
  });
  $('[data-x]', dlg.el).onclick = dlg.close;
  const aiBtn = $('[data-ai]', dlg.el);
  if (aiBtn) aiBtn.onclick = () => busy(aiBtn, async () => { load(await window.api.blogRefineCategories(reco.orig)); draw(); });
  ok.onclick = () => busy(ok, async () => {
    const ps = reco.props.filter((p) => p.on && p.name.trim() && p.sel.size);
    const cats = await window.api.wpCategories();
    let created = 0, assigned = 0; const errors = [];
    for (const p of ps) {
      let name = p.name.trim();
      const ex = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (ex) name = ex.name;
      else {
        try { await window.api.siteCreateCategory({ name }); cats.push({ name }); created++; } catch (e) { errors.push(`«${name}»: ${friendlyError(e).text}`); continue; }
      }
      const r2 = await bhApplyCats([...p.sel].map((id) => ({ id, names: [name] })), ok);
      assigned += r2.done; errors.push(...r2.errors);
    }
    dlg.close();
    bhSummary(t('{c} categorías creadas y {n} asignaciones hechas.', { c: created, n: assigned }), errors);
    loadBlog(); bhRefresh(true);
  });
  draw();
}
