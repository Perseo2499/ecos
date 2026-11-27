// Lógica pura de la línea temporal (renderer/datelane.js): orden, grupos por mes y día, franja proporcional y posición → mes.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/datelane.js');

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const posts = [
  { id: 'a', date: at(2026, 11, 25) }, { id: 'b', date: at(2026, 11, 25, 9) }, { id: 'c', date: at(2026, 11, 3) },
  { id: 'd', date: at(2026, 10, 30) }, { id: 'e', date: at(2025, 1, 15) }, { id: 'f', date: at(2024, 12, 31) },
];

test('claves de mes y día en hora local', () => {
  assert.equal(D.monthKey(new Date(2026, 10, 25)), '2026-11');
  assert.equal(D.dayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.deepEqual(D.parseKey('2026-11'), { year: 2026, month: 11 });
});

test('orden: recientes primero por defecto, antiguas con asc, estable y sin fecha al final', () => {
  const ids = (l) => l.map((x) => x.id).join('');
  assert.equal(ids(D.sortItems(posts)), 'abcdef');
  assert.equal(ids(D.sortItems(posts, null, 'asc')), 'fedcba'); // f e d c b a
  const mixed = [{ id: 'x', date: null }, { id: 'y', date: at(2020, 1, 1) }, { id: 'z', date: 'no es fecha' }, { id: 'w', date: at(2021, 1, 1) }];
  assert.equal(ids(D.sortItems(mixed)), 'wyxz');
  assert.equal(ids(D.sortItems(mixed, null, 'asc')), 'ywxz');
  // no modifica la lista original
  assert.equal(ids(posts), 'abcdef');
});

test('agrupar por mes y día', () => {
  const g = D.groupByMonth(posts);
  assert.deepEqual(g.map((m) => [m.key, m.count, m.showDays]), [['2026-11', 3, true], ['2026-10', 1, false], ['2025-01', 1, false], ['2024-12', 1, false]]);
  assert.deepEqual(g[0].days.map((d) => [d.key, d.items.length]), [['2026-11-25', 2], ['2026-11-03', 1]]);
  const asc = D.groupByMonth(posts, null, 'asc');
  assert.deepEqual(asc.map((m) => m.key), ['2024-12', '2025-01', '2026-10', '2026-11']);
  assert.deepEqual(asc[3].days.map((d) => d.key), ['2026-11-03', '2026-11-25']);
  // el grupo sin fecha va al final y no pinta días
  const sf = D.groupByMonth([{ id: 1, date: null }, { id: 2, date: at(2026, 1, 1) }, { id: 3, date: null }]);
  assert.equal(sf[1].key, D.NOKEY); assert.equal(sf[1].count, 2); assert.equal(sf[1].showDays, false);
});

test('recuentos por mes en el orden pedido', () => {
  const dates = posts.map((p) => p.date);
  assert.deepEqual(D.countsByMonth(dates), [{ key: '2026-11', count: 3 }, { key: '2026-10', count: 1 }, { key: '2025-01', count: 1 }, { key: '2024-12', count: 1 }]);
  assert.deepEqual(D.countsByMonth(dates, 'asc').map((c) => c.key), ['2024-12', '2025-01', '2026-10', '2026-11']);
  assert.deepEqual(D.countsByMonth([null, 'x']), []);
});

test('franja: proporcional a la cantidad, con mínimo, sin huecos y con años', () => {
  const counts = [{ key: '2026-11', count: 30 }, { key: '2026-10', count: 10 }, { key: '2025-12', count: 1 }, { key: '2024-01', count: 59 }];
  const tr = D.buildTrack(counts);
  assert.equal(tr.total, 100);
  assert.equal(tr.months[0].start, 0);
  assert.ok(Math.abs(tr.months.at(-1).end - 1) < 1e-9);
  tr.months.forEach((m, i) => { if (i) assert.ok(Math.abs(m.start - tr.months[i - 1].end) < 1e-9); });
  const size = (m) => m.end - m.start;
  assert.ok(size(tr.months[0]) > size(tr.months[1]) * 2.5); // 30 frente a 10
  assert.ok(size(tr.months[2]) > 0.005);                      // un mes con una entrada sigue siendo alcanzable
  assert.deepEqual(tr.years.map((y) => [y.year, y.first]), [[2026, '2026-11'], [2025, '2025-12'], [2024, '2024-01']]);
  assert.equal(tr.years[0].end, tr.months[1].end);
  assert.deepEqual(D.buildTrack([]), { total: 0, months: [], years: [] });
});

test('posición → mes y mes → posición', () => {
  const tr = D.buildTrack([{ key: '2026-11', count: 50 }, { key: '2026-10', count: 25 }, { key: '2025-03', count: 25 }]);
  assert.equal(D.monthAt(tr, 0).key, '2026-11');
  assert.equal(D.monthAt(tr, 0.49).key, '2026-11');
  assert.equal(D.monthAt(tr, 0.6).key, '2026-10');
  assert.equal(D.monthAt(tr, 0.99).key, '2025-03');
  assert.equal(D.monthAt(tr, 1).key, '2025-03');
  assert.equal(D.monthAt(tr, -3).key, '2026-11');
  assert.equal(D.monthAt(tr, 7).key, '2025-03');
  assert.equal(D.monthAt({ months: [] }, 0.5), null);
  // ida y vuelta
  for (const m of tr.months) assert.equal(D.monthAt(tr, D.fracOf(tr, m.key, 0.5)).key, m.key);
  assert.equal(D.fracOf(tr, '1999-01'), null);
  assert.equal(D.fracOf(tr, '2026-11', 0), 0);
});

test('teclado: mes siguiente/anterior, año siguiente/anterior y topes', () => {
  const tr = D.buildTrack([{ key: '2026-11', count: 3 }, { key: '2026-10', count: 1 }, { key: '2025-03', count: 1 }, { key: '2025-01', count: 1 }, { key: '2023-07', count: 1 }]);
  assert.equal(D.step(tr, '2026-11', 1), '2026-10');
  assert.equal(D.step(tr, '2026-11', -1), '2026-11');
  assert.equal(D.step(tr, '2023-07', 1), '2023-07');
  assert.equal(D.step(tr, '2026-10', 1, true), '2025-03'); // primer mes del año siguiente en la franja
  assert.equal(D.step(tr, '2025-01', -1, true), '2026-11');
  assert.equal(D.step(tr, '2023-07', 1, true), '2023-07');
  assert.equal(D.step({ months: [], years: [] }, 'x', 1), null);
});

test('página de un mes en una lista paginada', () => {
  // 45 entradas: nov 2026 (25), oct 2026 (5), mar 2025 (15) con 20 por página
  const counts = [{ key: '2026-11', count: 25 }, { key: '2026-10', count: 5 }, { key: '2025-03', count: 15 }];
  assert.equal(D.firstIndexOfMonth(counts, '2026-11'), 0);
  assert.equal(D.firstIndexOfMonth(counts, '2026-10'), 25);
  assert.equal(D.firstIndexOfMonth(counts, '2025-03'), 30);
  assert.equal(D.firstIndexOfMonth(counts, '2000-01'), -1);
  assert.equal(D.pageOfMonth(counts, '2026-11', 20), 1);
  assert.equal(D.pageOfMonth(counts, '2026-10', 20), 2);
  assert.equal(D.pageOfMonth(counts, '2025-03', 20), 2);
  assert.equal(D.pageOfMonth(counts, '2025-03', 10), 4);
  assert.equal(D.pageOfMonth(counts, '2000-01', 20), 1);
  // con 311 entradas la última página es la 16 (20 por página)
  assert.equal(D.pageOfMonth([{ key: '2026-01', count: 310 }, { key: '2005-01', count: 1 }], '2005-01', 20), 16);
});

test('marcas demasiado juntas se quitan', () => {
  assert.deepEqual(D.thin([0, 3, 10, 11, 25, 60], 10), [0, 2, 4, 5]);
  assert.deepEqual(D.thin([], 10), []);
});

test('etiquetas en español e inglés', () => {
  assert.equal(D.monthLabel('2026-11', 'es'), 'noviembre 2026');
  assert.equal(D.monthLabel('2026-11', 'en'), 'November 2026');
  assert.match(D.monthLabel('2026-11', 'es', true), /^nov 2026$/);
  assert.equal(D.monthLabel(D.NOKEY, 'es'), 'Sin fecha');
  assert.equal(D.dayLabel(new Date(2026, 10, 25), 'es'), 'miércoles 25');
  assert.equal(D.dayLabel(new Date(2026, 10, 24), 'en'), 'Tuesday 24');
});

test('con cientos de elementos agrupa y calcula deprisa', () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ id: i, date: new Date(2010 + (i % 16), i % 12, 1 + (i % 28), 10).toISOString() }));
  const t0 = Date.now();
  const g = D.groupByMonth(many);
  const tr = D.buildTrack(D.countsByMonth(many.map((x) => x.date)));
  assert.equal(g.reduce((a, m) => a + m.count, 0), 5000);
  assert.equal(tr.total, 5000);
  assert.ok(Date.now() - t0 < 1500);
});
