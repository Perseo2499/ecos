// Ecos · Pantalla «Inicio» y aviso de publicaciones nuevas en redes.
// Inicio se pinta enseguida con lo que ya hay y se rellena al llegar los datos de WordPress (borradores, semana, revisión).
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- aviso de publicaciones nuevas en redes
// fresh: las nuevas (ya juntadas Instagram+Facebook); raw/cursors: lo que devolvió Meta, para cargarlo en la lista
const NS = { fresh: [], raw: [], page: [], cursors: null, newest: null, seen: false }; // page: lo último que se miró en Meta, para Inicio

function paintSocialBadge() {
  const b = $('header nav button[data-tab="posts"]');
  if (!b) return;
  b.querySelector('.tab-badge')?.remove();
  const n = NS.seen ? 0 : NS.fresh.length;
  if (!n) return;
  const el = document.createElement('span');
  el.className = 'tab-badge'; el.textContent = n > 99 ? '99+' : String(n);
  el.title = t('{n} publicaciones nuevas en tus redes', { n });
  b.appendChild(el);
}
// Al arrancar, con una sola página de publicaciones de Meta: cuántas hay posteriores a la última que se vio
async function checkNewSocial() {
  if (!prefs().checkNew || !CFG.metaConnected || !$('#page').value) return;
  try {
    const r = await window.api.metaPosts($('#page').value, ['instagram', 'facebook']);
    const merged = await window.api.mergeDuplicates(r.posts);
    NS.page = merged;
    const { fresh, baseline } = NewPosts.findNew(merged, CFG.lastSeenPostDate, (p) => !!liveExport(p));
    // primera vez: no se avisa de lo que ya había; se empieza a contar desde la más reciente
    if (baseline) { CFG = await window.api.setConfig({ lastSeenPostDate: baseline }); return; }
    if (!fresh.length) return;
    Object.assign(NS, { fresh, raw: r.posts, cursors: r.cursors, newest: NewPosts.newestDate(merged), seen: false });
    paintSocialBadge();
    if ($('#tab-home').classList.contains('active')) Home.render();
    // notificación del sistema (solo si Ecos no está a la vista y los avisos están activados en Ajustes → Avisos)
    if (typeof Notification !== 'undefined' && !document.hasFocus()) {
      try { new Notification('Ecos', { body: newSocialTitle(fresh) }); } catch { /* sin notificaciones */ }
    }
  } catch { /* sin conexión: no se avisa */ }
}
function newSocialTitle(list) {
  const nets = NewPosts.networks(list).map((n) => (n === 'instagram' ? 'Instagram' : 'Facebook')).join(' / ') || 'Instagram / Facebook';
  return t(list.length === 1 ? 'Hay {n} publicación nueva de {r}' : 'Hay {n} publicaciones nuevas de {r}', { n: list.length, r: nets });
}
// Al entrar en la pestaña de redes se dan por vistas
function markSocialSeen() {
  if (!NS.fresh.length || NS.seen) return;
  NS.seen = true; paintSocialBadge();
  if (NS.newest) window.api.setConfig({ lastSeenPostDate: NS.newest }).then((c) => { CFG = c; }).catch(() => {});
}
// «Crear borradores»: carga las nuevas en la lista, las selecciona y abre el flujo normal de crear la entrada
async function newSocialDrafts() {
  const { fresh, raw, cursors: cur } = NS;
  if (!fresh.length) return;
  if (!cursors) cursors = cur;
  await addPosts(raw);
  selected.clear(); fresh.forEach((p) => selected.add(keyOf(p)));
  $('#f-show').value = 'pending'; renderFeed(); renderFeedCal(); updateCount();
  showTab('posts');
  if (CFG.wpConnected) await makeDraft();
}
// Foto de una publicación de redes (la primera)
function postThumb(p) {
  const first = p.media?.find((m) => m.type === 'image') || p.media?.[0];
  return first && (first.url || (first.type === 'image' ? fileUrl(first.path) : null));
}

// ---------------------------------------------------------------- Inicio
const Home = (() => {
  const hs = { drafts: null, week: null, health: null, loading: false, at: 0, err: null };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const lang = () => (prefs().lang === 'en' ? 'en-GB' : 'es-ES');
  const title = (x) => escHtml(decodeEntities(x.title || '') || t('(sin título)'));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const wpOk = () => !!CFG.wpConnected;

  const goBlog = (type) => { showTab('blog'); $(`#b-type [data-type="${type}"]`)?.click(); };
  const goPosts = (filter) => { if (filter) { $('#f-show').value = filter; renderFeed(); renderFeedCal(); } showTab('posts'); };

  function hero() {
    const h = new Date().getHours();
    const hi = h < 6 || h >= 20 ? t('Buenas noches') : h < 13 ? t('Buenos días') : t('Buenas tardes');
    const date = cap(new Date().toLocaleDateString(lang(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    const site = CFG.wpSiteLabel || CFG.wpSite || '';
    return `<div class="home-hero"><div class="home-hi"><h1>${hi}</h1><p>${escHtml(date)}</p></div>
      ${site ? `<div class="home-site"><span class="ms fill">language</span><span>${escHtml(site)}</span></div>` : ''}</div>`;
  }
  const skel = (n = 3) => `<div class="home-skel">${'<i></i>'.repeat(n)}</div>`;
  const needWp = () => `<div class="home-empty"><span class="ms">link_off</span><span>${t('Conecta tu WordPress para ver esto.')}</span><button class="btn tonal small" data-h="conn">${t('Ir a Conexiones')}</button></div>`;
  const card = (cls, icon, head, body, acts = '') => `<section class="home-card ${cls}"><header><span class="ms fill">${icon}</span><h2>${head}</h2>${acts}</header>${body}</section>`;

  function newBlock() {
    if (!NS.fresh.length || NS.seen) return '';
    const thumbs = NS.fresh.slice(0, 6).map((p) => { const u = postThumb(p); return u ? `<img src="${escHtml(u)}" alt="" loading="lazy">` : `<span class="noimg ms">image</span>`; }).join('');
    return `<section class="home-new"><span class="ms fill home-new-ic">notifications_active</span>
      <div class="home-new-t"><h2>${escHtml(newSocialTitle(NS.fresh))}</h2><p>${t('Aún no están en tu blog.')}</p><div class="home-thumbs">${thumbs}</div></div>
      <div class="home-new-a"><button class="btn filled" data-h="new-drafts"><span class="ms">edit_square</span>${t('Crear borradores')}</button>
      <button class="btn text" data-h="new-see">${t('Verlas')}</button></div></section>`;
  }
  function socialCard() {
    // con la lista cargada, lo de la lista; si no, lo de la última mirada a Meta al arrancar
    const src = rawPosts.length ? posts : NS.page;
    const pend = src.length ? src.filter((p) => !liveExport(p)) : null;
    let body;
    if (!pend) {
      body = `<div class="home-empty"><span class="ms">cloud_download</span><span>${t('Todavía no has cargado publicaciones de tus redes en esta sesión.')}</span>
        <button class="btn tonal small" data-h="load"><span class="ms">download</span>${t('Cargar publicaciones')}</button></div>`;
    } else {
      const thumbs = pend.slice(0, 6).map((p) => { const u = postThumb(p); return u ? `<img src="${escHtml(u)}" alt="" loading="lazy" title="${escHtml((p.text || '').slice(0, 80))}">` : `<span class="noimg ms">image</span>`; }).join('');
      body = `<div class="home-big"><b>${pend.length}</b><span>${t(pend.length === 1 ? 'publicación sin pasar al blog' : 'publicaciones sin pasar al blog')}</span></div>
        ${pend.length ? `<div class="home-thumbs">${thumbs}</div>` : `<p class="hint">${t('Todo lo que has cargado ya está en el blog.')}</p>`}
        <div class="home-acts"><button class="btn tonal small" data-h="see-all"><span class="ms">arrow_forward</span>${t('Ver todas')}</button></div>`;
    }
    return card('home-social', 'dynamic_feed', t('Publicaciones de redes sin pasar al blog'), body);
  }
  function draftsCard() {
    let body;
    if (!wpOk()) body = needWp();
    else if (!hs.drafts) body = hs.err ? `<p class="hint">${escHtml(hs.err)} <button class="btn text small" data-h="retry"><span class="ms">refresh</span>${t('Reintentar')}</button></p>` : skel(4);
    else if (!hs.drafts.length) body = `<div class="home-empty"><span class="ms">task_alt</span><span>${t('No tienes borradores pendientes.')}</span></div>`;
    else body = `<ul class="home-list">${hs.drafts.map((d) => `<li><div class="home-li-t"><b>${title(d)}</b><span>${t('Editado el {d}', { d: fmtDay(d.modified || d.date) })}</span></div>
      <button class="btn text small" data-h="edit" data-id="${d.id}"><span class="ms">edit</span>${t('Seguir editando')}</button></li>`).join('')}</ul>`;
    return card('home-drafts', 'edit_note', t('Borradores'), body);
  }
  function weekCard() {
    let body;
    if (!wpOk()) body = needWp();
    else if (!hs.week) body = skel(3);
    else {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = Array.from({ length: 15 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() + i - 7); return d; });
      const by = new Map();
      for (const it of hs.week) { const k = ymd(new Date(it.date)); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
      const wd = new Intl.DateTimeFormat(lang(), { weekday: 'narrow' });
      const strip = days.map((d) => {
        const its = by.get(ymd(d)) || [];
        return `<div class="wk-day${d.getTime() === today.getTime() ? ' today' : ''}${its.length ? ' has' : ''}" title="${escHtml(d.toLocaleDateString(lang(), { weekday: 'long', day: 'numeric', month: 'long' }))}">
          <span class="wk-wd">${escHtml(wd.format(d))}</span><span class="wk-n">${d.getDate()}</span>
          <span class="wk-dots">${its.slice(0, 3).map((x) => `<i class="${x.status === 'future' ? 'fut' : 'pub'}"></i>`).join('')}</span></div>`;
      }).join('');
      const sched = hs.week.filter((x) => x.status === 'future').length, pub = hs.week.filter((x) => x.status === 'publish').length;
      const list = [...hs.week].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
      body = `<div class="wk-sum"><span><i class="pub"></i>${t(pub === 1 ? '{n} publicada' : '{n} publicadas', { n: pub })}</span><span><i class="fut"></i>${t(sched === 1 ? '{n} programada' : '{n} programadas', { n: sched })}</span></div>
        <div class="wk-strip">${strip}</div>
        ${list.length ? `<ul class="home-list sm">${list.map((x) => `<li><span class="wk-st ${x.status === 'future' ? 'fut' : 'pub'}"><span class="ms">${x.status === 'future' ? 'schedule' : 'check_circle'}</span></span>
          <div class="home-li-t"><b>${title(x)}</b><span>${escHtml(fmtDate(x.date))}</span></div>
          <button class="btn text small icon-only" data-h="edit" data-id="${x.id}" title="${escHtml(t('Abrir en el editor'))}"><span class="ms">edit</span></button></li>`).join('')}</ul>`
          : `<p class="hint">${t('No hay nada publicado ni programado en estos días.')}</p>`}`;
    }
    return card('home-week', 'event', t('Esta semana'), body, `<span class="hint">${t('7 días atrás y 7 por delante')}</span>`);
  }
  function reviewCard() {
    let body;
    if (!wpOk()) body = needWp();
    else if (CFG.wpMode !== 'selfhosted') body = `<p class="hint">${t('La revisión solo está disponible con «Mi web (wp-admin)».')}</p>`;
    else if (!hs.health) body = hs.errHealth ? `<p class="hint">${escHtml(hs.errHealth)} <button class="btn text small" data-h="retry"><span class="ms">refresh</span>${t('Reintentar')}</button></p>` : `${skel(2)}<p class="hint">${t('Comprobando las entradas…')}</p>`;
    else {
      const nc = hs.health.noCat.length, ni = hs.health.noImg.length;
      body = !nc && !ni ? `<div class="home-empty ok"><span class="ms fill">task_alt</span><span>${t('Todo en orden: todas las entradas tienen categoría e imagen destacada.')}</span></div>`
        : `<div class="home-rev"><div><b>${nc}</b><span><span class="ms">label_off</span>${t('sin categoría')}</span></div><div><b>${ni}</b><span><span class="ms">image_not_supported</span>${t('sin imagen')}</span></div></div>
          <div class="home-acts"><button class="btn tonal small" data-h="review"><span class="ms">fact_check</span>${t('Revisar en el Blog')}</button></div>`;
    }
    return card('home-review', 'fact_check', t('Revisión'), body);
  }
  function quickCard() {
    const q = (h, icon, label) => `<button class="home-q" data-h="${h}"><span class="ms">${icon}</span><span>${label}</span></button>`;
    return card('home-quick', 'bolt', t('Accesos rápidos'), `<div class="home-qs">
      ${q('new-post', 'edit_square', t('Nueva entrada'))}${q('new-page', 'note_add', t('Nueva página'))}${q('load', 'download', t('Cargar publicaciones'))}
      ${q('calendar', 'calendar_month', t('Calendario'))}${q('media', 'photo_library', t('Medios'))}</div>`);
  }

  function render() {
    const box = $('#home');
    if (!box) return;
    box.innerHTML = `${hero()}${newBlock()}<div class="home-grid">${socialCard()}${draftsCard()}${reviewCard()}${weekCard()}${quickCard()}</div>`;
  }

  async function load(force) {
    if (!wpOk() || hs.loading || (!force && Date.now() - hs.at < 60000)) return;
    hs.loading = true; hs.at = Date.now();
    const draw = () => { if ($('#tab-home').classList.contains('active')) render(); };
    const now = Date.now(), DAY = 864e5;
    const jobs = [
      window.api.blogList({ type: 'post', status: 'draft', number: 5, orderby: 'modified' }).then((r) => { hs.drafts = r.items; hs.err = null; }, (e) => { hs.drafts = hs.drafts || []; hs.err = friendlyError(e).text; }),
      window.api.blogList({ type: 'post', status: 'any', number: 50, after: new Date(now - 7 * DAY).toISOString(), before: new Date(now + 7 * DAY).toISOString() })
        .then((r) => { hs.week = r.items.filter((x) => x.status === 'publish' || x.status === 'future'); }, () => { hs.week = hs.week || []; }),
    ];
    // las dos primeras salen enseguida; la revisión recorre toda la web y llega después
    jobs.forEach((j) => j.then(draw));
    if (CFG.wpMode === 'selfhosted') {
      jobs.push((bh.data ? Promise.resolve(bh.data) : window.api.blogHealth(false)).then((r) => {
        hs.health = { noCat: r?.noCat || [], noImg: r?.noImg || [] }; hs.errHealth = null;
        if (!bh.data) bh.data = { total: 0, at: Date.now(), ...(r || {}), noCat: hs.health.noCat, noImg: hs.health.noImg };
      }, (e) => { hs.errHealth = friendlyError(e).text; }).then(draw));
    }
    await Promise.allSettled(jobs);
    hs.loading = false; draw();
  }
  function show(force) { render(); load(force); }

  // Botones de las tarjetas
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#home [data-h]');
    if (!b) return;
    const a = b.dataset.h;
    if (a === 'retry') { hs.err = null; hs.errHealth = null; return load(true); }
    if (a === 'conn') return showTab('connections');
    if (a === 'see-all') return goPosts('pending');
    if (a === 'new-see') return goPosts('pending');
    if (a === 'new-drafts') return busy(b, newSocialDrafts);
    if (a === 'new-post') return newDraft({ type: 'post' });
    if (a === 'new-page') return newDraft({ type: 'page' });
    if (a === 'calendar') return goBlog('calendar');
    if (a === 'media') return goBlog('media');
    if (a === 'edit') return busy(b, () => openFromWp(Number(b.dataset.id), null, 'post'));
    if (a === 'review') {
      try { localStorage.setItem('ecos.bh.open', '1'); } catch { /* sin almacenamiento */ }
      return goBlog('post');
    }
    if (a === 'load') {
      if (!CFG.metaConnected || !$('#page').value) { toast(t('Conecta primero con Meta en Conexiones.'), true); return showTab('connections'); }
      return busy(b, async () => { const n = await loadFirst(); toast(t('{n} publicaciones cargadas', { n })); if ($('#tab-home').classList.contains('active')) render(); });
    }
  });
  return { render, show, load, goBlog };
})();

// Enganche con showTab (core.js): Inicio se actualiza al entrar y las publicaciones de redes se dan por vistas
window.onTabShown = (name) => {
  if (name === 'home') Home.show();
  if (name === 'posts') markSocialSeen();
  if (name === 'settings') bwNote();
};
