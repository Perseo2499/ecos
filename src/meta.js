// Facebook (Páginas) e Instagram (cuenta profesional) vía Graph API.
const { loginInBrowser, redirectUri } = require('./oauth');

const REDIRECT = redirectUri('meta');
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'business_management'];
// Publicar en la página: solo se pide al activar «Compartir en Facebook» (si la app de Meta no lo tiene dado de alta,
// Meta rechazaría la conexión entera con «Invalid Scopes»)
const PUBLISH_SCOPES = ['pages_manage_posts'];

const gv = (cfg) => cfg.graphVersion || 'v23.0';
const graph = (cfg) => `https://graph.facebook.com/${gv(cfg)}`;

async function get(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Meta: ${json.error.message}`);
  return json;
}

async function login(cfg, { publish = false } = {}) {
  if (!cfg.metaAppId || !cfg.metaAppSecret) throw new Error('Falta el App ID o el App Secret de Meta');
  const result = await loginInBrowser('meta', (state) => {
    // Apps de tipo Empresa: los permisos van en una configuración (config_id) en lugar de en scope
    const params = { client_id: cfg.metaAppId, redirect_uri: REDIRECT, response_type: 'code', state };
    if (cfg.metaConfigId) params.config_id = cfg.metaConfigId.trim();
    else params.scope = [...SCOPES, ...(publish ? PUBLISH_SCOPES : [])].join(',');
    return `https://www.facebook.com/${gv(cfg)}/dialog/oauth?` + new URLSearchParams(params);
  });
  // Código → token corto → token largo (~60 días)
  const short = await get(`${graph(cfg)}/oauth/access_token?` + new URLSearchParams({
    client_id: cfg.metaAppId, client_secret: cfg.metaAppSecret, redirect_uri: REDIRECT, code: result.get('code'),
  }));
  const long = await get(`${graph(cfg)}/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: cfg.metaAppId,
    client_secret: cfg.metaAppSecret, fb_exchange_token: short.access_token,
  }));
  // expires_in (segundos) suele ser ~60 días; si no viene, se asume eso
  return { token: long.access_token, expiresAt: new Date(Date.now() + (long.expires_in || 60 * 86400) * 1000).toISOString() };
}

// Devuelve las páginas del usuario con su cuenta de Instagram vinculada (si la hay)
async function listAccounts(cfg) {
  const json = await get(`${graph(cfg)}/me/accounts?` + new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    access_token: cfg.metaUserToken,
  }));
  return json.data.map((p) => ({
    pageId: p.id, pageName: p.name, pageToken: p.access_token,
    igId: p.instagram_business_account?.id, igUser: p.instagram_business_account?.username,
  }));
}

// Las dos funciones devuelven { posts, next }: next es el cursor para «Cargar más» (null si no hay más)
async function facebookPosts(cfg, account, after = null, limit = 25) {
  const json = await get(`${graph(cfg)}/${account.pageId}/posts?` + new URLSearchParams({
    fields: 'id,message,created_time,permalink_url,full_picture,attachments{media_type,media,url,subattachments{media_type,media,url}}',
    limit: String(limit), access_token: account.pageToken, ...(after ? { after } : {}),
  }));
  const next = json.paging?.next ? json.paging.cursors?.after || null : null;
  const posts = json.data.map((p) => {
    const media = [];
    for (const a of p.attachments?.data || []) {
      const items = a.subattachments?.data?.length ? a.subattachments.data : [a];
      for (const s of items) {
        if (!s.media?.image?.src) continue;
        // En los vídeos, media.source es el archivo de vídeo y media.image su miniatura
        if (/video/.test(s.media_type || '')) media.push({ type: 'video', url: s.media.image.src, videoUrl: s.media.source || null, link: s.url });
        else media.push({ type: 'image', url: s.media.image.src, link: s.url });
      }
    }
    if (!media.length && p.full_picture) media.push({ type: 'image', url: p.full_picture });
    return { source: 'facebook', id: p.id, text: p.message || '', date: p.created_time, permalink: p.permalink_url, media };
  });
  return { posts, next };
}

async function instagramPosts(cfg, account, after = null, limit = 25) {
  if (!account.igId) return { posts: [], next: null };
  const json = await get(`${graph(cfg)}/${account.igId}/media?` + new URLSearchParams({
    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}',
    limit: String(limit), access_token: account.pageToken, ...(after ? { after } : {}),
  }));
  const next = json.paging?.next ? json.paging.cursors?.after || null : null;
  const conv = (m) => m.media_type === 'VIDEO'
    ? { type: 'video', url: m.thumbnail_url, videoUrl: m.media_url }
    : { type: 'image', url: m.media_url };
  const posts = json.data.map((m) => ({
    source: 'instagram', id: m.id, text: m.caption || '', date: m.timestamp, permalink: m.permalink,
    media: m.media_type === 'CAROUSEL_ALBUM' ? (m.children?.data || []).map(conv) : [conv(m)],
  }));
  return { posts, next };
}

// Recuento rápido: solo id, texto, fecha y una miniatura, de 100 en 100 (sin cargar las publicaciones completas)
async function lightPosts(cfg, account, net, after = null) {
  const ig = net === 'instagram';
  if (ig && !account.igId) return { posts: [], next: null };
  const json = await get(`${graph(cfg)}/${ig ? account.igId + '/media' : account.pageId + '/posts'}?` + new URLSearchParams({
    fields: ig ? 'id,caption,timestamp,media_type,media_url,thumbnail_url' : 'id,message,created_time,full_picture',
    limit: '100', access_token: account.pageToken, ...(after ? { after } : {}),
  }));
  const next = json.paging?.next ? json.paging.cursors?.after || null : null;
  const posts = (json.data || []).map((m) => (ig
    ? { source: 'instagram', id: m.id, text: m.caption || '', date: m.timestamp, media: [{ type: 'image', url: m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url }] }
    : { source: 'facebook', id: m.id, text: m.message || '', date: m.created_time, media: m.full_picture ? [{ type: 'image', url: m.full_picture }] : [] }));
  return { posts, next };
}
// Cuántas publicaciones tiene la cuenta de Instagram (una sola llamada)
async function instagramCount(cfg, account) {
  if (!account.igId) return null;
  const j = await get(`${graph(cfg)}/${account.igId}?` + new URLSearchParams({ fields: 'media_count', access_token: account.pageToken }));
  return Number.isFinite(j.media_count) ? j.media_count : null;
}

// Traduce los errores de la Graph API al publicar en una página a algo que se entienda
function explainShareError(e = {}) {
  const msg = String(e.message || '');
  if (e.code === 200 || e.code === 10 || /pages_manage_posts|permission/i.test(msg)) {
    return 'NEED_PUBLISH_PERMISSION';
  }
  if (e.code === 190 || /access token|session/i.test(msg)) return 'La conexión con Meta ha caducado. Ve a Conexiones y vuelve a conectar con Meta.';
  return 'Meta: ' + msg;
}
// Publica un enlace con texto en el muro de una página de Facebook. Devuelve { id, url }.
async function sharePost(cfg, account, { message, link }) {
  if (!account?.pageToken) throw new Error('Falta la página de Facebook; vuelve a conectar con Meta');
  if (!message && !link) throw new Error('No hay nada que publicar');
  // Comprobación previa del permiso (si Meta la responde); así el aviso es claro antes de intentar publicar
  try {
    const perms = await get(`${graph(cfg)}/me/permissions?` + new URLSearchParams({ access_token: cfg.metaUserToken }));
    const p = (perms.data || []).find((x) => x.permission === 'pages_manage_posts');
    if (perms.data?.length && (!p || p.status !== 'granted')) throw Object.assign(new Error('permission'), { code: 200 });
  } catch (e) { if (e.code === 200) throw new Error(explainShareError(e)); /* si no se puede consultar, se intenta igualmente */ }
  const res = await fetch(`${graph(cfg)}/${account.pageId}/feed`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message: message || '', ...(link ? { link } : {}), access_token: account.pageToken }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(explainShareError(json.error));
  const id = json.id;
  let url = `https://www.facebook.com/${id}`;
  try { const pl = await get(`${graph(cfg)}/${id}?` + new URLSearchParams({ fields: 'permalink_url', access_token: account.pageToken })); if (pl.permalink_url) url = pl.permalink_url; } catch { /* nos quedamos con la dirección corta */ }
  return { id, url };
}

module.exports = { lightPosts, instagramCount, explainShareError, sharePost, REDIRECT, login, listAccounts, facebookPosts, instagramPosts };
