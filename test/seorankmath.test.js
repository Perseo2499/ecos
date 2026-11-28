// Rank Math: se detecta aunque Yoast siga activo, la caché es corta y se vacía, y título y descripción van por el complemento (1.8.1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const W = require('../src/wpself');
const S = require('../renderer/app/seo-meta');

test('detección: solo Rank Math, solo Yoast y los dos a la vez (gana Rank Math, con aviso)', () => {
  assert.equal(W.detectSeo({ namespaces: ['rankmath/v1'] }).plugin, 'rankmath');
  assert.equal(W.detectSeo({ namespaces: ['yoast/v1'], hasYoastHead: true }).plugin, 'yoast');
  const both = W.detectSeo({ namespaces: ['yoast/v1', 'rankmath/v1'], hasYoastHead: true, meta: { _yoast_wpseo_metadesc: '' } });
  assert.equal(both.plugin, 'rankmath');
  assert.equal(both.both, true);
  assert.equal(both.writable, false, 'no se escribe en el meta de Yoast cuando se usa Rank Math');
  assert.equal(W.detectSeo({ namespaces: ['yoast/v1'] }).both, false);
  // con el complemento (campo seo de ecos/v1/status) es la fuente principal
  const h = W.detectSeo({ namespaces: ['yoast/v1'], hasYoastHead: true, helperSeo: { plugin: 'rankmath', both: true, version: '1.0.230' } });
  assert.deepEqual([h.plugin, h.both, h.version], ['rankmath', true, '1.0.230']);
  assert.equal(W.detectSeo({ namespaces: ['rankmath/v1'], helperSeo: { plugin: '', both: false, version: '' } }).plugin, null);
  assert.equal(W.detectSeo({ helperSeo: { plugin: 'yoast', both: false } }).plugin, 'yoast');
});

test('el estado del complemento trae seo {plugin, both, version}', () => {
  const st = W.parseHelperStatus({ plugin: 'ecos', version: '1.8.1', seo: { plugin: 'rankmath', both: true, version: '1.0' } });
  assert.deepEqual(st.seo, { plugin: 'rankmath', both: true, version: '1.0' });
  assert.equal(W.parseHelperStatus({ plugin: 'ecos', version: '1.8.0', seo: 'Yoast SEO' }).seo, null);
});

function fakeWeb(state) {
  const orig = global.fetch;
  global.fetch = async (url) => {
    const route = String(url).replace(/^.*\/wp-json/, '');
    let r = {};
    if (route === '/') r = { namespaces: ['wp/v2', 'ecos/v1', ...state.ns] };
    else if (route.startsWith('/wp/v2/posts')) r = [{ id: 1, meta: {} }];
    else if (route === '/ecos/v1/status') r = { plugin: 'ecos', version: state.version, caches: [], seo: state.seo };
    return { ok: true, status: 200, json: async () => r };
  };
  return { restore: () => { global.fetch = orig; } };
}

test('seoInfo: caché corta, se vacía y «force» vuelve a comprobar; Rank Math escribe por el complemento', async () => {
  const cfg = { wpUrl: 'https://rm.example.org', wpUser: 'u', wpAppPassword: 'p' };
  const state = { ns: ['yoast/v1'], version: '1.8.1', seo: { plugin: 'yoast', both: false, version: '24' } };
  const f = fakeWeb(state);
  try {
    W.clearSeoCache();
    const a = await W.seoInfo(cfg);
    assert.equal(a.plugin, 'yoast'); assert.equal(a.via, 'helper'); assert.equal(a.writable, true);
    // el usuario instala Rank Math (y Yoast sigue activo)
    state.ns = ['yoast/v1', 'rankmath/v1']; state.seo = { plugin: 'rankmath', both: true, version: '1.0.2' };
    assert.equal((await W.seoInfo(cfg)).plugin, 'yoast', 'dentro del minuto se usa la caché');
    const b = await W.seoInfo(cfg, { force: true });
    assert.equal(b.plugin, 'rankmath', 'force la salta'); assert.equal(b.both, true); assert.equal(b.via, 'helper');
    state.seo = { plugin: 'yoast', both: false, version: '24' };
    W.clearSeoCache();
    assert.equal((await W.seoInfo(cfg)).plugin, 'yoast', 'clearSeoCache la vacía (reconectar)');
    // complemento antiguo: sin campo seo, se usa la REST y no se puede escribir
    state.version = '1.8.0'; state.seo = 'Yoast SEO';
    const old = await W.seoInfo(cfg, { force: true });
    assert.equal(old.via, null); assert.equal(old.writable, false);
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'wpself.js'), 'utf8'), /SEO_TTL = 60000/);
  } finally { f.restore(); W.clearSeoCache(); }
});

test('lista blanca: título y descripción en JS y PHP (Yoast y Rank Math)', () => {
  assert.equal(S.META.rankmath.title, 'rank_math_title');
  assert.equal(S.META.rankmath.description, 'rank_math_description');
  assert.equal(S.META.yoast.title, '_yoast_wpseo_title');
  assert.equal(S.META.yoast.description, '_yoast_wpseo_metadesc');
  const php = fs.readFileSync(path.join(__dirname, '..', 'wp-plugin', 'ecos', 'includes', 'seo2.php'), 'utf8');
  for (const k of ['rank_math_title', 'rank_math_description', '_yoast_wpseo_title', '_yoast_wpseo_metadesc']) assert.ok(php.includes(`'${k}'`), k);
  assert.match(php, /ecos_wp_seo2_info/);
  const m = S.toMeta('rankmath', { title: ' Mi título ', description: 'Mi descripción', noindex: true, nofollow: true }, { current: { robots: ['index'] } });
  assert.equal(m.rank_math_title, 'Mi título'); assert.equal(m.rank_math_description, 'Mi descripción');
  assert.deepEqual(m.rank_math_robots, ['noindex', 'nofollow']);
  assert.equal(S.fromMeta('rankmath', { rank_math_title: 'T', rank_math_description: 'D' }).description, 'D');
  assert.ok(S.capability({ plugin: 'rankmath', helper: true }).fields.includes('description'));
});
