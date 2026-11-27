// Comprobación real (con Electron) de la ventana del editor de WordPress: src/wpeditorwin.js contra un servidor local que imita
// wp-admin/post.php con un wp.data falso y la API REST. Uso: xvfb-run -a electron --no-sandbox scripts/wped-electron-check.js
// Imprime una línea «RESULT {json}» y sale con 0 si todo va bien (la usa test/wpeditor-electron.test.js).
const { app, BrowserWindow, webContents } = require('electron');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

app.disableHardwareAcceleration();
const out = { checks: {}, errors: [] };
const ok = (name, cond, info) => { out.checks[name] = !!cond; if (!cond) out.errors.push(name + (info !== undefined ? ': ' + JSON.stringify(info) : '')); };

const posts = new Map(); let nextId = 50;
const tokens = new Set(); const cookies = new Set();
const log = []; // peticiones HTTP (para comprobar cookies y reutilización)
let withPlugin = false;

const PAGE = (id) => `<!doctype html><meta charset=utf-8><title>Editar entrada</title><body><h1>Editor falso</h1>
<a id=out href="http://127.0.0.2:__PORT__/fuera">enlace externo</a>
<script>
  window.__content = ${JSON.stringify(posts.get(id)?.content?.raw ?? '')}; let saving = false, failed = false;
  window.wp = { data: {
    select: (n) => n === 'core/editor' ? { isSavingPost: () => saving, isAutosavingPost: () => false, didPostSaveRequestFail: () => failed } : null,
    dispatch: (n) => ({ savePost: async () => { saving = true; try { const r = await fetch('/__save', { method: 'POST', body: JSON.stringify({ id: ${id}, content: window.__content }) }); failed = !r.ok; } finally { setTimeout(() => { saving = false; }, 150); } } }),
  } };
</script></body>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    log.push({ method: req.method, path: u.pathname + u.search, cookie: req.headers.cookie || '' });
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const authed = /ecos_session=ok/.test(req.headers.cookie || '');
    if (u.pathname === '/wp-json/ecos/v1/editor-session') {
      if (!withPlugin) return json(404, { code: 'rest_no_route', message: 'No route was found' });
      const t = crypto.randomBytes(32).toString('hex'); tokens.add(t);
      return json(200, { plugin: 'ecos', url: `http://127.0.0.1:${server.address().port}/wp-admin/admin-post.php?action=ecos_editor&t=${t}`, expires: 60 });
    }
    if (u.pathname === '/wp-admin/admin-post.php') {
      const t = u.searchParams.get('t');
      if (!tokens.delete(t)) { res.writeHead(403); return res.end('Este enlace ya se usó'); }
      res.writeHead(302, { 'Set-Cookie': 'ecos_session=ok; Path=/; HttpOnly', Location: `/wp-admin/post.php?post=${[...posts.keys()].at(-1)}&action=edit`, 'Referrer-Policy': 'no-referrer' }); return res.end();
    }
    if (u.pathname === '/wp-admin/post.php') {
      if (withPlugin && !authed) { res.writeHead(302, { Location: '/wp-login.php' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE(Number(u.searchParams.get('post'))).replace('__PORT__', server.address().port));
    }
    if (u.pathname === '/__save') { const d = JSON.parse(body); const p = posts.get(d.id); if (!p) { res.writeHead(404); return res.end(); } p.content.raw = d.content; p.modified_gmt = new Date().toISOString().slice(0, 19); res.writeHead(200); return res.end('ok'); }
    if (u.pathname === '/wp-json/wp/v2/posts' && req.method === 'POST') { const j = JSON.parse(body); const id = nextId++; const p = { id, slug: j.slug, title: { raw: j.title }, status: j.status, content: { raw: j.content }, modified_gmt: new Date().toISOString().slice(0, 19) }; posts.set(id, p); return json(201, p); }
    let m;
    if ((m = /^\/wp-json\/wp\/v2\/posts\/(\d+)$/.exec(u.pathname))) {
      const p = posts.get(Number(m[1]));
      if (!p) return json(404, { code: 'rest_post_invalid_id', message: 'ID de entrada no válido.' });
      if (req.method === 'DELETE') { posts.delete(p.id); return json(200, { deleted: true }); }
      return json(200, p);
    }
    json(404, { code: 'rest_no_route', message: 'No route was found' });
  });
});

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const cfg = { wpUrl: `http://127.0.0.1:${port}`, wpUser: 'u', wpAppPassword: 'abcd efgh ijkl mnop qrst uvwx' };
  const W = require('../src/wpself'); const wped = require('../src/wpeditor');
  const parent = new BrowserWindow({ show: false, width: 900, height: 700 });
  const external = [];
  let helperVersion = '';
  const ew = require('../src/wpeditorwin').create({ electron: require('electron'), W, wped, getCfg: () => cfg, getParent: () => parent, getHelperVersion: async () => helperVersion, log: () => {}, openExternal: (u) => external.push(u) });
  const barWc = () => webContents.getAllWebContents().find((w) => /wped-bar\.html/.test(w.getURL()));
  const pageWc = () => webContents.getAllWebContents().find((w) => w.getURL().startsWith(cfg.wpUrl) && !/wped-bar/.test(w.getURL()));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout esperando: ' + webContents.getAllWebContents().map((w) => w.getURL().replace(/t=[a-f0-9]+/, 't=…')).join(' | ')); await new Promise((r) => setTimeout(r, 100)); } };
  const ex = (wc, code, ms = 8000) => Promise.race([wc.executeJavaScript(code), new Promise((_, rej) => setTimeout(() => rej(new Error('executeJavaScript sin respuesta: ' + code.slice(0, 50))), ms))]);
  const press = async (id) => { await until(() => barWc()?.isLoading() === false && barWc()); await ex(barWc(), `document.getElementById('${id}').click()`); };
  const labels = { title: 'Editor de prueba', done: 'Terminar y volver a Ecos', cancel: 'Cancelar', saving: 'Guardando…', loginHint: 'Inicia sesión una vez' };
  const colors = { bg: '#f4f1ea', fg: '#1d1b16', accent: '#1f5c4a', on: '#fff' };
  const NEW = '<!-- wp:paragraph -->\n<p>Escrito en el editor</p>\n<!-- /wp:paragraph -->';

  // A) terminar: guarda con savePost, se lee el contenido y se borra el temporal; sin complemento (wp-admin normal)
  let p = ew.editMarkup({ markup: '<!-- wp:uagb/info-box --><div>vieja</div><!-- /wp:uagb/info-box -->', labels, colors });
  await until(() => pageWc() && !pageWc().isLoading() && pageWc().getURL().includes('post.php'));
  if (process.env.WPED_SHOT) { // captura opcional de la pantalla (con ImageMagick) para revisar la ventana a ojo
    await new Promise((r) => setTimeout(r, 1200));
    require('child_process').spawnSync('import', ['-window', 'root', process.env.WPED_SHOT + '.png']);
  }
  ok('hay un borrador temporal', [...posts.values()].some((x) => x.slug.startsWith('ecos-temp-') && x.status === 'draft' && x.title.raw === 'Ecos · edición temporal'));
  ok('la barra muestra el aviso de sesión sin complemento', await ex(barWc(), "document.getElementById('hint').textContent") === labels.loginHint);
  ok('la barra tiene el título y los botones', (await ex(barWc(), "document.getElementById('done').textContent + '|' + document.getElementById('cancel').textContent + '|' + document.title")).startsWith('Terminar y volver a Ecos|Cancelar'));
  // la página: sin Node y sin acceso a la app
  const probe = await ex(pageWc(), '[typeof require, typeof process, typeof module, typeof window.api, typeof window.wpedBar, typeof window.electron].join(",")');
  ok('la página no tiene Node ni puente con la app', probe === 'undefined,undefined,undefined,undefined,undefined,undefined', probe);
  // navegación limitada al dominio de la web; ventanas nuevas al navegador
  const startUrl = pageWc().getURL();
  await ex(pageWc(), "location.href = 'http://127.0.0.2:" + port + "/fuera'").catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  ok('no navega a otro dominio', pageWc().getURL() === startUrl, pageWc().getURL());
  const winsBefore = BrowserWindow.getAllWindows().length;
  await ex(pageWc(), "window.open('https://example.org/x')").catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  ok('las ventanas nuevas van al navegador', external.includes('https://example.org/x') && BrowserWindow.getAllWindows().length === winsBefore, external);
  await ex(pageWc(), 'window.__content = ' + JSON.stringify(NEW)); // la persona escribe
  await press('done');
  const a = await p;
  ok('terminar devuelve el contenido guardado', a.content === NEW, a);
  ok('el temporal se borra al terminar', ![...posts.values()].some((x) => x.slug.startsWith('ecos-temp-')));
  ok('la ventana se cierra', BrowserWindow.getAllWindows().length === 1);

  // B) cancelar: no se lee nada y se borra el temporal
  p = ew.editMarkup({ markup: '', labels, colors });
  await until(() => pageWc() && pageWc().getURL().includes('post.php'));
  await ex(pageWc(), "window.__content = 'no debe salir'");
  await press('cancel');
  const b = await p;
  ok('cancelar devuelve cancelled', b.cancelled === true && b.content === undefined, b);
  ok('el temporal se borra al cancelar', ![...posts.values()].some((x) => x.slug.startsWith('ecos-temp-')));

  // C) cerrar la ventana con la X = cancelar (y se borra el temporal)
  p = ew.editMarkup({ markup: 'x', labels, colors });
  await until(() => pageWc() && pageWc().getURL().includes('post.php'));
  BrowserWindow.getAllWindows().find((w) => w !== parent).close();
  const c = await p;
  ok('cerrar la ventana cancela y borra el temporal', c.cancelled === true && ![...posts.values()].some((x) => x.slug.startsWith('ecos-temp-')), c);

  // D) con el complemento 1.6: dirección de un solo uso, cookie en la partición, el token no se puede repetir
  withPlugin = true; helperVersion = '1.6.0'; log.length = 0;
  p = ew.editMarkup({ markup: '', labels, colors });
  await until(() => pageWc() && pageWc().getURL().includes('post.php'));
  ok('con el complemento entra sin pedir contraseña', pageWc().getURL().includes('/wp-admin/post.php?post='), pageWc().getURL());
  ok('sin aviso de sesión con el complemento', await ex(barWc(), "document.getElementById('hint').textContent") === '');
  const land = log.find((l) => l.path.startsWith('/wp-admin/admin-post.php')); const t = new URL('http://x' + land.path).searchParams.get('t');
  const second = await fetch(`${cfg.wpUrl}/wp-admin/admin-post.php?action=ecos_editor&t=${t}`, { redirect: 'manual' });
  ok('la dirección de un solo uso no vale dos veces', second.status === 403, second.status);
  ok('la cookie de sesión está en la partición de la ventana (la de la página sí la envía)', log.some((l) => l.path.startsWith('/wp-admin/post.php') && /ecos_session=ok/.test(l.cookie)));
  ok('la app principal no recibe la cookie', !(await parent.webContents.session.cookies.get({ url: cfg.wpUrl })).length);
  await ex(pageWc(), 'window.__content = ' + JSON.stringify(NEW));
  await press('done');
  ok('terminar con el complemento devuelve el contenido', (await p).content === NEW);

  // E) entrada completa: se guarda en su post.php y se devuelve done
  const real = { id: nextId++, slug: 'mi-entrada', title: { raw: 'Mi entrada' }, status: 'publish', content: { raw: 'vieja' }, modified_gmt: '2026-01-01T00:00:00' }; posts.set(real.id, real);
  p = ew.editPost({ postId: real.id, labels, colors });
  await until(() => pageWc() && pageWc().getURL().includes('post=' + real.id));
  await ex(pageWc(), "window.__content = 'editada en WordPress'");
  await press('done');
  const e = await p;
  ok('la entrada completa se guarda y devuelve done', e.done === true && posts.get(real.id).content.raw === 'editada en WordPress', e);
  ok('la entrada real no se borra', posts.has(real.id));

  // F) un solo editor a la vez
  p = ew.editMarkup({ markup: '', labels, colors });
  await until(() => pageWc() && pageWc().getURL().includes('post.php'));
  let second2 = null; try { await ew.editMarkup({ markup: '', labels, colors }); } catch (err) { second2 = err.message; }
  ok('no se abren dos editores a la vez', /Ya hay un editor/.test(second2 || ''), second2);
  await press('cancel'); await p;
  ok('al final no quedan temporales', ![...posts.values()].some((x) => x.slug.startsWith('ecos-temp-')));
}

app.whenReady().then(main).then(() => { console.log('RESULT ' + JSON.stringify(out)); app.exit(out.errors.length ? 1 : 0); }).catch((e) => { out.errors.push('excepción: ' + (e.stack || e.message)); console.log('RESULT ' + JSON.stringify(out)); app.exit(1); });
