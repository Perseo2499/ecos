// Google Fotos mediante la «Google Photos Picker API».
// Desde el 31 de marzo de 2025 Google ya no deja leer toda la biblioteca de una persona: la app crea una sesión,
// la persona elige las fotos en Google Fotos (también de álbumes) y Ecos solo recibe esas fotos.
// Inicio de sesión: OAuth de «App de escritorio» con PKCE y redirección en http://localhost:53682/google.
// Toda la red (fetch) y el navegador (loginInBrowser) se pueden inyectar, para probarlo sin llamar a Google.
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://photospicker.googleapis.com/v1';
const REDIRECT = 'http://localhost:53682/google';
const RECONNECT = 'Vuelve a conectar Google Fotos (Conexiones → Google Fotos → Conectar con Google).';

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newVerifier = () => b64url(crypto.randomBytes(48));
const challengeOf = (verifier) => b64url(crypto.createHash('sha256').update(verifier).digest());

// URL de autorización (offline + consent para recibir el refresh token)
function authUrl(cfg, { state, challenge }) {
  return `${AUTH_URL}?` + new URLSearchParams({
    client_id: cfg.gpClientId, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    state, code_challenge: challenge, code_challenge_method: 'S256',
  });
}

// «5s» / «600.5s» → milisegundos
const seconds = (d, dflt) => { const n = parseFloat(String(d ?? '')); return Number.isFinite(n) && n > 0 ? n : dflt; };

// Archivo JSON de credenciales que descarga Google Cloud («client_secret_….json»).
// Acepta { installed: {...} } (app de escritorio) y { web: {...} } si tiene una redirección a localhost.
function parseCredentials(text) {
  let j;
  try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch { throw new Error('El archivo no es un JSON válido. Descarga otra vez las credenciales desde Google Cloud (Credenciales → tu ID de cliente → Descargar JSON).'); }
  const c = j?.installed || j?.web;
  if (!c || typeof c !== 'object') throw new Error('Este JSON no parece de credenciales de Google. Debe empezar por «installed» (App de escritorio) o «web».');
  if (!c.client_id || !c.client_secret) throw new Error('Al archivo le falta el ID de cliente o el secreto (client_id / client_secret).');
  if (!j.installed && !(c.redirect_uris || []).some((u) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u))) {
    throw new Error('Estas credenciales son de tipo «Aplicación web» y no tienen una redirección a localhost. Crea otro ID de cliente de tipo «Aplicación de escritorio» y descarga su JSON.');
  }
  return { clientId: String(c.client_id), clientSecret: String(c.client_secret) };
}

// Busca en carpetas concretas archivos client_secret*.json (o .json con la forma de credenciales de escritorio).
// Solo lee esos archivos y no mira subcarpetas. Devuelve la lista de rutas válidas.
function findCredentialFiles(dirs, fsMod = require('fs'), pathMod = require('path')) {
  const out = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fsMod.readdirSync(dir); } catch { continue; }
    for (const n of names.filter((x) => /\.json$/i.test(x)).sort()) {
      const file = pathMod.join(dir, n);
      try {
        const st = fsMod.statSync(file);
        if (!st.isFile() || st.size > 20000) continue;
        const raw = fsMod.readFileSync(file, 'utf8');
        if (!/^client_secret/i.test(n) && !/"installed"/.test(raw)) continue;
        let ok = false; try { ok = !!parseCredentials(raw); } catch { /* no es de Google */ }
        if (ok && !out.includes(file)) out.push(file);
      } catch { /* ilegible */ }
    }
  }
  return out;
}

function make(deps = {}) {
  const f = (...a) => (deps.fetch || fetch)(...a);
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = () => (deps.now ? deps.now() : Date.now());

  async function tokenCall(params) {
    const res = await f(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const e = new Error(json.error === 'invalid_grant' ? RECONNECT : 'Google: ' + (json.error_description || json.error || `HTTP ${res.status}`));
      e.code = json.error; throw e;
    }
    return json;
  }
  const expiry = (json) => new Date(now() + (Number(json.expires_in) || 3600) * 1000).toISOString();

  // Abre el navegador, espera la vuelta y canjea el código. Devuelve { accessToken, refreshToken, expiresAt }.
  async function login(cfg) {
    if (!cfg.gpClientId || !cfg.gpClientSecret) throw new Error('Falta el Client ID o el Client Secret de Google');
    const verifier = newVerifier();
    const challenge = challengeOf(verifier);
    const open = deps.loginInBrowser || require('./oauth').loginInBrowser;
    const params = await open('google', (state) => authUrl(cfg, { state, challenge }));
    const code = params.get('code');
    if (!code) throw new Error('Google no ha devuelto ningún código');
    const json = await tokenCall({
      client_id: cfg.gpClientId, client_secret: cfg.gpClientSecret, code, code_verifier: verifier,
      grant_type: 'authorization_code', redirect_uri: REDIRECT,
    });
    if (!json.refresh_token) throw new Error('Google no ha dado permiso permanente. Quita el acceso de Ecos en myaccount.google.com/permissions y vuelve a conectar.');
    return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: expiry(json) };
  }

  // Nuevo token de acceso con el refresh token. Devuelve { accessToken, expiresAt, refreshToken? }.
  async function refresh(cfg) {
    if (!cfg.gpRefreshToken) throw new Error(RECONNECT);
    const json = await tokenCall({ client_id: cfg.gpClientId, client_secret: cfg.gpClientSecret, refresh_token: cfg.gpRefreshToken, grant_type: 'refresh_token' });
    return { accessToken: json.access_token, expiresAt: expiry(json), refreshToken: json.refresh_token || undefined };
  }

  // Devuelve un token válido, refrescándolo si caduca en menos de un minuto. Actualiza cfg y llama a deps.save.
  async function ensureToken(cfg) {
    if (!cfg.gpRefreshToken && !cfg.gpAccessToken) throw new Error('Google Fotos no está conectado. Conéctalo en Conexiones → Google Fotos.');
    const left = cfg.gpTokenExpires ? new Date(cfg.gpTokenExpires).getTime() - now() : -1;
    if (cfg.gpAccessToken && left > 60e3) return cfg.gpAccessToken;
    try {
      const r = await refresh(cfg);
      cfg.gpAccessToken = r.accessToken; cfg.gpTokenExpires = r.expiresAt;
      if (r.refreshToken) cfg.gpRefreshToken = r.refreshToken;
      deps.save?.();
      return r.accessToken;
    } catch (e) {
      if (e.code === 'invalid_grant') { cfg.gpAccessToken = ''; cfg.gpRefreshToken = ''; cfg.gpTokenExpires = ''; deps.save?.(); }
      throw e;
    }
  }

  async function api(cfg, method, url) {
    const token = await ensureToken(cfg);
    const res = await f(url, { method, headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) throw new Error('Google Fotos ha rechazado el permiso. ' + RECONNECT);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Google Fotos: ' + (json.error?.message || `HTTP ${res.status}`));
    return json;
  }

  // { id, pickerUri, pollingConfig: { pollInterval, timeoutIn }, mediaItemsSet }
  async function createSession(cfg) {
    const token = await ensureToken(cfg);
    const res = await f(`${API}/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw new Error('Google Fotos ha rechazado el permiso. ' + RECONNECT);
    if (!res.ok || !json.id) throw new Error('Google Fotos: ' + (json.error?.message || `HTTP ${res.status}`));
    return json;
  }

  // Consulta la sesión cada pollInterval hasta mediaItemsSet. isCancelled() corta la espera.
  async function pollSession(cfg, session, { isCancelled = () => false, onTick } = {}) {
    let interval = seconds(session.pollingConfig?.pollInterval, 5) * 1000;
    const timeout = seconds(session.pollingConfig?.timeoutIn, 600) * 1000;
    const start = now();
    let cur = session;
    while (!cur.mediaItemsSet) {
      if (isCancelled()) throw Object.assign(new Error('Cancelado'), { cancelled: true });
      if (now() - start > timeout) throw new Error('Se ha agotado el tiempo para elegir las fotos en Google Fotos. Inténtalo de nuevo.');
      await sleep(interval);
      if (isCancelled()) throw Object.assign(new Error('Cancelado'), { cancelled: true });
      cur = await api(cfg, 'GET', `${API}/sessions/${encodeURIComponent(session.id)}`);
      if (cur.pollingConfig?.pollInterval) interval = seconds(cur.pollingConfig.pollInterval, interval / 1000) * 1000;
      onTick?.(cur);
    }
    return cur;
  }

  // Todos los elementos elegidos (pagina con pageToken)
  async function listItems(cfg, sessionId) {
    const out = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ sessionId, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
      const json = await api(cfg, 'GET', `${API}/mediaItems?${q}`);
      out.push(...(json.mediaItems || []));
      pageToken = json.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  const kindOf = (item) => (item.type === 'VIDEO' || /^video\//.test(item.mediaFile?.mimeType || '') ? 'video' : 'image');

  // Descarga un elemento con la cabecera Bearer. Devuelve { buf, mime, name, type, date }.
  async function download(cfg, item) {
    const base = item.mediaFile?.baseUrl;
    if (!base) throw new Error('Google Fotos no ha dado la dirección de una foto');
    const type = kindOf(item);
    const mime = String(item.mediaFile.mimeType || '').toLowerCase();
    const heic = /heic|heif/.test(mime);
    // original (=d); los HEIC no se ven en la web: se piden ya convertidos a JPEG
    const suffix = type === 'video' ? '=dv' : heic ? '=w4096-h4096' : '=d';
    const token = await ensureToken(cfg);
    const res = await f(base + suffix, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`No se pudo descargar «${item.mediaFile.filename || 'una foto'}» de Google Fotos (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    let name = String(item.mediaFile.filename || item.id || 'google-fotos').replace(/[\\/:*?"<>|]+/g, '-');
    let outMime = heic && type === 'image' ? 'image/jpeg' : mime;
    if (heic && type === 'image') name = name.replace(/\.[^.]*$/, '') + '.jpg';
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[outMime] || (type === 'video' ? 'mp4' : 'jpg'));
    return { buf, mime: outMime, name, type, date: item.createTime || item.mediaFile.mediaFileMetadata?.createTime || '' };
  }

  // Miniatura cuadrada (para revisar la selección en Ecos) como data: URL
  async function thumb(cfg, item, size = 256) {
    const base = item.mediaFile?.baseUrl;
    if (!base) return '';
    const token = await ensureToken(cfg);
    const res = await f(`${base}=w${size}-h${size}-c`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return '';
    const mime = (res.headers?.get?.('content-type') || 'image/jpeg').split(';')[0];
    return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  }

  async function deleteSession(cfg, id) {
    try { await api(cfg, 'DELETE', `${API}/sessions/${encodeURIComponent(id)}`); } catch { /* ya caducada: no importa */ }
  }

  return { login, refresh, ensureToken, createSession, pollSession, listItems, download, thumb, kindOf, deleteSession };
}

module.exports = { make, parseCredentials, findCredentialFiles, authUrl, challengeOf, newVerifier, seconds, SCOPE, REDIRECT, TOKEN_URL, API, RECONNECT, ...make() };
