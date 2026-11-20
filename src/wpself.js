// WordPress propio (instalado en tu hosting, con wp-admin): API REST estándar /wp-json/wp/v2
// con una «contraseña de aplicación» (wp-admin → Usuarios → Perfil → Contraseñas de aplicación).
// Ofrece las mismas funciones que src/wpcom.js para que el resto de Ecos no note la diferencia.
const fs = require('fs');
const path = require('path');
const { AuthError } = require('./wpcom');

const base = (cfg) => {
  const raw = (cfg.wpUrl || '').trim();
  if (!raw) throw new Error('Escribe la dirección de tu web (Conexiones → WordPress)');
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw).origin; } catch { throw new Error('La dirección de la web no es válida'); }
};
const authHeader = (cfg) => 'Basic ' + Buffer.from(`${(cfg.wpUser || '').trim()}:${(cfg.wpAppPassword || '').replace(/\s+/g, '')}`).toString('base64');

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
    throw new Error(`No se puede conectar con ${base(cfg)}: ${e.message}`);
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
  if (!caps.upload_files) throw new AuthError('WordPress: tu usuario no puede subir archivos');
  const site = await req(cfg, '/').catch(() => ({}));
  return { siteName: site.name || base(cfg), userName: me.name, canPublish: !!caps.publish_posts };
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
async function uploadBuffer(cfg, buf, filename, type) {
  ({ buf, type, name: filename } = require('./imgopt').optimize(buf, type, filename)); // fotos más ligeras
  const m = await req(cfg, '/wp/v2/media', {
    method: 'POST', body: buf,
    headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename.replace(/["\r\n]/g, '')}"` },
  });
  return { id: m.id, url: m.source_url };
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
// Añade o quita una categoría de una entrada (sin tocar nada más)
async function changeCategory(cfg, id, name, add = true) {
  const [cid] = await categoryIds(cfg, [name], false);
  if (!cid) throw new Error(`No existe la categoría «${name}»`);
  const p = await req(cfg, `/wp/v2/posts/${id}?context=edit&_fields=categories`);
  const cur = p.categories || [];
  const next = add ? [...new Set([...cur, cid])] : cur.filter((c) => c !== cid);
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

// --- Entradas ----------------------------------------------------------------------
// Recibe los campos en el formato de WordPress.com (nombres separados por comas) y los adapta
async function toRest(cfg, f) {
  const split = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const isPage = f.type === 'page'; // las páginas no tienen categorías ni etiquetas
  return {
    title: f.title, content: f.content, status: f.status, excerpt: f.excerpt || '',
    ...(f.slug ? { slug: f.slug } : {}),
    ...(f.featured_image ? { featured_media: f.featured_image } : {}),
    ...(f.date ? { date_gmt: new Date(f.date).toISOString().slice(0, 19) } : {}),
    ...(isPage ? {} : { categories: await categoryIds(cfg, split(f.categories), !!f.createCategories), tags: await tagIds(cfg, split(f.tags)) }),
  };
}
const fromRest = (p) => ({ ID: p.id, URL: p.link, status: p.status, date: p.date_gmt ? p.date_gmt + 'Z' : p.date });
// Guarda la entrada y comprueba que WordPress se ha quedado con la fecha pedida. En los borradores,
// WordPress puede dejar la fecha «sin fijar» y entonces, al publicarlos desde wp-admin, les pone la de ese
// momento; si la fecha guardada no coincide, se vuelve a enviar (local y UTC) para dejarla fijada.
async function savePost(cfg, route, f) {
  const body = await toRest(cfg, f);
  let p = await req(cfg, route, { method: 'POST', json: body });
  if (body.date_gmt) {
    const want = new Date(body.date_gmt + 'Z').getTime();
    const got = p.date_gmt ? new Date(p.date_gmt + 'Z').getTime() : NaN;
    if (!(Math.abs(got - want) < 60000)) {
      const coll = f.type === 'page' ? 'pages' : 'posts';
      // la hora local de la web se calcula con su diferencia horaria (Ajustes → Generales → Zona horaria)
      const site = await req(cfg, '/').catch(() => ({}));
      const offset = p.date && p.date_gmt ? new Date(p.date + 'Z') - new Date(p.date_gmt + 'Z') : (Number(site.gmt_offset) || 0) * 3600000;
      const local = new Date(want + offset).toISOString().slice(0, 19);
      p = await req(cfg, `/wp/v2/${coll}/${p.id}`, { method: 'POST', json: { date: local, date_gmt: body.date_gmt } });
    }
  }
  return fromRest(p);
}
const createPost = (cfg, f) => savePost(cfg, `/wp/v2/${f.type === 'page' ? 'pages' : 'posts'}`, f);
const updatePost = (cfg, id, f) => savePost(cfg, `/wp/v2/${f.type === 'page' ? 'pages' : 'posts'}/${id}`, f);

async function listPosts(cfg, { type = 'post', status = 'any', search = '', page = 1, number = 20, after, before } = {}) {
  const coll = type === 'page' ? 'pages' : 'posts';
  const q = new URLSearchParams({
    status: status === 'any' ? 'publish,future,draft,pending,private' : status, per_page: String(number), page: String(page),
    orderby: after ? 'date' : 'modified', order: 'desc', context: 'edit', _embed: 'wp:featuredmedia',
    ...(search ? { search } : {}), ...(after ? { after } : {}), ...(before ? { before } : {}),
  });
  const { data, res } = await req(cfg, `/wp/v2/${coll}?${q}`, { raw: true });
  const cats = catCache || (await categories(cfg).catch(() => []));
  return {
    found: Number(res.headers.get('x-wp-total') || data.length),
    items: data.map((p) => ({
      id: p.id, type, status: p.status, date: p.date_gmt ? p.date_gmt + 'Z' : p.date, modified: p.modified_gmt ? p.modified_gmt + 'Z' : p.modified,
      title: p.title?.raw || p.title?.rendered || '(sin título)', url: p.link,
      image: p._embedded?.['wp:featuredmedia']?.[0]?.source_url || '',
      categories: (p.categories || []).map((id) => cats.find((c) => c.id === id)?.name).filter(Boolean),
      excerpt: (p.excerpt?.raw || p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim().slice(0, 160),
    })),
  };
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
  };
}
// Solo el contenido (sin tocar categorías, etiquetas ni nada más)
const updateContent = (cfg, id, content, type) => req(cfg, `/wp/v2/${coll(type)}/${id}`, { method: 'POST', json: { content } });
// Cambia solo los campos indicados (p. ej. { content, title })
const updateFields = (cfg, id, fields, type) => req(cfg, `/wp/v2/${coll(type)}/${id}`, { method: 'POST', json: fields });
// Todas las entradas (o páginas) con contenido en bruto, para buscar y reemplazar texto; ids opcional
async function allRaw(cfg, type, ids) {
  const out = [];
  const q0 = { context: 'edit', per_page: '100', _fields: 'id,title,content,status,link', status: 'publish,future,draft,pending,private' };
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
async function findExisting(cfg, type, slug, title) {
  const coll = type === 'page' ? 'pages' : 'posts';
  const q = new URLSearchParams({ status: 'publish,future,draft,pending,private', context: 'edit', _fields: 'id,title,slug', per_page: '10',
    ...(slug ? { slug } : { search: title }) });
  const found = await req(cfg, `/wp/v2/${coll}?${q}`);
  const hit = found.find((p) => (slug ? p.slug === slug : (p.title?.raw || '').trim().toLowerCase() === String(title).trim().toLowerCase()));
  return hit ? hit.id : null;
}
const uploadNamed = (cfg, buf, name) => uploadBuffer(cfg, buf, name, MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream');

const publicBase = (cfg) => { try { return base(cfg); } catch { return null; } };
const publicUrl = (_cfg, url) => url;

// ---------------------------------------------------------------- Estructura de la web
// Portada, menús (con sus elementos), árbol de páginas y categorías con sus entradas.
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
// ch: { settings, pages:[{id,parent,order,status}], menuDel:[id], menuAdd:[{tmp,menu,title,type,object,objectId,url,parent,order}],
//       menuItems:[{id,parent,order}], posts:[{id,categories,sticky}] }  (los «tmp» son elementos de menú nuevos)
async function saveStructure(cfg, ch, progress = () => {}) {
  const errors = [];
  const run = async (what, fn) => { try { await fn(); progress(what); } catch (e) { errors.push(`${what}: ${e.message}`); } };
  if (ch.settings) await run('Portada', () => req(cfg, '/wp/v2/settings', { method: 'POST', json: { show_on_front: ch.settings.showOnFront, page_on_front: ch.settings.pageOnFront || 0, page_for_posts: ch.settings.pageForPosts || 0 } }));
  for (const p of ch.pages || []) await run(`Página ${p.id}`, () => req(cfg, `/wp/v2/pages/${p.id}`, { method: 'POST', json: { parent: p.parent, menu_order: p.order, status: p.status } }));
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

module.exports = { changeCategory, mediaExists, findMediaByUrl, siteStructure, categoryPosts, saveStructure, findExisting, uploadNamed, postStatuses, login, siteInfo, categories, uploadFile, uploadFromUrls, updateMedia, createPost, updatePost, listPosts, setPostStatus, trashPost, deletePost, getPost, updateContent, updateFields, allRaw, publicBase, publicUrl };
