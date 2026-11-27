// Revisión entre varias personas: capacidades → acciones, transiciones de estado, hilos de notas, anclas de bloque
// (con ida y vuelta por la salida a WordPress), detección de cambios ajenos, actividad y avisos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const E = require('../renderer/editorial');
const W = require('../src/wpself');
const T = require('../src/transform');
const { parseBlocks } = require('../src/parseblocks');

const contributor = W.parseMe({ id: 4, name: 'Luis', roles: ['contributor'], capabilities: { edit_posts: true } });
const author = W.parseMe({ id: 5, name: 'Ana', roles: ['author'], capabilities: { edit_posts: true, publish_posts: true, upload_files: true } });
const editor = W.parseMe({ id: 6, name: 'Marta', roles: ['editor'], capabilities: { edit_posts: true, publish_posts: true, edit_others_posts: true, upload_files: true } });

test('capacidades de /users/me → qué puede hacer cada rol', () => {
  assert.equal(contributor.canPublish, false); assert.equal(contributor.canEditOthers, false);
  assert.equal(editor.canEditOthers, true);
  assert.equal(E.primaryAction(contributor), 'submit'); assert.equal(E.primaryAction(editor), 'publish'); assert.equal(E.primaryAction(null), 'publish');
  assert.equal(E.canReview(editor), true); assert.equal(E.canReview(author), false, 'una autora publica lo suyo pero no revisa lo de otras personas');
  assert.equal(E.canReview(contributor), false); assert.equal(E.canReview(null), true);
  // colaborador: enviar a revisión, nunca publicar ni programar
  assert.deepEqual(E.actions(contributor, 'draft').sort(), ['save', 'submit']);
  assert.deepEqual(E.actions(contributor, 'pending').sort(), ['save', 'withdraw']);
  assert.ok(!E.actions(contributor, 'pending').includes('publish'));
  // editor: revisa lo pendiente
  const ed = E.actions(editor, 'pending');
  for (const a of ['approve', 'approveSchedule', 'return', 'publish']) assert.ok(ed.includes(a), a);
  assert.ok(!E.actions(editor, 'draft').includes('approve'), 'aprobar solo existe en lo pendiente');
  assert.ok(E.actions(author, 'pending').includes('publish') && !E.actions(author, 'pending').includes('approve'));
  assert.equal(E.sendStatus('publish', contributor), 'pending'); assert.equal(E.sendStatus('future', contributor), 'pending');
  assert.equal(E.sendStatus('draft', contributor), 'draft'); assert.equal(E.sendStatus('publish', editor), 'publish');
});

test('transiciones de estado: borrador → pendiente → publicada, devolver y programar', () => {
  assert.deepEqual(E.transition('draft', 'submit', contributor), { ok: true, status: 'pending' });
  assert.equal(E.transition('draft', 'publish', contributor).ok, false);
  assert.equal(E.transition('draft', 'publish', contributor).reason, 'forbidden');
  assert.deepEqual(E.transition('pending', 'withdraw', contributor), { ok: true, status: 'draft' });
  assert.equal(E.transition('pending', 'approve', editor).status, 'publish');
  assert.equal(E.transition('pending', 'approve', contributor).ok, false);
  assert.equal(E.transition('pending', 'approve', author).ok, false);
  assert.equal(E.transition('pending', 'return', editor).status, 'draft');
  assert.equal(E.transition('draft', 'return', editor).ok, false);
  const future = new Date(Date.now() + 86400000).toISOString(), past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(E.transition('pending', 'approveSchedule', editor, { date: future }).status, 'future');
  assert.equal(E.transition('pending', 'approveSchedule', editor, { date: past }).reason, 'past');
  assert.equal(E.transition('pending', 'approveSchedule', editor, {}).reason, 'date');
  assert.equal(E.transition('publish', 'unpublish', editor).status, 'draft');
  assert.equal(E.transition('draft', 'save', contributor).status, 'draft');
});

const N = (id, o = {}) => ({ id, parent: 0, anchor: '', block: '', resolved: false, kind: 'note', date: `2026-05-01T10:${String(id).padStart(2, '0')}:00Z`, author: { id: 6, name: 'Marta' }, text: 'n' + id, ...o });

test('hilos de notas: raíz, respuestas ordenadas, resueltas y contadores por bloque', () => {
  const notes = [N(5, { parent: 1 }), N(1, { anchor: 'abc123', block: 'b1' }), N(2), N(3, { anchor: 'abc123', resolved: true }), N(4, { parent: 5 }), N(6, { anchor: 'zzz999' }), N(7, { parent: 99 })];
  const b = E.buildThreads(notes);
  assert.deepEqual(b.threads.map((t) => t.id), [1, 2, 3, 6, 7], 'las respuestas cuelgan del hilo; una respuesta huérfana pasa a ser raíz');
  assert.deepEqual(b.threads[0].replies.map((r) => r.id), [4, 5], 'respuestas de respuestas, en orden de fecha');
  assert.equal(b.threads[0].count, 3);
  assert.equal(b.general.length, 2);
  assert.deepEqual(E.markCount(b, 'abc123'), { open: 1, total: 2 });
  assert.deepEqual(E.markCount(b, 'nada'), { open: 0, total: 0 });
  assert.equal(b.open, 4);
  const orphans = E.orphanThreads(b.threads, new Set(['abc123']));
  assert.deepEqual(orphans.map((t) => t.id), [6]);
  assert.equal(E.buildThreads(null).threads.length, 0);
  // quién puede borrar
  assert.equal(E.canDeleteNote({ author: { id: 4 } }, contributor), true);
  assert.equal(E.canDeleteNote({ author: { id: 6 } }, contributor), false);
  assert.equal(E.canDeleteNote({ author: { id: 4 } }, editor), true, 'quien edita entradas ajenas borra cualquiera');
});

test('anclas de bloque: estables, únicas y sin repetir al duplicar', () => {
  let n = 0; const rnd = () => ((n++ * 7919) % 100) / 100;
  const p = (id, extra) => ({ id, type: 'paragraph', html: id, ...extra });
  const blocks = [p('a'), p('b'), { id: 'g', type: 'group', children: [p('c'), p('d')] }, { id: 'c1', type: 'columns', cols: [{ children: [p('e')] }] }];
  const a1 = E.ensureAnchor(blocks[0], blocks, rnd);
  assert.ok(E.validAnchor(a1)); assert.equal(E.ensureAnchor(blocks[0], blocks, rnd), a1, 'estable: no cambia');
  E.ensureAnchor(blocks[2].children[1], blocks, rnd); E.ensureAnchor(blocks[3].cols[0].children[0], blocks, rnd);
  assert.equal(E.collectAnchors(blocks).size, 3, 'también dentro de secciones y columnas');
  const used = new Set(['aaaaaa']); assert.notEqual(E.newAnchor(used, () => 0), 'aaaaaa');
  // duplicar un bloque repite su ancla: la segunda copia la pierde
  blocks.splice(1, 0, JSON.parse(JSON.stringify(blocks[0])));
  assert.equal(E.dedupeAnchors(blocks), 1); assert.equal(blocks[0].anc, a1); assert.equal(blocks[1].anc, undefined);
  const bad = [{ id: 'x', type: 'paragraph', html: 'x', anc: 'MAL ANCLA' }];
  E.dedupeAnchors(bad); assert.equal(bad[0].anc, undefined, 'una ancla no válida se descarta');
  assert.equal(E.anchorClass('abc123'), 'ecos-a-abc123'); assert.equal(E.anchorClass('x y'), '');
  assert.equal(E.anchorFromClass('wp-block-heading ecos-a-k3j9x2 has-text-color'), 'k3j9x2'); assert.equal(E.anchorFromClass('ecos-a-X'), '');
});

test('anclas de bloque: ida y vuelta por la salida a WordPress (clase ecos-a-<id>)', () => {
  const blocks = [
    { id: 'p1', type: 'paragraph', html: 'Hola', anc: 'k3j9x2' }, { id: 'h1', type: 'heading', level: 2, html: 'Título', anc: 'zz11aa', align: 'center' },
    { id: 'l1', type: 'list', items: ['a', 'b'], anc: 'q1w2e3' }, { id: 'i1', type: 'image', img: { id: 7, url: 'https://x.org/a.jpg', alt: 'a' }, anc: 'img111' },
    { id: 'g1', type: 'group', children: [{ id: 'p2', type: 'paragraph', html: 'Dentro', anc: 'ins111' }] },
    { id: 'p3', type: 'paragraph', html: 'Sin ancla' },
  ];
  const html = T.composeBlocks(blocks);
  for (const a of ['k3j9x2', 'zz11aa', 'q1w2e3', 'img111', 'ins111']) assert.match(html, new RegExp('ecos-a-' + a));
  const back = parseBlocks(html);
  const flat = []; (function w(l) { for (const b of l) { flat.push(b); if (b.children) w(b.children); } })(back);
  assert.deepEqual(flat.filter((b) => b.anc).map((b) => b.anc).sort(), ['img111', 'ins111', 'k3j9x2', 'q1w2e3', 'zz11aa']);
  assert.equal(flat.find((b) => b.html === 'Sin ancla').anc, undefined);
  assert.equal(flat.find((b) => b.type === 'heading').align, 'center', 'el resto del diseño no se pierde');
  const again = T.composeBlocks(back);
  assert.equal(again.replace(/ecos-[cm]-[a-z0-9]+/g, ''), html.replace(/ecos-[cm]-[a-z0-9]+/g, ''), 'lo que vuelve se reenvía igual');
  // sin ancla, la salida no cambia (ni clases ni atributos)
  assert.doesNotMatch(T.composeBlocks([{ id: 'x', type: 'paragraph', html: 'Hola' }]), /ecos-a-/);
});

test('cambios de otra persona: solo avisa si cambió y no fui yo', () => {
  const opened = '2026-05-01T10:00:00Z';
  const cur = (modified, by) => ({ modified, by });
  assert.equal(E.foreignChange({ opened, cur: cur(opened, { id: 5, name: 'Ana' }), meId: 6 }), null, 'sin cambios');
  assert.deepEqual(E.foreignChange({ opened, cur: cur('2026-05-01T10:02:00Z', { id: 5, name: 'Ana' }), meId: 6 }), { who: 'Ana', at: '2026-05-01T10:02:00Z' });
  assert.equal(E.foreignChange({ opened, cur: cur('2026-05-01T10:02:00Z', { id: 6, name: 'Marta' }), meId: 6 }), null, 'lo cambié yo');
  assert.equal(E.foreignChange({ opened, cur: cur('2026-05-01T10:02:00Z', null), meId: 6 }).who, '', 'cambio sin autor conocido: se avisa igualmente');
  assert.equal(E.foreignChange({ opened, cur: cur('2026-05-01T10:02:00Z', { id: 5, name: 'Ana' }), meId: 6, dismissed: '2026-05-01T10:02:00Z' }), null, 'ignorado');
  assert.ok(E.foreignChange({ opened, cur: cur('2026-05-01T10:09:00Z', { id: 5, name: 'Ana' }), meId: 6, dismissed: '2026-05-01T10:02:00Z' }), 'un cambio posterior vuelve a avisar');
  assert.equal(E.foreignChange({ opened: null, cur: cur('2026-05-01T10:02:00Z', { id: 5 }), meId: 6 }), null);
  const now = Date.parse('2026-05-01T10:00:00Z') + 125000;
  assert.deepEqual(E.agoParts('2026-05-01T10:00:00Z', now), { unit: 'min', n: 2 });
  assert.equal(E.agoParts('2026-05-01T10:00:00Z', now - 100000).unit, 'now');
  assert.deepEqual(E.agoParts('2026-05-01T10:00:00Z', now + 3 * 3600e3), { unit: 'h', n: 3 });
  assert.deepEqual(E.agoParts('2026-05-01T10:00:00Z', now + 3 * 86400e3), { unit: 'd', n: 3 });
});

test('actividad reciente y avisos del sistema', () => {
  const it = (id, status, modified, o = {}) => ({ id, title: 'T' + id, status, date: '2026-05-01T09:00:00Z', modified, author: { id: 5, name: 'Ana' }, editor: { id: 0, name: '' }, ...o });
  const feed = E.activityFeed([
    it(1, 'pending', '2026-05-01T10:00:00Z'), it(2, 'publish', '2026-05-01T09:02:00Z', { editor: { id: 6, name: 'Marta' } }), it(3, 'draft', '2026-05-01T11:00:00Z', { returned: true, editor: { id: 6, name: 'Marta' } }),
    it(4, 'publish', '2026-05-02T09:00:00Z'), it(5, 'future', '2026-05-01T08:00:00Z'),
  ], 6);
  assert.deepEqual(feed.map((x) => x.id), [4, 3, 1, 2, 5], 'lo último primero');
  assert.deepEqual(feed.map((x) => x.kind), ['changed', 'returned', 'review', 'published', 'scheduled']);
  assert.equal(feed.find((x) => x.id === 2).mine, true); assert.equal(feed.find((x) => x.id === 1).who, 'Ana');
  assert.equal(E.activityFeed(new Array(20).fill(0).map((_, i) => it(i, 'draft', '2026-05-01T10:00:00Z')), 6, { limit: 8 }).length, 8);
  // avisos: la primera comprobación no avisa de lo que ya había; después, solo lo nuevo (y lo mío no cuenta como pendiente ajeno)
  const s0 = { pending: [it(1, 'pending', 'x')], returned: [] };
  assert.deepEqual(E.reviewAlerts(null, s0, 6), { pending: [], returned: [] });
  const prev = E.snapshot(s0);
  const s1 = { pending: [it(1, 'pending', 'x'), it(7, 'pending', 'x'), it(8, 'pending', 'x', { author: { id: 6, name: 'Marta' } })], returned: [it(9, 'draft', 'x')] };
  const al = E.reviewAlerts(prev, s1, 6);
  assert.deepEqual(al.pending.map((p) => p.id), [7]); assert.deepEqual(al.returned.map((p) => p.id), [9]);
  assert.deepEqual(E.reviewAlerts(E.snapshot(s1), s1, 6), { pending: [], returned: [] });
});

test('wpself: notas, resumen y cambios (rutas del complemento 1.8.0)', async () => {
  const cfg = { wpUrl: 'https://example.org', wpUser: 'u', wpAppPassword: 'aaaa bbbb cccc dddd eeee ffff', ecosHelper: { version: '1.8.0' } };
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET', body: opt.body ? JSON.parse(opt.body) : null });
    const u = String(url);
    const r = /notes\?post=/.test(u) ? { notes: [{ id: 3, post: 9, parent: 0, author: { id: 6, name: 'Marta', avatar: 'a' }, date: '2026-05-01T10:00:00Z', text: 'Cambiar esto', anchor: 'abc123', block: 'b1', kind: 'return', resolved: false, canDelete: true }] }
      : /\/notes\/\d+$/.test(u) && opt.method === 'DELETE' ? { deleted: [3, 4] } : /\/notes/.test(u) ? { note: { id: 4, post: 9, text: 'ok', resolved: true } }
      : /\/review$/.test(u) ? { pending: [{ id: 9, title: 'T', status: 'pending', author: { id: 4, name: 'Luis' }, openNotes: 2 }], returned: [], activity: [] }
      : { id: 9, status: 'pending', modified: '2026-05-01T10:05:00Z', by: { id: 5, name: 'Ana', avatar: '' } };
    return { ok: true, status: 200, headers: { get: () => '1' }, json: async () => r };
  };
  try {
    const l = await W.notesList(cfg, 9);
    assert.equal(l[0].anchor, 'abc123'); assert.equal(l[0].kind, 'return'); assert.equal(l[0].author.name, 'Marta'); assert.match(calls[0].url, /ecos\/v1\/notes\?post=9/);
    await W.noteAdd(cfg, { post: 9, text: 'Hola', anchor: 'abc123', block: 'b1' });
    assert.deepEqual(calls[1].body, { post: 9, text: 'Hola', anchor: 'abc123', block: 'b1' });
    await W.noteAdd(cfg, { post: 9, text: 'Devuelta', kind: 'return' }); assert.equal(calls[2].body.kind, 'return'); assert.equal(calls[2].body.anchor, undefined);
    assert.equal((await W.noteResolve(cfg, 4, true)).resolved, true); assert.equal(calls[3].method, 'PATCH'); assert.deepEqual(calls[3].body, { resolved: true });
    assert.deepEqual(await W.noteDelete(cfg, 3), [3, 4]);
    const r = await W.reviewSummary(cfg); assert.equal(r.pending[0].openNotes, 2); assert.equal(r.pending[0].author.name, 'Luis');
    const c = await W.postChanges(cfg, 9, 'post'); assert.equal(c.by.name, 'Ana'); assert.match(calls.at(-1).url, /ecos\/v1\/changes\?id=9/);
  } finally { global.fetch = orig; }
  assert.equal(W.helperHasReview('1.7.1'), false); assert.equal(W.helperHasReview('1.8.0'), true);
});

test('complemento 1.8.0: includes/review.php registrado, tipo ecos_note y PHP válido', () => {
  const dir = path.join(__dirname, '..', 'wp-plugin', 'ecos');
  const php = fs.readFileSync(path.join(dir, 'ecos.php'), 'utf8'), rv = fs.readFileSync(path.join(dir, 'includes', 'review.php'), 'utf8');
  assert.match(php, /includes\/review\.php/);
  for (const r of ["'/notes'", "'/notes/(?P<id>\\d+)'", "'/review'", "'/changes'"]) assert.ok(rv.includes(r), r);
  assert.match(rv, /ecos_note/); assert.match(rv, /pre_get_comments/); assert.match(rv, /edit_post/); assert.match(rv, /edit_others_posts/);
  try { execFileSync('php', ['-v'], { stdio: 'ignore' }); } catch { return; }
  execFileSync('php', ['-l', path.join(dir, 'includes', 'review.php')], { stdio: 'pipe' });
});
