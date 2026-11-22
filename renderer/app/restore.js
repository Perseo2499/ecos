// Ecos · Restaurar desde copia de seguridad.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- Restaurar desde copia de seguridad
const rs = { data: null, sel: new Set(), type: 'all', state: {} };
const rsShow = (step) => ['#rs-pick', '#rs-working', '#rs-result'].forEach((id) => $(id).classList.toggle('hidden', id !== step));
function openRestore() {
  $('#restore').classList.remove('hidden'); document.body.classList.add('editing');
  if (!rs.data) rsShow('#rs-pick');
}
async function closeRestore() {
  if (rs.running && !await ask(t('Hay una restauración en marcha. ¿Cancelarla y salir?'), { danger: true })) return;
  if (rs.running || rs.analyzing) cancelBackupJob();
  $('#restore').classList.add('hidden'); document.body.classList.remove('editing');
}
// Cancelar el análisis o la restauración en curso (la entrada que se está subiendo termina o se corta)
function cancelBackupJob() { rs.gen = (rs.gen || 0) + 1; window.api.backupCancel().catch(() => {}); }
$('#rs-cancel').onclick = () => { cancelBackupJob(); rs.analyzing = false; rsShow('#rs-pick'); toast(t('Análisis cancelado.')); };
$('#rs-stop').onclick = async () => {
  if (!await ask(t('¿Cancelar la restauración? Lo ya restaurado se queda en tu web; la entrada que se está subiendo ahora puede quedar a medias.'), { danger: true, ok: t('Cancelar restauración'), cancel: t('Seguir') })) return;
  cancelBackupJob();
  $('#rs-stop').disabled = true; $('#rs-stop').lastElementChild.textContent = t('Cancelando…');
};
$('#rs-change').onclick = async () => {
  await window.api.backupClose().catch(() => {});
  rs.data = null; rs.sel = new Set(); $('#rs-go').classList.add('hidden'); $('#rs-change').classList.add('hidden'); rsShow('#rs-pick');
};
$('#rs-open').onclick = openRestore;
$('#rs-close').onclick = closeRestore;
$('#rs-files').onclick = async () => { const p = await window.api.backupPick('files'); if (p) rsAnalyze(p); };
$('#rs-folder').onclick = async () => { const p = await window.api.backupPick('folder'); if (p) rsAnalyze(p); };

window.api.onBackupProgress((p) => {
  if (p.step) {
    $('#rs-step').textContent = p.step === 'abrir' ? t('Abriendo {f}…', { f: p.file }) : p.step === 'leer' ? t('Leyendo la base de datos {f}…', { f: p.file }) : t('Buscando entradas, fotos y categorías…');
    return;
  }
  if (p.key) { rs.state[p.key] = p; rsRenderRow(p.key); }
});

async function rsAnalyze(paths) {
  rsShow('#rs-working'); $('#rs-step').textContent = '';
  $('#rs-go').classList.add('hidden'); $('#rs-change').classList.add('hidden');
  const gen = rs.gen = (rs.gen || 0) + 1;
  rs.analyzing = true;
  try {
    const data = await window.api.backupAnalyze(paths);
    if (gen !== rs.gen) return; // se canceló mientras tanto
    rs.analyzing = false;
    rs.data = data;
    $('#rs-change').classList.remove('hidden');
    rs.sel = new Set(rs.data.posts.filter((p) => !p.restored && p.type === 'post').map((p) => p.key));
    rs.state = {};
    rsRender();
    rsShow('#rs-result');
  } catch (e) {
    rs.analyzing = false;
    if (gen !== rs.gen || /Cancelado/.test(e.message)) return;
    rsShow('#rs-pick'); toastError(e);
  }
}

function rsRender() {
  const d = rs.data, s = d.stats;
  const range = s.from ? `${fmtDay(s.from.replace(' ', 'T'))} – ${fmtDay(s.to.replace(' ', 'T'))}` : '–';
  const stat = (icon, n, label, cls = '') => `<div class="rs-stat ${cls}"><span class="ms fill">${icon}</span><b>${n}</b><span>${label}</span></div>`;
  $('#rs-summary').innerHTML = `
    <div class="rs-source"><span class="ms">inventory_2</span><span>${t('Copia')}: <b>${escHtml(d.kinds.join(' + '))}</b></span>
      <span>${t('Base de datos')}: <b>${escHtml(d.dbFile)}</b></span><span>${t('Web original')}: <b>${escHtml(d.siteName || '')} ${escHtml(d.siteUrl || '')}</b></span></div>
    ${stat('article', s.posts, t('entradas'))}${stat('description', s.pages, t('páginas'))}
    ${stat('public', s.published, t('publicadas'))}${stat('edit_note', s.drafts, t('borradores'))}
    ${stat('photo_library', s.files, t('archivos multimedia en la copia'))}
    ${stat('image_not_supported', s.mediaMissing, t('fotos usadas que no están en la copia'), s.mediaMissing ? 'warn' : '')}
    ${stat('category', s.categories.length, t('categorías'))}${stat('sell', s.tags, t('etiquetas'))}
    ${stat('date_range', '', range)}`;
  rsRenderList();
}

function rsVisible() {
  const q = $('#rs-search').value.trim().toLowerCase();
  return rs.data.posts.filter((p) => (rs.type === 'all' || p.type === rs.type) && (!q || p.title.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q)));
}
function rsRenderList() {
  const list = $('#rs-list'); list.innerHTML = '';
  const vis = rsVisible();
  if (!vis.length) { list.innerHTML = `<div class="empty"><span class="ms">inbox</span><span>${t('No hay nada con estos filtros.')}</span></div>`; }
  for (const p of vis) {
    const row = document.createElement('div');
    row.className = 'rs-row'; row.dataset.key = p.key;
    list.appendChild(row);
    rsRenderRow(p.key);
    window.api.backupThumb(p.key).then((src) => { if (src) { const th = row.querySelector('.th'); if (th) th.outerHTML = `<img class="th" src="${src}" alt="">`; } }).catch(() => {});
  }
  $('#rs-all').checked = vis.length > 0 && vis.every((p) => rs.sel.has(p.key));
  rsUpdateGo();
}
const ST = () => ({ publish: t('Publicada'), draft: t('Borrador'), future: t('Programada'), pending: t('Pendiente'), private: t('Privada') });
function rsRenderRow(key) {
  const row = $(`.rs-row[data-key="${CSS.escape(key)}"]`); if (!row) return;
  const p = rs.data.posts.find((x) => x.key === key);
  const st = rs.state[key];
  const done = st?.state === 'ok' ? st : p.restored;
  const state = st?.state === 'working' ? `<span class="spin"></span> ${t('Restaurando…')}`
    : done ? `<span class="ms fill">check_circle</span> <a href="#" data-open="${escHtml(done.editUrl || '')}">${done.existing ? (done.status === 'publish' ? t('Ya está en tu web') : t('Ya está en tu web (borrador)')) : t('Restaurada')}</a>${p.type !== 'page' && done.postId ? ` · <a href="#" data-ecos="${done.postId}">${t('Editar en Ecos')}</a>` : ''}`
    : st?.state === 'exists' ? `<span class="ms">content_copy</span> ${t('Ya existe en tu web')}`
    : st?.state === 'error' ? `<span class="ms">error</span> ${escHtml(st.message.slice(0, 80))}` : '';
  const thumb = row.querySelector('img.th');
  row.className = 'rs-row' + (rs.sel.has(key) ? ' sel' : '');
  row.innerHTML = `
    <input type="checkbox" ${rs.sel.has(key) ? 'checked' : ''}>
    ${thumb ? thumb.outerHTML : `<div class="th"><span class="ms">${p.type === 'page' ? 'description' : 'article'}</span></div>`}
    <div>
      <div class="t"></div>
      <div class="m"><span class="st ${escHtml(p.status)}">${ST()[p.status] || escHtml(p.status)}</span>
        <span>${p.type === 'page' ? t('Página') : t('Entrada')}</span><span>${fmtDay(String(p.date).replace(' ', 'T'))}</span>
        ${p.media ? `<span><span class="ms">photo</span> ${p.mediaFound}/${p.media}</span>` : ''}
        ${p.mediaMissing ? `<span class="miss" title="${t('Se intentarán descargar de la web antigua')}">${t('{n} sin archivo', { n: p.mediaMissing })}</span>` : ''}
        ${p.categories.length ? `<span><span class="ms">category</span> ${escHtml(p.categories.join(', '))}</span>` : ''}
        <span>${t('{n} palabras', { n: p.words })}</span></div>
      <div class="ex"></div>
    </div>
    <div class="rs-state ${escHtml(done ? 'ok' : st?.state || '')}">${state}</div>
    <button class="btn text icon-only rs-pv" title="${t('Vista previa')}"><span class="ms">visibility</span></button>`;
  row.querySelector('.t').textContent = p.title;
  row.querySelector('.ex').textContent = p.excerpt;
  row.querySelector('.rs-pv').onclick = (e) => {
    e.stopPropagation();
    busy(e.currentTarget, async () => {
      const r = await window.api.backupPreview(key);
      await showPreview({ title: r.title, date: r.date, cats: r.categories, featured: r.featured, content: r.content });
    });
  };
  row.onclick = (e) => {
    if (e.target.dataset.open !== undefined) { e.preventDefault(); if (e.target.dataset.open) window.api.open(e.target.dataset.open); return; }
    if (e.target.dataset.ecos) { e.preventDefault(); const id = Number(e.target.dataset.ecos); closeRestore().then(() => openFromWp(id).catch((err) => toastError(err))); return; }
    rs.sel.has(key) ? rs.sel.delete(key) : rs.sel.add(key);
    rsRenderRow(key); rsUpdateGo();
  };
}
function rsUpdateGo() {
  const n = rs.sel.size;
  if (!$('#rs-go-label')) return;
  // entradas ya restauradas: se pueden pasar al formato actual
  const restored = (rs.data?.posts || []).filter((p) => p.restored?.postId);
  $('#rs-normalize').classList.toggle('hidden', !restored.length || !!rs.running);
  $('#rs-normalize-label').textContent = t('Normalizar las ya restauradas ({n})', { n: restored.length });
  $('#rs-go').classList.toggle('hidden', !n);
  $('#rs-go-label').textContent = t(n === 1 ? 'Restaurar {n} entrada' : 'Restaurar {n} entradas', { n });
}
$$('#rs-type button').forEach((b) => b.onclick = () => { $$('#rs-type button').forEach((x) => x.classList.toggle('active', x === b)); rs.type = b.dataset.v; rsRenderList(); });
$('#rs-search').oninput = () => rsRenderList();
$('#rs-all').onchange = () => { for (const p of rsVisible()) $('#rs-all').checked ? rs.sel.add(p.key) : rs.sel.delete(p.key); rsRenderList(); };
// (el botón se actualiza al terminar, cuando ya no muestra «Trabajando…»)
$('#rs-go').onclick = (e) => busy(e.currentTarget, rsRestore).then(() => { rsRenderList(); });
async function rsRestore() {
  if (!CFG.wpConnected) throw new Error(t('Primero conecta tu WordPress en «Conexiones».'));
  const keys = rs.data.posts.filter((p) => rs.sel.has(p.key)).map((p) => p.key);
  const asDraft = $('#rs-status').value === 'draft';
  if (!await ask(t(asDraft ? 'Se crearán {n} entradas como borrador en tu web, con sus fotos. ¿Continuar?' : 'Se crearán {n} entradas en tu web con su estado original (las publicadas serán visibles). ¿Continuar?', { n: keys.length }))) return;
  rs.running = true;
  $('#rs-stop').disabled = false; $('#rs-stop').lastElementChild.textContent = t('Cancelar restauración');
  $('#rs-stop').classList.remove('hidden'); $('#rs-change').classList.add('hidden');
  let res;
  try { res = await window.api.backupRestore(keys, { status: $('#rs-status').value, skipExisting: $('#rs-skip').checked, createCategories: true, download: true, modern: $('#rs-modern').checked }); }
  finally { rs.running = false; $('#rs-stop').classList.add('hidden'); $('#rs-change').classList.remove('hidden'); }
  for (const k of keys) if (rs.state[k]?.state === 'working' || rs.state[k]?.state === 'cancelled') { delete rs.state[k]; rsRenderRow(k); }
  const cancelled = res.length < keys.length;
  const ok = res.filter((r) => r.state === 'ok').length, ex = res.filter((r) => r.state === 'exists').length, err = res.filter((r) => r.state === 'error').length;
  for (const r of res) if (r.state === 'ok') { const p = rs.data.posts.find((x) => x.key === r.key); p.restored = r; rs.sel.delete(r.key); CFG.restored = { ...(CFG.restored || {}), ['local|' + r.key]: { postId: r.postId } }; }
  blog.loaded = false;
  const lost = res.flatMap((r) => r.problems || []).length;
  toast((cancelled ? t('Restauración cancelada.') + ' ' : '') + t('{ok} restauradas · {ex} ya existían · {err} con error', { ok, ex, err }) + (lost ? ' · ' + t('{n} fotos no se encontraron', { n: lost }) : ''), err > 0);
}

$('#rs-normalize').onclick = (e) => busy(e.currentTarget, async () => {
  const restored = rs.data.posts.filter((p) => p.restored?.postId);
  if (!await ask(t('Se normalizará el formato de {n} entradas ya restauradas en tu web (bloques de WordPress y formato habitual; el texto no cambia). ¿Continuar?', { n: restored.length }))) return;
  const r = await window.api.backupNormalize(restored.map((p) => p.restored.postId));
  toast(t('{n} entradas normalizadas.', { n: r.done }) + (r.errors.length ? ' ' + t('{e} con error.', { e: r.errors.length }) : ''), r.errors.length > 0);
});
