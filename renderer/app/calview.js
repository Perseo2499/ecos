// Ecos · Calendario reutilizable (mes y año) para las publicaciones de redes y las entradas del blog.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)
//
// calendarView(box, state, opts)
//   state: { month: Date (día 1), mode: 'month' | 'year' }  — se guarda entre visitas
//   opts.load(from, to)  → Promise<[{ date, title, cls, thumb?, badge? }]>  (lo que hay entre esas fechas)
//   opts.legend          → HTML de la leyenda
//   opts.onItem(item, e, button) → al pulsar un elemento
//   opts.footer(items, from, to, isYear) → HTML bajo el calendario (opcional)
//   opts.beforeLoad(from) → Promise (opcional; p. ej. cargar más publicaciones hasta esa fecha)
const calLoc = () => (prefs().lang === 'en' ? 'en-GB' : 'es-ES');
const calCap = (s) => s.replace(/^./, (c) => c.toUpperCase());
async function calendarView(box, state, opts) {
  const m = state.month, y = m.getFullYear(), mo = m.getMonth(), year = state.mode === 'year';
  const loc = calLoc();
  const from = year ? new Date(y, 0, 1) : new Date(y, mo, 1), to = year ? new Date(y + 1, 0, 1) : new Date(y, mo + 1, 1);
  const title = year ? String(y) : calCap(from.toLocaleDateString(loc, { month: 'long', year: 'numeric' }));
  box.innerHTML = `<div class="cal-bar">
      <button class="btn text icon-only" data-c="-1" title="${t('Anterior')}"><span class="ms">chevron_left</span></button>
      <b class="cal-title">${escHtml(title)}</b>
      <button class="btn text icon-only" data-c="1" title="${t('Siguiente')}"><span class="ms">chevron_right</span></button>
      <button class="btn text" data-c="0">${t('Hoy')}</button>
      <span class="cal-modes"><button class="chip ${year ? '' : 'active'}" data-mode="month">${t('Mes')}</button><button class="chip ${year ? 'active' : ''}" data-mode="year">${t('Año')}</button></span>
      <span class="spacer"></span>
      <span class="cal-legend">${opts.legend || ''}</span>
    </div><div class="cal-body"><p class="hint pad">${t('Cargando…')}</p></div>`;
  const redraw = () => calendarView(box, state, opts);
  $$('[data-c]', box).forEach((b) => (b.onclick = () => {
    const d = Number(b.dataset.c), now = new Date();
    state.month = !d ? new Date(now.getFullYear(), now.getMonth(), 1) : year ? new Date(y + d, mo, 1) : new Date(y, mo + d, 1);
    redraw();
  }));
  $$('[data-mode]', box).forEach((b) => (b.onclick = () => { state.mode = b.dataset.mode; redraw(); }));
  let items;
  try {
    if (opts.beforeLoad) await opts.beforeLoad(from);
    items = (await opts.load(from, to)).filter((it) => { const d = new Date(it.date); return d >= from && d < to; });
  } catch (e) { $('.cal-body', box).innerHTML = `<div class="empty"><span class="ms">cloud_off</span><span>${escHtml(e.message)}</span></div>`; return; }
  if (state.month !== m || (state.mode === 'year') !== year) return; // se cambió mientras cargaba
  const body = $('.cal-body', box);
  const weekdays = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(loc, { weekday: 'short' })); // lunes primero
  const today = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (!year) {
    const byDay = new Map();
    for (const it of items) { const k = new Date(it.date).getDate(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(it); }
    const last = new Date(y, mo + 1, 0).getDate(), lead = (from.getDay() + 6) % 7;
    let cells = weekdays.map((w) => `<div class="cal-wd">${escHtml(w)}</div>`).join('');
    for (let i = 0; i < lead; i++) cells += '<div class="cal-day out"></div>';
    const all = [];
    for (let d = 1; d <= last; d++) {
      const list = (byDay.get(d) || []).sort((a, b) => new Date(a.date) - new Date(b.date));
      const shown = list.slice(0, 4).map((it) => {
        all.push(it);
        return `<button class="cal-item ${escHtml(it.cls || '')}${it.thumb ? ' thumb' : ''}" data-i="${all.length - 1}" title="${escHtml(it.title)}">${it.thumb ? `<img src="${escHtml(it.thumb)}" alt="" loading="lazy">` : ''}${it.badge || ''}<span class="cal-t">${escHtml(it.title)}</span></button>`;
      }).join('');
      cells += `<div class="cal-day${sameDay(today, new Date(y, mo, d)) ? ' today' : ''}${list.length ? ' has' : ''}"><span class="cal-n">${d}</span>${shown}${list.length > 4 ? `<span class="cal-more">+${list.length - 4}</span>` : ''}</div>`;
    }
    body.innerHTML = `<div class="cal-grid">${cells}</div>`;
    $$('.cal-item', body).forEach((b) => (b.onclick = (e) => opts.onItem?.(all[Number(b.dataset.i)], e, b)));
  } else {
    // Año: cada mes con sus días coloreados según cuántas cosas hay (más intenso = más contenido)
    const count = new Map();
    for (const it of items) { const d = new Date(it.date); const k = `${d.getMonth()}-${d.getDate()}`; count.set(k, (count.get(k) || 0) + 1); }
    const perMonth = [...Array(12)].map((_, i) => items.filter((it) => new Date(it.date).getMonth() === i).length);
    const max = Math.max(1, ...perMonth);
    const level = (n) => (!n ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4);
    const months = perMonth.map((n, i) => {
      const first = new Date(y, i, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, i + 1, 0).getDate();
      let g = '';
      for (let k = 0; k < lead; k++) g += '<i class="o"></i>';
      for (let d = 1; d <= days; d++) {
        const c = count.get(`${i}-${d}`) || 0;
        g += `<i class="l${level(c)}${sameDay(today, new Date(y, i, d)) ? ' td' : ''}" title="${escHtml(new Date(y, i, d).toLocaleDateString(loc, { day: 'numeric', month: 'long' }))}: ${c}"></i>`;
      }
      return `<button class="cal-month" data-m="${i}">
        <span class="cal-mh"><b>${escHtml(calCap(first.toLocaleDateString(loc, { month: 'long' })))}</b><span class="cal-mc">${n}</span></span>
        <span class="cal-bar-n"><span style="width:${Math.round((n / max) * 100)}%"></span></span>
        <span class="cal-heat">${g}</span></button>`;
    }).join('');
    body.innerHTML = `<div class="cal-year">${months}</div>
      <div class="cal-scale">${t('Menos')}<i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i>${t('Más')}</div>`;
    $$('.cal-month', body).forEach((b) => (b.onclick = () => { state.mode = 'month'; state.month = new Date(y, Number(b.dataset.m), 1); redraw(); }));
  }
  const foot = opts.footer?.(items, from, to, year);
  if (foot) body.insertAdjacentHTML('beforeend', `<p class="hint cal-sum">${foot}</p>`);
}
