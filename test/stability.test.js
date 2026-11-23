// Estabilidad: copias locales antes de enviar (rotación de 20, restauración) y registro de errores (rotación y filtrado).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SB = require('../src/sendbackup');
const { createLogger, redact, MAX_BYTES } = require('../src/logger');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-stab-'));
const rec = (n) => ({ title: 'Título ' + n, content: `<!-- wp:paragraph -->\n<p>Texto número ${n} de la entrada</p>\n<!-- /wp:paragraph -->`, excerpt: 'Ext ' + n, status: 'publish' });

test('copia antes de enviar: guarda lo que había en WordPress y lo que se envía', () => {
  const root = tmp();
  const name = SB.save(root, 'post', 42, { current: rec(1), sending: rec(2) }, new Date('2026-05-01T10:20:30.123Z'));
  assert.equal(name, '2026-05-01T10-20-30-123Z.json');
  const file = path.join(root, 'send-backups', 'post-42', name);
  assert.ok(fs.existsSync(file));
  const r = SB.read(root, 'post', 42, name);
  assert.equal(r.current.title, 'Título 1');
  assert.equal(r.sending.title, 'Título 2');
  assert.deepEqual(Object.keys(r.current).sort(), ['content', 'excerpt', 'status', 'title']);
  assert.equal(r.type, 'post');
  assert.equal(r.id, 42);
  // las páginas van en su propia carpeta
  SB.save(root, 'page', 42, { current: rec(3), sending: rec(4) });
  assert.ok(fs.existsSync(path.join(root, 'send-backups', 'page-42')));
  assert.equal(SB.list(root, 'page', 42).length, 1);
  assert.equal(SB.list(root, 'post', 42).length, 1);
});

test('copia antes de enviar: se conservan las 20 últimas por entrada (y solo de esa entrada)', () => {
  const root = tmp();
  for (let i = 0; i < 27; i++) SB.save(root, 'post', 7, { current: rec(i), sending: rec(i + 1) }, new Date(Date.UTC(2026, 0, 1, 0, i, 0)));
  SB.save(root, 'post', 8, { current: rec(100), sending: rec(101) }, new Date(Date.UTC(2026, 0, 1)));
  const l = SB.list(root, 'post', 7);
  assert.equal(l.length, 20);
  assert.equal(l[0].title, 'Título 26'); // la más reciente primero
  assert.equal(l[19].title, 'Título 7'); // se borraron de la 0 a la 6
  assert.equal(SB.list(root, 'post', 8).length, 1);
  assert.equal(fs.readdirSync(path.join(root, 'send-backups', 'post-7')).length, 20);
});

test('copia antes de enviar: dos envíos en el mismo milisegundo no se pisan', () => {
  const root = tmp();
  const at = new Date('2026-05-01T10:00:00.000Z');
  const a = SB.save(root, 'post', 5, { current: rec(1), sending: rec(2) }, at);
  const b = SB.save(root, 'post', 5, { current: rec(3), sending: rec(4) }, at);
  assert.notEqual(a, b);
  const l = SB.list(root, 'post', 5);
  assert.equal(l.length, 2);
  assert.equal(l[0].title, 'Título 3'); // la segunda es la más reciente
});

test('copia antes de enviar: si no se pudo leer WordPress, se guarda igualmente lo que se envía', () => {
  const root = tmp();
  const name = SB.save(root, 'post', 9, { current: null, sending: rec(1), error: 'HTTP 404' });
  const [item] = SB.list(root, 'post', 9);
  assert.equal(item.file, name);
  assert.equal(item.hasCurrent, false);
  assert.equal(item.error, 'HTTP 404');
  assert.equal(SB.read(root, 'post', 9, name).sending.title, 'Título 1');
});

test('restaurar: la copia devuelve el contenido anterior y se puede pasar a bloques del editor', () => {
  const root = tmp();
  const before = { title: 'Antes', content: '<!-- wp:paragraph -->\n<p>Hola <strong>mundo</strong></p>\n<!-- /wp:paragraph -->\n\n<!-- wp:heading -->\n<h2 class="wp-block-heading" id="uno">Uno</h2>\n<!-- /wp:heading -->', excerpt: 'Resumen', status: 'draft' };
  const name = SB.save(root, 'post', 11, { current: before, sending: rec(2) });
  const r = SB.read(root, 'post', 11, name);
  assert.equal(r.current.content, before.content);
  assert.equal(r.current.excerpt, 'Resumen');
  assert.equal(r.current.status, 'draft');
  const blocks = require('../src/parseblocks').parseBlocks(r.current.content);
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'heading']);
  assert.equal(blocks[0].html, 'Hola <strong>mundo</strong>');
  // el resumen de la lista cuenta palabras del texto, no del marcado
  assert.equal(SB.list(root, 'post', 11)[0].words, 3);
});

test('copia antes de enviar: no se puede leer nada fuera de la carpeta de copias', () => {
  const root = tmp();
  SB.save(root, 'post', 1, { current: rec(1), sending: rec(2) });
  assert.throws(() => SB.read(root, 'post', 1, '../../config.json'), /no válida/);
  assert.throws(() => SB.read(root, 'post', 1, 'x.json'), /no válida/);
  assert.equal(SB.save(root, 'post', '../..', { current: rec(1), sending: rec(2) }), null);
  assert.deepEqual(SB.list(root, 'post', 999), []);
});

// ---------------------------------------------------------------- registro de errores
test('registro: filtra Authorization, Bearer, access_token, contraseñas y contraseñas de aplicación de WordPress', () => {
  const cases = [
    ['Authorization: Basic dXN1YXJpbzpjbGF2ZQ==', 'dXN1YXJpbzpjbGF2ZQ'],
    ['authorization: Bearer abc.def-123_xyz', 'abc.def-123_xyz'],
    ['headers {"Authorization":"Bearer EAAGm0PX4ZCpsBAxxxxxxxxxxxxxxxxxxxxxxxx"}', 'EAAGm0PX4'],
    ['GET https://graph.facebook.com/v23.0/me?access_token=EAABsbCS1iHgBO12345&fields=id', 'EAABsbCS1iHgBO12345'],
    ['{"access_token":"ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxx","expires_in":3599}', 'ya29.a0AfH6SMB'],
    ['refresh_token=1//0gAbCdEfGhIjK&client_secret=GOCSPX-abcdef', 'GOCSPX-abcdef'],
    ['password=hunter2 usuario=ana', 'hunter2'],
    ['{"password":"mi clave secreta"}', 'mi clave'],
    ['Contraseña de aplicación: abcd EFGH 1234 ijkl MNOP 5678 enviada', 'abcd EFGH'],
    ['clave sk-ant-api03-AbCdEfGhIjKlMnOpQrSt', 'sk-ant-api03'],
    ['conectando a https://ana:secreta123@mi-blog.com/wp-json', 'secreta123'],
    ['Bearer 12345678abcdef', '12345678abcdef'],
  ];
  for (const [input, secret] of cases) {
    const out = redact(input);
    assert.ok(!out.includes(secret), `se filtró mal: «${input}» → «${out}»`);
    assert.match(out, /\[oculto\]/, input);
  }
  // el resto del texto se conserva
  assert.equal(redact('GET /wp-json/wp/v2/posts?per_page=5 → 404'), 'GET /wp-json/wp/v2/posts?per_page=5 → 404');
  assert.equal(redact('No se pudo subir la imagen foto.jpg (ENOENT)'), 'No se pudo subir la imagen foto.jpg (ENOENT)');
  assert.match(redact('error con access_token=ABC123 y más texto'), /^error con access_token=\[oculto\] y más texto$/);
});

test('registro: escribe líneas con fecha y nivel, sin datos sensibles, y las muestra con tail', () => {
  const dir = tmp();
  const file = path.join(dir, 'logs', 'ecos.log');
  const log = createLogger({ file, now: () => new Date('2026-05-01T08:00:00.000Z') });
  log.warn('No se pudo subir', { url: 'https://x/a.jpg?access_token=SECRETO123' });
  log.error(new Error('Falló con Authorization: Bearer TOKENLARGO99'));
  const txt = fs.readFileSync(file, 'utf8');
  assert.match(txt, /^\[2026-05-01T08:00:00\.000Z\] \[AVISO\] No se pudo subir/);
  assert.match(txt, /\[ERROR\] Error: Falló con/);
  assert.ok(!/SECRETO123|TOKENLARGO99/.test(txt));
  assert.equal(log.tail(1).split('\n').length > 0, true);
  assert.equal(log.tail(200), txt.trimEnd());
});

test('registro: tail devuelve las últimas 200 líneas', () => {
  const dir = tmp();
  const log = createLogger({ file: path.join(dir, 'logs', 'ecos.log') });
  for (let i = 1; i <= 350; i++) log.info('línea ' + i);
  const lines = log.tail(200).split('\n');
  assert.equal(lines.length, 200);
  assert.match(lines[0], /línea 151$/);
  assert.match(lines[199], /línea 350$/);
});

test('registro: rotación a 1 MB, guardando una copia .1', () => {
  const dir = tmp();
  const file = path.join(dir, 'logs', 'ecos.log');
  const log = createLogger({ file });
  const big = 'x'.repeat(1000);
  for (let i = 0; i < 1200; i++) log.info(big, i);
  assert.ok(fs.existsSync(file + '.1'), 'debe existir ecos.log.1');
  assert.ok(fs.statSync(file).size <= MAX_BYTES);
  assert.ok(fs.statSync(file + '.1').size <= MAX_BYTES);
  assert.equal(MAX_BYTES, 1024 * 1024);
  // solo hay un archivo antiguo (no se acumulan .2, .3…)
  assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), ['ecos.log', 'ecos.log.1']);
  // las últimas líneas siguen siendo las más recientes, aunque se haya rotado
  assert.match(log.tail(1), / 1199$/);
});

test('registro: tail completa con la copia anterior tras rotar y vaciar lo borra todo', () => {
  const dir = tmp();
  const file = path.join(dir, 'logs', 'ecos.log');
  const log = createLogger({ file, maxBytes: 300 });
  for (let i = 1; i <= 12; i++) log.info('mensaje ' + i);
  assert.ok(fs.existsSync(file + '.1'));
  const lines = log.tail(200).split('\n');
  assert.match(lines[lines.length - 1], /mensaje 12$/);
  assert.ok(lines.length > fs.readFileSync(file, 'utf8').trim().split('\n').length, 'incluye líneas de .1');
  log.clear();
  assert.equal(log.tail(200), '');
  assert.ok(!fs.existsSync(file) && !fs.existsSync(file + '.1'));
  log.info('otra vez');
  assert.match(log.tail(10), /otra vez$/);
});

test('registro: las líneas de continuación (pila de un error) quedan sangradas bajo su línea', () => {
  const dir = tmp();
  const log = createLogger({ file: path.join(dir, 'logs', 'ecos.log') });
  log.error('Fallo\n   at fn (x.js:1:1)\n   at y (z.js:2:2)');
  const lines = fs.readFileSync(log.file, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^\[.*\] \[ERROR\] Fallo$/);
  assert.match(lines[1], /^ {4}/);
});
