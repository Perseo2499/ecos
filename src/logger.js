// Registro de errores y avisos de Ecos: userData/logs/ecos.log, con rotación (máx. 1 MB; la copia anterior queda en
// ecos.log.1) y sin datos sensibles (tokens, contraseñas, contraseñas de aplicación de WordPress). Sin dependencias de Electron.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const MASK = '[oculto]';

// Quita de un texto lo que no debe quedar escrito en el registro ni salir en un informe de errores
function redact(input) {
  let s = String(input == null ? '' : input);
  // Cabeceras: Authorization: Basic xxx / Bearer xxx, y otras cabeceras con claves
  s = s.replace(/(authorization["']?\s*[:=]\s*["']?)(?:(?:basic|bearer|token)\s+)?[^\s"',;}]+/gi, (m, p) => p + MASK);
  s = s.replace(/(x-[a-z-]*(?:key|token|secret|auth)[a-z-]*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, (m, p) => p + MASK);
  // «Bearer xxxxx» suelto
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/g, 'Bearer ' + MASK);
  // access_token=…, refresh_token=…, token=…, password=…, client_secret=…, api_key=… (en URL, formulario o texto) y en JSON
  const KEYS = '(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|pwd|contrase(?:ñ|n)a|client[_-]?secret|secret|api[_-]?key|apikey|app[_-]?password)';
  s = s.replace(new RegExp(`(["']?\\b${KEYS}["']?\\s*[=:]\\s*["']?)[^\\s"'&,;}]+`, 'gi'), (m, p) => p + MASK);
  // Contraseña de aplicación de WordPress: seis grupos de cuatro caracteres separados por espacios
  s = s.replace(/\b[A-Za-z0-9]{4}(?: [A-Za-z0-9]{4}){5}\b/g, MASK);
  // Claves con prefijo conocido (Anthropic, OpenAI, Google, GitHub, Meta)
  s = s.replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{30,}|ya29\.[A-Za-z0-9._-]{20,})/g, MASK);
  // Dirección con usuario y contraseña: https://usuario:clave@sitio
  s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, `$1${MASK}@`);
  return s;
}

function format(args) {
  return args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  }).join(' ');
}

function createLogger({ file, maxBytes = MAX_BYTES, now = () => new Date() }) {
  const old = file + '.1';
  function rotate(incoming) {
    let size = 0;
    try { size = fs.statSync(file).size; } catch { return; }
    if (size + incoming <= maxBytes) return;
    try { fs.rmSync(old, { force: true }); } catch { /* nada */ }
    try { fs.renameSync(file, old); } catch { /* nada */ }
  }
  function write(level, ...args) {
    const text = redact(format(args)).replace(/\r?\n/g, '\n    ');
    const line = `[${now().toISOString()}] [${level}] ${text}\n`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      rotate(Buffer.byteLength(line));
      fs.appendFileSync(file, line);
    } catch { /* sin registro */ }
    return line;
  }
  // Las últimas n líneas (completando con la copia anterior si hace falta); las continuaciones de una línea van sangradas
  function tail(n = 200) {
    const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
    const lines = (read(old) + read(file)).split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-Math.max(1, n)).join('\n');
  }
  function clear() { for (const f of [file, old]) { try { fs.rmSync(f, { force: true }); } catch { /* nada */ } } }
  return { file, dir: path.dirname(file), write, tail, clear, info: (...a) => write('INFO', ...a), warn: (...a) => write('AVISO', ...a), error: (...a) => write('ERROR', ...a) };
}

module.exports = { createLogger, redact, MAX_BYTES, MASK };
