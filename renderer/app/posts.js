// Ecos · Pantalla «Publicaciones»: lista, selección y resumen de un periodo.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- Publicaciones: lista
function visiblePosts() {
  const q = $('#f-search').value.trim().toLowerCase();
  const show = $('#f-show').value;
  return posts.filter((p) => {
    if (q && !p.text.toLowerCase().includes(q)) return false;
    const done = !!liveExport(p);
    return show === 'all' || (show === 'done' ? done : !done);
  });
}
// «3 fotos · 1 vídeo» con iconos
function mediaCount(p) {
  const ph = p.media.filter((m) => m.type !== 'video').length, vi = p.media.filter((m) => m.type === 'video').length;
  const part = (n, icon, one, many) => (n ? `<span class="mc" title="${t(n === 1 ? one : many, { n })}"><span class="ms">${icon}</span>${n}</span>` : '');
  return ph || vi ? `<span class="mcount">${part(ph, 'photo', '{n} foto', '{n} fotos')}${part(vi, 'videocam', '{n} vídeo', '{n} vídeos')}</span>` : '';
}
function renderFeed() {
  const list = visiblePosts();
  const feed = $('#feed');
  feed.classList.toggle('selecting', selected.size > 0);
  if (!rawPosts.length) { feed.innerHTML = `<div class="empty"><span class="ms fill">photo_library</span><b>${t('Aún no hay publicaciones')}</b><span>${t('Elige un origen arriba o arrastra archivos aquí.')}</span></div>`; return; }
  if (!list.length) { feed.innerHTML = `<div class="empty"><span class="ms">filter_alt_off</span><span>${t('Ninguna publicación coincide con el filtro.')}</span></div>`; return; }
  feed.innerHTML = '';
  for (const p of list) {
    const key = keyOf(p);
    const ex = exportOf(p);
    const card = document.createElement('div');
    card.className = 'post' + (selected.has(key) ? ' sel' : '') + (ex && !GONE.includes(ex.status) ? ' done' : '');
    card.tabIndex = 0;
    const first = p.media.find((m) => m.type === 'image') || p.media[0];
    const thumb = first && (first.url || (first.type === 'image' ? fileUrl(first.path) : null));
    const badges = [p, ...(p.alsoOn || [])].map((x) => `<span class="badge ${x.source}">${x.source === 'instagram' ? 'IG' : 'FB'}</span>`).join(' ');
    card.innerHTML = `
      ${thumb ? `<img src="${escHtml(thumb)}" loading="lazy" alt="">` : `<div class="noimg">${t('Sin imagen')}</div>`}
      ${ex ? (() => { const st = EX_STATUS()[ex.status] || { icon: 'check_circle', label: t('En el blog') };
        return `<span class="done-badge st-${escHtml(ex.status || 'publish')}" title="${t('Abrir la entrada en WordPress')}"><span class="ms fill">${st.icon}</span>${st.label}</span>`; })() : ''}
      <span class="check"><span class="ms">check</span></span>
      <div class="media-tools">
        ${p.media.some((m) => m.type === 'video') ? `<span class="vid-badge"><span class="ms fill">play_circle</span>${t('Vídeo')}</span>` : ''}
        ${p.media.length ? `<button class="zoom" title="${t('Ver en grande')}"><span class="ms">open_in_full</span></button>` : ''}
      </div>
      <div class="meta">${badges} ${fmtDate(p.date)}${mediaCount(p)}</div>
      <p></p>
      ${ex && !GONE.includes(ex.status) && ex.postId ? `<button class="btn tonal small edit-entry" title="${t('Abrir la entrada en el editor de Ecos')}"><span class="ms">edit_square</span>${t('Editar entrada')}</button>` : ''}`;
    card.querySelector('p').textContent = p.text.slice(0, 220) + (p.text.length > 220 ? '…' : '');
    if (ex) card.querySelector('.done-badge').onclick = (e) => { e.stopPropagation(); window.api.open(ex.editUrl); };
    card.querySelector('.edit-entry')?.addEventListener('click', (e) => { e.stopPropagation(); busy(e.currentTarget, () => openFromWp(ex.postId, keysOf(p))); });
    card.querySelector('.zoom')?.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(mediaItemsOf(p), 0); });
    card.ondblclick = (e) => { e.preventDefault(); if (p.media.length) openLightbox(mediaItemsOf(p), 0); };
    const toggle = () => { selected.has(key) ? selected.delete(key) : selected.add(key); card.classList.toggle('sel'); updateCount(); feed.classList.toggle('selecting', selected.size > 0); };
    card.onclick = toggle;
    card.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } };
    feed.appendChild(card);
  }
}
// ---------------------------------------------------------------- Publicaciones: calendario
const feedCal = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), mode: 'month', on: false };
function renderFeedCal() {
  if (!feedCal.on) return;
  return calendarView($('#feed-cal'), feedCal, {
    legend: `<i class="pend"></i>${t('Sin pasar al blog')}<i class="publish"></i>${t('Ya en el blog')}<i class="sel"></i>${t('Seleccionada')}`,
    // Si el mes que se mira es anterior a lo cargado, se traen más publicaciones de Meta hasta llegar a él
    async beforeLoad(from) {
      if (!CFG.metaConnected || !$('#page').value || !cursors) return;
      for (let i = 0; i < 15 && cursors && (cursors.facebook || cursors.instagram); i++) {
        const oldest = rawPosts.length ? new Date(rawPosts[rawPosts.length - 1].date) : new Date();
        if (oldest < from) break;
        await loadMore();
      }
    },
    async load() {
      return visiblePosts().map((p) => {
        const ex = liveExport(p), first = p.media.find((m) => m.type === 'image') || p.media[0];
        const thumb = first && (first.url || (first.type === 'image' ? fileUrl(first.path) : null));
        const src = [p, ...(p.alsoOn || [])].map((x) => `<span class="badge ${x.source}">${x.source === 'instagram' ? 'IG' : 'FB'}</span>`).join('');
        return { p, date: p.date, title: (p.text || t('Sin texto')).slice(0, 80), thumb, badge: `<span class="cal-src">${src}</span>`, cls: (ex ? 'st-publish' : 'st-pend') + (selected.has(keyOf(p)) ? ' sel' : '') };
      });
    },
    footer: (items, from, to, year) => (!rawPosts.length ? t('Carga publicaciones arriba para verlas en el calendario.')
      : t(year ? '{n} publicaciones en {y}; {d} ya en el blog.' : '{n} publicaciones este mes; {d} ya en el blog. Pulsa una para seleccionarla (con Ctrl, verla en grande).',
        { n: items.length, y: from.getFullYear(), d: items.filter((i) => liveExport(i.p)).length })),
    onItem: (it, e, b) => {
      if (e.ctrlKey || e.metaKey) { if (it.p.media.length) openLightbox(mediaItemsOf(it.p), 0); return; }
      const key = keyOf(it.p);
      selected.has(key) ? selected.delete(key) : selected.add(key);
      b.classList.toggle('sel', selected.has(key));
      updateCount(); renderFeed();
    },
  });
}
$$('#f-view [data-v]').forEach((b) => (b.onclick = () => {
  feedCal.on = b.dataset.v === 'cal';
  $$('#f-view [data-v]').forEach((x) => x.classList.toggle('active', x === b));
  $('#feed').classList.toggle('hidden', feedCal.on);
  $('#feed-cal').classList.toggle('hidden', !feedCal.on);
  renderFeedCal();
}));

function updateCount() {
  $('#sel-count').textContent = t(selected.size === 1 ? '{n} seleccionada' : '{n} seleccionadas', { n: selected.size });
  $('#make').disabled = selected.size === 0;
  // La barra flotante aparece al seleccionar algo (y se oculta mientras el editor está abierto)
  $('#selbar').classList.toggle('show', selected.size > 0 && $('#editor').classList.contains('hidden') && $('#tab-posts').classList.contains('active'));
}
$('#sel-clear').onclick = () => { selected.clear(); updateCount(); renderFeed(); };
async function addPosts(list, select = false) {
  const have = new Set(rawPosts.map(keyOf));
  for (const p of list) {
    if (!have.has(keyOf(p))) rawPosts.push(p);
    if (select) selected.add(keyOf(p));
  }
  rawPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
  await rebuildView();
}
async function rebuildView() {
  posts = $('#f-merge').checked ? await window.api.mergeDuplicates(rawPosts) : rawPosts;
  const valid = new Set(posts.map(keyOf));
  for (const k of [...selected]) if (!valid.has(k)) selected.delete(k);
  $('#more').classList.toggle('hidden', !(cursors && (cursors.facebook || cursors.instagram)));
  updateCount(); renderFeed(); renderFeedCal();
}
const metaSources = () => [$('#src-ig').checked && 'instagram', $('#src-fb').checked && 'facebook'].filter(Boolean);
async function loadFirst() { const r = await window.api.metaPosts($('#page').value, metaSources()); cursors = r.cursors; await addPosts(r.posts); return r.posts.length; }
async function loadMore() { const r = await window.api.metaPosts($('#page').value, metaSources(), cursors); cursors = r.cursors; await addPosts(r.posts); return r.posts.length; }
$('#load').onclick = (e) => busy(e.target, async () => toast(t('{n} publicaciones cargadas', { n: await loadFirst() })));
$('#more').onclick = (e) => busy(e.target, loadMore);
$('#f-merge').onchange = async () => { CFG = await window.api.setConfig({ format: { ...CFG.format, mergeDuplicates: $('#f-merge').checked } }); rebuildView(); };
$('#f-search').oninput = () => { renderFeed(); renderFeedCal(); };
$('#f-show').onchange = () => { renderFeed(); renderFeedCal(); };
$('#clear').onclick = () => { rawPosts = []; posts = []; cursors = null; selected.clear(); $('#more').classList.add('hidden'); updateCount(); renderFeed(); };

// Selector de origen
$$('.sources button').forEach((b) => b.onclick = () => {
  $$('.sources button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.src-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'src-' + b.dataset.src));
});
const showSource = (src) => $(`.sources button[data-src="${src}"]`).click();

// ZIP de Meta
const importZip = (kind) => (e) => busy(e.target, async () => {
  const list = await window.api.importMetaExport(kind);
  if (list) { await addPosts(list); toast(t('{n} publicaciones importadas', { n: list.length })); }
});
$('#zip-file').onclick = importZip('file');
$('#zip-folder').onclick = importZip('folder');

// Capturas con IA
async function importShots(files) {
  toast(t('La IA está leyendo las capturas…'));
  const post = await window.api.importScreenshots(files);
  await addPosts([post], true);
  toast(post.warning || t('Publicación leída: {n} foto(s). Ya está seleccionada.', { n: post.media.length }), !!post.warning);
}
$('#shots-pick').onclick = (e) => busy(e.target, async () => { const f = await window.api.pickImages(false); if (f) await importShots(f); });

// Manual
let manualFiles = [];
const renderManualCount = () => ($('#m-count').textContent = t('{n} archivo(s)', { n: manualFiles.length }));
$('#m-files').onclick = async () => { const f = await window.api.pickImages(true); if (f) { manualFiles = manualFiles.concat(f); renderManualCount(); } };
$('#m-add').onclick = async () => {
  if (!$('#m-text').value.trim() && !manualFiles.length) return toast(t('Escribe un texto o añade fotos'), true);
  const post = await window.api.manualPost({
    text: $('#m-text').value, date: $('#m-date').value || null, source: $('#m-source').value,
    permalink: $('#m-link').value.trim() || null, files: manualFiles,
  });
  await addPosts([post], true);
  $('#m-text').value = ''; $('#m-link').value = ''; manualFiles = []; renderManualCount();
  toast(t('Añadida a la lista y seleccionada'));
};

// Arrastrar y soltar en la ventana
let dragDepth = 0;
// Solo archivos que vienen de fuera de Ecos (al arrastrar una foto dentro del editor, Windows también dice «Files»)
const externalFiles = (e) => [...e.dataTransfer.types].includes('Files') && ![...e.dataTransfer.types].includes('text/x-ecos') && !document.body.classList.contains('dragging-internal');
window.addEventListener('dragenter', (e) => { if (externalFiles(e)) { dragDepth++; $('#drop').classList.remove('hidden'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.add('hidden'); } });
window.addEventListener('dragover', (e) => { if (externalFiles(e)) e.preventDefault(); });
window.addEventListener('dragend', () => { dragDepth = 0; $('#drop').classList.add('hidden'); });
window.addEventListener('drop', async (e) => {
  dragDepth = 0; $('#drop').classList.add('hidden');
  if (!externalFiles(e)) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  if (!$('#restore').classList.contains('hidden')) return rsAnalyze(paths);
  showTab('posts');
  try {
    const zip = paths.find((p) => /\.zip$/i.test(p));
    if (zip) { const list = await window.api.importMetaPath(zip); await addPosts(list); toast(t('{n} publicaciones importadas', { n: list.length })); return; }
    const media = paths.filter((p) => /\.(jpe?g|png|webp|gif|mp4|mov)$/i.test(p));
    if (!media.length) return toast(t('Ese tipo de archivo no se puede usar aquí'), true);
    if ($('.sources button.active').dataset.src === 'shots') return importShots(media.filter((p) => !/\.(mp4|mov)$/i.test(p)));
    manualFiles = manualFiles.concat(media); renderManualCount(); showSource('manual');
    toast(t('{n} archivo(s) añadidos. Escribe el texto y pulsa «Añadir a la lista».', { n: media.length }));
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- Resumen de un periodo
$('#summary').onclick = () => {
  const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  $('#sum-from').value = iso(first); $('#sum-to').value = iso(now);
  $('#summary-modal').classList.remove('hidden');
};
$('#sum-cancel').onclick = () => $('#summary-modal').classList.add('hidden');
$('#sum-go').onclick = (e) => busy(e.target, async () => {
  const from = new Date($('#sum-from').value + 'T00:00:00'), to = new Date($('#sum-to').value + 'T23:59:59');
  if (!(from <= to)) throw new Error(t('Revisa las fechas'));
  // Trae publicaciones hasta llegar a la fecha de inicio (si se usa la conexión con Meta)
  if (CFG.metaConnected && $('#page').value) {
    if (!cursors) await loadFirst();
    for (let i = 0; i < 15 && cursors && (cursors.facebook || cursors.instagram); i++) {
      const oldest = rawPosts.length ? new Date(rawPosts[rawPosts.length - 1].date) : new Date();
      if (oldest < from) break;
      await loadMore();
    }
  }
  const inRange = posts.filter((p) => new Date(p.date) >= from && new Date(p.date) <= to && (!$('#sum-pending').checked || !liveExport(p)));
  if (!inRange.length) throw new Error(t('No hay publicaciones en ese periodo'));
  selected.clear(); inRange.forEach((p) => selected.add(keyOf(p)));
  $('#f-show').value = 'all'; renderFeed(); updateCount();
  $('#summary-modal').classList.add('hidden');
  await makeDraft();
});
