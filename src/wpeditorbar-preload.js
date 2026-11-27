// Preload de la barra superior de la ventana del editor de WordPress (src/wpeditorwin.js): solo dos mensajes hacia la app.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wpedBar', {
  send: (action) => { if (action === 'done' || action === 'cancel') ipcRenderer.send('wped:bar', action); },
  onState: (cb) => ipcRenderer.on('wped:state', (_e, s) => cb(s || {})),
});
