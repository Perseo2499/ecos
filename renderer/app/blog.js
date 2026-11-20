// Ecos · Pantalla «Blog»: calendario y lista de entradas y páginas.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- Calendario de publicaciones
// Un mes de un vistazo: publicadas, programadas y borradores en su día; se abren en Ecos o en WordPress.
const calState = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1) };
async function renderCalendar() {
  const box = $('#b-calendar');
  const m = calState.month, y = m.getFullYear(), mo = m.getMonth();
  const loc = prefs().lang === 'en' ? 'en-GB' : 'es-ES';
  const first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0);
  box.innerHTML = `<div class="cal-bar">
      <button class="btn text icon-only" data-c="-1"><span class="ms">chevron_left</span></button>
      <b class="cal-title">${escHtml(first.toLocaleDateString(loc, { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()))}</b>
      <button class="btn text icon-only" data-c="1"><span class="ms">chevron_right</span></button>
      <button class="btn text" data-c="0">${t('Hoy')}</button>
      <span class="spacer"></span>
      <span class="cal-legend"><i class="publish"></i>${t('Publicada')}<i class="future"></i>${t('Programada')}<i class="draft"></i>${t('Borrador')}</span>
    </div><div class="cal-grid"><p class="hint pad">${t('Cargando…')}</p></div>`;
  $$('[data-c]', box).forEach((b) => (b.onclick = () => { const d = Number(b.dataset.c); calState.month = d ? new Date(y, mo + d, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCalendar(); }));
  let items = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await window.api.blogList({ type: 'post', status: 'any', page, number: 100, after: new Date(y, mo, 1).toISOString(), before: new Date(y, mo + 1, 1).toISOString() });
      items.push(...r.items);
      if (items.length >= r.found || !r.items.length) break;
    }
  } catch (e) { $('.cal-grid', box).innerHTML = `<div class="empty"><span class="ms">cloud_off</span><span>${escHtml(e.message)}</span></div>`; return; }
  if (calState.month !== m) return; // se cambió de mes mientras cargaba
  const byDay = new Map();
  for (const it of items) { const d = new Date(it.date); if (d.getMonth() !== mo) continue; const k = d.getDate(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(it); }
  const weekdays = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(loc, { weekday: 'short' })); // lunes primero
  const lead = (first.getDay() + 6) % 7, today = new Date();
  let cells = weekdays.map((w) => `<div class="cal-wd">${escHtml(w)}</div>`).join('');
  for (let i = 0; i < lead; i++) cells += '<div class="cal-day out"></div>';
  for (let d = 1; d <= last.getDate(); d++) {
    const list = (byDay.get(d) || []).sort((a, b) => new Date(a.date) - new Date(b.date));
    const isToday = today.getFullYear() === y && today.getMonth() === mo && today.getDate() === d;
    cells += `<div class="cal-day ${isToday ? 'today' : ''}"><span class="cal-n">${d}</span>${list.slice(0, 4).map((it) => `<button class="cal-item st-${escHtml(it.status)}" data-id="${it.id}" title="${escHtml(decodeEntities(it.title))} · ${escHtml(STATUS()[it.status] || it.status)}">${escHtml(decodeEntities(it.title))}</button>`).join('')}${list.length > 4 ? `<span class="cal-more">+${list.length - 4}</span>` : ''}</div>`;
  }
  $('.cal-grid', box).innerHTML = cells;
  $('.cal-grid', box).insertAdjacentHTML('afterend', `<p class="hint cal-sum">${t('{n} entradas este mes · pulsa una para editarla en Ecos (con Ctrl, en WordPress).', { n: items.length })}</p>`);
  $$('.cal-item', box).forEach((b) => (b.onclick = (e) => busy(b, async () => {
    const id = Number(b.dataset.id);
    if (e.ctrlKey || e.metaKey) return window.api.open(await window.api.blogEditUrl(id, 'post'));
    await openFromWp(id);
  })));
}

// ---------------------------------------------------------------- Pestaña Blog
const blog = { loaded: false, type: 'post', page: 1, per: 20, found: 0 };
const STATUS = () => ({ publish: t('Publicada'), draft: t('Borrador'), future: t('Programada'), pending: t('Pendiente'), private: t('Privada'), trash: t('Papelera') });
async function loadBlog() {
  const list = $('#b-list');
  list.innerHTML = `<p class="hint pad">${t('Cargando…')}</p>`;
  try {
    const r = await window.api.blogList({ type: blog.type, status: $('#b-status').value, search: $('#b-search').value.trim(), page: blog.page, number: blog.per });
    blog.loaded = true; blog.found = r.found;
    renderBlog(r.items);
  } catch (e) { list.innerHTML = `<div class="empty"><span class="ms">cloud_off</span><span>${escHtml(e.message)}</span></div>`; }
}
function renderBlog(items) {
  const list = $('#b-list');
  const pages = Math.max(1, Math.ceil(blog.found / blog.per));
  $('#b-info').textContent = t(blog.type === 'page' ? '{n} páginas · página {p} de {t}' : '{n} entradas · página {p} de {t}', { n: blog.found, p: blog.page, t: pages });
  $('#b-prev').disabled = blog.page <= 1; $('#b-next').disabled = blog.page >= pages;
  if (!items.length) { list.innerHTML = `<div class="empty"><span class="ms">inbox</span><span>${t('No hay nada con estos filtros.')}</span></div>`; return; }
  list.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'b-row';
    // Fecha de la entrada (también en borradores); la de última modificación queda en el texto emergente
    const when = `<span title="${escHtml(t('Última modificación: {d}', { d: fmtDay(it.modified) }))}">${fmtDay(it.date)}</span>`;
    const fromEcos = Object.values(exported).some((r) => r.postId === it.id);
    const restored = !fromEcos && Object.values(CFG.restored || {}).some((r) => r.postId === it.id);
    row.classList.toggle('ecos-made', fromEcos || restored);
    row.innerHTML = `
      ${it.image ? `<img src="${escHtml(it.image)}" loading="lazy" alt="">` : `<div class="noimg"><span class="ms">image</span></div>`}
      <div><div class="b-title"></div>
        <div class="b-meta"><span class="st ${escHtml(it.status)}">${STATUS()[it.status] || escHtml(it.status)}</span>${fromEcos ? `<span class="st ecos" title="${t('Entrada creada desde Ecos')}"><img src="assets/logo-mark.svg" alt="">${t('Creada con Ecos')}</span>` : ''}${restored ? `<span class="st restored" title="${t('Recuperada de una copia de seguridad con Ecos')}"><span class="ms">settings_backup_restore</span>${t('Restaurada')}</span>` : ''}${when}${it.categories.length ? ' · ' + escHtml(it.categories.join(', ')) : ''}</div>
        <div class="b-ex"></div></div>
      <div class="b-actions"></div>`;
    const title = decodeEntities(it.title);
    row.querySelector('.b-title').textContent = title;
    row.querySelector('.b-ex').textContent = decodeEntities(it.excerpt);
    const actions = row.querySelector('.b-actions');
    const btn = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls === 'primary' ? 'tonal' : cls === 'danger' ? 'text danger' : 'text');
      b.textContent = label; b.onclick = () => busy(b, fn); actions.appendChild(b);
    };
    // cualquier entrada se puede editar en Ecos (el HTML antiguo se convierte en bloques)
    if (it.status !== 'trash' && it.type !== 'page') btn(t('Editar en Ecos'), () => openFromWp(it.id), 'primary');
    if (it.status !== 'trash') btn(it.type === 'page' ? t('Editar') : t('Editar en WordPress'), async () => window.api.open(await window.api.blogEditUrl(it.id, it.type)));
    if (it.status === 'publish') btn(t('Ver'), async () => window.api.open(it.url));
    if (['draft', 'pending', 'private'].includes(it.status)) btn(t('Publicar'), async () => {
      if (!await ask(t('¿Publicar «{x}»? Será visible en la web.', { x: title }))) return;
      exported = await window.api.blogSetStatus(it.id, 'publish', it.type); toast(t('Publicada')); loadBlog(); renderFeed();
    }, 'primary');
    if (it.status === 'publish') btn(t('Pasar a borrador'), async () => {
      if (!await ask(t('¿Retirar «{x}» de la web y dejarla como borrador?', { x: title }), { danger: true })) return;
      exported = await window.api.blogSetStatus(it.id, 'draft', it.type); toast(t('Ahora es un borrador')); loadBlog(); renderFeed();
    });
    if (it.status === 'trash') btn(t('Restaurar como borrador'), async () => { exported = await window.api.blogSetStatus(it.id, 'draft', it.type); toast(t('Restaurada como borrador')); loadBlog(); renderFeed(); });
    else btn(t('Papelera'), async () => {
      if (!await ask(t('¿Mover «{x}» a la papelera? Podrás recuperarla durante 30 días.', { x: title }), { danger: true })) return;
      exported = await window.api.blogTrash(it.id, it.type); toast(t('Movida a la papelera')); loadBlog(); renderFeed();
    }, 'danger');
    // Borrar para siempre (también sin pasar por la papelera); pide confirmación dos veces si está publicada
    btn(t('Borrar definitivamente'), async () => {
      if (!await ask(t('¿Borrar «{x}» definitivamente? Desaparecerá de tu web y de la papelera, y no se podrá recuperar. (Las fotos se quedan en la biblioteca de medios.)', { x: title }), { danger: true, ok: t('Borrar definitivamente') })) return;
      if (it.status === 'publish' && !await ask(t('«{x}» está publicada y visible en la web. ¿Seguro que quieres borrarla para siempre?', { x: title }), { danger: true, ok: t('Sí, borrarla') })) return;
      exported = await window.api.blogDelete(it.id, it.type); toast(t('Borrada definitivamente')); loadBlog(); renderFeed();
    }, 'danger');
    list.appendChild(row);
  }
}
$$('#b-type button').forEach((b) => b.onclick = async () => {
  if (blog.type === 'structure' && b.dataset.type !== 'structure' && window.SiteStructure.dirty() && !await ask(t('Tienes cambios de estructura sin guardar. ¿Salir sin guardarlos?'))) return;
  $$('#b-type button').forEach((x) => x.classList.toggle('active', x === b));
  const st = b.dataset.type === 'structure', cal = b.dataset.type === 'calendar';
  // Estructura y Calendario: en lugar de la lista
  $$('#b-status, #tab-blog .field.search, #b-refresh, #b-new, #b-list, #tab-blog .pager').forEach((x) => x.classList.toggle('hidden', st || cal));
  $('#b-structure').classList.toggle('hidden', !st);
  $('#b-calendar').classList.toggle('hidden', !cal);
  blog.type = b.dataset.type;
  if (st) return window.SiteStructure.open();
  if (cal) return renderCalendar();
  blog.page = 1; loadBlog();
});
$('#b-status').onchange = () => { blog.page = 1; loadBlog(); };
let bTimer; $('#b-search').oninput = () => { clearTimeout(bTimer); bTimer = setTimeout(() => { blog.page = 1; loadBlog(); }, 400); };
$('#b-refresh').onclick = loadBlog;
$('#b-prev').onclick = () => { blog.page--; loadBlog(); };
$('#b-next').onclick = () => { blog.page++; loadBlog(); };
$('#b-new').onclick = () => {
  if (CFG.wpMode === 'selfhosted') {
    const base = (CFG.wpUrl || '').replace(/\/$/, '');
    return window.api.open(`${/^https?:/.test(base) ? base : 'https://' + base}/wp-admin/post-new.php${blog.type === 'page' ? '?post_type=page' : ''}`);
  }
  window.api.open(`https://wordpress.com/${blog.type === 'page' ? 'page' : 'post'}/${CFG.wpSite}`);
};
