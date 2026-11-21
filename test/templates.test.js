// Plantillas de contenido (renderer/templates.js): lógica pura
const test = require('node:test');
const assert = require('node:assert/strict');
const CT = require('../renderer/templates');

test('plantillas de contenido: convertir bloques en plantilla quita fotos y conserva la estructura', () => {
  const blocks = [
    { id: 'a', type: 'heading', level: 2, html: 'Qué hicimos' },
    { id: 'b', type: 'image', img: { id: 5, url: 'https://x/a.jpg', alt: 'a' }, caption: 'pie' },
    { id: 'c', type: 'gallery', images: [{ id: 6, url: 'https://x/b.jpg' }], columns: 2 },
    { id: 'd', type: 'video', video: { id: 3, url: 'https://x/v.mp4' } },
    { id: 'e', type: 'buttons', html: 'Colabora', url: 'https://x', align: 'center', variant: 'fill' },
    { id: 'f', type: 'raw', markup: '<img class="wp-image-3" src="x">' },
  ];
  const copy = JSON.stringify(blocks);
  const out = CT.blocksToTemplate(blocks);
  assert.equal(JSON.stringify(blocks), copy, 'no modifica el original');
  assert.deepEqual(out.map((b) => b.type), ['heading', 'image', 'gallery', 'video', 'buttons']);
  assert.ok(out.every((b) => !('id' in b)));
  assert.equal(out[0].html, 'Qué hicimos');
  assert.equal(out[1].img, null); assert.deepEqual(out[2].images, []); assert.equal(out[2].columns, 2); assert.equal(out[3].video, null);
  assert.equal(out[4].url, 'https://x');
  const u = CT.makeUserTemplate('  Mi plantilla ', blocks, 'page');
  assert.equal(u.name, 'Mi plantilla'); assert.equal(u.type, 'page'); assert.ok(!('title' in u));
});

test('plantillas de contenido: qué se ofrece para entradas y páginas', () => {
  const mine = { name: 'P', type: 'post', blocks: [] };
  assert.deepEqual(CT.forType('page', []).builtin.map((x) => x.id), ['informativa', 'contacto']);
  assert.deepEqual(CT.forType('post', [mine]).builtin.map((x) => x.id), ['actividad', 'comunicado', 'campana']);
  assert.equal(CT.forType('post', [mine]).own.length, 1);
  assert.equal(CT.forType('page', [mine]).own.length, 0);
});
