// Editor de WordPress dentro de Ecos: lógica pura (destinos, borrador temporal, huérfanos, sustitución del bloque, guion de guardado).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const WE = require('../src/wpeditor');
const L = require('../renderer/wpeditor');
const { parseBlocks } = require('../src/parseblocks');
const T = require('../src/transform');

const SITE = 'https://web.example';
// wpself simulado: guarda las entradas en memoria y anota las llamadas
function fakeW({ helper = true, failSession = false, posts = [] } = {}) {
  const db = new Map(posts.map((p) => [p.id, { ...p }]));
  let next = 100;
  const calls = [];
  const W = {
    calls, db,
    publicBase: () => SITE,
    request: async (cfg, route, { method = 'GET', json } = {}) => {
      calls.push({ method, route, json });
      let m;
      if (route === '/ecos/v1/editor-session') {
        if (!helper || failSession) throw new Error('WordPress: No route was found');
        return { url: `${SITE}/wp-admin/admin-post.php?action=ecos_editor&t=${'a1'.repeat(32)}`, expires: 60 };
      }
      if (method === 'POST' && route.startsWith('/wp/v2/posts')) { const id = next++; const p = { id, slug: json.slug, title: { raw: json.title }, status: json.status, content: { raw: json.content }, modified_gmt: '2026-11-27T10:00:00' }; db.set(id, p); return p; }
      if ((m = /^\/wp\/v2\/posts\/(\d+)\?context=edit/.exec(route))) { const p = db.get(Number(m[1])); if (!p) throw new Error('WordPress: ID de entrada no válido.'); return p; }
      if (method === 'DELETE' && (m = /^\/wp\/v2\/posts\/(\d+)\?force=true/.exec(route))) { if (!db.delete(Number(m[1]))) throw new Error('WordPress: ID de entrada no válido.'); return { deleted: true }; }
      if (route.startsWith('/wp/v2/posts?status=draft')) return [...db.values()].filter((p) => p.status === 'draft');
      throw new Error('ruta inesperada ' + route);
    },
  };
  return W;
}

test('destino: solo post.php de una entrada o post-new.php de wp-admin de la web', () => {
  assert.equal(WE.targetFor(12), 'post.php?post=12&action=edit');
  assert.equal(WE.adminUrl(SITE, 'post.php?post=12&action=edit'), 'https://web.example/wp-admin/post.php?post=12&action=edit');
  assert.equal(WE.adminUrl(SITE, 'post-new.php'), 'https://web.example/wp-admin/post-new.php');
  for (const bad of ['plugins.php', 'post.php?post=1&action=delete', '../wp-login.php', 'https://evil.example/', 'post.php?post=1&x=2']) assert.throws(() => WE.adminUrl(SITE, bad), /Destino/);
});

test('ámbito de navegación: solo el dominio de la web (con o sin www) y solo http(s)', () => {
  assert.equal(WE.inScope('https://web.example/wp-admin/post.php?post=1', SITE), true);
  assert.equal(WE.inScope('https://www.web.example/wp-login.php', SITE), true);
  assert.equal(WE.inScope('https://web.example.evil.com/', SITE), false);
  assert.equal(WE.inScope('https://evil.example/', SITE), false);
  assert.equal(WE.inScope('file:///etc/passwd', SITE), false);
  assert.equal(WE.inScope('javascript:alert(1)', SITE), false);
  assert.equal(WE.inScope('nonsense', SITE), false);
});

test('dirección de un solo uso: solo admin-post.php?action=ecos_editor&t=<64 hex> de la propia web', () => {
  const ok = `${SITE}/wp-admin/admin-post.php?action=ecos_editor&t=${'ab'.repeat(32)}`;
  assert.equal(WE.validOneTime(ok, SITE), true);
  for (const bad of [ok.replace('web.example', 'evil.example'), ok.replace('admin-post.php', 'plugins.php'), ok.replace('ecos_editor', 'otro'), ok.slice(0, -2), `${SITE}/wp-admin/admin-post.php?action=ecos_editor`, 'x', ok.replace('https', 'http')]) assert.equal(WE.validOneTime(bad, SITE), false, bad);
});

test('sesión: con el complemento ≥ 1.6 usa la dirección de un solo uso; sin él, wp-admin normal', async () => {
  assert.equal(WE.helperHasEditor('1.6.0'), true); assert.equal(WE.helperHasEditor('1.5.0'), false); assert.equal(WE.helperHasEditor(''), false); assert.equal(WE.helperHasEditor('2.0'), true);
  const W = fakeW();
  const s = await WE.sessionUrl(W, {}, 'post.php?post=7&action=edit', '1.6.0');
  assert.equal(s.oneTime, true); assert.match(s.url, /admin-post\.php\?action=ecos_editor&t=/);
  assert.deepEqual(W.calls[0].json, { target: 'post.php?post=7&action=edit' });
  const old = fakeW();
  const o = await WE.sessionUrl(old, {}, 'post.php?post=7&action=edit', '1.5.0');
  assert.deepEqual(o, { url: 'https://web.example/wp-admin/post.php?post=7&action=edit', oneTime: false }); assert.equal(old.calls.length, 0);
  const broken = await WE.sessionUrl(fakeW({ failSession: true }), {}, 'post.php?post=7&action=edit', '1.6.0');
  assert.equal(broken.oneTime, false); assert.match(broken.url, /wp-admin\/post\.php\?post=7/);
  // una respuesta con una dirección de otro sitio no se abre
  const evil = { ...fakeW(), publicBase: () => SITE, request: async () => ({ url: 'https://evil.example/wp-admin/admin-post.php?action=ecos_editor&t=' + 'a'.repeat(64) }) };
  assert.equal((await WE.sessionUrl(evil, {}, 'post.php?post=7&action=edit', '1.6.0')).oneTime, false);
});

test('borrador temporal: se crea marcado (título, slug y borrador), se lee el contenido en bruto y se borra con force', async () => {
  const W = fakeW();
  const markup = '<!-- wp:uagb/info-box {"block_id":"abc"} --><div class="uagb-ib">Hola</div><!-- /wp:uagb/info-box -->';
  const t = await WE.createTemp(W, {}, markup);
  const post = W.calls[0];
  assert.equal(post.method, 'POST'); assert.equal(post.json.status, 'draft'); assert.equal(post.json.title, 'Ecos · edición temporal'); assert.match(post.json.slug, /^ecos-temp-[0-9a-f]{10}$/); assert.equal(post.json.content, markup);
  assert.equal(t.slug, post.json.slug);
  assert.equal((await WE.readContent(W, {}, t.id)).content, markup);
  W.db.get(t.id).content = { raw: '<!-- wp:paragraph --><p>Nuevo</p><!-- /wp:paragraph -->' };
  assert.match((await WE.readContent(W, {}, t.id)).content, /Nuevo/);
  assert.equal(await WE.deleteTemp(W, {}, t.id), true);
  assert.match(W.calls.at(-1).route, /\/wp\/v2\/posts\/\d+\?force=true/); assert.equal(W.calls.at(-1).method, 'DELETE');
  assert.equal(W.db.has(t.id), false);
  assert.equal(await WE.deleteTemp(W, {}, t.id), true); // ya no existe: vale
  const failing = { request: async () => { throw new Error('WordPress: sin permiso'); } };
  assert.equal(await WE.deleteTemp(failing, {}, 5), false); // nunca lanza
});

test('huérfanos: borra solo los temporales con más de 10 minutos y nada más', async () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const W = fakeW({ posts: [
    { id: 1, slug: 'ecos-temp-aaaaaaaaaa', status: 'draft', title: { raw: 'Ecos · edición temporal' }, modified_gmt: '2026-11-27T09:00:00' }, // viejo: se borra
    { id: 2, slug: 'ecos-temp-bbbbbbbbbb', status: 'draft', title: { raw: 'Ecos · edición temporal' }, modified_gmt: '2026-11-27T11:55:00' }, // de hace 5 min: otra ventana puede estar usándolo
    { id: 3, slug: 'mi-borrador', status: 'draft', title: { raw: 'Ecos · edición temporal' }, modified_gmt: '2026-11-01T09:00:00' }, // mismo título pero no es nuestro
    { id: 4, slug: 'otra-entrada', status: 'draft', title: { raw: 'Ecos y la ciudad' }, modified_gmt: '2026-01-01T09:00:00' },
    { id: 5, slug: 'ecos-temp-cccccccccc', status: 'draft', title: { raw: 'cambiado a mano' }, modified_gmt: '2026-11-26T09:00:00Z' }, // marca por slug
  ] });
  assert.equal(await WE.cleanupOrphans(W, {}, { now }), 2);
  assert.deepEqual([...W.db.keys()].sort(), [2, 3, 4]);
  assert.equal(await WE.cleanupOrphans(W, {}, { now: now + 20 * 60e3 }), 1); // más tarde, también el de 5 min
  assert.deepEqual([...W.db.keys()].sort(), [3, 4]);
  // sin conexión: no falla
  assert.equal(await WE.cleanupOrphans({ request: async () => { throw new Error('sin red'); } }, {}), 0);
});

test('disponibilidad: solo «Mi web (wp-admin)» conectada; el complemento 1.6 es opcional', () => {
  assert.deepEqual(L.availability({ wpMode: 'selfhosted', wpConnected: true }), { ok: true, reason: '' });
  assert.deepEqual(L.availability({ wpMode: 'selfhosted', wpConnected: false }), { ok: false, reason: 'conn' });
  assert.deepEqual(L.availability({ wpMode: 'wpcom', wpConnected: true }), { ok: false, reason: 'mode' });
  assert.deepEqual(L.availability({}), { ok: false, reason: 'mode' });
  assert.equal(L.helperHasEditor({ ecosHelper: { installed: true, version: '1.6.0' } }), true);
  assert.equal(L.helperHasEditor({ ecosHelper: { installed: true, version: '1.5.0' } }), false);
  assert.equal(L.helperHasEditor({}), false);
});

test('sustituir el bloque «De WordPress» por lo que devuelve el editor (también dentro de secciones y columnas)', () => {
  const spectra = '<!-- wp:uagb/info-box {"block_id":"x1"} -->\n<div class="wp-block-uagb-info-box uagb-block-x1"><p>Vieja</p></div>\n<!-- /wp:uagb/info-box -->';
  const blocks = parseBlocks(`<!-- wp:paragraph -->\n<p>Antes</p>\n<!-- /wp:paragraph -->\n\n${spectra}\n\n<!-- wp:paragraph -->\n<p>Después</p>\n<!-- /wp:paragraph -->`);
  const raw = blocks.find((b) => b.type === 'raw');
  assert.ok(raw); assert.equal(raw.label, 'uagb/info-box'); assert.equal(L.rawMarkup(raw), raw.markup); assert.equal(L.rawMarkup(blocks[0]), '');
  // el editor devuelve un párrafo normal: pasa a ser editable por Ecos
  const back = parseBlocks('<!-- wp:paragraph -->\n<p>Nueva</p>\n<!-- /wp:paragraph -->');
  assert.equal(back[0].type, 'paragraph');
  let id = 0; const fresh = L.freshIds(back, () => 'n' + ++id);
  assert.ok(L.replaceBlockIn(blocks, raw.id, fresh));
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'paragraph', 'paragraph']);
  assert.match(blocks[1].html, /Nueva/); assert.equal(blocks[1].id, 'n1');
  // si sigue siendo de otro plugin, queda raw con el html nuevo y se reenvía tal cual
  const still = parseBlocks(spectra.replace('Vieja', 'Cambiada'));
  const b2 = [{ id: 'g', type: 'group', children: [{ id: 'r', type: 'raw', markup: spectra, label: 'x' }] }, { id: 'c', type: 'columns', cols: [{ children: [{ id: 'r2', type: 'raw', markup: spectra, label: 'x' }] }] }];
  assert.ok(L.replaceBlockIn(b2, 'r', still)); assert.ok(L.replaceBlockIn(b2, 'r2', L.freshIds(still, () => 'z')));
  assert.equal(b2[0].children[0].type, 'raw'); assert.match(b2[0].children[0].markup, /Cambiada/);
  assert.match(T.composeBlocks([b2[0].children[0]]), /Cambiada/);
  assert.equal(L.replaceBlockIn(b2, 'no-existe', still), false);
  // quitar el bloque (editor vacío)
  assert.ok(L.replaceBlockIn(b2, 'z', [])); assert.equal(b2[1].cols[0].children.length, 0);
});

test('guion de guardado: espera al editor, llama a savePost y espera a que termine (wp.data simulado)', async () => {
  const log = [];
  let saving = false, failed = false;
  const store = {
    isSavingPost: () => saving, isAutosavingPost: () => false, didPostSaveRequestFail: () => failed,
  };
  const wp = { data: { select: (n) => (n === 'core/editor' ? store : null), dispatch: (n) => ({ savePost: async () => { log.push('save'); saving = true; setTimeout(() => { saving = false; log.push('saved'); }, 250); } }) } };
  const ctx = vm.createContext({ window: { wp }, setTimeout, Date });
  const r = JSON.parse(JSON.stringify(await vm.runInContext(WE.SAVE_SCRIPT, ctx)));
  assert.deepEqual(r, { ok: true }); assert.deepEqual(log, ['save', 'saved']);
  // fallo al guardar
  failed = true;
  assert.deepEqual(JSON.parse(JSON.stringify(await vm.runInContext(WE.SAVE_SCRIPT, ctx))), { ok: false, error: 'save-failed' });
});
