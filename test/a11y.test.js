// Pruebas de la revisión de accesibilidad (renderer/a11y.js): contraste, títulos, textos alternativos, enlaces, tamaños, puntuación y arreglos.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../renderer/a11y');

const codes = (blocks, opts) => A.analyze(blocks, opts).issues.map((i) => i.code);
const P = (o) => ({ id: 'p' + Math.random().toString(36).slice(2, 7), type: 'paragraph', html: 'Texto normal', ...o });
const H = (level, html = 'Título') => ({ id: 'h' + level + Math.random().toString(36).slice(2, 6), type: 'heading', level, html });

test('contraste: luminancia y ratios conocidos (WCAG 2.1)', () => {
  assert.equal(A.luminance(A.parseColor('#ffffff')), 1);
  assert.equal(A.luminance(A.parseColor('#000')), 0);
  assert.equal(Math.round(A.ratio('#000000', '#ffffff')), 21);
  assert.equal(A.ratio('#fff', '#fff'), 1);
  assert.ok(Math.abs(A.ratio('#777777', '#ffffff') - 4.48) < 0.02); // #777 sobre blanco no llega a 4,5
  assert.ok(A.ratio('#767676', '#ffffff') >= 4.5); // el gris más claro que sí cumple
  assert.ok(Math.abs(A.ratio('#ff0000', '#ffffff') - 4) < 0.02);
  assert.deepEqual(A.parseColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 });
  assert.equal(A.parseColor('#12345680').a.toFixed(2), '0.50');
  assert.equal(A.parseColor('nada'), null);
});

test('contraste: texto normal 4,5:1 y grande 3:1', () => {
  assert.ok(codes([P({ color: '#999999' })]).includes('contraste'));
  assert.ok(!codes([P({ color: '#595959' })]).includes('contraste'));
  // #888 sobre blanco = 3,54: mal en texto normal, bien en un título (grande)
  assert.ok(codes([P({ color: '#888888' })]).includes('contraste'));
  assert.ok(!codes([H(2), { ...H(2), color: '#888888' }]).includes('contraste'));
  // texto grande de 24 px en un párrafo también vale 3:1
  assert.ok(!codes([P({ color: '#888888', size: '24px' })]).includes('contraste'));
});

test('contraste: fondos de sección heredados, colores del tema y texto sobre foto', () => {
  const sec = { id: 's1', type: 'group', bg: '#1a237e', children: [P({ color: '#222222' })] };
  assert.ok(codes([sec]).includes('contraste'));
  // el texto por defecto (oscuro) sobre fondo oscuro también falla
  assert.ok(codes([{ id: 's2', type: 'group', bg: '#101010', children: [P()] }]).includes('contraste'));
  // color del tema (b.th) cuando no hay valor propio
  const th = P({ th: { color: { slug: 'gris', v: '#cccccc' } } });
  assert.ok(codes([th]).includes('contraste'));
  assert.ok(codes([P({ th: { color: { slug: 'x' } } })], { theme: { x: '#dddddd' } }).includes('contraste'));
  // portada con foto y velo: blanco por defecto; con poco velo el aviso es de foto
  const cover = (dim) => ({ id: 'c' + dim, type: 'cover', img: { url: 'https://x/a.jpg', alt: '' }, overlay: '#000000', dim, children: [P({ id: 'cp' + dim })] });
  assert.ok(!codes([cover(60)]).includes('contraste'));
  assert.ok(codes([cover(0)]).includes('contraste')); // sin velo, el texto blanco por defecto sobre una foto media (gris) no llega
  const low = A.analyze([{ ...cover(0), children: [P({ id: 'cpx', color: '#ffffff' })] }]).issues.find((i) => i.code === 'contraste');
  assert.ok(low, 'blanco sobre foto media sin velo da aviso');
  assert.equal(low.level === 'aviso' || low.level === 'error', true);
  // degradado: se evalúa contra todos sus colores
  const grad = { id: 'g', type: 'group', gradient: 'linear-gradient(135deg,#ffffff 0%,#222222 100%)', children: [P({ color: '#777777' })] };
  assert.ok(codes([grad]).includes('contraste'));
});

test('botones: contraste y texto poco descriptivo', () => {
  const b = { id: 'b1', type: 'buttons', html: 'Pincha aquí', bg: '#ffeb3b', color: '#ffffff' };
  const c = codes([b]);
  assert.ok(c.includes('contraste') && c.includes('boton-generico'));
  assert.deepEqual(codes([{ id: 'b2', type: 'buttons', html: 'Apuntarme al taller', bg: '#1b5e20', color: '#ffffff' }]), []);
});

test('orden de títulos: saltos, H1 en el cuerpo y primer título', () => {
  assert.deepEqual(codes([H(2), H(3), H(2), H(3), H(4)]), []);
  const r = A.analyze([H(2), H(4)]);
  assert.deepEqual(r.issues.map((i) => i.code), ['titulo-salto']);
  assert.equal(r.issues[0].fix.to, 3);
  assert.ok(codes([H(3)]).includes('titulo-salto')); // empieza en H3: falta el H2
  const h1 = A.analyze([H(1), H(2)]).issues.find((i) => i.code === 'titulo-h1');
  assert.ok(h1 && h1.fix.to === 2);
  assert.deepEqual(codes([H(2, ''), H(3, 'x')]).filter((c) => c === 'titulo-salto'), ['titulo-salto']); // un título vacío no cuenta
  // títulos dentro de secciones también cuentan
  assert.ok(codes([H(2), { id: 'sec', type: 'group', children: [H(5)] }]).includes('titulo-salto'));
});

test('texto alternativo: falta, nombre de archivo, genérico y largo', () => {
  const img = (alt) => ({ id: 'i' + alt.length, type: 'image', img: { url: 'https://x/a.jpg', alt } });
  assert.deepEqual(codes([img('')]), ['alt-falta']);
  assert.deepEqual(codes([img('IMG_20240101.jpg')]), ['alt-malo']);
  assert.deepEqual(codes([img('imagen')]), ['alt-malo']);
  assert.deepEqual(codes([img('DSC00123')]), ['alt-malo']);
  assert.deepEqual(codes([img('Voluntarios limpiando la playa de Tarifa')]), []);
  assert.deepEqual(codes([img('x'.repeat(160))]), ['alt-largo']);
  // galería y imagen+texto
  const g = { id: 'g1', type: 'gallery', images: [{ url: 'a', alt: 'Vista del puerto' }, { url: 'b', alt: '' }] };
  const gi = A.analyze([g]).issues;
  assert.equal(gi.length, 1); assert.equal(gi[0].fix.idx, 1);
  assert.ok(codes([{ id: 'm', type: 'mediatext', html: 'Hola', img: { url: 'a' } }]).includes('alt-falta'));
  // los vídeos no piden alt
  assert.deepEqual(codes([{ id: 'v', type: 'gallery', images: [{ url: 'a', type: 'video' }] }]), []);
});

test('enlaces: sin texto, genéricos y ventana nueva', () => {
  const c = (html) => codes([P({ html })]);
  assert.deepEqual(c('Mira <a href="https://x">programa de las jornadas</a>'), []);
  assert.deepEqual(c('<a href="https://x"></a>'), ['enlace-vacio']);
  for (const w of ['aquí', 'Pincha aquí', 'más info', 'Leer más', 'click here']) assert.deepEqual(c(`<a href="https://x">${w}</a>`), ['enlace-generico'], w);
  assert.deepEqual(c('<a href="https://x" target="_blank" rel="noopener">Programa</a>'), ['enlace-ventana']);
  assert.deepEqual(c('<a href="https://x" target="_blank">Programa (ventana nueva)</a>'), []);
  assert.deepEqual(c('<a href="https://x"><img src="a" alt="Logo de Ecos"></a>'), []);
  // en listas
  assert.deepEqual(codes([{ id: 'l', type: 'list', items: ['<a href="x">aquí</a>'] }]), ['enlace-generico']);
});

test('tamaño en móvil: usa el ajuste por dispositivo (fsm)', () => {
  assert.deepEqual(codes([P({ size: '12px' })]), ['texto-pequeno']);
  assert.deepEqual(codes([P({ size: '12px', fsm: 16 })]), []);
  assert.deepEqual(codes([P({ fsm: 12 })]), ['texto-pequeno']);
  assert.deepEqual(codes([P({ size: '14px' })]), []);
  assert.deepEqual(codes([P({ th: { size: { slug: 's', v: '0.75rem' } } })]), ['texto-pequeno']);
  assert.equal(A.toPx('1.25rem'), 20);
});

test('texto largo, listas a mano, mayúsculas, vídeo, animación', () => {
  const long = (n) => P({ html: Array(n).fill('palabra').join(' ') });
  assert.deepEqual(codes([long(200), long(150)]), []);
  assert.deepEqual(codes([long(250), long(200)]), ['texto-largo']);
  assert.deepEqual(codes([long(250), H(2), long(200)]), []);
  assert.deepEqual(codes([P({ html: '- uno<br>- dos<br>- tres' })]), ['lista-manual']);
  assert.deepEqual(codes([P({ html: '– uno' })]), []);
  assert.ok(codes([P({ html: '1. uno<br>2. dos' })]).includes('lista-manual'));
  const caps = 'ESTE ES UN TEXTO MUY LARGO ESCRITO ENTERO EN MAYUSCULAS PARA COMPROBAR QUE SE AVISA DE ELLO';
  assert.deepEqual(codes([P({ html: caps })]), ['mayusculas']);
  assert.deepEqual(codes([P({ html: 'SOCIOS' })]), []);
  assert.deepEqual(codes([P({ html: 'Texto normal bastante largo '.repeat(5), tt: 'uppercase' })]), ['mayusculas']);
  const v = A.analyze([{ id: 'v1', type: 'video', video: { url: 'https://x/v.mp4' } }]);
  assert.deepEqual(v.issues.map((i) => i.code), ['video-sin-subtitulos']); assert.equal(v.issues[0].level, 'sugerencia');
  const an = A.analyze([P({ an: 'fade' })]);
  assert.equal(an.issues[0].code, 'animaciones'); assert.equal(an.score, 100); // informativo: no resta
});

test('puntuación: 100 sin problemas, resta por nivel y texto de resumen', () => {
  assert.equal(A.analyze([]).score, 100);
  assert.equal(A.analyze([]).summary, 'Accesibilidad: 100/100');
  const two = A.analyze([H(2), H(4), P({ html: '<a href="x">aquí</a>' })]);
  assert.equal(two.counts.aviso, 2);
  assert.equal(two.score, 92);
  assert.equal(two.summary, 'Accesibilidad: 92/100 · 2 avisos');
  const bad = A.analyze([{ id: 'i', type: 'image', img: { url: 'a' } }]);
  assert.equal(bad.score, 90); assert.equal(bad.summary, 'Accesibilidad: 90/100 · 1 error');
  const many = A.analyze(Array.from({ length: 20 }, (_, k) => ({ id: 'i' + k, type: 'image', img: { url: 'a' } })));
  assert.equal(many.score, 0);
});

test('arreglos: el color propuesto cumple el ratio y conserva el tono', () => {
  for (const [fg, bg, min] of [['#999999', '#ffffff', 4.5], ['#ff9800', '#ffffff', 4.5], ['#7777ff', '#ffffff', 4.5], ['#444444', '#1a237e', 4.5], ['#888888', '#ffffff', 3], ['#2e7d32', '#1b5e20', 4.5]]) {
    const s = A.suggestColor(fg, [bg], min);
    assert.match(s, /^#[0-9a-f]{6}$/);
    assert.ok(A.ratio(s, bg) >= min, `${fg} sobre ${bg} → ${s} (${A.ratio(s, bg)})`);
  }
  // tono parecido: un naranja sigue siendo cálido (rojo > azul)
  const o = A.parseColor(A.suggestColor('#ff9800', ['#ffffff'], 4.5));
  assert.ok(o.r > o.b);
  // varios fondos (degradado): cumple con todos
  const s = A.suggestColor('#777777', ['#ffffff', '#555555'], 4.5);
  assert.ok(A.ratio(s, '#ffffff') >= 4.5 && A.ratio(s, '#555555') >= 4.5 || /^#(000000|ffffff)$/.test(s));
  // aplicar: el bloque queda sin el aviso
  const b = P({ color: '#999999', th: { color: { slug: 'g', v: '#999999' } } });
  const iss = A.analyze([b]).issues.find((i) => i.code === 'contraste');
  assert.ok(A.applyFix(b, iss.fix));
  assert.equal(b.th, undefined);
  assert.ok(!codes([b]).includes('contraste'));
});

test('arreglos: título, lista, tamaño en móvil, mayúsculas, ventana nueva, alt y color en línea', () => {
  const h = H(4); assert.ok(A.applyFix(h, { kind: 'level', to: 3 })); assert.equal(h.level, 3);
  const p = P({ html: '- uno<br>- <b>dos</b><br>– tres' });
  assert.ok(A.applyFix(p, A.analyze([p]).issues[0].fix));
  assert.equal(p.type, 'list'); assert.deepEqual(p.items, ['uno', '<b>dos</b>', 'tres']); assert.equal(p.html, undefined); assert.equal(p.ordered, false);
  const n = P({ html: '1. uno<br>2) dos' }); A.applyFix(n, A.analyze([n]).issues[0].fix); assert.equal(n.ordered, true); assert.deepEqual(n.items, ['uno', 'dos']);
  const s = P({ size: '12px' }); A.applyFix(s, A.analyze([s]).issues[0].fix); assert.equal(s.fsm, 16); assert.deepEqual(codes([s]), []);
  const u = P({ html: 'Un texto largo en mayúsculas para ver cómo se arregla. Otra frase.'.repeat(2), tt: 'uppercase' });
  A.applyFix(u, A.analyze([u]).issues[0].fix); assert.equal(u.tt, undefined);
  const c = P({ html: 'HOLA <b>QUE</b> TAL. ADIÓS' }); A.applyFix(c, { kind: 'sentencecase' }); assert.equal(c.html, 'Hola <b>que</b> tal. Adiós');
  const w = P({ html: 'Ver <a href="x" target="_blank">el programa</a>' }); A.applyFix(w, { kind: 'newwin' });
  assert.deepEqual(codes([w]), []); assert.match(w.html, /el programa \(ventana nueva\)<\/a>/);
  const im = { id: 'im', type: 'image', img: { url: 'a', alt: '' } };
  assert.equal(A.applyFix(im, { kind: 'alt', idx: -1, text: '' }), false);
  assert.ok(A.applyFix(im, { kind: 'alt', idx: -1, text: 'Un perro en la playa' })); assert.deepEqual(codes([im]), []);
  const il = P({ html: 'Hola <span style="color:#cccccc">suave</span>' });
  const f = A.analyze([il]).issues.find((i) => i.code === 'contraste').fix;
  assert.equal(f.kind, 'inlinecolor'); A.applyFix(il, f); assert.deepEqual(codes([il]), []);
});

test('un borrador sin problemas obtiene 100 y los bloques raros no rompen el análisis', () => {
  const doc = [H(2), P({ html: 'Un texto con un <a href="https://x">programa de actividades</a>.' }), { id: 'c', type: 'columns', cols: [{ width: '50%', children: [P()] }, { children: [{ id: 'q', type: 'quote', html: 'Cita', cite: 'Alguien' }] }] }, { id: 'sp', type: 'spacer' }, { id: 'u', type: 'raw', markup: '<!-- x -->' }, null && {}].filter(Boolean);
  assert.equal(A.analyze(doc).score, 100);
  assert.equal(A.analyze(undefined).score, 100);
});
