// WordPress.com REST API (public-api.wordpress.com) con OAuth2.
const { loginInBrowser, redirectUri } = require('./oauth');

const REDIRECT = redirectUri('wordpress');

const API = 'https://public-api.wordpress.com/rest/v1.1';

// Error de autorización: el token no vale para este sitio (caducado, revocado o de otro blog)
class AuthError extends Error {}
const AUTH_CODES = new Set(['invalid_token', 'authorization_required', 'unauthorized', 'invalid_grant']);

// Sitio al que se habla: el ID numérico del blog (lo que exige un token limitado a un blog) o, si no, el dominio
const siteRef = (cfg) => encodeURIComponent(cfg.wpBlogId || cfg.wpSite);

async function exchangeCode(cfg, code) {
  const res = await fetch('https://public-api.wordpress.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: cfg.wpClientId, client_secret: cfg.wpClientSecret, redirect_uri: REDIRECT,
      code, grant_type: 'authorization_code',
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('WordPress.com: ' + (json.error_description || JSON.stringify(json)));
  return json;
}

// Pide permiso en el navegador y devuelve { token, blogId, scope } ya comprobado contra el sitio.
// global=true pide acceso a todos los sitios de la cuenta (plan B si el token limitado no sirve).
async function login(cfg, { global = false, log = () => {} } = {}) {
  if (!cfg.wpClientId || !cfg.wpClientSecret) throw new Error('Faltan el Client ID o el Client Secret de WordPress.com');
  const params = await loginInBrowser('wordpress', (state) => 'https://public-api.wordpress.com/oauth2/authorize?' + new URLSearchParams({
    client_id: cfg.wpClientId, redirect_uri: REDIRECT, response_type: 'code', state,
    ...(global ? { scope: 'global' } : { blog: cfg.wpSite }),
  }));
  const tok = await exchangeCode(cfg, params.get('code'));
  const candidate = { ...cfg, wpToken: tok.access_token, wpBlogId: global ? '' : String(tok.blog_id || '') };
  log(`WordPress: token recibido (alcance ${global ? 'global' : 'blog ' + (tok.blog_id || '?')}, url ${tok.blog_url || '-'})`);

  // Comprobación real: leer el sitio y su biblioteca de medios
  const info = await call(candidate, '/');
  await call(candidate, '/media?number=1');
  log(`WordPress: conexión verificada con «${info.name}» (ID ${info.ID})`);
  return { token: tok.access_token, blogId: String(info.ID), siteName: info.name };
}

async function call(cfg, path, body) {
  const res = await fetch(`${API}/sites/${siteRef(cfg)}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${cfg.wpToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = 'WordPress.com: ' + (json.message || json.error || `HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403 || AUTH_CODES.has(json.error)) throw Object.assign(new AuthError(msg), { code: json.error });
    throw new Error(msg);
  }
  return json;
}

const siteInfo = (cfg) => call(cfg, '/');

async function categories(cfg) {
  const json = await call(cfg, '/categories?number=100');
  return json.categories.map((c) => ({ id: c.ID, name: c.name, slug: c.slug }));
}

// WordPress.com descarga las imágenes directamente desde la URL (las de Meta caducan, así que se hace al momento)
async function uploadFromUrls(cfg, urls) {
  if (!urls.length) return [];
  const json = await call(cfg, '/media/new', { media_urls: urls });
  if (json.errors?.length) console.warn('Errores de subida:', json.errors);
  return json.media.map((m) => ({ id: m.ID, url: m.URL }));
}

// Sube un archivo del disco (ZIP de Meta, capturas recortadas, fotos manuales)
async function uploadFile(cfg, filePath) {
  const fs = require('fs');
  const path = require('path');
  const form = new FormData();
  form.append('media[]', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const res = await fetch(`${API}/sites/${siteRef(cfg)}/media/new`, {
    method: 'POST', headers: { Authorization: `Bearer ${cfg.wpToken}` }, body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = 'WordPress.com: ' + (json.message || json.error || `HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403 || AUTH_CODES.has(json.error)) throw new AuthError(msg);
    throw new Error(msg);
  }
  if (!json.media?.length) throw new Error('WordPress.com: ' + (json.errors?.[0]?.message || 'no se pudo subir ' + path.basename(filePath)));
  return { id: json.media[0].ID, url: json.media[0].URL };
}

const createPost = (cfg, post) => call(cfg, '/posts/new', post);

module.exports = { REDIRECT, AuthError, login, siteInfo, categories, uploadFromUrls, uploadFile, createPost };
