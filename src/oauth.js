// Inicio de sesión en el navegador predeterminado del sistema (donde ya tienes tus cuentas abiertas).
// Ecos abre la página de autorización con shell.openExternal y escucha la vuelta en
// http://localhost:53682/<ruta> con un pequeño servidor local que solo vive durante el inicio de sesión.
const http = require('http');
const crypto = require('crypto');
const { shell, BrowserWindow } = require('electron');

const PORT = 53682;
const TIMEOUT_MS = 5 * 60 * 1000;
const redirectUri = (name) => `http://localhost:${PORT}/${name}`;

const page = (title, msg) => `<!doctype html><html lang="es"><meta charset="utf-8"><title>Ecos</title>
<body style="font:16px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f6f5f2;color:#1f2328">
<div style="text-align:center;max-width:420px"><h1 style="font-size:22px">${title}</h1><p>${msg}</p></div></body></html>`;

let active = null; // solo un inicio de sesión a la vez

// authUrlFor(state) devuelve la URL de autorización. Resuelve con los parámetros de la vuelta (URLSearchParams).
function loginInBrowser(name, authUrlFor) {
  if (active) active.cancel(new Error('Se ha iniciado otro inicio de sesión'));
  const state = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const servers = [];
    let timer;
    const finish = (err, params) => {
      clearTimeout(timer);
      // closeAllConnections: que una conexión keep-alive del navegador no se quede pegada a este servidor
      servers.forEach((s) => { s.close(); s.closeAllConnections(); });
      active = null;
      const win = BrowserWindow.getAllWindows()[0];
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
      err ? reject(err) : resolve(params);
    };
    active = { cancel: (err) => finish(err) };

    const handler = (req, res) => {
      const u = new URL(req.url, redirectUri(name));
      if (u.pathname !== `/${name}`) { res.writeHead(404, { Connection: 'close' }).end(); return; }
      const p = u.searchParams;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      if (p.get('error')) {
        res.end(page('No se ha podido conectar', 'Vuelve a Ecos para ver el motivo.'));
        return finish(new Error(p.get('error_description') || p.get('error_message') || p.get('error')));
      }
      if (p.get('state') !== state) {
        res.end(page('Respuesta no válida', 'Vuelve a Ecos e inténtalo de nuevo.'));
        return finish(new Error('La respuesta de inicio de sesión no coincide (state). Inténtalo de nuevo.'));
      }
      res.end(page('¡Conectado!', 'Ya puedes cerrar esta pestaña y volver a Ecos.'));
      finish(null, p);
    };

    // Escucha en IPv4 e IPv6, porque «localhost» puede resolver a cualquiera de los dos
    let pending = 2, listening = 0;
    const onDone = () => {
      if (--pending > 0) return;
      if (!listening) return finish(new Error(`El puerto ${PORT} está ocupado. Cierra otras copias de Ecos e inténtalo de nuevo.`));
      timer = setTimeout(() => finish(new Error('Se ha agotado el tiempo para iniciar sesión (5 minutos)')), TIMEOUT_MS);
      shell.openExternal(authUrlFor(state));
    };
    for (const host of ['127.0.0.1', '::1']) {
      const srv = http.createServer(handler);
      srv.once('error', onDone);
      srv.listen(PORT, host, () => { listening++; servers.push(srv); onDone(); });
    }
  });
}

module.exports = { loginInBrowser, redirectUri };
