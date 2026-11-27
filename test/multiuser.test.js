const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const MU = require('../renderer/multiuser');
const W = require('../src/wpself');

const cfg = { wpUrl: 'https://example.org', wpUser: 'u', wpAppPassword: 'aaaa bbbb cccc dddd eeee ffff' };
function fakeFetch(handler) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET', body: opt.body ? JSON.parse(opt.body) : null });
    const r = handler(url, opt);
    return { ok: true, status: 200, headers: { get: () => '1' }, json: async () => r };
  };
  return { calls, restore: () => { global.fetch = orig; } };
}
// Temporizadores simulados: el tiempo solo avanza cuando se pide
function fakeTimers() {
  let nextId = 1; const t = new Map();
  return {
    setInt: (fn, ms) => { const id = nextId++; t.set(id, { fn, ms }); return id; },
    clearInt: (id) => { t.delete(id); },
    tick: () => { for (const x of [...t.values()]) x.fn(); },
    active: () => t.size, every: () => [...t.values()][0]?.ms,
  };
}
const flush = () => new Promise((r) => setImmediate(r));

test('bloqueo: se pide al abrir, se renueva cada 60 s y se suelta al cerrar', async () => {
  const tm = fakeTimers(), calls = [];
  const k = MU.createLockKeeper({ id: 7, setInt: tm.setInt, clearInt: tm.clearInt, api: { acquire: async (id, f) => { calls.push(['acquire', id, f]); return { supported: true, locked: false }; }, release: async (id) => { calls.push(['release', id]); } } });
  await k.start();
  assert.equal(k.state, 'mine'); assert.equal(tm.every(), 60000); assert.equal(tm.active(), 1);
  tm.tick(); await flush(); tm.tick(); await flush();
  assert.deepEqual(calls.map((c) => c[0]), ['acquire', 'acquire', 'acquire']);
  assert.ok(calls.every((c) => c[2] !== true), 'la renovación nunca fuerza');
  await k.stop();
  assert.equal(tm.active(), 0); assert.deepEqual(calls.at(-1), ['release', 7]);
  tm.tick(); await flush(); assert.equal(calls.length, 4, 'parado: no renueva más');
});

test('bloqueo: otra persona la tiene → aviso; al soltarla ella, se recupera sin molestar', async () => {
  const tm = fakeTimers(), events = [], calls = [];
  let other = { id: 3, name: 'Marta' };
  const k = MU.createLockKeeper({ id: 9, setInt: tm.setInt, clearInt: tm.clearInt, onChange: (s, u) => events.push([s, u?.name || null]),
    api: { acquire: async (id, force) => { calls.push(force); return other && !force ? { supported: true, locked: true, user: other } : { supported: true, locked: false }; }, release: async () => { calls.push('release'); } } });
  await k.start();
  assert.deepEqual(events, [['other', 'Marta']]);
  tm.tick(); await flush(); assert.equal(events.length, 1, 'sin cambios no se repite el aviso');
  await k.stop(); assert.ok(!calls.includes('release'), 'si no es mío no lo suelto');
  // «Editar de todos modos»
  const k2 = MU.createLockKeeper({ id: 9, setInt: tm.setInt, clearInt: tm.clearInt, onChange: (s) => events.push([s]), api: { acquire: async (id, force) => ({ supported: true, locked: !force, user: other }), release: async () => {} } });
  await k2.start(); await k2.takeOver(); assert.equal(k2.state, 'mine');
  await k2.stop();
  // la otra persona termina
  other = null; events.length = 0;
  const k3 = MU.createLockKeeper({ id: 9, setInt: tm.setInt, clearInt: tm.clearInt, onChange: (s) => events.push(s), api: { acquire: async () => (other ? { supported: true, locked: true, user: other } : { supported: true, locked: false }), release: async () => {} } });
  other = { id: 3, name: 'Marta' }; await k3.start(); other = null; tm.tick(); await flush();
  assert.deepEqual(events, ['other', 'mine']);
  await k3.stop();
});

test('bloqueo: sin complemento no hay temporizador; un fallo de red no cambia el estado', async () => {
  const tm = fakeTimers();
  const k = MU.createLockKeeper({ id: 1, setInt: tm.setInt, clearInt: tm.clearInt, api: { acquire: async () => ({ supported: false }), release: async () => {} } });
  await k.start(); assert.equal(k.state, 'unsupported'); assert.equal(tm.active(), 0);
  let fail = false;
  const k2 = MU.createLockKeeper({ id: 1, setInt: tm.setInt, clearInt: tm.clearInt, api: { acquire: async () => { if (fail) throw new Error('red'); return { supported: true, locked: false }; }, release: async () => {} } });
  await k2.start(); fail = true; tm.tick(); await flush(); assert.equal(k2.state, 'mine');
  const r = await k2.check(); assert.equal(r.state, 'mine');
  await k2.stop();
});

test('bloqueo: si se cierra mientras se pedía, se suelta lo recién tomado', async () => {
  const tm = fakeTimers(), calls = [];
  let go; const gate = new Promise((r) => { go = r; });
  const k = MU.createLockKeeper({ id: 5, setInt: tm.setInt, clearInt: tm.clearInt, api: { acquire: async () => { await gate; return { supported: true, locked: false }; }, release: async (id) => { calls.push(id); } } });
  const p = k.start(); await k.stop(); go(); await p; await flush();
  assert.deepEqual(calls, [5]); assert.equal(tm.active(), 0);
});

test('«modificada desde que se abrió»', () => {
  assert.equal(MU.changedSince('2026-05-01T10:00:00Z', '2026-05-01T10:00:00Z'), false);
  assert.equal(MU.changedSince('2026-05-01T10:00:00Z', '2026-05-01T10:05:00Z'), true);
  assert.equal(MU.changedSince('2026-05-01T10:05:00Z', '2026-05-01T10:00:00Z'), false);
  assert.equal(MU.changedSince(null, '2026-05-01T10:00:00Z'), false);
  assert.equal(MU.changedSince('2026-05-01T10:00:00Z', undefined), false);
  assert.equal(MU.changedSince('basura', '2026-05-01T10:00:00Z'), false);
});

test('rol: quien no puede publicar envía a revisión y no programa', () => {
  const contributor = { canPublish: false }, editor = { canPublish: true };
  assert.equal(MU.sendStatus('publish', contributor), 'pending');
  assert.equal(MU.sendStatus('future', contributor), 'pending');
  assert.equal(MU.sendStatus('draft', contributor), 'draft');
  assert.equal(MU.sendStatus('publish', editor), 'publish');
  assert.equal(MU.sendStatus('future', editor), 'future');
  assert.equal(MU.sendStatus('publish', null), 'publish', 'sin datos: se supone que puede');
  assert.equal(MU.roleName('contributor'), 'Colaborador'); assert.equal(MU.roleName('rara'), 'rara');
  const me = W.parseMe({ id: 4, name: 'Luis', slug: 'luis', roles: ['contributor'], capabilities: { edit_posts: true, publish_posts: false }, avatar_urls: { 48: 'https://x/a.png' } });
  assert.equal(me.canPublish, false); assert.equal(me.canUpload, false); assert.equal(me.role, 'contributor'); assert.equal(me.avatar, 'https://x/a.png');
  assert.equal(W.parseMe({ id: 1, name: 'A', roles: ['author'], capabilities: { publish_posts: true, upload_files: true } }).canPublish, true);
});

test('«Solo las mías»: filtro del cliente y de la petición', async () => {
  const items = [{ id: 1, author: { id: 5 } }, { id: 2, author: { id: 6 } }, { id: 3 }];
  assert.deepEqual(MU.filterMine(items, 5).map((x) => x.id), [1]);
  assert.equal(MU.filterMine(items, 0), items);
  assert.equal(MU.initials('Marta López Ruiz'), 'MR'); assert.equal(MU.initials('ana'), 'A'); assert.equal(MU.initials(''), '?');
  const f = fakeFetch((url) => (/\/categories/.test(url) ? [] : [{ id: 1, author: 5, status: 'draft', date_gmt: '2026-01-01T00:00:00', modified_gmt: '2026-01-02T00:00:00', title: { raw: 'A' }, link: 'x', categories: [], _embedded: { author: [{ id: 5, name: 'Marta', avatar_urls: { 48: 'https://x/m.png' } }] } }]));
  try {
    const r = await W.listPosts(cfg, { status: 'draft', author: 5 });
    const url = f.calls.find((c) => /\/wp\/v2\/posts\?/.test(c.url)).url;
    assert.match(url, /author=5/); assert.match(url, /_embed=wp%3Afeaturedmedia%2Cauthor/);
    assert.deepEqual(r.items[0].author, { id: 5, name: 'Marta', avatar: 'https://x/m.png' });
    await W.listPosts(cfg, {});
    assert.doesNotMatch(f.calls.filter((c) => /\/wp\/v2\/posts\?/.test(c.url)).at(-1).url, /author=/);
  } finally { f.restore(); }
});

test('wpself: bloqueo (POST/DELETE ecos/v1/lock) y fecha de modificación', async () => {
  const f = fakeFetch((url, opt) => (/ecos\/v1\/lock/.test(url) ? (opt.method === 'DELETE' ? { released: true } : { locked: true, user: { id: 2, name: 'Marta', avatar: 'a' } }) : { id: 3, status: 'publish', modified_gmt: '2026-03-01T09:00:00' }));
  try {
    const l = await W.helperLock(cfg, 3, { force: false });
    assert.deepEqual(l, { supported: true, locked: true, user: { id: 2, name: 'Marta', avatar: 'a' } });
    assert.equal(f.calls[0].method, 'POST'); assert.deepEqual(f.calls[0].body, { id: 3 });
    await W.helperLock(cfg, 3, { force: true }); assert.equal(f.calls[1].body.force, true);
    assert.equal(await W.helperUnlock(cfg, 3), true); assert.equal(f.calls[2].method, 'DELETE');
    assert.equal((await W.postModified(cfg, 3, 'post')).modified, '2026-03-01T09:00:00Z');
    assert.match(f.calls[3].url, /wp\/v2\/posts\/3/);
  } finally { f.restore(); }
  assert.equal(W.parseHelperLock({}).supported, false);
  assert.equal(W.helperHasLock('1.1.0'), false); assert.equal(W.helperHasLock('1.2.0'), true);
});

test('complemento 1.2: versión, rutas de bloqueo y PHP válido', () => {
  const dir = path.join(__dirname, '..', 'wp-plugin', 'ecos');
  assert.equal(W.helperBundledVersion(), '1.6.0');
  const php = fs.readFileSync(path.join(dir, 'ecos.php'), 'utf8');
  assert.match(php, /define\( 'ECOS_WP_VERSION', '1\.6\.0' \)/);
  assert.match(php, /'\/lock'/); assert.match(php, /wp_check_post_lock/); assert.match(php, /wp_set_post_lock/); assert.match(php, /'DELETE'/);
  try { execFileSync('php', ['-v'], { stdio: 'ignore' }); } catch { return; }
  execFileSync('php', ['-l', path.join(dir, 'ecos.php')], { stdio: 'pipe' });
});
