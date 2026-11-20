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
    blog.loaded = true; blog.found = r.found; syncFindBtn();
    renderBlog(r.items);
  } catch (e) { list.innerHTML = `<div class="empty"><span class="ms">cloud_off</span><span>${escHtml(e.message)}</span></div>`; }
}
function renderBlog(items) {
  const list = $('#b-list');
  const pages = Math.max(1, Math.ceil(blog.found / blog.per));
  $('#b-info').textContent = t(blog.type === 'page' ? '{n} páginas · página {p} de {t}' : '{n} entradas · página {p} de {t}', { n: blog.found, p: blog.page, t: pages });
  $('#b-prev').disabled = blog.page <= 1; $('#b-next').disabled = blog.page >= pages;
  if (!items.length) { bItems = []; renderBulk(); list.innerHTML = `<div class="empty"><span class="ms">inbox</span><span>${t('No hay nada con estos filtros.')}</span></div>`; return; }
  list.innerHTML = '';
  bItems = items; bLast = -1;
  renderBulk();
  for (const it of items) {
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
        <div class="b-meta"><span class="st ${escHtml(it.status)}">${STATUS()[it.status] || escHtml(it.status)}</span>${fromEcos ? `<span class="st ecos" title="${t('Entrada creada desde Ecos')}"><img src="assets/logo-mark.svg" alt="">${t('Creada con Ecos')}</span>` : ''}${restored ? `<span class="st restored" title="${t('Recuperada de una copia de seguridad con Ecos')}"><span class="ms">settings_backup_restore</span>${t('Restaurada')}</span>` : ''}${when}${it.categories.length ? ' · ' + escHtml(it.categories.join(', ')) : ''}</div>
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
  syncFindBtn();
  bsel.clear();
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

// --- Selección y acciones en lote --------------------------------------------------
const bsel = new Map(); // id → entrada (se mantiene al cambiar de página)
let bItems = [], bLast = -1;
function renderBulk() {
  const n = bsel.size, bar = $('#b-bulk');
  bar.classList.toggle('hidden', !bItems.length && !n);
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
    if (blog.type !== 'page' && has((i) => i.status !== 'trash')) acts.push(['normalize', 'format_paint', t('Normalizar formato')]);
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
  const errors = [];
  let done = 0;
  const label = $('#b-count');
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
        done++;
      } catch (e) { errors.push(`«${decodeEntities(it.title)}»: ${e.message}`); }
    }
  }
  toast(t('Hecho en {n} entradas.', { n: done }) + (errors.length ? ' ' + t('{e} con error: {m}', { e: errors.length, m: errors.slice(0, 2).join(' · ') }) : ''), errors.length > 0);
  bsel.clear();
  loadBlog(); renderFeed();
}

// ---------------------------------------------------------------- Buscar y reemplazar en todo el blog (WordPress propio)
const bfr = { results: [], query: '', type: 'post' };
function syncFindBtn() { $('#b-find').classList.toggle('hidden', CFG.wpMode !== 'selfhosted' || blog.type === 'structure' || blog.type === 'calendar'); }
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
    <div class="bfr-m">${escHtml(STATUS()[r.status] || r.status)} · ${t('{n} coincidencias', { n: r.count })}</div>
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
