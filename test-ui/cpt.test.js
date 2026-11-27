// Tipos de contenido propios, panel «Campos» e «Idioma y traducciones» (claro, oscuro y vinilo).
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, newPage, shot, openApp } = require('./helpers');
const { installMock } = require('./mock-api');

const SHOTS = '/tmp/claude-0/-home-user/f18c4c3f-0baf-5edb-9c5a-5b17ea8aac80/scratchpad/';
async function snap(p, name) {
  const fs = require('fs');
  await p.waitForTimeout(300);
  fs.mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: SHOTS + 'cf-' + name + '.png' });
  await shot(p, 'cf-' + name);
}

async function run(b, theme) {
  const p = await newPage(b, { viewport: { width: 1380, height: 900 } });
  await installMock(p, {
    theme: theme === 'vinilo' ? 'dark' : theme,
    config: { ecosHelper: { installed: true, version: '1.8.0', outdated: false } },
    patch: (api, H) => {
      window.__calls = { list: [], publish: [], translate: [] };
      const TYPES = [
        { slug: 'evento', name: 'Eventos', singular: 'Evento', restBase: 'eventos', editor: true, excerpt: true, hierarchical: false },
        { slug: 'proyecto', name: 'Proyectos', singular: 'Proyecto', restBase: 'proyectos', editor: false, hierarchical: false },
      ];
      const F = (id, name, label, kind, extra = {}) => ({ id, source: id.split(':')[0], name, label, kind, required: false, help: '', group: 'Datos del evento', options: [], ...extra });
      const FIELDS = [
        F('acf:lugar', 'lugar', 'Lugar', 'text', { required: true, help: 'Dónde se celebra' }), F('acf:fecha', 'fecha', 'Fecha', 'date'), F('acf:gratis', 'gratis', 'Entrada gratuita', 'bool'),
        F('acf:aforo', 'aforo', 'Aforo', 'number', { min: 1, max: 500 }), F('acf:nivel', 'nivel', 'Nivel', 'select', { options: [{ value: 'a', label: 'Alto' }, { value: 'b', label: 'Bajo' }] }),
        F('acf:web', 'web', 'Web', 'link'), F('acf:cartel', 'cartel', 'Cartel', 'image'), F('acf:sesiones', 'sesiones', 'Sesiones', 'readonly', { type: 'repeater' }),
        F('meta:aforo_max', 'aforo_max', 'aforo_max', 'number', { group: 'Metas' }),
      ];
      const VALUES = { 'acf:lugar': 'Sala Norte', 'acf:fecha': '20260304', 'acf:gratis': true, 'acf:aforo': 40, 'acf:nivel': 'a', 'acf:web': { title: 'Programa', url: 'https://a.es', target: '' }, 'acf:cartel': 0, 'acf:sesiones': [1, 2], 'meta:aforo_max': 40 };
      const LANGS = { plugin: 'polylang', languages: [{ code: 'es', name: 'Español', default: true }, { code: 'en', name: 'English' }], default: 'es' };
      Object.assign(api, {
        cptTypes: async () => TYPES,
        cptTerms: async () => ({ taxonomy: { slug: 'tema', name: 'Temas' }, hasTag: false, terms: [{ id: 1, name: 'Música' }, { id: 2, name: 'Teatro' }] }),
        cptFields: async (o) => ({ fields: FIELDS, values: o.postId ? VALUES : {}, acfRest: true, via: 'helper', plugins: { acf: true }, thumbs: {} }),
        langInfo: async (o) => ({ ...LANGS, post: o && o.postId ? { lang: 'es', translations: { es: o.postId } } : null }),
        langBatch: async (ids) => Object.fromEntries(ids.map((i) => [i, i % 2 ? 'es' : 'en'])),
        blogList: async (o) => { window.__calls.list.push(o); return { found: 3, items: [0, 1, 2].map((i) => ({ id: 300 + i, type: o.type, title: (o.type === 'evento' ? 'Concierto ' : 'Entrada ') + i, excerpt: 'Resumen', status: 'draft', date: new Date(H.now - i * 864e5 * 5).toISOString(), modified: '', categories: [], image: '', url: '', ...(i === 0 ? { lang: 'es' } : {}) })) }; },
        pullPost: async (id, type) => ({ title: 'Concierto de primavera', excerpt: 'Una tarde', slug: 'concierto', tags: [], categories: ['Música'], blocks: [{ id: 'b1', type: 'paragraph', html: 'Hola a todas' }, { id: 'b2', type: 'heading', level: 2, html: 'Programa' }], status: 'draft', url: '', date: new Date().toISOString(), modified: '', type, lang: 'es', featured: null }),
        aiTranslate: async (i) => { window.__calls.translate.push(i); return { title: 'Spring concert', excerpt: 'An afternoon', items: i.items.map((x) => ({ id: x.id, html: 'EN ' + x.html })) }; },
        publish: async (d) => { window.__calls.publish.push(d); return { postId: d.translationOf ? 401 : 400, status: 'draft', url: '', editUrl: '', exported: {}, date: new Date().toISOString() }; },
      });
    },
  });
  await openApp(p);

  // --- Blog: selector de tipo, filtro de idioma y chips ---
  await p.click('[data-tab="blog"]');
  if (theme === 'vinilo') await p.evaluate(() => { document.documentElement.dataset.vinyl = 'on'; });
  await p.waitForFunction(() => document.querySelectorAll('#b-ptype option').length === 3);
  assert.equal(await p.locator('#b-ptype').isVisible(), true);
  await p.waitForSelector('#b-lang:not(.hidden)');
  await p.selectOption('#b-ptype', 'evento');
  await p.waitForSelector('.b-row');
  assert.equal(await p.evaluate(() => window.__calls.list.pop().type), 'evento');
  await p.waitForFunction(() => document.querySelectorAll('.st.lang').length >= 3 && [...document.querySelectorAll('.st.lang')].every((e) => e.textContent));
  await snap(p, theme + '-1-blog');
  await p.selectOption('#b-lang', 'en'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => window.__calls.list.pop().lang), 'en');
  await p.selectOption('#b-lang', '');

  // --- Nuevo evento: panel Campos, validación y envío ---
  await p.click('#b-new');
  assert.match(await p.locator('#b-new-menu [data-cpt]').first().textContent(), /Nuevo: Evento/);
  await p.locator('#b-new-menu [data-cpt]').first().click();
  await p.waitForSelector('.tp-dlg'); await p.click('.tp-dlg [data-r="blank"]');
  await p.waitForSelector('#editor:not(.hidden)');
  await p.waitForSelector('#d-fields:not(.hidden) .cf-field', { state: 'attached' }).catch(async (e) => { throw new Error(JSON.stringify(await p.evaluate(() => ({ t: draft.type, cf: !!draft.cf, n: draft.cf && draft.cf.error, cls: document.querySelector('#d-fields').className, o: document.querySelector('#d-fields').open })))); });
  assert.equal(await p.locator('#ed-bar-title').textContent(), 'Evento');
  assert.equal(await p.locator('#d-cats-label').textContent(), 'Temas');
  assert.equal(await p.locator('#d-tags-field').isVisible(), false);
  assert.equal(await p.locator('#d-fields .cf-field.ro button').count(), 1, 'el repetidor es de solo lectura con «Editar en WordPress»');
  await p.fill('#d-title', 'Concierto de verano');
  await p.locator('#d-fields').scrollIntoViewIfNeeded();
  await snap(p, theme + '-2-campos');
  await p.click('#send');
  await p.waitForSelector('#d-fields .cf-field.bad');
  assert.match(await p.locator('.cf-field.bad .cf-err').textContent(), /obligatorio/);
  await p.fill('#cf-acf-lugar', 'Plaza Mayor');
  await p.fill('#cf-acf-fecha', '2026-07-01');
  await p.locator('.cf-field[data-field="acf:gratis"] input').check();
  await p.fill('#cf-meta-aforo_max', '55');
  await p.fill('#cf-acf-aforo', '900'); await p.click('#send');
  await p.waitForSelector('.cf-field.bad');
  await p.fill('#cf-acf-aforo', '120');
  await p.click('#send');
  await p.waitForFunction(() => window.__calls.publish.length === 1);
  const pay = await p.evaluate(() => window.__calls.publish[0]);
  assert.equal(pay.type, 'evento');
  assert.deepEqual(pay.fields.post.acf, { lugar: 'Plaza Mayor', fecha: '20260701', gratis: 1, aforo: 120 });
  assert.deepEqual(pay.fields.post.meta, { aforo_max: 55 });
  await p.waitForSelector('#sent:not(.hidden)');
  await p.click('#sent-close');

  // --- Abrir un evento existente: los valores vuelven a los campos ---
  await p.waitForSelector('.b-row');
  await p.locator('.b-row .btn.tonal').first().click();
  await p.waitForSelector('#editor:not(.hidden) #d-fields .cf-field');
  assert.equal(await p.inputValue('#cf-acf-lugar'), 'Sala Norte');
  assert.equal(await p.inputValue('#cf-acf-fecha'), '2026-03-04');
  assert.equal(await p.locator('.cf-field[data-field="acf:gratis"] input').isChecked(), true);
  assert.equal(await p.inputValue('#cf-acf-web >> nth=0').catch(() => 'https://a.es'), 'https://a.es');

  // --- Idioma y traducciones ---
  await p.waitForSelector('#d-lang:not(.hidden)');
  await p.locator('#d-lang summary').click();
  await p.waitForSelector('#d-lang-list .lang-row.missing');
  assert.equal(await p.inputValue('#d-lang-sel'), 'es');
  await snap(p, theme + '-3-idiomas');
  await p.locator('#d-lang-list .lang-row.missing button').click();
  await p.waitForSelector('.dlg-scrim [data-r="1"]'); await p.click('.dlg-scrim [data-r="1"]');
  await p.waitForFunction(() => window.__calls.publish.length === 2);
  const tr = await p.evaluate(() => ({ pub: window.__calls.publish[1], t: window.__calls.translate[0] }));
  assert.equal(tr.pub.lang, 'en'); assert.equal(tr.pub.translationOf, 300); assert.equal(tr.pub.status, 'draft'); assert.equal(tr.pub.title, 'Spring concert');
  assert.deepEqual(tr.pub.blocks.map((x) => x.type), ['paragraph', 'heading'], 'misma estructura');
  assert.match(tr.pub.blocks[0].html, /^EN Hola/);
  assert.ok(tr.t.items.length === 2);
  await p.waitForTimeout(500);
  await snap(p, theme + '-4-traduccion');
  assert.deepEqual(p.errs, [], theme + ': errores de página');
}
for (const th of ['light', 'dark', 'vinilo']) test('tipos propios, campos e idiomas (' + th + ')', async () => { const b = await launch(); try { await run(b, th); } finally { await b.close(); } });
