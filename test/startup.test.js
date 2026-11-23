// Arranque: main.js se carga entero con un Electron simulado. Detecta errores al registrar los manejadores
// (p. ej. «Cannot access 'handle' before initialization», que impedía abrir la app en la 2.42–2.45).
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const os = require('os');
const path = require('path');

test('main.js se carga sin errores (todos los manejadores se registran después de definirse)', () => {
  const tmp = require('fs').mkdtempSync(path.join(os.tmpdir(), 'ecos-start-'));
  const registered = [];
  const noop = () => {};
  const evt = () => ({ on: noop, once: noop, handle: noop, removeHandler: noop });
  const fakeApp = Object.assign(evt(), {
    getPath: () => tmp, getVersion: () => '0.0.0', getName: () => 'Ecos', isPackaged: false, getLocale: () => 'es',
    requestSingleInstanceLock: () => true, whenReady: () => new Promise(noop), setAppUserModelId: noop, exit: noop, quit: noop,
    commandLine: { appendSwitch: noop }, disableHardwareAcceleration: noop, setAsDefaultProtocolClient: noop, isReady: () => false,
  });
  const electron = new Proxy({
    app: new Proxy(fakeApp, { get: (o, k) => (k in o ? o[k] : noop) }),
    ipcMain: { handle: (n) => registered.push(n), on: noop, removeHandler: noop, once: noop },
    dialog: { showErrorBox: (t, m) => { throw new Error('Diálogo de error al arrancar: ' + m); } },
    BrowserWindow: function () {}, shell: {}, Menu: { setApplicationMenu: noop, buildFromTemplate: () => ({ popup: noop }) },
    nativeImage: {}, safeStorage: { isEncryptionAvailable: () => false }, session: {}, protocol: { registerSchemesAsPrivileged: noop }, nativeTheme: { on: noop },
    powerMonitor: { on: noop }, screen: {}, net: {}, webContents: {}, crashReporter: { start: noop }, systemPreferences: {}, clipboard: {},
  }, { get: (o, k) => (k in o ? o[k] : new Proxy(function () {}, { get: () => noop })) });
  const orig = Module._load;
  const origOn = process.on;
  Module._load = function (req, ...rest) { if (req === 'electron') return electron; return orig.call(this, req, ...rest); };
  process.on = function () { return process; }; // sin manejadores globales de la app durante la prueba
  try {
    delete require.cache[require.resolve('../main.js')];
    require('../main.js');
  } finally { Module._load = orig; process.on = origOn; }
  assert.ok(registered.includes('config:get'), 'se registran los manejadores');
  assert.ok(registered.includes('helper:check'), 'incluidos los del complemento');
});
