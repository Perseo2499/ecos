// Informes de errores de Ecos: opcionales, anónimos y sin servidor propio. Cuando ocurre un fallo inesperado se guarda un informe
// LOCAL (fecha, versión, sistema, mensaje y pila saneados) en userData/crash-reports.json; el usuario decide si lo envía abriendo
// una incidencia de GitHub ya rellenada (la revisa y la envía él). No se manda nada solo. Sin dependencias de Electron.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { redact } = require('./logger');

const REPO_NEW_ISSUE = 'https://github.com/Perseo2499/ecos/issues/new';
const DEDUPE_MS = 24 * 3600 * 1000;
const MAX_REPORTS = 50;
const MAX_BODY = 6000;
const MAX_URL = 7500; // GitHub rechaza direcciones muy largas

// Quita lo personal: rutas de usuario (C:\Users\nombre → ~), direcciones con claves, correos y secretos
function sanitize(input) {
  let s = redact(String(input == null ? '' : input));
  s = s.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s:'")\]]+/gi, '~');           // C:\Users\ana  ·  C:/Users/ana
  s = s.replace(/\\\\[^\\\s]+\\[^\\\s]+\\Users\\[^\\\s]+/gi, '~');               // \\equipo\recurso\Users\ana
  s = s.replace(/\/Users\/[^/\s:'")\]]+/g, '~');                                   // macOS
  s = s.replace(/\/home\/[^/\s:'")\]]+/g, '~');                                    // Linux
  s = s.replace(/file:\/\/\/?~/gi, '~');
  s = s.replace(/(https?:\/\/[^\s?#'"<>)]+)\?[^\s'"<>)]*/gi, '$1?…');            // fuera la parte «?token=…» de las direcciones
  s = s.replace(/#access_token=[^\s'"]+/gi, '#…');
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[correo]');
  return s;
}

const baseName = (f) => String(f || '').replace(/\\/g, '/').split('/').pop();
// Firma: identifica «el mismo fallo» aunque cambien números, rutas o identificadores
function signature(message, stack) {
  const norm = (s) => String(s || '').replace(/0x[0-9a-f]+/gi, '#').replace(/\b[0-9a-f]{8,}\b/gi, '#').replace(/\d+/g, '#').replace(/["'`][^"'`]{0,80}["'`]/g, '"…"').replace(/\s+/g, ' ').trim().slice(0, 160);
  const frames = String(stack || '').split('\n').map((l) => l.trim()).filter((l) => /^at\s|\(.*:\d+:\d+\)|\w+\.js:\d+/.test(l)).slice(0, 3)
    .map((l) => { const m = /([\w.-]+\.(?:js|html)):\d+/.exec(l.replace(/\\/g, '/')); const fn = /^at\s+([^\s(]+)\s*\(/.exec(l); return (fn ? fn[1] : '') + '@' + (m ? m[1] : baseName(l)); });
  return crypto.createHash('sha1').update(norm(message) + '|' + frames.join('|')).digest('hex').slice(0, 12);
}

// Quita el mensaje de una línea de registro y separa pila: primera línea = mensaje; el resto, pila
function split(text) {
  const lines = String(text || '').split('\n');
  return { message: (lines.shift() || '').trim(), stack: lines.join('\n').trim() };
}

function makeReport({ source = 'main', message = '', stack = '', version = '', os = '', now = new Date() }) {
  const m = sanitize(message).replace(/\s+/g, ' ').trim().slice(0, 500);
  const st = sanitize(stack).split('\n').slice(0, 25).map((l) => l.slice(0, 240)).join('\n');
  return { id: crypto.randomBytes(5).toString('hex'), at: now.toISOString(), source: String(source).slice(0, 20), version: String(version).slice(0, 30), os: String(os).slice(0, 80), message: m, stack: st, sig: signature(m, st), count: 1, sent: false };
}

function issueTitle(r) { return `Fallo: ${r.message.slice(0, 90)}`; }
function issueBody(r, max = MAX_BODY) {
  const head = `**Informe automático de Ecos (revisado por mí antes de enviar)**\n\n- Versión: ${r.version}\n- Sistema: ${r.os}\n- Origen: ${r.source}\n- Fecha: ${r.at}\n- Veces: ${r.count}\n\n**Mensaje**\n\n\`\`\`\n${r.message}\n\`\`\`\n\n**Pila**\n\n\`\`\`\n`;
  const tail = '\n```\n\n**Qué estaba haciendo** (opcional):\n';
  const room = Math.max(0, max - head.length - tail.length);
  let stack = r.stack;
  if (stack.length > room) stack = stack.slice(0, Math.max(0, room - 12)) + '\n…(recortado)';
  return (head + stack + tail).slice(0, max);
}
// Incidencia prellenada; el cuerpo se recorta a ~6000 caracteres y, si aun así la dirección es demasiado larga, más
function buildIssueUrl(r) {
  let max = MAX_BODY, url;
  for (let i = 0; i < 12; i++) {
    url = `${REPO_NEW_ISSUE}?title=${encodeURIComponent(issueTitle(r))}&body=${encodeURIComponent(issueBody(r, max))}`;
    if (url.length <= MAX_URL) return url;
    max = Math.floor(max * 0.75);
  }
  return url;
}
function reportText(r) { return `${issueTitle(r)}\n\n${issueBody(r, 20000).replace(/\*\*/g, '')}`; }

function createStore({ file, now = () => new Date(), fsMod = fs }) {
  const read = () => { try { const d = JSON.parse(fsMod.readFileSync(file, 'utf8')); return Array.isArray(d) ? d : []; } catch { return []; } };
  const write = (list) => { try { fsMod.mkdirSync(path.dirname(file), { recursive: true }); fsMod.writeFileSync(file, JSON.stringify(list.slice(0, MAX_REPORTS))); } catch { /* sin disco */ } };
  // → { report, duplicate }. El mismo fallo (misma firma) no se repite en 24 h: solo sube su contador.
  function add(info) {
    const list = read(), r = makeReport({ ...info, now: now() });
    const prev = list.find((x) => x.sig === r.sig && now() - new Date(x.at) < DEDUPE_MS);
    if (prev) { prev.count = (prev.count || 1) + 1; write(list); return { report: prev, duplicate: true }; }
    list.unshift(r); write(list);
    return { report: r, duplicate: false };
  }
  return {
    add, list: read, get: (id) => read().find((x) => x.id === id) || null,
    remove: (id) => { const l = read(), n = l.filter((x) => x.id !== id); write(n); return n.length !== l.length; },
    clear: () => write([]),
    markSent: (id) => { const l = read(), r = l.find((x) => x.id === id); if (r) { r.sent = true; write(l); } },
  };
}

module.exports = { sanitize, signature, split, makeReport, issueTitle, issueBody, buildIssueUrl, reportText, createStore, REPO_NEW_ISSUE, MAX_BODY, DEDUPE_MS };
