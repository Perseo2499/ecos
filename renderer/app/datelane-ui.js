// Ecos · Línea temporal lateral (estilo Google Fotos) para las listas de Redes y del Blog.
// Usa la lógica de renderer/datelane.js (window.DateLane). Se carga antes de posts.js y blog.js.
//
// const dl = createDateLane({ name, label, isActive, stickyEl, padEl, list, liveDrag, jump })
//   isActive()      → ¿se muestra ahora? (pestaña, vista y editor)
//   stickyEl()      → barra fija de arriba (filtros) para no quedar debajo de ella
//   padEl()         → elemento al que se le deja sitio a la derecha
//   list()          → contenedor de la lista (con los encabezados [data-dl]) para saber en qué mes se está
//   jump(key, o)    → Promise: lleva la lista a ese mes (o = { smooth, live })
//   dl.update(counts, { order, more })  counts: [{ key, count }] en el orden de la lista; more: { label, run } (meses aún por cargar)
//   dl.bind()       → hay que llamarlo cada vez que se vuelve a pintar la lista (observa los encabezados)
//   dl.refresh()    → recalcula visibilidad y posición
const dlLang = () => (typeof prefs === 'function' && prefs().lang === 'en' ? 'en' : 'es');
const dlOrder = (view) => { try { return localStorage.getItem('ecos-order-' + view) === 'asc' ? 'asc' : 'desc'; } catch { return 'desc'; } };
const dlSetOrder = (view, v) => { try { localStorage.setItem('ecos-order-' + view, v === 'asc' ? 'asc' : 'desc'); } catch { /* sin almacenamiento */ } };
const dlReduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// Encabezados de la lista: mes («noviembre 2026») y día («martes 25»)
function dlMonthHeader(g) {
  const h = document.createElement('h2');
  h.className = 'dl-h'; h.dataset.dl = g.key; h.textContent = DateLane.monthLabel(g.key, dlLang());
  return h;
}
function dlDayHeader(d) {
  const h = document.createElement('h3');
  h.className = 'dl-d'; h.dataset.dlDay = d.key; h.textContent = d.date ? DateLane.dayLabel(d.date, dlLang()) : '';
  return h;
}

// Lleva el scroll de la página al encabezado de un mes (debajo de las barras fijas). Devuelve false si ese mes no está pintado.
// Hueco que dejan arriba las barras fijas una vez pegadas (no cambia al hacer scroll, a diferencia de su posición actual)
function dlStuck(stickyEl) {
  const bar = document.querySelector('.appbar')?.getBoundingClientRect().bottom || 0;
  const s = stickyEl?.()?.offsetHeight || 0;
  return bar + s;
}
function dlScrollTo(list, key, stickyEl, smooth) {
  const h = list && list.querySelector(`[data-dl="${key}"]`);
  if (!h) return false;
  const off = dlStuck(stickyEl) + 10;
  const delta = h.getBoundingClientRect().top - off;
  // suave si el salto es corto; si cruza muchas pantallas, directo (como Google Fotos)
  window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: smooth && !dlReduced() && Math.abs(delta) < innerHeight * 8 ? 'smooth' : 'auto' });
  return true;
}

function createDateLane(cfg) {
  const T = DateLane;
  const el = document.createElement('div');
  el.className = 'dl'; el.hidden = true;
  el.setAttribute('role', 'scrollbar'); el.setAttribute('aria-orientation', 'vertical'); el.tabIndex = 0;
  el.setAttribute('aria-label', cfg.label);
  el.innerHTML = '<div class="dl-track"><div class="dl-marks"></div><div class="dl-hover" aria-hidden="true"></div><div class="dl-now" aria-hidden="true"><span></span></div></div>';
  const track = el.querySelector('.dl-track'), marks = el.querySelector('.dl-marks'), hover = el.querySelector('.dl-hover'), now = el.querySelector('.dl-now');
  const nowTxt = now.firstElementChild;
  document.body.appendChild(el);

  let data = { total: 0, months: [], years: [] }, counts = [], order = 'desc', more = null, capEl = null;
  let curKey = null, headers = [], dragging = false, hovering = false, lock = false;
  let hideT = 0, raf = 0, keyT = 0, laidH = -1, shown = false, idleT = 0;
  const lang = dlLang;
  const pads = () => Array.from([].concat(cfg.padEl ? cfg.padEl() || [] : []));

  // ---- Marcas: años con su etiqueta y puntos de mes (se quitan las que quedan demasiado juntas)
  function layout() {
    const H = track.clientHeight;
    laidH = H;
    if (!H || !data.months.length) { marks.innerHTML = ''; return; }
    const yk = T.thin(data.years.map((y) => y.start * H), 20);
    const yearPx = yk.map((i) => data.years[i].start * H);
    const mk = [];
    data.months.forEach((m) => { if (!data.years.some((y) => y.first === m.key)) mk.push(m); });
    const keepM = T.thin(mk.map((m) => m.start * H), 8).filter((i) => yearPx.every((p) => Math.abs(p - mk[i].start * H) > 12));
    let html = '';
    for (const i of keepM) html += `<i class="dl-dot" style="top:${(mk[i].start * 100).toFixed(3)}%"></i>`;
    for (const i of yk) html += `<span class="dl-y" style="top:${(data.years[i].start * 100).toFixed(3)}%">${data.years[i].year}</span>`;
    marks.innerHTML = html;
  }

  // ---- Indicador de posición («nov 2026»)
  function showNow(sticky) {
    el.classList.add('show');
    clearTimeout(hideT);
    if (!sticky) hideT = setTimeout(() => { if (!dragging && !hovering && document.activeElement !== el) el.classList.remove('show'); }, 1500);
  }
  function setNow(key, within) {
    if (!key) return;
    const m = data.months.find((x) => x.key === key);
    if (!m) return;
    const f = T.fracOf(data, key, within);
    now.style.top = (f * 100).toFixed(3) + '%';
    if (curKey !== key) {
      curKey = key;
      nowTxt.textContent = T.monthLabel(key, lang(), true);
      el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', String(data.months.length - 1));
      el.setAttribute('aria-valuenow', String(m.index)); el.setAttribute('aria-valuetext', T.monthLabel(key, lang()));
    }
  }

  // ---- Posición actual según el scroll. Las posiciones de los encabezados se miden una sola vez (y de nuevo si la lista cambia de tamaño);
  // en cada fotograma (requestAnimationFrame) solo se hace una búsqueda binaria con el scroll: nada de leer el diseño mientras se desplaza.
  let offs = [], listEnd = 0, dirty = true, lro = null;
  function measure() {
    const sy = window.scrollY, lst = cfg.list();
    offs = headers.map((h) => h.getBoundingClientRect().top + sy);
    listEnd = lst ? lst.getBoundingClientRect().bottom + sy : (offs[offs.length - 1] || 0) + 1;
    dirty = false;
  }
  function observe() {
    const lst = cfg.list();
    headers = lst ? [...lst.querySelectorAll('[data-dl]')] : [];
    dirty = true;
    lro?.disconnect();
    if (lst && typeof ResizeObserver !== 'undefined') { lro = new ResizeObserver(() => { dirty = true; schedule(); }); lro.observe(lst); }
  }
  const stickyBottom = () => {
    const bar = document.querySelector('.appbar')?.getBoundingClientRect().bottom || 0;
    const s = cfg.stickyEl?.()?.getBoundingClientRect().bottom || 0;
    return Math.max(bar, s, 0);
  };
  function update() {
    raf = 0;
    if (!shown) return;
    const top = stickyBottom() + 10;
    // La franja no se mueve bajo el puntero mientras se usa (al pegarse la barra de filtros subiría y el clic caería en otro mes)
    if (!hovering && !dragging && el.dataset.top !== String(Math.round(top))) { el.dataset.top = String(Math.round(top)); el.style.top = Math.round(top) + 'px'; }
    if (lock || !headers.length || !data.months.length) return;
    if (dirty) measure();
    const pos = window.scrollY + dlStuck(cfg.stickyEl) + 14;
    let lo = 0, hi = offs.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offs[mid] <= pos) lo = mid; else hi = mid - 1; }
    const end = offs[lo + 1] != null ? offs[lo + 1] : listEnd;
    const within = end - offs[lo] > 1 ? (pos - offs[lo]) / (end - offs[lo]) : 0;
    setNow(headers[lo].dataset.dl, Math.min(1, Math.max(0, within)));
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(update); }
  addEventListener('scroll', () => { if (!shown) return; schedule(); if (!lock) showNow(); else if (!dragging && idleT) settle(160); }, { passive: true });
  addEventListener('resize', () => { dirty = true; schedule(); });
  new ResizeObserver(() => { if (shown && track.clientHeight !== laidH) layout(); }).observe(track);

  // ---- Interacción
  const fracAt = (clientY) => { const r = track.getBoundingClientRect(); return r.height ? (clientY - r.top) / r.height : 0; };
  function showHover(clientY) {
    const m = T.monthAt(data, fracAt(clientY));
    if (!m) return;
    const r = track.getBoundingClientRect();
    hover.textContent = T.monthLabel(m.key, lang());
    hover.style.top = Math.min(r.height, Math.max(0, clientY - r.top)) + 'px';
    el.classList.add('hov');
  }
  let lastJump = null;
  // Mientras la lista se desplaza hacia un mes, el indicador no sigue al scroll (iría pasando por todos los meses del camino):
  // se suelta cuando el scroll lleva un momento quieto.
  function settle(ms) { clearTimeout(idleT); idleT = setTimeout(() => { if (!dragging) { lock = false; schedule(); } }, ms); }
  async function go(key, opt) {
    if (!key) return;
    lastJump = key;
    lock = true;
    try { await cfg.jump(key, opt || {}); } catch { /* el aviso lo da quien carga */ }
    settle(opt && opt.smooth ? 220 : 80);
  }
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovering = true; showNow(true); } });
  el.addEventListener('pointerleave', () => { hovering = false; schedule(); if (!dragging) el.classList.remove('hov'); showNow(false); });
  track.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || dragging) showHover(e.clientY);
    if (!dragging) return;
    const m = T.monthAt(data, fracAt(e.clientY));
    if (m) { setNow(m.key, 0); if (cfg.liveDrag && m.key !== lastJump) go(m.key, { smooth: false, live: true }); }
  });
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !data.months.length) return;
    e.preventDefault();
    dragging = true; el.classList.add('drag'); el.focus({ preventScroll: true });
    try { track.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    const m = T.monthAt(data, fracAt(e.clientY));
    lock = true; lastJump = null; showNow(true); showHover(e.clientY);
    if (m) { setNow(m.key, 0); if (cfg.liveDrag) go(m.key, { smooth: false, live: true }); }
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false; el.classList.remove('drag');
    try { track.releasePointerCapture(e.pointerId); } catch { /* ya soltado */ }
    if (e.type === 'pointercancel') { lock = false; schedule(); return; }
    const m = T.monthAt(data, fracAt(e.clientY));
    if (!(e.pointerType === 'mouse')) el.classList.remove('hov');
    if (m) go(m.key, { smooth: !dlReduced(), live: false }); else lock = false;
    showNow(false);
  };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  el.addEventListener('focus', () => showNow(true));
  el.addEventListener('blur', () => showNow(false));
  el.addEventListener('keydown', (e) => {
    if (!data.months.length) return;
    let k = null;
    const base = curKey || data.months[0].key;
    if (e.key === 'ArrowDown') k = T.step(data, base, 1);
    else if (e.key === 'ArrowUp') k = T.step(data, base, -1);
    else if (e.key === 'PageDown') k = T.step(data, base, 1, true);
    else if (e.key === 'PageUp') k = T.step(data, base, -1, true);
    else if (e.key === 'Home') k = data.months[0].key;
    else if (e.key === 'End') k = data.months[data.months.length - 1].key;
    else return;
    e.preventDefault();
    lock = true; setNow(k, 0); showNow(true); // se ve al momento; el salto, sin prisa si se pulsa varias veces seguidas
    clearTimeout(keyT);
    keyT = setTimeout(() => go(k, { smooth: !dlReduced(), live: false }), 130);
  });

  function buildCap() {
    capEl?.remove(); capEl = null;
    el.classList.toggle('has-more', !!more);
    if (!more) return;
    capEl = document.createElement('button');
    capEl.type = 'button'; capEl.className = 'dl-more'; capEl.title = more.label; capEl.setAttribute('aria-label', more.label);
    capEl.innerHTML = '<span class="ms">more_horiz</span>';
    capEl.onclick = async () => { capEl.disabled = true; try { await more.run(); } finally { if (capEl) capEl.disabled = false; } };
    el.appendChild(capEl);
  }

  const api = {
    el,
    update(c, o) {
      counts = c || []; order = (o && o.order) || order; more = (o && o.more) || null;
      data = T.buildTrack(counts);
      curKey = null;
      el.dataset.order = order;
      buildCap();
      api.refresh(); layout();
      observe(); schedule();
    },
    bind() { observe(); schedule(); },
    counts: () => counts,
    keys: () => data.months.map((m) => m.key),
    current: () => curKey,
    refresh() {
      const on = !!cfg.isActive() && data.months.length > 0;
      if (on !== shown) {
        shown = on; el.hidden = !on;
        if (on) { layout(); observe(); }
      }
      // Solo se toca la clase si hace falta: cambiarla sin más dispararía otra vez el observador de clases
      pads().forEach((x) => { if (x.classList.contains('dl-pad') !== on) x.classList.toggle('dl-pad', on); });
      if (on) schedule();
    },
  };
  // Cambios de pestaña, de vista o de editor: se vigilan las clases (barato) en vez de enganchar cada botón
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => api.refresh());
    const watch = (n) => n && mo.observe(n, { attributes: true, attributeFilter: ['class'] });
    watch(document.body); document.querySelectorAll('.tab').forEach(watch);
    (cfg.watch ? cfg.watch() : []).forEach(watch);
  }
  return api;
}
