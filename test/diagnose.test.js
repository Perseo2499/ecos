// Diagnóstico de conexión, informes de errores saneados y entorno de la web (lógica pura).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../renderer/diagnose');
const WE = require('../renderer/webenv');
const CR = require('../src/crashreport');

const err = (code, message = '') => Object.assign(new Error(message || code), { code });

test('clasificación de errores: causa y consejo', () => {
  const kind = (e) => D.classifyError(e).kind;
  assert.equal(kind(err('ENOTFOUND', 'getaddrinfo ENOTFOUND x.es')), 'dns');
  assert.equal(kind(err('ECONNREFUSED')), 'refused');
  assert.equal(kind(err('ETIMEDOUT')), 'timeout');
  assert.equal(kind(err('ECONNRESET')), 'reset');
  assert.match(D.classifyError(err('ECONNRESET')).advice, /VPN o un antivirus/);
  assert.equal(kind(new Error('fetch failed', { cause: err('CERT_HAS_EXPIRED') })), 'cert-expired');
  assert.equal(kind(new Error('x', { cause: err('ERR_TLS_CERT_ALTNAME_INVALID') })), 'cert-name');
  assert.equal(kind(err('DEPTH_ZERO_SELF_SIGNED_CERT')), 'cert-untrusted');
  assert.equal(kind(err('ENETUNREACH')), 'offline');
  assert.equal(kind('HTTP 401 Unauthorized'), 'auth');
  assert.equal(kind('HTTP 503 Service Unavailable'), 'server');
  assert.equal(kind(new Error('algo raro')), 'unknown');
  assert.equal(D.isConnectionProblem(err('ENOTFOUND')), true);
  assert.equal(D.isConnectionProblem(new Error('Failed to fetch')), true);
  assert.equal(D.isConnectionProblem(new Error('Cannot read properties of undefined')), false);
});

test('certificado: caducidad, nombre y comodines', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const ok = D.analyzeTls({ validTo: '2026-12-01T00:00:00Z', san: 'DNS:ejemplo.es, DNS:www.ejemplo.es', authorized: true }, 'www.ejemplo.es', now);
  assert.equal(ok.status, 'ok');
  assert.equal(D.analyzeTls({ validTo: '2026-05-20T00:00:00Z' }, 'a.es', now).status, 'fail');
  assert.equal(D.analyzeTls({ validTo: '2026-06-05T00:00:00Z', san: 'DNS:a.es' }, 'a.es', now).status, 'warn');
  assert.equal(D.analyzeTls({ validTo: '2027-01-01T00:00:00Z', san: 'DNS:otra.es' }, 'a.es', now).status, 'fail');
  assert.equal(D.certMatchesHost('DNS:*.a.es', 'blog.a.es'), true);
  assert.equal(D.certMatchesHost('DNS:*.a.es', 'x.blog.a.es'), false);
});

test('reloj del sistema frente a la cabecera Date', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  assert.equal(D.analyzeClock('Mon, 01 Jun 2026 12:00:20 GMT', now).status, 'ok');
  assert.equal(D.analyzeClock('Mon, 01 Jun 2026 11:55:00 GMT', now).status, 'warn');
  const bad = D.analyzeClock('Mon, 01 Jun 2026 08:00:00 GMT', now);
  assert.equal(bad.status, 'fail'); assert.match(D.fill(bad.detail, bad.p), /adelantado/);
  assert.equal(D.analyzeClock('', now).status, 'skip');
});

test('bloqueos de /wp-json: detecta el plugin', () => {
  assert.equal(D.detectBlocker(403, {}, '<html>Your access to this site has been limited by the site owner. Wordfence</html>'), 'Wordfence');
  assert.equal(D.detectBlocker(403, { server: 'cloudflare' }, ''), 'Cloudflare');
  assert.equal(D.detectBlocker(403, {}, 'nada'), '');
});

function fakeDeps(over = {}) {
  const json = (o, status = 200) => ({ status, headers: { 'content-type': 'application/json', date: new Date().toUTCString() }, text: JSON.stringify(o), ms: 120 });
  return {
    dns: async () => ['1.2.3.4'], tcp: async () => true, tls: async () => ({ validTo: new Date(Date.now() + 90 * 864e5).toISOString(), san: 'DNS:web.es', authorized: true }),
    http: async (u, o) => {
      if (/\/ecos\/v1\/status/.test(u)) return json({ plugin: 'ecos', version: '1.5.0' });
      if (/users\/me/.test(u)) return json({ roles: ['editor'], capabilities: { edit_posts: true } });
      if (/\/wp-json\/$/.test(u)) return json({ namespaces: ['wp/v2'] });
      return { status: 200, headers: { date: new Date().toUTCString() }, text: '<html>', ms: 300 };
    },
    proxy: async () => 'DIRECT', ...over,
  };
}
const ctx = { url: 'https://web.es', hasAuth: true, bundled: '1.7.0', metaConnected: true, metaTokenExpires: new Date(Date.now() + 3 * 864e5).toISOString(), gpConnected: false, aiConfigured: true, aiName: 'Google', testAi: false };

test('diagnóstico completo: resultados mezclados y en orden', async () => {
  const seen = [];
  const r = await D.runDiagnostics(ctx, fakeDeps(), (s) => seen.push(s.id + ':' + s.status));
  assert.deepEqual(r.steps.map((s) => s.id), D.STEPS.map((s) => s[0]));
  const by = Object.fromEntries(r.steps.map((s) => [s.id, s]));
  assert.equal(by.internet.status, 'ok'); assert.equal(by.tls.status, 'ok'); assert.equal(by.auth.status, 'ok');
  assert.equal(by.helper.status, 'warn'); assert.match(D.fill(by.helper.detail, by.helper.p), /1\.5\.0.*1\.7\.0/);
  assert.equal(by.meta.status, 'warn'); assert.equal(by.gphotos.status, 'skip'); assert.equal(by.clock.status, 'ok');
  assert.ok(seen.indexOf('internet:running') < seen.indexOf('internet:ok'));
  const rep = D.formatReport(r.steps, { version: '3.5.4', site: 'web.es' });
  assert.match(rep, /✓ Internet en general/); assert.match(rep, /! Complemento de Ecos/); assert.match(rep, /– Google Fotos/);
});

test('diagnóstico: sin internet se saltan los pasos de la web', async () => {
  const r = await D.runDiagnostics(ctx, fakeDeps({ dns: async () => { throw err('ENOTFOUND'); } }));
  const by = Object.fromEntries(r.steps.map((s) => [s.id, s]));
  assert.equal(by.internet.status, 'fail'); assert.equal(by.dns.status, 'skip'); assert.equal(by.web.status, 'skip'); assert.equal(by.auth.status, 'skip');
});

test('diagnóstico: DNS de la web falla, ECONNRESET sugiere VPN/antivirus, API bloqueada y contraseña inválida', async () => {
  let r = await D.runDiagnostics(ctx, fakeDeps({ dns: async (h) => { if (h === 'web.es') throw err('ENOTFOUND'); return []; } }));
  assert.equal(r.steps.find((s) => s.id === 'dns').status, 'fail');
  assert.equal(r.steps.find((s) => s.id === 'tls').status, 'skip');

  r = await D.runDiagnostics(ctx, fakeDeps({ http: async () => { throw err('ECONNRESET'); } }));
  assert.equal(r.steps.find((s) => s.id === 'web').status, 'fail');
  assert.match(r.steps.find((s) => s.id === 'proxy').advice, /VPN o un antivirus/);

  const base = fakeDeps();
  r = await D.runDiagnostics(ctx, fakeDeps({ http: async (u, o) => (/\/wp-json\/$/.test(u) ? { status: 403, headers: {}, text: 'Wordfence', ms: 10 } : /users\/me/.test(u) ? { status: 401, headers: {}, text: '{}', ms: 10 } : base.http(u, o)) }));
  assert.equal(r.steps.find((s) => s.id === 'wpjson').status, 'fail');
  assert.match(D.fill(r.steps.find((s) => s.id === 'wpjson').detail, r.steps.find((s) => s.id === 'wpjson').p), /Wordfence/);
  assert.equal(r.steps.find((s) => s.id === 'auth').status, 'fail');
});

test('diagnóstico: IA con prueba, proxy detectado y reloj desfasado; el informe no lleva secretos', async () => {
  const future = new Date(Date.now() + 5 * 3600 * 1000).toUTCString();
  const base = fakeDeps();
  const r = await D.runDiagnostics({ ...ctx, testAi: true }, fakeDeps({ ai: async () => 'Google · modelo', proxy: async () => 'PROXY 10.0.0.1:8080', http: async (u, o) => { const x = await base.http(u, o); return { ...x, headers: { ...x.headers, date: future } }; } }));
  const by = Object.fromEntries(r.steps.map((s) => [s.id, s]));
  assert.equal(by.ai.status, 'ok'); assert.equal(by.proxy.status, 'warn'); assert.equal(by.clock.status, 'fail');
  const rep = D.formatReport([{ id: 'x', title: 'Prueba', status: 'fail', detail: 'Falló https://web.es/wp-json?access_token=SECRETO Authorization: Basic QWxhZGRpbjpvcGVu clave abcd efgh ijkl mnop qrst uvwx' }]);
  assert.ok(!/SECRETO|QWxhZGRpbjpvcGVu|abcd efgh/.test(rep), rep);
});

// ---- Informes de errores
test('saneado: rutas de Windows y macOS, tokens, Authorization y correos', () => {
  const S = CR.sanitize;
  assert.equal(S('Error en C:\\Users\\María López\\AppData\\x.js'.replace('María López', 'maria')), 'Error en ~\\AppData\\x.js');
  assert.equal(S('at f (C:/Users/pepe/ecos/main.js:10:5)'), 'at f (~/ecos/main.js:10:5)');
  assert.equal(S('abrió /Users/laura/Documents/blog.json'), 'abrió ~/Documents/blog.json');
  assert.equal(S('en /home/ana/.config/ecos'), 'en ~/.config/ecos');
  const u = S('GET https://graph.facebook.com/me?access_token=EAAB123456789012345678901234567890&x=1 falló');
  assert.ok(!/EAAB|access_token/.test(u), u); assert.match(u, /https:\/\/graph\.facebook\.com\/me\?…/);
  assert.ok(!/QWxhZGRpbjpvcGVu/.test(S('Authorization: Basic QWxhZGRpbjpvcGVu')));
  assert.ok(!/Bearer abc123/.test(S('cabecera Bearer abc123DEF456ghi')));
  assert.equal(S('escribe a ana.lopez@correo.es ya'), 'escribe a [correo] ya');
  assert.ok(!/ana/.test(S('C:\\Users\\ana\\x')));
});

test('firma: el mismo fallo agrupa aunque cambien números y rutas', () => {
  const a = CR.signature('No se encuentra la entrada 123', 'Error\n    at load (~/a/renderer/app/blog.js:10:5)');
  const b = CR.signature('No se encuentra la entrada 9876', 'Error\n    at load (~/b/renderer/app/blog.js:99:1)');
  const c = CR.signature('Otra cosa', 'Error\n    at load (~/a/renderer/app/blog.js:10:5)');
  assert.equal(a, b); assert.notEqual(a, c);
});

test('almacén: guarda saneado, no repite en 24 h, lista, borra y prepara la incidencia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-crash-'));
  let t = Date.parse('2026-06-01T10:00:00Z');
  const st = CR.createStore({ file: path.join(dir, 'c.json'), now: () => new Date(t) });
  const info = { message: 'Fallo en C:\\Users\\ana\\x.js token=ABCDEF123456', stack: 'Error: x\n    at f (C:\\Users\\ana\\ecos\\main.js:1:1)', version: '3.5.4', os: 'win32 x64' };
  const a = st.add(info);
  assert.equal(a.duplicate, false); assert.ok(!/ana|ABCDEF/.test(JSON.stringify(a.report)), JSON.stringify(a.report));
  t += 3600e3; const b = st.add(info);
  assert.equal(b.duplicate, true); assert.equal(st.list().length, 1); assert.equal(st.list()[0].count, 2);
  t += 25 * 3600e3; assert.equal(st.add(info).duplicate, false); assert.equal(st.list().length, 2);
  const url = CR.buildIssueUrl(a.report);
  assert.ok(url.startsWith('https://github.com/Perseo2499/ecos/issues/new?title='));
  assert.match(decodeURIComponent(url), /Versión: 3\.5\.4/);
  const big = { ...a.report, stack: ('at x (~/a.js:1:1)\n').repeat(2000), message: 'm' };
  assert.ok(CR.issueBody(big).length <= 6000); assert.ok(CR.buildIssueUrl(big).length <= 7500);
  assert.equal(st.remove(a.report.id), true); st.clear(); assert.equal(st.list().length, 0);
});

// ---- Entorno de la web
test('entorno: tamaños, avisos de versión y límites', () => {
  assert.equal(WE.parseSize('64M'), 64 * 1048576); assert.equal(WE.parseSize('2G'), 2 * 1073741824); assert.equal(WE.parseSize('-1'), Infinity); assert.equal(WE.parseSize('512K'), 524288);
  const status = { plugin: 'ecos', version: '1.7.0', caches: ['WP Rocket'], env: { wp_version: '6.1.3', php_version: '7.3.33', theme: { name: 'Astra', version: '4.0' }, limits: { upload_max_filesize: '2M', post_max_size: '8M', memory_limit: '64M', wp_max_upload: 2097152 }, rest: { enabled: true, app_passwords: true }, plugins: [{ slug: 'wordfence', name: 'Wordfence', version: '7' }, { slug: 'cache-enabler', name: 'Cache Enabler', version: '1' }, { slug: 'wp-rocket', name: 'WP Rocket', version: '3' }] } };
  const env = WE.parseEnv(status, { namespaces: ['wp/v2', 'wordfence/v1'] }, {});
  assert.equal(env.source, 'plugin'); assert.equal(env.limits.maxUpload, 2097152);
  const ids = WE.analyzeEnv(env, { bundled: '1.8.0', uploadBytes: 5 * 1048576 }).map((w) => w.id);
  for (const id of ['wp-old', 'php-old', 'security', 'cache-nopurge', 'helper-old', 'upload-small', 'memory-low']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('rest-off'));
  const u = WE.uploadCheck(env, 5 * 1048576); assert.equal(u.ok, false); assert.match(u.text, /5 MB.*2 MB/);
  assert.equal(WE.uploadCheck(env, 1024).ok, true);
});

test('entorno: sin complemento se lee lo que se pueda y una web sana no avisa', () => {
  const env = WE.parseEnv(null, { name: 'Mi web', namespaces: ['wp/v2', 'ithemes-security/v1'] }, { 'x-powered-by': 'PHP/8.2.1' });
  assert.equal(env.source, 'rest'); assert.equal(env.php, '8.2.1'); assert.equal(env.limits, null);
  const ids = WE.analyzeEnv(env).map((w) => w.id);
  assert.deepEqual(ids.sort(), ['no-helper', 'security']);
  const good = WE.parseEnv({ plugin: 'ecos', version: '1.7.0', caches: [], env: { wp_version: '6.5', php_version: '8.2.0', limits: { upload_max_filesize: '64M', post_max_size: '64M', memory_limit: '256M', wp_max_upload: 67108864 }, rest: { enabled: true, app_passwords: true }, plugins: [] } }, null, {});
  assert.deepEqual(WE.analyzeEnv(good, { bundled: '1.7.0' }), []);
  assert.equal(WE.analyzeEnv(WE.parseEnv({ plugin: 'ecos', version: '1.7.0', env: { rest: { enabled: true, app_passwords: false } } }, null, {})).some((w) => w.id === 'apppw-off'), true);
});
