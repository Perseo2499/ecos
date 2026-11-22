const test = require('node:test');
const assert = require('node:assert');
const { parseBlocks } = require('../src/parseblocks');
const { composeBlocks } = require('../src/transform');
const { convertSpectra, countSpectra, snapWidths, colorOf, gradientOf } = require('../src/spectra');

const J = (o) => JSON.stringify(o);
const heading = (txt, extra = {}, tag = 'h2') => `<!-- wp:uagb/advanced-heading ${J({ block_id: 'h1', headingTag: tag, ...extra })} -->\n<div class="wp-block-uagb-advanced-heading uagb-block-h1"><${tag} class="uagb-heading-text">${txt}</${tag}></div>\n<!-- /wp:uagb/advanced-heading -->`;
const cont = (attrs, inner) => `<!-- wp:uagb/container ${J({ block_id: 'c' + Math.random().toString(36).slice(2, 6), ...attrs })} -->\n<div class="wp-block-uagb-container uagb-block-x"><div class="uagb-container-inner-blocks-wrap">\n${inner}\n</div></div>\n<!-- /wp:uagb/container -->`;
const btn = (label, link, attrs = {}) => `<!-- wp:uagb/buttons {"block_id":"b1"} -->\n<div class="wp-block-uagb-buttons uagb-buttons__outer-wrap uagb-block-b1"><div class="uagb-buttons__wrap uagb-buttons-layout-wrap ">\n<!-- wp:uagb/buttons-child ${J({ block_id: 'b2', label, link, ...attrs })} -->\n<div class="wp-block-uagb-buttons-child uagb-buttons__outer-wrap uagb-block-b2 wp-block-button"><div class="uagb-button__wrapper"><a class="uagb-buttons-repeater wp-block-button__link" href="${link || '#'}" rel="follow noopener" target="_self" role="button"><div class="uagb-button__link">${label}</div></a></div></div>\n<!-- /wp:uagb/buttons-child -->\n</div></div>\n<!-- /wp:uagb/buttons -->`;
const infobox = (title, desc, attrs = {}, extra = '') => `<!-- wp:uagb/info-box ${J({ block_id: 'i1', ...attrs })} -->\n<div class="wp-block-uagb-info-box uagb-block-i1 uagb-infobox__content-wrap"><div class="uagb-ifb-content">${extra}<div class="uagb-ifb-title-wrap"><h4 class="uagb-ifb-title">${title}</h4></div><p class="uagb-ifb-desc">${desc}</p></div></div>\n<!-- /wp:uagb/info-box -->`;
const img = (url, attrs = {}) => `<!-- wp:uagb/image ${J({ block_id: 'm1', url, id: 77, ...attrs })} -->\n<div class="wp-block-uagb-image uagb-block-m1 wp-block-uagb-image--layout-default"><figure class="wp-block-uagb-image__figure"><img srcset="${url} ," sizes="(max-width: 480px) 150px" src="${url}" alt="Una foto" class="uag-image-77" width="368" height="450" title="x" loading="lazy" role="img"/></figure></div>\n<!-- /wp:uagb/image -->`;
const types = (bs) => bs.map((b) => b.type);
const conv = (html) => convertSpectra(parseBlocks(html));
const flat = (bs, out = []) => { for (const b of bs) { out.push(b); if (b.children) flat(b.children, out); if (b.cols) b.cols.forEach((c) => flat(c.children, out)); } return out; };
const roundTrip = (r) => { const html = composeBlocks(r.blocks, {}); return { html, again: parseBlocks(html) }; };

test('container en fila con dos contenedores hijos pasa a columnas con sus anchos', () => {
  const html = cont({ directionDesktop: 'row', contentWidth: 'alignfull', isBlockRootParent: true },
    cont({ widthDesktop: 30 }, img('https://x.es/a.jpg')) + '\n\n' + cont({ widthDesktop: 70 }, heading('Hola') + '\n\n' + btn('Saber más', 'https://x.es/mas')));
  const r = conv(html);
  assert.strictEqual(r.blocks.length, 1);
  const c = r.blocks[0];
  assert.strictEqual(c.type, 'columns');
  assert.deepStrictEqual(c.cols.map((x) => x.width), ['33.33%', '66.66%']);
  assert.deepStrictEqual(types(c.cols[0].children), ['image']);
  assert.deepStrictEqual(types(c.cols[1].children), ['heading', 'buttons']);
  assert.ok(!flat(r.blocks).some((b) => b.type === 'raw'));
  assert.strictEqual(r.converted, 6);
  assert.deepStrictEqual(r.kept, []);
  const { html: out, again } = roundTrip(r);
  assert.ok(/wp:columns/.test(out) && !/uagb/.test(out));
  assert.strictEqual(again[0].type, 'columns');
  assert.ok(!flat(again).some((b) => b.type === 'raw'));
});

test('fila con tres contenedores iguales: columnas iguales', () => {
  const k = (t) => cont({}, heading(t));
  const r = conv(cont({ directionDesktop: 'row' }, k('A') + '\n\n' + k('B') + '\n\n' + k('C')));
  assert.deepStrictEqual(r.blocks[0].cols.map((x) => x.width), ['33.33%', '33.33%', '33.33%']);
  assert.deepStrictEqual(snapWidths([45, 55]), ["50%", "50%"]);
  assert.deepStrictEqual(snapWidths([25, 50, 25]), ['25%', '50%', '25%']);
});

test('container con color de fondo y esquinas pasa a sección', () => {
  const r = conv(cont({ backgroundType: 'color', backgroundColor: '#fff9e0', topPaddingDesktop: 50, containerBorderTopLeftRadius: 16, containerBorderTopRightRadius: 16, boxShadowBlur: 10, topMarginDesktop: 20 }, heading('Título') + '\n\n' + infobox('Sub', 'Texto uno<br><br>Texto dos')));
  const g = r.blocks[0];
  assert.strictEqual(g.type, 'group');
  assert.strictEqual(g.bg, '#fff9e0'); assert.strictEqual(g.pad, 'm'); assert.strictEqual(g.radius, 16); assert.strictEqual(g.shadow, true); assert.strictEqual(g.mt, 20);
  assert.deepStrictEqual(types(g.children), ['heading', 'heading', 'paragraph', 'paragraph']);
  const { html, again } = roundTrip(r);
  assert.ok(/wp:group/.test(html) && !/uagb/.test(html));
  assert.strictEqual(again[0].type, 'group'); assert.strictEqual(again[0].bg, '#fff9e0');
});

test('degradado de Spectra con rgba pasa al formato seguro', () => {
  const r = conv(cont({ backgroundType: 'gradient', gradientValue: 'linear-gradient(90deg, rgba(6, 147, 227, 0.5) 0%, rgb(155, 81, 224) 100%)' }, heading('X')));
  assert.match(r.blocks[0].gradient, /^linear-gradient\(90deg,#[0-9a-f]{6} 0%,#[0-9a-f]{6} 100%\)$/);
  assert.strictEqual(gradientOf('radial-gradient(red, blue)'), '');
  assert.strictEqual(colorOf('var(--x)'), '');
  const { again } = roundTrip(r);
  assert.strictEqual(again[0].type, 'group'); assert.ok(again[0].gradient);
});

test('container con imagen de fondo pasa a portada', () => {
  const r = conv(cont({ backgroundType: 'image', backgroundImageDesktop: { url: 'https://x.es/f.jpg', id: 5 }, overlayType: 'color', backgroundImageColor: '#000000', overlayOpacity: 0.5, minHeightDesktop: 400, contentWidth: 'alignfull', isBlockRootParent: true }, heading('Portada')));
  const c = r.blocks[0];
  assert.strictEqual(c.type, 'cover'); assert.strictEqual(c.img.url, 'https://x.es/f.jpg'); assert.strictEqual(c.dim, 50); assert.strictEqual(c.height, 400); assert.strictEqual(c.width, 'full');
  const { again } = roundTrip(r);
  assert.strictEqual(again[0].type, 'cover'); assert.ok(!flat(again).some((b) => b.type === 'raw'));
});

test('contenedores anidados sin estilo se aplanan y con estilo se anidan', () => {
  const r = conv(cont({}, cont({ backgroundType: 'color', backgroundColor: '#000000' }, cont({}, heading('Dentro')))));
  assert.strictEqual(r.blocks.length, 1);
  assert.strictEqual(r.blocks[0].type, 'group');
  assert.deepStrictEqual(types(r.blocks[0].children), ['heading']);
  assert.strictEqual(r.converted, 4);
});

test('advanced-heading: nivel, alineación, color y subtítulo', () => {
  const h = `<!-- wp:uagb/advanced-heading ${J({ headingTag: 'h3', headingAlign: 'center', headingColor: '#b3202a', headingDescToggle: true })} -->\n<div class="wp-block-uagb-advanced-heading uagb-block-h"><h3 class="uagb-heading-text">Nuestro <strong>lema</strong></h3><p class="uagb-desc-text">Una frase</p></div>\n<!-- /wp:uagb/advanced-heading -->`;
  const r = conv(h);
  assert.deepStrictEqual(types(r.blocks), ['heading', 'paragraph']);
  assert.strictEqual(r.blocks[0].level, 3); assert.strictEqual(r.blocks[0].align, 'center'); assert.strictEqual(r.blocks[0].color, '#b3202a');
  assert.strictEqual(r.blocks[0].html, 'Nuestro <strong>lema</strong>');
  assert.strictEqual(conv(heading('Uno', {}, 'h1')).blocks[0].level, 2);
});

test('info-box con imagen y botón pasa a tarjeta; sin ellos, a título y texto', () => {
  const ex = '<div class="uagb-ifb-image-content"><img src="https://x.es/i.png" alt="icono" width="60"/></div>';
  const cta = '<div class="uagb-ifb-cta"><div class="uagb-ifb-button-wrapper wp-block-button"><a href="https://x.es/p" class="uagb-infobox-cta-link wp-block-button__link"><span class="uagb-inline-editing">Ver más</span></a></div></div>';
  const html = `<!-- wp:uagb/info-box ${J({ source_type: 'image', ctaType: 'button', ctaLink: 'https://x.es/p', headingAlign: 'left' })} -->\n<div class="wp-block-uagb-info-box"><div class="uagb-ifb-content">${ex}<div class="uagb-ifb-title-wrap"><h3 class="uagb-ifb-title">Tarjeta</h3></div><p class="uagb-ifb-desc">Texto</p>${cta}</div></div>\n<!-- /wp:uagb/info-box -->`;
  const g = conv(html).blocks[0];
  assert.strictEqual(g.type, 'group'); assert.strictEqual(g.shadow, true);
  assert.deepStrictEqual(types(g.children), ['image', 'heading', 'paragraph', 'buttons']);
  assert.strictEqual(g.children[3].url, 'https://x.es/p'); assert.strictEqual(g.children[3].html, 'Ver más');
  assert.deepStrictEqual(types(conv(infobox('T', '<br>Hola')).blocks), ['heading', 'paragraph']);
});

test('buttons + buttons-child: texto, enlace, colores, radio y alineación', () => {
  const r = conv(btn('Dona', 'https://x.es/dona', { background: '#fd9800', color: '#0f172a', btnBorderTopLeftRadius: 50, btnBorderTopRightRadius: 50 }));
  const b = r.blocks[0];
  assert.strictEqual(b.type, 'buttons'); assert.strictEqual(b.html, 'Dona'); assert.strictEqual(b.url, 'https://x.es/dona');
  assert.strictEqual(b.bg, '#fd9800'); assert.strictEqual(b.color, '#0f172a'); assert.strictEqual(b.radius, 'pill'); assert.strictEqual(b.align, 'center');
  const dos = `<!-- wp:uagb/buttons {"align":"left"} -->\n<div class="wp-block-uagb-buttons"><div class="uagb-buttons__wrap">\n` +
    ['Uno', 'Dos'].map((l) => `<!-- wp:uagb/buttons-child {"label":"${l}"} -->\n<div class="wp-block-uagb-buttons-child"><div class="uagb-button__wrapper"><a class="uagb-buttons-repeater" href="#"><div class="uagb-button__link">${l}</div></a></div></div>\n<!-- /wp:uagb/buttons-child -->`).join('\n') + `\n</div></div>\n<!-- /wp:uagb/buttons -->`;
  const rr = conv(dos);
  assert.deepStrictEqual(rr.blocks.map((x) => x.html), ['Uno', 'Dos']); assert.strictEqual(rr.blocks[0].align, 'left'); assert.strictEqual(rr.blocks[0].url, '');
  assert.ok(/wp:buttons/.test(roundTrip(r).html));
});

test('image: url, alt, id, ancho y alineación', () => {
  const r = conv(img('https://x.es/a.jpg', { align: 'left', width: 368 }));
  const b = r.blocks[0];
  assert.strictEqual(b.type, 'image'); assert.strictEqual(b.img.url, 'https://x.es/a.jpg'); assert.strictEqual(b.img.alt, 'Una foto'); assert.strictEqual(b.img.id, 77);
  assert.strictEqual(b.align, 'left'); assert.strictEqual(b.width, 50);
  const { again } = roundTrip(r);
  assert.strictEqual(again[0].type, 'image'); assert.strictEqual(again[0].align, 'left');
});

test('image-gallery se mantiene como galería o carrusel', () => {
  const g = `<!-- wp:uagb/image-gallery ${J({ feedLayout: 'carousel', mediaGallery: [{ id: 1, url: 'https://x.es/1.jpg', alt: 'a' }, { id: 2, url: 'https://x.es/2.jpg' }] })} -->\n<div class="wp-block-uagb-image-gallery"></div>\n<!-- /wp:uagb/image-gallery -->`;
  const r = conv(cont({}, g + '\n\n' + heading('x')));
  assert.deepStrictEqual(types(r.blocks), ['carousel', 'heading']);
});

test('icon-list, separator, blockquote, testimonial, faq, mapa, cifra y llamada a la acción', () => {
  const il = `<!-- wp:uagb/icon-list {"block_id":"l"} -->\n<div class="wp-block-uagb-icon-list"><div class="uagb-icon-list__wrap">\n` + ['Uno', 'Dos'].map((x) => `<!-- wp:uagb/icon-list-child {"label":"${x}"} -->\n<div class="wp-block-uagb-icon-list-child"><span class="uagb-icon-list__source-wrap"><svg><path d="M0"/></svg></span><span class="uagb-icon-list__label">${x}</span></div>\n<!-- /wp:uagb/icon-list-child -->`).join('\n') + `\n</div></div>\n<!-- /wp:uagb/icon-list -->`;
  let r = conv(il);
  assert.strictEqual(r.blocks[0].type, 'list'); assert.deepStrictEqual(r.blocks[0].items, ['Uno', 'Dos']); assert.strictEqual(r.blocks[0].icons.length, 2);
  assert.ok(/ecos-iconos/.test(roundTrip(r).html));

  r = conv('<!-- wp:uagb/separator {"block_id":"s"} -->\n<div class="wp-block-uagb-separator"><div class="wp-block-uagb-separator__inner"></div></div>\n<!-- /wp:uagb/separator -->');
  assert.strictEqual(r.blocks[0].type, 'separator');

  r = conv('<!-- wp:uagb/blockquote {"block_id":"q"} -->\n<div class="wp-block-uagb-blockquote"><blockquote class="uagb-blockquote"><div class="uagb-blockquote__content">Sé el cambio</div><footer><div><cite class="uagb-blockquote__author">Gandhi</cite></div></footer></blockquote></div>\n<!-- /wp:uagb/blockquote -->');
  assert.strictEqual(r.blocks[0].type, 'quote'); assert.strictEqual(r.blocks[0].cite, 'Gandhi');

  r = conv('<!-- wp:uagb/testimonial {"block_id":"t"} -->\n<div class="wp-block-uagb-testimonial"><div class="is-carousel"><div class="uagb-testimonial__wrap"><div class="uagb-tm__content"><div class="uagb-tm__text-wrap"><div class="uagb-tm__desc">Genial</div><div class="uagb-testimonial-details"><span class="uagb-tm__author-name">Ana</span><span class="uagb-tm__company">Voluntaria</span></div></div></div></div><div class="uagb-testimonial__wrap"><div class="uagb-tm__content"><div class="uagb-tm__text-wrap"><div class="uagb-tm__desc">Bonito</div></div></div></div></div></div>\n<!-- /wp:uagb/testimonial -->');
  assert.deepStrictEqual(r.blocks.map((b) => [b.type, b.cite]), [['quote', 'Ana, Voluntaria'], ['quote', '']]);

  r = conv('<!-- wp:uagb/faq {"block_id":"f"} -->\n<div class="wp-block-uagb-faq">\n<!-- wp:uagb/faq-child {"question":"¿Quién?","answer":"Nosotras."} /-->\n\n<!-- wp:uagb/faq-child {"question":"¿Dónde?","answer":"En Ceuta."} /-->\n</div>\n<!-- /wp:uagb/faq -->');
  assert.deepStrictEqual(r.blocks.map((b) => [b.type, b.summary]), [['details', '¿Quién?'], ['details', '¿Dónde?']]);
  assert.strictEqual(r.blocks[0].html, '<p>Nosotras.</p>');

  r = conv('<!-- wp:uagb/google-map {"block_id":"g","address":"Ceuta, España","height":400} /-->');
  assert.strictEqual(r.blocks[0].type, 'map'); assert.strictEqual(r.blocks[0].address, 'Ceuta, España'); assert.strictEqual(r.blocks[0].height, 400);
  assert.ok(/ecos-mapa/.test(roundTrip(r).html));

  r = conv('<!-- wp:uagb/counter {"block_id":"n"} -->\n<div class="wp-block-uagb-counter"><div class="wp-block-uagb-counter__number"><span class="uagb-counter-block-number" data-duration="2" data-to-value="250" data-from-value="0" data-delimiter=""></span><span class="uagb-counter-block-suffix">+</span></div><div class="wp-block-uagb-counter__title">Personas</div></div>\n<!-- /wp:uagb/counter -->');
  assert.strictEqual(r.blocks[0].type, 'group'); assert.strictEqual(r.blocks[0].children[0].html, '250+'); assert.strictEqual(r.blocks[0].children[1].html, 'Personas');

  r = conv('<!-- wp:uagb/call-to-action {"block_id":"c"} -->\n<div class="wp-block-uagb-call-to-action wp-block-button"><div class="uagb-cta__wrap"><h3 class="uagb-cta__title">Colabora</h3><p class="uagb-cta__desc">Ayúdanos</p></div><div class="uagb-cta__buttons"><a href="https://x.es/d" class="uagb-cta__button-link-wrapper wp-block-button__link">Dona</a><a href="https://x.es/s" class="uagb-cta-second__button wp-block-button__link">Socia</a></div></div>\n<!-- /wp:uagb/call-to-action -->');
  assert.deepStrictEqual(types(r.blocks[0].children), ['heading', 'paragraph', 'buttons', 'buttons']);
});

test('bloques dinámicos se quedan como raw intactos', () => {
  const pc = '<!-- wp:uagb/post-carousel {"block_id":"p","postsToShow":6} /-->';
  const r = conv(cont({ backgroundType: 'color', backgroundColor: '#ffffff' }, heading('Noticias') + '\n\n' + pc));
  const g = r.blocks[0];
  assert.deepStrictEqual(types(g.children), ['heading', 'raw']);
  assert.strictEqual(g.children[1].markup, pc);
  assert.deepStrictEqual(r.kept, ['uagb/post-carousel']);
  assert.strictEqual(r.keptCounts['uagb/post-carousel'], 1);
  const only = parseBlocks(pc);
  const r2 = convertSpectra(only);
  assert.strictEqual(r2.converted, 0); assert.strictEqual(r2.blocks[0], only[0]);
  assert.ok(roundTrip(r).html.includes(pc));
});

test('bloque desconocido con HTML guardado: rescata textos; sin contenido queda raw', () => {
  const r = conv('<!-- wp:uagb/price-list {"a":1} /-->\n\n<!-- wp:uagb/marcador-nuevo {"block_id":"z"} -->\n<div class="wp-block-uagb-marcador-nuevo"><h3>Título nuevo</h3><p>Algo de texto</p></div>\n<!-- /wp:uagb/marcador-nuevo -->\n\n<!-- wp:uagb/vacio {"block_id":"v"} -->\n<div class="wp-block-uagb-vacio"></div>\n<!-- /wp:uagb/vacio -->');
  assert.deepStrictEqual(types(r.blocks), ['raw', 'heading', 'paragraph', 'raw']);
  assert.deepStrictEqual(r.kept.sort(), ['uagb/price-list', 'uagb/vacio']);
});

test('los bloques de Spectra dentro de columnas de Gutenberg también se convierten', () => {
  const html = `<!-- wp:columns -->\n<div class="wp-block-columns"><!-- wp:column -->\n<div class="wp-block-column">${heading('Dentro')}</div>\n<!-- /wp:column --></div>\n<!-- /wp:columns -->`;
  const p = parseBlocks(html);
  assert.strictEqual(countSpectra(p), 1);
  const r = convertSpectra(p);
  assert.strictEqual(r.blocks[0].cols[0].children[0].type, 'heading');
  assert.strictEqual(countSpectra(r.blocks), 0);
});

test('página completa: sin raw tras convertir y ida y vuelta estable', () => {
  const page = [
    cont({ contentWidth: 'alignfull', isBlockRootParent: true }, infobox('¿Qué hacemos?', 'Elín es una casa.')),
    cont({ directionDesktop: 'row', backgroundType: 'color', backgroundColor: '#fff9e0', topPaddingDesktop: 80, contentWidth: 'alignfull', isBlockRootParent: true },
      cont({ widthDesktop: 50 }, img('https://x.es/a.jpg')) + '\n\n' + cont({ widthDesktop: 50 }, infobox('Acogida', 'Texto<br><br>Más texto') + '\n\n' + btn('Saber más', 'https://x.es/a'))),
  ].join('\n\n');
  const r = conv(page);
  assert.ok(!flat(r.blocks).some((b) => b.type === 'raw'));
  const { html, again } = roundTrip(r);
  assert.ok(!/uagb/.test(html) && /wp:columns/.test(html) && /wp:group/.test(html));
  assert.ok(!flat(again).some((b) => b.type === 'raw'));
  assert.deepStrictEqual(types(again), types(r.blocks));
  assert.ok(countSpectra(parseBlocks(page)) >= 9);
});
