// Historial de versiones: datos válidos, cálculo de «cambios desde la versión X» y que package.json tenga su entrada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../renderer/changelog.js');
const pkg = require('../package.json');

test('los datos son válidos: versiones ordenadas de más nueva a más antigua, fechas, secciones y es/en', () => {
  assert.ok(C.ENTRIES.length > 20);
  const seen = new Set();
  C.ENTRIES.forEach((e, i) => {
    assert.match(e.version, /^\d+\.\d+\.\d+$/);
    assert.ok(!seen.has(e.version), 'versión repetida ' + e.version); seen.add(e.version);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!isNaN(new Date(e.date)), 'fecha válida ' + e.version);
    if (i) {
      assert.ok(C.compareVersions(C.ENTRIES[i - 1].version, e.version) > 0, `orden: ${C.ENTRIES[i - 1].version} antes que ${e.version}`);
      assert.ok(C.ENTRIES[i - 1].date >= e.date, 'fechas no crecientes en ' + e.version);
    }
    if (e.from) assert.ok(C.compareVersions(e.from, e.version) < 0, 'rango ' + e.version);
  });
  for (const e of C.ENTRIES) {
    assert.ok(e.title.es && e.title.en, 'título es/en ' + e.version);
    const keys = Object.keys(e).filter((k) => !['version', 'from', 'date', 'title', 'plugin'].includes(k));
    assert.ok(keys.length, 'sin cambios ' + e.version);
    for (const k of keys) {
      assert.ok(C.SECTIONS.includes(k), 'sección desconocida ' + k);
      assert.ok(Array.isArray(e[k]) && e[k].length, 'sección vacía ' + k);
      for (const it of e[k]) assert.ok(it.es && it.en && it.es !== it.en, `es/en en ${e.version}: ${it.es}`);
    }
    if (e.web) assert.match(e.plugin || '', /^\d+\.\d+\.\d+$/, 'versión del complemento en ' + e.version);
    if (e.plugin) assert.ok(e.web, 'plugin sin «Para tu web» en ' + e.version);
  }
  for (const v of ['3.0.0', '3.0.1', '3.1.0', '3.2.0', '3.3.0', '3.4.0', '3.4.1', '3.5.0']) assert.ok(C.entryFor(v), 'falta ' + v);
});

test('sin jerga: los textos en español no mencionan archivos', () => {
  for (const e of C.ENTRIES) for (const s of C.SECTIONS) for (const it of e[s] || []) assert.doesNotMatch(it.es, /\.(js|json|html|css|php)\b|npm /i, it.es);
});

test('comparar versiones', () => {
  assert.strictEqual(C.compareVersions('3.10.0', '3.9.0'), 1);
  assert.strictEqual(C.compareVersions('3.4.1', '3.4.1'), 0);
  assert.strictEqual(C.compareVersions('2.49.1', '3.0.0'), -1);
});

test('cambios desde la versión X, también con saltos', () => {
  assert.deepStrictEqual(C.changesSince('3.4.0', '3.4.1').map((e) => e.version), ['3.4.1']);
  assert.deepStrictEqual(C.changesSince('3.2.0', '3.5.0').map((e) => e.version), ['3.5.0', '3.4.2', '3.4.1', '3.4.0', '3.3.0']);
  assert.deepStrictEqual(C.changesSince('3.5.0', '3.5.0'), []);
  assert.deepStrictEqual(C.changesSince('3.4.5', '3.5.0').map((e) => e.version), ['3.5.0']);
  const m = C.merge(C.changesSince('3.2.0', '3.5.0'));
  assert.strictEqual(m.plugin, '1.6.0');
  assert.ok(m.new.length > 5 && m.new.every((i) => i.version) && m.web.length === 2);
});

test('package.json tiene entrada en el historial (la primera puede ser igual o mayor)', () => {
  assert.ok(C.compareVersions(C.ENTRIES[0].version, pkg.version) >= 0, `añade la ${pkg.version} a renderer/changelog.js`);
  assert.ok(C.entryFor(pkg.version), `falta la entrada de ${pkg.version} en renderer/changelog.js`);
});

test('el historial se carga en la app', () => {
  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  assert.ok(html.includes('changelog.js') && html.includes('app/changelog-ui.js'));
});
