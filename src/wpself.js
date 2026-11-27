// WordPress propio (instalado en tu hosting, con wp-admin): API REST estándar /wp-json/wp/v2
// con una «contraseña de aplicación» (wp-admin → Usuarios → Perfil → Contraseñas de aplicación).
// Ofrece las mismas funciones que src/wpcom.js para que el resto de Ecos no note la diferencia.
const fs = require('fs');
const path = require('path');
const { AuthError } = require('./wpcom');
const TS = require('./themestyles');

const base = (cfg) => {
  const raw = (cfg.wpUrl || '').trim();
  if (!raw) throw new Error('Escribe la dirección de tu web (Conexiones → WordPress)');
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).origin; } catch { throw new Error('La dirección de la web no es válida'); }
};
const authHeader = (cfg) => 'Basic ' + Buffer.from(`${(cfg.wpUser || '').trim()}:${(cfg.wpAppPassword || '').replace(/\s+/g, '')}`).toString('base64');

// «fetch failed» no dice nada: la causa real (DNS, conexión rechazada, certificado…) viene en e.cause
const NET_CAUSES = {
  ENOTFOUND: 'no se encuentra la dirección (DNS)', EAI_AGAIN: 'no se encuentra la dirección (DNS)',
  ECONNREFUSED: 'el servidor rechaza la conexión', ECONNRESET: 'la conexión se cortó (cortafuegos, antivirus o bloqueo del servidor)',
  ETIMEDOUT: 'el servidor no responde', UND_ERR_CONNECT_TIMEOUT: 'el servidor no responde',
  EHOSTUNREACH: 'no hay ruta hasta el servidor', ENETUNREACH: 'no hay red',
};
function netCause(e) {
  const c = e?.cause;
  if (!c) return '';
  const code = c.code || '';
  if (/CERT|SSL|TLS|SELF_SIGNED/i.test(code + ' ' + (c.message || ''))) return ` (problema con el certificado de seguridad: ${code || c.message})`;
  const txt = NET_CAUSES[code];
  return txt ? ` (${txt}; ${code})` : (code || c.message) ? ` (${code || c.message})` : '';
}

async function req(cfg, route, { method = 'GET', json, body, headers = {}, raw = false } = {}) {
  const url = `${base(cfg)}/wp-json${route}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: authHeader(cfg), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
  } catch (e) {
    throw new Error(`No se puede conectar con ${base(cfg)}: ${e.message}${netCause(e)}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.code || '';
    const msg = data?.message ? data.message.replace(/<[^>]+>/g, '') : `HTTP ${res.status}`;
    if (res.status === 401 || code === 'invalid_username' || code === 'incorrect_password' || code === 'rest_not_logged_in') {
      throw Object.assign(new AuthError(`WordPress: no acepta el usuario o la contraseña de aplicación (${msg}).`), { code });
    }
    if (res.status === 403) throw Object.assign(new AuthError(`WordPress: tu usuario no tiene permiso para esto (${msg})`), { code });
    if (res.status === 404 && code === 'rest_no_route') throw new Error('Esta web no tiene activada la API de WordPress (wp-json)');
    throw new Error(`WordPress: ${msg}`);
  }
  if (data === null && !raw) throw new Error(`WordPress: respuesta inesperada de ${url}. ¿Es la dirección correcta?`);
  return raw ? { data, res } : data;
}

// Comprueba la conexión: usuario, permisos y nombre de la web
async function login(cfg) {
  if (!cfg.wpUser || !cfg.wpAppPassword) throw new Error('Escribe tu usuario y la contraseña de aplicación');
  // Las contraseñas de aplicación de WordPress tienen siempre 24 letras y números (6 grupos de 4)
  const pass = cfg.wpAppPassword.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9]{24}$/.test(pass)) {
    throw new AuthError(`Eso no parece una contraseña de aplicación: tiene ${pass.length} caracteres y las de aplicación tienen 24 (como «abcd efgh ijkl mnop qrst uvwx»). Tu contraseña normal de wp-admin no sirve: crea una en wp-admin → Usuarios → Perfil → Contraseñas de aplicación.`);
  }
  let me;
  try {
    me = await req(cfg, '/wp/v2/users/me?context=edit');
  } catch (err) {
    if (err.code === 'rest_not_logged_in') throw await diagnose(cfg, err);
    throw err;
  }
  const caps = me.capabilities || {};
  if (!caps.edit_posts) throw new AuthError('WordPress: tu usuario no puede crear entradas');
  const site = await req(cfg, '/').catch(() => ({}));
  const info = parseMe(me);
  return { siteName: site.name || base(cfg), userName: me.name, canPublish: info.canPublish, me: info };
}

// Datos de la persona conectada (GET /wp/v2/users/me?context=edit) → { id, name, role, roles, canPublish, canUpload, avatar }
// Un colaborador (contributor) puede escribir pero no publicar ni subir fotos: sus entradas van a revisión.
function parseMe(d) {
  const caps = d?.capabilities || {};
  const roles = Array.isArray(d?.roles) ? d.roles.map(String) : [];
  const av = d?.avatar_urls || {};
  return {
    id: Number(d?.id) || 0, name: String(d?.name || d?.slug || ''), slug: String(d?.slug || ''),
    role: roles[0] || '', roles,
    canPublish: !!caps.publish_posts, canUpload: !!caps.upload_files,
    avatar: String(av['48'] || av['96'] || av['24'] || ''),
  };
}
async function me(cfg) { return parseMe(await req(cfg, '/wp/v2/users/me?context=edit')); }
// Fecha de última modificación de una entrada en WordPress (para avisar si alguien la cambió después de abrirla)
async function postModified(cfg, id, type) {
  const p = await req(cfg, `/wp/v2/${type === 'page' ? 'pages' : 'posts'}/${Number(id)}?context=edit&_fields=id,modified_gmt,status`);
  return { id: p.id, status: p.status, modified: p.modified_gmt ? p.modified_gmt + 'Z' : null };
}

// «No estás conectado»: WordPress no ha visto ninguna credencial. Se averigua por qué consultando
// la parte pública de la API, que indica si las contraseñas de aplicación están disponibles.
async function diagnose(cfg, original) {
  let info = null;
  try { info = await (await fetch(`${base(cfg)}/wp-json/`)).json(); } catch { /* sin datos */ }
  const available = !!info?.authentication?.['application-passwords'];
  if (info && !available) {
    return Object.assign(new AuthError('Tu web tiene desactivadas las contraseñas de aplicación. Suele hacerlo un plugin de seguridad (Wordfence, iThemes/Solid Security, All-In-One Security…) o el hosting. Actívalas en los ajustes de ese plugin y vuelve a pulsar «Conectar».'), { code: 'app_passwords_disabled' });
  }
  const badCreds = () => Object.assign(new AuthError('WordPress no acepta el usuario o la contraseña de aplicación. Comprueba que el usuario es el tuyo de wp-admin y que la contraseña de aplicación está bien copiada (o crea otra en wp-admin → Usuarios → Perfil → Contraseñas de aplicación).'), { code: 'bad_credentials' });
  // Con el complemento (1.7.1 o posterior): pregunta directamente si la cabecera llega
  try {
    const r = await fetch(`${base(cfg)}/wp-json/ecos/v1/auth-check`, { headers: { Authorization: authHeader(cfg) } });
    if (r.ok) { const j = await r.json(); if (j && typeof j.received === 'boolean' && j.received) return badCreds(); if (j && j.received === false) return headerLost(original); }
  } catch { /* sin complemento: se sigue */ }
  // ¿Llega la cabecera Authorization? Se prueba con un usuario inventado: si WordPress lo rechaza por usuario o
  // contraseña, la cabecera llega y lo que falla son los datos escritos (no el servidor).
  try {
    const probe = await fetch(`${base(cfg)}/wp-json/wp/v2/users/me`, { headers: { Authorization: 'Basic ' + Buffer.from('ecos-comprobacion-' + Date.now() + ':abcd efgh ijkl mnop qrst uvwx').toString('base64') } });
    const pj = await probe.json().catch(() => null);
    if (['invalid_username', 'incorrect_password', 'invalid_email'].includes(pj?.code)) return badCreds();
  } catch { /* sin respuesta: se sigue con el diagnóstico de la cabecera */ }
  // Sin forma de saberlo (sin complemento): las dos causas posibles
  return Object.assign(new AuthError('WordPress no reconoce tus datos. Puede ser por dos cosas:\n\n1. El usuario o la contraseña de aplicación no son correctos: cópialos otra vez (o crea otra contraseña en wp-admin → Usuarios → Perfil → Contraseñas de aplicación).\n\n2. Tu servidor pierde la autorización por el camino. Se arregla añadiendo al principio del archivo .htaccess de tu web:\n\nSetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1\n\nCon el Complemento de Ecos instalado, Ecos te dirá cuál de las dos es.'), { code: 'auth_unknown', original: original.message });
}
function headerLost(original) {
  return Object.assign(new AuthError('Tu servidor no deja pasar la autorización de Ecos (la cabecera «Authorization» se pierde por el camino). Se arregla añadiendo al principio del archivo .htaccess de tu web, en el hosting:\n\nSetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1\n\nSi no sabes cómo, el soporte de tu hosting lo puede hacer en un minuto («activar la cabecera Authorization para la API REST de WordPress»).'), { code: 'auth_header_stripped', original: original.message });
}

const siteInfo = async (cfg) => { const s = await req(cfg, '/'); return { name: s.name, ID: null, URL: s.home || base(cfg) }; };

// --- Categorías y etiquetas (la API trabaja con IDs, Ecos con nombres) ---------
let catCache = null;
async function categories(cfg) {
  const out = [];
  for (let page = 1; page < 10; page++) {
    const { data, res } = await req(cfg, `/wp/v2/categories?per_page=100&page=${page}&_fields=id,name,slug`, { raw: true });
    out.push(...data.map((c) => ({ id: c.id, name: decode(c.name), slug: c.slug })));
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1)) break;
  }
  catCache = out;
  return out;
}
// create: las categorías que no existan se crean (al restaurar una copia de seguridad)
async function categoryIds(cfg, names, create = false) {
  if (!names.length) return [];
  const cats = catCache || (await categories(cfg));
  const ids = [];
  for (const n of names) {
    let hit = cats.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (!hit && create) {
      try { const c = await req(cfg, '/wp/v2/categories', { method: 'POST', json: { name: n } }); hit = { id: c.id, name: decode(c.name) }; cats.push(hit); }
      catch (e) { const m = /"term_id":(\d+)/.exec(e.message); if (m) hit = { id: Number(m[1]), name: n }; }
    }
    if (hit) ids.push(hit.id);
  }
  return ids;
}
async function tagIds(cfg, names) {
  const ids = [];
  for (const name of names) {
    const found = await req(cfg, `/wp/v2/tags?search=${encodeURIComponent(name)}&per_page=20&_fields=id,name`);
    const hit = found.find((t) => decode(t.name).toLowerCase() === name.toLowerCase());
    if (hit) { ids.push(hit.id); continue; }
    try { ids.push((await req(cfg, '/wp/v2/tags', { method: 'POST', json: { name } })).id); }
    catch (e) { if (!/term_exists/.test(e.message)) throw e; }
  }
  return ids;
}
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

// --- Medios -----------------------------------------------------------------------
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
// Aviso antes de subir: si se conoce el límite de la web (Conexiones → «Tu web») y el archivo no cabe, ni se intenta
let uploadGuard = null;
const setUploadGuard = (fn) => { uploadGuard = typeof fn === 'function' ? fn : null; };
async function uploadBuffer(cfg, buf, filename, type, { keep = false } = {}) {
  const send = async (b, ty, fn) => {
    const bad = uploadGuard && uploadGuard(b.length || b.byteLength || 0, fn);
    if (bad) throw new Error(bad);
    const m = await req(cfg, '/wp/v2/media', {
      method: 'POST', body: b,
      headers: { 'Content-Type': ty, 'Content-Disposition': `attachment; filename="${fn.replace(/["\r\n]/g, '')}"` },
    });
    return { id: m.id, url: m.source_url };
  };
  if (keep) return send(buf, type, filename);
  const o = await require('./imgopt').prepare(buf, type, filename); // fotos más ligeras (WebP si compensa)
  try { return await send(o.buf, o.type, o.name); }
  catch (e) {
    if (!o.webp || e instanceof AuthError) throw e;
    console.warn('WordPress no aceptó el WebP; se sube la original:', e.message);
    const f = o.fallback();
    return send(f.buf, f.type, f.name);
  }
}
async function uploadFile(cfg, filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return uploadBuffer(cfg, fs.readFileSync(filePath), path.basename(filePath), MIME[ext] || 'application/octet-stream');
}
// ¿Existe este medio en la biblioteca?
const mediaExists = (cfg, id) => req(cfg, `/wp/v2/media/${id}?_fields=id`).then((m) => !!m?.id, () => false);
// Busca en la biblioteca un medio por su dirección (también por la de alguno de sus tamaños)
async function findMediaByUrl(cfg, url) {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.[^.]*$/, '').replace(/-\d+x\d+$/, '').replace(/-scaled$/, '');
  if (!name) return null;
  const list = await req(cfg, `/wp/v2/media?search=${encodeURIComponent(name)}&per_page=30&_fields=id,source_url,media_details`);
  const same = (u) => u && u.split('?')[0].replace(/^https?:/, '') === url.split('?')[0].replace(/^https?:/, '');
  const m = (list || []).find((x) => same(x.source_url) || Object.values(x.media_details?.sizes || {}).some((s) => same(s.source_url)));
  return m ? m.id : null;
}
// Busca en la biblioteca un medio por el nombre del archivo y su tamaño en bytes (si se conoce): evita subir dos veces lo mismo
async function findMediaByName(cfg, name, size) {
  const stem = (n) => decodeURIComponent(String(n || '')).replace(/\.[^.]*$/, '').replace(/-\d+x\d+$/, '').replace(/-scaled$/, '').replace(/-\d+$/, '').toLowerCase();
  const want = stem(name);
  if (!want || !size) return null; // sin tamaño no hay certeza: se sube
  const list = await req(cfg, `/wp/v2/media?search=${encodeURIComponent(want)}&per_page=30&_fields=id,source_url,media_details`);
  const m = (list || []).find((x) => stem((x.source_url || '').split('?')[0].split('/').pop()) === want && Number(x.media_details?.filesize) === Number(size));
  return m ? { id: m.id, url: m.source_url } : null;
}
// Añade o quita una categoría de una entrada (sin tocar nada más)
async function changeCategory(cfg, id, name, add = true) {
  const [cid] = await categoryIds(cfg, [name], false);
  if (!cid) throw new Error(`No existe la categoría «${name}»`);
  const p = await req(cfg, `/wp/v2/posts/${id}?context=edit&_fields=categories`);
  const cur = p.categories || [];
  let next = add ? [...new Set([...cur, cid])] : cur.filter((c) => c !== cid);
  // al añadir una categoría real se quita «Sin categoría» (la que WordPress pone por defecto)
  if (add && !require('../renderer/blogcheck').isDefaultCat(name)) {
    const defs = new Set((catCache || []).filter((c) => require('../renderer/blogcheck').isDefaultCat(c.name)).map((c) => c.id));
    const kept = next.filter((c) => !defs.has(c));
    if (kept.length) next = kept;
  }
  if (next.length === cur.length && next.every((c, i) => c === cur[i])) return;
  await req(cfg, `/wp/v2/posts/${id}`, { method: 'POST', json: { categories: next } });
}
// Los archivos de Meta se descargan en el ordenador y se suben (WordPress propio no los descarga por URL)
async function uploadFromUrls(cfg, urls) {
  const out = [];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo descargar un archivo de la red social (${res.status})`);
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const ext = Object.entries(MIME).find(([, v]) => v === type)?.[0] || 'jpg';
    const name = (new URL(url).pathname.split('/').pop() || 'archivo').replace(/\.[^.]*$/, '').slice(0, 60) + '.' + ext;
    out.push(await uploadBuffer(cfg, Buffer.from(await res.arrayBuffer()), name, type));
  }
  return out;
}
const updateMedia = (cfg, id, fields) => req(cfg, `/wp/v2/media/${id}`, { method: 'POST', json: { alt_text: fields.alt ?? fields.alt_text } });

// --- Biblioteca de medios ------------------------------------------------------------
const MEDIA_FIELDS = 'id,date,modified_gmt,source_url,mime_type,media_type,alt_text,title,media_details,post';
const normMedia = (m) => {
  const d = m.media_details || {}, sz = d.sizes || {};
  const file = decodeURIComponent((m.source_url || '').split('?')[0].split('/').pop() || '');
  return {
    id: m.id, date: m.date, modified: m.modified_gmt || '', parent: m.post || 0, url: m.source_url, type: m.media_type === 'video' ? 'video' : 'image', mime: m.mime_type || '',
    alt: m.alt_text || '', name: decode((m.title && (m.title.rendered ?? m.title.raw)) || '').replace(/<[^>]+>/g, '') || file,
    thumb: (sz.medium || sz.thumbnail || {}).source_url || '', tiny: (sz.thumbnail || sz.medium || {}).source_url || '', large: (sz.large || {}).source_url || '',
    width: d.width || 0, height: d.height || 0, size: d.filesize || 0,
  };
};
// {page, perPage, type: 'all'|'image'|'video', search} → { items, total, totalPages }
async function listMedia(cfg, { page = 1, perPage = 40, type = 'all', search = '', after, before, modifiedAfter } = {}) {
  const q = new URLSearchParams({ per_page: String(perPage), page: String(page), _fields: MEDIA_FIELDS, orderby: 'date', order: 'desc' });
  if (type === 'image' || type === 'video') q.set('media_type', type);
  if (search) q.set('search', search);
  if (after) q.set('after', after);
  if (modifiedAfter) q.set('modified_after', modifiedAfter);
  if (before) q.set('before', before);
  const { data, res } = await req(cfg, `/wp/v2/media?${q}`, { raw: true });
  return {
    items: (data || []).filter((m) => m.media_type === 'image' || m.media_type === 'video').map(normMedia),
    total: Number(res.headers.get('x-wp-total') || 0), totalPages: Number(res.headers.get('x-wp-totalpages') || 1),
  };
}
// Cambia la fecha de un medio (p. ej. a la de la entrada donde se publicó)
const setMediaDate = (cfg, id, date) => req(cfg, `/wp/v2/media/${Number(id)}`, { method: 'POST', json: { date: String(date).slice(0, 19) } });
const getMedia = (cfg, id) => req(cfg, `/wp/v2/media/${Number(id)}?context=edit`);
const deleteMedia = (cfg, id) => req(cfg, `/wp/v2/media/${Number(id)}?force=true`, { method: 'DELETE' });

// Dirección de una foto sin dominio, sin extensión ni sufijos de tamaño (-300x200, -scaled, -e1234)
const mediaBase = (u) => {
  const m = String(u || '').split(/[?#]/)[0].match(/\/wp-content\/uploads\/.+$/);
  return m ? m[0].replace(/\.[a-z0-9]+$/i, '').replace(/(-scaled|-e\d+|-\d+x\d+)+$/i, '').toLowerCase() : '';
};
// Qué medios se usan en las entradas y páginas. posts: [{id,title,content,featured_media}], media: [{id,source_url}]
// → { [idMedio]: [{id, title} de cada entrada donde se usa] }
function usedMediaIds(posts, media) {
  const byBase = new Map();
  for (const m of media || []) { const b = mediaBase(m.source_url); if (b) byBase.set(b, [...(byBase.get(b) || []), m.id]); }
  const out = {};
  const mark = (id, p) => {
    id = Number(id); if (!id) return;
    const list = (out[id] ||= []);
    const title = p.title?.raw ?? p.title?.rendered ?? p.title ?? '';
    const label = (typeof title === 'string' ? decode(title) : '') || `#${p.id}`;
    if (!list.some((x) => x.id === p.id)) list.push({ id: p.id, title: label, date: p.date || '' });
  };
  for (const p of posts || []) {
    const html = typeof p.content === 'string' ? p.content : (p.content?.raw ?? p.content?.rendered ?? '');
    if (p.featured_media) mark(p.featured_media, p);
    for (const m of html.matchAll(/wp-image-(\d+)/g)) mark(m[1], p);
    for (const c of html.matchAll(/<!--\s*wp:[^>]*?-->/g)) {
      for (const m of c[0].matchAll(/"(?:id|mediaId)"\s*:\s*(\d+)/g)) mark(m[1], p);
      for (const m of c[0].matchAll(/"ids"\s*:\s*\[([\d,\s]*)\]/g)) m[1].split(',').forEach((x) => mark(x, p));
    }
    for (const u of html.matchAll(/\/wp-content\/uploads\/[^\s"'<>),\\]+/g)) {
      for (const id of byBase.get(mediaBase(u[0])) || []) mark(id, p);
    }
  }
  return out;
}
async function mediaUsage(cfg, knownMedia) {
  const posts = [];
  for (const coll of ['posts', 'pages']) {
    posts.push(...(await allParallel(cfg, `/wp/v2/${coll}?context=edit&status=publish,draft,private,pending,future&_fields=id,title,content,featured_media,date`)));
  }
  // fechas de todas las entradas (para las fotos subidas a una entrada aunque ya no salgan en ella)
  const withDates = (u) => Object.assign(u, { _postDates: Object.fromEntries(posts.map((p) => [p.id, p.date])) });
  if (knownMedia) return withDates(usedMediaIds(posts, knownMedia));
  const media = [];
  for (let page = 1; page <= 200; page++) {
    const { data, res } = await req(cfg, `/wp/v2/media?per_page=100&page=${page}&_fields=id,source_url`, { raw: true });
    media.push(...(data || []));
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1)) break;
  }
  return usedMediaIds(posts, media);
}

// --- Entradas ----------------------------------------------------------------------
// Recibe los campos en el formato de WordPress.com (nombres separados por comas) y los adapta
// Metas que se envían: descripción SEO y ajustes de página de Astra (f.astraMeta, solo con el complemento 1.4)
function metaOf(f) {
  const meta = {};
  if (Object.values(SEO_KEYS).includes(f.seoKey) && f.seoDesc !== undefined) meta[f.seoKey] = f.seoDesc;
  if (f.astraMeta && typeof f.astraMeta === 'object') for (const k of TS.ASTRA_KEYS) if (typeof f.astraMeta[k] === 'string') meta[k] = f.astraMeta[k];
  return Object.keys(meta).length ? { meta } : {};
}
async function toRest(cfg, f) {
  const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const isPage = f.type === 'page'; // las páginas no tienen categorías ni etiquetas
  return {
    title: f.title, content: f.content, status: f.status, excerpt: f.excerpt || '',
    ...(f.slug ? { slug: f.slug } : {}),
    ...metaOf(f),
    ...(f.featured_image ? { featured_media: f.featured_image } : {}),
    ...(isPage && f.parent !== undefined ? { parent: Number(f.parent) || 0 } : {}),
    ...(f.date ? { date_gmt: new Date(f.date).toISOString().slice(0, 19) } : {}),
    ...(isPage ? {} : { categories: await categoryIds(cfg, split(f.categories), !!f.createCategories), tags: await tagIds(cfg, split(f.tags)) }),
  };
}
// Descripción para buscadores: Yoast SEO y Rank Math la guardan en un campo «meta» de la entrada, y solo
// se puede escribir desde aquí si el plugin lo publica en el REST. Si no, se usa el extracto.
const SEO_KEYS = { yoast: '_yoast_wpseo_metadesc', rankmath: 'rank_math_description' };
function detectSeo({ namespaces = [], meta = {}, hasYoastHead = false } = {}) {
  for (const [plugin, key] of Object.entries(SEO_KEYS)) if (meta && key in meta) return { plugin, key, writable: true };
  if (hasYoastHead || namespaces.includes('yoast/v1')) return { plugin: 'yoast', key: null, writable: false };
  if (namespaces.includes('rankmath/v1')) return { plugin: 'rankmath', key: null, writable: false };
  return { plugin: null, key: null, writable: false };
}
let seoCache = null;
async function seoInfo(cfg) {
  if (seoCache && seoCache.site === cfg.wpUrl && Date.now() - seoCache.at < 600000) return seoCache.info;
  const root = await req(cfg, '/').catch(() => ({}));
  const [sample] = await req(cfg, '/wp/v2/posts?per_page=1&context=edit&_fields=id,meta,yoast_head_json').catch(() => []);
  const info = detectSeo({ namespaces: root.namespaces || [], meta: sample?.meta || {}, hasYoastHead: !!sample?.yoast_head_json });
  seoCache = { site: cfg.wpUrl, at: Date.now(), info };
  return info;
}
const fromRest = (p) => ({ ID: p.id, URL: p.link, status: p.status, date: p.date_gmt ? p.date_gmt + 'Z' : p.date, modified: p.modified_gmt ? p.modified_gmt + 'Z' : null });
// Guarda la entrada y comprueba que WordPress se ha quedado con la fecha pedida. En los borradores,
// WordPress puede dejar la fecha «sin fijar» y entonces, al publicarlos desde wp-admin, les pone la de ese
// momento; si la fecha guardada no coincide, se vuelve a enviar (local y UTC) para dejarla fijada.
async function savePost(cfg, route, f) {
  const body = await toRest(cfg, f);
  let p = await req(cfg, route, { method: 'POST', json: body });
  if (body.date_gmt) p = await ensureDate(cfg, f.type === 'page' ? 'pages' : 'posts', p, body.date_gmt);
  return fromRest(p);
}
// Si la fecha guardada no coincide con la pedida (UTC, «AAAA-MM-DDTHH:MM:SS»), la envía de nuevo con la hora local de la web
async function ensureDate(cfg, coll, p, dateGmt) {
  const want = new Date(dateGmt + 'Z').getTime();
  const got = p.date_gmt ? new Date(p.date_gmt + 'Z').getTime() : NaN;
  if (Math.abs(got - want) < 60000) return p;
  // la hora local de la web se calcula con su diferencia horaria (Ajustes → Generales → Zona horaria)
  const site = await req(cfg, '/').catch(() => ({}));
  const offset = p.date && p.date_gmt ? new Date(p.date + 'Z') - new Date(p.date_gmt + 'Z') : (Number(site.gmt_offset) || 0) * 3600000;
  const local = new Date(want + offset).toISOString().slice(0, 19);
  return req(cfg, `/wp/v2/${coll}/${p.id}`, { method: 'POST', json: { date: local, date_gmt: dateGmt } });
}
// Cambia solo la fecha (y el estado) de una entrada sin tocar el resto: lo usa el calendario al arrastrar
async function setPostDate(cfg, id, iso, status, type) {
  const d = new Date(iso);
  if (isNaN(d)) throw new Error('Fecha no válida.');
  const dateGmt = d.toISOString().slice(0, 19);
  const coll = type === 'page' ? 'pages' : 'posts';
  let p = await req(cfg, `/wp/v2/${coll}/${id}`, { method: 'POST', json: { date_gmt: dateGmt, ...(status ? { status } : {}) } });
  p = await ensureDate(cfg, coll, p, dateGmt);
  return { id: p.id, status: p.status, date: p.date_gmt ? p.date_gmt + 'Z' : p.date };
}
const createPost = (cfg, f) => savePost(cfg, `/wp/v2/${f.type === 'page' ? 'pages' : 'posts'}`, f);
const updatePost = (cfg, id, f) => savePost(cfg, `/wp/v2/${f.type === 'page' ? 'pages' : 'posts'}/${id}`, f);

// author: id de una persona de WordPress (para «Solo las mías»)
async function listPosts(cfg, { type = 'post', status = 'any', search = '', page = 1, number = 20, after, before, orderby = 'date', include, author, order = 'desc' } = {}) {
  const coll = type === 'page' ? 'pages' : 'posts';
  const q = new URLSearchParams({
    status: status === 'any' ? 'publish,future,draft,pending,private' : status, per_page: String(number), page: String(page),
    orderby: orderby === 'modified' ? 'modified' : 'date', order: order === 'asc' ? 'asc' : 'desc', context: 'edit', _embed: 'wp:featuredmedia,author',
    ...(Number(author) > 0 ? { author: String(Number(author)) } : {}),
    ...(search ? { search } : {}), ...(after ? { after } : {}), ...(before ? { before } : {}),
    ...(include?.length ? { include: include.join(',') } : {}),
  });
  const { data, res } = await req(cfg, `/wp/v2/${coll}?${q}`, { raw: true });
  const cats = catCache || (await categories(cfg).catch(() => []));
  return {
    found: Number(res.headers.get('x-wp-total') || data.length),
    items: data.map((p) => ({
      id: p.id, type, status: p.status, date: p.date_gmt ? p.date_gmt + 'Z' : p.date, modified: p.modified_gmt ? p.modified_gmt + 'Z' : p.modified,
      title: p.title?.raw || p.title?.rendered || '(sin título)', url: p.link,
      image: p._embedded?.['wp:featuredmedia']?.[0]?.source_url || '', featured: p.featured_media || 0,
      categories: (p.categories || []).map((id) => cats.find((c) => c.id === id)?.name).filter(Boolean),
      excerpt: (p.excerpt?.raw || p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim().slice(0, 160),
      author: postAuthor(p),
    })),
  };
}
// Solo las fechas (ligero) de todas las entradas que cumplen los filtros: alimenta la línea temporal del Blog.
async function listDates(cfg, { type = 'post', status = 'any', search = '', after, before, include, author, max = 5000 } = {}) {
  const coll = type === 'page' ? 'pages' : 'posts';
  const out = [];
  for (let page = 1; out.length < max; page++) {
    const q = new URLSearchParams({
      status: status === 'any' ? 'publish,future,draft,pending,private' : status, per_page: '100', page: String(page),
      orderby: 'date', order: 'desc', _fields: 'id,date_gmt,date',
      ...(Number(author) > 0 ? { author: String(Number(author)) } : {}),
      ...(search ? { search } : {}), ...(after ? { after } : {}), ...(before ? { before } : {}),
      ...(include?.length ? { include: include.join(',') } : {}),
    });
    const { data, res } = await req(cfg, `/wp/v2/${coll}?${q}`, { raw: true });
    for (const p of data) out.push(p.date_gmt ? p.date_gmt + 'Z' : p.date);
    if (data.length < 100 || out.length >= Number(res.headers.get('x-wp-total') || 0)) break;
  }
  return out;
}
// Autor de una entrada de la lista (con _embed=author): { id, name, avatar }
function postAuthor(p) {
  const a = p._embedded?.author?.[0];
  const av = a?.avatar_urls || {};
  return { id: Number(p.author) || Number(a?.id) || 0, name: decode(a?.name || ''), avatar: String(av['48'] || av['24'] || av['96'] || '') };
}
// Revisión del blog: recorre todas las entradas (menos la papelera) con campos ligeros y dice cuáles no tienen
// categoría o imagen destacada, y de las que no tienen destacada, cuáles tienen alguna foto en el contenido.
async function blogHealth(cfg, { onProgress } = {}) {
  const BC = require('../renderer/blogcheck');
  const cats = await categories(cfg).catch(() => []);
  const byId = new Map(cats.map((c) => [c.id, c.name]));
  const rows = await allParallel(cfg, '/wp/v2/posts?context=edit&status=publish,draft,private,pending,future&_fields=id,title,status,date,categories,featured_media', { onProgress });
  const sum = (p, extra = {}) => ({ id: p.id, title: p.title?.raw || p.title?.rendered || '(sin título)', status: p.status, date: p.date, ...extra });
  const noCat = rows.filter((p) => BC.isUncategorized((p.categories || []).map((id) => byId.get(id)))).map((p) => sum(p));
  const noImgRows = rows.filter((p) => !p.featured_media);
  // contenido solo de las que no tienen destacada, en lotes con include
  const withPhoto = new Set();
  const chunks = [];
  for (let i = 0; i < noImgRows.length; i += 50) chunks.push(noImgRows.slice(i, i + 50).map((p) => p.id));
  let next = 0;
  const work = async () => {
    while (next < chunks.length) {
      const ids = chunks[next++];
      const got = await req(cfg, `/wp/v2/posts?context=edit&status=publish,draft,private,pending,future&include=${ids.join(',')}&per_page=50&_fields=id,content`).catch(() => []);
      for (const p of got) if (BC.firstPhotoHtml(p.content?.raw || '')) withPhoto.add(p.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, work));
  const noImg = noImgRows.map((p) => sum(p, { photo: withPhoto.has(p.id) }));
  return { total: rows.length, noCat, noImg, at: Date.now() };
}
// Título, extracto y un trozo del texto de muchas entradas (para sugerir o recomendar categorías)
async function postsText(cfg, ids) {
  const out = [];
  const list = ids ? ids : null;
  if (list) {
    for (let i = 0; i < list.length; i += 50) {
      const got = await req(cfg, `/wp/v2/posts?context=edit&status=publish,draft,private,pending,future&include=${list.slice(i, i + 50).join(',')}&per_page=50&_fields=id,title,excerpt,content,categories`);
      out.push(...got);
    }
  } else out.push(...await allParallel(cfg, '/wp/v2/posts?context=edit&status=publish,draft,private,pending,future&_fields=id,title,excerpt,content,categories'));
  const cats = catCache || await categories(cfg).catch(() => []);
  const plain = (h) => String(h || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return out.map((p) => ({
    id: p.id, title: decode(p.title?.raw || p.title?.rendered || ''), excerpt: plain(p.excerpt?.raw || p.excerpt?.rendered).slice(0, 300),
    text: plain(p.content?.raw).slice(0, 1500),
    categories: (p.categories || []).map((id) => cats.find((c) => c.id === id)?.name).filter(Boolean),
  }));
}
// Páginas de la web (id, título y página superior), para elegir la «Página superior» en el editor
async function listPagesLite(cfg) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const { data, res } = await req(cfg, `/wp/v2/pages?context=edit&_fields=id,title,parent&per_page=100&page=${page}`, { raw: true });
    out.push(...(data || []).map((p) => ({ id: p.id, title: p.title?.raw || p.title?.rendered || '(sin título)', parent: Number(p.parent) || 0 })));
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1)) break;
  }
  return out;
}
// Copia en borrador de una entrada o página (mismo contenido, extracto, categorías, etiquetas, imagen destacada o padre)
async function duplicatePost(cfg, id, type) {
  const p = await getPost(cfg, id, type);
  const isPage = type === 'page';
  const created = await createPost(cfg, {
    type: isPage ? 'page' : 'post', title: '(copia) ' + p.title, content: p.content, excerpt: p.excerpt, status: 'draft',
    ...(isPage ? { parent: p.parent } : { categories: p.categories.join(','), tags: p.tags.join(',') }),
    ...(p.featured ? { featured_image: p.featured } : {}),
  });
  return { id: created.ID, type: isPage ? 'page' : 'post', url: created.URL };
}
// type: la pestaña Blog indica si es entrada o página
const coll = (type) => (type === 'page' ? 'pages' : 'posts');
const setPostStatus = (cfg, id, status, type) => req(cfg, `/wp/v2/${coll(type)}/${id}`, { method: 'POST', json: { status } });
const trashPost = (cfg, id, type) => req(cfg, `/wp/v2/${coll(type)}/${id}`, { method: 'DELETE' });
// Entrada completa (contenido en bruto, para traer al editor los cambios hechos en WordPress)
async function getPost(cfg, id, type) {
  const p = await req(cfg, `/wp/v2/${coll(type)}/${id}?context=edit&_embed=wp:term,wp:featuredmedia`);
  const terms = (p._embedded?.['wp:term'] || []).flat();
  const fm = p._embedded?.['wp:featuredmedia']?.[0];
  return {
    categories: terms.filter((x) => x.taxonomy === 'category').map((x) => x.name),
    tags: terms.filter((x) => x.taxonomy === 'post_tag').map((x) => x.name),
    featuredImg: fm?.source_url ? { id: fm.id, url: fm.source_url, alt: fm.alt_text || '' } : null,
    id: p.id, status: p.status, url: p.link, date: p.date_gmt ? p.date_gmt + 'Z' : p.date, modified: p.modified_gmt ? p.modified_gmt + 'Z' : p.modified,
    title: p.title?.raw ?? '', excerpt: p.excerpt?.raw ?? '', content: p.content?.raw ?? '', featured: p.featured_media || null, slug: p.slug || '',
    seoDesc: p.meta?.[SEO_KEYS.yoast] || p.meta?.[SEO_KEYS.rankmath] || '',
    astra: TS.astraFromMeta(p.meta),
    type: type === 'page' ? 'page' : 'post', parent: Number(p.parent) || 0,
  };
}
// Versiones anteriores que WordPress ha guardado de una entrada (las más recientes primero)
async function listRevisions(cfg, id, type) {
  const list = await req(cfg, `/wp/v2/${coll(type)}/${id}/revisions?context=edit&per_page=50`);
  return (Array.isArray(list) ? list : []).map((r) => ({
    id: r.id, date: r.date_gmt ? r.date_gmt + 'Z' : r.date, title: r.title?.raw ?? '', content: r.content?.raw ?? '', excerpt: r.excerpt?.raw ?? '',
  })).sort((a, b) => new Date(b.date) - new Date(a.date));
}
// Solo el contenido (sin tocar categorías, etiquetas ni nada más)
const updateContent = (cfg, id, content, type) => req(cfg, `/wp/v2/${coll(type)}/${id}`, { method: 'POST', json: { content } });
// Cambia solo los campos indicados (p. ej. { content, title })
const updateFields = (cfg, id, fields, type) => req(cfg, `/wp/v2/${coll(type)}/${id}`, { method: 'POST', json: fields });
// Todas las entradas (o páginas) con contenido en bruto, para buscar y reemplazar texto; ids opcional
async function allRaw(cfg, type, ids) {
  const out = [];
  const q0 = { context: 'edit', per_page: '100', _fields: 'id,title,content,status,link,slug,date,featured_media', status: 'publish,future,draft,pending,private' };
  if (ids?.length) {
    for (let i = 0; i < ids.length; i += 100) {
      const q = new URLSearchParams({ ...q0, include: ids.slice(i, i + 100).join(',') });
      out.push(...await req(cfg, `/wp/v2/${coll(type)}?${q}`));
    }
    return out;
  }
  for (let page = 1; page <= 200; page++) {
    const { data, res } = await req(cfg, `/wp/v2/${coll(type)}?${new URLSearchParams({ ...q0, page: String(page) })}`, { raw: true });
    out.push(...data);
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1) || !data.length) break;
  }
  return out;
}
// Borrado definitivo (solo para el borrador de la vista previa, que Ecos vuelve a crear al enviar)
const deletePost = (cfg, id, type) => req(cfg, `/wp/v2/${coll(type)}/${id}?force=true`, { method: 'DELETE' });

// Estado actual de varias entradas: { id: 'publish' | 'draft' | 'trash' | … | 'deleted' }
async function postStatuses(cfg, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const q = new URLSearchParams({ include: chunk.join(','), per_page: '100', context: 'edit', _fields: 'id,status',
      status: 'publish,future,draft,pending,private,trash' });
    const found = await req(cfg, `/wp/v2/posts?${q}`);
    for (const id of chunk) out[id] = found.find((x) => x.id === id)?.status || 'deleted';
  }
  return out;
}

// ¿Existe ya una entrada o página con ese «slug» (o, si no hay, ese título)? → id o null
// Para reconocer una entrada aunque cambie la forma de escribirla: sin tildes, mayúsculas ni signos
const normTitle = (s) => String(s || '').replace(/&#0?39;|&#8217;|&#8216;/g, "'").replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, ' ')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normSlug = (s) => { try { return decodeURIComponent(String(s || '')).toLowerCase(); } catch { return String(s || '').toLowerCase(); } };
// Índice ligero de todas las entradas (o páginas) de la web, en cualquier estado, para saber cuáles ya existen
async function postIndex(cfg, type = 'post') {
  const coll = type === 'page' ? 'pages' : 'posts';
  const out = [];
  for (let page = 1; page < 50; page++) {
    const { data, res } = await req(cfg, `/wp/v2/${coll}?status=publish,future,draft,pending,private&context=edit&_fields=id,slug,title,date,status&per_page=100&page=${page}`, { raw: true });
    out.push(...data.map((p) => ({ id: p.id, slug: normSlug(p.slug), title: normTitle(p.title?.raw ?? p.title?.rendered), day: String(p.date || '').slice(0, 10), status: p.status })));
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1)) break;
  }
  return out;
}
// Busca en el índice una entrada de la copia: por dirección; si no, por título y día; si no, por título (si solo hay una)
function matchExisting(index, x) {
  const slug = normSlug(x.slug), title = normTitle(x.title), day = String(x.date || '').slice(0, 10);
  if (slug) { const h = index.find((p) => p.slug && p.slug === slug); if (h) return h; }
  if (!title) return null;
  const same = index.filter((p) => p.title === title);
  return same.find((p) => p.day === day) || (same.length === 1 ? same[0] : null);
}
async function findExisting(cfg, type, slug, title, date) {
  const coll = type === 'page' ? 'pages' : 'posts';
  const base = { status: 'publish,future,draft,pending,private', context: 'edit', _fields: 'id,title,slug,date,status', per_page: '20' };
  const toIdx = (p) => ({ id: p.id, slug: normSlug(p.slug), title: normTitle(p.title?.raw), day: String(p.date || '').slice(0, 10), status: p.status });
  const found = [];
  if (slug) found.push(...(await req(cfg, `/wp/v2/${coll}?${new URLSearchParams({ ...base, slug })}`)).map(toIdx));
  if (title) found.push(...(await req(cfg, `/wp/v2/${coll}?${new URLSearchParams({ ...base, search: String(title).slice(0, 80) })}`)).map(toIdx));
  const hit = matchExisting(found, { slug, title, date });
  return hit ? hit.id : null;
}
// keep: el archivo tal cual, sin reducir ni volver a comprimir (fotos restauradas: calidad original)
const uploadNamed = (cfg, buf, name, opts) => uploadBuffer(cfg, buf, name, MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream', opts);

const publicBase = (cfg) => { try { return base(cfg); } catch { return null; } };
const publicUrl = (_cfg, url) => url;

// ---------------------------------------------------------------- Estructura de la web
// Portada, menús (con sus elementos), árbol de páginas y categorías con sus entradas.
// Todas las páginas de una lista, varias a la vez (la primera dice cuántas hay)
async function allParallel(cfg, route, { per = 100, conc = 6, onProgress } = {}) {
  const url = (page) => `${route}${route.includes('?') ? '&' : '?'}per_page=${per}&page=${page}`;
  const first = await req(cfg, url(1), { raw: true });
  const total = Number(first.res.headers.get('x-wp-totalpages') || 1);
  const pages = [first.data || []];
  let next = 2, done = 1;
  const work = async () => {
    while (next <= total) {
      const p = next++;
      pages[p - 1] = await req(cfg, url(p)).catch(() => []);
      onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, Math.max(0, total - 1)) }, work));
  return pages.flat();
}
async function all(cfg, route) {
  const out = [];
  for (let page = 1; page < 30; page++) {
    const d = await req(cfg, `${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`).catch((e) => { if (page > 1) return []; throw e; });
    out.push(...d);
    if (d.length < 100) break;
  }
  return out;
}
const raw = (x) => (x?.raw ?? x?.rendered ?? '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–');
async function siteStructure(cfg) {
  const settings = await req(cfg, '/wp/v2/settings').catch(() => null);
  const pages = (await all(cfg, '/wp/v2/pages?context=edit&status=publish,draft,private,pending,future&_fields=id,title,status,parent,menu_order,link'))
    .map((p) => ({ id: p.id, title: raw(p.title) || '(sin título)', status: p.status, parent: p.parent || 0, order: p.menu_order || 0, link: p.link }));
  const categories = (await all(cfg, '/wp/v2/categories?_fields=id,name,count,parent,link'))
    .map((c) => ({ id: c.id, name: raw({ raw: c.name }), count: c.count, parent: c.parent || 0, link: c.link }));
  const menus = [];
  let menuNote = '';
  try {
    const ms = await req(cfg, '/wp/v2/menus?context=edit&per_page=100');
    const locs = await req(cfg, '/wp/v2/menu-locations').catch(() => ({}));
    for (const m of ms) {
      const items = await all(cfg, `/wp/v2/menu-items?menus=${m.id}&context=edit`);
      menus.push({
        id: m.id, name: m.name, locations: Object.values(locs).filter((l) => l.menu === m.id).map((l) => l.description || l.name),
        items: items.map((i) => ({ id: i.id, title: raw(i.title), parent: i.parent || 0, order: i.menu_order || 0, type: i.type, object: i.object, objectId: i.object_id, url: i.url })),
      });
    }
  } catch (e) { menuNote = e.message; }
  // temas de bloques: el menú es un bloque de navegación (se edita en el editor del sitio)
  let navigation = [];
  if (!menus.length) navigation = await req(cfg, '/wp/v2/navigation?context=edit&per_page=20&_fields=id,title').then((n) => n.map((x) => ({ id: x.id, title: raw(x.title) }))).catch(() => []);
  return {
    settings: settings && { title: settings.title, showOnFront: settings.show_on_front, pageOnFront: settings.page_on_front || 0, pageForPosts: settings.page_for_posts || 0 },
    pages, categories, menus, menuNote, navigation,
  };
}
async function categoryPosts(cfg, catId) {
  return (await all(cfg, `/wp/v2/posts?categories=${catId}&context=edit&status=publish,draft,private,pending,future&_fields=id,title,status,sticky,categories,date`))
    .map((p) => ({ id: p.id, title: raw(p.title) || '(sin título)', status: p.status, sticky: !!p.sticky, categories: p.categories, date: p.date }));
}
// Crear desde la estructura (los cambios se aplican al momento)
async function createPage(cfg, { title, parent = 0, status = 'draft' }) {
  const p = await req(cfg, '/wp/v2/pages?context=edit', { method: 'POST', json: { title, parent: parent || 0, status } });
  return { id: p.id, title: raw(p.title) || title, status: p.status, parent: p.parent || 0, order: p.menu_order || 0, link: p.link };
}
async function createCategory(cfg, { name, parent = 0 }) {
  const c = await req(cfg, '/wp/v2/categories', { method: 'POST', json: { name, parent: parent || 0 } });
  if (catCache) catCache.push({ id: c.id, name: decode(c.name), slug: c.slug }); // para que se pueda asignar enseguida
  return { id: c.id, name: raw({ raw: c.name }), count: 0, parent: c.parent || 0, link: c.link };
}
const trashPage = (cfg, id) => req(cfg, `/wp/v2/pages/${id}`, { method: 'DELETE' }).then(() => true);
const deleteCategory = (cfg, id) => req(cfg, `/wp/v2/categories/${id}?force=true`, { method: 'DELETE' }).then(() => true);
// ch: { settings, categories:[{id,name}], pages:[{id,parent,order,status,title}], menuDel:[id], menuAdd:[{tmp,menu,title,type,object,objectId,url,parent,order}],
//       menuItems:[{id,parent,order}], posts:[{id,categories,sticky}] }  (los «tmp» son elementos de menú nuevos)
async function saveStructure(cfg, ch, progress = () => {}) {
  const errors = [];
  const run = async (what, fn) => { try { await fn(); progress(what); } catch (e) { errors.push(`${what}: ${e.message}`); } };
  if (ch.settings) await run('Portada', () => req(cfg, '/wp/v2/settings', { method: 'POST', json: { show_on_front: ch.settings.showOnFront, page_on_front: ch.settings.pageOnFront || 0, page_for_posts: ch.settings.pageForPosts || 0 } }));
  for (const p of ch.pages || []) await run(`Página ${p.id}`, () => req(cfg, `/wp/v2/pages/${p.id}`, { method: 'POST', json: { ...(p.parent !== undefined ? { parent: p.parent } : {}), ...(p.order !== undefined ? { menu_order: p.order } : {}), ...(p.status ? { status: p.status } : {}), ...(p.title ? { title: p.title } : {}) } }));
  for (const c of ch.categories || []) await run(`Categoría ${c.id}`, () => req(cfg, `/wp/v2/categories/${c.id}`, { method: 'POST', json: { name: c.name } }));
  for (const id of ch.menuDel || []) await run(`Menú ${id}`, () => req(cfg, `/wp/v2/menu-items/${id}?force=true`, { method: 'DELETE' }));
  const ids = new Map();
  const real = (x) => (typeof x === 'string' && ids.has(x) ? ids.get(x) : x);
  for (const a of ch.menuAdd || []) {
    await run(`Menú «${a.title}»`, async () => {
      const r = await req(cfg, '/wp/v2/menu-items', { method: 'POST', json: {
        title: a.title, type: a.type, object: a.object, ...(a.objectId ? { object_id: a.objectId } : {}), ...(a.url ? { url: a.url } : {}),
        menus: a.menu, parent: Number(real(a.parent)) || 0, menu_order: a.order, status: 'publish' } });
      ids.set(a.tmp, r.id);
    });
  }
  for (const m of ch.menuItems || []) await run(`Menú ${m.id}`, () => req(cfg, `/wp/v2/menu-items/${m.id}`, { method: 'POST', json: { parent: Number(real(m.parent)) || 0, menu_order: m.order } }));
  for (const p of ch.posts || []) await run(`Entrada ${p.id}`, () => req(cfg, `/wp/v2/posts/${p.id}`, { method: 'POST', json: { categories: p.categories, sticky: p.sticky } }));
  return { errors };
}

// --- Complemento de Ecos para WordPress (wp-plugin/ecos): estado y vaciado de caché ---
// Versión que trae esta app (cabecera del archivo del complemento)
function helperBundledVersion() {
  try { return (/^\s*\*\s*Version:\s*([\d.]+)/m.exec(fs.readFileSync(path.join(__dirname, '..', 'wp-plugin', 'ecos', 'ecos.php'), 'utf8')) || [])[1] || '0'; } catch { return '0'; }
}
const versionLess = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; }
  return false;
};
// Respuesta de GET /ecos/v1/status → { installed, version, outdated, caches, bundled }
function parseHelperStatus(data, bundled = helperBundledVersion()) {
  if (!data || data.plugin !== 'ecos' || !data.version) return { installed: false, version: '', outdated: false, caches: [], bundled };
  const version = String(data.version);
  return { installed: true, version, outdated: versionLess(version, bundled), caches: Array.isArray(data.caches) ? data.caches.map(String) : [], bundled };
}
const helperCache = new Map(); // dirección de la web → { at, st }
async function helperStatus(cfg, { force = false } = {}) {
  const key = base(cfg);
  const hit = helperCache.get(key);
  if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.st;
  let st;
  try { st = parseHelperStatus(await req(cfg, '/ecos/v1/status')); } catch { st = parseHelperStatus(null); }
  helperCache.set(key, { at: Date.now(), st });
  return st;
}
// Vacía la caché de una entrada; devuelve los nombres de lo que se purgó
async function helperPurge(cfg, id) {
  const r = await req(cfg, '/ecos/v1/purge', { method: 'POST', json: { id: Number(id) } });
  return Array.isArray(r?.purged) ? r.purged.map(String) : [];
}

// Visitas (complemento ≥ 1.1.0): GET /ecos/v1/stats?days=N → { days, total, daily:[{day,views}], top:[{id,title,link,views}] }
function parseHelperStats(d) {
  const n = (x) => Math.max(0, Math.floor(Number(x) || 0));
  if (!d || !Array.isArray(d.daily)) return null;
  return {
    days: n(d.days), total: n(d.total),
    daily: d.daily.map((x) => ({ day: String(x.day || ''), views: n(x.views) })),
    top: (Array.isArray(d.top) ? d.top : []).map((x) => ({ id: n(x.id), title: String(x.title || ''), link: String(x.link || ''), views: n(x.views) })),
  };
}
async function helperStats(cfg, days = 30) {
  const d = Math.max(1, Math.min(365, Math.floor(Number(days)) || 30));
  const r = parseHelperStats(await req(cfg, `/ecos/v1/stats?days=${d}&limit=5`));
  if (!r) throw new Error('El complemento no devolvió estadísticas. Actualízalo desde Conexiones.');
  return r;
}
// Datos de tu organización para Google (JSON-LD): GET/POST /ecos/v1/settings → { saved, settings }
const SETTINGS_KEYS = ['name', 'street', 'postal', 'city', 'email', 'phone', 'instagram', 'facebook'];
function parseHelperSettings(d) {
  const s = d?.settings || {};
  return { saved: !!d?.saved, settings: Object.fromEntries(SETTINGS_KEYS.map((k) => [k, String(s[k] ?? '')])) };
}
async function helperSettings(cfg) { return parseHelperSettings(await req(cfg, '/ecos/v1/settings')); }
async function helperSaveSettings(cfg, settings) {
  const body = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, String(settings?.[k] ?? '').trim()]));
  return parseHelperSettings(await req(cfg, '/ecos/v1/settings', { method: 'POST', json: body }));
}

// Bloqueo de edición (complemento ≥ 1.2.0): POST/DELETE /ecos/v1/lock { id } → { locked, user:{id,name,avatar} }
// locked = otra persona la tiene abierta ahora mismo (en Ecos o en el editor de WordPress)
function parseHelperLock(d) {
  const u = d?.user;
  return { supported: !!d && typeof d === 'object' && 'locked' in d, locked: !!d?.locked, user: u && u.name ? { id: Number(u.id) || 0, name: String(u.name), avatar: String(u.avatar || '') } : null };
}
// ¿Esta versión del complemento trae el bloqueo? (≥ 1.2.0)
const helperHasLock = (version) => !!version && !versionLess(version, '1.2.0');
async function helperLock(cfg, id, { force = false } = {}) {
  return parseHelperLock(await req(cfg, '/ecos/v1/lock', { method: 'POST', json: { id: Number(id), ...(force ? { force: true } : {}) } }));
}
async function helperUnlock(cfg, id) {
  const r = await req(cfg, '/ecos/v1/lock', { method: 'DELETE', json: { id: Number(id) } });
  return !!r?.released;
}

// Copia de emergencia: lectura suelta de la API (null si no existe o no hay permiso) y exportación del complemento (≥ 1.3.0)
async function getJson(cfg, route) { return req(cfg, route); }
const helperHasExport = (version) => !!version && !versionLess(version, '1.3.0');
async function helperExport(cfg) {
  const d = await req(cfg, '/ecos/v1/export');
  if (!d || d.plugin !== 'ecos') throw new Error('El complemento no devolvió la configuración. Actualízalo desde Conexiones.');
  return d;
}

// Estilos de la web y vista previa exacta (complemento 1.4.0)
const helperHasRender = (version) => TS.helperHasTheme(version);
async function helperRender(cfg, payload) {
  const d = await req(cfg, '/ecos/v1/render', { method: 'POST', json: payload });
  if (!d || d.plugin !== 'ecos' || typeof d.html !== 'string') throw new Error('El complemento no devolvió la vista previa. Actualízalo desde Conexiones.');
  return d.html;
}
const themeStyles = (cfg, helperVersion) => TS.fetchTheme((route) => req(cfg, route), helperVersion);

module.exports = { setUploadGuard, findMediaByName, helperHasRender, helperRender, themeStyles, getJson, helperHasExport, helperExport, helperHasLock, me, parseMe, postModified, helperLock, helperUnlock, parseHelperLock, helperStats, parseHelperStats, helperSettings, helperSaveSettings, parseHelperSettings, helperStatus, helperPurge, parseHelperStatus, helperBundledVersion, detectSeo, seoInfo, allParallel, setMediaDate, postIndex, matchExisting, normTitle, listMedia, getMedia, deleteMedia, usedMediaIds, mediaUsage, changeCategory, mediaExists, findMediaByUrl, siteStructure, categoryPosts, saveStructure, createPage, createCategory, trashPage, deleteCategory, findExisting, uploadNamed, postStatuses, login, siteInfo, categories, uploadFile, uploadFromUrls, updateMedia, createPost, updatePost, listPosts, listDates, setPostDate, setPostStatus, trashPost, deletePost, getPost, listRevisions, updateContent, publicBase, publicUrl, updateFields, allRaw, toRest, listPagesLite, duplicatePost, blogHealth, postsText };

// Para módulos propios que hablan con la API (src/wpblocks.js)
module.exports.request = req;
