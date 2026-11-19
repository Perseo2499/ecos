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

// Dirección pública de la web. WordPress.com a veces devuelve los enlaces con el subdominio interno
// (https://xxx.wordpress.com) aunque el blog use su propio dominio: se cambian por la dirección pública.
function publicBase(cfg) {
  const raw = (cfg.wpPublicUrl || '').trim() || (cfg.wpSite && !/wordpress\.com$/i.test(cfg.wpSite) ? 'https://www.' + cfg.wpSite.replace(/^www\./, '') : '');
  if (!raw) return null;
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).origin; } catch { return null; }
}
function publicUrl(cfg, url) {
  const base = publicBase(cfg);
  if (!base || !url) return url;
  try {
    const u = new URL(url);
    if (!/\.wordpress\.com$/i.test(u.hostname) || u.hostname === 'wordpress.com') return url;
    if (u.hostname.endsWith('.files.wordpress.com')) return url; // archivos de la biblioteca: se dejan igual
    return base + u.pathname + u.search + u.hash;
  } catch { return url; }
}

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
const updatePost = (cfg, id, post) => call(cfg, `/posts/${id}`, post);

// --- Gestión del blog (pestaña «Blog») ------------------------------------------
// type: 'post' | 'page'; status: 'any' | 'publish' | 'draft' | 'pending' | 'future' | 'private' | 'trash'
async function listPosts(cfg, { type = 'post', status = 'any', search = '', page = 1, number = 20 } = {}) {
  const q = new URLSearchParams({
    type, status, number: String(number), page: String(page), order_by: 'modified', order: 'DESC',
    fields: 'ID,title,status,date,modified,URL,type,featured_image,categories,excerpt',
    ...(search ? { search } : {}),
  });
  const json = await call(cfg, '/posts/?' + q);
  return {
    found: json.found,
    items: json.posts.map((p) => ({
      id: p.ID, title: p.title || '(sin título)', status: p.status, type: p.type, date: p.date, modified: p.modified,
      url: publicUrl(cfg, p.URL), image: p.featured_image || '', categories: Object.keys(p.categories || {}),
      excerpt: (p.excerpt || '').replace(/<[^>]+>/g, '').replace(/&[#\w]+;/g, ' ').trim().slice(0, 160),
    })),
  };
}
const updateMedia = (cfg, id, fields) => call(cfg, `/media/${id}`, fields);
const setPostStatus = (cfg, id, status) => call(cfg, `/posts/${id}`, { status });
const trashPost = (cfg, id) => call(cfg, `/posts/${id}/delete`, {});

module.exports = { REDIRECT, AuthError, login, siteInfo, publicUrl, publicBase, updatePost, categories, uploadFromUrls, uploadFile, createPost, updateMedia, listPosts, setPostStatus, trashPost };
