const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
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

let store, meta, wp, wpself, buildDraft, composeContent, composeBlocks, blockImages, mediaKey, DEFAULT_FOOTER, mergeDuplicates, importers, updater, ai;
try {
  store = require('./src/store');
  meta = require('./src/meta');
  wp = require('./src/wpcom');
  wpself = require('./src/wpself');
  ({ buildDraft, composeContent, composeBlocks, blockImages, mediaKey, DEFAULT_FOOTER, mergeDuplicates } = require('./src/transform'));
  ai = require('./src/ai');
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
    width: 1280, height: 860, icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'), title: IS_DEV ? 'Ecos (desarrollo)' : 'Ecos', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (IS_DEV) win.on('page-title-updated', (e) => e.preventDefault()); // que se note que es la versión de desarrollo
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

const publicCfg = () => ({
  ...cfg,
  metaAppSecret: cfg.metaAppSecret ? '••••••' : '', wpClientSecret: cfg.wpClientSecret ? '••••••' : '',
  anthropicKey: cfg.anthropicKey ? '••••••' : '',
  metaUserToken: undefined, wpToken: undefined,
  metaConnected: !!cfg.metaUserToken, wpConnected: wpIsConnected(),
  wpMode: cfg.wpMode || 'wpcom', wpAppPassword: cfg.wpAppPassword ? '••••••' : '', wpSiteLabel: wpLabel(),
  metaRedirectUri: meta.REDIRECT, wpRedirectUri: wp.REDIRECT, wpBlogId: undefined,
  format: { cleanTitle: true, footer: DEFAULT_FOOTER, extraTags: '', categories: '', status: 'draft', mergeDuplicates: true, ...(cfg.format || {}) },
  exported: cfg.exported || {},
  templates: cfg.templates || [],
  metaTokenExpires: cfg.metaTokenExpires || null,
  lastSeenAt: cfg.lastSeenAt || null,
  wizardDone: !!cfg.wizardDone || (!!cfg.metaUserToken && wpIsConnected()),
  ai: aiPublic(),
  aiConfigured: (() => { try { ai.PROVIDERS && aiReady(); return true; } catch { return false; } })(),
  startMode: { level: mode, name: MODES[mode].name },
});

// Configuración de IA sin las claves (solo si están guardadas)
function aiPublic() {
  const provs = cfg.ai?.providers || {};
  return {
    active: cfg.ai?.active || 'anthropic',
    providers: Object.fromEntries(Object.entries(ai.PROVIDERS).map(([id, d]) => [id, {
      name: d.name, label: d.label, keyUrl: d.keyUrl, needsKey: d.needsKey, defaultBase: d.base || '', defaultModel: d.defaultModel || '',
      hasKey: !!provs[id]?.key, url: provs[id]?.url || '', model: provs[id]?.model || '',
    }])),
  };
}
function aiReady() {
  const id = cfg.ai?.active || 'anthropic';
  const d = ai.PROVIDERS[id], p = cfg.ai?.providers?.[id] || {};
  if ((d.needsKey && !p.key) || !(p.model || d.defaultModel)) throw new Error('IA sin configurar');
}

// WordPress: «wpcom» (WordPress.com con OAuth) o «selfhosted» (web propia con wp-admin y contraseña de aplicación)
const isSelf = () => cfg.wpMode === 'selfhosted';
const WP = () => (isSelf() ? wpself : wp);
const wpIsConnected = () => (isSelf() ? !!cfg.wpAppPassword && !!cfg.wpSelfOk : !!cfg.wpToken);
const wpLabel = () => (isSelf() ? (cfg.wpUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '') : cfg.wpSite);

// Envuelve llamadas a WordPress: si rechaza el permiso, se desconecta y se avisa
const wpCall = async (fn) => { try { return await fn(); } catch (e) { throw e instanceof wp.AuthError ? wpAuthFailed(e) : e; } };

// Envuelve los manejadores para devolver errores legibles al renderer
const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
});

handle('config:get', () => publicCfg());
handle('config:set', (changes) => {
  // Si cambian los datos de la web propia, hay que volver a pulsar «Conectar»
  for (const k of ['wpMode', 'wpUrl', 'wpUser', 'wpAppPassword']) {
    if (k in changes && changes[k] !== '••••••' && String(changes[k] ?? '').trim() !== String(cfg[k] ?? '')) cfg.wpSelfOk = false;
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === '••••••') continue; // secreto sin cambios
    cfg[k] = typeof v === 'string' ? v.trim() : v; // sin espacios sobrantes al pegar claves
  }
  store.save(cfg);
  return publicCfg();
});

handle('meta:login', async () => {
  const r = await meta.login(cfg);
  cfg.metaUserToken = r.token; cfg.metaTokenExpires = r.expiresAt;
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
  if (isSelf()) {
    // Web propia: se comprueban el usuario y la contraseña de aplicación
    const r = await wpself.login(cfg);
    cfg.wpSelfOk = true; store.save(cfg);
    log(`WordPress propio: conectado como ${r.userName} a ${r.siteName}`);
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
handle('draft:build', async (posts) => {
  if (!wpIsConnected()) throw new Error('Primero conecta tu WordPress en «Conexiones».');
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
      const src = m.type === 'video' ? m.path || m.videoUrl : m.path || m.url;
      uploaded.set(key, m.path ? await WP().uploadFile(cfg, src) : (await WP().uploadFromUrls(cfg, [src]))[0]);
    } catch (e) {
      if (e instanceof wp.AuthError) throw wpAuthFailed(e); // no tiene sentido seguir con el resto
      // Un vídeo que no se puede subir (p. ej. el plan no admite vídeo) se inserta desde la red social
      if (m.type === 'video') { notes.push('video'); log('Vídeo no subido; se insertará el original:', e.message); } else failed.push(e.message);
    }
  }
  return { ...buildDraft(posts, uploaded, publicCfg().format), failed, notes };
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
    title: d.title, content: d.blocks ? composeBlocks(d.blocks) : composeContent(d.sections), status: scheduled ? 'future' : status,
    tags: d.tags.join(','), categories: d.categories.join(','),
    excerpt: d.excerpt || '',
    ...(d.featuredImageId ? { featured_image: d.featuredImageId } : {}),
    ...(scheduled ? { date: new Date(d.scheduleAt).toISOString() } : d.keepDate ? { date: d.date } : {}),
  };
}

// Vista previa real: guarda (o actualiza) la entrada como borrador y devuelve su dirección de vista previa
handle('draft:preview', async (d) => {
  const fields = postFields(d, 'draft');
  const post = await wpCall(() => (d.postId ? WP().updatePost(cfg, d.postId, fields) : WP().createPost(cfg, fields)));
  const base = WP().publicBase(cfg) || `https://${cfg.wpSite}`;
  return { postId: post.ID, previewUrl: `${base}/?p=${post.ID}&preview=true` };
});
handle('draft:compose', (blocks) => composeBlocks(blocks));

// Bandeja del editor: subir fotos o vídeos del ordenador a la biblioteca de WordPress
handle('media:upload', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Fotos y vídeos para la entrada', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Fotos y vídeos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm'] }],
  });
  if (r.canceled) return [];
  const out = [];
  for (const f of r.filePaths) {
    const up = await wpCall(() => WP().uploadFile(cfg, f));
    out.push({ ...up, alt: '', type: /\.(mp4|mov|webm)$/i.test(f) ? 'video' : 'image' });
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
handle('draft:publish', async (d) => {
  // Texto alternativo: se guarda también en la biblioteca de medios
  for (const img of d.blocks ? blockImages(d.blocks) : d.sections.flatMap((x) => x.images)) {
    if (img.alt) await wpCall(() => WP().updateMedia(cfg, img.id, { alt: img.alt })).catch((e) => log('No se pudo guardar el alt', img.id, e.message));
  }
  if (d.status === 'future' && (!d.scheduleAt || new Date(d.scheduleAt) <= new Date())) throw new Error('Elige una fecha y hora futuras para programar la entrada.');
  // Si ya se guardó como borrador para la vista previa, se actualiza esa misma entrada
  const fields = postFields(d, d.status || 'draft');
  const post = await wpCall(() => (d.postId ? WP().updatePost(cfg, d.postId, fields) : WP().createPost(cfg, fields)));
  const editUrl = editUrlFor(post.ID);
  const url = WP().publicUrl(cfg, post.URL);
  cfg.exported = cfg.exported || {};
  for (const k of d.keys || []) cfg.exported[k] = { postId: post.ID, url, editUrl, title: d.title, status: post.status, at: new Date().toISOString() };
  store.save(cfg);
  return { postId: post.ID, url, editUrl, status: post.status, date: post.date, exported: cfg.exported };
});

// --- IA ---
handle('ai:article', (input) => ai.improveArticle(cfg.ai, { ...input, extra: cfg.aiInstructions || '' }));
handle('ai:alts', (urls, context) => ai.altTexts(cfg.ai, urls, context));

// Selector de IA: cada proveedor guarda su clave, URL personalizada y modelo
const aiProv = (id) => { if (!ai.PROVIDERS[id]) throw new Error('Proveedor desconocido'); cfg.ai = cfg.ai || { providers: {} }; cfg.ai.providers = cfg.ai.providers || {}; return (cfg.ai.providers[id] = cfg.ai.providers[id] || {}); };
handle('ai:setActive', (id) => { aiProv(id); cfg.ai.active = id; store.save(cfg); return aiPublic(); });
handle('ai:save', (id, { key, url, model }) => {
  const p = aiProv(id);
  if (key && key.trim()) p.key = key.trim();          // vacío = mantener la guardada
  if (url !== undefined) p.url = url.trim();
  if (model !== undefined) p.model = model.trim();
  store.save(cfg); return aiPublic();
});
handle('ai:remove', (id) => { delete aiProv(id).key; store.save(cfg); return aiPublic(); });
handle('ai:models', (id, draftKey, draftUrl) => {
  const p = aiProv(id);
  return ai.listModels(id, { key: (draftKey || '').trim() || p.key, url: draftUrl !== undefined ? draftUrl : p.url });
});
handle('ai:test', async () => { const c = await ai.testConnection(cfg.ai); return `${ai.PROVIDERS[c.id].name} · ${c.model}`; });

// --- Copia de seguridad de la configuración ---
const BACKUP_KEYS = ['devDir', 'metaAppId', 'metaAppSecret', 'metaConfigId', 'graphVersion', 'wpMode', 'wpUrl', 'wpUser', 'wpAppPassword', 'wpSite', 'wpPublicUrl', 'wpEditor', 'wpClientId', 'wpClientSecret', 'ai', 'aiInstructions', 'format', 'templates', 'exported', 'prefs'];
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

handle('posts:merge', (list) => mergeDuplicates(list));
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
handle('blog:setStatus', async (id, status, type) => { await wpCall(() => WP().setPostStatus(cfg, id, status, type)); return markExported(id, status); });
handle('blog:trash', async (id, type) => { await wpCall(() => WP().trashPost(cfg, id, type)); return markExported(id, 'trash'); });

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
handle('blog:editUrl', (id, type) => editUrlFor(id, type));

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
handle('backup:analyze', async (paths) => {
  if (backupAn) { backupAn.sources.forEach((x) => x.close()); backupAn = null; }
  backupAn = await backupMod().analyze(paths, sendProgress);
  log(`Copia de seguridad analizada: ${backupAn.kinds.join(', ')} · ${backupAn.posts.length} entradas/páginas`);
  const done = cfg.restored || {};
  return {
    kinds: backupAn.kinds, dbFile: backupAn.dbFile, siteUrl: backupAn.siteUrl, siteName: backupAn.siteName, stats: backupAn.stats,
    posts: backupAn.posts.map((x) => ({
      key: x.key, id: x.id, type: x.type, status: x.status, title: x.title, date: x.date, slug: x.slug,
      categories: x.categories, tags: x.tags, words: x.words, media: x.media.length, mediaFound: x.mediaFound, mediaMissing: x.mediaMissing,
      excerpt: (x.excerpt || x.content).replace(/<[^>]+>|\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
      restored: done[restoredKey(x.key)] || null,
    })),
  };
});
handle('backup:thumb', async (key) => {
  const x = backupAn?.posts.find((q) => q.key === key);
  return x?.thumbRel ? backupMod().thumbnail(backupAn, x.thumbRel, require('electron').nativeImage) : null;
});
handle('backup:content', (key) => backupAn?.posts.find((q) => q.key === key)?.content || '');
// opts: { status: 'draft' | 'original', createCategories, skipExisting, download }
handle('backup:restore', async (keys, opts = {}) => {
  if (!backupAn) throw new Error('Primero abre una copia de seguridad');
  if (!wpIsConnected()) throw new Error('Primero conecta tu WordPress en «Conexiones».');
  const results = [];
  cfg.restored = cfg.restored || {};
  for (const key of keys) {
    const x = backupAn.posts.find((q) => q.key === key);
    if (!x) continue;
    sendProgress({ key, state: 'working' });
    try {
      if (opts.skipExisting !== false) {
        const existing = await wpCall(() => WP().findExisting(cfg, x.type, x.slug, x.title));
        if (existing) { results.push({ key, state: 'exists', postId: existing }); sendProgress({ key, state: 'exists', postId: existing }); continue; }
      }
      const prep = await backupMod().prepare(backupAn, x, (buf, name) => wpCall(() => WP().uploadNamed(cfg, buf, name)), { download: opts.download !== false });
      const status = opts.status === 'original' ? (['publish', 'future', 'private', 'pending', 'draft'].includes(x.status) ? x.status : 'draft') : 'draft';
      const post = await wpCall(() => WP().createPost(cfg, { ...prep.fields, status, type: x.type, createCategories: opts.createCategories !== false }));
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
handle('pty:spawn', (opts) => devterm().spawn({ ...opts, cwd: opts.cwd || cfg.devDir }, sendWin));
ipcMain.on('pty:write', (_e, id, data) => devterm().write(id, data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => devterm().resize(id, cols, rows));
handle('pty:kill', (id) => devterm().kill(id));
app.on('before-quit', () => { try { devterm().killAll(); } catch { /* sin terminales */ } });

// --- Ajustes: información, registros y restablecer ---
handle('app:info', () => ({
  version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
  platform: `${process.platform} ${process.arch}`, userData: app.getPath('userData'),
}));
handle('app:openData', () => shell.openPath(app.getPath('userData')));
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

handle('open', (url) => shell.openExternal(url));

handle('update:status', () => updater.current());
handle('update:check', () => { updater.check(); return updater.current(); });
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
    updater.init((st) => {
      if (st.state === 'error') log('Actualizador:', st.message);
      if (!mainWin.isDestroyed()) mainWin.webContents.send('update:status', { version: app.getVersion(), ...st });
    });
  });
}).catch(fatal);
app.on('window-all-closed', () => app.quit());
