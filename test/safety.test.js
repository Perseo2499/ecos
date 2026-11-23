const test = require('node:test');
const assert = require('node:assert');
const su = require('../src/startup');
const up = require('../src/updatepolicy');
const q = require('../src/sendqueue');

test('startup.json: arranque normal no cuenta fallos', () => {
  let s = su.begin(null, '1.0.0');
  assert.deepStrictEqual(s, { pending: true, failures: 0, version: '1.0.0' });
  s = su.ready(s);
  s = su.begin(s, '1.0.0');
  assert.strictEqual(s.failures, 0);
  assert.ok(!su.shouldOffer(su.ready(s)));
});
test('startup.json: dos arranques seguidos sin ventana ofrecen reparar', () => {
  let s = su.begin(null, '2.0.0'); // el arranque 1 queda pendiente
  s = su.begin(s, '2.0.0'); // arranque 2: el 1 falló
  assert.strictEqual(s.failures, 1); assert.ok(!su.shouldOffer(s));
  s = su.begin(s, '2.0.0'); // arranque 3: el 2 falló
  assert.strictEqual(s.failures, 2); assert.ok(su.shouldOffer(s));
  assert.strictEqual(su.offered(s).failures, 0);
});
test('startup.json: fallo registrado (fatal o 60 s) no se cuenta dos veces', () => {
  let s = su.begin(null, '2.0.0');
  s = su.fail(s); assert.deepStrictEqual(s, { pending: false, failures: 1, version: '2.0.0' });
  s = su.begin(s, '2.0.0'); assert.strictEqual(s.failures, 1);
  s = su.fail(s); s = su.begin(s, '2.0.0'); assert.ok(su.shouldOffer(s));
});
test('startup.json: otra versión empieza de cero; ready lo limpia; datos corruptos', () => {
  const s = su.fail(su.fail(su.begin(null, '1.0.0')));
  assert.strictEqual(su.begin(s, '1.0.1').failures, 0);
  assert.strictEqual(su.ready(s).failures, 0);
  assert.deepStrictEqual(su.begin('basura', '1'), { pending: true, failures: 0, version: '1' });
});
test('instalador de la release', () => {
  const r = { assets: [{ name: 'latest.yml', browser_download_url: 'x' }, { name: 'Ecos-Setup-2.1.0.exe.blockmap', browser_download_url: 'b' }, { name: 'Ecos-Setup-2.1.0.exe', browser_download_url: 'https://e/x.exe' }] };
  assert.deepStrictEqual(su.pickInstaller(r), { name: 'Ecos-Setup-2.1.0.exe', url: 'https://e/x.exe' });
  assert.strictEqual(su.pickInstaller({ assets: [] }), null);
});

test('retraso de 24 h en el canal estable', () => {
  const now = Date.parse('2026-05-10T12:00:00Z');
  const h = (n) => new Date(now - n * 3600e3).toISOString();
  assert.strictEqual(up.holdUntil(h(2), false, now), now + 22 * 3600e3);
  assert.strictEqual(up.holdUntil(h(25), false, now), 0);
  assert.strictEqual(up.holdUntil(h(2), true, now), 0, 'canal de pruebas: inmediata');
  assert.strictEqual(up.holdUntil(undefined, false, now), 0);
  assert.strictEqual(up.holdUntil('no es fecha', false, now), 0);
});

test('cola: clasificación de errores', () => {
  for (const m of ['getaddrinfo ENOTFOUND x', 'read ECONNRESET', 'ETIMEDOUT', 'No se puede conectar con https://a.es: fetch failed', 'WordPress: HTTP 503', 'HTTP 502']) assert.ok(q.isNetworkError(new Error(m)), m);
  for (const m of ['WordPress: tu usuario no tiene permiso para esto', 'WordPress: Título inválido', 'HTTP 400', 'HTTP 404']) assert.ok(!q.isNetworkError(new Error(m)), m);
  class AuthError extends Error {}
  assert.ok(!q.isNetworkError(new AuthError('ECONNRESET en permiso')));
});
test('cola: espera creciente', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 9].map(q.backoff), [30e3, 120e3, 600e3, 1800e3, 1800e3, 1800e3]);
});
test('cola: sustituir, fallar, vencer y quitar', () => {
  let l = q.enqueue([], { postId: 7, title: 'A' }, 1000);
  l = q.enqueue(l, { title: 'Nueva', keys: ['ig1'] }, 1000);
  assert.strictEqual(l.length, 2);
  const id7 = l[0].id;
  l = q.failed(l, id7, 2000, 'x');
  assert.strictEqual(l[0].attempts, 1); assert.strictEqual(l[0].nextAt, 2000 + 120e3);
  l = q.enqueue(l, { postId: 7, title: 'A editada' }, 5000);
  assert.strictEqual(l.length, 2); assert.strictEqual(l[0].id, id7); assert.strictEqual(l[0].title, 'A editada'); assert.strictEqual(l[0].attempts, 0);
  assert.strictEqual(l[0].nextAt, 5000 + 30e3);
  assert.deepStrictEqual(q.due(l, 1000 + 30e3).map((x) => x.title), ['Nueva']);
  assert.strictEqual(q.retryNow(l, id7, 6000)[0].nextAt, 6000);
  assert.strictEqual(q.nextWake(l), 31000);
  assert.strictEqual(q.remove(l, id7).length, 1);
  assert.ok(!('payload' in q.view(l)[0]));
  assert.notStrictEqual(q.keyOf({ postId: 7, type: 'page' }), q.keyOf({ postId: 7 }));
});
