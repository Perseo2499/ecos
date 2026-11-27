// Bloques de Spectra, Kadence y GenerateBlocks editables (edición conservadora): ida y vuelta exacta y cambios mínimos.
const test = require('node:test');
const assert = require('node:assert');
const { parseBlocks } = require('../src/parseblocks');
const { composeBlocks } = require('../src/transform');
const T = require('../renderer/thirdparty');
const S = require('./thirdparty-samples');

const first = (c) => parseBlocks(c)[0];
// delimitadores balanceados (los autocerrados no cuentan)
const balanced = (s) => { let d = 0; for (const m of s.matchAll(/<!--\s+(\/)?wp:[a-z0-9\/-]+(?:\s+\{[^]*?\})?\s*(\/)?-->/g)) { if (m[2]) continue; d += m[1] ? -1 : 1; if (d < 0) return false; } return d === 0; };

test('ida y vuelta exacta sin cambios, byte a byte', () => {
  for (const [k, s] of Object.entries(S)) {
    const bl = parseBlocks(s);
    assert.equal(bl.length, 1, k);
    assert.equal(bl[0].type, 'third', k + ' debe ser editable');
    assert.equal(composeBlocks(bl), s, k);
    assert.ok(balanced(composeBlocks(bl)), k);
  }
});
test('todos juntos y con bloques normales alrededor', () => {
  const all = '<!-- wp:paragraph -->\n<p>Antes</p>\n<!-- /wp:paragraph -->\n\n' + Object.values(S).join('\n\n') + '\n\n<!-- wp:paragraph -->\n<p>Después</p>\n<!-- /wp:paragraph -->';
  const bl = parseBlocks(all);
  assert.equal(bl.filter((b) => b.type === 'raw').length, 0);
  assert.equal(composeBlocks(bl), all);
});
test('los contenedores tienen hijos de Ecos', () => {
  const c = first(S.container);
  assert.deepEqual(c.children.map((b) => b.type), ['paragraph', 'third']);
  const r = first(S.kRow);
  assert.equal(r.children.length, 2);
  assert.equal(r.children[1].children[0].type, 'third');
});
test('cambio de texto: solo cambia el texto (y el atributo que lo repite)', () => {
  const b = first(S.buttons);
  T.setText(b.children[0], 'label', 'Adiós <b>ya</b>');
  const out = composeBlocks([b]);
  assert.equal(out, S.buttons.replace('"label":"Hola","link":"https://example.org/a?x=1&y=2"', '"label":"Adiós \\u003cstrong\\u003eya\\u003c/strong\\u003e","link":"https://example.org/a?x=1\\u0026y=2"').replace('>Hola</div>', '>Adiós <strong>ya</strong></div>'));
  assert.ok(balanced(out));
});
test('título: texto, nivel, alineación y color', () => {
  const b = first(S.heading);
  T.setText(b, 'title', 'Nuevo');
  T.setLevel(b, 3); T.setAlign(b, 'center'); T.setColor(b, 'color', '#ff0000');
  const out = composeBlocks([b]);
  assert.equal(out, S.heading.replace('Mi título &amp; más', 'Nuevo').replace('<h2 ', '<h3 ').replace('</h2>', '</h3>').replace('"headingAlign":"left","headingColor":"#222222"', '"headingAlign":"center","headingColor":"#ff0000","headingTag":"h3"'));
  const k = first(S.kHeading);
  T.setLevel(k, 4);
  assert.match(composeBlocks([k]), /<h4 class="kt-adv-heading139_abc-1 wp-block-kadence-advancedheading"[^>]*>Título Kadence<\/h4>/);
  assert.match(composeBlocks([k]), /"level":4/);
});
test('enlace y nueva ventana', () => {
  const b = first(S.buttons).children[0];
  assert.deepEqual(T.linkOf(b), { url: 'https://example.org/a?x=1&y=2', blank: true, canBlank: true });
  T.setLink(b, { url: 'https://example.org/z', blank: false });
  const o = composeBlocks([b]);
  assert.match(o, /"link":"https:\/\/example.org\/z"/);
  assert.ok(!/opensInNewTab/.test(o));
  assert.match(o, /href="https:\/\/example.org\/z"[^>]*target="_self"/);
  const g = first(S.gCont).children[0];
  T.setLink(g, { blank: false });
  assert.doesNotMatch(composeBlocks([g]), /target=|rel=|"target"/);
  const kb = first(S.kBtns).children[0];
  T.setText(kb, 'text', 'Otro'); T.setLink(kb, { url: 'https://example.org/q' });
  assert.equal(composeBlocks([kb]), '<!-- wp:kadence/singlebtn {"uniqueID":"139_sb-1","text":"Otro","link":"https://example.org/q","target":"_blank","background":"#ff0000"} /-->');
  assert.equal(T.linkOf(kb).url, 'https://example.org/q');
});
test('imagen de Spectra: alt y cambio de foto', () => {
  const b = first(S.image);
  T.setAlt(b, 'Nueva alt');
  assert.match(composeBlocks([b]), /alt="Nueva alt" class="uag-image-12"/);
  T.setImage(b, { id: 99, url: 'https://example.org/b.jpg', alt: 'B', width: 100, height: 50 });
  const o = composeBlocks([b]);
  assert.match(o, /src="https:\/\/example.org\/b.jpg" alt="B" class="uag-image-99" width="100" height="50"/);
  assert.match(o, /"url":"https:\/\/example.org\/b.jpg"/);
  assert.match(o, /"id":99/);
});
test('cambios en un hijo de contenedor', () => {
  const r = first(S.kRow);
  T.setText(r.children[1].children[0], 'text', 'Dos bis');
  r.children[0].children[0].html = 'Uno bis';
  assert.equal(composeBlocks([r]), S.kRow.replace('>Dos<', '>Dos bis<').replace('<p>Uno</p>', '<p>Uno bis</p>'));
});
test('estructuras raras caen a raw', () => {
  const odd = [
    S.heading.replace('uagb-heading-text', 'otra-clase'),
    S.kBtns.replace('/--></div>', '--><!-- /wp:kadence/singlebtn --></div>'),
    S.gHead.replace('{"uniqueId":"1a2b3c4d","element":"h2"}', '{"uniqueId":"1a2b3c4d",}'),
    S.info.replace('<p class="uagb-ifb-desc">Descripción</p>', '<div class="uagb-ifb-desc"><!-- wp:paragraph --><p>x</p><!-- /wp:paragraph --></div>'),
    S.container.replace('\n\n<!-- wp:uagb/advanced', 'sueltos<!-- wp:uagb/advanced'),
  ];
  for (const s of odd) { const b = parseBlocks(s); assert.equal(composeBlocks(b), s); }
  assert.equal(parseBlocks(odd[0])[0].type, 'raw');
  assert.equal(parseBlocks(odd[1])[0].type, 'third'); // el contenedor se acepta; el hijo raro queda raw
  assert.equal(parseBlocks(odd[1])[0].children[0].type, 'raw');
  assert.equal(parseBlocks(odd[2])[0].type, 'raw');
  assert.equal(parseBlocks(odd[3])[0].type, 'raw');
  assert.equal(parseBlocks(odd[4])[0].type, 'raw');
});
test('el comentario JSON modificado es válido', () => {
  const b = first(S.info);
  T.setText(b, 'title', 'Ñandú "x" --y--'); T.setText(b, 'cta', 'Más <b>info</b> & co'); T.setLink(b, { url: 'https://example.org/n?a=1&b=2' });
  const out = composeBlocks([b]);
  const j = JSON.parse(out.match(/^<!-- wp:uagb\/info-box (\{.*?\}) -->/)[1]);
  assert.equal(j.ctaLink, 'https://example.org/n?a=1&b=2');
  assert.equal(j.ctaText, 'Más info & co');
  assert.match(out, /onclick="return true;"/);
  assert.ok(balanced(out));
});
