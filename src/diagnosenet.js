// Comprobaciones de red reales para el diagnóstico (DNS, TCP, TLS, HTTP) y la lectura del entorno de la web.
// La lógica (qué es un fallo y qué hacer) está en renderer/diagnose.js y renderer/webenv.js, que son puras y probadas.
const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');

const withTimeout = (p, ms, what) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Object.assign(new Error(`${what} ha tardado más de ${ms / 1000} s (timeout)`), { code: 'ETIMEDOUT' })), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

const lookup = (host) => withTimeout(dns.lookup(host, { all: true }), 8000, 'La búsqueda DNS');
function tcp(host, port = 443, ms = 8000) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.setTimeout(ms, () => { s.destroy(); reject(Object.assign(new Error('La conexión ha tardado demasiado (timeout)'), { code: 'ETIMEDOUT' })); });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', (e) => { s.destroy(); reject(e); });
  });
}
// Lee el certificado sin rechazarlo (para poder explicar qué le pasa)
function tlsInfo(host, ms = 8000) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate();
      const info = { validTo: c && c.valid_to, san: c && c.subjectaltname, subject: c && c.subject && c.subject.CN, authorized: s.authorized, authorizationError: s.authorizationError ? String(s.authorizationError) : '' };
      s.end(); resolve(info);
    });
    s.setTimeout(ms, () => { s.destroy(); reject(Object.assign(new Error('La conexión segura ha tardado demasiado (timeout)'), { code: 'ETIMEDOUT' })); });
    s.once('error', (e) => { s.destroy(); reject(e); });
  });
}

const authHeader = (cfg) => 'Basic ' + Buffer.from(`${(cfg.wpUser || '').trim()}:${(cfg.wpAppPassword || '').replace(/\s+/g, '')}`).toString('base64');
async function http(cfg, url, { auth = false, ms = 15000 } = {}) {
  const ctl = new AbortController(), t0 = Date.now();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { ...(auth ? { Authorization: authHeader(cfg) } : {}), 'User-Agent': 'Ecos', Accept: 'application/json, text/html;q=0.8' }, signal: ctl.signal, redirect: 'follow' });
    const text = (await res.text()).slice(0, 200000);
    return { status: res.status, headers: Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])), text, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

function makeDeps(cfg, { proxy, meta, gphotos, ai } = {}) {
  return { dns: lookup, tcp: (h, p) => tcp(h, p), tls: (h) => tlsInfo(h), http: (u, o) => http(cfg, u, o), proxy, meta, gphotos, ai, now: () => Date.now() };
}

// Lee el entorno de la web: complemento (si está) + raíz de /wp-json + cabeceras de la portada
async function collectEnv(cfg, WebEnv) {
  const origin = (() => { const raw = (cfg.wpUrl || '').trim(); return new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).origin; })();
  let status = null, rootJson = null, headers = {};
  try { const r = await http(cfg, origin + '/wp-json/ecos/v1/status', { auth: true, ms: 12000 }); if (r.status === 200) status = JSON.parse(r.text); headers = r.headers; } catch { /* sin complemento */ }
  try { const r = await http(cfg, origin + '/wp-json/', { ms: 12000 }); if (r.status === 200) rootJson = JSON.parse(r.text); headers = { ...r.headers, ...headers }; } catch { /* sin API */ }
  return WebEnv.parseEnv(status, rootJson, headers);
}

module.exports = { makeDeps, collectEnv, lookup, tcp, tlsInfo, http };
