// Facebook (Páginas) e Instagram (cuenta profesional) vía Graph API.
const { openAuthWindow } = require('./oauth');

const REDIRECT = 'https://www.facebook.com/connect/login_success.html';
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'business_management'];

const gv = (cfg) => cfg.graphVersion || 'v23.0';
const graph = (cfg) => `https://graph.facebook.com/${gv(cfg)}`;

async function get(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Meta: ${json.error.message}`);
  return json;
}

async function login(cfg) {
  if (!cfg.metaAppId || !cfg.metaAppSecret) throw new Error('Falta el App ID o el App Secret de Meta');
  const auth = `https://www.facebook.com/${gv(cfg)}/dialog/oauth?` + new URLSearchParams({
    client_id: cfg.metaAppId, redirect_uri: REDIRECT, response_type: 'token', scope: SCOPES.join(','),
  });
  const params = await openAuthWindow(auth, REDIRECT);
  const shortToken = params.get('access_token');
  // Cambia el token corto (1-2 h) por uno largo (~60 días)
  const long = await get(`${graph(cfg)}/oauth/access_token?` + new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: cfg.metaAppId,
    client_secret: cfg.metaAppSecret, fb_exchange_token: shortToken,
  }));
  return long.access_token;
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

async function facebookPosts(cfg, account, limit = 25) {
  const json = await get(`${graph(cfg)}/${account.pageId}/posts?` + new URLSearchParams({
    fields: 'id,message,created_time,permalink_url,full_picture,attachments{media_type,media,url,subattachments{media_type,media,url}}',
    limit: String(limit), access_token: account.pageToken,
  }));
  return json.data.map((p) => {
    const media = [];
    for (const a of p.attachments?.data || []) {
      const items = a.subattachments?.data?.length ? a.subattachments.data : [a];
      for (const s of items) {
        if (s.media?.image?.src) media.push({ type: s.media_type === 'video' ? 'video' : 'image', url: s.media.image.src, link: s.url });
      }
    }
    if (!media.length && p.full_picture) media.push({ type: 'image', url: p.full_picture });
    return { source: 'facebook', id: p.id, text: p.message || '', date: p.created_time, permalink: p.permalink_url, media };
  });
}

async function instagramPosts(cfg, account, limit = 25) {
  if (!account.igId) return [];
  const json = await get(`${graph(cfg)}/${account.igId}/media?` + new URLSearchParams({
    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}',
    limit: String(limit), access_token: account.pageToken,
  }));
  const conv = (m) => m.media_type === 'VIDEO'
    ? { type: 'video', url: m.thumbnail_url, videoUrl: m.media_url }
    : { type: 'image', url: m.media_url };
  return json.data.map((m) => ({
    source: 'instagram', id: m.id, text: m.caption || '', date: m.timestamp, permalink: m.permalink,
    media: m.media_type === 'CAROUSEL_ALBUM' ? (m.children?.data || []).map(conv) : [conv(m)],
  }));
}

module.exports = { login, listAccounts, facebookPosts, instagramPosts };
