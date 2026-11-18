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

// --- Modo gráfico a prueba de fallos ---------------------------------------------
// En algunos equipos el proceso gráfico de Chromium no arranca (p. ej. «DLL no encontrada»
// dentro de su sandbox) y la app se cierra al instante. Ecos no necesita aceleración gráfica:
// se desactiva siempre y, si aun así el proceso gráfico falla, se reinicia en un modo más
// compatible y lo recuerda para la próxima vez.
const GPU_MODES = [
  { name: 'sin aceleración', switches: [] },
  { name: 'sin aceleración ni sandbox gráfico', switches: ['disable-gpu-sandbox'] },
  { name: 'gráficos dentro del proceso principal', switches: ['disable-gpu-sandbox', 'in-process-gpu'] },
  { name: 'sin sandbox', switches: ['disable-gpu-sandbox', 'no-sandbox'] },
];
const gpuModeFile = () => path.join(app.getPath('userData'), 'modo-grafico.json');
let gpuMode = 0;
try { gpuMode = Math.min(GPU_MODES.length - 1, JSON.parse(fs.readFileSync(gpuModeFile(), 'utf8')).nivel || 0); } catch { /* primera vez */ }
// Si el arranque anterior no llegó a mostrar la ventana (la app entera se cerró), sube de nivel
const pendingFile = () => path.join(app.getPath('userData'), 'arranque-pendiente');
const saveGpuMode = (n) => { try { fs.writeFileSync(gpuModeFile(), JSON.stringify({ nivel: n, fecha: new Date().toISOString() })); } catch { /* nada */ } };
if (gotLock && fs.existsSync(pendingFile()) && gpuMode < GPU_MODES.length - 1) {
  gpuMode += 1;
  saveGpuMode(gpuMode);
  log(`El arranque anterior no llegó a abrir la ventana; se usa el modo ${gpuMode}: ${GPU_MODES[gpuMode].name}`);
}
if (gotLock) { try { fs.mkdirSync(path.dirname(pendingFile()), { recursive: true }); fs.writeFileSync(pendingFile(), new Date().toISOString()); } catch { /* nada */ } }
app.disableHardwareAcceleration();
for (const sw of GPU_MODES[gpuMode].switches) app.commandLine.appendSwitch(sw);

let relaunching = false;
app.on('child-process-gone', (_e, d) => {
  if (d.type !== 'GPU' || relaunching) return;
  log(`El proceso gráfico ha fallado (modo ${gpuMode}: ${GPU_MODES[gpuMode].name}; motivo ${d.reason}, código ${d.exitCode})`);
  if (gpuMode >= GPU_MODES.length - 1) return; // ya en el modo más compatible
  relaunching = true;
  saveGpuMode(gpuMode + 1);
  try { fs.unlinkSync(pendingFile()); } catch { /* nada */ } // ya se ha subido de nivel; no subir dos veces
  log(`Reiniciando en modo ${gpuMode + 1}: ${GPU_MODES[gpuMode + 1].name}`);
  app.relaunch();
  app.exit(0);
});

let store, meta, wp, buildDraft, mediaKey, importers, updater;
try {
  store = require('./src/store');
  meta = require('./src/meta');
  wp = require('./src/wpcom');
  ({ buildDraft, mediaKey } = require('./src/transform'));
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
  metaRedirectUri: meta.REDIRECT, wpRedirectUri: wp.REDIRECT,
});

// Envuelve los manejadores para devolver errores legibles al renderer
const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
});

handle('config:get', () => publicCfg());
handle('config:set', (changes) => {
  for (const [k, v] of Object.entries(changes)) {
    if (v === '••••••') continue; // secreto sin cambios
    cfg[k] = v;
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
handle('meta:posts', async (pageId, sources) => {
  const acc = accounts.find((a) => a.pageId === pageId);
  if (!acc) throw new Error('Página no encontrada; vuelve a conectar con Meta');
  const lists = await Promise.all([
    sources.includes('facebook') ? meta.facebookPosts(cfg, acc) : [],
    sources.includes('instagram') ? meta.instagramPosts(cfg, acc) : [],
  ]);
  return lists.flat().sort((a, b) => new Date(b.date) - new Date(a.date));
});

handle('wp:login', async () => {
  cfg.wpToken = await wp.login(cfg);
  store.save(cfg);
  return (await wp.siteInfo(cfg)).name;
});
handle('wp:categories', () => wp.categories(cfg));

// Sube los medios (remotos o locales) y genera el borrador para revisar
handle('draft:build', async (posts) => {
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
    } catch (e) { failed.push(e.message); }
  }
  return { ...buildDraft(posts, uploaded), failed };
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

handle('draft:publish', async (d) => {
  const post = await wp.createPost(cfg, {
    title: d.title, content: d.content, status: d.status || 'draft',
    tags: d.tags.join(','), categories: d.categories.join(','),
    ...(d.featuredImageId ? { featured_image: d.featuredImageId } : {}),
    ...(d.keepDate ? { date: d.date } : {}),
  });
  return { url: post.URL, editUrl: `https://wordpress.com/post/${cfg.wpSite}/${post.ID}` };
});

handle('open', (url) => shell.openExternal(url));

handle('update:status', () => updater.current());
handle('update:check', () => { updater.check(); return updater.current(); });
handle('update:install', () => updater.install());

app.whenReady().then(() => {
  if (!gotLock || !updater) return; // otra copia abierta, o fallo al cargar módulos (ya avisado)
  log(`Arrancando Ecos ${app.getVersion()} (${process.platform} ${process.arch}, Electron ${process.versions.electron}, modo gráfico ${gpuMode}: ${GPU_MODES[gpuMode].name})`);
  cfg = { wpSite: 'asociacionelin.com', graphVersion: 'v23.0', ...store.load() };
  createWindow();
  mainWin.webContents.on('render-process-gone', (_e, d) => log('La ventana se ha cerrado inesperadamente:', d.reason));
  mainWin.webContents.once('did-finish-load', () => {
    log('Ventana cargada');
    try { fs.unlinkSync(pendingFile()); } catch { /* nada */ }
    if (process.env.ECOS_PRUEBA_FALLO_GPU) {
      const gpu = app.getAppMetrics().find((m) => m.type === 'GPU');
      if (gpu) process.kill(gpu.pid);
    }
    updater.init((st) => {
      if (st.state === 'error') log('Actualizador:', st.message);
      if (!mainWin.isDestroyed()) mainWin.webContents.send('update:status', { version: app.getVersion(), ...st });
    });
  });
}).catch(fatal);
app.on('window-all-closed', () => app.quit());
