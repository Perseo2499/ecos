// Actualizaciones automáticas desde las Releases de GitHub (solo en la versión instalada, no en la portable).
// Canal estable: una versión publicada hace menos de 24 h espera (src/updatepolicy.js). Canal de pruebas: inmediata.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { holdUntil } = require('./updatepolicy');

const EVERY_MS = 4 * 60 * 60 * 1000;
let send = () => {};
let lastStatus = { state: 'idle' };
let beta = false;
let nextCheckAt = 0;
let holdTimer = null;
// Notas de la release (electron-updater las da como texto/HTML o como lista por versión)
const notesOf = (i) => {
  const n = i && i.releaseNotes;
  if (!n) return '';
  const txt = Array.isArray(n) ? n.map((x) => x && x.note).filter(Boolean).join('\n') : String(n);
  return txt.slice(0, 20000);
};
const extra = () => ({ channel: beta ? 'beta' : 'stable', nextCheckAt });
const status = (s) => { lastStatus = s; send({ ...s, ...extra() }); };

const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;
const canUpdate = () => app.isPackaged && !isPortable();

function init(sendToRenderer) {
  send = sendToRenderer;
  if (!canUpdate()) {
    status({ state: 'unsupported', reason: isPortable() ? 'portable' : 'dev' });
    return;
  }
  autoUpdater.autoDownload = false; // se decide al llegar «update-available» (retraso del canal estable)
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = beta;
  autoUpdater.on('checking-for-update', () => status({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => status({ state: 'latest' }));
  autoUpdater.on('update-available', (i) => {
    // al pulsar «Buscar actualizaciones» a mano se descarga ya, sin esperar las 24 h del canal estable
    const until = manualNext ? 0 : holdUntil(i.releaseDate, beta);
    manualNext = false;
    if (until) {
      status({ state: 'waiting', version: i.version, until, notes: notesOf(i) });
      clearTimeout(holdTimer);
      holdTimer = setTimeout(check, Math.min(until - Date.now() + 60 * 1000, EVERY_MS)); // se reintenta más tarde
      return;
    }
    status({ state: 'downloading', version: i.version, percent: 0, notes: notesOf(i) });
    autoUpdater.downloadUpdate().catch(() => {}); // el error llega por el evento 'error'
  });
  autoUpdater.on('download-progress', (p) => status({ ...lastStatus, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => status({ state: 'ready', version: i.version, notes: notesOf(i) || lastStatus.notes || '' }));
  autoUpdater.on('error', (e) => {
    const msg = e.message.split('\n')[0];
    // 404: GitHub no deja ver las versiones (repositorio privado) o aún no hay ninguna publicada
    status({ state: 'error', message: /\b404\b/.test(msg) ? 'no se encuentran las versiones en GitHub (el repositorio tiene que ser público)' : msg });
  });
  check();
  setInterval(check, EVERY_MS); // y cada 4 horas
}

let manualNext = false;
function check(manual = false) {
  if (!canUpdate()) return current();
  if (manual === true) manualNext = true;
  nextCheckAt = Date.now() + EVERY_MS;
  autoUpdater.allowPrerelease = beta;
  autoUpdater.checkForUpdates().catch(() => {}); // el error llega por el evento 'error'
  return current();
}

// Canal de pruebas (Ajustes → Avanzado)
function setBeta(on) {
  const v = !!on;
  if (v === beta) return;
  beta = v;
  if (canUpdate() && lastStatus.state !== 'idle') check();
}

const install = () => autoUpdater.quitAndInstall(false, true);
const current = () => ({ version: app.getVersion(), ...lastStatus, ...extra() });

module.exports = { notesOf, init, check, install, current, setBeta };
