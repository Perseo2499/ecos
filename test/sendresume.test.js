// Envíos reanudables por pasos, escritura atómica, duplicados, conflicto y caché sin conexión
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SS = require('../src/sendsteps');
const SQ = require('../src/sendqueue');
const OC = require('../src/offlinecache');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-sr-'));
const URLS = Array.from({ length: 8 }, (_, i) => `https://cdn.example/foto${i + 1}.jpg`);

// WordPress simulado: biblioteca, entradas y fallos inyectables
function fakeWp(opts = {}) {
  const w = { media: [], posts: new Map(), nextId: 100, uploads: 0, creates: 0, updates: 0, failUploadAt: opts.failUploadAt || 0, dropAfterCreate: !!opts.dropAfterCreate, modified: '2026-01-01T10:00:00Z' };
  w.mediaExists = async (_c, id) => w.media.some((m) => m.id === id);
  w.findMediaByName = async (_c, name, size) => { const m = w.media.find((x) => x.name === name && x.size === size); return m ? { id: m.id, url: m.url } : null; };
  w.postModified = async () => ({ modified: w.modified });
  w.createPost = async (_c, f) => { w.creates++; const ID = w.nextId++; w.posts.set(ID, { ...f, ID }); if (w.dropAfterCreate) { w.dropAfterCreate = false; throw new Error('fetch failed: ECONNRESET'); } return { ID, URL: 'https://x/p' + ID, status: f.status, modified: w.modified }; };
  w.updatePost = async (_c, id, f) => { w.updates++; w.posts.set(id, { ...f, ID: id }); return { ID: id, URL: 'https://x/p' + id, status: f.status, modified: w.modified }; };
  w.upload = async (url) => {
    w.uploads++;
    if (w.failUploadAt && w.media.length + 1 === w.failUploadAt) { w.failUploadAt = 0; throw new Error('fetch failed: ENOTFOUND wp.example'); }
    const id = w.nextId++; const name = url.split('/').pop();
    const m = { id, url: 'https://wp.example/uploads/' + name, name, size: 1000 + id };
    w.media.push(m); return { id, url: m.url };
  };
  return w;
}
function deps(w, prog, extra = {}) {
  return {
    wp: w, cfg: {}, prog, sleep: async () => {}, isSelf: true, noRetry: true,
    collectUrls: (d) => d.urls.slice(), replaceUrls: (d, map) => { d.replaced = { ...(d.replaced || {}), ...map }; },
    uploadUrl: (u) => w.upload(u), resolveFeatured: async (d) => d.featuredImageId || null,
    buildFields: (d) => ({ title: d.title, status: d.status || 'draft', content: Object.values(d.replaced || {}).join('|'), type: d.type || 'post' }),
    afterPost: async (post) => ({ postId: post.ID, modified: post.modified }),
    ...extra,
  };
}
const mkd = (over = {}) => ({ title: 'Viaje', type: 'post', status: 'draft', keys: ['a'], urls: URLS, ...over });

test('escritura atómica: sin .tmp residual y el archivo siempre es JSON válido', () => {
  const dir = tmp(); const f = path.join(dir, 'p.json');
  for (let i = 0; i < 20; i++) SS.atomicWrite(f, JSON.stringify({ i }));
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).i, 19);
  assert.deepEqual(fs.readdirSync(dir), ['p.json']);
  // un .tmp a medias (corte durante la escritura) no estropea la lectura del progreso
  fs.writeFileSync(f + '.tmp', '{"truncado');
  const p = SS.makeProgress(f); p.begin('k', { title: 'x' });
  assert.ok(JSON.parse(fs.readFileSync(f, 'utf8')).k);
});

test('red caída en la foto 5: al reanudar no se resubida lo hecho ni se duplica la entrada', async () => {
  const dir = tmp(); const file = path.join(dir, 'send-progress.json');
  const w = fakeWp({ failUploadAt: 5 });
  const d = mkd();
  await assert.rejects(SS.runSend(d, deps(w, SS.makeProgress(file))), (e) => SQ.isNetworkError(e));
  assert.equal(w.media.length, 4);
  assert.equal(w.posts.size, 0);
  // «reabrir Ecos»: progreso nuevo leído del disco
  const prog2 = SS.makeProgress(file);
  assert.equal(prog2.brief(SQ.keyOf(d)).mediaDone, 4);
  assert.equal(prog2.get(SQ.keyOf(d)).running, false);
  const r = await SS.runSend(mkd(), deps(w, prog2));
  assert.equal(w.media.length, 8, 'ni una foto repetida en la biblioteca');
  assert.equal(w.uploads, 9, '8 fotos + el intento fallido');
  assert.equal(w.creates, 1);
  assert.equal(w.posts.size, 1);
  assert.ok(r.postId);
  // el resultado es el mismo que en un envío sin cortes
  const w2 = fakeWp(); const clean = await SS.runSend(mkd(), deps(w2, SS.makeProgress(path.join(tmp(), 'x.json'))));
  const contentA = [...w.posts.values()][0].content.split('|').map((u) => u.split('/').pop());
  const contentB = [...w2.posts.values()][0].content.split('|').map((u) => u.split('/').pop());
  assert.deepEqual(contentA, contentB);
  assert.ok(clean.postId);
  assert.equal(SS.makeProgress(file).all().length, 0, 'al terminar no queda progreso');
});

test('cierre de Ecos tras crear la entrada: al reanudar se actualiza la misma, no se crea otra', async () => {
  const dir = tmp(); const file = path.join(dir, 'p.json');
  const w = fakeWp();
  const d = mkd({ urls: URLS.slice(0, 2) });
  // simula el cierre: la actualización de afterPost lanza como si la app muriera tras guardar el ID
  let boom = true;
  const prog = SS.makeProgress(file);
  await assert.rejects(SS.runSend(d, deps(w, prog, { afterPost: async (post) => { if (boom) { boom = false; throw new Error('fetch failed: ECONNRESET'); } return { postId: post.ID }; } })));
  assert.equal(w.creates, 1);
  const rec = SS.makeProgress(file).get(SQ.keyOf(d));
  assert.equal(rec.postId, 100 + 2);
  const r = await SS.runSend(mkd({ urls: URLS.slice(0, 2) }), deps(w, SS.makeProgress(file)));
  assert.equal(w.creates, 1, 'no se crea otra entrada');
  assert.equal(w.updates, 1);
  assert.equal(w.posts.size, 1);
  assert.equal(r.postId, rec.postId);
  assert.equal(w.media.length, 2);
});

test('corte justo al crear (respuesta perdida tras guardarse en WordPress) no duplica fotos al reintentar', async () => {
  const w = fakeWp({ dropAfterCreate: true });
  const prog = SS.makeProgress(path.join(tmp(), 'p.json'));
  await assert.rejects(SS.runSend(mkd({ urls: URLS.slice(0, 3) }), deps(w, prog)));
  await SS.runSend(mkd({ urls: URLS.slice(0, 3) }), deps(w, prog));
  assert.equal(w.media.length, 3);
});

test('detección de duplicados: si ya está en la biblioteca con el mismo nombre y tamaño, no se sube', async () => {
  const w = fakeWp();
  w.media.push({ id: 7, url: 'https://wp.example/uploads/foto1.jpg', name: 'foto1.jpg', size: 4242 });
  const prog = SS.makeProgress(path.join(tmp(), 'p.json'));
  const d = mkd({ urls: [URLS[0], URLS[1]] });
  await SS.runSend(d, deps(w, prog, { probeFor: async (u) => ({ name: u.split('/').pop(), size: u.endsWith('foto1.jpg') ? 4242 : 1 }) }));
  assert.equal(w.uploads, 1, 'solo se sube la segunda');
  assert.equal(d.replaced[URLS[0]], 'https://wp.example/uploads/foto1.jpg');
});

test('un medio apuntado pero borrado después de la biblioteca se vuelve a subir', async () => {
  const w = fakeWp({ failUploadAt: 2 });
  const file = path.join(tmp(), 'p.json');
  await assert.rejects(SS.runSend(mkd({ urls: URLS.slice(0, 2) }), deps(w, SS.makeProgress(file))));
  w.media.length = 0; // alguien borró la foto 1
  await SS.runSend(mkd({ urls: URLS.slice(0, 2) }), deps(w, SS.makeProgress(file)));
  assert.equal(w.media.length, 2);
});

test('subidas con espera exponencial y reanudación', async () => {
  const waits = []; let n = 0;
  const r = await SS.withRetry(async () => { if (++n < 3) throw new Error('fetch failed'); return 'ok'; }, { tries: 4, base: 1000, sleep: async (ms) => waits.push(ms) });
  assert.equal(r, 'ok'); assert.deepEqual(waits, [1000, 2000]);
  await assert.rejects(SS.withRetry(async () => { throw new Error('fetch failed'); }, { tries: 3, base: 10, sleep: async () => {} }));
  let m = 0; await assert.rejects(SS.withRetry(async () => { m++; throw new Error('WordPress: no tienes permiso'); }, { tries: 5, sleep: async () => {} })); assert.equal(m, 1, 'los errores que no son de red no se reintentan');
});

test('conflicto: si la entrada cambió en WordPress (modified distinto) se avisa y no se envía; con overwrite sí', async () => {
  const w = fakeWp(); w.modified = '2026-01-02T10:00:00Z';
  const prog = SS.makeProgress(path.join(tmp(), 'p.json'));
  const d = () => mkd({ postId: 55, urls: [], baseModified: '2026-01-01T10:00:00Z' });
  await assert.rejects(SS.runSend(d(), deps(w, prog)), (e) => SS.isConflict(e) && e.modified === '2026-01-02T10:00:00Z');
  assert.equal(w.updates, 0);
  const ok = await SS.runSend({ ...d(), overwrite: true }, deps(w, prog));
  assert.equal(w.updates, 1); assert.equal(ok.postId, 55);
  // sin cambios en WordPress: pasa sin más
  w.modified = '2026-01-01T10:00:00Z';
  await SS.runSend(d(), deps(w, prog)); assert.equal(w.updates, 2);
});

test('cola: los envíos en espera (conflicto / a medias) no se procesan solos y se liberan al decidir', () => {
  let q = SQ.enqueue([], { title: 'A', postId: 5 }, 1000);
  q = SQ.hold(q, q[0].id, 'conflict');
  assert.equal(SQ.due(q, 1e12).length, 0);
  assert.equal(SQ.nextWake(q), 0);
  assert.equal(SQ.retryNow(q, null, 5)[0].hold, 'conflict', 'volver la conexión no libera el conflicto');
  assert.equal(SQ.retryNow(q, q[0].id, 5)[0].hold, '');
});

test('caché sin conexión: guarda la lista y las entradas, con fecha, y sobrevive a reiniciar', () => {
  const f = path.join(tmp(), 'c.json'); let now = 1000;
  const c = OC.make(f, () => now);
  c.putList({ type: 'post', page: 1 }, { items: [{ id: 1 }], found: 1 });
  c.putPost('post', 9, { title: 'Hola' });
  c.flushNow();
  now = 5000;
  const c2 = OC.make(f, () => now);
  assert.equal(c2.getList({ type: 'post', page: 1 }).at, 1000);
  assert.equal(c2.getList({ type: 'post', page: 3, after: 'x' }).value.found, 1, 'otra consulta del mismo tipo: la más reciente');
  assert.equal(c2.getList({ type: 'page' }), null);
  assert.equal(c2.getPost('post', 9).value.title, 'Hola');
  assert.equal(c2.getPost('page', 9), null);
});
