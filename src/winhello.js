// Windows Hello (huella, cara o PIN de Windows) para desbloquear Ecos.
// Un pequeño programa en C# (src/winhello.cs) usa KeyCredentialManager: Windows Hello firma un reto con una
// clave guardada en el TPM del ordenador; de esa firma (RSA PKCS#1, siempre la misma para el mismo reto) sale
// la llave que abre la copia de la llave de la bóveda. Sin Windows Hello no hay llave.
// El programa se compila en GitHub y va con el instalador (resources/winhello.exe); si faltara, se compila
// aquí con el compilador de .NET Framework que trae Windows.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Orden de compilación (la misma que usa GitHub): sin «await», solo .NET Framework y los metadatos de Windows
function cscArgs(src, out) {
  const win = process.env.WINDIR || 'C:\\Windows';
  const md = path.join(win, 'System32', 'WinMetadata');
  const gac = path.join(win, 'Microsoft.NET', 'assembly', 'GAC_MSIL', 'System.Runtime');
  const ver = fs.readdirSync(gac).find((d) => d.startsWith('v4.0'));
  return ['/nologo', '/target:exe', '/platform:anycpu', `/out:${out}`,
    `/r:${path.join(md, 'Windows.Security.winmd')}`, `/r:${path.join(md, 'Windows.Foundation.winmd')}`, `/r:${path.join(md, 'Windows.Storage.winmd')}`,
    `/r:${path.join(gac, ver, 'System.Runtime.dll')}`, src];
}
function helperPath() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'winhello.exe');
  if (packaged && fs.existsSync(packaged)) return packaged;
  // sin instalador (desarrollo) o si faltara: se compila una vez en la carpeta de datos
  const { app } = require('electron');
  const out = path.join(app.getPath('userData'), 'winhello.exe');
  if (fs.existsSync(out)) return out;
  const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-hello-'));
  const src = path.join(dir, 'winhello.cs');
  fs.writeFileSync(src, fs.readFileSync(path.join(__dirname, 'winhello.cs')));
  try { execFileSync(csc, cscArgs(src, out), { windowsHide: true, timeout: 60000 }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return out;
}

function run(mode, challengeB64 = '') {
  if (process.platform !== 'win32') return Promise.resolve({ error: 'unsupported' });
  let exe;
  try { exe = helperPath(); } catch (e) { return Promise.resolve({ error: 'exception', detail: 'no se pudo preparar Windows Hello: ' + e.message }); }
  return new Promise((resolve) => {
    const p = spawn(exe, [mode, challengeB64], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => p.kill(), 120000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); resolve({ error: 'exception', detail: e.message }); });
    p.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || '';
      try { resolve(JSON.parse(line)); } catch { resolve({ error: 'exception', detail: (err || out).trim().slice(0, 300) }); }
    });
  });
}

const ERRORS = {
  unsupported: 'Windows Hello no está configurado en este ordenador (Configuración de Windows → Cuentas → Opciones de inicio de sesión).',
  nokey: 'Windows Hello ya no tiene la clave de Ecos. Entra con la contraseña y vuelve a activarlo en Ajustes → Seguridad.',
  UserCanceled: 'Has cancelado Windows Hello.',
  NotFound: 'Windows Hello no encuentra la clave de Ecos.',
  UserPrefersPassword: 'Has elegido usar la contraseña.',
  SecurityDeviceLocked: 'El dispositivo de seguridad está bloqueado por demasiados intentos.',
};
const explain = (r) => ERRORS[r.error] || `Windows Hello no ha funcionado (${r.error}${r.detail ? ': ' + r.detail : ''}).`;

let supportedCache = null;
async function supported() {
  if (process.platform !== 'win32') return false;
  if (supportedCache === null) supportedCache = !!(await run('check')).supported;
  return supportedCache;
}
// Firma el reto con Windows Hello y devuelve la llave (32 bytes) derivada de la firma
async function keyFor(challengeB64, enroll = false) {
  const r = await run(enroll ? 'enroll' : 'sign', challengeB64);
  if (!r.signature) throw new Error(explain(r));
  return crypto.createHash('sha256').update('ecos-winhello-v1').update(Buffer.from(r.signature, 'base64')).digest();
}

module.exports = { supported, keyFor, run, cscArgs };
