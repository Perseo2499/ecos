// Ecos · Calendario reutilizable (mes y año) para las publicaciones de redes y las entradas del blog.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)
//
// calendarView(box, state, opts)
//   state: { month: Date (día 1), mode: 'month' | 'year' }  — se guarda entre visitas
//   opts.load(from, to)  → Promise<[{ date, title, cls, thumb?, badge? }]>  (lo que hay entre esas fechas)
//   opts.legend          → HTML de la leyenda
//   opts.onItem(item, e, button) → al pulsar un elemento
//   opts.footer(items, from, to, isYear) → HTML bajo el calendario (opcional)
//   opts.onDrop(item, date) → si existe, las entradas se arrastran y los días aceptan soltarlas (date = día elegido, a las 00:00)
//   opts.onAdd(date)     → si existe, un «+» en los días vacíos al pasar el ratón
//   (item.draggable === false impide arrastrar un elemento concreto)
//   opts.beforeLoad(from) → Promise (opcional; p. ej. cargar más publicaciones hasta esa fecha)
const calLoc = () => (prefs().lang === 'en' ? 'en-GB' : 'es-ES');
const calCap = (s) => s.replace(/^./, (c) => c.toUpperCase());
// Arrastre propio del calendario (dataTransfer «text/x-ecos-cal»); lo comparten las entradas del calendario y la bandeja de borradores
const CAL_MIME = 'text/x-ecos-cal';
let calDrag = null;
function calStartDrag(e, item, el) {
  calDrag = item;
  e.dataTransfer.setData(CAL_MIME, String(item.id ?? ''));
  e.dataTransfer.effectAllowed = 'move';
  el.classList.add('dragging');
  document.body.classList.add('dragging-internal', 'dragging-cal'); // así no salta el aviso de «suelta archivos aquí»
}
function calEndDrag() {
  calDrag = null;
  document.body.classList.remove('dragging-internal', 'dragging-cal');
  $$('.cal-item.dragging, .cal-tray-it.dragging').forEach((x) => x.classList.remove('dragging'));
}
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
  } catch (e) { errBox($('.cal-body', box), e, redraw); return; }
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
        return `<button class="cal-item ${escHtml(it.cls || '')}${it.thumb ? ' thumb' : ''}"${opts.onDrop && it.draggable !== false ? ' draggable="true"' : ''} data-i="${all.length - 1}" title="${escHtml(it.title)}">${it.thumb ? `<img src="${escHtml(it.thumb)}" alt="" loading="lazy">` : ''}${it.badge || ''}<span class="cal-t">${escHtml(it.title)}</span></button>`;
      }).join('');
      cells += `<div class="cal-day${sameDay(today, new Date(y, mo, d)) ? ' today' : ''}${list.length ? ' has' : ''}" data-d="${d}"><span class="cal-n">${d}</span>${!list.length && opts.onAdd ? `<button class="cal-add" data-add="${d}" title="${escHtml(t('Nueva entrada para este día'))}"><span class="ms">add</span></button>` : ''}${shown}${list.length > 4 ? `<span class="cal-more">+${list.length - 4}</span>` : ''}</div>`;
    }
    body.innerHTML = `<div class="cal-grid">${cells}</div>`;
    $$('.cal-item', body).forEach((b) => (b.onclick = (e) => opts.onItem?.(all[Number(b.dataset.i)], e, b)));
    $$('.cal-add', body).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); opts.onAdd(new Date(y, mo, Number(b.dataset.add))); }));
    if (opts.onDrop) {
      const grid = $('.cal-grid', body);
      const clear = () => $$('.cal-day.drop-over', grid).forEach((c) => { c.classList.remove('drop-over'); c.removeAttribute('data-drop'); });
      $$('.cal-item[draggable]', body).forEach((b) => {
        b.ondragstart = (e) => calStartDrag(e, all[Number(b.dataset.i)], b);
        b.ondragend = () => { clear(); calEndDrag(); };
      });
      const mine = (e) => calDrag && [...e.dataTransfer.types].includes(CAL_MIME);
      $$('.cal-day[data-d]', grid).forEach((c) => {
        c.ondragover = (e) => {
          if (!mine(e)) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          if (!c.classList.contains('drop-over')) {
            clear(); c.classList.add('drop-over');
            c.dataset.drop = calCap(new Date(y, mo, Number(c.dataset.d)).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'long' }));
          }
        };
        c.ondrop = (e) => {
          if (!mine(e)) return;
          e.preventDefault();
          const item = calDrag, date = new Date(y, mo, Number(c.dataset.d));
          clear(); calEndDrag();
          opts.onDrop(item, date);
        };
      });
      grid.ondragleave = (e) => { if (!grid.contains(e.relatedTarget)) clear(); };
    }
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

// ---- Lógica pura de «mover al día» (se prueba en test/ecos.test.js) ----
// Nueva fecha: el día elegido (año, mes, día) con la hora local de la entrada; sin fecha anterior, a las 10:00.
function calNewDate(oldIso, day, defHour = 10) {
  const o = oldIso ? new Date(oldIso) : null, ok = o && !isNaN(o);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), ok ? o.getHours() : defHour, ok ? o.getMinutes() : 0, ok ? o.getSeconds() : 0);
}
// Qué hacer al soltar una entrada en un día:
//   { action: 'set', status }      → se aplica sin preguntar (borrador/programada hacia una fecha futura: queda programada)
//   { action: 'past', status }     → el día ya pasó: hay que preguntar si se publica (status) o se deja en borrador
//   { action: 'confirm', status }  → ya estaba publicada: hay que confirmar el cambio (status resultante)
function calDropDecision(status, newDate, now = new Date()) {
  const future = newDate.getTime() > now.getTime();
  if (status === 'publish') return { action: 'confirm', status: future ? 'future' : 'publish' };
  if (future) return { action: 'set', status: 'future' };
  return { action: 'past', status: 'publish' };
}
// Valor de un <input type="datetime-local"> («AAAA-MM-DDTHH:MM», hora local)
function calLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { calNewDate, calDropDecision, calLocalInput };
