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
  if (typeof Home !== 'undefined') Home.count(); // recuento real de pendientes, en segundo plano
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
    if (typeof runAutoDrafts === 'function') runAutoDrafts(fresh); // borradores automáticos (Ajustes → Avisos), si están activados
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
  const HL = window.HomeLogic;
  const hs = { drafts: null, health: null, probThumbs: {}, free: null, freeErr: null, loading: false, at: 0, err: null,
    pend: null, counting: false, tok: 0, views: { days: 7, data: {}, err: null, loading: false } };
  const ymd = HL.ymd;
  const lang = () => (prefs().lang === 'en' ? 'en-GB' : 'es-ES');
  const title = (x) => escHtml(decodeEntities(x.title || '') || t('(sin título)'));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const wpOk = () => !!CFG.wpConnected;
  const self = () => CFG.wpMode === 'selfhosted';
  const active = () => $('#tab-home').classList.contains('active');
  const draw = () => { if (active()) render(); };

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
  // silk: serigrafía del tema vinilo [texto, japonés]; solo se ve con vinilo y serigrafías activos
  const card = (cls, icon, head, body, acts = '', silk = null) => `<section class="home-card ${cls}">${silk ? `<div class="home-silk vinyl-only"><span class="silk"><i class="led"></i><span>${silk[0]}</span></span><span class="spacer"></span><span class="silk"><span class="jp">${silk[1]}</span></span></div>` : ''}<header><span class="ms fill">${icon}</span><h2>${head}</h2>${acts}</header>${body}</section>`;
  const thumbsHtml = (list) => list.map((x) => (x.u ? `<img src="${escHtml(x.u)}" alt="" loading="lazy" title="${escHtml(x.tx || '')}">` : `<span class="noimg ms">image</span>`)).join('');

  function newBlock() {
    if (!NS.fresh.length || NS.seen) return '';
    const thumbs = NS.fresh.slice(0, 6).map((p) => { const u = postThumb(p); return u ? `<img src="${escHtml(u)}" alt="" loading="lazy">` : `<span class="noimg ms">image</span>`; }).join('');
    return `<section class="home-new"><span class="ms fill home-new-ic">notifications_active</span>
      <div class="home-new-t"><h2>${escHtml(newSocialTitle(NS.fresh))}</h2><p>${t('Aún no están en tu blog.')}</p><div class="home-thumbs">${thumbs}</div></div>
      <div class="home-new-a"><button class="btn filled" data-h="new-drafts"><span class="ms">edit_square</span>${t('Crear borradores')}</button>
      <button class="btn text" data-h="new-see">${t('Verlas')}</button></div></section>`;
  }

  // ---- recuento real de publicaciones sin pasar al blog (en segundo plano, paginando metaPosts)
  const PK = 'ecos.home.pend';
  const readCache = () => { try { return JSON.parse(localStorage.getItem(PK)); } catch { return null; } };
  const writeCache = (c) => { try { localStorage.setItem(PK, JSON.stringify(c)); } catch { /* sin almacenamiento */ } };
  const pendKey = () => `${$('#page').value}|${CFG.format?.mergeDuplicates !== false ? 1 : 0}`;
  const toThumb = (p) => ({ u: postThumb(p) || '', tx: (p.text || '').slice(0, 80) });
  async function countSocial(force) {
    if (!CFG.metaConnected || !$('#page').value || hs.counting) return;
    const key = pendKey(), c = readCache();
    if (!force && !HL.isStale(c, key)) { hs.pend = { state: 'done', n: c.pending, thumbs: c.thumbs, at: c.at, capped: !!c.capped, igTotal: c.igTotal ?? null }; return draw(); }
    if (!hs.pend && c && c.key === key) hs.pend = { state: 'done', n: c.pending, thumbs: c.thumbs, at: c.at, capped: !!c.capped, old: true };
    const my = ++hs.tok, pageId = $('#page').value;
    hs.counting = true;
    const prev = hs.pend;
    const first = !prev && NS.page.length ? HL.countPending(NS.page, (p) => !!liveExport(p)) : null; // lo que ya se vio al arrancar
    hs.pend = { state: 'counting', n: prev?.n ?? first?.pending ?? 0, thumbs: prev?.thumbs || (first ? first.newest.map(toThumb) : []), at: prev?.at };
    draw();
    try {
      // listado ligero de 100 en 100 (id, texto, fecha y miniatura): no carga las publicaciones en Redes
      let raw = [], cur = null, pages = 0, capped = false, igTotal = prev?.igTotal ?? null;
      for (;;) {
        const r = await window.api.metaLight(pageId, cur);
        if (my !== hs.tok) return;
        raw = raw.concat(r.posts); cur = r.cursors; pages++;
        if (r.igTotal != null) igTotal = r.igTotal;
        const pr = HL.countPending(raw, (p) => !!liveExport(p));
        hs.pend = { state: 'counting', n: pr.pending, thumbs: pr.newest.map(toThumb), at: prev?.at, igTotal, seen: raw.length };
        draw();
        if (!(cur && (cur.facebook || cur.instagram))) break;
        if (pages >= HL.LIMITS.pages || raw.length >= HL.LIMITS.posts) { capped = true; break; }
      }
      const merged = CFG.format?.mergeDuplicates !== false ? await window.api.mergeDuplicates(raw) : raw;
      if (my !== hs.tok) return;
      const res = HL.countPending(merged, (p) => !!liveExport(p));
      const thumbs = res.newest.map(toThumb), at = Date.now();
      writeCache({ key, at, total: res.total, pending: res.pending, thumbs, capped, igTotal });
      hs.pend = { state: 'done', n: res.pending, thumbs, at, capped, igTotal, total: res.total };
    } catch (e) {
      if (my === hs.tok) hs.pend = prev && prev.state === 'done' ? prev : { state: 'error', n: 0, thumbs: [], err: friendlyError(e).text };
    } finally { if (my === hs.tok) { hs.counting = false; draw(); } }
  }
  function socialCard() {
    const p = hs.pend;
    let body;
    if (p) {
      const counting = p.state === 'counting';
      const n = counting ? `${p.n}+` : `${p.n}${p.capped ? '+' : ''}`;
      const label = p.n === 1 && !counting ? t('publicación sin pasar al blog') : t('publicaciones sin pasar al blog');
      body = `<div class="home-big"><b class="${counting ? 'counting' : ''}">${n}</b><span>${label}</span></div>
        ${counting ? `<p class="home-counting"><span class="spin"></span>${p.igTotal != null ? t('contando… {a} revisadas (Instagram tiene {b})', { a: p.seen || 0, b: p.igTotal }) : t('contando…')}</p>`
          : p.at ? `<p class="hint home-count-at">${p.igTotal != null ? t('Instagram: {b} publicaciones', { b: p.igTotal }) + ' · ' : ''}${t('contado {d}', { d: new Date(p.at).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' }) })}</p>` : ''}
        ${p.state === 'error' ? `<p class="hint">${escHtml(p.err)}</p>` : ''}
        ${p.thumbs.length ? `<div class="home-thumbs">${thumbsHtml(p.thumbs)}</div>` : (!counting && p.state === 'done' ? `<p class="hint">${t('Todo lo que tienes en tus redes ya está en el blog.')}</p>` : '')}
        <div class="home-acts"><button class="btn tonal small" data-h="see-all"><span class="ms">arrow_forward</span>${t('Ver todas')}</button>
        <button class="btn text small icon-only" data-h="recount" title="${escHtml(t('Volver a contar'))}"${counting ? ' disabled' : ''}><span class="ms">refresh</span></button></div>`;
    } else if (!CFG.metaConnected || !$('#page')?.value) {
      body = `<div class="home-empty"><span class="ms">link_off</span><span>${t('Conecta primero con Meta en Conexiones.')}</span><button class="btn tonal small" data-h="conn">${t('Ir a Conexiones')}</button></div>`;
    } else body = skel(2);
    return card('home-social', 'dynamic_feed', t('Publicaciones de redes sin pasar al blog'), body, '', ['HOME · 01 FEED', '投稿']);
  }
  const homeMine = () => { try { return localStorage.getItem('ecos-only-mine') === '1'; } catch { return false; } };
  function draftsCard() {
    let body;
    if (!wpOk()) body = needWp();
    else if (!hs.drafts) body = hs.err ? `<p class="hint">${escHtml(hs.err)} <button class="btn text small" data-h="retry"><span class="ms">refresh</span>${t('Reintentar')}</button></p>` : skel(4);
    else if (!hs.drafts.length) body = `<div class="home-empty"><span class="ms">task_alt</span><span>${t('No tienes borradores pendientes.')}</span></div>`;
    else body = `<ul class="home-list">${hs.drafts.map((d) => `<li><div class="home-li-t"><b>${title(d)}</b><span>${authorHtml(d.author)}${t('Editado el {d}', { d: fmtDay(d.modified || d.date) })}</span></div>
      <button class="btn text small" data-h="edit" data-id="${d.id}"><span class="ms">edit</span>${t('Seguir editando')}</button></li>`).join('')}</ul>`;
    const mine = CFG.wpMode === 'selfhosted' && CFG.wpMe?.id ? `<label class="chip b-mine" title="${escHtml(t('Solo las entradas de las que eres autor'))}"><input type="checkbox" data-h="mine"${homeMine() ? ' checked' : ''}><span>${t('Solo las mías')}</span></label>` : '';
    return card('home-drafts', 'edit_note', t('Borradores'), body, mine, ['HOME · 02 DRAFTS', '下書']);
  }

  // ---- carruseles (arrastrables, con flechas)
  const carousel = (cards, id) => `<div class="hc" data-hc="${id}"><button class="hc-arrow l" data-hc-go="-1" aria-label="${escHtml(t('Anterior'))}"><span class="ms">chevron_left</span></button>
    <div class="hc-track">${cards}</div><button class="hc-arrow r" data-hc-go="1" aria-label="${escHtml(t('Siguiente'))}"><span class="ms">chevron_right</span></button></div>`;
  const hcSkel = () => `<div class="hc-skel">${'<i></i>'.repeat(5)}</div>`;

  function reviewCard() {
    let body;
    if (!wpOk()) body = needWp();
    else if (!self()) body = `<p class="hint">${t('La revisión solo está disponible con «Mi web (wp-admin)».')}</p>`;
    else if (!hs.health) body = hs.errHealth ? `<p class="hint">${escHtml(hs.errHealth)} <button class="btn text small" data-h="retry"><span class="ms">refresh</span>${t('Reintentar')}</button></p>` : `${skel(2)}<p class="hint">${t('Comprobando las entradas…')}</p>`;
    else {
      const nc = hs.health.noCat.length, ni = hs.health.noImg.length;
      if (!nc && !ni) body = `<div class="home-empty ok"><span class="ms fill">task_alt</span><span>${t('Todo en orden: todas las entradas tienen categoría e imagen destacada.')}</span></div>`;
      else {
        const items = HL.problemItems(hs.health);
        const cards = items.map((x) => {
          const u = hs.probThumbs[x.id];
          const tags = `${x.cat ? `<span class="hc-tag"><span class="ms">label_off</span>${t('sin categoría')}</span>` : ''}${x.img ? `<span class="hc-tag"><span class="ms">image_not_supported</span>${t('sin imagen')}</span>` : ''}`;
          return `<button class="hc-card" data-h="open" data-id="${x.id}" title="${escHtml(decodeEntities(x.title || ''))}"><span class="hc-th">${u ? `<img src="${escHtml(u)}" alt="" loading="lazy" draggable="false">` : `<span class="ms">${x.img ? 'image_not_supported' : 'article'}</span>`}</span>
            <b>${title(x)}</b><span class="hc-tags">${tags}</span></button>`;
        }).join('');
        body = `<div class="home-rev"><div><b>${nc}</b><span><span class="ms">label_off</span>${t('sin categoría')}</span></div><div><b>${ni}</b><span><span class="ms">image_not_supported</span>${t('sin imagen')}</span></div></div>
          ${carousel(cards, 'rev')}
          <div class="home-acts"><button class="btn tonal small" data-h="review"><span class="ms">fact_check</span>${t('Revisar en el Blog')}</button></div>`;
      }
    }
    return card('home-review', 'fact_check', t('Revisión'), body, '', ['HOME · 03 CHECK', '確認']);
  }
  function freeCard() {
    let body;
    if (!wpOk()) body = needWp();
    else if (!self()) body = `<p class="hint">${t('La biblioteca de medios solo está disponible con «Mi web (wp-admin)».')}</p>`;
    else if (!hs.free) body = hs.freeErr ? `<p class="hint">${escHtml(hs.freeErr)} <button class="btn text small" data-h="retry"><span class="ms">refresh</span>${t('Reintentar')}</button></p>` : `${hcSkel()}<p class="hint">${t('Mirando qué fotos no se usan…')}</p>`;
    else if (!hs.free.total) body = `<div class="home-empty ok"><span class="ms fill">task_alt</span><span>${t('Todas las fotos de la biblioteca están en alguna entrada.')}</span></div>`;
    else {
      const cards = hs.free.items.map((m, i) => `<button class="hc-card ph" data-h="photo" data-i="${i}" title="${escHtml(m.name || '')}"><span class="hc-th"><img src="${escHtml(m.thumb || m.url)}" alt="" loading="lazy" draggable="false"></span><span class="hc-cap">${escHtml(fmtDay(m.date))}</span></button>`).join('');
      body = `<div class="home-big sm"><b>${hs.free.total}</b><span>${t(hs.free.total === 1 ? 'foto sin ninguna entrada' : 'fotos sin ninguna entrada')}</span></div>
        ${carousel(cards, 'free')}<div class="home-acts"><button class="btn tonal small" data-h="unused"><span class="ms">photo_library</span>${t('Ver en Medios')}</button></div>`;
    }
    return card('home-free', 'hide_image', t('Fotos sin entrada'), body, '', ['HOME · 03B PHOTOS', '写真']);
  }

  // ---- agenda: día / semana / mes / año, filtros por estado y días plegables con resumen
  const AGK = 'ecos.home.agenda';
  const ag = (() => {
    let st = {}; try { st = JSON.parse(localStorage.getItem(AGK)) || {}; } catch { /* sin almacenamiento */ }
    return { view: ['day', 'week', 'month', 'year'].includes(st.view) ? st.view : 'week', anchor: new Date(),
      show: { publish: true, future: true, draft: false, ...(st.show || {}) }, all: !!st.all, open: new Set(), cache: new Map(), err: null };
  })();
  const agSave = () => { try { localStorage.setItem(AGK, JSON.stringify({ view: ag.view, show: ag.show, all: ag.all })); } catch { /* sin almacenamiento */ } };
  const agKey = () => { const r = HL.agRange(ag.view, ag.anchor); return `${ymd(r.from)}|${ymd(r.to)}`; };
  const agItems = () => ag.cache.get(agKey()) || null;
  const AG_ST = () => ({ publish: { icon: 'check_circle', label: t('Publicadas') }, future: { icon: 'schedule', label: t('Programadas') }, draft: { icon: 'edit_note', label: t('Borradores') } });
  const AG_ORDER = ['publish', 'future', 'draft'];
  function agPills(list) {
    const c = HL.agCount(list), ST = AG_ST();
    return AG_ORDER.filter((k) => c[k] && ag.show[k]).map((k) => `<span class="ag-pill ${k}" title="${escHtml(`${c[k]} · ${ST[k].label}`)}"><span class="ms">${ST[k].icon}</span>${c[k]}</span>`).join('');
  }
  function agCard(x) {
    const st = EX_STATUS();
    return `<button class="wk-card ${x.status}" data-h="open" data-id="${x.id}"${self() ? ' draggable="true"' : ''} title="${escHtml(decodeEntities(x.title || ''))}">
      <span class="wk-th">${x.image ? `<img src="${escHtml(x.image)}" alt="" loading="lazy" draggable="false">` : '<span class="ms">article</span>'}</span>
      <span class="wk-ct"><b>${title(x)}</b><span class="wk-s ${x.status}"><span class="ms">${(st[x.status] || {}).icon || 'article'}</span>${escHtml((st[x.status] || {}).label || x.status)} · ${escHtml(new Date(x.date).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' }))}</span></span></button>`;
  }
  const dayName = (d, o) => cap(d.toLocaleDateString(lang(), o));
  function agDay(d, list) {
    const k = ymd(d);
    return `<div class="wk-col ag-dayview${k === ymd(new Date()) ? ' today' : ''}" data-day="${k}"><div class="wk-head"><span class="ag-pills">${agPills(list)}</span>
      <button class="btn tonal small" data-h="wk-add" data-day="${k}"><span class="ms">add</span>${t('Nueva entrada para este día')}</button></div>
      ${list.length ? `<div class="ag-daylist">${list.map(agCard).join('')}</div>` : `<span class="wk-none">${t('Nada este día con los filtros elegidos.')}</span>`}</div>`;
  }
  function agWeek(start, vis) {
    const days = HL.weekDays(start, 7), by = HL.groupByWeekday(vis, start, 7), todayK = ymd(new Date());
    return `<div class="wk-cal">${days.map((d, i) => {
      const k = ymd(d), list = by[i], open = ag.all || ag.open.has(k);
      return `<div class="wk-col${k === todayK ? ' today' : ''}${open ? ' open' : ''}" data-day="${k}"><div class="wk-head"><span class="wk-wd">${escHtml(dayName(d, { weekday: 'short' }))}</span><span class="wk-n">${d.getDate()}</span>
        <button class="wk-add" data-h="wk-add" data-day="${k}" title="${escHtml(t('Nueva entrada para este día'))}"><span class="ms">add</span></button></div>
        ${list.length ? `<button class="ag-sum" data-h="ag-open" data-day="${k}" aria-expanded="${open}" title="${escHtml(open ? t('Plegar') : t('Ver las entradas de este día'))}"><span class="ag-pills">${agPills(list)}</span><span class="ms ag-chev">expand_more</span></button>
        <div class="ag-fold"${open ? '' : ' inert'}><div class="wk-list">${list.map(agCard).join('')}</div></div>` : '<span class="wk-none">—</span>'}</div>`;
    }).join('')}</div>`;
  }
  function agMonth(r, vis) {
    const y = r.from.getFullYear(), m = r.from.getMonth(), lead = (r.from.getDay() + 6) % 7, last = new Date(y, m + 1, 0).getDate(), todayK = ymd(new Date());
    const by = new Map();
    for (const x of vis) { const k = ymd(new Date(x.date)); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
    let cells = [...Array(7)].map((_, i) => `<div class="ag-wd">${escHtml(new Date(2024, 0, 1 + i).toLocaleDateString(lang(), { weekday: 'short' }))}</div>`).join('') + '<i class="ag-out"></i>'.repeat(lead);
    for (let d = 1; d <= last; d++) {
      const day = new Date(y, m, d), k = ymd(day), list = by.get(k) || [];
      cells += `<button class="ag-cell${k === todayK ? ' today' : ''}${list.length ? ' has' : ''}" data-h="ag-goday" data-day="${k}" title="${escHtml(dayName(day, { weekday: 'long', day: 'numeric', month: 'long' }))}"><span class="ag-n">${d}</span><span class="ag-pills">${agPills(list)}</span></button>`;
    }
    return `<div class="ag-month">${cells}</div>`;
  }
  function agYear(r, vis) {
    const y = r.from.getFullYear(), now = new Date();
    return `<div class="ag-year">${[...Array(12)].map((_, m) => {
      const list = vis.filter((x) => new Date(x.date).getMonth() === m);
      return `<button class="ag-mon${now.getFullYear() === y && now.getMonth() === m ? ' today' : ''}" data-h="ag-gomonth" data-m="${m}"><b>${escHtml(dayName(new Date(y, m, 1), { month: 'long' }))}</b><span class="ag-pills">${agPills(list) || '<span class="wk-none">—</span>'}</span></button>`;
    }).join('')}</div>`;
  }
  function weekCard() {
    let body, head = t('Agenda');
    if (!wpOk()) body = needWp();
    else {
      const v = ag.view, r = HL.agRange(v, ag.anchor), items = agItems(), now = HL.agIsNow(v, ag.anchor);
      const fmt = (d, o) => d.toLocaleDateString(lang(), o);
      const label = v === 'day' ? dayName(r.from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : v === 'week' ? `${fmt(r.from, { day: 'numeric', month: 'short' })} – ${fmt(HL.addDays(r.to, -1), { day: 'numeric', month: 'short', year: 'numeric' })}`
          : v === 'month' ? dayName(r.from, { month: 'long', year: 'numeric' }) : String(r.from.getFullYear());
      if (now) head = { day: t('Hoy'), week: t('Esta semana'), month: t('Este mes'), year: t('Este año') }[v];
      const vis = (items || []).filter((x) => ag.show[HL.agGroup(x.status)]), tot = HL.agCount(items || []), ST = AG_ST();
      const views = [['day', t('Día')], ['week', t('Semana')], ['month', t('Mes')], ['year', t('Año')]];
      // Barra estándar de calendario: ‹ Hoy › | rango visible (abre el selector de fecha) | Día · Semana · Mes · Año
      body = `<div class="wk-bar" role="toolbar" aria-label="${escHtml(t('Navegar por la agenda'))}">
        <div class="wk-step"><button class="btn text small icon-only" data-h="ag-step" data-d="-1" title="${escHtml(t('Anterior'))} (←)" aria-label="${escHtml(t('Anterior'))}"><span class="ms">chevron_left</span></button>
          <button class="btn tonal small" data-h="ag-today"${now ? ' disabled' : ''} title="${escHtml(t('Volver a hoy'))} (T)">${t('Hoy')}</button>
          <button class="btn text small icon-only" data-h="ag-step" data-d="1" title="${escHtml(t('Siguiente'))} (→)" aria-label="${escHtml(t('Siguiente'))}"><span class="ms">chevron_right</span></button></div>
        <label class="wk-range" title="${escHtml(t('Ir a una fecha'))}"><span class="ms">calendar_month</span><span>${escHtml(label)}</span>
          <input type="date" class="wk-date" value="${ymd(ag.anchor)}" aria-label="${escHtml(t('Ir a una fecha'))}"></label>
        <span class="spacer"></span>
        <div class="seg" role="radiogroup" aria-label="${escHtml(t('Rango de fechas'))}">${views.map(([k, l]) => `<button class="${v === k ? 'active' : ''}" data-h="ag-view" data-v="${k}" role="radio" aria-checked="${v === k}">${l}</button>`).join('')}</div></div>
        <div class="ag-filters" role="group" aria-label="${escHtml(t('Qué mostrar'))}">${AG_ORDER.map((k) => `<button class="chip ag-f ${k}${ag.show[k] ? ' active' : ''}" data-h="ag-filter" data-k="${k}" aria-pressed="${!!ag.show[k]}"><span class="ms">${ag.show[k] ? ST[k].icon : 'visibility_off'}</span>${ST[k].label}<b>${items ? tot[k] : '…'}</b></button>`).join('')}
        ${v === 'week' ? `<span class="spacer"></span><button class="btn text small" data-h="ag-all"><span class="ms">${ag.all ? 'unfold_less' : 'unfold_more'}</span>${ag.all ? t('Plegar días') : t('Desplegar días')}</button>` : ''}</div>`;
      if (ag.err) body += `<p class="hint">${escHtml(ag.err)} <button class="btn text small" data-h="retry"><span class="ms">refresh</span>${t('Reintentar')}</button></p>`;
      body += !items ? `<div class="hc-skel">${'<i></i>'.repeat(5)}</div>` : v === 'day' ? agDay(r.from, vis) : v === 'week' ? agWeek(r.from, vis) : v === 'month' ? agMonth(r, vis) : agYear(r, vis);
    }
    return card('home-week', 'event', head, body, '', ['HOME · 04 AGENDA', '予定']);
  }
  // ---- visitas (complemento ≥ 1.1.0): total, gráfica por día y las entradas más leídas
  const helperReady = () => !!CFG.ecosHelper?.installed && !CFG.ecosHelper.outdated;
  function viewsChart(data) {
    const W = 600, H = 100, bars = HL.viewsBars(data.daily, W, H, data.daily.length > 14 ? 2 : 4);
    const first = data.daily[0]?.day || '', last = data.daily[data.daily.length - 1]?.day || '';
    const fmt = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString(lang(), { day: 'numeric', month: 'short' }); };
    const label = t('Visitas por día, del {a} al {b}: {n} en total', { a: first && fmt(first), b: last && fmt(last), n: data.total });
    const rects = bars.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${Math.max(b.h, 1)}" rx="2" class="${b.views ? '' : 'zero'}"><title>${escHtml(fmt(b.day))}: ${b.views}</title></rect>`).join('');
    return `<figure class="hv-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escHtml(label)}">${rects}</svg>
      <figcaption><span>${escHtml(first && fmt(first))}</span><span>${escHtml(last && fmt(last))}</span></figcaption></figure>`;
  }
  function viewsCard() {
    const v = hs.views, silk = ['HOME · 06 STATS', '統計'];
    let body;
    if (!wpOk() || !self()) body = !wpOk() ? needWp() : `<p class="hint">${t('Las visitas solo están disponibles con «Mi web (wp-admin)» y el complemento de Ecos.')}</p>`;
    else if (!helperReady()) body = `<div class="home-empty"><span class="ms">extension</span><span>${CFG.ecosHelper?.installed ? t('Actualiza el complemento de Ecos para ver las visitas.') : t('Instala el complemento de Ecos para contar las visitas, sin cookies.')}</span><button class="btn tonal small" data-h="conn">${t('Ir a Conexiones')}</button></div>`;
    else {
      const data = v.data[v.days];
      const sel = `<div class="seg" role="radiogroup" aria-label="${escHtml(t('Periodo'))}">${[7, 30].map((d) => `<button class="${v.days === d ? 'active' : ''}" data-h="views-days" data-d="${d}" role="radio" aria-checked="${v.days === d}">${t('{n} días', { n: d })}</button>`).join('')}</div>`;
      let inner;
      if (!data) inner = v.err ? `<p class="hint">${escHtml(v.err)} <button class="btn text small" data-h="retry"><span class="ms">refresh</span>${t('Reintentar')}</button></p>` : `${hcSkel()}`;
      else {
        const top = data.top.length ? `<ol class="hv-top">${data.top.map((x) => `<li><button class="hv-row" data-h="open" data-id="${x.id}"><span class="home-li-t"><b>${escHtml(decodeEntities(x.title) || t('(sin título)'))}</b></span><span class="hv-n">${x.views}</span></button></li>`).join('')}</ol>` : `<p class="hint">${t('Aún no hay visitas en este periodo.')}</p>`;
        inner = `<div class="hv-grid"><div><div class="home-big"><b>${data.total}</b><span>${t(data.total === 1 ? 'visita' : 'visitas')}</span></div>${viewsChart(data)}</div>
          <div><h3 class="hv-h">${t('Más leídas')}</h3>${top}</div></div><p class="hint">${t('Sin cookies ni datos personales: solo cuentas agregadas por día.')}</p>`;
      }
      body = sel + inner;
    }
    return card('home-views', 'monitoring', t('Visitas'), body, '', silk);
  }
  async function viewsLoad(force) {
    const v = hs.views;
    if (!wpOk() || !self() || !helperReady() || v.loading) return;
    if (force) v.data = {};
    const d = v.days;
    if (v.data[d]) return;
    v.loading = true;
    try { v.data[d] = await window.api.helperStats(d); v.err = null; } catch (e) { v.err = friendlyError(e).text; }
    v.loading = false; draw();
  }

  function quickCard() {
    const q = (h, icon, label) => `<button class="home-q" data-h="${h}"><span class="ms">${icon}</span><span>${label}</span></button>`;
    return card('home-quick', 'bolt', t('Accesos rápidos'), `<div class="home-qs">
      ${q('new-post', 'edit_square', t('Nueva entrada'))}${q('new-page', 'note_add', t('Nueva página'))}${q('load', 'download', t('Cargar publicaciones'))}
      ${q('calendar', 'calendar_month', t('Calendario'))}${q('media', 'photo_library', t('Medios'))}</div>`, '', ['HOME · 05 QUICK', '操作']);
  }

  function render() {
    const box = $('#home');
    if (!box) return;
    const sc = $$('.hc-track', box).map((x) => x.scrollLeft), wsc = $('.wk-cal', box)?.scrollLeft || 0;
    box.innerHTML = `${hero()}${newBlock()}<div class="home-grid">${socialCard()}${draftsCard()}${reviewCard()}${freeCard()}${weekCard()}${viewsCard()}${quickCard()}</div>`;
    $$('.hc-track', box).forEach((x, i) => { x.scrollLeft = sc[i] || 0; });
    const w = $('.wk-cal', box); if (w) w.scrollLeft = wsc;
    $$('.hc', box).forEach(hcSync);
  }
  function hcSync(hc) {
    const tr = $('.hc-track', hc);
    hc.classList.toggle('at-start', tr.scrollLeft < 4);
    hc.classList.toggle('at-end', tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 4);
  }

  // ---- datos de la agenda (todas las entradas del rango, de 100 en 100)
  async function agLoad() {
    const key = agKey();
    if (ag.cache.has(key) || !wpOk()) return;
    const r = HL.agRange(ag.view, ag.anchor);
    try {
      let all = [];
      for (let page = 1; page <= 15; page++) {
        const res = await window.api.blogList({ type: 'post', status: 'any', number: 100, page, after: r.from.toISOString(), before: r.to.toISOString() });
        all = all.concat(res.items);
        if (res.items.length < 100 || all.length >= (res.found || 0)) break;
      }
      ag.cache.set(key, all.filter((x) => x.status !== 'trash')); ag.err = null;
    } catch (e) { ag.cache.set(key, []); ag.err = friendlyError(e).text; }
    if (key === agKey()) agPaint();
  }
  function agGo(view, anchor) {
    if (view) ag.view = view;
    if (anchor) ag.anchor = anchor;
    ag.err = null; agSave(); agPaint(); agLoad();
  }
  // Solo se vuelve a pintar la tarjeta de la agenda (el resto de Inicio no se toca)
  function agPaint() {
    const old = $('#home .home-week');
    if (!old || !active()) return draw();
    const tmp = document.createElement('div'); tmp.innerHTML = weekCard();
    const nu = tmp.firstElementChild; nu.classList.add('ag-swap'); old.replaceWith(nu);
  }
  function agFold(col, open) {
    col.classList.toggle('open', open);
    const s = $('.ag-sum', col), f = $('.ag-fold', col);
    if (s) { s.setAttribute('aria-expanded', String(open)); s.title = open ? t('Plegar') : t('Ver las entradas de este día'); }
    if (f) f.inert = !open;
  }
  function agAllBtn(b) { b.innerHTML = `<span class="ms">${ag.all ? 'unfold_less' : 'unfold_more'}</span>${ag.all ? t('Plegar días') : t('Desplegar días')}`; }
  // Tras volver a pintar, el foco vuelve al mismo control (así se puede seguir con el teclado)
  function refocus(sel) { requestAnimationFrame(() => { const el = $(sel) || $('#home .home-week [data-h="ag-step"][data-d="1"]'); el?.focus(); }); }
  // «Ir a una fecha» (selector nativo) y teclado (← → T) con el foco en la agenda
  document.addEventListener('change', (e) => {
    if (!e.target.matches?.('#home .wk-date') || !e.target.value) return;
    const [y, m, d] = e.target.value.split('-').map(Number);
    agGo(null, new Date(y, m - 1, d));
  });
  document.addEventListener('click', (e) => {
    const l = e.target.closest?.('#home .wk-range'); if (!l || e.target.matches('input')) return;
    const i = $('.wk-date', l); try { i.showPicker(); } catch { i.focus(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!e.target.closest?.('#home .home-week') || e.target.matches('input, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const d = e.key === 'ArrowLeft' ? -1 : 1; agGo(null, HL.agStep(ag.view, ag.anchor, d)); refocus(`#home [data-h="ag-step"][data-d="${d}"]`); }
    else if (e.key === 't' || e.key === 'T') { e.preventDefault(); agGo(null, new Date()); refocus('#home [data-h="ag-step"][data-d="1"]'); }
  });

  async function dropOn(item, dayKey) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const date = calNewDate(item.date, new Date(y, m - 1, d)), dec = calDropDecision(item.status, date);
    if (date.getTime() === new Date(item.date).getTime()) return;
    let status = dec.status;
    const name = decodeEntities(item.title || '') || t('(sin título)'), dd = date.toLocaleDateString(lang(), { weekday: 'long', day: 'numeric', month: 'long' });
    if (dec.action === 'confirm') {
      const msg = t('¿Cambiar la fecha de publicación de «{x}» al {d}?', { x: name, d: dd }) + '\n'
        + (status === 'future' ? t('Esa fecha es futura: la entrada pasará a estar programada y dejará de verse hasta entonces.') : t('Cambiará el orden de las entradas en el blog.'));
      if (!(await ask(msg, { ok: t('Cambiar la fecha') }))) return;
    } else if (dec.action === 'past') {
      if (await ask(t('El {d} ya ha pasado. ¿Publicar «{x}» con esa fecha?', { x: name, d: dd }), { ok: t('Publicar con esa fecha'), cancel: t('No publicar') })) status = 'publish';
      else if (await ask(t('¿Dejar «{x}» como borrador con la fecha del {d}?', { x: name, d: dd }), { ok: t('Dejar en borrador'), cancel: t('No mover') })) status = 'draft';
      else return;
    }
    const was = { date: item.date, status: item.status };
    item.date = date.toISOString(); item.status = status; render();
    try {
      await window.api.blogSetDate(item.id, item.date, status);
      toast(status === 'future' ? t('«{x}» programada para el {d}.', { x: name, d: dd }) : status === 'publish' ? t('«{x}» publicada con fecha del {d}.', { x: name, d: dd }) : t('«{x}» queda en borrador con fecha del {d}.', { x: name, d: dd }));
      if (typeof blog !== 'undefined') blog.loaded = false;
    } catch (e) { Object.assign(item, was); render(); toast(t('No se pudo cambiar la fecha: {m}', { m: friendlyError(e).text }), true); }
  }

  async function load(force) {
    if (!wpOk() || hs.loading || (!force && Date.now() - hs.at < 60000)) return;
    hs.loading = true; hs.at = Date.now();
    if (force) ag.cache.clear();
    const jobs = [
      window.api.blogList({ type: 'post', status: 'draft', number: 5, orderby: 'modified', ...(homeMine() && CFG.wpMe?.id ? { author: CFG.wpMe.id } : {}) }).then((r) => { hs.drafts = r.items; hs.err = null; }, (e) => { hs.drafts = hs.drafts || []; hs.err = friendlyError(e).text; }),
      agLoad(),
      viewsLoad(force),
    ];
    jobs.forEach((j) => j.then(draw));
    if (self()) {
      jobs.push((bh.data ? Promise.resolve(bh.data) : window.api.blogHealth(false)).then(async (r) => {
        hs.health = { noCat: r?.noCat || [], noImg: r?.noImg || [] }; hs.errHealth = null;
        if (!bh.data) bh.data = { total: 0, at: Date.now(), ...(r || {}), noCat: hs.health.noCat, noImg: hs.health.noImg };
        draw();
        // miniaturas de las entradas del carrusel (las que tienen imagen destacada)
        const ids = HL.problemItems(hs.health).map((x) => x.id);
        if (ids.length) {
          try {
            const l = await window.api.blogList({ type: 'post', status: 'any', number: ids.length, include: ids });
            for (const x of l.items) if (x.image) hs.probThumbs[x.id] = x.image;
          } catch { /* sin miniaturas: se ve el icono */ }
        }
      }, (e) => { hs.errHealth = friendlyError(e).text; }).then(draw));
      jobs.push(Promise.all([window.api.mediaAll(false), window.api.mediaUsage(false)]).then(([pool, usage]) => { hs.free = HL.unusedPhotos(pool, usage, 20); hs.freeErr = null; }, (e) => { hs.freeErr = friendlyError(e).text; }).then(draw));
    }
    await Promise.allSettled(jobs);
    hs.loading = false; draw();
  }
  function show(force) {
    render(); load(force); countSocial(!!force);
  }

  // Arrastrar los carruseles con el ratón (sin que cuente como clic) y flechas
  let pan = null, panned = false;
  document.addEventListener('pointerdown', (e) => {
    const tr = e.target.closest('#home .hc-track');
    if (!tr || e.button !== 0) return;
    pan = { tr, x: e.clientX, left: tr.scrollLeft }; panned = false;
  });
  document.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x;
    if (Math.abs(dx) > 5) { panned = true; pan.tr.classList.add('panning'); }
    if (panned) { pan.tr.scrollLeft = pan.left - dx; hcSync(pan.tr.parentElement); }
  });
  const endPan = () => { if (pan) { pan.tr.classList.remove('panning'); pan = null; setTimeout(() => { panned = false; }, 0); } };
  document.addEventListener('pointerup', endPan); document.addEventListener('pointercancel', endPan);
  document.addEventListener('click', (e) => { if (panned && e.target.closest('#home .hc-track')) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('scroll', (e) => { const tr = e.target; if (tr?.classList?.contains('hc-track')) hcSync(tr.parentElement); }, true);

  // Arrastrar entradas de un día a otro de la semana
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('#home .wk-card[draggable]'); if (!c) return;
    const item = (agItems() || []).find((x) => x.id === Number(c.dataset.id)); if (!item) return;
    calStartDrag(e, item, c);
  });
  document.addEventListener('dragend', (e) => { if (e.target.closest?.('#home .wk-card')) { calEndDrag(); $$('#home .wk-col.drop-over').forEach((x) => x.classList.remove('drop-over')); } });
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('#home .wk-col'); if (!col || !calDrag || ![...e.dataTransfer.types].includes(CAL_MIME)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    $$('#home .wk-col.drop-over').forEach((x) => x !== col && x.classList.remove('drop-over')); col.classList.add('drop-over');
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest?.('#home .wk-col'); if (!col || !calDrag || ![...e.dataTransfer.types].includes(CAL_MIME)) return;
    e.preventDefault();
    const item = calDrag; calEndDrag(); col.classList.remove('drop-over');
    dropOn(item, col.dataset.day);
  });

  function openUnused() {
    goBlog('media');
    let tries = 0;
    const iv = setInterval(() => {
      const inp = $('#b-media .mg-unused input');
      if (inp) { clearInterval(iv); if (!inp.checked) { inp.checked = true; inp.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (++tries > 40) clearInterval(iv);
    }, 100);
  }

  // Botones de las tarjetas
  document.addEventListener('click', (e) => {
    const go = e.target.closest('#home [data-hc-go]');
    if (go) { const tr = $('.hc-track', go.closest('.hc')); tr.scrollBy({ left: Number(go.dataset.hcGo) * tr.clientWidth * 0.8, behavior: 'smooth' }); return; }
    const b = e.target.closest('#home [data-h]');
    if (!b) return;
    const a = b.dataset.h;
    if (a === 'mine') { try { localStorage.setItem('ecos-only-mine', b.checked ? '1' : '0'); } catch { /* sin almacenamiento */ } return load(true); }
    if (a === 'retry') { hs.err = null; hs.errHealth = null; hs.freeErr = null; hs.views.err = null; ag.err = null; ag.cache.delete(agKey()); return load(true); }
    if (a === 'conn') return showTab('connections');
    if (a === 'views-days') { hs.views.days = Number(b.dataset.d); draw(); viewsLoad(); return; }
    if (a === 'see-all') return goPosts('pending');
    if (a === 'new-see') return goPosts('pending');
    if (a === 'new-drafts') return busy(b, newSocialDrafts);
    if (a === 'new-post') return newDraft({ type: 'post' });
    if (a === 'new-page') return newDraft({ type: 'page' });
    if (a === 'calendar') return goBlog('calendar');
    if (a === 'media') return goBlog('media');
    if (a === 'unused') return openUnused();
    if (a === 'recount') return countSocial(true);
    if (a.startsWith('ag-')) {
      const sel = `#home [data-h="${a}"]${b.dataset.d ? `[data-d="${b.dataset.d}"]` : ''}${b.dataset.v ? `[data-v="${b.dataset.v}"]` : ''}${b.dataset.k ? `[data-k="${b.dataset.k}"]` : ''}${b.dataset.day && a === 'ag-open' ? `[data-day="${b.dataset.day}"]` : ''}`;
      const ymdDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
      if (a === 'ag-step') agGo(null, HL.agStep(ag.view, ag.anchor, Number(b.dataset.d)));
      else if (a === 'ag-today') agGo(null, new Date());
      else if (a === 'ag-view') agGo(b.dataset.v);
      else if (a === 'ag-filter') { ag.show[b.dataset.k] = !ag.show[b.dataset.k]; agSave(); agPaint(); }
      // plegar/desplegar: solo cambia la clase del día (animación en CSS), sin volver a pintar Inicio
      else if (a === 'ag-all') {
        ag.all = !ag.all; ag.open.clear(); agSave();
        $$('#home .home-week .wk-col').forEach((c) => agFold(c, ag.all));
        agAllBtn(b);
        return;
      } else if (a === 'ag-open') {
        const k = b.dataset.day, col = b.closest('.wk-col'), open = !col.classList.contains('open');
        if (ag.all) { ag.all = false; HL.weekDays(HL.weekStart(ag.anchor), 7).forEach((d) => ag.open.add(ymd(d))); agSave(); }
        if (open) ag.open.add(k); else ag.open.delete(k);
        agFold(col, open);
        return;
      } else if (a === 'ag-goday') { agGo('day', ymdDate(b.dataset.day)); return refocus('#home [data-h="ag-view"][data-v="day"]'); }
      else if (a === 'ag-gomonth') { agGo('month', new Date(ag.anchor.getFullYear(), Number(b.dataset.m), 1)); return refocus('#home [data-h="ag-view"][data-v="month"]'); }
      return refocus(sel);
    }
    if (a === 'wk-add') { const [y, m, d] = b.dataset.day.split('-').map(Number); return newDraft({ type: 'post', scheduleAt: calLocalInput(new Date(y, m - 1, d, 10, 0)) }); }
    if (a === 'photo') return openLightbox(hs.free.items.map((m) => ({ type: 'image', src: m.url })), Number(b.dataset.i));
    if (a === 'open') return openFromWp(Number(b.dataset.id), null, 'post');
    if (a === 'edit') return busy(b, () => openFromWp(Number(b.dataset.id), null, 'post'));
    if (a === 'review') {
      try { localStorage.setItem('ecos.bh.open', '1'); } catch { /* sin almacenamiento */ }
      return goBlog('post');
    }
    if (a === 'load') {
      if (!CFG.metaConnected || !$('#page').value) { toast(t('Conecta primero con Meta en Conexiones.'), true); return showTab('connections'); }
      return busy(b, async () => { const n = await loadFirst(); toast(t('{n} publicaciones cargadas', { n })); if (active()) render(); });
    }
  });
  $('#page').addEventListener('change', () => { hs.tok++; hs.counting = false; hs.pend = null; countSocial(); });
  return { render, show, load, goBlog, state: hs, count: countSocial };
})();

// Enganche con showTab (core.js): Inicio se actualiza al entrar y las publicaciones de redes se dan por vistas
window.onTabShown = (name) => {
  if (name === 'home') Home.show();
  if (name === 'posts') markSocialSeen();
  if (name === 'settings') bwNote();
};
