// WordPress.com REST API (public-api.wordpress.com) con OAuth2.
const { openAuthWindow } = require('./oauth');

const API = 'https://public-api.wordpress.com/rest/v1.1';

async function login(cfg) {
  if (!cfg.wpClientId || !cfg.wpClientSecret || !cfg.wpRedirect) {
    throw new Error('Faltan Client ID, Client Secret o Redirect URL de WordPress.com');
  }
  const auth = 'https://public-api.wordpress.com/oauth2/authorize?' + new URLSearchParams({
    client_id: cfg.wpClientId, redirect_uri: cfg.wpRedirect, response_type: 'code', blog: cfg.wpSite,
  });
  const params = await openAuthWindow(auth, cfg.wpRedirect);
  const res = await fetch('https://public-api.wordpress.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: cfg.wpClientId, client_secret: cfg.wpClientSecret, redirect_uri: cfg.wpRedirect,
      code: params.get('code'), grant_type: 'authorization_code',
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('WordPress.com: ' + (json.error_description || JSON.stringify(json)));
  return json.access_token;
}

async function call(cfg, path, body) {
  const res = await fetch(`${API}/sites/${encodeURIComponent(cfg.wpSite)}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${cfg.wpToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error('WordPress.com: ' + (json.message || json.error));
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

const createPost = (cfg, post) => call(cfg, '/posts/new', post);

module.exports = { login, siteInfo, categories, uploadFromUrls, createPost };
