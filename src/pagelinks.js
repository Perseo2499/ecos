// Enlaces de las páginas de la web (Estructura → Mapa → entrar en una página): adónde lleva cada botón y enlace,
// qué páginas llevan a esta, y añadir / cambiar / quitar botones. La lógica pura (extraer, resolver, editar el
// HTML) está en renderer/sitemap.js; aquí solo se leen y guardan los datos de WordPress.
const wp = require('./wpself');
const { composeBlocks } = require('./transform');
const SM = require('../renderer/sitemap');

const TTL = 5 * 60 * 1000;
let cache = null; // { site, at, items: [{ id, type, title, status, link, slug, to:[«page12»…] }] }

const rawTitle = (t) => String(t?.raw ?? t?.rendered ?? '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–') || '(sin título)';
const key = (x) => x.type + x.id;
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Lee todas las páginas (y entradas) una vez y apunta a qué lleva cada una. Se guarda unos minutos.
async function index(cfg, force) {
  const site = wp.publicBase(cfg) || '';
  if (!force && cache && cache.site === site && Date.now() - cache.at < TTL) return cache;
  const items = [];
  for (const [coll, type] of [['pages', 'page'], ['posts', 'post']]) {
    let rows = [];
    try { rows = await wp.allParallel(cfg, `/wp/v2/${coll}?context=edit&status=publish,draft,private,pending,future&_fields=id,title,content,link,slug,status`); } catch (e) { if (type === 'page') throw e; }
    for (const r of rows) items.push({ id: r.id, type, title: rawTitle(r.title), status: r.status, link: r.link, slug: r.slug, _html: r.content?.raw ?? '' });
  }
  const resolve = SM.makeResolver(items, site);
  for (const it of items) {
    const { buttons, links } = SM.extractLinks(it._html);
    it.to = targetsOf(resolve, [...buttons, ...links], it);
    delete it._html;
  }
  cache = { site, at: Date.now(), items };
  return cache;
}
function targetsOf(resolve, list, self) {
  const out = new Set();
  for (const l of list) { const r = resolve(l.href); if (r.kind === 'internal' && !(r.type === self.type && r.id === self.id)) out.add(r.type + r.id); }
  return [...out];
}

// Todo lo de una página: botones y enlaces (con su destino), página que llevan a esta, y lista de destinos posibles.
async function pageLinks(cfg, id, type = 'page') {
  type = type === 'post' ? 'post' : 'page';
  const idx = await index(cfg);
  const p = await wp.getPost(cfg, id, type);
  const html = p.content || '';
  const resolve = SM.makeResolver(idx.items, idx.site);
  const { buttons, links } = SM.extractLinks(html);
  const me = idx.items.find((x) => x.id === id && x.type === type);
  if (me) { me.to = targetsOf(resolve, [...buttons, ...links], me); me.title = p.title || me.title; me.status = p.status; }
  else idx.items.push({ id, type, title: p.title || '(sin título)', status: p.status, link: p.url, slug: p.slug, to: targetsOf(resolve, [...buttons, ...links], { id, type }) });
  const withRes = (l) => ({ ...l, res: resolve(l.href) });
  // ¿Diseñada con Elementor? Entonces lo que se ve sale de Elementor, no del contenido normal de WordPress
  let builder = null;
  if (p.status === 'publish' && p.url) {
    try {
      const r = await fetch(p.url, { signal: AbortSignal.timeout(10000) });
      const page = await r.text();
      if (new RegExp(`data-elementor-id=["']${id}["']|elementor-page-${id}\\b`).test(page)) builder = 'elementor';
    } catch { /* sin conexión: se supone que no */ }
  }
  // Montada con bloques de diseño de Spectra (columnas, contenedores, sus botones…)
  if (!builder && /<!--\s*wp:uagb\//.test(html)) builder = 'spectra';
  return {
    builder, id, type, title: p.title || '(sin título)', status: p.status, link: p.url, outline: SM.blockOutline(html),
    buttons: buttons.map(withRes), links: links.slice(0, 300).map(withRes), moreLinks: Math.max(0, links.length - 300),
    incoming: idx.items.filter((x) => !(x.id === id && x.type === type) && x.to.includes(type + id)).map((x) => ({ id: x.id, type: x.type, title: x.title, status: x.status })),
    targets: idx.items.map((x) => ({ id: x.id, type: x.type, title: x.title, status: x.status, link: x.link })),
  };
}

// Añade, cambia o quita un botón de la página y la guarda. op: { action:'add', text, href, variant, where:'end'|'afterFirst' }
// | { action:'edit', index, old:{text,href}, text, href, variant } | { action:'remove', index, old }
// Devuelve el mismo resultado que pageLinks, ya con el cambio.
async function buttonOp(cfg, id, type, op) {
  type = type === 'post' ? 'post' : 'page';
  const p = await wp.getPost(cfg, id, type);
  let html = p.content || '';
  if (op.action === 'add') {
    const text = String(op.text || '').trim(), href = String(op.href || '').trim();
    if (!text) throw new Error('Escribe el texto del botón.');
    if (!href) throw new Error('Elige adónde lleva el botón.');
    html = SM.insertBlock(html, buttonHtml(text, href, op.variant), op.where);
  } else if (op.action === 'edit') {
    const text = op.text == null ? null : String(op.text).trim();
    if (text === '') throw new Error('El botón necesita un texto.');
    html = SM.editButton(html, Number(op.index), op.old, { text, href: op.href == null ? null : String(op.href).trim(), variant: op.variant });
  } else if (op.action === 'remove') html = SM.removeButton(html, Number(op.index), op.old);
  else throw new Error('Acción desconocida.');
  await wp.updateFields(cfg, id, { content: html }, type);
  return pageLinks(cfg, id, type);
}
// El mismo bloque de botón que genera Ecos al publicar (src/transform.js)
const buttonHtml = (text, href, variant) => composeBlocks([{ type: 'buttons', html: escText(text), url: href, variant: variant === 'outline' ? 'outline' : 'fill' }]);

const forget = () => { cache = null; };
module.exports = { pageLinks, buttonOp, buttonHtml, forget };
