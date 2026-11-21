// Pruebas de la «Revisión» del blog: sin categoría, primera foto y recomendación de categorías.
const test = require('node:test');
const assert = require('node:assert/strict');

test('sin categoría: ninguna o solo la de WordPress por defecto', () => {
  const C = require('../renderer/blogcheck');
  assert.equal(C.isUncategorized([]), true);
  assert.equal(C.isUncategorized(['Uncategorized']), true);
  assert.equal(C.isUncategorized(['Sin categoría']), true);
  assert.equal(C.isUncategorized(['Sin categoria', 'Uncategorized']), true);
  assert.equal(C.isUncategorized(['Sin categoría', 'Talleres']), false);
  assert.equal(C.isUncategorized(['Noticias']), false);
});

test('primera foto: de HTML y de bloques, con cualquier número de fotos', () => {
  const C = require('../renderer/blogcheck');
  assert.equal(C.firstPhotoHtml('<p>x</p>'), null);
  assert.equal(C.firstPhotoHtml('<img class="wp-smiley" src="https://x/e.png"><img class="wp-image-7" src="https://x/a.jpg"><img src="https://x/b.jpg">').url, 'https://x/a.jpg');
  assert.equal(C.firstPhotoHtml('<img class="wp-image-7" src="https://x/a.jpg">').id, 7);
  assert.equal(C.firstPhotoHtml('<img src="data:image/png;base64,AA">'), null);
  const blocks = [{ type: 'paragraph' }, { type: 'gallery', images: [{ url: 'https://x/g1.jpg' }, { url: 'https://x/g2.jpg' }] }, { type: 'image', img: { url: 'https://x/i.jpg' } }];
  assert.equal(C.firstImage(blocks).url, 'https://x/g1.jpg');
  assert.equal(C.firstImage([{ type: 'paragraph' }]), null);
});

test('recomendar categorías: 12 entradas de 3 temas → 3 grupos con nombres razonables', () => {
  const { recommend } = require('../src/topics');
  const mk = (id, title, excerpt, text) => ({ id, title, excerpt, text, categories: [] });
  const posts = [
    mk(1, 'Jornada de voluntariado en la playa', 'Los voluntarios limpiaron la playa', 'Más de treinta voluntarios participaron en la limpieza. El voluntariado une a la gente.'),
    mk(2, 'Nuevos voluntarios para el banco de alimentos', 'Se buscan voluntarios', 'El voluntariado es la base del banco de alimentos; cada voluntario reparte comida.'),
    mk(3, 'Gracias a nuestros voluntarios', 'Homenaje al voluntariado', 'Los voluntarios recibieron un reconocimiento por su voluntariado durante el año.'),
    mk(4, 'Programa de voluntariado juvenil', 'Jóvenes voluntarios', 'Los jóvenes voluntarios colaboran con las familias en el programa de voluntariado.'),
    mk(5, 'Torneo de fútbol solidario', 'Gran torneo de fútbol', 'El torneo de fútbol reunió a ocho equipos. El deporte une a los barrios.'),
    mk(6, 'Carrera popular por la integración', 'Una carrera deportiva', 'La carrera popular y el deporte juntaron a cientos de corredores en el paseo.'),
    mk(7, 'Torneo de baloncesto en el pabellón', 'Baloncesto y deporte', 'El torneo de baloncesto fue un éxito deportivo. Los equipos jugaron todo el día.'),
    mk(8, 'Clases de natación para niños', 'Deporte para los pequeños', 'Las clases de natación y deporte escolar empiezan en octubre con torneo final.'),
    mk(9, 'Derechos de las personas migrantes en la frontera', 'Defensa de los derechos', 'Denunciamos la vulneración de derechos en la frontera. La frontera exige respeto a los derechos humanos.'),
    mk(10, 'Informe sobre la frontera y los derechos', 'Situación en la frontera', 'El informe recoge casos de derechos vulnerados en la frontera con Marruecos.'),
    mk(11, 'Jornada sobre derechos y fronteras', 'Mesa redonda', 'Expertos analizaron los derechos de los migrantes y la política de fronteras.'),
    mk(12, 'Asistencia jurídica en la frontera', 'Abogados y derechos', 'Nuestros abogados defienden los derechos de quienes cruzan la frontera.'),
  ];
  const r = recommend(posts, []);
  assert.equal(r.length, 3, JSON.stringify(r.map((g) => [g.name, g.posts.map((p) => p.id)])));
  const grp = (ids) => r.find((g) => ids.every((i) => g.posts.some((p) => p.id === i)));
  const gv = grp([1, 2, 3, 4]), gd = grp([5, 6, 7, 8]), gf = grp([9, 10, 11, 12]);
  assert.ok(gv && gd && gf && new Set([gv, gd, gf]).size === 3, JSON.stringify(r.map((g) => [g.name, g.posts.map((p) => p.id)])));
  assert.match(gv.name.toLowerCase(), /voluntari/);
  assert.match(gd.name.toLowerCase(), /deport|torneo/);
  assert.match(gf.name.toLowerCase(), /derecho|frontera/);
  assert.ok(r.every((g) => g.isNew && g.posts.length >= 3 && g.keywords.length));
  // con una categoría existente cuyo nombre coincide, se propone esa
  const r2 = recommend(posts, [{ id: 40, name: 'Voluntariado' }]);
  const ex = r2.find((g) => g.existingId === 40);
  assert.ok(ex && !ex.isNew && ex.name === 'Voluntariado');
  // las entradas que ya la tienen no se repiten
  posts[0].categories = ['Voluntariado'];
  assert.ok(!recommend(posts, [{ id: 40, name: 'Voluntariado' }]).find((g) => g.existingId === 40).posts.some((p) => p.id === 1));
});
