// Abre una ventana de inicio de sesión y captura la redirección final.
const { BrowserWindow } = require('electron');

function openAuthWindow(authUrl, redirectPrefix) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 600, height: 760, autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    let done = false;
    const check = (event, url) => {
      if (!url.startsWith(redirectPrefix)) return;
      if (event) event.preventDefault();
      done = true;
      const u = new URL(url);
      const params = new URLSearchParams(u.hash ? u.hash.slice(1) : '');
      u.searchParams.forEach((v, k) => params.set(k, v));
      win.close();
      if (params.get('error')) reject(new Error(params.get('error_description') || params.get('error')));
      else resolve(params);
    };
    win.webContents.on('will-redirect', check);
    win.webContents.on('will-navigate', check);
    win.webContents.on('did-navigate', (_e, url) => check(null, url));
    win.on('closed', () => { if (!done) reject(new Error('Ventana de inicio de sesión cerrada')); });
    win.loadURL(authUrl);
  });
}

module.exports = { openAuthWindow };
