const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const W = require('../src/wpself');
const B = require('../scripts/build-wp-plugin');
const HL = require('../renderer/homelogic');

const cfg = { wpUrl: 'https://example.org', wpUser: 'u', wpAppPassword: 'aaaa bbbb cccc dddd eeee ffff' };
function fakeFetch(handler) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opt = {}) => { calls.push({ url, method: opt.method || 'GET', body: opt.body ? JSON.parse(opt.body) : null }); const r = handler(url, opt); return { ok: true, status: 200, json: async () => r }; };
  return { calls, restore: () => { global.fetch = orig; } };
}

test('wpself: estadísticas de visitas (fetch simulado)', async () => {
  const f = fakeFetch(() => ({ days: 7, total: '12', daily: [{ day: '2026-01-01', views: 5 }, { day: '2026-01-02', views: -3 }], top: [{ id: 4, title: 'A', link: 'https://x/a', views: 9 }] }));
  try {
    const r = await W.helperStats(cfg, 7);
    assert.match(f.calls[0].url, /\/wp-json\/ecos\/v1\/stats\?days=7/);
    assert.equal(r.total, 12); assert.equal(r.daily[1].views, 0); assert.equal(r.top[0].id, 4);
    await W.helperStats(cfg, 9999); assert.match(f.calls[1].url, /days=365/);
  } finally { f.restore(); }
  const g = fakeFetch(() => ({ code: 'x' }));
  try { await assert.rejects(() => W.helperStats(cfg, 7), /complemento/); } finally { g.restore(); }
});

test('wpself: datos de la asociación (leer y guardar)', async () => {
  const f = fakeFetch(() => ({ saved: true, settings: { name: 'Elín', city: 'Ceuta', extra: 'x' } }));
  try {
    const r = await W.helperSettings(cfg);
    assert.equal(r.saved, true); assert.equal(r.settings.name, 'Elín'); assert.equal(r.settings.email, ''); assert.equal(r.settings.extra, undefined);
    await W.helperSaveSettings(cfg, { name: ' Elín ', phone: '606', otro: 'no' });
    const post = f.calls[1];
    assert.equal(post.method, 'POST'); assert.match(post.url, /ecos\/v1\/settings$/);
    assert.equal(post.body.name, 'Elín'); assert.equal(post.body.phone, '606'); assert.equal(post.body.otro, undefined);
  } finally { f.restore(); }
});

test('Inicio: barras de visitas', () => {
  const bars = HL.viewsBars([{ day: 'a', views: 0 }, { day: 'b', views: 5 }, { day: 'c', views: 10 }], 100, 50, 2);
  assert.equal(bars.length, 3);
  assert.equal(bars[0].h, 0); assert.equal(bars[2].h, 50); assert.equal(bars[2].y, 0); assert.equal(bars[1].h, 25);
  assert.ok(bars[2].x + bars[2].w <= 100.01);
  assert.equal(HL.viewsBars([{ day: 'a', views: 1 }, { day: 'b', views: 1000 }], 100, 50)[0].h, 2);
  assert.deepEqual(HL.viewsBars([], 100, 50), []);
  assert.equal(HL.viewsBars([{ day: 'a', views: 0 }], 100, 50)[0].h, 0);
});

test('complemento 1.1: versión, PHP válido y zip con los archivos nuevos', () => {
  assert.equal(W.helperBundledVersion(), '1.8.0');
  const dir = path.join(__dirname, '..', 'wp-plugin', 'ecos');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-zip-')), 'p.zip');
  const r = B.build(out);
  for (const n of ['ecos/ecos.php', 'ecos/uninstall.php', 'ecos/includes/seo.php', 'ecos/includes/stats.php', 'ecos/assets/ecos-hit.js']) assert.ok(r.files.includes(n), n);
  assert.ok(fs.readFileSync(out).includes(Buffer.from('includes/stats.php')));
  try { execFileSync('php', ['-v'], { stdio: 'ignore' }); } catch { return; }
  for (const f of ['ecos.php', 'uninstall.php', 'includes/seo.php', 'includes/stats.php']) execFileSync('php', ['-l', path.join(dir, f)], { stdio: 'pipe' });
});
