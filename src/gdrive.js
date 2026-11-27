// Ecos · Copias en Google Drive con el alcance «drive.file» (solo ve los archivos que crea Ecos, no tu Drive).
// Usa el mismo ID de cliente de Google que Google Fotos (Conexiones → Google Fotos) y la misma redirección, pero con
// su propio inicio de sesión y sus propios tokens (gdAccessToken / gdRefreshToken). Hay que tener activada la
// «Google Drive API» en el mismo proyecto de Google Cloud. Sube a la carpeta «Ecos · Copias» con subida reanudable.
// Red y navegador inyectables para probarlo sin llamar a Google.
const GP = require('./gphotos');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_NAME = 'Ecos · Copias';
const CHUNK = 8 * 1024 * 1024; // múltiplo de 256 KiB, como exige Drive
const RECONNECT = 'Vuelve a conectar Google Drive (Ajustes → Copia de seguridad → Programación → Conectar Google Drive).';

function authUrl(cfg, { state, challenge }) {
  return `${AUTH_URL}?` + new URLSearchParams({
    client_id: cfg.gpClientId, redirect_uri: GP.REDIRECT, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
}

// Mensaje claro para los errores típicos de Drive
function friendly(status, json) {
  const msg = json?.error?.message || json?.error_description || '';
  const reason = json?.error?.errors?.[0]?.reason || json?.error?.status || '';
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + msg) || /Drive API has not been used|is disabled/i.test(msg)) return 'La Google Drive API no está activada en tu proyecto de Google Cloud. Actívala (APIs y servicios → Biblioteca → Google Drive API) y vuelve a intentarlo.';
  if (/storageQuotaExceeded/i.test(reason)) return 'Tu Google Drive está lleno.';
  if (status === 401 || status === 403) return 'Google Drive ha rechazado el permiso. ' + RECONNECT;
  return 'Google Drive: ' + (msg || `HTTP ${status}`);
}

function make(deps = {}) {
  const f = (...a) => (deps.fetch || fetch)(...a);
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = () => (deps.now ? deps.now() : Date.now());

  async function tokenCall(params) {
    const res = await f(GP.TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) { const e = new Error(json.error === 'invalid_grant' ? RECONNECT : 'Google: ' + (json.error_description || json.error || `HTTP ${res.status}`)); e.code = json.error; throw e; }
    return json;
  }
  const expiry = (j) => new Date(now() + (Number(j.expires_in) || 3600) * 1000).toISOString();

  async function login(cfg) {
    if (!cfg.gpClientId || !cfg.gpClientSecret) throw new Error('Falta el ID de cliente de Google. Conéctalo primero en Conexiones → Google Fotos, o usa «Carpeta sincronizada».');
    const verifier = GP.newVerifier(), challenge = GP.challengeOf(verifier);
    const open = deps.loginInBrowser || require('./oauth').loginInBrowser;
    const params = await open('google', (state) => authUrl(cfg, { state, challenge }));
    const code = params.get('code');
    if (!code) throw new Error('Google no ha devuelto ningún código');
    const j = await tokenCall({ client_id: cfg.gpClientId, client_secret: cfg.gpClientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: GP.REDIRECT });
    if (!j.refresh_token) throw new Error('Google no ha dado permiso permanente. Quita el acceso de Ecos en myaccount.google.com/permissions y vuelve a conectar.');
    if (j.scope && !String(j.scope).includes('drive.file')) throw new Error('No se concedió el permiso para crear archivos en Drive. Vuelve a conectar y marca la casilla.');
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: expiry(j) };
  }

  async function ensureToken(cfg) {
    if (!cfg.gdRefreshToken && !cfg.gdAccessToken) throw new Error('Google Drive no está conectado.');
    const left = cfg.gdTokenExpires ? new Date(cfg.gdTokenExpires).getTime() - now() : -1;
    if (cfg.gdAccessToken && left > 60e3) return cfg.gdAccessToken;
    try {
      const j = await tokenCall({ client_id: cfg.gpClientId, client_secret: cfg.gpClientSecret, refresh_token: cfg.gdRefreshToken, grant_type: 'refresh_token' });
      cfg.gdAccessToken = j.access_token; cfg.gdTokenExpires = expiry(j); if (j.refresh_token) cfg.gdRefreshToken = j.refresh_token;
      deps.save?.();
      return cfg.gdAccessToken;
    } catch (e) {
      if (e.code === 'invalid_grant') { cfg.gdAccessToken = ''; cfg.gdRefreshToken = ''; cfg.gdTokenExpires = ''; deps.save?.(); }
      throw e;
    }
  }

  async function api(cfg, method, url, body) {
    const token = await ensureToken(cfg);
    const res = await f(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 204) return {};
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(friendly(res.status, json)); e.status = res.status; throw e; }
    return json;
  }

  // Carpeta «Ecos · Copias»: la guardada si sigue existiendo, o la que ya creó Ecos, o una nueva. → id
  async function ensureFolder(cfg) {
    if (cfg.gdFolderId) {
      try { const r = await api(cfg, 'GET', `${FILES}/${encodeURIComponent(cfg.gdFolderId)}?fields=id,trashed`); if (!r.trashed) return cfg.gdFolderId; } catch (e) { if (e.status !== 404) throw e; }
    }
    const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const found = await api(cfg, 'GET', `${FILES}?${new URLSearchParams({ q, fields: 'files(id,name)', spaces: 'drive' })}`);
    let id = found.files?.[0]?.id;
    if (!id) id = (await api(cfg, 'POST', `${FILES}?fields=id`, { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })).id;
    cfg.gdFolderId = id; deps.save?.();
    return id;
  }

  // Subida reanudable. src: { size, read(start, end) → Buffer }. opts: { session (URL de sesión a reanudar), onSession(url),
  // onProgress({done,total}), cancelled() }. → { id, name, size, session }
  async function upload(cfg, { name, mime = 'application/zip', src, parent }, opts = {}) {
    const total = src.size;
    const stop = () => { if (opts.cancelled?.()) throw new Error('Cancelado'); };
    const auth = async () => ({ Authorization: `Bearer ${await ensureToken(cfg)}` });
    let session = opts.session || '';
    let offset = 0;
    const query = async () => { // cuánto tiene ya Drive de esta sesión
      const r = await f(session, { method: 'PUT', headers: { ...(await auth()), 'Content-Range': `bytes */${total}`, 'Content-Length': '0' } });
      if (r.status === 200 || r.status === 201) return { done: await r.json().catch(() => ({})) };
      if (r.status === 308) { const m = /bytes=0-(\d+)/.exec(r.headers?.get?.('range') || ''); return { offset: m ? +m[1] + 1 : 0 }; }
      if (r.status === 404 || r.status === 410) return { expired: true };
      throw Object.assign(new Error(friendly(r.status, await r.json().catch(() => ({})))), { status: r.status });
    };
    if (session) { const q = await query().catch(() => ({ expired: true })); if (q.done) return { id: q.done.id, name, size: total, session }; if (q.expired) session = ''; else offset = q.offset; }
    if (!session) {
      const r = await f(`${UPLOAD}?uploadType=resumable&fields=id,name,size`, { method: 'POST', headers: { ...(await auth()), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(total) }, body: JSON.stringify({ name, ...(parent ? { parents: [parent] } : {}) }) });
      if (!r.ok) throw new Error(friendly(r.status, await r.json().catch(() => ({}))));
      session = r.headers.get('location'); if (!session) throw new Error('Google Drive no ha dado la dirección de subida.');
      opts.onSession?.(session);
    }
    let fails = 0;
    while (true) {
      stop();
      const end = Math.min(offset + (opts.chunk || CHUNK), total);
      const body = total ? await src.read(offset, end) : Buffer.alloc(0);
      let r;
      try {
        r = await f(session, { method: 'PUT', headers: { ...(await auth()), 'Content-Length': String(body.length), 'Content-Range': total ? `bytes ${offset}-${end - 1}/${total}` : 'bytes */0' }, body });
      } catch (e) { r = { networkError: e }; }
      if (r.status === 200 || r.status === 201) { const j = await r.json().catch(() => ({})); opts.onProgress?.({ done: total, total }); return { id: j.id, name: j.name || name, size: total, session }; }
      if (r.status === 308) { const m = /bytes=0-(\d+)/.exec(r.headers?.get?.('range') || ''); offset = m ? +m[1] + 1 : 0; fails = 0; opts.onProgress?.({ done: offset, total }); continue; }
      // fallo de red o error temporal: se pregunta cuánto llegó y se sigue desde ahí
      if (r.networkError || r.status >= 500 || r.status === 429) {
        if (++fails > 5) throw new Error('Se ha cortado la subida a Google Drive: ' + (r.networkError?.message || `HTTP ${r.status}`));
        await sleep(Math.min(30000, 1000 * 2 ** fails));
        const q = await query();
        if (q.done) { opts.onProgress?.({ done: total, total }); return { id: q.done.id, name, size: total, session }; }
        if (q.expired) throw new Error('La subida a Google Drive caducó. Se reintentará desde cero.');
        offset = q.offset; continue;
      }
      throw new Error(friendly(r.status, await r.json().catch(() => ({}))));
    }
  }

  const remove = (cfg, id) => api(cfg, 'DELETE', `${FILES}/${encodeURIComponent(id)}`).catch((e) => { if (e.status !== 404) throw e; });
  return { login, ensureToken, ensureFolder, upload, remove, api };
}

// Origen de lectura por trozos para un archivo del disco
function fileSource(file, fsMod = require('fs')) {
  const size = fsMod.statSync(file).size;
  return { size, read: async (start, end) => { const fd = fsMod.openSync(file, 'r'); try { const b = Buffer.alloc(end - start); fsMod.readSync(fd, b, 0, b.length, start); return b; } finally { fsMod.closeSync(fd); } } };
}

module.exports = { make, fileSource, authUrl, friendly, SCOPE, FOLDER_NAME, CHUNK };
