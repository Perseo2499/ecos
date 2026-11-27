// SEO completo: lista blanca y mapeo de metas de Yoast SEO y Rank Math, análisis de palabra clave y vistas previas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../renderer/app/seo-meta');

test('la lista blanca de Ecos coincide con la del complemento (seo2.php)', () => {
  const php = fs.readFileSync(path.join(__dirname, '..', 'wp-plugin', 'ecos', 'includes', 'seo2.php'), 'utf8');
  for (const plugin of S.PLUGINS) {
    const block = php.split(new RegExp(`'${plugin}'\\s*=> array\\(`))[1].split('),')[0];
    const keys = [...block.matchAll(/'(\w+)'\s*=>\s*'([\w-]+)'/g)];
    const phpMap = Object.fromEntries(keys.map((m) => [m[1], m[2]]));
    assert.deepEqual(phpMap, S.META[plugin], plugin);
  }
  assert.ok(php.includes(S.RM_TW_SWITCH));
  assert.ok(S.allowedKeys('yoast').every((k) => k.startsWith('_yoast_wpseo_')));
  assert.ok(S.allowedKeys('rankmath').every((k) => k.startsWith('rank_math_')));
  assert.deepEqual(S.allowedKeys('otro'), []);
});

test('Yoast: campos → metas (robots, redes, sin secundarias si no hay Premium)', () => {
  const m = S.toMeta('yoast', { focusKw: ' viaje a Rabat ', extraKw: ['medina'], canonical: 'https://x.org/a/', noindex: true, nofollow: false, ogTitle: 'T', ogImage: 'https://x.org/i.jpg', ogImageId: '7', twDesc: 'D' });
  assert.deepEqual(m, { '_yoast_wpseo_focuskw': 'viaje a Rabat', '_yoast_wpseo_canonical': 'https://x.org/a/', '_yoast_wpseo_meta-robots-noindex': '1', '_yoast_wpseo_meta-robots-nofollow': '0', '_yoast_wpseo_opengraph-title': 'T', '_yoast_wpseo_opengraph-image': 'https://x.org/i.jpg', '_yoast_wpseo_opengraph-image-id': '7', '_yoast_wpseo_twitter-description': 'D' });
  const p = S.toMeta('yoast', { extraKw: ['medina', 'zoco'] }, { premium: true });
  assert.deepEqual(JSON.parse(p['_yoast_wpseo_focuskeywords']), [{ keyword: 'medina', score: 'na' }, { keyword: 'zoco', score: 'na' }]);
});
test('Rank Math: varias palabras en una, robots como lista y Twitter propio', () => {
  const m = S.toMeta('rankmath', { focusKw: 'rabat', extraKw: ['medina', 'Rabat', 'zoco'], noindex: true, nofollow: true, twTitle: 'X' }, { current: { robots: ['index', 'noarchive'] } });
  assert.equal(m.rank_math_focus_keyword, 'rabat, medina, zoco');
  assert.deepEqual(m.rank_math_robots, ['noindex', 'nofollow', 'noarchive']);
  assert.equal(m.rank_math_twitter_title, 'X');
  assert.equal(m.rank_math_twitter_use_facebook, 'off');
  // solo cambia una de las dos casillas: se conserva la otra
  const n = S.toMeta('rankmath', { nofollow: false }, { current: { noindex: true, robots: ['noindex', 'nofollow'] } });
  assert.deepEqual(n.rank_math_robots, ['noindex']);
  // solo secundarias: la principal anterior se conserva
  assert.equal(S.toMeta('rankmath', { extraKw: ['b'] }, { current: { focusKw: 'a' } }).rank_math_focus_keyword, 'a, b');
});
test('solo se escriben claves de la lista blanca y se limpian los valores', () => {
  for (const plugin of S.PLUGINS) {
    const m = S.toMeta(plugin, { focusKw: 'a', canonical: 'javascript:alert(1)', ogImage: 'ftp://x', evil: 'x', _edit_lock: '1', noindex: 'true', ogDesc: 'x'.repeat(900) }, { premium: true });
    for (const k of Object.keys(m)) assert.ok(S.allowedKeys(plugin).includes(k), k);
    assert.ok(!('evil' in m));
    assert.equal(m[S.META[plugin].canonical], '');
    assert.equal(m[S.META[plugin].ogImage], '');
    assert.equal(m[S.META[plugin].ogDesc].length, 400);
  }
  assert.deepEqual(S.toMeta('aioseo', { focusKw: 'a' }), {});
});
test('metas → campos (ida y vuelta con los dos plugins)', () => {
  const f = { focusKw: 'rabat', extraKw: ['medina', 'zoco'], canonical: 'https://x.org/r/', noindex: true, nofollow: true, ogTitle: 'a', ogDesc: 'b', ogImage: 'https://x.org/1.jpg', ogImageId: 5, twTitle: 'c', twDesc: 'd', twImage: 'https://x.org/2.jpg', twImageId: 6 };
  for (const [plugin, opts] of [['yoast', { premium: true }], ['rankmath', {}]]) {
    const meta = S.toMeta(plugin, f, opts);
    assert.deepEqual(S.fromMeta(plugin, meta), f, plugin);
  }
  assert.deepEqual(S.fromMeta('yoast', {}), { focusKw: '', extraKw: [], canonical: '', noindex: false, nofollow: false, ogTitle: '', ogDesc: '', ogImage: '', twTitle: '', twDesc: '', twImage: '', ogImageId: 0, twImageId: 0 });
  assert.equal(S.fromMeta('yoast', { '_yoast_wpseo_meta-robots-noindex': '2' }).noindex, false); // «2» = forzar indexar
});
test('diff: solo lo que cambia', () => {
  const a = { focusKw: 'a', extraKw: ['x'], canonical: '', noindex: false };
  assert.deepEqual(S.diff(a, { ...a }), {});
  assert.deepEqual(S.diff(a, { ...a, noindex: true, extraKw: ['x', 'y'] }), { noindex: true, extraKw: ['x', 'y'] });
  assert.deepEqual(S.diff({}, { ogTitle: ' ', noindex: false }), {});
  assert.deepEqual(S.diff({}, { ogTitle: 'T' }), { ogTitle: 'T' });
});
test('capacidades según plugin, complemento y Premium', () => {
  assert.equal(S.capability({ plugin: null }).why, 'noPlugin');
  assert.equal(S.capability({ plugin: 'yoast', helper: false }).why, 'noHelper');
  const y = S.capability({ plugin: 'yoast', helper: true, premium: false });
  assert.equal(y.why, 'noPremium'); assert.ok(!y.fields.includes('extraKw') && y.fields.includes('canonical'));
  assert.ok(S.capability({ plugin: 'yoast', helper: true, premium: true }).fields.includes('extraKw'));
  assert.ok(S.capability({ plugin: 'rankmath', helper: true }).fields.includes('extraKw'));
});

const ok = { title: 'Primer día en Rabat: guía de la medina', desc: 'Tu primer día en Rabat: qué ver en la medina, la Kasbah y los mejores sitios para comer sin prisas ni multitudes.', keyword: 'primer día en Rabat', slug: 'primer-dia-en-rabat', paragraphs: ['El primer día en Rabat conviene empezarlo temprano.', 'Segundo párrafo.'], headings: ['Qué ver en la medina', 'El primer día en Rabat paso a paso'], alts: ['Primer día en Rabat: una calle de la medina'], imgCount: 1 };
const lv = (r, code) => r.checks.find((c) => c.code === code)?.level;
test('análisis: palabra clave en título, URL, primer párrafo, subtítulo y foto', () => {
  const text = 'El primer día en Rabat conviene empezarlo temprano. ' + 'La ciudad es tranquila y agradable para pasear. '.repeat(40);
  const r = S.analyze({ ...ok, text });
  for (const c of ['kwTitle', 'kwSlug', 'kwIntro', 'kwHeading', 'kwAlt', 'kwDesc', 'titleLen', 'descLen']) assert.equal(lv(r, c), 'ok', c);
  assert.ok(r.score >= 75, 'puntuación ' + r.score);
  const bad = S.analyze({ title: 'Hola', desc: '', keyword: 'rabat', slug: 'hola', paragraphs: ['Nada.'], headings: [], alts: [], imgCount: 2, text: 'Nada.' });
  for (const c of ['kwTitle', 'kwSlug', 'kwIntro', 'kwAlt', 'descLen', 'textLen']) assert.equal(lv(bad, c), 'bad', c);
  assert.ok(bad.score < 25 && bad.level === 'bad', 'puntuación ' + bad.score);
  assert.equal(lv(bad, 'altMissing'), 'bad');
});
test('análisis: sin palabra clave solo avisa de ella; acentos y mayúsculas no importan', () => {
  const r = S.analyze({ ...ok, keyword: '', text: 'x' });
  assert.equal(lv(r, 'kwSet'), 'bad'); assert.ok(!r.checks.some((c) => c.code === 'kwTitle'));
  assert.equal(lv(S.analyze({ ...ok, keyword: 'PRIMER DIA EN RABAT', text: 'x' }), 'kwTitle'), 'ok');
});
test('análisis: densidad aproximada', () => {
  const d = (text) => S.analyze({ ...ok, keyword: 'rabat', text, paragraphs: [text] }).checks.find((c) => c.code === 'density');
  assert.equal(d('rabat ' + 'palabra '.repeat(99)).level, 'ok'); // 1 de 100 → 1 %
  assert.equal(d('palabra '.repeat(100)).level, 'bad'); // 0 %
  assert.equal(d('rabat '.repeat(30) + 'palabra '.repeat(70)).level, 'bad'); // 30 %
  assert.equal(d('rabat ' + 'palabra '.repeat(99)).n, 1);
});
test('vistas previas: Google con URL y tarjetas de Facebook y X con sus respaldos', () => {
  assert.equal(S.googleUrl('https://web.org/', 'mi-entrada', ''), 'web.org › mi-entrada');
  assert.equal(S.googleUrl('web.org', 'x', 'https://www.otra.com/blog/mi-entrada/'), 'otra.com › blog › mi-entrada');
  const s = S.social({ host: 'https://web.org', title: 'Título', desc: 'Desc', featured: 'https://web.org/f.jpg', ogTitle: 'Para Facebook' });
  assert.equal(s.fb.title, 'Para Facebook'); assert.equal(s.fb.host, 'WEB.ORG'); assert.equal(s.fb.image, 'https://web.org/f.jpg');
  assert.equal(s.x.title, 'Para Facebook', 'X cae en lo de Facebook'); assert.equal(s.x.card, 'summary_large_image');
  const t = S.social({ host: 'web.org', title: 'T', desc: 'D', twTitle: 'Para X', twImage: 'https://web.org/x.jpg' });
  assert.equal(t.x.title, 'Para X'); assert.equal(t.fb.title, 'T'); assert.equal(t.x.image, 'https://web.org/x.jpg'); assert.equal(t.fb.image, '');
  assert.equal(S.social({ host: 'a.org', title: 'T' }).x.card, 'summary');
  assert.ok(S.social({ host: 'a', title: 'x'.repeat(200) }).fb.title.length <= 88);
});
