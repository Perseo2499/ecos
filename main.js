const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Versión de desarrollo («npm start» desde el código): datos aparte para poder abrirla junto a la
// instalada (si compartieran carpeta, el bloqueo de una sola copia la cerraría). La primera vez se
// copia la configuración de la instalada para no tener que volver a conectar nada.
const IS_DEV = !app.isPackaged;
if (IS_DEV) {
  const appData = app.getPath('appData');
  const devData = path.join(appData, 'Ecos-dev');
  try {
    if (!fs.existsSync(path.join(devData, 'config.json'))) {
      const installed = ['Ecos', 'ecos'].map((n) => path.join(appData, n, 'config.json')).find((f) => fs.existsSync(f));
      if (installed) { fs.mkdirSync(devData, { recursive: true }); fs.copyFileSync(installed, path.join(devData, 'config.json')); }
    }
  } catch { /* sin configuración previa */ }
  app.setPath('userData', devData);
}

// Registro de errores y avisos en userData/logs/ecos.log (rotación a 1 MB con copia .1; sin tokens ni contraseñas: src/logger.js)
// y aviso visible si algo falla al arrancar
const logFile = () => path.join(app.getPath('userData'), 'logs', 'ecos.log');
let _logger = null;
const logger = () => _logger || (_logger = require('./src/logger').createLogger({ file: logFile() }));
function log(...args) { try { logger().warn(...args); } catch { /* sin registro */ } }
function logError(...args) { try { logger().error(...args); } catch { /* sin registro */ } }
// Modo seguro: userData/startup.json {pending, failures, version} (src/startup.js)
const startupFile = () => path.join(app.getPath('userData'), 'startup.json');
let startupState = null;
const readStartup = () => { try { return JSON.parse(fs.readFileSync(startupFile(), 'utf8')); } catch { return null; } };
const saveStartup = (s) => { startupState = s; try { fs.mkdirSync(path.dirname(startupFile()), { recursive: true }); fs.writeFileSync(startupFile(), JSON.stringify(s)); } catch { /* nada */ } };
// Descarga el instalador publicado más reciente y lo ejecuta; si falla, abre la página de descargas
async function installPublished() {
  const RELEASES = 'https://github.com/Perseo2499/ecos/releases/latest';
  try {
    const file = await require('./src/startup').downloadInstaller(app.getPath('temp'));
    if (process.platform === 'win32') require('child_process').spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    else await shell.openPath(file);
    log('Reparación: instalador lanzado', file);
    return true;
  } catch (e) {
    logError('Reparación: no se pudo descargar el instalador', e);
    try { await shell.openExternal(RELEASES); } catch { /* nada */ }
    return false;
  }
}
let fataling = false;
function fatal(err) {
  if (fataling) return;
  fataling = true;
  logError('ERROR FATAL', err);
  try { const su = require('./src/startup'); saveStartup(su.fail(startupState || readStartup())); } catch { /* nada */ }
  const text = `${err && err.message ? err.message : err}\n\nDetalles en: ${logFile()}\nEnvía ese archivo para que lo revisen.`;
  try {
    const r = dialog.showMessageBoxSync({ type: 'error', title: 'Ecos no ha podido arrancar', message: 'Ecos no ha podido arrancar', detail: text, buttons: ['Cerrar', 'Descargar la versión buena'], defaultId: 0, cancelId: 0, noLink: true });
    if (r === 1) { installPublished().finally(() => app.exit(1)); return; }
  } catch {
    try { dialog.showErrorBox('Ecos no ha podido arrancar', text); } catch { /* nada */ }
  }
  app.exit(1);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', (e) => logError('Promesa rechazada sin gestionar', e));
// Errores de la ventana (window.onerror / unhandledrejection del renderer), reenviados por IPC
let rendererLogs = { at: 0, n: 0 };
ipcMain.on('log:renderer', (_e, info) => {
  try {
    const nowMs = Date.now(); // como mucho 100 por minuto (un bucle de errores no llena el disco)
    if (nowMs - rendererLogs.at > 60000) rendererLogs = { at: nowMs, n: 0 };
    if (++rendererLogs.n > 100) return;
    const i = info && typeof info === 'object' ? info : {};
    logError(`[ventana] ${String(i.kind || 'error').slice(0, 40)}:`, String(i.message || '').slice(0, 2000), i.source ? `(${String(i.source).slice(0, 200)}:${Number(i.line) || 0}:${Number(i.col) || 0})` : '', i.stack ? '\n' + String(i.stack).slice(0, 4000) : '');
  } catch { /* nada */ }
});

// Una sola copia abierta: si ya hay una, se trae al frente
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  });
}

if (gotLock) {
  try {
    const su = require('./src/startup');
    saveStartup(su.begin(readStartup(), app.getVersion()));
    // si en 60 s no llega la ventana principal, este arranque cuenta como fallido
    setTimeout(() => { if (startupState && startupState.pending) saveStartup(su.fail(startupState)); }, su.READY_TIMEOUT_MS).unref?.();
  } catch { /* nada */ }
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

let store, meta, wp, wpself, buildDraft, composeContent, composeBlocks, blockImages, mediaKey, DEFAULT_FOOTER, mergeDuplicates, importers, updater, ai;
try {
  store = require('./src/store');
  meta = require('./src/meta');
  wp = require('./src/wpcom');
  wpself = require('./src/wpself');
  ({ buildDraft, composeContent, composeBlocks, blockImages, mediaKey, DEFAULT_FOOTER, mergeDuplicates } = require('./src/transform'));
  ai = require('./src/ai');
  ai.setCliLog((...a) => log(...a));
  require('./src/imgopt').setEnabled(() => cfg?.prefs?.optimizePhotos !== false);
  require('./src/imgopt').setWebp(() => cfg?.prefs?.webpPhotos !== false);
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
    width: 1280, height: 860, // .ico: cada tamaño dibujado aparte
    icon: path.join(__dirname, 'renderer', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    title: IS_DEV ? 'Ecos (desarrollo)' : 'Ecos', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu(); // sin la barra File/Edit/View de Windows (los atajos de copiar y pegar siguen funcionando)
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { try { saveStartup(require('./src/startup').ready(startupState || readStartup())); } catch { /* nada */ } });
  if (IS_DEV) win.on('page-title-updated', (e) => e.preventDefault()); // que se note que es la versión de desarrollo
  win.webContents.setWindowOpenHandler(({ url }) => { openSafe(url); return { action: 'deny' }; });
  // la ventana de la app nunca navega a otra página (un enlace malicioso no puede sustituir la interfaz)
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openSafe(url); } });
  // Menú del botón derecho: cortar, copiar, pegar (también imágenes en el editor) y correcciones de ortografía.
  // En el texto del editor de entradas, además, las opciones de formato (como el menú de Word bajo su mini barra).
  let ctxMark = { kind: '', at: 0 };
  ipcMain.on('ctx:mark', (e, kind) => { ctxMark = { kind: String(kind || ''), at: Date.now() }; e.returnValue = true; });
  win.webContents.on('context-menu', (_e, params) => {
    const { Menu } = require('electron');
    const items = [];
    const inEditor = params.isEditable && Date.now() - ctxMark.at < 1500 ? ctxMark.kind : '';
    ctxMark = { kind: '', at: 0 };
    const cmd = (c) => () => { if (!win.isDestroyed()) win.webContents.send('ctx:cmd', c); };
    for (const w of (params.dictionarySuggestions || []).slice(0, 5)) items.push({ label: w, click: () => win.webContents.replaceMisspelling(w) });
    if (params.misspelledWord) items.push({ label: 'Añadir al diccionario', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' });
    const ed = params.isEditable, f = params.editFlags || {};
    if (ed) items.push({ label: 'Cortar', role: 'cut', enabled: f.canCut });
    if (ed || params.selectionText) items.push({ label: 'Copiar', role: 'copy', enabled: f.canCopy });
    if (ed) items.push({ label: 'Pegar', role: 'paste', enabled: f.canPaste }, { label: 'Pegar sin formato', role: 'pasteAndMatchStyle', enabled: f.canPaste });
    if (ed || params.selectionText) items.push({ type: 'separator' }, { label: 'Seleccionar todo', role: 'selectAll' });
    if (params.mediaType === 'image' && params.srcURL && /^https?:/.test(params.srcURL)) items.push({ type: 'separator' }, { label: 'Copiar imagen', click: () => win.webContents.copyImageAt(params.x, params.y) });
    if (inEditor) {
      const block = inEditor === 'text'; // párrafo, título, lista o cita (los demás textos no se convierten)
      items.push({ type: 'separator' },
        { label: 'Enlace…', accelerator: 'CmdOrCtrl+K', click: cmd('link') },
        { label: 'Quitar formato', click: cmd('clear') },
        { label: 'Alinear', submenu: [['Izquierda', 'left'], ['Centrado', 'center'], ['Derecha', 'right'], ['Justificado', 'justify']].map(([l, v]) => ({ label: l, click: cmd('align:' + v) })) });
      if (block) items.push({ label: 'Convertir en', submenu: [['Párrafo', 'paragraph'], ['Título', 'h2'], ['Subtítulo', 'h3'], ['Lista', 'ul'], ['Lista numerada', 'ol'], ['Cita', 'quote']].map(([l, v]) => ({ label: l, click: cmd('type:' + v) })) });
      items.push({ label: 'Color del texto…', click: cmd('color') }, { label: 'Resaltado…', click: cmd('bg') }, { type: 'separator' }, { label: 'Ayuda de la IA…', click: cmd('ai') });
    }
    while (items.length && items[items.length - 1].type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

const publicCfg = () => ({
  ...cfg,
  metaAppSecret: cfg.metaAppSecret ? '••••••' : '', wpClientSecret: cfg.wpClientSecret ? '••••••' : '',
  anthropicKey: cfg.anthropicKey ? '••••••' : '',
  gpClientSecret: cfg.gpClientSecret ? '••••••' : '', gpAccessToken: undefined, gpRefreshToken: undefined, gpConnected: !!cfg.gpRefreshToken, gpRedirectUri: 'http://localhost:53682/google',
  metaUserToken: undefined, wpToken: undefined, __totp: undefined, __recovery: undefined, vault: undefined, sentContent: undefined,
  lock: cfg.lock ? { auto: cfg.lock.auto ?? 15, twoFactor: !!cfg.__totp, recoveryLeft: (cfg.__recovery || []).length, hello: !!cfg.lock.hello } : null,
  metaConnected: !!cfg.metaUserToken, wpConnected: wpIsConnected(),
  wpMode: cfg.wpMode || 'wpcom', wpAppPassword: cfg.wpAppPassword ? '••••••' : '', wpSiteLabel: wpLabel(),
  metaRedirectUri: meta.REDIRECT, wpRedirectUri: wp.REDIRECT, wpBlogId: undefined,
  format: { cleanTitle: true, footer: DEFAULT_FOOTER, extraTags: '', categories: '', status: 'draft', mergeDuplicates: true, ...(cfg.format || {}) },
  exported: cfg.exported || {},
  templates: cfg.templates || [],
  metaTokenExpires: cfg.metaTokenExpires || null,
  lastSeenAt: cfg.lastSeenAt || null,
  lastSeenPostDate: cfg.lastSeenPostDate || null, // fecha de la última publicación de redes que se vio (aviso de nuevas)
  wizardDone: !!cfg.wizardDone || (!!cfg.metaUserToken && wpIsConnected()),
  ai: aiPublic(),
  aiConfigured: (() => { try { if (!ai) ai = require('./src/ai'); aiReady(); return true; } catch { return false; } })(),
  startMode: { level: mode, name: MODES[mode].name },
});

// Configuración de IA sin las claves (solo si están guardadas)
function aiPublic() {
  const provs = cfg.ai?.providers || {};
  return {
    configured: (() => { try { aiReady(); return true; } catch { return false; } })(),
    active: cfg.ai?.active || 'anthropic',
    providers: Object.fromEntries(Object.entries(ai.PROVIDERS).map(([id, d]) => [id, {
      name: d.name, label: d.label, keyUrl: d.keyUrl, needsKey: d.needsKey, defaultBase: d.base || '', defaultModel: d.defaultModel || '',
      hasKey: !!provs[id]?.key, url: provs[id]?.url || '', model: provs[id]?.model || '', tool: provs[id]?.tool || '', cli: !!d.cli,
    }])),
  };
}
function aiReady() {
  const id = cfg.ai?.active || 'anthropic';
  const d = ai.PROVIDERS[id], p = cfg.ai?.providers?.[id] || {};
  if (d.cli ? !p.tool : ((d.needsKey && !p.key) || !(p.model || d.defaultModel))) throw new Error('IA sin configurar');
}

// WordPress: «wpcom» (WordPress.com con OAuth) o «selfhosted» (web propia con wp-admin y contraseña de aplicación)
const isSelf = () => cfg.wpMode === 'selfhosted';
const WP = () => (isSelf() ? wpself : wp);
const wpIsConnected = () => (isSelf() ? !!cfg.wpAppPassword && !!cfg.wpSelfOk : !!cfg.wpToken);
const wpLabel = () => (isSelf() ? (cfg.wpUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '') : cfg.wpSite);
// Complemento de Ecos para WordPress: solo con «Mi web (wp-admin)». El estado se guarda en cfg.ecosHelper
const helperOn = () => isSelf() && !!cfg.ecosHelper?.installed;
async function refreshHelper(force = false) {
  if (!isSelf() || !cfg.wpUrl || !cfg.wpSelfOk) { if (cfg.ecosHelper) { cfg.ecosHelper = null; store.save(cfg); } return null; }
  try {
    const st = await wpself.helperStatus(cfg, { force });
    const prev = cfg.ecosHelper;
    cfg.ecosHelper = { installed: st.installed, version: st.version, outdated: st.outdated, caches: st.caches, bundled: st.bundled };
    if (!prev || JSON.stringify(prev) !== JSON.stringify(cfg.ecosHelper)) store.save(cfg);
  } catch { /* sin datos: se deja como estaba */ }
  return cfg.ecosHelper || null;
}
// Vacía la caché de la entrada con el complemento. Nunca falla: devuelve el aviso para el toast
async function purgeAfterSend(post) {
  if (!isSelf() || post.status !== 'publish') return '';
  if (!helperOn()) return 'Si no ves los cambios, vacía la caché de la página en tu web (o instala el Complemento de Ecos para que se haga solo).';
  try {
    const done = await wpself.helperPurge(cfg, post.ID);
    const named = done.filter((n) => n !== 'WordPress');
    return named.length ? 'Caché de la página vaciada (' + named.join(', ') + ')' : 'Caché de la página vaciada';
  } catch (e) { log('No se pudo vaciar la caché', e.message); return ''; }
}

// Envuelve llamadas a WordPress: si rechaza el permiso, se desconecta y se avisa
const wpCall = async (fn) => { try { return await fn(); } catch (e) { throw e instanceof wp.AuthError ? wpAuthFailed(e) : e; } };

// Copia local antes de cada envío (src/sendbackup.js): lo que hay ahora en WordPress y lo que se va a enviar.
// Nunca impide el envío: si algo falla, se anota en el registro y se sigue.
async function backupBeforeSend(d, fields) {
  if (!d.postId) return;
  const type = d.type === 'page' ? 'page' : 'post';
  let current = null, error = '';
  try { current = await WP().getPost(cfg, d.postId, type); } catch (e) { error = e.message; log('Copia antes de enviar: no se pudo leer la entrada', d.postId, e.message); }
  const name = require('./src/sendbackup').save(app.getPath('userData'), type, d.postId, { current, sending: fields, error });
  if (!name) log('Copia antes de enviar: no se pudo guardar', d.postId);
}

// Envuelve los manejadores para devolver errores legibles al renderer
// Con la app bloqueada solo responden estas peticiones (entrar y lo imprescindible para la pantalla de acceso)
const LOCK_OK = new Set(['lock:state', 'lock:unlock', 'lock:hello', 'lock:reset', 'app:info', 'update:status', 'update:check', 'update:install']);
const isLocked = () => !!cfg && store.isLocked(cfg);
const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
  if (isLocked() && !LOCK_OK.has(name)) return { ok: false, error: 'Ecos está bloqueada' };
  try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
});
// Complemento de Ecos para WordPress (después de definir handle: antes daba «Cannot access 'handle' before initialization» al arrancar)
handle('helper:check', async () => { await refreshHelper(true); return publicCfg(); });
// Varias personas: quién está conectado, bloqueo de edición (el estándar de WordPress) y fecha de modificación
handle('wp:me', async () => {
  if (!isSelf() || !wpIsConnected()) return null;
  const me = await wpCall(() => wpself.me(cfg));
  if (JSON.stringify(me) !== JSON.stringify(cfg.wpMe)) { cfg.wpMe = me; store.save(cfg); }
  return me;
});
// {supported:false} si no hay complemento (o es anterior a 1.2.0); si falla la red, no se bloquea nada
handle('postlock:acquire', async (id, force) => {
  if (!helperOn() || !id || !wpself.helperHasLock(cfg.ecosHelper.version)) return { supported: false };
  try { return await wpself.helperLock(cfg, id, { force: !!force }); } catch (e) { log('Bloqueo de edición:', e.message); return { supported: true, error: e.message }; }
});
handle('postlock:release', async (id) => {
  if (!helperOn() || !id) return false;
  try { return await wpself.helperUnlock(cfg, id); } catch { return false; }
});
handle('post:modified', (id, type) => (isSelf() ? wpCall(() => wpself.postModified(cfg, id, type)) : null));
handle('helper:stats', (days) => wpself.helperStats(cfg, days));
handle('helper:settings', () => wpself.helperSettings(cfg));
handle('helper:settingsSave', (s) => wpself.helperSaveSettings(cfg, s));
handle('helper:save', async () => {
  const r = await dialog.showSaveDialog(mainWin, { title: 'Guardar el Complemento de Ecos', defaultPath: path.join(app.getPath('downloads'), 'ecos-wordpress.zip'), filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  if (r.canceled || !r.filePath) return null;
  let src = app.isPackaged ? path.join(process.resourcesPath, 'ecos-wordpress.zip') : null;
  if (!src || !fs.existsSync(src)) src = require('./scripts/build-wp-plugin').build(path.join(app.getPath('temp'), 'ecos-wordpress.zip')).out;
  fs.copyFileSync(src, r.filePath);
  return r.filePath;
});

const PROTECTED_KEYS = new Set(['lock', 'vault', '__totp', '__recovery', 'metaUserToken', 'wpToken', 'gpAccessToken', 'gpRefreshToken', 'gpTokenExpires', 'sentContent', 'restored', 'exported', 'origUploads', 'mediaHashes']);
handle('config:get', () => publicCfg());
handle('config:set', (changes) => {
  // Si cambian los datos de la web propia, hay que volver a pulsar «Conectar»
  for (const k of ['wpMode', 'wpUrl', 'wpUser', 'wpAppPassword']) {
    if (k in changes && changes[k] !== '••••••' && String(changes[k] ?? '').trim() !== String(cfg[k] ?? '')) { cfg.wpSelfOk = false; delete cfg.wpMe; }
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === '••••••') continue; // secreto sin cambios
    if (PROTECTED_KEYS.has(k)) continue; // la contraseña, la bóveda y los tokens solo los cambia el proceso principal
    cfg[k] = typeof v === 'string' ? v.trim() : v; // sin espacios sobrantes al pegar claves
  }
  store.save(cfg);
  if ('prefs' in changes) updater?.setBeta(!!cfg.prefs?.betaChannel);
  return publicCfg();
});

handle('meta:login', async (opts) => {
  const r = await meta.login(cfg, opts || {});
  cfg.metaUserToken = r.token; cfg.metaTokenExpires = r.expiresAt;
  store.save(cfg);
  accounts = await meta.listAccounts(cfg);
  return accounts.map(({ pageToken, ...a }) => a);
});
handle('meta:accounts', async () => {
  accounts = await meta.listAccounts(cfg);
  return accounts.map(({ pageToken, ...a }) => a);
});
// Compartir una entrada publicada en una página de Facebook (necesita el permiso pages_manage_posts)
handle('meta:share', async ({ pageId, message, link, postId }) => {
  if (!accounts.length) accounts = await meta.listAccounts(cfg);
  const acc = accounts.find((a) => a.pageId === pageId);
  if (!acc) throw new Error('Página no encontrada; vuelve a conectar con Meta');
  const r = await meta.sharePost(cfg, acc, { message, link });
  log('Entrada compartida en Facebook', pageId, r.id);
  if (postId) {
    cfg.exported = cfg.exported || {};
    const recs = Object.values(cfg.exported).filter((e) => e.postId === postId);
    if (!recs.length) { cfg.exported['wp:' + postId] = { postId, url: link, title: '', status: 'publish', at: new Date().toISOString() }; recs.push(cfg.exported['wp:' + postId]); }
    for (const e of recs) e.sharedFb = { id: r.id, url: r.url, pageId, pageName: acc.pageName, at: new Date().toISOString() };
    store.save(cfg);
  }
  return { ...r, exported: cfg.exported || {} };
});
// cursors: undefined = primera página; { facebook, instagram } = «Cargar más» (null = esa red no tiene más)
// Recuento de Inicio: listado ligero de Instagram y Facebook a la vez (cursors null = primera página)
handle('meta:light', async (pageId, cursors) => {
  const acc = accounts.find((a) => a.pageId === pageId);
  if (!acc) throw new Error('Página no encontrada; vuelve a conectar con Meta');
  const none = { posts: [], next: null };
  const [fb, ig, igTotal] = await Promise.all([
    !cursors || cursors.facebook ? meta.lightPosts(cfg, acc, 'facebook', cursors?.facebook) : none,
    !cursors || cursors.instagram ? meta.lightPosts(cfg, acc, 'instagram', cursors?.instagram) : none,
    !cursors ? meta.instagramCount(cfg, acc).catch(() => null) : null,
  ]);
  return { posts: [...fb.posts, ...ig.posts], cursors: { facebook: fb.next, instagram: ig.next }, igTotal };
});
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
  if (isSelf()) {
    // Web propia: se comprueban el usuario y la contraseña de aplicación
    const r = await wpself.login(cfg);
    cfg.wpSelfOk = true; cfg.wpMe = r.me; store.save(cfg);
    log(`WordPress propio: conectado como ${r.userName} (${r.me?.role || '?'}) a ${r.siteName}`);
    await refreshHelper(true);
    return r.siteName;
  }
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
  if (isSelf()) cfg.wpSelfOk = false; else { cfg.wpToken = ''; cfg.wpBlogId = ''; }
  store.save(cfg);
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('config:changed', publicCfg());
  return new Error(`${err.message.replace(/^WordPress(\.com)?: /, 'WordPress: ')} — Revisa la conexión en «Conexiones» y pulsa «Conectar».`);
}
handle('wp:categories', async () => {
  try { return await WP().categories(cfg); } catch (e) { throw e instanceof wp.AuthError ? wpAuthFailed(e) : e; }
});

// Sube los medios (remotos o locales) y genera el borrador para revisar
handle('draft:unifyTitle', (posts) => require('./src/transform').unifyTitle(posts, publicCfg().format?.cleanTitle !== false));
// --- Vídeos y medios externos ---
// Los vídeos se descargan, se comprimen a 1080p si hace falta (ffmpeg), se les saca una portada y se suben a la biblioteca.
// Si no hay ffmpeg, se suben tal cual. Las imágenes de los CDN de Meta (caducan) se suben a la biblioteca una sola vez.
const vq = () => require('./src/videoq');
const VQ = () => require('./renderer/vidq');
const metaUrlCache = new Map(); // dirección de Meta → { id, url } en la biblioteca
async function uploadMetaUrl(url) {
  if (metaUrlCache.has(url)) return metaUrlCache.get(url);
  const up = (await wpCall(() => WP().uploadFromUrls(cfg, [url])))[0];
  if (!up?.url) throw new Error('No se pudo subir un medio externo');
  metaUrlCache.set(url, up);
  return up;
}
// Sube a la biblioteca lo que haya de los CDN de Meta dentro de unos bloques y lo sustituye en el sitio. Devuelve { map, failed }
async function externalizeMedia(root) {
  const map = {}; let failed = 0;
  for (const u of VQ().collectExpiring(root)) {
    try { map[u] = (await uploadMetaUrl(u)).url; } catch (e) { if (e instanceof wp.AuthError) throw e; failed++; log('Medio externo no subido', u.slice(0, 80), e.message); }
  }
  VQ().replaceUrls(root, map);
  return { map, failed };
}
async function downloadToFile(url, file) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar el vídeo (${res.status})`);
  await require('stream/promises').pipeline(require('stream').Readable.fromWeb(res.body), fs.createWriteStream(file));
}
// Procesa un vídeo del disco (comprimir + portada) y lo sube. Devuelve { id, url, poster?, width?, height? }
async function uploadVideoFile(file, { name, keepIfSmall = null } = {}) {
  const pr = await vq().processVideo(file, { name });
  try {
    let up = keepIfSmall && !pr.transcoded ? keepIfSmall : await wpCall(() => WP().uploadFile(cfg, pr.file));
    if (pr.transcoded) log('Vídeo comprimido a', pr.width + '×' + pr.height);
    const out = { id: up.id, url: up.url };
    if (pr.width && pr.height) { out.width = pr.width; out.height = pr.height; }
    if (pr.posterFile) {
      try {
        const base = path.basename(pr.file).replace(/\.[^.]+$/, '');
        const named = path.join(pr.dir, base + '-portada.jpg');
        fs.renameSync(pr.posterFile, named);
        out.poster = (await wpCall(() => WP().uploadFile(cfg, named))).url;
      } catch (e) { if (e instanceof wp.AuthError) throw e; log('Portada no subida:', e.message); }
    }
    return out;
  } finally { fs.rm(pr.dir, { recursive: true, force: true }, () => {}); }
}
// Un vídeo remoto (de Meta u otra dirección): se descarga y pasa por uploadVideoFile
async function uploadVideoFromUrl(url, opts = {}) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ecos-dl-'));
  try {
    let name = 'video.mp4';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || name; } catch { /* nombre por defecto */ }
    if (!/\.(mp4|mov|webm|m4v)$/i.test(name)) name = name.replace(/\.[^.]*$/, '') + '.mp4';
    const file = path.join(dir, name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80));
    await downloadToFile(url, file);
    return await uploadVideoFile(file, { name: file, ...opts });
  } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}
// Mejor versión de cada vídeo entre Instagram y Facebook (y el nodo de vídeo de Facebook); si algo falla, se deja como está
async function withBestVideos(post) {
  try {
    const acc = accounts.find((a) => a.pageToken);
    const extraUrls = async (m) => (acc ? vq().facebookNodeSource(m, { graph: `https://graph.facebook.com/${cfg.graphVersion || 'v23.0'}`, token: acc.pageToken }) : []);
    return await vq().bestVersionPost(post, { extraUrls });
  } catch (e) { log('Mejor versión de vídeo:', e.message); return post; }
}

handle('draft:build', async (posts, unify) => {
  if (!wpIsConnected()) throw new Error('Primero conecta tu WordPress en «Conexiones».');
  posts = await Promise.all(posts.map(withBestVideos));
  const items = new Map();
  for (const p of posts) for (const m of p.media) {
    if ((m.type === 'image' && (m.url || m.path)) || (m.type === 'video' && (m.path || m.videoUrl))) items.set(mediaKey(m), m);
  }
  const uploaded = new Map();
  const failed = [];
  const notes = [];
  for (const [key, m] of items) {
    // uno a uno, para que un fallo no tumbe el resto
    try {
      if (m.type === 'video') {
        const up = m.path ? await uploadVideoFile(m.path) : await uploadVideoFromUrl(m.videoUrl);
        // sin portada generada: la miniatura de la red social (caduca) se sube también a la biblioteca
        if (!up.poster && m.url && !m.path && VQ().isMetaCdn(m.url)) { try { up.poster = (await uploadMetaUrl(m.url)).url; } catch (e) { log('Portada externa no subida:', e.message); } }
        uploaded.set(key, up);
      } else {
        const src = m.path || m.url;
        uploaded.set(key, m.path ? await WP().uploadFile(cfg, src) : (await WP().uploadFromUrls(cfg, [src]))[0]);
      }
    } catch (e) {
      if (e instanceof wp.AuthError) throw wpAuthFailed(e); // no tiene sentido seguir con el resto
      // Un vídeo que no se puede subir (p. ej. el plan no admite vídeo) se inserta desde la red social
      if (m.type === 'video') { notes.push('video'); log('Vídeo no subido; se insertará el original:', e.message); } else failed.push(e.message);
    }
  }
  const draft = buildDraft(posts, uploaded, unify ? { ...publicCfg().format, unify } : publicCfg().format);
  await externalizeMedia(draft).catch((e) => { if (e instanceof wp.AuthError) throw wpAuthFailed(e); log('Medios externos:', e.message); });
  return { ...draft, failed, notes };
});
// Sube a la biblioteca los medios de Meta que quedan en los bloques del editor (botón de «Revisión»)
handle('media:externalize', async (blocks) => {
  const r = await externalizeMedia(blocks || []);
  return r;
});
// Sustituir un vídeo por el original: del ordenador (solo vídeos) o ya subido desde Google Fotos (se mide, comprime y saca portada)
handle('video:pickLocal', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Elige el vídeo original', properties: ['openFile'],
    filters: [{ name: 'Vídeos', extensions: ['mp4', 'mov', 'webm', 'm4v'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { ...(await uploadVideoFile(r.filePaths[0], { name: r.filePaths[0] })), type: 'video' };
});
handle('video:finish', async ({ url, id }) => {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Dirección de vídeo no válida');
  return { ...(await uploadVideoFromUrl(url, { keepIfSmall: { id, url } })), type: 'video' };
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
handle('import:metaPath', (p) => importers.importMetaExport(p)); // ZIP o carpeta soltados en la ventana
handle('import:pickImages', (withVideo) => pick({
  title: 'Elige las imágenes', properties: ['openFile', 'multiSelections'],
  filters: withVideo ? [{ name: 'Fotos y vídeos', extensions: [...IMAGES.extensions, 'mp4', 'mov'] }] : [IMAGES],
}));
handle('import:screenshots', (paths) => importers.importScreenshots(paths, cfg.ai));
handle('import:manual', (data) => importers.manualPost(data));

// d.keys: claves de las publicaciones de origen, para marcarlas como «ya en el blog»
// Dirección para editar una entrada con el editor elegido en Conexiones → WordPress
function editUrlFor(id, type = 'post') {
  const base = WP().publicBase(cfg) || `https://${cfg.wpSite}`;
  switch (cfg.wpEditor || (isSelf() ? 'wpadmin' : 'wpcom')) {
    case 'wpadmin': return `${base}/wp-admin/post.php?post=${id}&action=edit`;
    case 'elementor': return `${base}/wp-admin/post.php?post=${id}&action=elementor`;
    default: if (isSelf()) return `${base}/wp-admin/post.php?post=${id}&action=edit`;
      return `https://wordpress.com/${type === 'page' ? 'page' : 'post'}/${cfg.wpSite}/${id}`;
  }
}

// Campos comunes de una entrada a partir del borrador del editor
function postFields(d, status) {
  const scheduled = status === 'future' && d.scheduleAt;
  return {
    ...(d.type === 'page' ? { type: 'page', parent: Number(d.parent) || 0 } : {}),
    title: d.title, content: d.blocks ? composeBlocks(d.blocks, { spectra: isSelf(), helper: helperOn(), pageBg: d.pageBg || null }) : composeContent(d.sections), status: scheduled ? 'future' : status,
    tags: (d.tags || []).join(','), categories: (d.categories || []).join(','),
    excerpt: d.excerpt || '',
    ...(d.seoKey && isSelf() ? { seoKey: d.seoKey, seoDesc: d.seoDesc || '' } : {}),
    ...(d.slug ? { slug: d.slug } : {}),
    ...(d.featuredImageId ? { featured_image: d.featuredImageId } : {}),
    ...(scheduled ? { date: new Date(d.scheduleAt).toISOString() } : d.keepDate ? { date: d.date } : {}),
  };
}

// Vista previa real: guarda (o actualiza) la entrada como borrador y devuelve su dirección de vista previa
handle('draft:preview', async (d) => {
  await refreshHelper();
  const fields = postFields(d, 'draft');
  await backupBeforeSend(d, fields);
  const post = await wpCall(() => (d.postId ? WP().updatePost(cfg, d.postId, fields) : WP().createPost(cfg, fields)));
  const base = WP().publicBase(cfg) || `https://${cfg.wpSite}`;
  return { postId: post.ID, previewUrl: `${base}/?p=${post.ID}&preview=true` };
});
handle('draft:compose', (blocks) => composeBlocks(blocks));
handle('draft:peekCss', () => require('./src/transform').PEEK_CSS);
// Convierte los bloques de Spectra de una página en bloques editables de Ecos (lógica pura, sin tocar WordPress)
handle('spectra:convert', (blocks) => require('./src/spectra').convertSpectra(blocks));
// Autoguardado del borrador en curso (para recuperarlo si se cierra el editor o la app)
const autosaveFile = () => path.join(app.getPath('userData'), 'borrador-autoguardado.json');
handle('draft:autosave', (data) => { fs.writeFileSync(autosaveFile(), store.seal(cfg, { ...data, savedAt: new Date().toISOString() })); return true; });
handle('draft:autosaved', () => { try { return store.unseal(cfg, fs.readFileSync(autosaveFile(), 'utf8')); } catch { return null; } });
handle('draft:autosaveClear', () => { try { fs.unlinkSync(autosaveFile()); } catch { /* no había */ } return true; });
// Historial de versiones de una entrada (revisiones de WordPress), ya en bloques de Ecos
// Copias de Ecos antes de enviar (userData/send-backups): lista y carga en el editor (ya en bloques; no envía nada)
handle('sendbackup:list', (postId, type) => require('./src/sendbackup').list(app.getPath('userData'), type, postId));
handle('sendbackup:get', (postId, type, file) => {
  const rec = require('./src/sendbackup').read(app.getPath('userData'), type, postId, file);
  if (!rec.current) throw new Error('Esta copia no guardó lo que había en WordPress.');
  return { ...rec, current: { ...rec.current, blocks: require('./src/parseblocks').parseBlocks(rec.current.content) } };
});
handle('post:revisions', async (postId, type) => {
  if (!isSelf()) throw new Error('El historial de versiones solo está disponible con WordPress propio.');
  const { parseBlocks } = require('./src/parseblocks');
  const revs = await wpCall(() => WP().listRevisions(cfg, postId, type));
  return revs.map((r) => {
    const text = String(r.content || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
    return { ...r, blocks: parseBlocks(r.content), words: text.split(/\s+/).filter(Boolean).length };
  });
});
// Actualizar desde WordPress: estado, fechas, título, extracto, destacada y contenido (ya en bloques de Ecos)
handle('post:pull', async (id, type) => {
  const p = await wpCall(() => WP().getPost(cfg, id, type));
  const sent = cfg.sentContent?.[id];
  const norm = (s) => String(s || '').replace(/ecos-[cm]-[a-z0-9]+/g, '').replace(/\s+/g, ' ').trim();
  // estado al día en las publicaciones exportadas
  for (const e of Object.values(cfg.exported || {})) if (e.postId === id) e.status = p.status;
  store.save(cfg);
  return { ...p, contentChanged: sent !== undefined ? norm(sent) !== norm(p.content) : null, blocks: require('./src/parseblocks').parseBlocks(p.content), pageBg: require('./renderer/pagebg').parse(p.content), exported: cfg.exported };
});

// Bandeja del editor: subir fotos o vídeos del ordenador a la biblioteca de WordPress
// Imagen pegada (Ctrl+V o «Pegar»): llega como bytes y se sube a la biblioteca de medios
handle('media:uploadPasted', async ({ bytes, name, type }) => {
  const ext = (String(type).split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
  const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').slice(0, 60) || `pegada-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
  const tmp = path.join(app.getPath('temp'), `ecos-${Date.now()}-${base}.${ext}`);
  fs.writeFileSync(tmp, Buffer.from(bytes));
  try { const up = await wpCall(() => WP().uploadFile(cfg, tmp)); return { ...up, alt: '', type: 'image' }; }
  finally { fs.rm(tmp, { force: true }, () => {}); }
});
// Descarga una imagen de la web para recortarla en el editor (el lienzo no puede leer imágenes de otro dominio)
handle('media:fetchImage', async (url) => {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) throw new Error('Dirección de imagen no válida');
  const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('No se pudo descargar la imagen (' + r.status + ')');
  const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(png|jpe?g|webp|gif|avif|bmp)$/.test(type)) throw new Error('El enlace no es una imagen');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 40 * 1024 * 1024) throw new Error('La imagen es demasiado grande para recortarla');
  return { bytes: new Uint8Array(buf), type };
});
// ---- Google Fotos (Photos Picker API): conectar y elegir fotos para subirlas a la biblioteca ----
const gphotos = require('./src/gphotos').make({ save: () => store.save(cfg) });
let gpPick = null; // elección en curso: { cancelled }
const sendGpProgress = (p) => { try { mainWin?.webContents.send('gphotos:progress', p); } catch { /* ventana cerrada */ } };
handle('gphotos:login', async () => {
  const r = await gphotos.login(cfg);
  cfg.gpAccessToken = r.accessToken; cfg.gpRefreshToken = r.refreshToken; cfg.gpTokenExpires = r.expiresAt;
  store.save(cfg);
  return publicCfg();
});
// Credenciales: archivo JSON de Google Cloud (el que se elige o el que se ha encontrado y la persona ha aceptado)
let gpFound = [];
const gpApplyCredentials = (file) => {
  const c = require('./src/gphotos').parseCredentials(fs.readFileSync(file, 'utf8'));
  cfg.gpClientId = c.clientId; cfg.gpClientSecret = c.clientSecret;
  store.save(cfg);
  return publicCfg();
};
handle('gphotos:loadCredentials', async (file) => {
  if (file) { // solo un archivo que Ecos haya encontrado antes en sus carpetas
    if (!gpFound.includes(file)) throw new Error('Archivo no permitido');
    return gpApplyCredentials(file);
  }
  const r = await dialog.showOpenDialog(mainWin, { title: 'Credenciales de Google (client_secret….json)', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return gpApplyCredentials(r.filePaths[0]);
});
// Busca client_secret*.json solo en las carpetas de Ecos; devuelve la ruta
handle('gphotos:findCredentials', async () => {
  if (cfg.gpClientId && cfg.gpClientSecret) return null;
  const get = (n) => { try { return app.getPath(n); } catch { return ''; } };
  const docs = get('documents');
  const dirs = [app.getPath('userData'), path.dirname(process.execPath), docs && path.join(docs, 'Ecos'), get('downloads')].filter(Boolean);
  gpFound = require('./src/gphotos').findCredentialFiles(dirs);
  return gpFound[0] || null;
});
handle('gphotos:logout', () => { cfg.gpAccessToken = ''; cfg.gpRefreshToken = ''; cfg.gpTokenExpires = ''; store.save(cfg); return publicCfg(); });
handle('gphotos:cancel', () => { if (gpPick) { gpPick.cancelled = true; gpPick.decide?.(null); } return true; });
// Respuesta de la revisión en Ecos: ids de las fotos que se suben (null = cancelar)
handle('gphotos:confirm', (ids) => { if (!gpPick?.decide) return false; gpPick.decide(Array.isArray(ids) ? ids.map(String) : null); return true; });
function bringEcosToFront() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  if (process.platform === 'win32') { mainWin.setAlwaysOnTop(true); mainWin.focus(); setTimeout(() => { if (!mainWin.isDestroyed()) mainWin.setAlwaysOnTop(false); }, 300); }
  else { try { app.focus({ steal: true }); } catch { /* */ } mainWin.focus(); }
}
handle('gphotos:pick', async () => {
  if (!isSelf()) throw new Error('La biblioteca de medios solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.');
  if (!cfg.gpRefreshToken) throw new Error('Google Fotos no está conectado. Conéctalo en Conexiones → Google Fotos.');
  if (gpPick) throw new Error('Ya hay una selección de Google Fotos en marcha');
  const job = gpPick = { cancelled: false };
  let session = null;
  try {
    session = await gphotos.createSession(cfg);
    // /autoclose: Google cierra la pestaña sola al pulsar «Listo»
    await shell.openExternal(String(session.pickerUri).replace(/\/?$/, '') + '/autoclose');
    sendGpProgress({ phase: 'waiting' });
    await gphotos.pollSession(cfg, session, { isCancelled: () => job.cancelled });
    const all = await gphotos.listItems(cfg, session.id);
    bringEcosToFront();
    // Revisión en Ecos: miniaturas de lo elegido (de 6 en 6) y se espera a «Subir»
    const list = all.map((it) => ({ id: String(it.id), name: it.mediaFile?.filename || '', type: gphotos.kindOf(it), date: it.createTime || '', thumb: '' }));
    sendGpProgress({ phase: 'review', items: list });
    const decided = new Promise((resolve) => { job.decide = resolve; });
    (async () => {
      for (let k = 0; k < all.length && !job.cancelled && !job.chosen; k += 6) {
        await Promise.all(all.slice(k, k + 6).map(async (it, n) => {
          try { const th = await gphotos.thumb(cfg, it); if (th) sendGpProgress({ phase: 'thumb', id: list[k + n].id, thumb: th }); } catch { /* sin miniatura */ }
        }));
      }
    })();
    const ids = await decided;
    job.chosen = true;
    if (!ids || job.cancelled) return [];
    const keep = new Set(ids);
    const items = all.filter((it) => keep.has(String(it.id)));
    const out = [];
    let n = 0;
    for (const it of items) {
      if (job.cancelled) break;
      n++;
      sendGpProgress({ phase: 'uploading', done: n - 1, total: items.length, id: String(it.id) });
      try {
        const d = await gphotos.download(cfg, it);
        let up;
        if (isSelf()) {
          up = await wpCall(() => wpself.uploadNamed(cfg, d.buf, d.name, { keep: true }));
          if (d.date) await wpself.setMediaDate(cfg, up.id, new Date(d.date).toISOString()).catch(() => {});
        } else {
          up = await wpCall(() => WP().uploadNamed(cfg, d.buf, d.name, { keep: true }));
        }
        out.push({ id: up.id, url: up.url, type: d.type, alt: '' });
        sendGpProgress({ phase: 'item', id: String(it.id), ok: true, done: n, total: items.length });
      } catch (e) {
        log('Google Fotos', it.id, e.message);
        sendGpProgress({ phase: 'item', id: String(it.id), ok: false, done: n, total: items.length });
        if (/Vuelve a conectar/.test(e.message)) throw e;
      }
    }
    if (items.length && !out.length && !job.cancelled) throw new Error('No se ha podido subir ninguna foto de Google Fotos');
    mediaUsageCache = null;
    return out;
  } catch (e) {
    if (e.cancelled) return [];
    throw e;
  } finally {
    if (session) gphotos.deleteSession(cfg, session.id);
    gpPick = null;
  }
});

handle('media:upload', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Fotos y vídeos para la entrada', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Fotos y vídeos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm'] }],
  });
  if (r.canceled) return [];
  const out = [];
  for (const f of r.filePaths) {
    const isVid = /\.(mp4|mov|webm)$/i.test(f);
    const up = isVid ? await uploadVideoFile(f, { name: f }) : await wpCall(() => WP().uploadFile(cfg, f));
    out.push({ ...up, alt: '', type: isVid ? 'video' : 'image' });
  }
  return out;
});

// Estilos reales de la web (para que la vista previa se vea como en el blog). Se leen de la portada:
// hojas de estilo enlazadas y estilos en línea, con sus url() convertidas en absolutas. Caché de 1 hora.
let siteCss = { at: 0, base: '', css: '', bodyClass: '' };
handle('site:styles', async () => {
  const base = WP().publicBase(cfg);
  if (!base) return { css: '', bodyClass: '' };
  if (siteCss.base === base && Date.now() - siteCss.at < 3600e3) return siteCss;
  const html = await (await fetch(base + '/', { headers: { 'User-Agent': 'Mozilla/5.0 Ecos' } })).text();
  const abs = (u, from) => { try { return new URL(u, from).href; } catch { return u; } };
  const fixUrls = (css, from) => css.replace(/url\(\s*(['"]?)(?!data:|#)([^'")]+)\1\s*\)/g, (_m, q, u) => `url("${abs(u, from)}")`);
  const parts = [];
  const re = /<link\b[^>]*rel=["']?stylesheet["']?[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m, total = 0;
  while ((m = re.exec(html)) && total < 3e6) {
    if (m[0].startsWith('<style')) { parts.push(fixUrls(m[1], base + '/')); total += m[1].length; continue; }
    const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1];
    if (!href || /media=["']print["']/i.test(m[0])) continue;
    const url = abs(href.replace(/&#038;|&amp;/g, '&'), base + '/');
    try { const css = await (await fetch(url)).text(); parts.push(fixUrls(css, url)); total += css.length; } catch { /* hoja inaccesible */ }
  }
  const bodyClass = /<body\b[^>]*class=["']([^"']*)["']/i.exec(html)?.[1] || '';
  siteCss = { at: Date.now(), base, css: parts.join('\n'), bodyClass };
  return siteCss;
});

// d: { title, blocks, tags, categories, status ('draft'|'publish'|'future'), date, scheduleAt, excerpt,
//      featuredImageId, keepDate, keys }. El contenido se genera aquí a partir de las secciones del editor.
// La imagen destacada tiene que ser un medio de la biblioteca de WordPress. Las fotos de entradas antiguas o
// restauradas a veces solo tienen su dirección (o un número que ya no existe): se busca por la dirección y,
// si no está, se sube a la biblioteca.
async function resolveFeatured(d) {
  const id = d.featuredImageId;
  if (!id) return null;
  const url = d.featuredImageUrl || (/^https?:\/\//.test(String(id)) ? String(id) : '');
  const n = Number(id);
  if (Number.isInteger(n) && n > 0 && (!isSelf() || await WP().mediaExists(cfg, n))) return n;
  if (!url) { log('Imagen destacada sin dirección; se envía sin ella', id); return null; }
  try {
    const found = isSelf() ? await WP().findMediaByUrl(cfg, url).catch(() => null) : null;
    if (found) return found;
    const [m] = await wpCall(() => WP().uploadFromUrls(cfg, [url]));
    log('Imagen destacada subida a la biblioteca', m.id);
    return m.id;
  } catch (e) {
    log('No se pudo preparar la imagen destacada', url, e.message);
    sendToast('No se pudo usar la imagen destacada (' + e.message + '); la entrada se envía sin ella.', true);
    return null;
  }
}
async function doPublish(d) { require('./src/pagelinks').forget();
  // Texto alternativo: se guarda también en la biblioteca de medios
  for (const img of d.blocks ? blockImages(d.blocks) : d.sections.flatMap((x) => x.images)) {
    if (img.alt && Number(img.id) > 0) await wpCall(() => WP().updateMedia(cfg, img.id, { alt: img.alt })).catch((e) => log('No se pudo guardar el alt', img.id, e.message));
  }
  if (d.status === 'future' && (!d.scheduleAt || new Date(d.scheduleAt) <= new Date())) throw new Error('Elige una fecha y hora futuras para programar la entrada.');
  // Si ya se guardó como borrador para la vista previa, se actualiza esa misma entrada
  await externalizeMedia(d.blocks || d.sections || []).catch((e) => log('Medios externos al enviar:', e.message)); // los de Meta caducan
  d.featuredImageId = await resolveFeatured(d);
  await refreshHelper();
  const fields = postFields(d, d.status || 'draft');
  await backupBeforeSend(d, fields);
  // WordPress pone como «fecha de modificación» la de la entrada solo cuando se crea; cada vez que se
  // actualiza pasa a ser la de ese momento (y muchos temas muestran esa). Por eso el borrador que se guardó
  // para la vista previa se borra y la entrada se crea de nuevo, de una sola vez.
  let post;
  if (d.postId && d.recreate && WP().deletePost) {
    await wpCall(() => WP().deletePost(cfg, d.postId, d.type)).catch((e) => log('No se pudo borrar el borrador de la vista previa', d.postId, e.message));
    post = await wpCall(() => WP().createPost(cfg, fields));
  } else {
    post = await wpCall(() => (d.postId ? WP().updatePost(cfg, d.postId, fields) : WP().createPost(cfg, fields)));
  }
  cfg.sentContent = cfg.sentContent || {};
  cfg.sentContent[post.ID] = fields.content;
  const ids = Object.keys(cfg.sentContent); if (ids.length > 200) delete cfg.sentContent[ids[0]];
  const editUrl = editUrlFor(post.ID, d.type);
  const url = WP().publicUrl(cfg, post.URL);
  cfg.exported = cfg.exported || {};
  for (const k of d.keys || []) cfg.exported[k] = { postId: post.ID, url, editUrl, title: d.title, status: post.status, at: new Date().toISOString() };
  store.save(cfg);
  const cacheNote = await purgeAfterSend(post);
  return { postId: post.ID, url, editUrl, status: post.status, date: post.date, modified: post.modified || null, exported: cfg.exported, cacheNote };
}
// Si falla por red o servidor (5xx), el envío queda en cola (userData/send-queue.json) y se reintenta solo
handle('draft:publish', async (d) => {
  try { return await doPublish(d); } catch (e) {
    if (!require('./src/sendqueue').isNetworkError(e)) throw e;
    log('Envío en cola por falta de conexión:', e.message);
    queueAdd(d, e.message);
    return { queued: true, pending: sendQueue.length, exported: cfg.exported };
  }
});

// --- IA ---
const sendToast = (msg) => { try { mainWin?.webContents.send('toast', msg); } catch { /* ventana cerrada */ } };
handle('ai:article', async (input) => {
  const opts = { ...(input.opts || {}) };
  let sources = [];
  // primero, si se pide, buscar en internet (cada IA con su propia búsqueda web)
  if (opts.web && ai.isCli(cfg.ai)) {
    opts.searchNow = true; // la CLI busca y escribe en la misma llamada (más rápido)
    sendToast('Buscando en internet y escribiendo el artículo…');
  } else if (opts.web) {
    sendToast('Buscando información en internet…');
    const r = await ai.research(cfg.ai, { title: input.title, text: input.text });
    opts.research = r.notes; sources = r.sources;
    sendToast('Escribiendo el artículo…');
  }
  const art = await ai.improveArticle(cfg.ai, { ...input, opts, extra: cfg.aiInstructions || '' });
  const seen = new Set();
  const all = [...sources, ...(art.sources || [])].filter((x) => /^https?:\/\//.test(x.url || '') && !seen.has(x.url) && seen.add(x.url));
  return { ...art, sources: opts.web ? all.slice(0, 12) : [] };
});
// Importar en el editor una entrada/página exportada de WordPress (.xml) o un .html con bloques
handle('draft:importFile', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Importar una entrada o página exportada de WordPress', properties: ['openFile'],
    filters: [{ name: 'Exportación de WordPress o HTML', extensions: ['xml', 'html', 'htm', 'txt'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const text = require('fs').readFileSync(file, 'utf8');
  const list = require('./src/wpimport').parseImport(text, file);
  if (!list.length) throw new Error('El archivo no tiene ninguna entrada ni página que se pueda importar.');
  const { parseBlocks } = require('./src/parseblocks');
  return list.map((x) => ({ ...x, blocks: parseBlocks(x.content), pageBg: require('./renderer/pagebg').parse(x.content) }));
});
handle('ai:alts', (urls, context) => ai.altTexts(cfg.ai, urls, context));
handle('ai:alt', (url, context) => ai.altText(cfg.ai, url, context));
handle('ai:seo', (input) => ai.seoSuggest(cfg.ai, { ...input, extra: cfg.aiInstructions || '' }));
handle('wp:seoInfo', async () => (isSelf() ? WP().seoInfo(cfg) : { plugin: null, key: null, writable: false }));
handle('ai:rewrite', (input) => ai.rewrite(cfg.ai, { ...input, extra: cfg.aiInstructions || '' }));

// Selector de IA: cada proveedor guarda su clave, URL personalizada y modelo
const aiProv = (id) => { if (!ai.PROVIDERS[id]) throw new Error('Proveedor desconocido'); cfg.ai = cfg.ai || { providers: {} }; cfg.ai.providers = cfg.ai.providers || {}; return (cfg.ai.providers[id] = cfg.ai.providers[id] || {}); };
handle('ai:setActive', (id) => { aiProv(id); cfg.ai.active = id; store.save(cfg); return aiPublic(); });
handle('ai:save', (id, { key, url, model, tool }) => {
  const p = aiProv(id);
  if (tool !== undefined) p.tool = tool;
  if (key && key.trim()) p.key = key.trim();          // vacío = mantener la guardada
  if (url !== undefined) p.url = url.trim();
  if (model !== undefined) p.model = model.trim();
  store.save(cfg); return aiPublic();
});
handle('ai:remove', (id) => { delete aiProv(id).key; store.save(cfg); return aiPublic(); });
handle('ai:models', (id, draftKey, draftUrl) => {
  const p = aiProv(id);
  return ai.listModels(id, { key: (draftKey || '').trim() || p.key, url: draftUrl !== undefined ? draftUrl : p.url, tool: p.tool });
});
handle('ai:test', async () => { const c = await ai.testConnection(cfg.ai); return c.tool ? `${require('./src/clirun').TOOLS[c.tool].name}${c.model ? ' · ' + c.model : ''}` : `${ai.PROVIDERS[c.id].name} · ${c.model}`; });

// --- Copia de seguridad de la configuración ---
const BACKUP_KEYS = ['devDir', 'metaAppId', 'metaAppSecret', 'metaConfigId', 'graphVersion', 'wpMode', 'wpUrl', 'wpUser', 'wpAppPassword', 'wpSite', 'wpPublicUrl', 'wpEditor', 'wpClientId', 'wpClientSecret', 'gpClientId', 'gpClientSecret', 'ai', 'aiInstructions', 'format', 'templates', 'blockTemplates', 'blockSections', 'exported', 'prefs'];
handle('config:export', async (withSecrets) => {
  const r = await dialog.showSaveDialog(mainWin, { title: 'Guardar copia de la configuración', defaultPath: `ecos-configuracion-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return false;
  const out = { ecos: app.getVersion(), exportedAt: new Date().toISOString() };
  for (const k of BACKUP_KEYS) {
    if (!withSecrets && /Secret$|AppPassword$/.test(k)) continue;
    if (cfg[k] !== undefined) out[k] = JSON.parse(JSON.stringify(cfg[k]));
  }
  if (!withSecrets && out.ai?.providers) for (const p of Object.values(out.ai.providers)) delete p.key;
  fs.writeFileSync(r.filePath, JSON.stringify(out, null, 2));
  return r.filePath;
});
handle('config:import', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Abrir copia de la configuración', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  if (!data.ecos) throw new Error('Ese archivo no es una copia de configuración de Ecos');
  for (const k of BACKUP_KEYS) {
    if (data[k] === undefined) continue;
    if (k === 'ai') { // conservar las claves de IA que ya hubiera si la copia no las trae
      const old = cfg.ai?.providers || {};
      cfg.ai = { ...data.ai, providers: Object.fromEntries(Object.entries(data.ai.providers || {}).map(([id, p]) => [id, { ...p, key: p.key || old[id]?.key }])) };
    } else cfg[k] = data[k];
  }
  store.save(cfg);
  return publicCfg();
});

// Huellas (dHash) de fotos remotas, en memoria mientras Ecos está abierto
const postHashCache = new Map();
async function remoteHash(url) {
  if (postHashCache.has(url)) return postHashCache.get(url);
  const job = (async () => {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(url, { signal: ctl.signal }); clearTimeout(tm);
      if (!res.ok) return null;
      const img = require('electron').nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
      if (img.isEmpty()) return null;
      const D = require('./src/dupes');
      return D.dhash(D.grayFromBGRA(img.resize({ width: 9, height: 8, quality: 'good' }).toBitmap()));
    } catch { return null; }
  })();
  postHashCache.set(url, job);
  return job;
}
handle('posts:merge', async (list) => {
  const T = require('./src/transform');
  // primero por texto y fecha; las parejas que quedan sueltas se comparan también por la foto
  const first = mergeDuplicates(list);
  const loose = first.filter((p) => !(p.alsoOn || []).length);
  const cands = T.dupCandidates(loose);
  if (!cands.length) return first;
  const urls = [...new Set(cands.flat().map(T.firstImageUrl))];
  const hashes = new Map();
  for (let k = 0; k < urls.length; k += 8) {
    const got = await Promise.all(urls.slice(k, k + 8).map(remoteHash));
    got.forEach((h, n) => { if (h) hashes.set(urls[k + n], h); });
  }
  return hashes.size ? mergeDuplicates(list, { hashes }) : first;
});
handle('exported:forget', (keys) => { for (const k of keys) delete cfg.exported?.[k]; store.save(cfg); return cfg.exported || {}; });

// --- Pestaña «Blog»: gestión de entradas y páginas ---
handle('blog:list', (opts) => wpCall(() => WP().listPosts(cfg, opts)));
// Mantiene al día el estado guardado de las publicaciones exportadas que apuntan a esa entrada
function markExported(postId, status) {
  let changed = false;
  for (const rec of Object.values(cfg.exported || {})) if (rec.postId === postId && rec.status !== status) { rec.status = status; changed = true; }
  if (changed) store.save(cfg);
  return cfg.exported || {};
}
handle('blog:setStatus', async (id, status, type) => { require('./src/pagelinks').forget(); await wpCall(() => WP().setPostStatus(cfg, id, status, type)); return markExported(id, status); });
handle('blog:setDate', async (id, iso, status) => {
  if (!isSelf()) throw new Error('Cambiar la fecha desde el calendario solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.');
  const r = await wpCall(() => wpself.setPostDate(cfg, id, iso, status, 'post'));
  log('Fecha cambiada', id, r.date, r.status);
  markExported(id, r.status);
  return r;
});
handle('blog:trash', async (id, type) => { require('./src/pagelinks').forget(); await wpCall(() => WP().trashPost(cfg, id, type)); return markExported(id, 'trash'); });
// Estructura de la web (solo WordPress propio: WordPress.com no da acceso a menús ni ajustes por esta vía)
const needSelf = () => { if (!isSelf()) throw new Error('La estructura de la web solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.'); };
handle('site:pages', async () => { if (!isSelf()) throw new Error('La lista de páginas solo está disponible con «Mi web (wp-admin)».'); return wpCall(() => wpself.listPagesLite(cfg)); });
handle('blog:duplicate', async (id, type) => {
  if (!isSelf()) throw new Error('Duplicar solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.');
  const r = await wpCall(() => wpself.duplicatePost(cfg, id, type));
  log('Copia creada', id, '→', r.id, r.type);
  return r;
});
handle('site:structure', async () => { needSelf(); return wpCall(() => wpself.siteStructure(cfg)); });
handle('site:catPosts', async (catId) => { needSelf(); return wpCall(() => wpself.categoryPosts(cfg, catId)); });
handle('site:createPage', async (o) => { require('./src/pagelinks').forget(); needSelf(); return wpCall(() => wpself.createPage(cfg, o || {})); });
handle('site:createCategory', async (o) => { needSelf(); return wpCall(() => wpself.createCategory(cfg, o || {})); });
handle('site:trashPage', async (id) => { require('./src/pagelinks').forget(); needSelf(); return wpCall(() => wpself.trashPage(cfg, id)); });
handle('site:deleteCategory', async (id) => { needSelf(); return wpCall(() => wpself.deleteCategory(cfg, id)); });
handle('site:save', async (changes) => { require('./src/pagelinks').forget(); needSelf(); return wpCall(() => wpself.saveStructure(cfg, changes)); });
handle('site:pageLinks', async (id, type) => { needSelf(); return wpCall(() => require('./src/pagelinks').pageLinks(cfg, Number(id), type)); });
handle('site:buttonOp', async (id, type, op) => { needSelf(); return wpCall(() => require('./src/pagelinks').buttonOp(cfg, Number(id), type, op || {})); });
// Biblioteca de medios (solo WordPress propio)
const needSelfMedia = () => { if (!isSelf()) throw new Error('La biblioteca de medios solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.'); };
let mediaUsageCache = null; // { at, data }
// Biblioteca entera guardada en el ordenador: se enseña al momento y luego solo se piden los cambios
const mediaCacheFile = () => path.join(app.getPath('userData'), 'media-cache.json');
let mediaPool = null; // { site, at, syncedAt, items }
function readMediaCache() {
  if (mediaPool) return mediaPool;
  try { const c = JSON.parse(fs.readFileSync(mediaCacheFile(), 'utf8')); if (c.site === cfg.wpUrl) mediaPool = c; } catch { /* sin copia */ }
  return mediaPool;
}
function saveMediaCache() { try { fs.writeFileSync(mediaCacheFile(), JSON.stringify(mediaPool)); } catch (e) { log('Copia de la biblioteca', e.message); } }
async function fullMediaList() {
  const items = [];
  const first = await wpCall(() => wpself.listMedia(cfg, { page: 1, perPage: 100, type: 'all' }));
  items.push(...first.items);
  const total = first.totalPages || 1;
  let next = 2, done = 1;
  const work = async () => {
    while (next <= total) {
      const p = next++;
      const r = await wpCall(() => wpself.listMedia(cfg, { page: p, perPage: 100, type: 'all' })).catch(() => ({ items: [] }));
      items.push(...r.items);
      if (++done % 5 === 0) sendToast(`Leyendo la biblioteca: ${Math.min(done * 100, first.total)} de ${first.total}…`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, Math.max(0, total - 1)) }, work));
  return items;
}
// force: volver a leerla entera (borrados incluidos). Si no, la copia guardada + lo nuevo o cambiado.
async function mediaAll(force) {
  const now = new Date().toISOString();
  const c = readMediaCache();
  if (!force && c?.items?.length) {
    if (Date.now() - new Date(c.syncedAt).getTime() > 60000) {
      try {
        const fresh = [];
        for (let page = 1; page <= 20; page++) {
          const r = await wpCall(() => wpself.listMedia(cfg, { page, perPage: 100, type: 'all', modifiedAfter: new Date(new Date(c.syncedAt).getTime() - 120000).toISOString() }));
          fresh.push(...r.items);
          if (page >= (r.totalPages || 1)) break;
        }
        if (fresh.length) { const ids = new Set(fresh.map((m) => m.id)); c.items = [...fresh, ...c.items.filter((m) => !ids.has(m.id))]; }
        c.syncedAt = now; saveMediaCache();
      } catch (e) { log('Cambios de la biblioteca', e.message); }
    }
    return c.items;
  }
  const items = await fullMediaList();
  mediaPool = { site: cfg.wpUrl, at: now, syncedAt: now, items };
  saveMediaCache();
  return items;
}
handle('media:all', async (force) => { needSelfMedia(); return mediaAll(!!force); });
handle('media:list', async (opts) => { needSelfMedia(); return wpCall(() => wpself.listMedia(cfg, opts || {})); });
// Fecha de captura guardada dentro de las fotos (EXIF): se leen solo los primeros KB de cada una
handle('media:exifDates', async (items) => {
  needSelfMedia();
  const { exifDate } = require('./src/photodate');
  const out = {};
  let next = 0;
  const work = async () => {
    while (next < (items || []).length) {
      const m = items[next++];
      if (!/\.(jpe?g|webp)(\?|$)/i.test(m.url || '')) continue; // las WebP de Ecos llevan la fecha de captura en su EXIF
      try {
        const r = await fetch(m.url, { headers: { Range: 'bytes=0-131071' }, signal: AbortSignal.timeout(20000) });
        const reader = r.body?.getReader?.();
        let buf;
        if (reader) { // por si el servidor no admite «Range»: no se descarga más de lo necesario
          const parts = []; let size = 0;
          while (size < 131072) { const { value, done } = await reader.read(); if (done) break; parts.push(value); size += value.length; }
          try { await reader.cancel(); } catch { /* ya está */ }
          buf = Buffer.concat(parts.map((x) => Buffer.from(x)));
        } else buf = Buffer.from(await r.arrayBuffer());
        const d = exifDate(buf);
        if (d) out[m.id] = d;
      } catch (e) { log('Fecha EXIF', m.id, e.message); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, work));
  return out;
});
handle('media:setDates', async (list) => {
  needSelfMedia();
  let done = 0, failed = 0;
  for (const x of list || []) { try { await wpCall(() => wpself.setMediaDate(cfg, x.id, x.date)); done++; } catch (e) { failed++; log('Fecha de medio', x.id, e.message); } }
  mediaUsageCache = null;
  if (mediaPool) { const m = new Map((list || []).map((x) => [x.id, x.date])); for (const it of mediaPool.items) if (m.has(it.id)) it.date = String(m.get(it.id)).slice(0, 19); saveMediaCache(); }
  return { done, failed };
});
handle('media:usage', async (force) => {
  needSelfMedia();
  if (!force && mediaUsageCache && Date.now() - mediaUsageCache.at < 5 * 60000) return mediaUsageCache.data;
  const pool = await mediaAll(false);
  const data = await wpCall(() => wpself.mediaUsage(cfg, pool.map((m) => ({ id: m.id, source_url: m.url }))));
  mediaUsageCache = { at: Date.now(), data };
  return data;
});
handle('media:delete', async (ids) => {
  needSelfMedia();
  const done = [], failed = [];
  for (const id of ids || []) {
    try { await wpCall(() => wpself.deleteMedia(cfg, id)); done.push(id); } catch (e) { log('No se pudo borrar el medio', id, e.message); failed.push({ id, error: e.message }); }
  }
  mediaUsageCache = null;
  return { done, failed };
});
handle('media:alt', async (id, alt) => { needSelfMedia(); await wpCall(() => wpself.updateMedia(cfg, id, { alt: String(alt || '') })); return true; });
// Mejorar fotos con IA (Real-ESRGAN en este ordenador; src/upscale.js)
const upscaleJobs = new Map(); // token → { file, type, id }
const sendUpscale = (p) => { try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('upscale:progress', p); } catch { /* ventana cerrada */ } };
const smallPreview = (buf) => {
  const { nativeImage } = require('electron');
  let img = nativeImage.createFromBuffer(buf);
  const { width, height } = img.getSize();
  if (Math.max(width, height) > 1400) img = img.resize(width >= height ? { width: 1400, quality: 'best' } : { height: 1400, quality: 'best' });
  return 'data:image/jpeg;base64,' + img.toJPEG(85).toString('base64');
};
handle('media:upscale', async (id) => {
  needSelfMedia();
  const up = require('./src/upscale');
  const m = await wpCall(() => wpself.getMedia(cfg, id));
  if (!m?.source_url) throw new Error('No se encuentra la foto en la biblioteca.');
  sendUpscale({ text: 'Preparando la foto…' });
  const res = await fetch(m.source_url);
  if (!res.ok) throw new Error(`No se pudo descargar la foto original (error ${res.status}).`);
  const orig = Buffer.from(await res.arrayBuffer());
  const r = await up.upscale(orig, { onProgress: sendUpscale });
  const token = crypto.randomBytes(8).toString('hex');
  const file = path.join(require('os').tmpdir(), `ecos-mejorada-${token}${r.type === 'image/png' ? '.png' : '.jpg'}`);
  fs.writeFileSync(file, r.buf);
  upscaleJobs.set(token, { file, type: r.type, id });
  const before = require('electron').nativeImage.createFromBuffer(orig).getSize();
  return {
    token, before: smallPreview(orig), after: smallPreview(r.buf),
    from: { width: before.width, height: before.height }, to: { width: r.width, height: r.height }, bytes: r.buf.length,
  };
});
// Cambia un medio por otro en todas las entradas y páginas que lo usan (foto, sus tamaños, número e imagen
// destacada). old: el medio de WordPress (con source_url y media_details); neu: { id, url }. Devuelve cuántas cambió.
async function swapMediaEverywhere(old, neu, usage) {
  const { swapMediaInHtml } = require('./src/upscale');
  const oldUrls = [old.source_url, ...Object.values(old.media_details?.sizes || {}).map((s) => s.source_url)].filter(Boolean);
  const used = usage || await wpCall(() => wpself.mediaUsage(cfg));
  const ids = (used[old.id] || []).map((u) => u.id);
  let posts = 0;
  if (!ids.length) return 0;
  for (const type of ['post', 'page']) {
    for (const p of await wpCall(() => wpself.allRaw(cfg, type, ids))) {
      const html = p.content?.raw ?? '';
      const next = swapMediaInHtml(html, { oldUrls, newUrl: neu.url, oldId: old.id, newId: neu.id });
      const fields = {};
      if (next !== html) fields.content = next;
      if (Number(p.featured_media) === Number(old.id)) fields.featured_media = neu.id;
      if (!Object.keys(fields).length) continue;
      await wpCall(() => wpself.updateFields(cfg, p.id, fields, type));
      posts++;
    }
  }
  return posts;
}
// Fotos repetidas: huella de cada foto (de su versión pequeña) y grupos de iguales
handle('media:duplicates', async () => {
  needSelfMedia();
  const D = require('./src/dupes');
  const { nativeImage } = require('electron');
  cfg.mediaHashes = cfg.mediaHashes || {};
  const all = (await mediaAll(false)).filter((m) => m.type === 'image');
  let done = 0, next = 0;
  const work = async () => {
    while (next < all.length) {
      const m = all[next++];
      const key = `${m.id}:${m.url}`;
      if (!cfg.mediaHashes[key]) {
        try {
          const r = await fetch(m.tiny || m.thumb || m.url, { signal: AbortSignal.timeout(20000) });
          const img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
          if (!img.isEmpty()) cfg.mediaHashes[key] = D.dhash(D.grayFromBGRA(img.resize({ width: 9, height: 8, quality: 'good' }).toBitmap()));
        } catch (e) { log('Huella de foto', m.id, e.message); }
      }
      m.hash = cfg.mediaHashes[key];
      if (++done % 100 === 0) { sendToast(`Buscando fotos repetidas: ${done} de ${all.length}…`); store.save(cfg); }
    }
  };
  await Promise.all(Array.from({ length: 12 }, work));
  store.save(cfg);
  const groups = D.groupDuplicates(all);
  const byId = new Map(all.map((m) => [m.id, m]));
  return groups.map((g) => ({ keep: byId.get(g.keep), drop: g.drop.map((id) => byId.get(id)) }));
});
// Juntar repetidas: las entradas pasan a usar la de mejor calidad y las demás se borran de la biblioteca
handle('media:mergeDuplicates', async (groups) => {
  needSelfMedia();
  const usage = await wpCall(() => wpself.mediaUsage(cfg));
  let posts = 0, deleted = 0; const errors = [];
  for (const g of groups || []) {
    const keep = await wpCall(() => wpself.getMedia(cfg, g.keep)).catch(() => null);
    if (!keep) { errors.push(`${g.keep}: no se encuentra`); continue; }
    for (const id of g.drop) {
      try {
        const old = await wpCall(() => wpself.getMedia(cfg, id));
        posts += await swapMediaEverywhere(old, { id: keep.id, url: keep.source_url }, usage);
        await wpCall(() => wpself.deleteMedia(cfg, id));
        deleted++;
      } catch (e) { errors.push(`${id}: ${e.message}`); log('Juntar repetidas', id, e.message); }
    }
  }
  mediaUsageCache = null;
  if (mediaPool && deleted) { const gone = new Set((groups || []).flatMap((g) => g.drop)); mediaPool.items = mediaPool.items.filter((m) => !gone.has(m.id)); saveMediaCache(); }
  return { posts, deleted, errors };
});
handle('media:upscaleApply', async ({ id, token }) => {
  needSelfMedia();
  const job = upscaleJobs.get(token);
  if (!job || !fs.existsSync(job.file)) throw new Error('La foto mejorada ya no está disponible. Vuelve a mejorarla.');
  const old = await wpCall(() => wpself.getMedia(cfg, id));
  const ext = job.type === 'image/png' ? 'png' : 'jpg';
  const base = decodeURIComponent(path.basename(old.source_url.split(/[?#]/)[0])).replace(/\.[^.]+$/, '') || 'foto';
  const up = await wpCall(() => wpself.uploadNamed(cfg, fs.readFileSync(job.file), `${base}-mejorada.${ext}`, { keep: true }));
  if (old.alt_text) { try { await wpCall(() => wpself.updateMedia(cfg, up.id, { alt: old.alt_text })); } catch (e) { log('No se pudo copiar el texto alternativo', e.message); } }
  const posts = await swapMediaEverywhere(old, { id: up.id, url: up.url });
  mediaUsageCache = null;
  try { fs.rmSync(job.file, { force: true }); } catch { /* nada */ }
  upscaleJobs.delete(token);
  return { newId: up.id, url: up.url, posts };
});
handle('media:upscaleDiscard', (token) => {
  const job = upscaleJobs.get(token);
  if (job) { try { fs.rmSync(job.file, { force: true }); } catch { /* nada */ } upscaleJobs.delete(token); }
  return true;
});
// Borrado definitivo (no se puede deshacer): la entrada desaparece también de la papelera
handle('blog:delete', async (id, type) => { require('./src/pagelinks').forget(); await wpCall(() => WP().deletePost(cfg, id, type)); if (cfg.sentContent) delete cfg.sentContent[id]; return markExported(id, 'deleted'); });

// Consulta en WordPress el estado real de todas las entradas creadas desde Ecos
handle('exported:refresh', async () => {
  if (!wpIsConnected()) return cfg.exported || {};
  const ids = [...new Set(Object.values(cfg.exported || {}).map((r) => r.postId).filter(Boolean))];
  if (!ids.length) return cfg.exported || {};
  const st = await wpCall(() => WP().postStatuses(cfg, ids));
  for (const rec of Object.values(cfg.exported)) if (st[rec.postId]) rec.status = st[rec.postId];
  store.save(cfg);
  return cfg.exported;
});
handle('blog:category', async (id, name, add) => {
  if (!WP().changeCategory) throw new Error('Solo disponible con WordPress propio');
  await wpCall(() => WP().changeCategory(cfg, id, name, add));
});
// --- Revisión del blog: entradas sin categoría o sin imagen destacada ---
let healthCache = null;
handle('blog:health', async (force) => {
  needSelf();
  if (!force && healthCache && Date.now() - healthCache.at < 5 * 60 * 1000) return healthCache;
  healthCache = await wpCall(() => WP().blogHealth(cfg));
  return healthCache;
});
// La primera foto del contenido pasa a ser la destacada (y se queda también en el cuerpo)
handle('blog:autoFeatured', async (ids) => {
  needSelf();
  const done = [], skipped = [], errors = [];
  for (const id of ids || []) {
    try {
      const p = await wpCall(() => WP().getPost(cfg, id));
      if (p.featured) { skipped.push(id); continue; }
      const af = await autoFeatured(p.content, { first: true });
      if (!af) { skipped.push(id); continue; }
      await wpCall(() => WP().updateFields(cfg, id, { featured_media: af.mediaId }));
      done.push(id);
    } catch (e) { log('Primera foto como destacada', id, e.message); errors.push({ id, message: e.message }); }
  }
  healthCache = null;
  return { done, skipped, errors };
});
// La IA elige entre las categorías que ya existen (nunca inventa)
handle('blog:suggestCategories', async (ids) => {
  needSelf();
  if (!ai) ai = require('./src/ai');
  aiReady();
  const [posts, cats] = await Promise.all([wpCall(() => WP().postsText(cfg, ids)), wpCall(() => WP().categories(cfg))]);
  const names = cats.map((c) => c.name).filter((n) => !require('./renderer/blogcheck').isDefaultCat(n));
  const sug = await ai.suggestCategories(cfg.ai, posts, names);
  const title = new Map(posts.map((p) => [p.id, p.title]));
  return sug.map((s) => ({ ...s, title: title.get(s.id) || '' }));
});
// Recomendar categorías a partir del contenido (algoritmo sin IA)
let topicPosts = null;
handle('blog:recommendCategories', async () => {
  needSelf();
  const [posts, cats] = await Promise.all([wpCall(() => WP().postsText(cfg)), wpCall(() => WP().categories(cfg))]);
  topicPosts = posts;
  const real = cats.filter((c) => !require('./renderer/blogcheck').isDefaultCat(c.name));
  return { proposals: require('./src/topics').recommend(posts, real), total: posts.length };
});
handle('blog:refineCategories', async (proposals) => {
  needSelf();
  if (!ai) ai = require('./src/ai');
  aiReady();
  const cats = (await wpCall(() => WP().categories(cfg))).map((c) => c.name);
  const refined = await ai.refineTopics(cfg.ai, proposals, topicPosts || [], cats);
  return refined.length ? refined : proposals;
});
// Buscar y reemplazar texto en todo el blog (solo WordPress propio)
handle('blog:findText', async ({ query, opts, type, ids }) => {
  if (!isSelf()) throw new Error('Buscar y reemplazar en todo el blog solo está disponible con WordPress propio');
  if (!String(query || '').trim()) throw new Error('Escribe el texto que quieres buscar');
  const FR = require('./renderer/findreplace');
  sendToast('Buscando en las entradas…');
  const posts = await wpCall(() => wpself.allRaw(cfg, type, ids));
  const results = [];
  for (const p of posts) {
    const title = p.title?.raw ?? p.title?.rendered ?? '';
    const content = p.content?.raw ?? '';
    const nc = FR.countInHtml(content, query, opts), nt = FR.countInHtml(title, query, opts);
    if (!nc + nt) continue;
    const snippets = [...FR.snippetsInHtml(title, query, opts, 60, 1), ...FR.snippetsInHtml(content, query, opts, 60, 3)].slice(0, 3);
    results.push({ id: p.id, title: title || '(sin título)', status: p.status, url: p.link, count: nc + nt, snippets });
  }
  log(`Buscar y reemplazar: «${query}» → ${results.length} entradas`);
  return { scanned: posts.length, results };
});
handle('blog:replaceText', async ({ query, replacement, opts, ids, type }) => {
  if (!isSelf()) throw new Error('Buscar y reemplazar en todo el blog solo está disponible con WordPress propio');
  if (!String(query || '').trim()) throw new Error('Escribe el texto que quieres buscar');
  const FR = require('./renderer/findreplace');
  let done = 0; const errors = [];
  for (const [n, id] of (ids || []).entries()) {
    try {
      if (n && n % 5 === 0) sendToast(`Reemplazando… ${n} de ${ids.length}`);
      const [p] = await wpCall(() => wpself.allRaw(cfg, type, [id]));
      if (!p) throw new Error('no se encuentra');
      const c = FR.replaceInHtml(p.content?.raw ?? '', query, replacement, opts);
      const t = FR.replaceInHtml(p.title?.raw ?? '', query, replacement, opts);
      const fields = {};
      if (c.count) fields.content = c.html;
      if (t.count) fields.title = t.html;
      if (!Object.keys(fields).length) continue;
      await wpCall(() => wpself.updateFields(cfg, id, fields, type));
      done++;
    } catch (e) { errors.push({ id, error: e.message }); }
  }
  log(`Buscar y reemplazar: «${query}» → «${replacement}» en ${done} entradas, ${errors.length} errores`);
  return { done, errors };
});
handle('blog:editUrl', (id, type) => editUrlFor(id, type));

// --- Revisar enlaces (src/links.js): comprueba si funcionan y propone alternativas ---
const linksMod = () => require('./src/links');
const sendLinksProgress = (p) => { try { mainWin?.webContents.send('links:progress', p); } catch { /* ventana cerrada */ } };
const linkSiteUrl = () => (isSelf() ? WP().publicBase(cfg) : null) || (cfg.wpPublicUrl ? String(cfg.wpPublicUrl).replace(/\/+$/, '') : null);
// Busca en las entradas y páginas de la web propia por el último trozo de la ruta (el slug) y devuelve su enlace actual
async function findLinkOnSite(url) {
  if (!isSelf()) return null;
  const site = WP().publicBase(cfg);
  if (!site) return null;
  let slug;
  try { slug = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '').replace(/\.\w{2,5}$/, ''); } catch { return null; }
  if (!slug) return null;
  for (const coll of ['posts', 'pages']) {
    try {
      const r = await fetch(`${site}/wp-json/wp/v2/${coll}?${new URLSearchParams({ slug, _fields: 'link' })}`, { headers: { Accept: 'application/json' } });
      const j = r.ok ? await r.json() : [];
      if (j?.[0]?.link) return j[0].link;
    } catch { /* probamos con lo siguiente */ }
  }
  return null;
}
const checkLinkList = (urls) => linksMod().checkMany(urls, { fetch: globalThis.fetch, siteUrl: linkSiteUrl(), findOnSite: findLinkOnSite }, sendLinksProgress);
handle('links:check', async (urls) => {
  const list = [...new Set((urls || []).filter((u) => /^https?:\/\//i.test(u)))].slice(0, 500);
  const r = await checkLinkList(list);
  log(`Revisar enlaces: ${list.length} comprobados, ${r.filter((x) => x.status === 'broken').length} rotos`);
  return r;
});
handle('blog:checkLinks', async ({ ids, type }) => {
  if (!isSelf()) throw new Error('Revisar los enlaces del blog solo está disponible con WordPress propio');
  const L = linksMod();
  sendToast('Leyendo las entradas…');
  const posts = await wpCall(() => wpself.allRaw(cfg, type, ids));
  const per = posts.map((p) => ({ id: p.id, title: p.title?.raw ?? p.title?.rendered ?? '', links: L.extractLinks(p.content?.raw ?? '') }));
  const all = [...new Set(per.flatMap((p) => p.links.map((l) => l.url)))];
  const res = new Map((await checkLinkList(all)).map((r) => [r.url, r]));
  log(`Revisar enlaces: ${posts.length} entradas, ${all.length} enlaces distintos`);
  return per.map((p) => ({ id: p.id, title: p.title || '(sin título)', links: p.links.map((l) => ({ ...res.get(l.url), text: l.text, kind: l.kind })) }));
});
handle('blog:fixLinks', async (changes) => {
  if (!isSelf()) throw new Error('Cambiar enlaces en el blog solo está disponible con WordPress propio');
  const L = linksMod();
  const groups = new Map();
  for (const c of changes || []) {
    if (!c?.from || !(c?.to || c?.remove)) continue;
    const k = `${c.type || 'post'}:${c.id}`;
    if (!groups.has(k)) groups.set(k, { id: c.id, type: c.type, list: [] });
    groups.get(k).list.push(c);
  }
  let done = 0; const errors = [];
  for (const g of groups.values()) {
    try {
      const [p] = await wpCall(() => wpself.allRaw(cfg, g.type, [g.id]));
      if (!p) throw new Error('no se encuentra');
      const old = p.content?.raw ?? '';
      let html = old;
      for (const c of g.list) html = c.remove ? (c.kind === 'image' ? L.removeImageInHtml(html, c.from) : L.unlinkInHtml(html, c.from)) : L.replaceLinkInHtml(html, c.from, c.to);
      if (html === old) continue;
      await wpCall(() => wpself.updateFields(cfg, g.id, { content: html }, g.type));
      done++;
    } catch (e) { errors.push({ id: g.id, error: e.message }); }
  }
  log(`Revisar enlaces: cambiados en ${done} entradas, ${errors.length} errores`);
  return { done, errors };
});

// --- Copia de seguridad de la web: entradas, páginas y (si se quiere) fotos en un WXR / ZIP (src/backupcreate.js) ---
let webBackupJob = null;
handle('backup:cancelCreate', () => { if (webBackupJob) { webBackupJob.stop = true; webBackupJob.ctrl.abort(); } return true; });
handle('backup:create', async (opts = {}) => {
  if (!isSelf()) throw new Error('La copia de seguridad de la web solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.');
  if (webBackupJob) throw new Error('Ya se está creando una copia de seguridad');
  const photos = opts.photos !== false;
  const host = (() => { try { return new URL(wpself.publicBase(cfg)).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, ''); } catch { return 'web'; } })();
  const pick = await dialog.showSaveDialog(mainWin, {
    title: 'Guardar la copia de seguridad de la web',
    defaultPath: path.join(app.getPath('documents'), `copia-${host}-${new Date().toISOString().slice(0, 10)}.${photos ? 'zip' : 'xml'}`),
    filters: photos ? [{ name: 'ZIP (XML + fotos)', extensions: ['zip'] }] : [{ name: 'Exportación de WordPress (XML)', extensions: ['xml'] }],
  });
  if (pick.canceled || !pick.filePath) return null;
  const job = webBackupJob = { stop: false, ctrl: new AbortController() };
  const send = (p) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('backup:createProgress', p); };
  try {
    const media = await mediaAll(false).catch(() => []);
    const r = await require('./src/backupcreate').createBackup({
      siteName: wpLabel() || host, siteUrl: wpself.publicBase(cfg) || '', media,
      listAll: (route) => wpCall(() => wpself.allParallel(cfg, route, { onProgress: (d, t) => send({ step: 'entradas', done: d, total: t }) })),
      download: async (url) => {
        const res = await fetch(url, { signal: job.ctrl.signal });
        return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      },
    }, { file: pick.filePath, photos, onProgress: send, cancelled: () => job.stop });
    log(`Copia de seguridad de la web: ${r.posts} entradas, ${r.pages} páginas, ${r.files} fotos (${r.missing} sin poder bajar) → ${pick.filePath}`);
    return r;
  } finally { webBackupJob = null; }
});

// --- Restaurar entradas desde una copia de seguridad (src/backup.js) ---
let backupAn = null;
const backupMod = () => require('./src/backup');
const sendProgress = (p) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('backup:progress', p); };
const restoredKey = (k) => `${backupAn?.siteUrl || ''}|${k}`;
handle('backup:pick', async (kind) => {
  const r = await dialog.showOpenDialog(mainWin, kind === 'folder'
    ? { title: 'Carpeta de la copia de seguridad', properties: ['openDirectory'] }
    : { title: 'Archivos de la copia de seguridad', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Copias de WordPress', extensions: ['zip', 'wpress', 'sql', 'gz', 'xml'] }, { name: 'Todos', extensions: ['*'] }] });
  return r.canceled ? null : r.filePaths;
});
// Cancelar: se para entre archivos/entradas y se cortan las descargas en curso
let backupJob = { stop: false, ctrl: new AbortController() };
const newJob = () => (backupJob = { stop: false, ctrl: new AbortController() });
const CANCELLED = 'Cancelado';
handle('backup:cancel', () => { backupJob.stop = true; backupJob.ctrl.abort(); return true; });
handle('backup:analyze', async (paths) => {
  if (backupAn) { backupAn.sources.forEach((x) => x.close()); backupAn = null; }
  const job = newJob();
  const an = await backupMod().analyze(paths, (p) => { if (job.stop) throw new Error(CANCELLED); sendProgress(p); });
  if (job.stop) { an.sources.forEach((x) => x.close()); throw new Error(CANCELLED); }
  backupAn = an;
  log(`Copia de seguridad analizada: ${backupAn.kinds.join(', ')} · ${backupAn.posts.length} entradas/páginas`);
  const done = cfg.restored || {};
  // Lo que ya está en la web (restaurado antes, con Ecos o a mano, en cualquier estado: también borradores)
  const index = { post: [], page: [] };
  if (isSelf() && wpIsConnected()) {
    for (const ty of ['post', 'page']) index[ty] = await WP().postIndex(cfg, ty).catch((e) => { log('No se pudo leer la lista de la web', ty, e.message); return []; });
  }
  const W = WP();
  // La misma entrada repetida dentro de la copia (varios archivos XML con lo mismo): se muestra una sola vez
  const seen = new Set();
  const unique = backupAn.posts.filter((x) => {
    const k = `${x.type}|${W.normTitle ? W.normTitle(x.title) : x.title}|${String(x.date || '').slice(0, 10)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  if (unique.length < backupAn.posts.length) log(`Copia: ${backupAn.posts.length - unique.length} entradas repetidas dentro de la copia se muestran una sola vez`);
  const existing = (x) => {
    const h = W.matchExisting ? W.matchExisting(index[x.type === 'page' ? 'page' : 'post'] || [], x) : null;
    return h ? { postId: h.id, status: h.status, existing: true, editUrl: editUrlFor(h.id, x.type) } : null;
  };
  return {
    kinds: backupAn.kinds, dbFile: backupAn.dbFile, siteUrl: backupAn.siteUrl, siteName: backupAn.siteName, stats: backupAn.stats,
    posts: unique.map((x) => ({
      key: x.key, id: x.id, type: x.type, status: x.status, title: x.title, date: x.date, slug: x.slug,
      categories: x.categories, tags: x.tags, words: x.words, media: x.media.length, mediaFound: x.mediaFound, mediaMissing: x.mediaMissing,
      excerpt: (x.excerpt || x.content).replace(/<[^>]+>|\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
      restored: done[restoredKey(x.key)] || existing(x),
    })),
  };
});
handle('backup:thumb', async (key) => {
  const x = backupAn?.posts.find((q) => q.key === key);
  const local = x?.thumbRel ? await backupMod().thumbnail(backupAn, x.thumbRel, require('electron').nativeImage) : null;
  if (local) return local;
  // la foto no está en la copia: su dirección original (p. ej. web.archive.org)
  const m = (x?.media || []).find((mm) => mm.featured) || (x?.media || [])[0];
  return m?.url || null;
});
handle('backup:preview', async (key) => {
  const x = backupAn?.posts.find((q) => q.key === key);
  if (!x) throw new Error('No se encuentra esa entrada en la copia');
  return backupMod().previewContent(backupAn, x, require('electron').nativeImage);
});
handle('backup:content', (key) => backupAn?.posts.find((q) => q.key === key)?.content || '');
// opts: { status: 'draft' | 'original', createCategories, skipExisting, download }
handle('backup:restore', async (keys, opts = {}) => {
  if (!backupAn) throw new Error('Primero abre una copia de seguridad');
  if (!wpIsConnected()) throw new Error('Primero conecta tu WordPress en «Conexiones».');
  const results = [];
  cfg.restored = cfg.restored || {};
  const job = newJob();
  for (const key of keys) {
    if (job.stop) { log('Restauración cancelada'); break; }
    const x = backupAn.posts.find((q) => q.key === key);
    if (!x) continue;
    sendProgress({ key, state: 'working' });
    try {
      if (opts.skipExisting !== false) {
        const existing = await wpCall(() => WP().findExisting(cfg, x.type, x.slug, x.title, x.date));
        if (existing) { results.push({ key, state: 'exists', postId: existing }); sendProgress({ key, state: 'exists', postId: existing }); continue; }
      }
      const prep = await backupMod().prepare(backupAn, x, (buf, name) => wpCall(() => WP().uploadNamed(cfg, buf, name, { keep: true })), { download: opts.download !== false, job });
      if (job.stop) { sendProgress({ key, state: 'cancelled' }); break; }
      if (opts.modern !== false) {
        prep.fields.content = modernize(prep.fields.content); // bloques de WordPress con el formato habitual
        if (!prep.fields.featured_image) {
          const af = await autoFeatured(prep.fields.content).catch((e) => { log('Destacada automática', key, e.message); return null; });
          if (af) { prep.fields.content = af.content; prep.fields.featured_image = af.mediaId; }
        }
      }
      const status = opts.status === 'original' ? (['publish', 'future', 'private', 'pending', 'draft'].includes(x.status) ? x.status : 'draft') : 'draft';
      const post = await wpCall(() => WP().createPost(cfg, { ...prep.fields, status, type: x.type, createCategories: opts.createCategories !== false }));
      // las fotos subidas llevan la fecha de la entrada original (se ordenan bien en la biblioteca)
      if (isSelf() && prep.fields.date) for (const mid of prep.mediaIds || []) await WP().setMediaDate(cfg, mid, new Date(prep.fields.date).toISOString()).catch(() => {});
      const url = WP().publicUrl(cfg, post.URL);
      cfg.restored[restoredKey(key)] = { postId: post.ID, url, editUrl: editUrlFor(post.ID, x.type), at: new Date().toISOString() };
      store.save(cfg);
      const r = { key, state: 'ok', postId: post.ID, url, editUrl: editUrlFor(post.ID, x.type), uploaded: prep.uploaded, problems: prep.problems };
      results.push(r); sendProgress(r);
    } catch (e) {
      log('Restaurar', key, e.message);
      const r = { key, state: 'error', message: e.message }; results.push(r); sendProgress(r);
      if (e instanceof wp.AuthError || /rechazado la conexión/.test(e.message)) break;
    }
  }
  return results;
});
// Entrada sin imagen destacada y con una sola foto: esa foto pasa a ser también la destacada (así se ve en la
// lista del blog) y se queda en el cuerpo, para que el texto no pierda sentido. Devuelve { content, mediaId } o null.
// Con { first: true } sirve con cualquier número de fotos y elige la primera (revisión del blog).
async function autoFeatured(content, { first = false } = {}) {
  const blocks = require('./src/parseblocks').parseBlocks(content);
  const imgs = blocks.flatMap((b) => (b.img ? [b.img] : b.images || [])).filter((i) => i && i.type !== 'video' && i.url);
  if (first ? !imgs.length : imgs.length !== 1) return null;
  const img = first ? require('./renderer/blogcheck').firstImage(blocks) : imgs[0];
  let mediaId = Number(img.id) > 0 ? Number(img.id) : 0;
  if (mediaId && isSelf() && !(await WP().mediaExists(cfg, mediaId))) mediaId = 0;
  if (!mediaId && isSelf()) mediaId = await WP().findMediaByUrl(cfg, img.url).catch(() => null);
  if (!mediaId) mediaId = (await wpCall(() => WP().uploadFromUrls(cfg, [img.url])))[0]?.id;
  if (!mediaId) return null;
  return { content, mediaId };
}
// Fotos de Blogger/Picasa enlazadas desde fuera (normalmente en versión pequeña): se descargan a tamaño
// original, se suben a la biblioteca tal cual (sin volver a comprimir) y la entrada pasa a usarlas.
async function importExternalImages(html) {
  const B = backupMod();
  const list = B.externalImages(html);
  if (!list.length) return html;
  const map = new Map();
  for (const m of list) {
    try {
      const buf = await B.downloadBest(m, () => AbortSignal.timeout(45000));
      if (!buf) continue;
      let name = B.nameOf(m.orig || m.url); if (!/\.(jpe?g|png|gif|webp)$/i.test(name)) name += '.jpg';
      map.set(m.gkey, await wpCall(() => WP().uploadNamed(cfg, buf, name, { keep: true })));
    } catch (e) { log('Foto externa', m.orig, e.message); }
  }
  return String(html).replace(/https?:\/\/[^\s"'<>)]+/g, (u) => { const g = map.get(B.googleKey(u)); return g ? g.url : u; });
}
// Contenido antiguo → bloques de WordPress con el formato habitual del blog (el texto no cambia)
let normSeq = 0;
function modernize(html) {
  const Nz = require('./renderer/normalize');
  const blocks = require('./src/parseblocks').parseBlocks(html);
  const r = Nz.normalizeBlocks(blocks, (type, extra = {}) => ({ id: 'n' + Date.now().toString(36) + (normSeq++).toString(36), type, ...extra }));
  return composeBlocks(r.blocks, { spectra: isSelf(), helper: helperOn(), pageBg: require('./renderer/pagebg').parse(html) });
}
// Entradas ya restauradas: se lee su contenido en WordPress, se normaliza y se guarda solo el contenido
handle('backup:normalizeRestored', async (postIds) => {
  const done = [], errors = [];
  for (const id of postIds) {
    try {
      const p = await wpCall(() => WP().getPost(cfg, id));
      let content = modernize(isSelf() ? await importExternalImages(p.content) : p.content);
      // sin imagen destacada y con una sola foto: esa foto pasa a ser la destacada
      const af = !p.featured && isSelf() ? await autoFeatured(content).catch((e) => { log('Destacada automática', id, e.message); return null; }) : null;
      if (af) { await wpCall(() => WP().updateFields(cfg, id, { content: af.content, featured_media: af.mediaId })); content = null; }
      if (content && content.trim() && content !== p.content) await wpCall(() => WP().updateContent(cfg, id, content));
      done.push(id); sendProgress({ normalized: id });
    } catch (e) { errors.push(`${id}: ${e.message}`); log('Normalizar', id, e.message); }
  }
  return { done: done.length, errors };
});
// ¿Hay una copia de seguridad abierta? (para «Recuperar fotos originales» desde el Blog)
handle('backup:status', () => (backupAn ? { open: true, name: backupAn.siteName || backupAn.dbFile || '', posts: backupAn.posts.length } : { open: false }));
// Recuperar fotos originales: para cada entrada de la web se busca su entrada en la copia abierta y cada foto
// se cambia por el archivo original de la copia (resolución completa, sin recomprimir). Las fotos de Blogger
// se traen a tamaño completo. Lo ya subido se reutiliza (no se duplica en la biblioteca).
handle('backup:restoreImages', async (ids) => {
  if (!isSelf()) throw new Error('Solo disponible con WordPress propio');
  const B = backupMod();
  cfg.origUploads = cfg.origUploads || {};
  const out = { done: 0, photos: 0, notFound: 0, unmatched: 0, errors: [] };
  // todos los archivos de foto de la copia, por nombre comparable
  const byName = new Map();
  if (backupAn) for (const [rel] of backupAn.files) if (/\.(jpe?g|png|gif|webp)$/i.test(rel) && !/-\d+x\d+\.\w+$/.test(rel)) {
    for (const k of new Set([B.photoKey(rel), B.photoKey(rel, true)])) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(rel); }
  }
  let n = 0;
  for (const id of ids) {
    n++; sendToast(`Fotos originales: entrada ${n} de ${ids.length}…`);
    try {
      const raw = (await wpCall(() => WP().allRaw(cfg, 'post', [id])))[0];
      if (!raw) throw new Error('no se encuentra');
      const wpPost = { slug: raw.slug, title: raw.title?.raw ?? raw.title, date: raw.date, type: 'post' };
      let html = raw.content?.raw ?? '';
      const before = html;
      const match = backupAn ? B.matchBackupPost(backupAn, wpPost) : null;
      if (backupAn && !match) out.unmatched++;
      // fotos de la entrada → archivo original de la copia (primero las de esa entrada, si no por nombre)
      const own = new Map();
      for (const m of (match?.media || []).filter((x) => x.rel && !x.ext)) { own.set(B.photoKey(m.rel), m.rel); if (!own.has(B.photoKey(m.rel, true))) own.set(B.photoKey(m.rel, true), m.rel); }
      const imgs = [...new Set([...html.matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]))];
      for (const src of imgs) {
        if (/(bp\.blogspot\.com|ggpht\.com|googleusercontent\.com)/i.test(src)) continue; // van aparte
        const k = B.photoKey(src), kl = B.photoKey(src, true);
        const one = (key) => (byName.get(key)?.length === 1 ? byName.get(key)[0] : null);
        const rel = own.get(k) || own.get(kl) || one(k) || one(kl);
        if (!rel) { out.notFound++; continue; }
        const ck = `${backupAn.siteUrl || ''}|${rel}`;
        let up = cfg.origUploads[ck];
        if (!up) {
          const f = backupAn.findFile(rel);
          if (!f) { out.notFound++; continue; }
          const buf = await f.src.read(f.name);
          up = await wpCall(() => WP().uploadNamed(cfg, buf, path.basename(rel), { keep: true }));
          if (raw.date) await WP().setMediaDate(cfg, up.id, raw.date).catch(() => {});
          cfg.origUploads[ck] = { id: up.id, url: up.url }; store.save(cfg);
        }
        if (up.url === src.replace(/&amp;/g, '&')) continue; // ya es la original
        // la foto, su enlace (si apuntaba a otra versión de la misma foto) y su número en la biblioteca
        html = html.replace(/<img\b[^>]*>/gi, (tag) => {
          if (!tag.includes(src)) return tag;
          const old = (tag.match(/wp-image-(\d+)/) || [])[1];
          if (old) html = html.split(`"id":${old}`).join(`"id":${up.id}`);
          return tag.split(src).join(up.url).replace(/wp-image-\d+/, `wp-image-${up.id}`).replace(/\s(srcset|sizes)="[^"]*"/gi, '');
        });
        html = html.replace(/href=["']([^"']+)["']/gi, (all, h) => (B.photoKey(h, true) === kl && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(h) ? `href="${up.url}"` : all));
        out.photos++;
      }
      // fotos de Blogger/Picasa a tamaño completo
      const ext = await importExternalImages(html);
      if (ext !== html) { out.photos += B.externalImages(html).length - B.externalImages(ext).length; html = ext; }
      if (html !== before) { await wpCall(() => WP().updateFields(cfg, id, { content: html })); out.done++; }
    } catch (e) { out.errors.push(`${id}: ${e.message}`); log('Fotos originales', id, e.message); }
  }
  return out;
});
handle('backup:close', () => { if (backupAn) { backupAn.sources.forEach((x) => x.close()); backupAn = null; } });

// --- Modo desarrollador: terminal integrada (src/devterm.js) ---
const devterm = () => require('./src/devterm');
const sendWin = (ch, v) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, v); };
handle('dev:tools', () => devterm().tools());
handle('dev:pickDir', async () => {
  const r = await dialog.showOpenDialog(mainWin, { title: 'Carpeta del proyecto Ecos (código fuente)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  cfg.devDir = r.filePaths[0]; store.save(cfg);
  return cfg.devDir;
});
// ¿Es esa carpeta el código de Ecos? (tiene package.json con "name": "ecos")
handle('dev:checkDir', (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'ecos'; } catch { return false; }
});
// La terminal solo existe con el modo desarrollador activado (se comprueba aquí, no solo en la interfaz)
const devOn = () => !!cfg.prefs?.devMode && !isLocked();
handle('pty:spawn', (opts) => { if (!devOn()) throw new Error('Activa el modo desarrollador en Ajustes para usar la terminal'); return devterm().spawn({ ...opts, cwd: opts.cwd || cfg.devDir }, sendWin); });
ipcMain.on('pty:write', (_e, id, data) => { if (devOn()) devterm().write(id, data); });
ipcMain.on('pty:resize', (_e, id, cols, rows) => { if (devOn()) devterm().resize(id, cols, rows); });
handle('pty:kill', (id) => devterm().kill(id));
app.on('before-quit', () => { try { devterm().killAll(); } catch { /* sin terminales */ } });

// --- Ajustes: información, registros y restablecer ---
handle('app:info', () => ({
  version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
  platform: `${process.platform} ${process.arch}`, userData: app.getPath('userData'),
}));
handle('app:openData', () => shell.openPath(app.getPath('userData')));
// Registro de errores (Ajustes → Avanzado): últimas líneas, vaciar y abrir su carpeta
handle('log:tail', (n) => ({ text: logger().tail(Math.max(1, Math.min(2000, Number(n) || 200))), file: logFile() }));
handle('log:clear', () => { logger().clear(); log('Registro vaciado por el usuario'); return true; });
handle('log:openFolder', async () => { fs.mkdirSync(path.dirname(logFile()), { recursive: true }); return shell.openPath(path.dirname(logFile())); });
handle('app:resetAll', () => {
  log('El usuario borra todos los datos de Ecos');
  for (const f of ['config.json', 'modo-arranque.json', 'arranque-pendiente']) { try { fs.unlinkSync(path.join(app.getPath('userData'), f)); } catch { /* nada */ } }
  app.relaunch(); app.exit(0);
});
handle('exported:clear', () => { cfg.exported = {}; store.save(cfg); return {}; });

// --- Modo de arranque ---
handle('mode:tryNormal', () => {
  saveMode(0);
  log('El usuario pide probar el modo normal; reiniciando');
  app.relaunch(); app.exit(0);
});

// Solo se abren en el navegador direcciones web y de correo (nunca file:, ms-… u otros protocolos del sistema)
function openSafe(url) {
  let u; try { u = new URL(String(url)); } catch { return false; }
  if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) { log('Enlace bloqueado:', u.protocol); return false; }
  shell.openExternal(u.href); return true;
}
handle('open', (url) => { if (!openSafe(url)) throw new Error('Ese enlace no se puede abrir desde Ecos'); });

handle('update:status', () => updater.current());
// ---------------------------------------------------------------- Acceso con contraseña y doble factor
const vault = require('./src/vault');
const lockGuard = { fails: 0, until: 0 };
let pendingOpen = null; // contraseña buena a falta del código del doble factor
const lockPrefs = () => { const p = cfg.prefs || {}; return { theme: p.theme, accent: p.accent, lang: p.lang, vinyl: p.vinyl, silk: p.silk, zoom: p.zoom }; };
handle('lock:state', () => ({ locked: isLocked(), enabled: !!cfg.lock, auto: cfg.lock?.auto ?? 15, prefs: lockPrefs(), needCode: !!pendingOpen, hello: !!cfg.lock?.hello }));
function failedAttempt(msg) {
  lockGuard.fails++;
  if (lockGuard.fails >= 3) lockGuard.until = Date.now() + Math.min(5 * 60000, 2000 * 2 ** (lockGuard.fails - 3)); // espera creciente
  log('Acceso: intento fallido', lockGuard.fails);
  throw new Error(msg);
}
handle('lock:unlock', async ({ password, code } = {}) => {
  if (!isLocked()) return { ok: true };
  const wait = Math.ceil((lockGuard.until - Date.now()) / 1000);
  if (wait > 0) throw new Error(`Demasiados intentos. Espera ${wait} s.`);
  let opened = pendingOpen;
  if (password !== undefined) { try { opened = store.open(cfg, password); } catch (e) { pendingOpen = null; failedAttempt(e.message); } }
  if (!opened) throw new Error('Escribe la contraseña');
  return finishUnlock(opened, code);
});
function finishUnlock(opened, code, viaHello = false) {
  if (opened.secrets.totp && !viaHello) {
    if (!code) { pendingOpen = opened; return { needCode: true }; } // falta el código del móvil
    const c = String(code).trim();
    const okTotp = vault.checkTotp(opened.secrets.totp, c);
    const rIdx = okTotp ? -1 : (opened.secrets.recovery || []).indexOf(vault.hashCode(c));
    if (!okTotp && rIdx < 0) failedAttempt('Código incorrecto');
    if (rIdx >= 0) opened.secrets.recovery.splice(rIdx, 1); // los códigos de recuperación valen una vez
  }
  pendingOpen = null; lockGuard.fails = 0; lockGuard.until = 0;
  store.unlock(cfg, opened);
  store.save(cfg);
  log('Acceso: desbloqueada');
  return { ok: true };
}
// Entrar con Windows Hello (huella, cara o PIN): su firma abre la copia de la llave de la bóveda
handle('lock:hello', async () => {
  if (!isLocked()) return { ok: true };
  if (!cfg.lock?.hello) throw new Error('Windows Hello no está activado');
  const wait = Math.ceil((lockGuard.until - Date.now()) / 1000);
  if (wait > 0) throw new Error(`Demasiados intentos. Espera ${wait} s.`);
  const hk = await require('./src/winhello').keyFor(cfg.lock.hello.challenge);
  let k;
  try { k = Buffer.from(vault.decrypt(cfg.lock.hello.wrapped, hk).k, 'base64'); } catch { throw new Error('Windows Hello no ha podido abrir la bóveda. Entra con la contraseña y vuelve a activarlo.'); }
  pendingOpen = null;
  // Windows Hello ya son dos factores (la llave guardada en el chip del ordenador + huella, cara o PIN): sin código del móvil
  return finishUnlock(store.openWithKey(cfg, k), null, true);
});
handle('hello:status', async () => ({ windows: process.platform === 'win32', supported: await require('./src/winhello').supported(), enabled: !!cfg.lock?.hello }));
handle('hello:enable', async ({ current } = {}) => {
  if (!cfg.lock) throw new Error('Primero activa la contraseña');
  const opened = store.open(cfg, current); // comprueba la contraseña y da la llave de la bóveda
  const challenge = crypto.randomBytes(32).toString('base64');
  const hk = await require('./src/winhello').keyFor(challenge, true); // pide la huella/cara/PIN
  cfg.lock.hello = { challenge, wrapped: vault.encrypt({ k: opened.k.toString('base64') }, hk), at: new Date().toISOString() };
  store.save(cfg);
  log('Acceso: Windows Hello activado');
  return publicCfg();
});
handle('hello:disable', () => { if (cfg.lock) { delete cfg.lock.hello; store.save(cfg); } log('Acceso: Windows Hello quitado'); return publicCfg(); });
function lockApp(reason) {
  if (!cfg?.lock || isLocked()) return;
  store.lockNow(cfg);
  pendingOpen = null;
  try { devterm().killAll(); } catch { /* sin terminal */ }
  if (backupAn) { backupAn.sources.forEach((x) => x.close()); backupAn = null; }
  log('Acceso: bloqueada', reason || '');
  mainWin?.webContents.reload(); // fuera de la memoria de la ventana todo lo que se estaba viendo
}
handle('lock:lock', () => { lockApp('a mano'); return true; });
const needPassword = (pw) => { if (cfg.lock) store.open(cfg, pw); }; // lanza «Contraseña incorrecta»
handle('lock:set', ({ password, current } = {}) => {
  if (String(password || '').length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (cfg.lock) needPassword(current);
  const keep = { totp: cfg.__totp, recovery: cfg.__recovery };
  store.setPassword(cfg, password); // (Windows Hello, si estaba, queda desactivado: la llave es otra)
  cfg.__totp = keep.totp || null; cfg.__recovery = keep.recovery || []; store.save(cfg);
  log('Acceso: contraseña', keep.totp ? 'cambiada' : 'activada');
  return publicCfg();
});
handle('lock:disable', ({ current } = {}) => { needPassword(current); store.clearPassword(cfg); log('Acceso: contraseña quitada'); return publicCfg(); });
handle('lock:auto', (minutes) => { if (cfg.lock) { cfg.lock.auto = Math.max(0, Math.min(240, Number(minutes) || 0)); store.save(cfg); } return publicCfg(); });
// Contraseña olvidada: se quita la protección y se borran las claves (hay que volver a conectar)
handle('lock:reset', () => { if (!cfg.lock) return true; store.resetForgotten(cfg); pendingOpen = null; log('Acceso: restablecida (claves borradas)'); mainWin?.webContents.reload(); return true; });
// Doble factor: 1) se genera el secreto y el QR; 2) con un código bueno se activa y se dan los códigos de recuperación
let totpDraft = null;
handle('totp:begin', async () => {
  if (!cfg.lock) throw new Error('Primero activa la contraseña');
  totpDraft = vault.newTotpSecret();
  const url = vault.otpauthUrl(totpDraft, cfg.wpSite || 'Ecos', 'Ecos');
  return { secret: totpDraft.replace(/(.{4})/g, '$1 ').trim(), qr: await require('qrcode').toDataURL(url, { margin: 1, width: 220 }) };
});
handle('totp:confirm', (code) => {
  if (!totpDraft) throw new Error('Vuelve a empezar la activación');
  if (!vault.checkTotp(totpDraft, code)) throw new Error('El código no coincide. Comprueba la hora del móvil y vuelve a probar.');
  const codes = vault.newRecoveryCodes();
  cfg.__totp = totpDraft; cfg.__recovery = codes.map(vault.hashCode); totpDraft = null;
  store.save(cfg);
  log('Acceso: doble factor activado');
  return { codes, cfg: publicCfg() };
});
handle('totp:disable', ({ current } = {}) => { needPassword(current); cfg.__totp = null; cfg.__recovery = []; store.save(cfg); log('Acceso: doble factor quitado'); return publicCfg(); });

// ---------------------------------------------------------------- Cola de envíos sin conexión (src/sendqueue.js)
const SQ = require('./src/sendqueue');
const queueFile = () => path.join(app.getPath('userData'), 'send-queue.json');
let sendQueue = [];
let queueTimer = null, queueRunning = false;
try { const j = JSON.parse(fs.readFileSync(queueFile(), 'utf8')); if (Array.isArray(j)) sendQueue = j; } catch { /* sin cola */ }
function queueSave() {
  try { fs.writeFileSync(queueFile(), JSON.stringify(sendQueue)); } catch (e) { log('No se pudo guardar la cola de envíos', e.message); }
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('queue:update', SQ.view(sendQueue)); } catch { /* ventana cerrada */ }
  clearTimeout(queueTimer);
  const wake = SQ.nextWake(sendQueue);
  if (wake) queueTimer = setTimeout(queueRun, Math.max(1000, wake - Date.now()));
}
function queueAdd(d, errMsg) { sendQueue = SQ.enqueue(sendQueue, d, Date.now(), errMsg); queueSave(); }
function queueNotify(title, body) { try { const { Notification } = require('electron'); if (Notification.isSupported()) new Notification({ title, body }).show(); } catch { /* sin notificaciones */ } }
async function queueRun() {
  if (queueRunning || !cfg || isLocked()) return;
  queueRunning = true;
  try {
    for (const it of SQ.due(sendQueue, Date.now())) {
      if (!sendQueue.some((x) => x.id === it.id)) continue; // descartado o sustituido mientras tanto
      try {
        const r = await doPublish(it.payload);
        sendQueue = SQ.remove(sendQueue, it.id);
        log('Envío en cola completado', it.title);
        sendToast(`El envío en cola «${it.title}» se ha hecho.`);
        queueNotify('Ecos', `«${it.title}» se ha enviado a WordPress.`);
        try { mainWin?.webContents.send('queue:done', { title: it.title, url: r.url, exported: r.exported }); } catch { /* nada */ }
      } catch (e) {
        if (SQ.isNetworkError(e)) sendQueue = SQ.failed(sendQueue, it.id, Date.now(), e.message);
        else { sendQueue = SQ.remove(sendQueue, it.id); log('Envío en cola descartado', it.title, e.message); sendToast(`No se pudo completar el envío en cola «${it.title}»: ${e.message}`, true); }
      }
      queueSave();
    }
  } finally { queueRunning = false; queueSave(); }
}
handle('queue:list', () => SQ.view(sendQueue));
handle('queue:retry', (id) => { sendQueue = SQ.retryNow(sendQueue, id || null, Date.now()); queueSave(); queueRun(); return SQ.view(sendQueue); });
handle('queue:discard', (id) => { sendQueue = SQ.remove(sendQueue, id); queueSave(); return SQ.view(sendQueue); });
handle('queue:online', () => { if (sendQueue.length) { sendQueue = SQ.retryNow(sendQueue, null, Date.now()); queueSave(); queueRun(); } return SQ.view(sendQueue); });
handle('app:repair', async () => installPublished());

handle('update:check', () => { updater.check(true); return updater.current(); });
handle('update:install', () => updater.install());

app.whenReady().then(() => {
  if (!gotLock || !updater) return; // otra copia abierta, o fallo al cargar módulos (ya avisado)
  log(`Arrancando Ecos ${app.getVersion()} (${process.platform} ${process.arch}, Electron ${process.versions.electron}, modo ${mode}: ${MODES[mode].name})`);
  cfg = { wpSite: 'asociacionelin.com', wpPublicUrl: 'https://www.asociacionelin.com/', graphVersion: 'v23.0', ...store.load() };
  if (!cfg.wpPublicUrl) cfg.wpPublicUrl = 'https://www.asociacionelin.com/';
  if (!cfg.wpUrl) cfg.wpUrl = 'https://www.asociacionelin.com';
  // Migración: la clave de Claude de versiones anteriores pasa al nuevo selector de IA
  if (!cfg.ai) {
    cfg.ai = { active: 'anthropic', providers: cfg.anthropicKey ? { anthropic: { key: cfg.anthropicKey, model: 'claude-opus-5-5' } } : {} };
    delete cfg.anthropicKey; store.save(cfg);
  }
  createWindow();
  // Modo seguro: si los dos últimos arranques no llegaron a mostrar la ventana, se ofrece reinstalar la versión publicada
  try {
    const su = require('./src/startup');
    if (su.shouldOffer(startupState)) {
      saveStartup(su.offered(startupState));
      dialog.showMessageBox({ type: 'warning', title: 'Ecos', message: 'La última versión no arrancó bien.', detail: '¿Descargar e instalar de nuevo la versión publicada?', buttons: ['Descargar e instalar', 'Ahora no'], defaultId: 0, cancelId: 1, noLink: true })
        .then((r) => { if (r.response === 0) installPublished().then((ok) => { if (ok && process.platform === 'win32') app.quit(); }); }).catch(() => {});
    }
  } catch { /* nada */ }
  try { const { powerMonitor } = require('electron'); powerMonitor.on('lock-screen', () => lockApp('pantalla bloqueada')); powerMonitor.on('suspend', () => lockApp('suspensión')); } catch { /* sin powerMonitor */ }
  mainWin.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') escalate(`la ventana se ha cerrado (${d.reason}, código ${d.exitCode})`); });
  // Si la ventana no termina de cargar en 20 s (pantalla en blanco), también se pasa al modo compatible
  const loadTimer = setTimeout(() => escalate('la ventana no ha cargado en 20 segundos'), 20000);
  mainWin.webContents.once('did-finish-load', () => {
    clearTimeout(loadTimer);
    log('Ventana cargada');
    // Autocomprobación de la terminal (la usa la prueba automática de GitHub en Windows)
    if (process.env.ECOS_SELFTEST_PTY) {
      try {
        let out = '';
        const r = devterm().spawn({ cols: 80, rows: 10 }, (ch, v) => {
          if (ch === 'pty:data') out += v.data;
          if (ch === 'pty:exit') log('Autocomprobación terminal: fin', v.code);
        });
        setTimeout(() => devterm().write(r.id, 'echo ecos-pty-ok\r'), 1500);
        setTimeout(() => { log('Autocomprobación terminal:', /ecos-pty-ok[\s\S]*ecos-pty-ok/.test(out) || out.includes('ecos-pty-ok') ? 'OK' : 'FALLO', JSON.stringify(out.slice(-120))); devterm().kill(r.id); }, 5000);
      } catch (e) { log('Autocomprobación terminal: ERROR', e); }
    }
    try { fs.unlinkSync(pendingFile()); } catch { /* nada */ }
    // Solo para pruebas: ECOS_PRUEBA_FALLO=GPU|Tab simula que se cae ese proceso
    if (process.env.ECOS_PRUEBA_FALLO) {
      const victim = app.getAppMetrics().find((m) => m.type === process.env.ECOS_PRUEBA_FALLO);
      if (victim) process.kill(victim.pid);
    }
    updater.setBeta(!!cfg.prefs?.betaChannel);
    queueSave(); // programa los envíos pendientes
    updater.init((st) => {
      if (st.state === 'error') log('Actualizador:', st.message);
      if (!mainWin.isDestroyed()) mainWin.webContents.send('update:status', { version: app.getVersion(), ...st });
    });
  });
}).catch(fatal);
app.on('window-all-closed', () => app.quit());
