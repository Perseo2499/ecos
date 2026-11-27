// Servidor MÍNIMO que imita lo que Ecos usa de WordPress (REST + complemento + web pública + editor de un solo uso).
// NO sustituye a un WordPress real: sirve para probar localmente que el guion test-wp/wp.test.js está bien escrito
// (`node test-wp/run.js --sim`). En GitHub las pruebas se hacen contra WordPress de verdad (docker).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ECOS_VERSION = (/^\s*\*\s*Version:\s*([\d.]+)/m.exec(fs.readFileSync(path.join(__dirname, '..', 'wp-plugin', 'ecos', 'ecos.php'), 'utf8')) || [])[1] || '0';
const DESC = '_yoast_wpseo_metadesc';
const SeoMeta = require('../renderer/app/seo-meta');

function start({ user = 'ecostest', pass = 'abcdEFGHijklMNOPqrstUVWX', port = 0 } = {}) {
  let next = 10;
  const posts = new Map(), media = new Map(), blocks = new Map(), tokens = new Set();
  const cats = [{ id: 1, name: 'Sin categoría', slug: 'sin-categoria', count: 0, parent: 0 }];
  let origin = '';
  // menús, widgets y registro de peticiones de escritura (para contar las que hacen falta)
  const menus = new Map(), menuItems = new Map(), widgetsMap = new Map(), reqs = [];
  const locations = { primary: { name: 'primary', description: 'Primary Menu', menu: 0 }, footer: { name: 'footer', description: 'Footer Menu', menu: 0 } };
  const sidebarsMap = new Map([['sidebar-1', { id: 'sidebar-1', name: 'Barra lateral', description: 'Barra lateral principal', widgets: [] }], ['footer-1', { id: 'footer-1', name: 'Pie 1', description: '', widgets: [] }], ['wp_inactive_widgets', { id: 'wp_inactive_widgets', name: 'Widgets inactivos', description: '', widgets: [] }]]);
  posts.set(1, { id: 1, title: '¡Hola, mundo!', content: '<!-- wp:paragraph --><p>Bienvenido</p><!-- /wp:paragraph -->', status: 'publish', excerpt: '', slug: 'hola-mundo', categories: [1], meta: {}, date_gmt: '2026-01-01T00:00:00', modified_gmt: '2026-01-01T00:00:00' });
  const plain = (s) => String(s || '').replace(/<[^>]+>/g, '');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  const renderContent = (c) => String(c || '').replace(/<!-- wp:block \{"ref":(\d+)\} \/-->/g, (_, id) => renderContent(blocks.get(Number(id))?.content || '')).replace(/<!-- \/?wp:[^>]*-->\n?/g, '');
  const pageHtml = (p) => {
    const c = p.content || '';
    const assets = /ecos-/.test(c)
      ? `<link rel="stylesheet" id="ecos-css" href="${origin}/wp-content/plugins/ecos/assets/ecos.css">` +
        ['carousel', 'videos', 'anim'].map((n) => `<script src="${origin}/wp-content/plugins/ecos/assets/ecos-${n}.js" defer></script>`).join('') +
        (/ecos-(?:tabs|cifras|donar|evento|puntos|compare|faq-uno)/.test(c) ? `<script src="${origin}/wp-content/plugins/ecos/assets/ecos-more.js" defer></script>` : '')
      : '';
    const d = p.meta[DESC] ? `<meta name="description" content="${esc(p.meta[DESC])}">` : '';
    const sf = SeoMeta.fromMeta('yoast', p.meta);
    const seo = (sf.canonical ? `<link rel="canonical" href="${esc(sf.canonical)}">` : `<link rel="canonical" href="${origin}/?p=${p.id}">`)
      + `<meta name="robots" content="${sf.noindex ? 'noindex' : 'index'}, ${sf.nofollow ? 'nofollow' : 'follow'}">`
      + `<meta property="og:title" content="${esc(sf.ogTitle || p.title)}">` + (sf.ogDesc ? `<meta property="og:description" content="${esc(sf.ogDesc)}">` : '') + (sf.ogImage ? `<meta property="og:image" content="${esc(sf.ogImage)}">` : '')
      + (sf.twTitle ? `<meta name="twitter:title" content="${esc(sf.twTitle)}">` : '') + (sf.twDesc ? `<meta name="twitter:description" content="${esc(sf.twDesc)}">` : '') + (sf.twImage ? `<meta name="twitter:image" content="${esc(sf.twImage)}">` : '') + '<meta name="twitter:card" content="summary_large_image">';
    return `<!doctype html><html><head><title>${esc(p.title)} - Sim</title>${d}${seo}${assets}</head><body class="ast-theme"><main>${renderContent(c)}${/wp:uagb/.test(c) ? "<div class=\"uagb-image-gallery\"></div>" : ""}</main></body></html>`;
  };
  const menuHtml = (id) => {
    const its = [...menuItems.values()].filter((i) => i.menu === id).sort((a, b) => a.menu_order - b.menu_order);
    const ul = (pid) => { const k = its.filter((i) => i.parent === pid); return k.length ? `<ul class="${pid ? 'sub-menu' : 'main-header-menu'}">${k.map((i) => `<li class="menu-item"><a href="${esc(i.url || '#')}">${esc(i.title)}</a>${ul(i.id)}</li>`).join('')}</ul>` : ''; };
    return ul(0);
  };
  const homeHtml = () => {
    const prim = locations.primary.menu;
    const side = (id) => (sidebarsMap.get(id)?.widgets || []).map((w) => `<section id="${w}" class="widget widget_${widgetsMap.get(w)?.id_base}">${renderContent(widgetsMap.get(w)?.instance?.raw?.content || widgetsMap.get(w)?.instance?.raw?.text || '')}</section>`).join('');
    return `<!doctype html><html><head><title>Sim</title></head><body class="ast-theme"><header><nav class="main-navigation" id="site-navigation">${prim ? menuHtml(prim) : ''}</nav></header><main>Inicio</main><aside id="secondary" class="widget-area">${side('sidebar-1')}</aside><footer>${locations.footer.menu ? menuHtml(locations.footer.menu) : ''}${side('footer-1')}</footer></body></html>`;
  };
  const postObj = (p) => ({
    id: p.id, link: `${origin}/?p=${p.id}`, status: p.status, date_gmt: p.date_gmt, modified_gmt: p.modified_gmt, slug: p.slug, type: 'post', parent: 0,
    title: { raw: p.title, rendered: esc(p.title) }, content: { raw: p.content, rendered: renderContent(p.content) }, excerpt: { raw: p.excerpt, rendered: esc(p.excerpt) },
    featured_media: p.featured_media || 0, categories: p.categories, tags: [], meta: { [DESC]: p.meta[DESC] || '' },
    yoast_head_json: { title: p.title + ' - Sim', description: p.meta[DESC] || '' },
    _embedded: { 'wp:term': [p.categories.map((id) => ({ ...cats.find((c) => c.id === id), taxonomy: 'category' }))] },
  });
  const mediaObj = (m) => ({ id: m.id, date: m.date, source_url: m.url, mime_type: m.mime, media_type: 'image', alt_text: m.alt, title: { rendered: m.file }, media_details: { width: 96, height: 64, sizes: {} }, post: 0 });
  const blockObj = (b) => ({ id: b.id, status: 'publish', title: { raw: b.title, rendered: b.title }, content: { raw: b.content, rendered: renderContent(b.content), protected: false }, meta: { wp_pattern_sync_status: b.sync } }); // como WordPress 6.3+: es un campo meta

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, origin || 'http://localhost');
      const send = (code, data, headers = {}) => { const s = typeof data === 'string' ? data : JSON.stringify(data); res.writeHead(code, { 'Content-Type': typeof data === 'string' ? 'text/html; charset=utf-8' : 'application/json', ...headers }); res.end(s); };
      const err = (code, c, message) => send(code, { code: c, message, data: { status: code } });
      let json = {};
      if (body.length && /json/.test(req.headers['content-type'] || '')) { try { json = JSON.parse(body.toString()); } catch { /* vacío */ } }
      const q = url.searchParams;

      // --- web pública y editor de un solo uso ---
      if (!url.pathname.startsWith('/wp-json')) {
        if (url.pathname === '/' && !q.get('p')) return send(200, homeHtml());
        if (url.pathname === '/' && q.get('p')) { const p = posts.get(Number(q.get('p'))); return p ? send(200, pageHtml(p)) : send(404, 'No encontrado'); }
        if (url.pathname === '/wp-admin/admin-post.php' && q.get('action') === 'ecos_editor') {
          const t = q.get('t') || '', ok = tokens.has(t);
          tokens.delete(t);
          if (!ok) return send(403, 'Este enlace del editor ya se usó o ha caducado.');
          return send(302, '', { Location: `${origin}/wp-admin/post.php?post=${tokens.target || 0}&action=edit`, 'Set-Cookie': ['wordpress_logged_in_abc=1; path=/', 'wordpress_sec_abc=1; path=/wp-admin'] });
        }
        if (url.pathname === '/wp-admin/post.php') return /wordpress_logged_in_/.test(req.headers.cookie || '') ? send(200, '<body class="post-php">editor</body>') : send(302, '', { Location: '/wp-login.php' });
        return send(404, 'No encontrado');
      }

      const route = url.pathname.replace(/^\/wp-json/, '') || '/';
      if (route === '/' && !req.headers.authorization) return send(200, { name: 'Sim WP', home: origin, namespaces: ['wp/v2', 'ecos/v1', 'yoast/v1'] });
      const auth = req.headers.authorization || '';
      if (auth !== 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')) return err(401, 'rest_not_logged_in', 'No has iniciado sesión.');

      const m = (re) => re.exec(route);
      let r;
      if (route === '/') return send(200, { name: 'Sim WP', home: origin, namespaces: ['wp/v2', 'ecos/v1', 'yoast/v1'] });
      if (route === '/wp/v2/users/me') return send(200, { id: 1, name: 'Admin', slug: 'admin', roles: ['administrator'], capabilities: { edit_posts: true, publish_posts: true, upload_files: true }, avatar_urls: {} });
      if (route === '/wp/v2/plugins') return send(200, [{ plugin: 'ultimate-addons-for-gutenberg/ultimate-addons-for-gutenberg', status: 'active' }]);
      if (route === '/wp/v2/settings') return send(200, { title: 'Sim WP', show_on_front: 'posts', page_on_front: 0, page_for_posts: 0 });
      if (route === '/wp/v2/pages' || route === '/wp/v2/tags') return send(200, [], { 'X-WP-TotalPages': '1', 'X-WP-Total': '0' });
      if (route === '/wp/v2/navigation') return send(200, [], { 'X-WP-TotalPages': '1' });
      if (req.method !== 'GET') reqs.push(req.method + ' ' + route);
      const menuObj = (mm) => ({ id: mm.id, name: mm.name, slug: mm.slug, locations: Object.keys(locations).filter((l) => locations[l].menu === mm.id) });
      if (route === '/wp/v2/menu-locations') return send(200, locations);
      if (route === '/wp/v2/menus') {
        if (req.method === 'POST') { const mm = { id: next++, name: json.name, slug: String(json.name).toLowerCase().replace(/\W+/g, '-') }; menus.set(mm.id, mm); return send(201, menuObj(mm)); }
        return send(200, [...menus.values()].map(menuObj), { 'X-WP-TotalPages': '1' });
      }
      if ((r = m(/^\/wp\/v2\/menus\/(\d+)$/))) {
        const mm = menus.get(+r[1]);
        if (!mm) return err(404, 'rest_term_invalid', 'No existe');
        if (req.method === 'DELETE') { menus.delete(mm.id); for (const l of Object.values(locations)) if (l.menu === mm.id) l.menu = 0; for (const [k, i] of menuItems) if (i.menu === mm.id) menuItems.delete(k); return send(200, { deleted: true }); }
        if (req.method === 'POST' && Array.isArray(json.locations)) { for (const l of Object.values(locations)) if (l.menu === mm.id) l.menu = 0; for (const l of json.locations) if (locations[l]) locations[l].menu = mm.id; }
        return send(200, menuObj(mm));
      }
      const itemObj = (i) => ({ id: i.id, title: { raw: i.title, rendered: esc(i.title) }, url: i.url, menu_order: i.menu_order, parent: i.parent, type: i.type, object: i.object, object_id: i.object_id, menus: i.menu, status: 'publish' });
      if (route === '/wp/v2/menu-items') {
        if (req.method === 'POST') {
          if (!menus.has(+json.menus)) return err(400, 'rest_invalid_param', 'Parámetro no válido: menus');
          const i = { id: next++, title: json.title || '', url: json.url || (json.object_id ? `${origin}/?p=${json.object_id}` : ''), menu_order: json.menu_order || 1, parent: json.parent || 0, type: json.type, object: json.object, object_id: json.object_id || 0, menu: +json.menus };
          menuItems.set(i.id, i); return send(201, itemObj(i));
        }
        const only = q.get('menus'); const l = [...menuItems.values()].filter((i) => !only || i.menu === +only);
        return send(200, l.map(itemObj), { 'X-WP-TotalPages': '1' });
      }
      if ((r = m(/^\/wp\/v2\/menu-items\/(\d+)$/))) {
        const i = menuItems.get(+r[1]);
        if (!i) return err(404, 'rest_post_invalid_id', 'ID no válido.');
        if (req.method === 'DELETE') { menuItems.delete(i.id); return send(200, { deleted: true }); }
        if (req.method === 'POST') { if (json.parent !== undefined) i.parent = json.parent; if (json.menu_order !== undefined) i.menu_order = json.menu_order; if (json.title !== undefined) i.title = json.title; if (json.url !== undefined) i.url = json.url; }
        return send(200, itemObj(i));
      }
      // widgets y zonas
      const widObj = (w) => ({ id: w.id, id_base: w.id_base, sidebar: w.sidebar, name: w.id_base, rendered: '', instance: { encoded: '', hash: '', raw: w.instance.raw } });
      const sideObj = (z) => ({ id: z.id, name: z.name, description: z.description, status: z.id === 'wp_inactive_widgets' ? 'inactive' : 'active', widgets: z.widgets });
      if (route === '/wp/v2/sidebars') return send(200, [...sidebarsMap.values()].map(sideObj));
      if ((r = m(/^\/wp\/v2\/sidebars\/([\w-]+)$/))) {
        const z = sidebarsMap.get(r[1]); if (!z) return err(404, 'rest_sidebar_not_found', 'No existe');
        if (req.method === 'POST' && Array.isArray(json.widgets)) {
          for (const o of sidebarsMap.values()) { if (o !== z) o.widgets = o.widgets.filter((id) => !json.widgets.includes(id)); }
          for (const id of z.widgets) if (!json.widgets.includes(id)) sidebarsMap.get('wp_inactive_widgets').widgets.push(id);
          z.widgets = json.widgets.slice(); for (const id of z.widgets) if (widgetsMap.has(id)) widgetsMap.get(id).sidebar = z.id;
        }
        return send(200, sideObj(z));
      }
      if (route === '/wp/v2/widgets') {
        if (req.method === 'POST') {
          const n = next++, w = { id: `${json.id_base}-${n}`, id_base: json.id_base, sidebar: json.sidebar || 'wp_inactive_widgets', instance: { raw: json.instance?.raw || {} } };
          widgetsMap.set(w.id, w); sidebarsMap.get(w.sidebar)?.widgets.push(w.id); return send(201, widObj(w));
        }
        return send(200, [...widgetsMap.values()].map(widObj), { 'X-WP-TotalPages': '1' });
      }
      if ((r = m(/^\/wp\/v2\/widgets\/([\w-]+)$/))) {
        const w = widgetsMap.get(r[1]); if (!w) return err(404, 'rest_widget_not_found', 'No existe');
        if (req.method === 'DELETE') { widgetsMap.delete(w.id); for (const z of sidebarsMap.values()) z.widgets = z.widgets.filter((id) => id !== w.id); return send(200, { deleted: true }); }
        if (req.method === 'POST' && json.instance?.raw) w.instance.raw = json.instance.raw;
        return send(200, widObj(w));
      }
      if (route === '/wp/v2/search') return send(200, []);
      // SEO completo (complemento 1.8.0): solo Yoast en el simulador
      if ((r = m(/^\/ecos\/v1\/seo\/(\d+)$/))) {
        const p = posts.get(+r[1]); if (!p) return err(404, 'rest_post_invalid_id', 'ID no válido.');
        if (req.method === 'POST') { const meta = SeoMeta.toMeta('yoast', json.fields || {}, { premium: false }); p.meta = { ...p.meta, ...meta }; }
        return send(200, { plugin: 'yoast', premium: false, version: ECOS_VERSION, writable: true, fields: SeoMeta.fromMeta('yoast', p.meta) });
      }
      if (/^\/wp\/v2\/block-patterns\//.test(route)) return send(200, []);

      if (route === '/wp/v2/categories') {
        if (req.method === 'POST') { const c = { id: next++, name: json.name, slug: String(json.name).toLowerCase().replace(/\W+/g, '-'), count: 0, parent: 0 }; cats.push(c); return send(201, c); }
        return send(200, cats, { 'X-WP-TotalPages': '1' });
      }
      if ((r = m(/^\/wp\/v2\/categories\/(\d+)$/)) && req.method === 'DELETE') { const i = cats.findIndex((c) => c.id === +r[1]); if (i < 0) return err(404, 'rest_term_invalid', 'No existe'); cats.splice(i, 1); return send(200, { deleted: true }); }

      if (route === '/wp/v2/posts' && req.method === 'GET') {
        let l = [...posts.values()]; const s = q.get('search'); if (s) l = l.filter((p) => (p.title + p.content).includes(s));
        const per = +(q.get('per_page') || 10), page = +(q.get('page') || 1);
        return send(200, l.slice((page - 1) * per, page * per).map(postObj), { 'X-WP-Total': String(l.length), 'X-WP-TotalPages': String(Math.max(1, Math.ceil(l.length / per))) });
      }
      const save = (p) => {
        for (const k of ['title', 'content', 'status', 'excerpt', 'slug', 'featured_media', 'categories', 'date_gmt']) if (json[k] !== undefined) p[k] = json[k];
        if (json.meta) p.meta = { ...p.meta, ...json.meta };
        p.modified_gmt = new Date().toISOString().slice(0, 19);
        return p;
      };
      if (route === '/wp/v2/posts' && req.method === 'POST') {
        const id = next++, now = new Date().toISOString().slice(0, 19);
        const p = save({ id, title: '', content: '', status: 'draft', excerpt: '', slug: 'p' + id, categories: [1], meta: {}, date_gmt: now });
        posts.set(id, p); return send(201, postObj(p));
      }
      if ((r = m(/^\/wp\/v2\/posts\/(\d+)$/))) {
        const p = posts.get(+r[1]);
        if (!p) return err(404, 'rest_post_invalid_id', 'ID de entrada no válido.');
        if (req.method === 'DELETE') { posts.delete(p.id); return send(200, { deleted: true, previous: postObj(p) }); }
        if (req.method === 'POST') save(p);
        return send(200, postObj(p));
      }

      if (route === '/wp/v2/media' && req.method === 'POST') {
        const file = /filename="([^"]+)"/.exec(req.headers['content-disposition'] || '')?.[1] || 'x.png';
        const id = next++, mm = { id, file, mime: req.headers['content-type'], alt: '', date: new Date().toISOString().slice(0, 19), url: `${origin}/wp-content/uploads/${file}` };
        media.set(id, mm); return send(201, mediaObj(mm));
      }
      if (route === '/wp/v2/media') { const s = q.get('search') || ''; const l = [...media.values()].filter((x) => x.file.includes(s)); return send(200, l.map(mediaObj), { 'X-WP-Total': String(l.length), 'X-WP-TotalPages': '1' }); }
      if ((r = m(/^\/wp\/v2\/media\/(\d+)$/))) {
        const mm = media.get(+r[1]);
        if (!mm) return err(404, 'rest_post_invalid_id', 'ID no válido.');
        if (req.method === 'DELETE') { media.delete(mm.id); return send(200, { deleted: true }); }
        if (req.method === 'POST' && json.alt_text !== undefined) mm.alt = json.alt_text;
        return send(200, mediaObj(mm));
      }

      if (route === '/wp/v2/blocks' && req.method === 'GET') return send(200, [...blocks.values()].map(blockObj), { 'X-WP-TotalPages': '1' });
      if (route === '/wp/v2/blocks' && req.method === 'POST') { const b = { id: next++, title: json.title, content: json.content, sync: json.meta?.wp_pattern_sync_status || '' }; blocks.set(b.id, b); return send(201, blockObj(b)); }
      if ((r = m(/^\/wp\/v2\/blocks\/(\d+)$/))) {
        const b = blocks.get(+r[1]);
        if (!b) return err(404, 'rest_post_invalid_id', 'ID no válido.');
        if (req.method === 'DELETE') { blocks.delete(b.id); return send(200, { deleted: true }); }
        if (req.method === 'POST') { if (json.title !== undefined) b.title = json.title; if (json.content !== undefined) b.content = json.content; }
        return send(200, blockObj(b));
      }

      // --- complemento de Ecos ---
      if (route === '/ecos/v1/status') return send(200, { plugin: 'ecos', version: ECOS_VERSION, caches: [], seo: 'Yoast SEO', stats: true, lock: true, export: true, theme: true, render: true, editor: true, astra: true });
      if (route === '/ecos/v1/theme') return send(200, { plugin: 'ecos', version: ECOS_VERSION, theme: { name: 'Astra', stylesheet: 'astra', template: 'astra', isAstra: true, isBlock: false }, settings: { color: { palette: { theme: [{ slug: 'ast-global-color-0', name: 'Color 1', color: '#046bd2' }] } } }, astra: {} });
      if (route === '/ecos/v1/export') return send(200, { plugin: 'ecos', version: ECOS_VERSION });
      if (route === '/ecos/v1/lock') return send(200, req.method === 'DELETE' ? { released: true } : { locked: false, user: null });
      if (route === '/ecos/v1/render') return send(200, { plugin: 'ecos', version: ECOS_VERSION, html: `<html><body><h1>${esc(json.title)}</h1>${renderContent(json.content)}</body></html>` });
      if (route === '/ecos/v1/editor-session') {
        const mt = /^post\.php\?post=(\d+)&action=edit$/.exec(json.target || '');
        if (!mt) return err(400, 'ecos_bad_target', 'Solo se puede abrir el editor de entradas o páginas de esta web.');
        const t = crypto.randomBytes(32).toString('hex'); tokens.add(t); tokens.target = mt[1];
        return send(200, { plugin: 'ecos', url: `${origin}/wp-admin/admin-post.php?action=ecos_editor&t=${t}`, expires: 60 });
      }
      return err(404, 'rest_no_route', 'No se encontró ninguna ruta que coincida con la URL y el método de la solicitud.');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    resolve({ url: origin, user, pass, close: () => new Promise((r) => server.close(r)), state: { posts, media, blocks, cats, menus, menuItems, locations, widgets: widgetsMap, sidebars: sidebarsMap, reqs } });
  }));
}

module.exports = { start };

if (require.main === module) start({ port: Number(process.env.PORT) || 8089 }).then((s) => console.log(`Simulador en ${s.url} (usuario ${s.user}, contraseña ${s.pass})`));
