const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const store = require('./src/store');
const meta = require('./src/meta');
const wp = require('./src/wpcom');
const { buildDraft, mediaKey } = require('./src/transform');
const importers = require('./src/importers');

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

app.whenReady().then(() => {
  cfg = { wpSite: 'asociacionelin.com', graphVersion: 'v23.0', ...store.load() };
  createWindow();
});
app.on('window-all-closed', () => app.quit());
