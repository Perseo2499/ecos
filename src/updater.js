// Actualizaciones automáticas desde las Releases de GitHub (solo en la versión instalada, no en la portable).
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let send = () => {};
let lastStatus = { state: 'idle' };
const status = (s) => { lastStatus = s; send(s); };

const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;
const canUpdate = () => app.isPackaged && !isPortable();

function init(sendToRenderer) {
  send = sendToRenderer;
  if (!canUpdate()) {
    status({ state: 'unsupported', reason: isPortable() ? 'portable' : 'dev' });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => status({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => status({ state: 'latest' }));
  autoUpdater.on('update-available', (i) => status({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => status({ ...lastStatus, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => status({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => status({ state: 'error', message: e.message.split('\n')[0] }));
  check();
  setInterval(check, 4 * 60 * 60 * 1000); // y cada 4 horas
}

function check() {
  if (!canUpdate()) return lastStatus;
  autoUpdater.checkForUpdates().catch(() => {}); // el error llega por el evento 'error'
  return lastStatus;
}

const install = () => autoUpdater.quitAndInstall(false, true);
const current = () => ({ version: app.getVersion(), ...lastStatus });

module.exports = { init, check, install, current };
