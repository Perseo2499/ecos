// Menús (/wp/v2/menus, menu-items, menu-locations), menús de bloques (/wp/v2/navigation) y widgets (/wp/v2/sidebars, widgets)
// de WordPress propio. Necesitan permiso «edit_theme_options» (administrador). La lógica de qué cambiar está en
// renderer/menutree.js y renderer/widgetlogic.js; aquí solo se habla con la API.
const { request: req } = require('./wpself');

const raw = (x) => String(x?.raw ?? x?.rendered ?? x ?? '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
async function all(cfg, route) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const d = await req(cfg, `${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...d);
    if (d.length < 100) break;
  }
  return out;
}
const none = (e) => (/rest_no_route|no tiene activada|404/.test(String(e.message)) ? 'none' : String(e.message));

const itemOf = (i) => ({ id: i.id, title: raw(i.title), parent: Number(i.parent) || 0, order: Number(i.menu_order) || 0, type: i.type, object: i.object, objectId: Number(i.object_id) || 0, url: i.url || '' });

// Todo lo que necesita la pantalla de menús: menús con elementos, ubicaciones, páginas y categorías para añadir, menús de bloques
async function loadMenus(cfg) {
  const out = { menus: [], locations: [], navigation: [], pages: [], categories: [], blockTheme: false, note: '' };
  let locs = {};
  try {
    const ms = await req(cfg, '/wp/v2/menus?context=edit&per_page=100');
    locs = await req(cfg, '/wp/v2/menu-locations').catch(() => ({}));
    for (const m of ms) {
      const items = await all(cfg, `/wp/v2/menu-items?menus=${m.id}&context=edit`);
      out.menus.push({ id: m.id, name: raw(m.name), slug: m.slug, locations: (m.locations || []).slice(), items: items.map(itemOf) });
    }
  } catch (e) { out.note = none(e); }
  out.locations = Object.entries(locs || {}).map(([slug, l]) => ({ slug, name: l.description || l.name || slug, menu: Number(l.menu) || 0 }));
  out.blockTheme = !out.locations.length;
  try { out.navigation = (await all(cfg, '/wp/v2/navigation?context=edit&status=publish,draft')).map((n) => ({ id: n.id, title: raw(n.title) || 'Navegación', content: n.content?.raw ?? '' })); } catch { /* sin menús de bloques */ }
  try {
    out.pages = (await all(cfg, '/wp/v2/pages?context=edit&_fields=id,title,link,status&status=publish')).map((p) => ({ id: p.id, title: raw(p.title) || '(sin título)', url: p.link }));
    out.categories = (await all(cfg, '/wp/v2/categories?_fields=id,name,link')).map((c) => ({ id: c.id, name: raw(c.name), url: c.link }));
  } catch { /* se podrán añadir enlaces personalizados */ }
  return out;
}
// Buscar entradas (o páginas) por título para añadirlas a un menú
async function searchContent(cfg, q) {
  const r = await req(cfg, `/wp/v2/search?search=${encodeURIComponent(String(q || '').slice(0, 80))}&per_page=12&type=post`);
  return (Array.isArray(r) ? r : []).map((x) => ({ id: x.id, title: raw(x.title), url: x.url, subtype: x.subtype }));
}

// d = { del:[id], add:[{tmp,title,type,object,objectId,url,parent,order}], upd:[{id,parent?,order?,title?,url?}] } (menutree.diff)
async function saveMenu(cfg, menuId, d) {
  const errors = [], ids = new Map();
  const run = async (what, fn) => { try { await fn(); } catch (e) { errors.push(`${what}: ${e.message}`); } };
  const real = (x) => (typeof x === 'string' && ids.has(x) ? ids.get(x) : x);
  let calls = 0;
  for (const id of d.del || []) await run(`Quitar ${id}`, async () => { calls++; await req(cfg, `/wp/v2/menu-items/${id}?force=true`, { method: 'DELETE' }); });
  for (const a of d.add || []) {
    await run(`Añadir «${a.title}»`, async () => {
      calls++;
      const r = await req(cfg, '/wp/v2/menu-items', { method: 'POST', json: {
        title: a.title, type: a.type, object: a.object, ...(a.objectId ? { object_id: a.objectId } : {}), ...(a.type === 'custom' ? { url: a.url } : {}),
        menus: menuId, parent: Number(real(a.parent)) || 0, menu_order: a.order, status: 'publish' } });
      ids.set(a.tmp, r.id);
    });
  }
  for (const u of d.upd || []) {
    const body = {};
    if (u.parent !== undefined) body.parent = Number(real(u.parent)) || 0;
    if (u.order !== undefined) body.menu_order = u.order;
    if (u.title !== undefined) body.title = u.title;
    if (u.url !== undefined) body.url = u.url;
    await run(`Elemento ${u.id}`, async () => { calls++; await req(cfg, `/wp/v2/menu-items/${u.id}`, { method: 'POST', json: body }); });
  }
  return { errors, calls, ids: Object.fromEntries(ids) };
}
async function createMenu(cfg, name) {
  const m = await req(cfg, '/wp/v2/menus', { method: 'POST', json: { name: String(name || '').trim() || 'Menú' } });
  return { id: m.id, name: raw(m.name), slug: m.slug, locations: [], items: [] };
}
const deleteMenu = (cfg, id) => req(cfg, `/wp/v2/menus/${id}?force=true`, { method: 'DELETE' }).then(() => true);
async function setLocations(cfg, list) {
  const errors = [];
  for (const m of list || []) {
    try { await req(cfg, `/wp/v2/menus/${m.id}`, { method: 'POST', json: { locations: m.locations } }); } catch (e) { errors.push(`Ubicación del menú ${m.id}: ${e.message}`); }
  }
  return { errors };
}
// Menú de bloques: id (existente) o title (nuevo) + content (bloques ya serializados)
async function saveNavigation(cfg, { id, title, content }) {
  const r = await req(cfg, id ? `/wp/v2/navigation/${Number(id)}` : '/wp/v2/navigation', { method: 'POST', json: { content, ...(id ? {} : { title: title || 'Navegación', status: 'publish' }) } });
  return { id: r.id };
}

// ---------------------------------------------------------------- widgets
async function loadWidgets(cfg) {
  const out = { sidebars: [], widgets: [], note: '' };
  try {
    out.sidebars = await req(cfg, '/wp/v2/sidebars?context=edit&per_page=100');
    out.widgets = await all(cfg, '/wp/v2/widgets?context=edit');
  } catch (e) { out.note = none(e); }
  return out;
}
// d = { del:[id], add:[{tmp,idBase,sidebar,raw}], upd:[{id,raw}], order:[{sidebar,widgets:[id|tmp]}] } (widgetlogic.diff)
async function saveWidgets(cfg, d) {
  const errors = [], ids = new Map();
  const run = async (what, fn) => { try { await fn(); } catch (e) { errors.push(`${what}: ${e.message}`); } };
  const real = (x) => ids.get(String(x)) || String(x);
  let calls = 0;
  for (const id of d.del || []) await run(`Quitar ${id}`, async () => { calls++; await req(cfg, `/wp/v2/widgets/${id}?force=true`, { method: 'DELETE' }); });
  for (const a of d.add || []) await run('Nuevo widget', async () => { calls++; const r = await req(cfg, '/wp/v2/widgets', { method: 'POST', json: { id_base: a.idBase, sidebar: a.sidebar, instance: { raw: a.raw } } }); ids.set(a.tmp, r.id); });
  // WordPress a veces deja un widget recién creado en «inactivos»: se comprueba dónde ha quedado y se coloca donde se pidió
  const placed = {};
  for (const a of d.add || []) if (ids.has(a.tmp)) (placed[a.sidebar] = placed[a.sidebar] || []).push(ids.get(a.tmp));
  for (const [zone, news] of Object.entries(placed)) {
    await run(`Zona ${zone}`, async () => {
      calls++;
      const z = await req(cfg, `/wp/v2/sidebars/${zone}?context=edit`);
      const have = (z.widgets || []).map((x) => String(typeof x === 'object' ? x.id : x));
      const missing = news.filter((id) => !have.includes(id));
      if (missing.length) { calls++; await req(cfg, `/wp/v2/sidebars/${zone}`, { method: 'POST', json: { widgets: [...have, ...missing] } }); }
    });
  }
  for (const u of d.upd || []) await run(`Widget ${u.id}`, async () => { calls++; await req(cfg, `/wp/v2/widgets/${u.id}`, { method: 'POST', json: { instance: { raw: u.raw } } }); });
  for (const o of d.order || []) await run(`Zona ${o.sidebar}`, async () => { calls++; await req(cfg, `/wp/v2/sidebars/${o.sidebar}`, { method: 'POST', json: { widgets: o.widgets.map(real) } }); });
  return { errors, calls, ids: Object.fromEntries(ids) };
}

module.exports = { loadMenus, searchContent, saveMenu, createMenu, deleteMenu, setLocations, saveNavigation, loadWidgets, saveWidgets };
