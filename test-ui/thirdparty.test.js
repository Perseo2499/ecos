// Editor: bloques de Spectra, Kadence y GenerateBlocks editables (edición conservadora) en claro, oscuro y vinilo.
const test = require('node:test');
const { launch, newPage, shot, checker, openApp } = require('./helpers');
const { installMock } = require('./mock-api');
const { parseBlocks } = require('../src/parseblocks');
const { composeBlocks } = require('../src/transform');
const S = require('../test/thirdparty-samples');

const content = [S.heading, S.container, S.buttons, S.kBtns, S.kHeading, S.info, S.kInfo, S.gHead, S.gCont].join('\n\n');

for (const theme of ['light', 'dark', 'vinyl']) test('bloques de terceros editables (' + theme + ')', async () => {
  const b = await launch();
  try {
    const p = await newPage(b);
    const check = checker();
    await installMock(p, { theme: 'dark' });
    await openApp(p);
    await p.click('[data-tab="posts"]'); await p.click('#load'); await p.locator('.post').first().click(); await p.click('#make'); await p.waitForTimeout(800);
    if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    if (theme !== 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    if (theme === 'vinyl') await p.evaluate(() => document.documentElement.setAttribute('data-vinyl', 'on'));
    const blocks = parseBlocks(content);
    check('ninguno queda como «De WordPress»', blocks.every((x) => x.type === 'third'));
    await p.evaluate((bl) => { const E = window.BlockEditor; E.draft.blocks = bl; E.draft.featuredImageId = null; E.draft.noAutoFeatured = true; E.render(); }, blocks);
    await p.waitForTimeout(400);
    check('hay 9 bloques de terceros dibujados', (await p.locator('#d-blocks .tp-box').count()) >= 9);
    check('etiquetas de plugin', (await p.locator('.tp-tag').allTextContents()).some((x) => x === 'Spectra') && (await p.locator('.tp-tag').allTextContents()).some((x) => x === 'Kadence'));
    await shot(p, 'tp-' + theme + '-1-editor', { fullPage: false });
    // editar el título de Spectra en línea
    const h = p.locator('.tp-box[data-tp="uagb/advanced-heading"] .uagb-heading-text').first();
    await h.click(); await p.keyboard.press('Control+A'); await p.keyboard.type('Título editado');
    // y el botón de Kadence
    const kb = p.locator('.tp-box[data-tp="kadence/singlebtn"] .tp-btn').first();
    await kb.click(); await p.keyboard.press('Control+A'); await p.keyboard.type('Botón nuevo');
    await p.waitForTimeout(200);
    // panel de estilo del título (nivel, alineación, color)
    const hb = p.locator('.blk-third:has(> .blk-body > .tp-box[data-tp="uagb/advanced-heading"])').first(); await hb.hover();
    await hb.locator('[data-sty]').first().click({ force: true });
    await p.waitForSelector('#sty-pop:not(.hidden)');
    check('panel con nivel y alineación', (await p.locator('#sty-pop').innerText()).toLowerCase().includes('nivel del título'));
    await shot(p, 'tp-' + theme + '-2-estilo');
    await p.keyboard.press('Escape');
    const draft = await p.evaluate(() => JSON.parse(JSON.stringify(window.BlockEditor.draft.blocks)));
    const out = composeBlocks(draft);
    check('el título de Spectra cambia y conserva block_id', out.includes('<h2 class="uagb-heading-text">Título editado</h2>') && out.includes('"block_id":"f1d2e3a4"'));
    check('el botón de Kadence cambia y conserva uniqueID', out.includes('"uniqueID":"139_sb-1","text":"Botón nuevo"'));
    check('el resto queda igual', out.includes(S.info) && out.includes(S.gCont) && out.includes(S.kInfo));
    await shot(p, 'tp-' + theme + '-3-editado');
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});
