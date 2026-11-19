const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Registro de errores en %APPDATA%\Ecos\ecos.log y aviso visible si algo falla al arrancar
const logFile = () => path.join(app.getPath('userData'), 'ecos.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`;
  try { fs.mkdirSync(path.dirname(logFile()), { recursive: true }); fs.appendFileSync(logFile(), line); } catch { /* sin registro */ }
}
function fatal(err) {
  log('ERROR FATAL', err);
  try {
    dialog.showErrorBox('Ecos no ha podido arrancar',
      `${err && err.message ? err.message : err}\n\nDetalles en: ${logFile()}\nEnvía ese archivo para que lo revisen.`);
  } catch { /* nada */ }
  app.exit(1);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', (e) => log('Promesa rechazada sin gestionar', e));

// Una sola copia abierta: si ya hay una, se trae al frente
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  });
}

// --- Arranque a prueba de fallos ------------------------------------------------
// En algunos equipos Windows los procesos aislados (sandbox) de Chromium no pueden arrancar
// (STATUS_DLL_NOT_FOUND): primero fallaba el proceso gráfico y la ventana quedaba en blanco.
// Ecos desactiva siempre la aceleración gráfica. Si detecta que un proceso aislado falla o que la
// ventana no carga, se reinicia sin sandbox y lo recuerda en modo-arranque.json.
const MODES = [
  { name: 'normal (sin aceleración gráfica)', switches: [] },
  { name: 'compatible (sin sandbox)', switches: ['no-sandbox'] },
];
const modeFile = () => path.join(app.getPath('userData'), 'modo-arranque.json');
const pendingFile = () => path.join(app.getPath('userData'), 'arranque-pendiente');
let mode = 0;
try { mode = JSON.parse(fs.readFileSync(modeFile(), 'utf8')).nivel ? 1 : 0; } catch { /* primera vez */ }
// Migración desde 0.2.3 (modo-grafico.json): si había detectado fallos, se mantiene el modo compatible
const legacyMode = path.join(app.getPath('userData'), 'modo-grafico.json');
try { if (JSON.parse(fs.readFileSync(legacyMode, 'utf8')).nivel) { mode = 1; fs.writeFileSync(path.join(app.getPath('userData'), 'modo-arranque.json'), JSON.stringify({ nivel: 1 })); } fs.unlinkSync(legacyMode); } catch { /* no existe */ }
const saveMode = (n) => { try { fs.writeFileSync(modeFile(), JSON.stringify({ nivel: n, fecha: new Date().toISOString() })); } catch { /* nada */ } };
if (gotLock && mode === 0 && fs.existsSync(pendingFile())) {
  mode = 1; saveMode(1);
  log('El arranque anterior no llegó a mostrar la ventana; se pasa al modo compatible');
}
if (gotLock) { try { fs.mkdirSync(path.dirname(pendingFile()), { recursive: true }); fs.writeFileSync(pendingFile(), new Date().toISOString()); } catch { /* nada */ } }
app.disableHardwareAcceleration();
for (const sw of MODES[mode].switches) app.commandLine.appendSwitch(sw);

let relaunching = false;
function escalate(motivo) {
  log(`Fallo de arranque (modo ${mode}: ${MODES[mode].name}): ${motivo}`);
  if (mode >= MODES.length - 1 || relaunching) return;
  relaunching = true;
  saveMode(1);
  try { fs.unlinkSync(pendingFile()); } catch { /* nada */ }
  log('Reiniciando en modo compatible (sin sandbox)');
  app.relaunch();
  app.exit(0);
}
app.on('child-process-gone', (_e, d) => {
  if (d.type === 'GPU' || d.type === 'Utility') escalate(`proceso ${d.type} cerrado (${d.reason}, código ${d.exitCode})`);
});

let store, meta, wp, buildDraft, mediaKey, DEFAULT_FOOTER, mergeDuplicates, importers, updater;
try {
  store = require('./src/store');
  meta = require('./src/meta');
  wp = require('./src/wpcom');
  ({ buildDraft, mediaKey, DEFAULT_FOOTER, mergeDuplicates } = require('./src/transform'));
  importers = require('./src/importers');
  updater = require('./src/updater');
} catch (err) {
  app.whenReady().then(() => fatal(err));
}

let cfg = {};
let accounts = [];
let mainWin;

function createWindow() {
  const win = mainWin = new BrowserWindow({
    width: 1280, height: 860, title: 'Ecos', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

const publicCfg = () => ({
  ...cfg,
  metaAppSecret: cfg.metaAppSecret ? '••••••' : '', wpClientSecret: cfg.wpClientSecret ? '••••••' : '',
  anthropicKey: cfg.anthropicKey ? '••••••' : '',
  metaUserToken: undefined, wpToken: undefined,
  metaConnected: !!cfg.metaUserToken, wpConnected: !!cfg.wpToken,
  metaRedirectUri: meta.REDIRECT, wpRedirectUri: wp.REDIRECT, wpBlogId: undefined,
  format: { cleanTitle: true, footer: DEFAULT_FOOTER, extraTags: '', categories: '', status: 'draft', mergeDuplicates: true, ...(cfg.format || {}) },
  exported: cfg.exported || {},
  startMode: { level: mode, name: MODES[mode].name },
});

// Envuelve llamadas a WordPress: si rechaza el permiso, se desconecta y se avisa
const wpCall = async (fn) => { try { return await fn(); } catch (e) { throw e instanceof wp.AuthError ? wpAuthFailed(e) : e; } };

// Envuelve los manejadores para devolver errores legibles al renderer
const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
});

handle('config:get', () => publicCfg());
handle('config:set', (changes) => {
  for (const [k, v] of Object.entries(changes)) {
    if (v === '••••••') continue; // secreto sin cambios
    cfg[k] = typeof v === 'string' ? v.trim() : v; // sin espacios sobrantes al pegar claves
  }
  store.save(cfg);
  return publicCfg();
});

handle('meta:login', async () => {
  cfg.metaUserToken = await meta.login(cfg);
  store.save(cfg);
  accounts = await meta.listAccounts(cfg);
  return accounts.map(({ pageToken, ...a }) => a);
});
handle('meta:accounts', async () => {
  accounts = await meta.listAccounts(cfg);
  return accounts.map(({ pageToken, ...a }) => a);
});
// cursors: undefined = primera página; { facebook, instagram } = «Cargar más» (null = esa red no tiene más)
handle('meta:posts', async (pageId, sources, cursors) => {
  const acc = accounts.find((a) => a.pageId === pageId);
  if (!acc) throw new Error('Página no encontrada; vuelve a conectar con Meta');
  const want = (net) => sources.includes(net) && (!cursors || cursors[net]);
  const none = { posts: [], next: null };
  const [fb, ig] = await Promise.all([
    want('facebook') ? meta.facebookPosts(cfg, acc, cursors?.facebook) : none,
    want('instagram') ? meta.instagramPosts(cfg, acc, cursors?.instagram) : none,
  ]);
  return {
    posts: [...fb.posts, ...ig.posts].sort((a, b) => new Date(b.date) - new Date(a.date)),
    cursors: { facebook: fb.next, instagram: ig.next },
  };
});

// Conecta con WordPress.com y solo guarda el permiso si funciona de verdad.
// Si el permiso limitado al blog no sirve, lo intenta una vez con acceso a toda la cuenta.
handle('wp:login', async () => {
  let r;
  try {
    r = await wp.login(cfg, { log });
  } catch (err) {
    if (!(err instanceof wp.AuthError)) throw err;
    log('WordPress: el permiso limitado al blog no funciona; se pide acceso global.', err.message);
    mainWin.webContents.send('toast', 'WordPress no aceptó el primer permiso. Se abrirá otra vez el navegador para aprobar el acceso completo.');
    r = await wp.login(cfg, { global: true, log });
  }
  Object.assign(cfg, { wpToken: r.token, wpBlogId: r.blogId });
  store.save(cfg);
  return r.siteName;
});

// Si WordPress rechaza el permiso guardado, se borra para que la app muestre «no conectado»
function wpAuthFailed(err) {
  log('WordPress: permiso rechazado', err.message);
  cfg.wpToken = ''; cfg.wpBlogId = '';
  store.save(cfg);
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('config:changed', publicCfg());
  return new Error('WordPress ha rechazado la conexión (caducada o no válida). Ve a Configuración y pulsa «Conectar con WordPress.com».');
}
handle('wp:categories', async () => {
  try { return await wp.categories(cfg); } catch (e) { throw e instanceof wp.AuthError ? wpAuthFailed(e) : e; }
});

// Sube los medios (remotos o locales) y genera el borrador para revisar
handle('draft:build', async (posts) => {
  if (!cfg.wpToken) throw new Error('Primero conecta WordPress.com en Configuración.');
  const items = new Map();
  for (const p of posts) for (const m of p.media) {
    if ((m.type === 'image' && (m.url || m.path)) || (m.type === 'video' && m.path)) items.set(mediaKey(m), m);
  }
  const uploaded = new Map();
  const failed = [];
  for (const [key, m] of items) {
    // uno a uno, para que un fallo no tumbe el resto
    try {
      uploaded.set(key, m.path ? await wp.uploadFile(cfg, m.path) : (await wp.uploadFromUrls(cfg, [m.url]))[0]);
    } catch (e) {
      if (e instanceof wp.AuthError) throw wpAuthFailed(e); // no tiene sentido seguir con el resto
      failed.push(e.message);
    }
  }
  return { ...buildDraft(posts, uploaded, publicCfg().format), failed };
});

// --- Importaciones alternativas ---
const pick = async (opts) => {
  const r = await dialog.showOpenDialog(mainWin, opts);
  return r.canceled ? null : r.filePaths;
};
const IMAGES = { name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] };

handle('import:metaExport', async (kind) => {
  const files = await pick(kind === 'folder'
    ? { title: 'Carpeta descomprimida de Meta', properties: ['openDirectory'] }
    : { title: 'ZIP de «Descargar tu información»', filters: [{ name: 'ZIP', extensions: ['zip'] }], properties: ['openFile'] });
  return files ? importers.importMetaExport(files[0]) : null;
});
handle('import:pickImages', (withVideo) => pick({
  title: 'Elige las imágenes', properties: ['openFile', 'multiSelections'],
  filters: withVideo ? [{ name: 'Fotos y vídeos', extensions: [...IMAGES.extensions, 'mp4', 'mov'] }] : [IMAGES],
}));
handle('import:screenshots', (paths) => importers.importScreenshots(paths, cfg.anthropicKey));
handle('import:manual', (data) => importers.manualPost(data));

// d.keys: claves de las publicaciones de origen, para marcarlas como «ya en el blog»
handle('draft:publish', async (d) => {
  const post = await wpCall(() => wp.createPost(cfg, {
    title: d.title, content: d.content, status: d.status || 'draft',
    tags: d.tags.join(','), categories: d.categories.join(','),
    ...(d.featuredImageId ? { featured_image: d.featuredImageId } : {}),
    ...(d.keepDate ? { date: d.date } : {}),
  }));
  const editUrl = `https://wordpress.com/post/${cfg.wpSite}/${post.ID}`;
  cfg.exported = cfg.exported || {};
  for (const k of d.keys || []) cfg.exported[k] = { postId: post.ID, url: post.URL, editUrl, title: d.title, status: post.status, at: new Date().toISOString() };
  store.save(cfg);
  return { url: post.URL, editUrl, exported: cfg.exported };
});
handle('posts:merge', (list) => mergeDuplicates(list));
handle('exported:forget', (keys) => { for (const k of keys) delete cfg.exported?.[k]; store.save(cfg); return cfg.exported || {}; });

// --- Pestaña «Blog»: gestión de entradas y páginas ---
handle('blog:list', (opts) => wpCall(() => wp.listPosts(cfg, opts)));
handle('blog:setStatus', (id, status) => wpCall(() => wp.setPostStatus(cfg, id, status)));
handle('blog:trash', (id) => wpCall(() => wp.trashPost(cfg, id)));
handle('blog:editUrl', (id, type) => `https://wordpress.com/${type === 'page' ? 'page' : 'post'}/${cfg.wpSite}/${id}`);

// --- Modo de arranque ---
handle('mode:tryNormal', () => {
  saveMode(0);
  log('El usuario pide probar el modo normal; reiniciando');
  app.relaunch(); app.exit(0);
});

handle('open', (url) => shell.openExternal(url));

handle('update:status', () => updater.current());
handle('update:check', () => { updater.check(); return updater.current(); });
handle('update:install', () => updater.install());

app.whenReady().then(() => {
  if (!gotLock || !updater) return; // otra copia abierta, o fallo al cargar módulos (ya avisado)
  log(`Arrancando Ecos ${app.getVersion()} (${process.platform} ${process.arch}, Electron ${process.versions.electron}, modo ${mode}: ${MODES[mode].name})`);
  cfg = { wpSite: 'asociacionelin.com', graphVersion: 'v23.0', ...store.load() };
  createWindow();
  mainWin.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') escalate(`la ventana se ha cerrado (${d.reason}, código ${d.exitCode})`); });
  // Si la ventana no termina de cargar en 20 s (pantalla en blanco), también se pasa al modo compatible
  const loadTimer = setTimeout(() => escalate('la ventana no ha cargado en 20 segundos'), 20000);
  mainWin.webContents.once('did-finish-load', () => {
    clearTimeout(loadTimer);
    log('Ventana cargada');
    try { fs.unlinkSync(pendingFile()); } catch { /* nada */ }
    // Solo para pruebas: ECOS_PRUEBA_FALLO=GPU|Tab simula que se cae ese proceso
    if (process.env.ECOS_PRUEBA_FALLO) {
      const victim = app.getAppMetrics().find((m) => m.type === process.env.ECOS_PRUEBA_FALLO);
      if (victim) process.kill(victim.pid);
    }
    updater.init((st) => {
      if (st.state === 'error') log('Actualizador:', st.message);
      if (!mainWin.isDestroyed()) mainWin.webContents.send('update:status', { version: app.getVersion(), ...st });
    });
  });
}).catch(fatal);
app.on('window-all-closed', () => app.quit());
