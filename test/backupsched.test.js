process.env.TZ = 'Europe/Madrid'; // el cambio de horario de verano se prueba con la hora de Madrid
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../src/backupsched');
const I = require('../src/backupinc');
const V = require('../src/backupverify');
const BC = require('../src/backupcreate');
const G = require('../src/gdrive');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-bk-'));
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const iso = (t) => new Date(t).toISOString();

// ---------------------------------------------------------------- calendario
test('próxima ejecución: diaria, antes y después de la hora', () => {
  const s = { freq: 'daily', time: '03:00' };
  assert.equal(S.nextRun(s, at(2026, 5, 10, 1, 0)), at(2026, 5, 10, 3, 0));
  assert.equal(S.nextRun(s, at(2026, 5, 10, 3, 0)), at(2026, 5, 11, 3, 0)); // estrictamente posterior
  assert.equal(S.nextRun(s, at(2026, 5, 10, 22, 30)), at(2026, 5, 11, 3, 0));
});

test('próxima ejecución: semanal con día y mensual con fin de mes', () => {
  // 2026-05-10 es domingo (0)
  assert.equal(new Date(at(2026, 5, 10)).getDay(), 0);
  assert.equal(S.nextRun({ freq: 'weekly', weekday: 3, time: '08:15' }, at(2026, 5, 10, 12)), at(2026, 5, 13, 8, 15));
  assert.equal(S.nextRun({ freq: 'weekly', weekday: 0, time: '08:15' }, at(2026, 5, 10, 12)), at(2026, 5, 17, 8, 15));
  assert.equal(S.nextRun({ freq: 'monthly', monthday: 15, time: '23:59' }, at(2026, 5, 16)), at(2026, 6, 15, 23, 59));
  // el día 31 en un mes de 30 o en febrero se hace el último día
  assert.equal(S.nextRun({ freq: 'monthly', monthday: 31, time: '03:00' }, at(2026, 4, 1)), at(2026, 4, 30, 3, 0));
  assert.equal(S.nextRun({ freq: 'monthly', monthday: 31, time: '03:00' }, at(2027, 2, 1)), at(2027, 2, 28, 3, 0));
  assert.equal(S.prevRun({ freq: 'monthly', monthday: 31, time: '03:00' }, at(2026, 6, 10)), at(2026, 5, 31, 3, 0));
});

test('cambio de horario de verano: la hora que no existe pasa a la siguiente y no se repite ni se salta', () => {
  // 2027-03-28: a las 02:00 los relojes pasan a las 03:00 (la 02:30 no existe)
  const s = { freq: 'daily', time: '02:30' };
  const n1 = S.nextRun(s, at(2027, 3, 27, 12));
  assert.equal(iso(n1), '2027-03-28T01:30:00.000Z'); // = 03:30 CEST
  const n2 = S.nextRun(s, n1);
  assert.equal(iso(n2), '2027-03-29T00:30:00.000Z'); // 02:30 CEST al día siguiente
  // 2026-10-25: a las 03:00 vuelven a las 02:00 (la 02:30 ocurre dos veces): una sola ejecución ese día
  const f = S.nextRun(s, at(2026, 10, 24, 12));
  const g = S.nextRun(s, f);
  assert.equal(new Date(f).getDate(), 25); assert.equal(new Date(g).getDate(), 26);
  // una hora normal sigue siendo la misma hora local antes y después del cambio (el intervalo no es de 24 h exactas)
  const t = { freq: 'daily', time: '03:00' };
  const a = S.nextRun(t, at(2027, 3, 26, 12)), b = S.nextRun(t, a);
  assert.equal(new Date(a).getHours(), 3); assert.equal(new Date(b).getHours(), 3);
  assert.equal((b - a) / 3600e3, 23);
});

test('hora o ajustes raros vuelven a valores válidos', () => {
  const s = S.withDefaults({ time: '25:99', freq: 'cada-rato', keep: -4, weekday: 9, monthday: 0, cloud: 'x' });
  assert.equal(s.time, '03:00'); assert.equal(s.freq, 'weekly'); assert.equal(s.keep, 1); assert.equal(s.weekday, 6); assert.equal(s.monthday, 1); assert.equal(s.cloud, 'none');
  assert.equal(S.withDefaults({ time: '7:05' }).time, '07:05');
  assert.throws(() => S.applyPatch({}, { freq: 'x' }), /Frecuencia/);
  assert.throws(() => S.applyPatch({}, { time: '99:00' }), /Hora/);
  const on = S.applyPatch({}, { enabled: true }, 1234);
  assert.equal(on.enabledAt, 1234);
  assert.equal(S.applyPatch(on, { enabled: true }, 9999).enabledAt, 1234); // ya estaba activa
});

// ---------------------------------------------------------------- cuándo toca
test('toca si pasó la hora prevista y no hay copia buena desde entonces (también al abrir la app tarde)', () => {
  const s = { enabled: true, freq: 'daily', time: '03:00', enabledAt: at(2026, 5, 1) };
  assert.equal(S.isDue(s, at(2026, 5, 10, 2, 59)), true); // la de ayer a las 03:00 no se hizo
  assert.equal(S.isDue({ ...s, lastOkAt: at(2026, 5, 9, 3, 5) }, at(2026, 5, 10, 2, 59)), false);
  assert.equal(S.isDue({ ...s, lastOkAt: at(2026, 5, 9, 3, 5) }, at(2026, 5, 10, 3, 1)), true);
  // app cerrada tres días: una sola copia al abrir
  assert.equal(S.isDue({ ...s, lastOkAt: at(2026, 5, 6, 3, 5) }, at(2026, 5, 10, 9, 0)), true);
  assert.equal(S.isDue({ ...s, lastOkAt: at(2026, 5, 10, 9, 5) }, at(2026, 5, 10, 9, 10)), false);
  // desactivada, o recién activada (no lanza una copia atrasada de antes de activarla)
  assert.equal(S.isDue({ ...s, enabled: false }, at(2026, 5, 10, 4)), false);
  assert.equal(S.isDue({ ...s, enabledAt: at(2026, 5, 10, 3, 30) }, at(2026, 5, 10, 4)), false);
  assert.equal(S.isDue({ ...s, enabledAt: at(2026, 5, 10, 3, 30) }, at(2026, 5, 11, 3, 1)), true);
});

test('tras un fallo se reintenta a las 2 horas y como mucho 4 veces por hora prevista', () => {
  const base = { enabled: true, freq: 'daily', time: '03:00', enabledAt: at(2026, 5, 1), lastOkAt: at(2026, 5, 9, 3, 5) };
  const failed = { ...base, lastFailed: true, lastAttempt: at(2026, 5, 10, 3, 0), failures: 1 };
  assert.equal(S.isDue(failed, at(2026, 5, 10, 4, 0)), false);
  assert.equal(S.isDue(failed, at(2026, 5, 10, 5, 1)), true);
  assert.equal(S.isDue({ ...failed, failures: 4 }, at(2026, 5, 10, 9, 0)), false);
  // llega la hora siguiente: vuelve a intentarlo aunque agotara los intentos
  assert.equal(S.isDue({ ...failed, failures: 4 }, at(2026, 5, 11, 3, 1)), true);
});

test('solo con el ordenador enchufado y con red', () => {
  assert.deepEqual(S.conditions({}, { onBattery: false, online: true }), { ok: true, reason: null });
  assert.equal(S.conditions({ onlyPlugged: true }, { onBattery: true }).reason, 'battery');
  assert.equal(S.conditions({ onlyPlugged: false }, { onBattery: true }).ok, true);
  assert.equal(S.conditions({ needNetwork: true }, { online: false }).reason, 'offline');
  assert.equal(S.conditions({ needNetwork: false }, { online: false }).ok, true);
  assert.equal(S.conditions({ onlyPlugged: true, needNetwork: true }, { onBattery: true, online: false }).reason, 'battery');
});

// ---------------------------------------------------------------- retención e historial
test('retención: guarda las últimas N automáticas buenas del mismo tipo y nunca toca manuales ni fallidas', () => {
  const e = (id, at, o = {}) => ({ id, at, kind: 'web', auto: true, ok: true, file: '/x/' + id + '.zip', ...o });
  const list = [e('a', 10), e('b', 20), e('c', 30), e('d', 40), e('m', 5, { auto: false }), e('f', 6, { ok: false }), e('w', 1, { kind: 'emergency' }), e('r', 2, { removed: true })];
  assert.deepEqual(S.pickRetention(list, 'web', 2).map((x) => x.id), ['b', 'a']);
  assert.deepEqual(S.pickRetention(list, 'web', 9), []);
  assert.deepEqual(S.pickRetention(list, 'web', 0).map((x) => x.id), ['c', 'b', 'a']); // mínimo 1
  assert.deepEqual(S.pickRetention(list, 'emergency', 1), []);
});

test('historial: ordenado, sin duplicados y acotado', () => {
  let l = [];
  l = S.addEntry(l, { id: '1', at: 1 }); l = S.addEntry(l, { id: '2', at: 5 }); l = S.addEntry(l, { id: '1', at: 1, ok: true });
  assert.deepEqual(l.map((x) => x.id), ['2', '1']); assert.equal(l[1].ok, true);
  for (let i = 0; i < 150; i++) l = S.addEntry(l, { id: 'x' + i, at: 100 + i });
  assert.equal(l.length, S.HISTORY_MAX);
  assert.equal(S.patchEntry(l, 'x149', { verified: true })[0].verified, true);
  assert.equal(S.whenLabel(at(2026, 5, 10, 1), at(2026, 5, 10, 20)), 'today');
  assert.equal(S.whenLabel(at(2026, 5, 9, 23), at(2026, 5, 10, 1)), 'yesterday');
  assert.equal(S.whenLabel(at(2026, 5, 1), at(2026, 5, 10)), 'date');
  assert.equal(S.webName('www.Ejemplo.org', new Date(2026, 4, 3, 7, 5)), 'ecos-web-ejemplo.org-2026-05-03-0705.zip');
  assert.ok(S.isWebName(S.webName('x.org', new Date(), false)));
});

// ---------------------------------------------------------------- incremental: medios
test('medios: se reutilizan los ya bajados por ID y firma; lo cambiado o borrado se vuelve a bajar', async () => {
  const dir = tmp();
  const media = [{ id: 1, url: 'https://x/a.jpg', date: '2026-01-01', modified: 'M1' }, { id: 2, url: 'https://x/b.jpg', date: '2026-01-02', modified: 'M1' }];
  const hits = [];
  const raw = async (u) => { hits.push(u); return Buffer.from('datos de ' + u); };
  let c = new I.MediaCache(dir), st = {};
  let dl = I.cachedDownload(c, media, raw, st);
  assert.equal((await dl(media[0].url)).toString(), 'datos de https://x/a.jpg'); await dl(media[1].url); c.save();
  assert.deepEqual([st.mediaReused, st.mediaDownloaded], [0, 2]);
  // segunda copia: ni una petición
  hits.length = 0; c = new I.MediaCache(dir); st = {}; dl = I.cachedDownload(c, media, raw, st);
  await dl(media[0].url); await dl(media[1].url);
  assert.deepEqual([st.mediaReused, st.mediaDownloaded, hits.length], [2, 0, 0]);
  assert.ok(st.mediaBytesSaved > 0);
  // la foto 2 cambió en la web (otra fecha de modificación): solo esa se baja
  const media2 = [media[0], { ...media[1], modified: 'M2' }];
  c = new I.MediaCache(dir); st = {}; dl = I.cachedDownload(c, media2, raw, st);
  await dl(media2[0].url); await dl(media2[1].url);
  assert.deepEqual(hits, ['https://x/b.jpg']);
  // archivo de la caché truncado o borrado: se vuelve a bajar
  c.save(); fs.writeFileSync(path.join(dir, 'media', '1'), 'x');
  c = new I.MediaCache(dir); assert.equal(c.lookup(media2[0]), null);
  // limpieza de lo que ya no está en la biblioteca
  c.prune([2]); assert.equal(c.count(), 1); c.save();
  assert.ok(!fs.existsSync(path.join(dir, 'media', '1')));
  // una descarga fallida (null) no se guarda ni cuenta
  const dl2 = I.cachedDownload(c, [{ id: 9, url: 'u9', date: 'd' }], async () => null, {});
  assert.equal(await dl2('u9'), null); assert.equal(c.lookup({ id: 9, url: 'u9', date: 'd' }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- incremental: entradas
test('entradas: solo se bajan completas las nuevas o cambiadas (modified_after) y las borradas desaparecen', async () => {
  const dir = tmp();
  const pc = new I.PostCache(dir);
  const ROUTE = `/wp/v2/posts?context=edit&status=publish&_fields=${BC.POST_FIELDS}`;
  let site = [1, 2, 3, 4, 5].map((id) => ({ id, modified_gmt: '2026-05-01T10:00:00', title: { raw: 'T' + id }, content: { raw: 'c' + id } }));
  const calls = [];
  const listAll = async (route) => {
    calls.push(route);
    if (/_fields=id,modified_gmt/.test(route)) return site.map((p) => ({ id: p.id, modified_gmt: p.modified_gmt }));
    if (/modified_after=/.test(route)) return site.filter((p) => p.modified_gmt > '2026-05-02T00:00:00');
    const inc = /include=([\d,]+)/.exec(route); if (inc) return site.filter((p) => inc[1].split(',').map(Number).includes(p.id));
    return site;
  };
  let st = {};
  let r = await I.incrementalListAll(listAll, pc, st, () => Date.parse('2026-05-02T12:00:00Z'))(ROUTE);
  assert.equal(r.length, 5); assert.equal(st.postsFetched, 5); assert.equal(st.postsReused, 0);
  // otra copia, solo la 2 cambia, se publica la 6 y se borra la 5
  site = site.filter((p) => p.id !== 5); site[1] = { ...site[1], modified_gmt: '2026-05-03T09:00:00', content: { raw: 'nuevo' } };
  site.push({ id: 6, modified_gmt: '2026-05-03T09:30:00', title: { raw: 'T6' }, content: { raw: 'c6' } });
  calls.length = 0; st = {};
  r = await I.incrementalListAll(listAll, pc, st, () => Date.parse('2026-05-04T12:00:00Z'))(ROUTE);
  assert.deepEqual(r.map((p) => p.id).sort(), [1, 2, 3, 4, 6]);
  assert.equal(r.find((p) => p.id === 2).content.raw, 'nuevo');
  assert.deepEqual([st.postsFetched, st.postsReused, st.postsRemoved], [2, 3, 1]);
  assert.ok(calls.some((c) => /modified_after=2026-05-02T11/.test(c)), 'usa modified_after con un margen de 5 minutos');
  assert.ok(!calls.some((c) => c === ROUTE), 'no baja la lista completa');
  // sin cambios: nada que bajar
  calls.length = 0; st = {};
  await I.incrementalListAll(listAll, pc, st)(ROUTE);
  assert.deepEqual([st.postsFetched, st.postsReused], [0, 5]); assert.equal(calls.length, 1);
  // rutas con otros campos (la configuración de la copia de emergencia) no pasan por la caché
  calls.length = 0;
  await I.incrementalListAll(listAll, pc, {})('/wp/v2/pages?context=edit&_fields=id,parent,slug');
  assert.deepEqual(calls, ['/wp/v2/pages?context=edit&_fields=id,parent,slug']);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- copia completa + manifiesto + verificación
async function makeZip(dir, { photos = 2, changeBuf } = {}) {
  const file = path.join(dir, 'ecos-web-x-2026-05-03-0300.zip');
  const media = Array.from({ length: photos }, (_, i) => ({ id: i + 1, url: `https://x.org/wp-content/uploads/2026/05/f${i}.jpg`, date: '2026-05-01T00:00:00', name: 'f' + i, mime: 'image/jpeg' }));
  const stats = {};
  const mc = new I.MediaCache(path.join(dir, 'cache'));
  const raw = async (u) => Buffer.from('JPEG' + u);
  const r = await BC.createBackup({
    siteName: 'X', siteUrl: 'https://x.org', media, download: I.cachedDownload(mc, media, raw, stats),
    listAll: async (route) => (/posts/.test(route) ? [{ id: 1, title: { raw: 'Hola' }, content: { raw: '<p>x</p>' }, excerpt: { raw: '' }, date: '2026-05-01T10:00:00', date_gmt: '2026-05-01T10:00:00', status: 'publish', slug: 'hola', link: 'https://x.org/hola', categories: [], tags: [] }] : []),
  }, { file, photos: true, beforeFinish: (zip) => V.addManifest(zip, { kind: 'web', site: 'https://x.org', counts: { photos: 2 }, incremental: stats }) });
  mc.save();
  return { file, r, stats };
}

test('verificar: copia íntegra con manifiesto; tras la segunda copia las fotos salen de la caché', async () => {
  const dir = tmp();
  const { file, r, stats } = await makeZip(dir);
  assert.equal(r.files, 2); assert.equal(stats.mediaDownloaded, 2);
  const v = await V.verifyZip(file);
  assert.equal(v.ok, true, v.problems.join('|')); assert.equal(v.manifest, 'ok'); assert.equal(v.kind, 'web');
  assert.equal(v.entries, 4); // XML + 2 fotos + manifiesto
  assert.equal(v.info.incremental.mediaDownloaded, 2);
  // segunda copia con la misma caché: cero descargas y el mismo contenido
  const media = Array.from({ length: 2 }, (_, i) => ({ id: i + 1, url: `https://x.org/wp-content/uploads/2026/05/f${i}.jpg`, date: '2026-05-01T00:00:00' }));
  const st2 = {}; const mc = new I.MediaCache(path.join(dir, 'cache'));
  const d = I.cachedDownload(mc, media, async () => { throw new Error('no debería bajar nada'); }, st2);
  assert.ok((await d(media[0].url)).toString().startsWith('JPEG'));
  assert.equal(st2.mediaReused, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verificar: detecta un byte alterado, un ZIP cortado y un archivo que falta en el manifiesto', async () => {
  const dir = tmp();
  const { file } = await makeZip(dir);
  const good = fs.readFileSync(file);
  // byte cambiado dentro de una foto
  const bad = Buffer.from(good); const i = bad.indexOf('JPEGhttps://x.org/wp-content/uploads/2026/05/f1.jpg'); assert.ok(i > 0); bad[i + 10] ^= 0xff;
  const f1 = path.join(dir, 'malo.zip'); fs.writeFileSync(f1, bad);
  const v1 = await V.verifyZip(f1);
  assert.equal(v1.ok, false); assert.match(v1.problems.join(' '), /dañado/);
  // cortado a la mitad: sin índice
  const f2 = path.join(dir, 'corto.zip'); fs.writeFileSync(f2, good.subarray(0, good.length >> 1));
  const v2 = await V.verifyZip(f2);
  assert.equal(v2.ok, false); assert.match(v2.problems.join(' '), /incompleto o dañado/);
  // archivo que ya no está
  const v3 = await V.verifyZip(path.join(dir, 'no-existe.zip'));
  assert.equal(v3.ok, false);
  // ZIP de Ecos sin manifiesto (copias antiguas): se comprueba la integridad y se avisa
  const z = new BC.ZipWriter(path.join(dir, 'viejo.zip')); await z.add('ecos-copia-de-seguridad.xml', Buffer.from('<rss></rss>')); await z.finish();
  const v4 = await V.verifyZip(path.join(dir, 'viejo.zip'));
  assert.equal(v4.ok, true); assert.equal(v4.manifest, 'missing'); assert.equal(v4.kind, 'web');
  // un ZIP cualquiera no es una copia
  const z2 = new BC.ZipWriter(path.join(dir, 'otro.zip')); await z2.add('hola.txt', Buffer.from('hola')); await z2.finish();
  assert.equal((await V.verifyZip(path.join(dir, 'otro.zip'))).ok, false);
  // XML suelto: completo o cortado
  fs.writeFileSync(path.join(dir, 'a.xml'), '<rss><channel></channel></rss>\n'); fs.writeFileSync(path.join(dir, 'b.xml'), '<rss><channel>');
  assert.equal((await V.verifyZip(path.join(dir, 'a.xml'))).ok, true); assert.equal((await V.verifyZip(path.join(dir, 'b.xml'))).ok, false);
  // cancelar
  await assert.rejects(V.verifyZip(file, { cancelled: () => true }), /Cancelado/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('manifiesto: el ZIP restaura igual (el restaurador ignora el archivo extra)', async () => {
  const dir = tmp();
  const { file } = await makeZip(dir);
  const B = require('../src/backup');
  const an = await B.analyze([file]);
  assert.equal(an.posts.length, 1);
  an.sources.forEach((x) => x.close());
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- Google Drive (red simulada)
const res = (status, body = {}, headers = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null } });

test('Drive: carpeta «Ecos · Copias» y subida reanudable por trozos con un corte de red en medio', async () => {
  const dir = tmp(); const file = path.join(dir, 'c.zip'); fs.writeFileSync(file, Buffer.alloc(1000, 7));
  const log = []; let received = 0, flaky = true;
  const fetch = async (url, o = {}) => {
    const u = String(url), m = o.method || 'GET';
    log.push(m + ' ' + u.replace(/\?.*/, ''));
    if (u.startsWith('https://oauth2.googleapis.com/token')) return res(200, { access_token: 'AT', expires_in: 3600 });
    if (m === 'GET' && u.includes('/drive/v3/files?')) return res(200, { files: [] });
    if (m === 'POST' && u.startsWith('https://www.googleapis.com/drive/v3/files')) return res(200, { id: 'FOLDER' });
    if (m === 'POST' && u.includes('uploadType=resumable')) { assert.equal(JSON.parse(o.body).parents[0], 'FOLDER'); assert.equal(o.headers['X-Upload-Content-Length'], '1000'); return res(200, {}, { location: 'https://up/session1' }); }
    if (u === 'https://up/session1') {
      const cr = o.headers['Content-Range'];
      if (cr.startsWith('bytes */')) return res(308, {}, received ? { range: `bytes=0-${received - 1}` } : {});
      const [, a, b] = /bytes (\d+)-(\d+)\/1000/.exec(cr).map(Number);
      assert.equal(a, received, 'cada trozo empieza donde acabó el anterior');
      if (flaky && a >= 400) { flaky = false; throw new Error('ECONNRESET'); } // se corta en el segundo trozo
      received = b + 1;
      return received === 1000 ? res(200, { id: 'FILE1', name: 'c.zip' }) : res(308, {}, { range: `bytes=0-${received - 1}` });
    }
    throw new Error('petición inesperada ' + m + ' ' + u);
  };
  const cfg = { gpClientId: 'cid', gpClientSecret: 'sec', gdRefreshToken: 'RT' };
  const gd = G.make({ fetch, sleep: async () => {}, save: () => {} });
  const parent = await gd.ensureFolder(cfg);
  assert.equal(parent, 'FOLDER'); assert.equal(cfg.gdFolderId, 'FOLDER');
  const prog = []; let session = '';
  const up = await gd.upload(cfg, { name: 'c.zip', src: G.fileSource(file), parent }, { chunk: 200, onProgress: (p) => prog.push(p.done), onSession: (u) => { session = u; } });
  assert.equal(up.id, 'FILE1'); assert.equal(session, 'https://up/session1');
  assert.equal(prog.at(-1), 1000);
  assert.ok(log.filter((l) => l.startsWith('PUT https://up')).length >= 6);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Drive: reanuda una sesión guardada, y avisa con claridad si la API no está activada', async () => {
  const dir = tmp(); const file = path.join(dir, 'c.zip'); fs.writeFileSync(file, Buffer.alloc(500, 1));
  const cfg = { gpClientId: 'c', gpClientSecret: 's', gdRefreshToken: 'RT', gdAccessToken: 'AT', gdTokenExpires: new Date(Date.now() + 3600e3).toISOString() };
  const ranges = [];
  const fetch = async (u, o = {}) => {
    const cr = o.headers['Content-Range'];
    if (cr === 'bytes */500') return res(308, {}, { range: 'bytes=0-299' });
    ranges.push(cr); return res(200, { id: 'F' });
  };
  const gd = G.make({ fetch, sleep: async () => {} });
  const up = await gd.upload(cfg, { name: 'c.zip', src: G.fileSource(file) }, { session: 'https://up/old' });
  assert.equal(up.id, 'F'); assert.deepEqual(ranges, ['bytes 300-499/500']);
  const off = G.make({ fetch: async () => res(403, { error: { message: 'Google Drive API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }) });
  await assert.rejects(off.ensureFolder({ ...cfg, gdFolderId: '' }), /Drive API no está activada/);
  assert.match(G.friendly(403, {}), /rechazado el permiso/);
  assert.equal(G.SCOPE, 'https://www.googleapis.com/auth/drive.file');
  const url = G.authUrl({ gpClientId: 'cid' }, { state: 's', challenge: 'c' });
  assert.match(url, /scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file/);
  fs.rmSync(dir, { recursive: true, force: true });
});
