// Fotos en WebP al subirlas y borradores automáticos de las publicaciones nuevas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const I = require('../src/imgopt');
const PD = require('../src/photodate');
const V = require('../src/videoq');
const AD = require('../renderer/autodrafts');

// ---------------------------------------------------------------- WebP
test('decisión de convertir a WebP (función pura)', () => {
  const base = { kind: 'jpeg', size: 900e3, alpha: false, enabled: true, webp: true };
  assert.equal(I.decide(base), 'webp');
  assert.equal(I.decide({ ...base, kind: 'png' }), 'webp');
  assert.equal(I.decide({ ...base, kind: 'png', alpha: true }), 'legacy', 'PNG con transparencia: no se convierte');
  assert.equal(I.decide({ ...base, webp: false }), 'legacy', 'ajuste apagado');
  assert.equal(I.decide({ ...base, size: 10e3 }), 'legacy', 'foto diminuta');
  assert.equal(I.decide({ ...base, kind: 'webp' }), 'legacy');
  assert.equal(I.decide({ ...base, kind: null }), 'legacy', 'GIF y demás no se tocan');
  assert.equal(I.kindOf('image/png', 'a'), 'png'); assert.equal(I.kindOf('', 'F.JPG'), 'jpeg');
});

test('PNG: detecta si puede tener transparencia', () => {
  const png = (ct, extra = []) => {
    const ihdr = Buffer.alloc(25); ihdr.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); ihdr.writeUInt32BE(13, 8); ihdr.write('IHDR', 12, 'latin1'); ihdr[25 - 1] = 0;
    const b = Buffer.alloc(33); ihdr.copy(b); b[25] = ct;
    const chunks = extra.map((id) => { const c = Buffer.alloc(12); c.writeUInt32BE(0, 0); c.write(id, 4, 'latin1'); return c; });
    return Buffer.concat([b, ...chunks]);
  };
  assert.equal(I.pngAlphaCapable(png(2)), false);
  assert.equal(I.pngAlphaCapable(png(6)), true);
  assert.equal(I.pngAlphaCapable(png(4)), true);
  assert.equal(I.pngAlphaCapable(png(3, ['PLTE'])), false);
  assert.equal(I.pngAlphaCapable(png(3, ['tRNS'])), true);
  assert.equal(I.pngAlphaCapable(Buffer.from('nada')), false);
});

const ff = V.ffmpegPath();
const hasWebp = ff && /libwebp/.test(spawnSync(ff, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-t-'));
// JPEG de prueba generada con ffmpeg, con la fecha de captura metida en su EXIF
function makeJpeg(w, h, date) {
  const f = path.join(tmp, `t${w}.jpg`);
  spawnSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}`, '-frames:v', '1', '-q:v', '2', f]);
  let buf = fs.readFileSync(f);
  if (date) {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
    const t = Buffer.alloc(64);
    t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
    t.writeUInt16LE(1, 8); t.writeUInt16LE(0x8769, 10); t.writeUInt16LE(4, 12); t.writeUInt32LE(1, 14); t.writeUInt32LE(26, 18);
    t.writeUInt16LE(1, 26); t.writeUInt16LE(0x9003, 28); t.writeUInt16LE(2, 30); t.writeUInt32LE(20, 32); t.writeUInt32LE(44, 36);
    t.write(`${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6]}\0`, 44, 'latin1');
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
    buf = Buffer.concat([buf.subarray(0, 2), app1, buf.subarray(2)]);
  }
  return buf;
}

test('conversión real a WebP: más ligera, ≤ 2560 px y con la fecha de captura', { skip: !hasWebp && 'sin ffmpeg con libwebp' }, async () => {
  const jpg = makeJpeg(3600, 2400, '2019-05-12T10:20:30');
  assert.equal(PD.exifDate(jpg), '2019-05-12T10:20:30');
  const r = await I.prepare(jpg, 'image/jpeg', 'IMG_1.jpg');
  assert.equal(r.webp, true); assert.equal(r.type, 'image/webp'); assert.equal(r.name, 'IMG_1.webp');
  assert.ok(r.buf.length < jpg.length);
  assert.equal(PD.exifDate(r.buf), '2019-05-12T10:20:30', 'la fecha de captura se conserva');
  const out = path.join(tmp, 'o.webp'); fs.writeFileSync(out, r.buf);
  const pr = spawnSync(ff, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr;
  assert.match(pr, /Video: webp.* 2560x1707/, 'sigue siendo un WebP válido y legible, con el lado mayor a 2560');
  assert.equal(typeof r.fallback().buf.length, 'number');
});

test('WebP: sin ajuste activado (o si no compensa) se sube como siempre', { skip: !hasWebp && 'sin ffmpeg con libwebp' }, async () => {
  const jpg = makeJpeg(1200, 800);
  I.setWebp(() => false);
  const off = await I.prepare(jpg, 'image/jpeg', 'a.jpg');
  I.setWebp(() => true);
  assert.notEqual(off.webp, true); assert.equal(off.type, 'image/jpeg');
  const tiny = Buffer.alloc(1000, 1);
  assert.notEqual((await I.prepare(tiny, 'image/jpeg', 'x.jpg')).webp, true);
  assert.equal((await I.prepare(Buffer.from('no es una imagen '.repeat(5000)), 'image/jpeg', 'x.jpg')).webp ?? false, false, 'ffmpeg falla: queda la original');
});

test('subida: si WordPress rechaza el .webp se reintenta con la original', { skip: !hasWebp && 'sin ffmpeg con libwebp' }, async () => {
  const Module = require('module'), load = Module._load; // sin Electron instalado: se simula vacío
  Module._load = function (r, ...a) { return r === 'electron' ? {} : load.call(this, r, ...a); };
  let W;
  try { W = require('../src/wpself'); } finally { Module._load = load; }
  const jpg = makeJpeg(3000, 2000);
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, o) => {
    const ct = o.headers['Content-Type'];
    sent.push(ct);
    if (ct === 'image/webp') return { ok: false, status: 400, json: async () => ({ code: 'rest_upload_invalid', message: 'Tipo no permitido' }) };
    return { ok: true, status: 201, json: async () => ({ id: 7, source_url: 'https://x.test/a.jpg' }) };
  };
  try {
    const up = await W.uploadNamed({ wpUrl: 'https://x.test', wpUser: 'u', wpAppPassword: 'abcd' }, jpg, 'a.jpg');
    assert.equal(up.id, 7);
    assert.equal(sent[0], 'image/webp'); assert.equal(sent[1], 'image/jpeg');
    sent.length = 0;
    await W.uploadNamed({ wpUrl: 'https://x.test', wpUser: 'u', wpAppPassword: 'abcd' }, jpg, 'a.jpg', { keep: true });
    assert.deepEqual(sent, ['image/jpeg'], 'keep: el original, sin tocar');
  } finally { global.fetch = realFetch; }
});

// ---------------------------------------------------------------- borradores automáticos
const post = (id, date, src = 'instagram', also = []) => ({ id, source: src, date, alsoOn: also });

test('borradores automáticos: selección, límite de 5 y orden', () => {
  const fresh = Array.from({ length: 8 }, (_, i) => post('p' + i, `2026-01-0${i + 1}T10:00:00Z`));
  const r = AD.select(fresh, { now: 1000 });
  assert.equal(r.todo.length, 5); assert.equal(r.rest.length, 3);
  assert.deepEqual(r.todo.map((p) => p.id), ['p0', 'p1', 'p2', 'p3', 'p4'], 'las más antiguas primero');
});

test('borradores automáticos: no repite exportadas, en proceso ni duplicados Instagram/Facebook', () => {
  const a = post('1', '2026-01-01T00:00:00Z', 'instagram', [{ source: 'facebook', id: 'f1' }]);
  const dup = post('f1', '2026-01-01T00:00:00Z', 'facebook'); // la misma, suelta
  const b = post('2', '2026-01-02T00:00:00Z');
  const c = post('3', '2026-01-03T00:00:00Z');
  const done = post('4', '2026-01-04T00:00:00Z');
  const claims = { 'instagram:3': 5000 };
  const r = AD.select([a, dup, b, c, done], { isExported: (p) => p.id === '4', claims, now: 1000 });
  assert.deepEqual(r.todo.map((p) => p.id), ['1', '2']);
  assert.equal(r.skipped.length, 3);
});

test('borradores automáticos: reinicio a mitad (marcas) y reintento tras fallo', () => {
  const p = post('9', '2026-02-01T00:00:00Z', 'instagram', [{ source: 'facebook', id: 'f9' }]);
  let claims = AD.claim({}, p, 1000);
  assert.deepEqual(Object.keys(claims).sort(), ['facebook:f9', 'instagram:9']);
  // la app se reinicia a mitad: la marca sigue vigente y no se vuelve a procesar
  assert.equal(AD.select([p], { claims, now: 2000 }).todo.length, 0);
  // se hace tarde de sobra (la app murió): se puede reintentar
  assert.equal(AD.select([p], { claims, now: 1000 + 7 * 3600e3 }).todo.length, 1);
  // tras un fallo se espera una hora; al terminar bien se libera
  claims = AD.fail(claims, p, 3000);
  assert.equal(AD.select([p], { claims, now: 3000 + 1800e3 }).todo.length, 0);
  assert.equal(AD.select([p], { claims, now: 3000 + 3700e3 }).todo.length, 1);
  assert.deepEqual(AD.release(claims, p, 4000), {});
  assert.deepEqual(AD.activeClaims({ a: 10, b: 5000 }, 100), { b: 5000 });
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporal */ } });
