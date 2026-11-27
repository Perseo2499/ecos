// Servidor MÍNIMO que imita lo que Ecos usa de WordPress (REST + complemento + web pública + editor de un solo uso).
// NO sustituye a un WordPress real: sirve para probar localmente que el guion test-wp/wp.test.js está bien escrito
// (`node test-wp/run.js --sim`). En GitHub las pruebas se hacen contra WordPress de verdad (docker).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ECOS_VERSION = (/^\s*\*\s*Version:\s*([\d.]+)/m.exec(fs.readFileSync(path.join(__dirname, '..', 'wp-plugin', 'ecos', 'ecos.php'), 'utf8')) || [])[1] || '0';
const DESC = '_yoast_wpseo_metadesc';

function start({ user = 'ecostest', pass = 'abcdEFGHijklMNOPqrstUVWX', port = 0 } = {}) {
  let next = 10;
  const posts = new Map(), media = new Map(), blocks = new Map(), tokens = new Set();
  const eventos = new Map(); // tipo propio «evento» (mu-plugin de las pruebas reales): ACF (lugar, fecha, gratis), meta aforo_max y Polylang (es, en)
  const LANGS = [{ code: 'es', name: 'Español', locale: 'es_ES', flag: '', default: true }, { code: 'en', name: 'English', locale: 'en_US', flag: '', default: false }];
  const eventoTerms = [{ id: 31, name: 'Música' }];
  const cats = [{ id: 1, name: 'Sin categoría', slug: 'sin-categoria', count: 0, parent: 0 }];
  let origin = '';
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
    return `<!doctype html><html><head><title>${esc(p.title)} - Sim</title>${d}${assets}</head><body class="ast-theme"><main>${renderContent(c)}${/wp:uagb/.test(c) ? "<div class=\"uagb-image-gallery\"></div>" : ""}</main></body></html>`;
  };
  const postObj = (p) => ({
    id: p.id, link: `${origin}/?p=${p.id}`, status: p.status, date_gmt: p.date_gmt, modified_gmt: p.modified_gmt, slug: p.slug, type: 'post', parent: 0,
    title: { raw: p.title, rendered: esc(p.title) }, content: { raw: p.content, rendered: renderContent(p.content) }, excerpt: { raw: p.excerpt, rendered: esc(p.excerpt) },
    featured_media: p.featured_media || 0, categories: p.categories, tags: [], lang: p.lang || 'es', translations: p.translations || {}, meta: { [DESC]: p.meta[DESC] || '' },
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
      if (route === '/' && !req.headers.authorization) return send(200, { name: 'Sim WP', home: origin, namespaces: ['wp/v2', 'ecos/v1', 'yoast/v1', 'pll/v1'] });
      const auth = req.headers.authorization || '';
      if (auth !== 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')) return err(401, 'rest_not_logged_in', 'No has iniciado sesión.');

      const m = (re) => re.exec(route);
      let r;
      if (route === '/') return send(200, { name: 'Sim WP', home: origin, namespaces: ['wp/v2', 'ecos/v1', 'yoast/v1', 'pll/v1'] });
      if (route === '/wp/v2/users/me') return send(200, { id: 1, name: 'Admin', slug: 'admin', roles: ['administrator'], capabilities: { edit_posts: true, publish_posts: true, upload_files: true }, avatar_urls: {} });
      if (route === '/wp/v2/plugins') return send(200, [{ plugin: 'ultimate-addons-for-gutenberg/ultimate-addons-for-gutenberg', status: 'active' }]);
      if (route === '/wp/v2/settings') return send(200, { title: 'Sim WP', show_on_front: 'posts', page_on_front: 0, page_for_posts: 0 });
      if (route === '/wp/v2/pages' || route === '/wp/v2/tags') return send(200, [], { 'X-WP-TotalPages': '1', 'X-WP-Total': '0' });
      if (/^\/wp\/v2\/(menus|navigation|menu-locations)/.test(route)) return err(404, 'rest_no_route', 'No route');
      if (/^\/wp\/v2\/block-patterns\//.test(route)) return send(200, []);

      if (route === '/wp/v2/categories') {
        if (req.method === 'POST') { const c = { id: next++, name: json.name, slug: String(json.name).toLowerCase().replace(/\W+/g, '-'), count: 0, parent: 0 }; cats.push(c); return send(201, c); }
        return send(200, cats, { 'X-WP-TotalPages': '1' });
      }
      if ((r = m(/^\/wp\/v2\/categories\/(\d+)$/)) && req.method === 'DELETE') { const i = cats.findIndex((c) => c.id === +r[1]); if (i < 0) return err(404, 'rest_term_invalid', 'No existe'); cats.splice(i, 1); return send(200, { deleted: true }); }

      if (route === '/wp/v2/posts' && req.method === 'GET') {
        let l = [...posts.values()]; const s = q.get('search'); if (s) l = l.filter((p) => (p.title + p.content).includes(s)); const lg = q.get('lang'); if (lg) l = l.filter((p) => (p.lang || 'es') === lg);
        const per = +(q.get('per_page') || 10), page = +(q.get('page') || 1);
        return send(200, l.slice((page - 1) * per, page * per).map(postObj), { 'X-WP-Total': String(l.length), 'X-WP-TotalPages': String(Math.max(1, Math.ceil(l.length / per))) });
      }
      const save = (p) => {
        for (const k of ['title', 'content', 'status', 'excerpt', 'slug', 'featured_media', 'categories', 'date_gmt', 'lang']) if (json[k] !== undefined) p[k] = json[k];
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


      // --- tipo de contenido propio «evento», campos de ACF y idiomas (Polylang) ---
      if (route === '/wp/v2/types') return send(200, {
        post: { slug: 'post', name: 'Entradas', rest_base: 'posts', supports: { editor: true } }, page: { slug: 'page', name: 'Páginas', rest_base: 'pages', supports: { editor: true } },
        attachment: { slug: 'attachment', name: 'Medios', rest_base: 'media' }, wp_block: { slug: 'wp_block', name: 'Patrones', rest_base: 'blocks' },
        evento: { slug: 'evento', name: 'Eventos', rest_base: 'eventos', labels: { singular_name: 'Evento' }, supports: { title: true, editor: true, excerpt: true }, taxonomies: ['tema'] },
      });
      if (route === '/wp/v2/taxonomies') return send(200, q.get('type') === 'evento' ? { tema: { slug: 'tema', name: 'Temas', rest_base: 'temas', hierarchical: true } } : { category: { slug: 'category', name: 'Categorías', rest_base: 'categories', hierarchical: true } });
      if (route === '/wp/v2/temas') {
        if (req.method === 'POST') { const c = { id: next++, name: json.name }; eventoTerms.push(c); return send(201, c); }
        const sr = (q.get('search') || '').toLowerCase();
        return send(200, eventoTerms.filter((c) => c.name.toLowerCase().includes(sr)), { 'X-WP-TotalPages': '1' });
      }
      const eventoObj = (e) => ({
        id: e.id, link: `${origin}/?p=${e.id}`, status: e.status, date_gmt: e.date_gmt, modified_gmt: e.modified_gmt, slug: e.slug, type: 'evento',
        title: { raw: e.title, rendered: esc(e.title) }, content: { raw: e.content, rendered: renderContent(e.content) }, excerpt: { raw: e.excerpt, rendered: esc(e.excerpt) },
        featured_media: 0, temas: e.temas, meta: { aforo_max: e.aforo_max }, acf: e.acf, lang: e.lang, translations: e.translations,
        _embedded: { 'wp:term': [e.temas.map((id) => ({ ...eventoTerms.find((c) => c.id === id), taxonomy: 'tema' }))] },
      });
      const saveEvento = (e) => {
        for (const k of ['title', 'content', 'status', 'excerpt', 'slug', 'temas', 'date_gmt', 'lang']) if (json[k] !== undefined) e[k] = json[k];
        if (json.meta && json.meta.aforo_max !== undefined) e.aforo_max = json.meta.aforo_max;
        if (json.acf) e.acf = { ...e.acf, ...json.acf };
        e.modified_gmt = new Date().toISOString().slice(0, 19);
        return e;
      };
      if (route === '/wp/v2/eventos' && req.method === 'GET') {
        let l = [...eventos.values()]; const lg = q.get('lang'); if (lg) l = l.filter((e) => e.lang === lg);
        return send(200, l.map(eventoObj), { 'X-WP-Total': String(l.length), 'X-WP-TotalPages': '1' });
      }
      if (route === '/wp/v2/eventos' && req.method === 'POST') {
        const id = next++, e = saveEvento({ id, title: '', content: '', status: 'draft', excerpt: '', slug: 'e' + id, temas: [], aforo_max: 0, acf: { lugar: '', fecha: '', gratis: false }, lang: 'es', translations: {}, date_gmt: new Date().toISOString().slice(0, 19) });
        eventos.set(id, e); return send(201, eventoObj(e));
      }
      if ((r = m(/^\/wp\/v2\/eventos\/(\d+)$/))) {
        const e = eventos.get(+r[1]);
        if (!e) return err(404, 'rest_post_invalid_id', 'ID de entrada no válido.');
        if (req.method === 'DELETE') { eventos.delete(e.id); return send(200, { deleted: true, previous: eventoObj(e) }); }
        if (req.method === 'POST') saveEvento(e);
        return send(200, eventoObj(e));
      }
      const anyPost = (id) => eventos.get(id) || posts.get(id);
      const langOf = (id) => anyPost(id)?.lang || 'es';
      const transOf = (id) => { const e = anyPost(id); return e?.translations || {}; };
      const link = (id, lang, orig) => {
        const e = anyPost(id), o = anyPost(orig); if (!e) return;
        e.lang = lang;
        if (o) { const tr = { ...(o.translations || {}), [o.lang || 'es']: orig, [lang]: id }; for (const x of Object.values(tr)) { const y = anyPost(x); if (y) y.translations = tr; } }
      };
      if (route === '/ecos/v1/lang') {
        if (req.method === 'POST') { if (!anyPost(json.post)) return err(404, 'rest_post_invalid_id', 'ID no válido.'); link(json.post, json.lang, json.translation_of); return send(200, { plugin: 'ecos', lang: langOf(json.post), translations: transOf(json.post) }); }
        const out = { plugin: 'polylang', version: ECOS_VERSION, languages: LANGS };
        if (q.get('post')) { out.lang = langOf(+q.get('post')); out.translations = transOf(+q.get('post')); }
        if (q.get('ids')) out.langs = Object.fromEntries(q.get('ids').split(',').map((i) => [i, langOf(+i)]));
        return send(200, out);
      }
      if (route === '/pll/v1/languages') return send(200, LANGS.map((l) => ({ slug: l.code, name: l.name, locale: l.locale, is_default: l.default })));
      const ACF_GROUPS = [{ key: 'group_evento', title: 'Datos del evento', fields: [
        { key: 'field_lugar', name: 'lugar', label: 'Lugar', type: 'text', required: 1, instructions: 'Dónde se celebra' },
        { key: 'field_fecha', name: 'fecha', label: 'Fecha', type: 'date_picker' }, { key: 'field_gratis', name: 'gratis', label: 'Entrada gratuita', type: 'true_false' },
        { key: 'field_sesiones', name: 'sesiones', label: 'Sesiones', type: 'repeater' }] }];
      if (route === '/ecos/v1/fields' && req.method === 'GET') {
        const id = +(q.get('post') || 0), e = id ? eventos.get(id) : null;
        return send(200, { plugin: 'ecos', version: ECOS_VERSION, type: 'evento',
          acf: { groups: ACF_GROUPS, values: e ? { lugar: e.acf.lugar, fecha: e.acf.fecha, gratis: e.acf.gratis, sesiones: [] } : {}, rest: true },
          meta: { keys: [{ key: 'aforo_max', type: 'integer', description: 'Plazas', single: true }], values: e ? { aforo_max: e.aforo_max } : {} } });
      }
      if (route === '/ecos/v1/fields' && req.method === 'POST') { const e = eventos.get(+json.post); if (!e) return err(403, 'ecos_forbidden', 'Sin permiso'); if (json.acf) e.acf = { ...e.acf, ...json.acf }; return send(200, { plugin: 'ecos', saved: Object.keys(json.acf || {}).map((k) => 'acf:' + k) }); }

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
    resolve({ url: origin, user, pass, close: () => new Promise((r) => server.close(r)), state: { posts, media, blocks, cats, eventos } });
  }));
}

module.exports = { start };

if (require.main === module) start({ port: Number(process.env.PORT) || 8089 }).then((s) => console.log(`Simulador en ${s.url} (usuario ${s.user}, contraseña ${s.pass})`));
