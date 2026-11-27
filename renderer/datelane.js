// Ecos · Lógica pura de la línea temporal (estilo Google Fotos) del Blog y de Redes:
// ordenar por fecha, agrupar por mes y día, proporciones de la franja y paso de posición a mes.
// (Sirve en la app —window.DateLane— y en las pruebas —module.exports—.)
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const dateOf = (d) => (d instanceof Date ? d : new Date(d));
  const valid = (d) => d != null && d !== '' && !Number.isNaN(dateOf(d).getTime());
  // «2026-11» / «2026-11-25» en hora local
  const monthKey = (d) => { const x = dateOf(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };
  const dayKey = (d) => { const x = dateOf(d); return `${monthKey(x)}-${pad(x.getDate())}`; };
  const parseKey = (key) => { const [y, m] = String(key).split('-').map(Number); return { year: y, month: m }; }; // month: 1–12
  const NOKEY = '0000-00'; // elementos sin fecha válida: van al final, en su propio grupo

  // Copia ordenada por fecha: 'desc' = más recientes primero (por defecto), 'asc' = más antiguas primero. Estable; sin fecha, al final.
  function sortItems(items, getDate, order) {
    const get = getDate || ((x) => x.date), sign = order === 'asc' ? 1 : -1;
    return items.map((it, i) => ({ it, i, t: valid(get(it)) ? dateOf(get(it)).getTime() : null }))
      .sort((a, b) => (a.t === null) - (b.t === null) || (a.t === null ? 0 : sign * (a.t - b.t)) || a.i - b.i)
      .map((x) => x.it);
  }
  // Agrupa en meses y, dentro, en días: [{ key, year, month, count, showDays, days: [{ key, date, items }] }]
  // showDays: hay más de un elemento en el mes (entonces se pintan encabezados por día).
  function groupByMonth(items, getDate, order) {
    const get = getDate || ((x) => x.date);
    const out = [];
    let cm = null, cd = null;
    for (const it of sortItems(items, get, order)) {
      const d = get(it), ok = valid(d);
      const mk = ok ? monthKey(d) : NOKEY, dk = ok ? dayKey(d) : NOKEY;
      if (!cm || cm.key !== mk) { const p = parseKey(mk); cm = { key: mk, year: p.year, month: p.month, count: 0, showDays: false, days: [] }; out.push(cm); cd = null; }
      if (!cd || cd.key !== dk) { cd = { key: dk, date: ok ? dateOf(d) : null, items: [] }; cm.days.push(cd); }
      cd.items.push(it); cm.count++;
    }
    for (const m of out) m.showDays = m.count > 1 && m.key !== NOKEY;
    return out;
  }
  // Recuentos por mes a partir de una lista de fechas, en el orden pedido: [{ key, count }]
  function countsByMonth(dates, order) {
    const map = new Map();
    for (const d of dates || []) { if (!valid(d)) continue; const k = monthKey(d); map.set(k, (map.get(k) || 0) + 1); }
    const list = [...map].map(([key, count]) => ({ key, count })).sort((a, b) => (a.key < b.key ? -1 : 1));
    return order === 'asc' ? list : list.reverse();
  }
  // Franja: cada mes ocupa una parte proporcional a su cantidad (con un mínimo para que los meses con una sola entrada se puedan alcanzar).
  // counts: [{ key, count }] en el orden de la lista. Devuelve { total, months: [{ key, year, month, count, start, end, index }], years: [{ year, start, end, first }] } con start/end en 0..1.
  function buildTrack(counts, opts) {
    const list = (counts || []).filter((c) => c.count > 0);
    const total = list.reduce((a, c) => a + c.count, 0);
    if (!list.length) return { total: 0, months: [], years: [] };
    const floor = opts && opts.floor != null ? opts.floor : 1.5; // peso mínimo de un mes (en «entradas»)
    const w = list.map((c) => Math.max(c.count, floor));
    const sum = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    const months = list.map((c, i) => {
      const p = parseKey(c.key), start = acc / sum; acc += w[i];
      return { key: c.key, year: p.year, month: p.month, count: c.count, start, end: acc / sum, index: i };
    });
    const years = [];
    for (const m of months) {
      const last = years[years.length - 1];
      if (last && last.year === m.year) last.end = m.end;
      else years.push({ year: m.year, start: m.start, end: m.end, first: m.key });
    }
    return { total, months, years };
  }
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  // De una posición 0..1 de la franja al mes que hay ahí
  function monthAt(track, frac) {
    const ms = track.months;
    if (!ms.length) return null;
    const f = clamp01(frac);
    let lo = 0, hi = ms.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ms[mid].end <= f) lo = mid + 1; else hi = mid; }
    return ms[lo];
  }
  // De un mes (y cuánto de él ya se ha recorrido, 0..1) a la posición 0..1 de la franja
  function fracOf(track, key, within) {
    const m = track.months.find((x) => x.key === key);
    if (!m) return null;
    return m.start + (m.end - m.start) * clamp01(within || 0);
  }
  // Mes vecino en la franja (delta en meses, con tope en los extremos); con byYear salta al primer mes del año vecino
  function step(track, key, delta, byYear) {
    const ms = track.months;
    if (!ms.length) return null;
    let i = ms.findIndex((m) => m.key === key);
    if (i < 0) i = 0;
    if (byYear) {
      const ys = track.years, yi = Math.max(0, ys.findIndex((y) => y.year === ms[i].year));
      return ys[Math.min(ys.length - 1, Math.max(0, yi + Math.sign(delta)))].first;
    }
    return ms[Math.min(ms.length - 1, Math.max(0, i + delta))].key;
  }
  // Cuántos elementos hay antes del primero de ese mes (en el orden de la lista) y en qué página de «per» elementos cae
  function firstIndexOfMonth(counts, key) {
    let n = 0;
    for (const c of counts) { if (c.key === key) return n; n += c.count; }
    return -1;
  }
  function pageOfMonth(counts, key, per) {
    const i = firstIndexOfMonth(counts, key);
    return i < 0 ? 1 : Math.floor(i / Math.max(1, per)) + 1;
  }
  // Quita las marcas que quedan demasiado juntas (en píxeles): devuelve los índices que se conservan, empezando por la primera
  function thin(pxs, minGap) {
    const keep = [];
    let last = -Infinity;
    pxs.forEach((px, i) => { if (px - last >= minGap) { keep.push(i); last = px; } });
    return keep;
  }
  // Etiquetas con Intl (es / en)
  const loc = (lang) => (lang === 'en' ? 'en-GB' : 'es-ES');
  function monthLabel(key, lang, short) {
    if (key === NOKEY) return lang === 'en' ? 'No date' : 'Sin fecha';
    const { year, month } = parseKey(key);
    const m = new Intl.DateTimeFormat(loc(lang), { month: short ? 'short' : 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)));
    return m.replace(/\.$/, '') + ' ' + year; // «noviembre 2026» / «nov 2026»
  }
  const dayLabel = (d, lang) => new Intl.DateTimeFormat(loc(lang), { weekday: 'long', day: 'numeric' }).formatToParts(dateOf(d))
    .filter((p) => p.type === 'weekday' || p.type === 'day').map((p) => p.value).join(' '); // «martes 25»

  const api = { monthKey, dayKey, parseKey, sortItems, groupByMonth, countsByMonth, buildTrack, monthAt, fracOf, step, firstIndexOfMonth, pageOfMonth, thin, monthLabel, dayLabel, NOKEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DateLane = api;
})(typeof window !== 'undefined' ? window : globalThis);
