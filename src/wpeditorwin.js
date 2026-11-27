// Ventana del editor de WordPress (Gutenberg) dentro de Ecos. Los bloques de otros plugins (Spectra, Kadence…) solo funcionan dentro de
// la propia web (su JavaScript está allí), así que se abre el editor de la web en una ventana modal de Electron:
//   · sin Node (nodeIntegration desactivado, aislamiento de contexto y sandbox) y sin el preload de la app,
//   · en la partición persistente «persist:wpadmin» (las cookies de la web viven solo ahí; la sesión se recuerda),
//   · solo navega por el dominio de la web; cualquier otro enlace o ventana nueva va al navegador,
//   · con una barra propia arriba («Cancelar» y «Terminar y volver a Ecos»).
// Nunca se escribe en el registro la dirección que se abre (la de un solo uso lleva el token).
const path = require('path');

const PARTITION = 'persist:wpadmin';

function create({ electron, W, wped, getCfg, getParent, getHelperVersion, log = () => {}, openExternal = () => {}, barFile, barPreload }) {
  const { BrowserWindow, WebContentsView, ipcMain } = electron;
  barFile = barFile || path.join(__dirname, '..', 'renderer', 'wped-bar.html');
  barPreload = barPreload || path.join(__dirname, 'wpeditorbar-preload.js');
  let cur = null; // la ventana abierta ahora: { bar, fire }

  ipcMain.on('wped:bar', (e, action) => { if (cur && e.sender === cur.bar.webContents && (action === 'done' || action === 'cancel')) cur.fire(action); });

  // Abre la ventana. Devuelve { wc, next(): Promise<'done'|'cancel'>, state(s), close() }
  function open({ url, siteOrigin, labels = {}, colors = {}, hint = '' }) {
    if (cur) throw new Error('Ya hay un editor de WordPress abierto: termínalo o ciérralo primero.');
    const parent = getParent && getParent();
    const pb = parent && !parent.isDestroyed() ? parent.getBounds() : { x: undefined, y: undefined, width: 1280, height: 860 };
    const win = new BrowserWindow({
      parent: parent && !parent.isDestroyed() ? parent : undefined, modal: !!(parent && !parent.isDestroyed()), show: false,
      x: pb.x, y: pb.y, width: pb.width, height: pb.height, minWidth: 720, minHeight: 480, autoHideMenuBar: true,
      title: labels.title || 'WordPress',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    win.removeMenu?.();
    const BAR_H = 52;
    const page = new WebContentsView({ webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false } });
    const bar = new WebContentsView({ webPreferences: { preload: barPreload, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.contentView.addChildView(page);
    win.contentView.addChildView(bar);
    const layout = () => {
      if (win.isDestroyed()) return;
      const [w, h] = win.getContentSize();
      bar.setBounds({ x: 0, y: 0, width: w, height: BAR_H });
      page.setBounds({ x: 0, y: BAR_H, width: w, height: Math.max(0, h - BAR_H) });
    };
    layout(); win.on('resize', layout);

    const wc = page.webContents;
    // Seguridad de la página de WordPress
    try { electron.session.fromPartition(PARTITION).setPermissionRequestHandler((_w, _p, cb) => cb(false)); } catch { /* sin sesión */ }
    wc.setWindowOpenHandler(({ url: u }) => { if (/^https?:/i.test(u)) openExternal(u); return { action: 'deny' }; });
    const guard = (e, u) => { if (!wped.inScope(u, siteOrigin)) { e.preventDefault(); if (/^https?:/i.test(u)) openExternal(u); } };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-prevent-unload', (e) => e.preventDefault()); // Gutenberg avisa «tienes cambios sin guardar»: se cierra igualmente
    wc.on('did-fail-load', (_e, code, desc, _u, isMain) => { if (isMain && code !== -3) { log('Editor de WordPress: no cargó (' + code + ' ' + desc + ')'); fire('cancel'); } });

    let waiter = null, queued = null, closed = false;
    const fire = (a) => { if (waiter) { const w = waiter; waiter = null; w(a); } else queued = a; };
    cur = { bar, fire };
    // Las vistas no se destruyen solas con la ventana: se cierran sus páginas para no dejar procesos ni sesiones abiertas
    const dispose = () => { for (const v of [page, bar]) { try { if (!v.webContents.isDestroyed()) v.webContents.close({ waitForBeforeUnload: false }); } catch { /* ya cerrada */ } } };
    win.on('closed', () => { closed = true; cur = null; dispose(); fire('cancel'); });
    const barQuery = JSON.stringify({ title: labels.title, done: labels.done, cancel: labels.cancel, hint, bg: colors.bg, fg: colors.fg, accent: colors.accent, on: colors.on });
    bar.webContents.loadFile(barFile, { query: { p: barQuery } }).catch(() => {});
    wc.loadURL(url).catch(() => {}); // los fallos de carga se ven en did-fail-load
    win.once('ready-to-show', () => win.show());
    setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 1500);

    return {
      wc, win,
      next: () => new Promise((res) => { if (queued) { const q = queued; queued = null; res(q); } else waiter = res; }),
      state: (s) => { if (!bar.webContents.isDestroyed()) bar.webContents.send('wped:state', s); },
      close: () => { if (!closed && !win.isDestroyed()) { win.removeAllListeners('closed'); cur = null; closed = true; dispose(); win.destroy(); } },
      isClosed: () => closed,
    };
  }

  // Guarda lo que haya en el editor de la ventana. Devuelve { ok, error? }
  async function save(h) {
    try { return (await h.wc.executeJavaScript(wped.SAVE_SCRIPT, true)) || { ok: false, error: 'sin-respuesta' }; }
    catch (e) { return { ok: false, error: 'script' }; }
  }

  // Espera «Terminar» o «Cancelar»; con «Terminar» guarda y, si falla, avisa en la barra y deja reintentar o cancelar.
  async function waitAndSave(h, labels) {
    for (;;) {
      const act = await h.next();
      if (act === 'cancel' || h.isClosed()) return 'cancel';
      h.state({ busy: true, msg: labels.saving || '' });
      const r = await save(h);
      if (r.ok) return 'done';
      h.state({ busy: false, error: true, msg: r.error === 'editor-not-ready' ? (labels.notReady || 'El editor aún no ha cargado.') : (labels.saveFailed || 'No se pudo guardar.') });
    }
  }

  function ctx(labels) {
    const cfg = getCfg();
    const site = W.publicBase(cfg);
    if (!site) throw new Error('Escribe la dirección de tu web (Conexiones → WordPress)');
    return { cfg, site, labels: labels || {} };
  }

  // Editar con el editor de WordPress el contenido `markup` (vacío = bloque nuevo). Devuelve { cancelled: true } o { content }
  async function editMarkup({ markup = '', labels, colors }) {
    const { cfg, site } = ctx(labels);
    const temp = await wped.createTemp(W, cfg, markup);
    let h = null;
    try {
      const s = await wped.sessionUrl(W, cfg, wped.targetFor(temp.id), await getHelperVersion());
      h = open({ url: s.url, siteOrigin: site, labels, colors, hint: s.oneTime ? '' : (labels?.loginHint || '') });
      const act = await waitAndSave(h, labels || {});
      if (act === 'cancel') return { cancelled: true };
      const r = await wped.readContent(W, cfg, temp.id);
      return { content: r.content };
    } finally {
      if (h) h.close();
      if (!(await wped.deleteTemp(W, getCfg(), temp.id))) log('Editor de WordPress: no se pudo borrar el borrador temporal', temp.id);
    }
  }

  // Editar una entrada o página entera en su propio post.php. Devuelve { cancelled: true } o { done: true }
  async function editPost({ postId, labels, colors }) {
    const { cfg, site } = ctx(labels);
    const s = await wped.sessionUrl(W, cfg, wped.targetFor(postId), await getHelperVersion());
    const h = open({ url: s.url, siteOrigin: site, labels, colors, hint: s.oneTime ? '' : (labels?.loginHint || '') });
    try {
      const act = await waitAndSave(h, labels || {});
      return act === 'cancel' ? { cancelled: true } : { done: true };
    } finally { h.close(); }
  }

  return { editMarkup, editPost, isOpen: () => !!cur };
}

module.exports = { create, PARTITION };
