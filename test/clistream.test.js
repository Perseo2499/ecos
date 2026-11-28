// Fotos para Claude Code dentro del mensaje (stream-json): sin herramientas ni archivos que haya que leer
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/clirun');

test('el mensaje stream-json lleva las fotos en orden y después el texto', () => {
  const line = C.streamMessage('Describe la foto', [{ mediaType: 'image/webp', base64: 'AAA' }, { mediaType: 'image/png', base64: 'BBB' }], '\n\nSolo el texto.');
  assert.ok(line.endsWith('\n'));
  const j = JSON.parse(line);
  assert.equal(j.type, 'user'); assert.equal(j.message.role, 'user');
  const c = j.message.content;
  assert.deepEqual(c.map((x) => x.type), ['text', 'image', 'text', 'image', 'text']);
  assert.deepEqual(c[1].source, { type: 'base64', media_type: 'image/webp', data: 'AAA' });
  assert.equal(c[3].source.data, 'BBB');
  assert.equal(c[4].text, 'Describe la foto\n\nSolo el texto.');
});

test('se lee la última línea «result» de la salida stream-json', () => {
  const out = ['{"type":"system","subtype":"init"}', '{"type":"assistant","message":{}}', 'basura', '{"type":"result","is_error":false,"result":"Un grupo de personas"}', ''].join('\n');
  assert.equal(C.lastResult(out).result, 'Un grupo de personas');
  assert.equal(C.lastResult('nada'), null);
});
