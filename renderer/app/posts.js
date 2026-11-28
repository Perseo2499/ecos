// Ecos · Pantalla «Redes»: lista, selección y resumen de un periodo.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- Publicaciones: lista
// Texto en minúsculas y fecha numérica de cada publicación, calculados una sola vez (no en cada tecla ni en cada comparación del orden)
const lcOf = (() => { const m = new WeakMap(); return (p) => { let e = m.get(p); if (!e || e.t !== p.text) { e = { t: p.text, l: String(p.text || '').toLowerCase() }; m.set(p, e); } return e.l; }; })();
const tsOf = (() => { const m = new WeakMap(); return (p) => { let v = m.get(p); if (v === undefined) { v = new Date(p.date).getTime() || 0; m.set(p, v); } return v; }; })();
function visiblePosts() {
  const q = $('#f-search').value.trim().toLowerCase();
  const show = $('#f-show').value;
  return posts.filter((p) => {
    if (q && !lcOf(p).includes(q)) return false;
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
// Línea temporal lateral de Redes: meses conocidos de lo cargado; si Meta tiene más, un botón «…» al final carga más
const postsMoreAvailable = () => !!(CFG.metaConnected && cursors && (cursors.facebook || cursors.instagram));
const postsLane = createDateLane({
  name: 'posts', label: t('Línea temporal de las publicaciones'), liveDrag: true,
  isActive: () => $('#tab-posts').classList.contains('active') && !feedCal.on && $('#editor').classList.contains('hidden') && !document.body.classList.contains('editing'),
  stickyEl: () => $('#tab-posts .row.filters'), padEl: () => $('#tab-posts .feed-col'), list: () => $('#feed'),
  watch: () => [$('#editor'), $('#feed-cal')],
  jump: async (key, o) => { feedFlush(); dlScrollTo($('#feed'), key, () => $('#tab-posts .row.filters'), o.smooth); },
});
function postsLaneUpdate(groups) {
  postsLane.update(groups.map((g) => ({ key: g.key, count: g.count })).filter((g) => g.key !== DateLane.NOKEY), {
    order: dlOrder('posts'),
    more: postsMoreAvailable() ? { label: t('Cargar publicaciones más antiguas'), run: async () => { await loadMore(); } } : null,
  });
}
// ---------------------------------------------------------------- Publicaciones: detalle junto a cada tarjeta
// Vista «Detalle» (por defecto): cada publicación es una fila con la tarjeta y, al lado, fecha, redes, texto completo y todas sus fotos y vídeos.
const feedLayout = () => { try { return localStorage.getItem('ecos-feed-layout') === 'grid' ? 'grid' : 'detail'; } catch { return 'detail'; } };
const PD_NARROW = 720; // por debajo de este ancho de contenido, el detalle pasa debajo de la tarjeta
const PD_MAX_THUMBS = 24;
const pdLang = () => (prefs().lang === 'en' ? 'en' : 'es');
const NET_NAME = { instagram: 'Instagram', facebook: 'Facebook' };
function pdThumbSrc(m) { return m.url || (m.type === 'image' && m.path ? fileUrl(m.path) : ''); }
function postDetail(p) {
  const el = document.createElement('div');
  el.className = 'pdetail';
  const d = new Date(p.date), ok = !Number.isNaN(d.getTime());
  const lang = pdLang(), loc = lang === 'en' ? 'en-GB' : 'es-ES';
  const full = ok ? d.toLocaleString(loc, { dateStyle: 'full', timeStyle: 'short' }) : '';
  const nets = [p, ...(p.alsoOn || [])];
  const net = (x) => `<span class="pd-net"><span class="badge ${escHtml(x.source)}">${x.source === 'instagram' ? 'IG' : 'FB'}</span>${x.permalink
    ? `<a class="pd-open" href="${escHtml(x.permalink)}" title="${escHtml(t('Abrir la publicación original'))}">${escHtml(t('Ver en {red}', { red: NET_NAME[x.source] || x.source }))}<span class="ms">open_in_new</span></a>`
    : `<span class="pd-nolink">${escHtml(NET_NAME[x.source] || x.source)}</span>`}</span>`;
  const metrics = [];
  const mt = (icon, n, one, many) => { if (n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n))) metrics.push(`<span class="pd-metric" title="${escHtml(t(Number(n) === 1 ? one : many, { n }))}"><span class="ms">${icon}</span>${Number(n).toLocaleString(loc)}</span>`); };
  mt('favorite', p.likes ?? p.likeCount, '{n} me gusta', '{n} me gusta'); mt('chat_bubble', p.comments ?? p.commentCount, '{n} comentario', '{n} comentarios');
  const text = (p.text || '').trim();
  el.innerHTML = `
    <div class="pd-head">
      ${ok ? `<time class="pd-date" datetime="${escHtml(d.toISOString())}">${escHtml(full)}</time><span class="pd-rel">${escHtml(PostFmt.relTime(d, Date.now(), lang))}</span>` : `<span class="pd-date">${escHtml(t('Sin fecha'))}</span>`}
      ${metrics.length ? `<span class="pd-metrics">${metrics.join('')}</span>` : ''}
    </div>
    <div class="pd-nets">${nets.map(net).join('')}</div>
    <div class="pd-body">${text ? `<div class="pd-text clamp">${PostFmt.formatText(text)}</div>
      <button type="button" class="pd-more" hidden aria-expanded="false">${escHtml(t('Ver más'))}</button>` : `<div class="pd-text empty">${escHtml(t('Sin texto'))}</div>`}</div>`;
  // Miniaturas de todas las fotos y vídeos: un clic abre el visor en esa
  if (p.media.length) {
    const strip = document.createElement('div');
    strip.className = 'pd-strip';
    strip.setAttribute('role', 'list');
    strip.setAttribute('aria-label', t('Fotos y vídeos de la publicación'));
    const items = mediaItemsOf(p);
    p.media.slice(0, PD_MAX_THUMBS).forEach((m, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pd-th' + (m.type === 'video' ? ' vid' : ''); b.setAttribute('role', 'listitem');
      const lab = m.type === 'video' ? t('Ver el vídeo {i} de {n}', { i: i + 1, n: p.media.length }) : t('Ver la foto {i} de {n}', { i: i + 1, n: p.media.length });
      b.title = lab; b.setAttribute('aria-label', lab);
      const src = pdThumbSrc(m);
      const dur = m.type === 'video' ? PostFmt.fmtDuration(m.duration ?? m.durationSec) : '';
      b.innerHTML = (src ? `<img src="${escHtml(src)}" loading="lazy" decoding="async" alt="">` : `<span class="pd-noimg"><span class="ms">${m.type === 'video' ? 'videocam' : 'image'}</span></span>`)
        + (m.type === 'video' ? `<span class="pd-play"><span class="ms fill">play_arrow</span>${dur ? `<i>${escHtml(dur)}</i>` : ''}</span>` : '');
      b.onclick = () => openLightbox(items, i);
      strip.appendChild(b);
    });
    if (p.media.length > PD_MAX_THUMBS) {
      const rest = document.createElement('button');
      rest.type = 'button'; rest.className = 'pd-th pd-rest';
      rest.textContent = '+' + (p.media.length - PD_MAX_THUMBS);
      rest.title = t('Ver todas en grande');
      rest.onclick = () => openLightbox(items, PD_MAX_THUMBS);
      strip.appendChild(rest);
    }
    el.appendChild(strip);
  }
  const more = el.querySelector('.pd-more'), tx = el.querySelector('.pd-text.clamp');
  if (more) more.onclick = () => {
    const open = tx.classList.toggle('clamp') === false;
    more.textContent = open ? t('Ver menos') : t('Ver más'); more.setAttribute('aria-expanded', String(open));
  };
  return el;
}
// «Ver más» solo si el texto recortado de verdad se pasa de 8 líneas. Solo se mide en las filas que se ven (o están a punto de verse):
// medir las 2.000 a la vez obligaría al navegador a maquetarlas todas. Cada medición lee todo junto y escribe después.
function pdMeasureRows(rows) {
  const tx = rows.map((r) => r.querySelector('.pd-text.clamp')).filter(Boolean);
  const over = tx.map((x) => x.scrollHeight > x.clientHeight + 1);
  tx.forEach((x, i) => { const b = x.nextElementSibling; if (b && b.classList.contains('pd-more')) b.hidden = !over[i]; });
  rows.forEach((r) => { const b = r.querySelector('.pd-text:not(.clamp) + .pd-more'); if (b) b.hidden = false; }); // los desplegados mantienen su botón
}
const pdVisible = new Set();
let pdIO = null;
function pdObserve(row) {
  if (!window.IntersectionObserver) return;
  if (!pdIO) {
    pdIO = new IntersectionObserver((es) => {
      const now = [];
      for (const e of es) { if (e.isIntersecting) { pdVisible.add(e.target); now.push(e.target); } else pdVisible.delete(e.target); }
      if (now.length) pdMeasureRows(now);
    }, { rootMargin: '600px 0px' });
  }
  pdIO.observe(row);
}
function pdMeasure() { pdMeasureRows([...pdVisible].filter((r) => r.isConnected)); }
let pdRO = null, pdT = 0;
function pdWatch(feed) {
  if (pdRO || !window.ResizeObserver) return;
  pdRO = new ResizeObserver(() => {
    clearTimeout(pdT);
    pdT = setTimeout(() => { const f = $('#feed'); if (!f.classList.contains('detail')) return; f.classList.toggle('pd-narrow', f.clientWidth < PD_NARROW); pdMeasure(); }, 80);
  });
  pdRO.observe(feed);
}
// Los enlaces del texto y «Ver en Instagram» se abren en el navegador, no dentro de Ecos
$('#feed').addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('.pdetail a[href]');
  if (!a) return;
  e.preventDefault();
  if (/^https?:\/\//i.test(a.getAttribute('href'))) window.api.open(a.getAttribute('href'));
});
// La lista se pinta por tandas: las primeras filas al momento (lo que se ve) y el resto en trozos de pocos milisegundos,
// para que 2.000 publicaciones no bloqueen la ventana. Todas acaban en el DOM (selección, teclado y línea temporal igual que antes).
const FEED_FIRST = 36, FEED_SLICE_MS = 14;
let feedJob = null;
function feedFlush() { if (feedJob) feedJob.flush(); } // termina de pintar lo pendiente (antes de saltar a un mes)
function renderFeed() {
  if (feedJob) feedJob.cancel();
  pdIO?.disconnect(); pdVisible.clear();
  const list = visiblePosts();
  const feed = $('#feed');
  feed.classList.toggle('selecting', selected.size > 0);
  if (!rawPosts.length) { postsLaneUpdate([]); feed.innerHTML = `<div class="empty"><span class="ms fill">photo_library</span><b>${t('Aún no hay publicaciones')}</b><span>${t('Elige un origen arriba o arrastra archivos aquí.')}</span></div>`; return; }
  if (!list.length) { postsLaneUpdate([]); feed.innerHTML = `<div class="empty"><span class="ms">filter_alt_off</span><span>${t('Ninguna publicación coincide con el filtro.')}</span></div>`; return; }
  feed.innerHTML = '';
  const detail = feedLayout() === 'detail';
  feed.classList.toggle('detail', detail);
  feed.classList.toggle('pd-narrow', detail && feed.clientWidth < PD_NARROW);
  // Orden por fecha (recordado) y encabezados por mes y, si hay varias en el mes, por día
  const groups = DateLane.groupByMonth(list, (p) => p.date, dlOrder('posts'));
  const flat = [];
  for (const g of groups) for (const d of g.days) for (const p of d.items) flat.push({ p, g, d });
  let lastG = null, lastD = null;
  const addRow = ({ p, g, d }, frag) => {
    // Cuadrícula: la de siempre, seguida y sin encabezados ni línea temporal; Detalle: por meses y días con línea temporal
    if (detail && g !== lastG) { frag.appendChild(dlMonthHeader(g)); lastG = g; lastD = null; }
    if (detail && g.showDays && d !== lastD) { frag.appendChild(dlDayHeader(d)); lastD = d; }
    const key = keyOf(p);
    const ex = exportOf(p);
    const card = document.createElement('div');
    card.className = 'post' + (selected.has(key) ? ' sel' : '') + (ex && !GONE.includes(ex.status) ? ' done' : '');
    card.tabIndex = 0;
    const first = p.media.find((m) => m.type === 'image') || p.media[0];
    const thumb = first && (first.url || (first.type === 'image' ? fileUrl(first.path) : null));
    const badges = [p, ...(p.alsoOn || [])].map((x) => `<span class="badge ${x.source}">${x.source === 'instagram' ? 'IG' : 'FB'}</span>`).join(' ');
    card.innerHTML = `
      ${thumb ? `<img src="${escHtml(thumb)}" loading="lazy" decoding="async" alt="">` : `<div class="noimg">${t('Sin imagen')}</div>`}
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
    if (detail) {
      const row = document.createElement('div');
      row.className = 'prow';
      row.append(card, postDetail(p));
      frag.appendChild(row);
      pdObserve(row);
    } else frag.appendChild(card);
  };
  let at = 0, timer = 0, dead = false;
  const finish = () => {
    if (detail) pdWatch(feed);
    postsLane.bind(); // los encabezados ya están todos: la línea temporal los vuelve a medir
    feedJob = null;
  };
  const slice = (budget, min) => {
    const t0 = performance.now(), frag = document.createDocumentFragment();
    let n = 0;
    while (at < flat.length && (n < min || performance.now() - t0 < budget)) { addRow(flat[at++], frag); n++; }
    feed.appendChild(frag);
  };
  const tick = () => {
    timer = 0;
    if (dead) return;
    slice(FEED_SLICE_MS, 1);
    if (at < flat.length) timer = setTimeout(tick, 0); else finish();
  };
  feedJob = {
    cancel() { dead = true; clearTimeout(timer); feedJob = null; },
    flush() { clearTimeout(timer); if (dead) return; slice(Infinity, 0); finish(); },
  };
  slice(0, FEED_FIRST); // lo primero se pinta al momento
  postsLaneUpdate(detail ? groups : []);
  if (at < flat.length) timer = setTimeout(tick, 0); else finish();
}
// Rejilla / Detalle (recordado)
function syncLayoutChips() {
  const cur = feedLayout();
  $$('#f-layout [data-l]').forEach((x) => { const on = x.dataset.l === cur; x.classList.toggle('active', on); x.setAttribute('aria-pressed', String(on)); });
}
$$('#f-layout [data-l]').forEach((b) => (b.onclick = () => {
  try { localStorage.setItem('ecos-feed-layout', b.dataset.l); } catch { /* sin almacenamiento */ }
  syncLayoutChips(); renderFeed();
}));
$('#f-layout').setAttribute('aria-label', t('Vista de las publicaciones'));
$$('#f-layout [data-l]').forEach((b) => b.setAttribute('aria-label', t(b.dataset.l === 'grid' ? 'Cuadrícula' : 'Detalle')));
syncLayoutChips();
$('#f-order').value = dlOrder('posts');
$('#f-order').onchange = (e) => { dlSetOrder('posts', e.target.value); renderFeed(); };
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
  $('#f-layout').classList.toggle('hidden', feedCal.on);
  renderFeedCal();
}));

function updateCount() {
  $('#sel-count').textContent = t(selected.size === 1 ? '{n} seleccionada' : '{n} seleccionadas', { n: selected.size });
  $('#make').disabled = selected.size === 0;
  const many = selected.size >= 2;
  $('#make-label').textContent = many ? t('Juntar en una entrada ({n})', { n: selected.size }) : t('Crear entrada');
  $('#make-ic').textContent = many ? 'merge' : 'post_add';
  // Sugerencia: publicaciones sin seleccionar que parecen de la misma actividad
  const rel = many ? relatedToSelection() : [];
  $('#sel-more').classList.toggle('hidden', !rel.length);
  $('#sel-more-t').textContent = t('+{n} de la misma actividad', { n: rel.length });
  // La barra flotante aparece al seleccionar algo (y se oculta mientras el editor está abierto)
  $('#selbar').classList.toggle('show', selected.size > 0 && $('#editor').classList.contains('hidden') && $('#tab-posts').classList.contains('active'));
}
const relatedToSelection = () => Unify.relatedPosts(posts, posts.filter((p) => selected.has(keyOf(p))), { isExported: liveExport });
$('#sel-more').onclick = () => { relatedToSelection().forEach((p) => selected.add(keyOf(p))); updateCount(); renderFeed(); renderFeedCal(); };
$('#sel-clear').onclick = () => { selected.clear(); updateCount(); $$('#feed .post.sel').forEach((c) => c.classList.toggle('sel', false)); $('#feed').classList.toggle('selecting', false); };
async function addPosts(list, select = false) {
  const have = new Set(rawPosts.map(keyOf));
  for (const p of list) {
    if (!have.has(keyOf(p))) rawPosts.push(p);
    if (select) selected.add(keyOf(p));
  }
  rawPosts.sort((a, b) => tsOf(b) - tsOf(a));
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
let fSearchT = 0;
$('#f-search').oninput = () => { clearTimeout(fSearchT); fSearchT = setTimeout(() => { renderFeed(); renderFeedCal(); }, 120); };
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
  } catch (err) { toastError(err); }
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
