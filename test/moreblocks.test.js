// «Más bloques»: lógica pura (.ics, fechas, contador, iconos), salida a WordPress, ida y vuelta y guion de la web.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('../renderer/moreblocks');
const FX = require('../renderer/morefx');
const T = require('../src/transform');
const PB = require('../src/parseblocks');
const { samples } = require('./moreblocks-samples');

// --- Lógica pura --------------------------------------------------------------------------------------------------
test('fechas: lectura, texto en español y fin por defecto', () => {
  assert.deepEqual(M.parseDT('2026-12-05T18:30'), { y: 2026, mo: 12, d: 5, h: 18, mi: 30, all: false });
  assert.equal(M.parseDT('2026-02-30'), null);
  assert.equal(M.parseDT('2026-12-05T25:00'), null);
  assert.equal(M.parseDT('mañana'), null);
  assert.equal(M.whenText('2026-12-05T18:00', '2026-12-05T20:30'), 'sábado 5 de diciembre de 2026, 18:00 – 20:30');
  assert.equal(M.whenText('2026-12-05T18:00', ''), 'sábado 5 de diciembre de 2026, 18:00');
  assert.equal(M.whenText('2026-12-05', '2026-12-07'), 'sábado 5 de diciembre de 2026 – lunes 7 de diciembre de 2026');
  assert.equal(M.whenText('2026-12-31T23:00', '2027-01-01T01:00'), 'jueves 31 de diciembre de 2026, 23:00 – viernes 1 de enero de 2027, 01:00');
  assert.equal(M.stamp(M.endOf('2026-12-31T23:30', '')), '202701010030');
  assert.equal(M.fromStamp('202612051800'), '2026-12-05T18:00');
  assert.equal(M.fromStamp('20261205'), '2026-12-05');
});
test('.ics: hora local, todo el día, escapes y líneas plegadas', () => {
  const s = M.ics({ title: 'Cena, con; amigos', start: '2026-12-05T20:30', end: '2026-12-05T23:00', place: 'Calle Mayor 1, Madrid', text: 'Línea 1<br>Línea 2', url: 'https://x.org/e' });
  assert.match(s, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(s, /\r\nDTSTART:20261205T203000\r\nDTEND:20261205T230000\r\n/);
  assert.match(s, /SUMMARY:Cena\\, con\\; amigos\r\n/);
  assert.match(s, /LOCATION:Calle Mayor 1\\, Madrid\r\n/);
  assert.match(s, /DESCRIPTION:Línea 1\\nLínea 2\r\n/);
  assert.match(s, /URL:https:\/\/x\.org\/e\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n$/);
  assert.equal(M.ics({ title: 'x', start: '2026-12-05T20:30' }), M.ics({ title: 'x', start: '2026-12-05T20:30' }), 'es determinista');
  const all = M.ics({ title: 'Jornada', start: '2026-12-05', end: '2026-12-07' });
  assert.match(all, /DTSTART;VALUE=DATE:20261205\r\nDTEND;VALUE=DATE:20261208\r\n/);
  const sin = M.ics({ title: 'Una hora', start: '2026-12-05T20:30' });
  assert.match(sin, /DTEND:20261205T213000\r\n/);
  const largo = M.ics({ title: 'x', start: '2026-12-05T10:00', text: 'a'.repeat(200) });
  assert.ok(largo.split('\r\n').every((l) => [...l].length <= 75), 'ninguna línea pasa de 75');
  assert.ok(largo.includes('\r\n '), 'las líneas largas se pliegan');
  assert.equal(M.ics({ title: 'x', start: 'no' }), '');
  assert.match(M.icsUri({ title: 'x', start: '2026-12-05T20:30' }), /^data:text\/calendar;charset=utf-8,BEGIN%3AVCALENDAR/);
});
test('enlace a Google Calendar y a mapa', () => {
  const u = M.googleUrl({ title: 'Cena', start: '2026-12-05T20:30', end: '2026-12-05T23:00', place: 'Madrid' });
  assert.match(u, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Cena&dates=20261205T203000\/20261205T230000&location=Madrid/);
  assert.match(M.googleUrl({ title: 'x', start: '2026-12-05' }), /dates=20261205\/20261206/);
  assert.equal(M.googleUrl({ title: 'x', start: '' }), '');
  assert.equal(M.mapLink('Calle Mayor 1, Madrid'), 'https://www.google.com/maps/search/?api=1&query=Calle%20Mayor%201%2C%20Madrid');
});
test('contador: lectura del número, formato y paso final exacto', () => {
  assert.deepEqual(FX.parseCount('20'), { pre: '', suf: '', n: 20, sep: '', dec: 0, dsep: '' });
  assert.equal(FX.parseCount('+1.200').n, 1200);
  assert.equal(FX.parseCount('+1.200').pre, '+');
  assert.equal(FX.parseCount('3,5 M').n, 3.5);
  assert.equal(FX.parseCount('3,5 M').suf, ' M');
  assert.equal(FX.parseCount('12.345.678').n, 12345678);
  assert.equal(FX.parseCount('Mucho'), null);
  for (const txt of ['20', '+1.200', '3,5 M', '98%', '12.345.678 €', '1,234']) {
    const p = FX.parseCount(txt);
    assert.equal(FX.countText(p, 1), txt, 'al final el texto vuelve igual: ' + txt);
  }
  assert.equal(FX.countText(FX.parseCount('1.200'), 0.5), '600');
  assert.equal(FX.countText(FX.parseCount('+1.200'), 0), '+0');
  assert.equal(FX.countText(FX.parseCount('3,5'), 0.5), '1,8');
});
test('iconos: lista de unos 60, nombres y emojis válidos', () => {
  assert.ok(M.ICONS.length >= 58 && M.ICONS.length <= 70, String(M.ICONS.length));
  assert.equal(new Set(M.ICONS.map((i) => i[0])).size, M.ICONS.length, 'sin nombres repetidos');
  assert.equal(M.iconGlyph('star'), '⭐');
  assert.equal(M.iconValue('🍕'), '🍕');
  assert.equal(M.iconValue('<b>'), '');
  assert.equal(M.iconValue('hola'), '');
  assert.equal(M.iconGlyph('rocket_launch'), '🚀');
});

// --- Salida a WordPress e ida y vuelta -----------------------------------------------------------------------------------
const norm = (list) => list.map((b) => { const c = JSON.parse(JSON.stringify(b)); (function strip(x) { if (Array.isArray(x)) x.forEach(strip); else if (x && typeof x === 'object') { delete x.id; Object.values(x).forEach(strip); } })(c); return c; });
for (const [k, mk] of Object.entries(samples)) {
  test('ida y vuelta: ' + k, () => {
    const b = mk();
    const out = T.composeBlocks([b], {});
    assert.ok(out.includes('<!-- wp:group'), 'sale como grupo estándar de WordPress');
    assert.ok(!/<!-- wp:html -->\n<div/.test(out.replace(/<!-- wp:html -->\n<style[\s\S]*$/, '')) || /ecos-mapa/.test(out), 'sin HTML libre salvo el mapa');
    const back = PB.parseBlocks(out);
    assert.equal(back.length, 1, 'un solo bloque al volver');
    assert.equal(back[0].type, b.type, 'se reconoce por su clase');
    assert.equal(T.composeBlocks(back, {}), out, 'al volver a enviar sale idéntico');
    // y los datos que se escribieron vuelven (lo que no se escribe, como los ids, no cuenta)
    const strip = (x) => norm([x])[0];
    const want = strip(b), got = strip(back[0]);
    for (const key of Object.keys(want)) {
      if (['cols'].includes(key)) continue;
      if (want[key] === '' || want[key] === false || (Array.isArray(want[key]) && !want[key].length)) continue;
      if (b.type === 'pdf' && ['height'].includes(key) && want[key] === 600) continue;
      assert.deepEqual(got[key], want[key], `${k}.${key}`);
    }
  });
}
test('pestañas: los bloques de dentro vuelven y también el diseño del bloque', () => {
  const b = samples.tabs();
  b.mt = 32; b.an = 'up'; b.rd = 16; b.hm = true;
  const out = T.composeBlocks([b], {});
  assert.match(out, /ecos-tabs/);
  const back = PB.parseBlocks(out)[0];
  assert.equal(back.type, 'tabs');
  assert.equal(back.cols.length, 2);
  assert.equal(back.cols[0].title, 'Uno');
  assert.deepEqual(back.cols[0].children.map((x) => x.type), ['paragraph', 'heading']);
  assert.equal(back.cols[0].children[0].html, 'Hola <strong>mundo</strong>');
  assert.equal(back.mt, 32);
  assert.equal(back.an, 'up');
  assert.equal(back.rd, 16);
  assert.equal(back.hm, true);
  assert.equal(T.composeBlocks([back], {}), out);
});
test('el diseño universal funciona con cada bloque nuevo', () => {
  for (const [k, mk] of Object.entries(samples)) {
    const b = { ...mk(), mt: 16, mb: 32, rd: 16, sh: 'm', hd: true };
    const out = T.composeBlocks([b], {});
    const back = PB.parseBlocks(out);
    assert.equal(back.length, 1, k);
    assert.equal(back[0].type, b.type, k);
    assert.equal(back[0].mt, 16, k + ' mt');
    assert.equal(back[0].mb, 32, k + ' mb');
    assert.equal(T.composeBlocks(back, {}), out, k + ' idéntico');
  }
});
test('un grupo con la clase pero distinto de lo que escribe Ecos se conserva tal cual (raw)', () => {
  const out = '<!-- wp:group {"className":"ecos-tabs"} -->\n<div class="wp-block-group ecos-tabs"><!-- wp:paragraph -->\n<p>Suelto</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->';
  const back = PB.parseBlocks(out);
  assert.equal(back.length, 1);
  assert.equal(back[0].type, 'raw');
  assert.equal(T.composeBlocks(back, {}), out);
});
test('bloques vacíos no escriben nada', () => {
  const empty = [{ id: 'e1', type: 'tabs', cols: [] }, { id: 'e2', type: 'timeline', items: [] }, { id: 'e3', type: 'figures', items: [{ value: '', label: '' }] }, { id: 'e4', type: 'hotspots', img: null, points: [] },
    { id: 'e5', type: 'compare', before: null, after: null }, { id: 'e6', type: 'faq', items: [{ q: '', html: '' }] }, { id: 'e7', type: 'audio', url: '', title: '' }, { id: 'e8', type: 'pdf', url: '', title: '' }, { id: 'e9', type: 'event', title: '', start: '' }];
  for (const b of empty) assert.equal(T.composeBlocks([b], {}), '', b.type);
});

// --- CSS y guion ------------------------------------------------------------------------------------------------------
test('el CSS va en el bloque ecos-fx solo de lo usado y el guion solo con bloques interactivos', () => {
  const tabs = T.composeBlocks([samples.tabs()], {});
  assert.match(tabs, /<style class="ecos-fx">[^<]*\.ecos-tabs\{/);
  assert.ok(!/\.ecos-timeline\{/.test(tabs), 'solo el CSS de lo que se usa');
  assert.match(tabs, /<script class="ecos-mjs">new Function\(atob\("/);
  const tl = T.composeBlocks([samples.timelineV()], {});
  assert.match(tl, /\.ecos-timeline\{/);
  assert.ok(!/ecos-mjs/.test(tl), 'la línea de tiempo no necesita guion');
  for (const k of ['cards', 'testimonials', 'cta', 'audioFile', 'pdf']) assert.ok(!/ecos-mjs/.test(T.composeBlocks([samples[k]()], {})), k + ' sin guion');
  for (const k of ['tabs', 'figures', 'donateBizum', 'event', 'hotspots', 'compare', 'faq']) assert.match(T.composeBlocks([samples[k]()], {}), /ecos-mjs/, k);
  // con el complemento (helper) el guion no va en la entrada
  assert.ok(!/ecos-mjs/.test(T.composeBlocks([samples.tabs()], { helper: true })));
  assert.match(T.composeBlocks([samples.tabs()], { helper: true }), /\.ecos-tabs\{/);
});
test('el guion codificado de la entrada es JavaScript válido y de una sola línea', () => {
  const out = T.composeBlocks([samples.tabs()], {});
  const b64 = out.match(/atob\("([^"]+)"\)/)[1];
  const src = Buffer.from(b64, 'base64').toString('utf8');
  assert.ok(!/\n/.test(src));
  assert.doesNotThrow(() => new Function(src));
  assert.ok(/prefers-reduced-motion/.test(src), 'el contador respeta «reducir movimiento»');
});
test('el complemento lleva el guion y lo encola solo con las clases de estos bloques', () => {
  const php = fs.readFileSync(path.join(__dirname, '..', 'wp-plugin', 'ecos', 'ecos.php'), 'utf8');
  assert.match(php, /ecos-more\.js/);
  assert.match(php, /preg_match\( '\/ecos-\(\?:tabs\|cifras/, 'condicionado a la clase');
  const js = fs.readFileSync(path.join(__dirname, '..', 'wp-plugin', 'ecos', 'assets', 'ecos-more.js'), 'utf8');
  assert.match(js, /ecos-tabs/);
  assert.match(js, /^\/\/ Generado por scripts\/build-wp-plugin\.js/);
});
