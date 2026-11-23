// Ecos · Copia de seguridad de la web: baja todas las entradas y páginas de WordPress y las guarda en un archivo
// WXR (la exportación XML de WordPress), solo o dentro de un ZIP con la carpeta «uploads/» y las fotos.
// Lo que se escribe lo entiende el restaurador de Ecos (src/backup.js) y el importador de WordPress.
// Las funciones puras (WXR, ZIP) están aparte de la parte que habla con WordPress, para poder probarlas.
const fs = require('fs');
const zlib = require('zlib');
const { uploadsRel } = require('./backup');

// ---------------------------------------------------------------- WXR
const xmlText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlAttr = (s) => xmlText(s).replace(/"/g, '&quot;');
// CDATA seguro: un «]]>» dentro del texto se parte en dos trozos
const cdata = (s) => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
// «2026-05-04T10:00:00» o «2026-05-04 10:00:00.000Z» → «2026-05-04 10:00:00»
const wpDate = (d) => String(d || '').replace('T', ' ').replace(/(\.\d+)?Z?$/, '').slice(0, 19) || '0000-00-00 00:00:00';
const pubDate = (gmt) => { const d = new Date(wpDate(gmt).replace(' ', 'T') + 'Z'); return isNaN(d) ? '' : d.toUTCString(); };
const slugOf = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// items: [{ id, type: 'post'|'page', title, content, excerpt, date, dateGmt, status, slug, parent, menuOrder, link,
//           categories: [{name, slug}], tags: [{name, slug}], featured: <id de adjunto> }]
// attachments: [{ id, title, url, rel, mime, alt, date, dateGmt, parent }]
// terms: { categories: [{id, name, slug, parent}], tags: [{id, name, slug}] }
function buildWxr({ title = '', link = '', items = [], attachments = [], terms = {}, generator = 'Ecos' } = {}) {
  const out = [];
  const now = new Date().toUTCString();
  out.push('<?xml version="1.0" encoding="UTF-8" ?>',
    '<!-- Copia de seguridad creada con Ecos. Se puede restaurar con Ecos o importar en WordPress (Herramientas → Importar). -->',
    '<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">',
    '<channel>',
    `<title>${xmlText(title)}</title>`, `<link>${xmlText(link)}</link>`, '<description></description>', `<pubDate>${now}</pubDate>`, '<language>es-ES</language>',
    '<wp:wxr_version>1.2</wp:wxr_version>', `<wp:base_site_url>${xmlText(link)}</wp:base_site_url>`, `<wp:base_blog_url>${xmlText(link)}</wp:base_blog_url>`);
  const catById = new Map((terms.categories || []).map((c) => [c.id, c]));
  for (const c of terms.categories || []) {
    out.push(`<wp:category><wp:term_id>${Number(c.id) || 0}</wp:term_id><wp:category_nicename>${cdata(c.slug || slugOf(c.name))}</wp:category_nicename><wp:category_parent>${cdata(catById.get(c.parent)?.slug || '')}</wp:category_parent><wp:cat_name>${cdata(c.name)}</wp:cat_name></wp:category>`);
  }
  for (const g of terms.tags || []) {
    out.push(`<wp:tag><wp:term_id>${Number(g.id) || 0}</wp:term_id><wp:tag_slug>${cdata(g.slug || slugOf(g.name))}</wp:tag_slug><wp:tag_name>${cdata(g.name)}</wp:tag_name></wp:tag>`);
  }
  out.push(`<generator>${xmlText(generator)}</generator>`);
  const common = (x, type, status, parent, extra = '') => [
    `<title>${cdata(x.title)}</title>`, `<link>${xmlText(x.link || x.url || '')}</link>`, `<pubDate>${pubDate(x.dateGmt || x.date)}</pubDate>`,
    '<dc:creator><![CDATA[admin]]></dc:creator>', `<guid isPermaLink="false">${xmlText(x.link || x.url || `?p=${x.id}`)}</guid>`, '<description></description>',
    `<content:encoded>${cdata(x.content || '')}</content:encoded>`, `<excerpt:encoded>${cdata(x.excerpt || '')}</excerpt:encoded>`,
    `<wp:post_id>${Number(x.id) || 0}</wp:post_id>`, `<wp:post_date>${cdata(wpDate(x.date))}</wp:post_date>`, `<wp:post_date_gmt>${cdata(wpDate(x.dateGmt || x.date))}</wp:post_date_gmt>`,
    '<wp:comment_status><![CDATA[closed]]></wp:comment_status>', '<wp:ping_status><![CDATA[closed]]></wp:ping_status>',
    `<wp:post_name>${cdata(x.slug || '')}</wp:post_name>`, `<wp:status>${cdata(status)}</wp:status>`, `<wp:post_parent>${Number(parent) || 0}</wp:post_parent>`,
    `<wp:menu_order>${Number(x.menuOrder) || 0}</wp:menu_order>`, `<wp:post_type>${cdata(type)}</wp:post_type>`, '<wp:post_password></wp:post_password>', '<wp:is_sticky>0</wp:is_sticky>', extra,
  ].join('\n');
  const meta = (k, v) => `<wp:postmeta><wp:meta_key>${cdata(k)}</wp:meta_key><wp:meta_value>${cdata(v)}</wp:meta_value></wp:postmeta>`;
  for (const x of items) {
    const type = x.type === 'page' ? 'page' : 'post';
    const cats = (x.categories || []).map((c) => `<category domain="category" nicename="${xmlAttr(c.slug || slugOf(c.name))}">${cdata(c.name)}</category>`);
    const tags = (x.tags || []).map((c) => `<category domain="post_tag" nicename="${xmlAttr(c.slug || slugOf(c.name))}">${cdata(c.name)}</category>`);
    out.push('<item>', common(x, type, x.status || 'draft', x.parent, [...cats, ...tags, x.featured ? meta('_thumbnail_id', x.featured) : ''].filter(Boolean).join('\n')), '</item>');
  }
  for (const a of attachments) {
    const extra = [`<wp:attachment_url>${cdata(a.url)}</wp:attachment_url>`, a.rel ? meta('_wp_attached_file', a.rel) : '', a.alt ? meta('_wp_attachment_image_alt', a.alt) : ''].filter(Boolean).join('\n');
    out.push('<item>', common({ ...a, content: '', excerpt: '', slug: slugOf(a.title) || `media-${a.id}`, link: a.url }, 'attachment', 'inherit', a.parent, extra), '</item>');
  }
  out.push('</channel>', '</rss>', '');
  return out.join('\n');
}

// Una entrada o página que devuelve la API de WordPress (context=edit) → elemento del WXR
function restToItem(p, type, catMap = new Map(), tagMap = new Map()) {
  const pick = (map, ids) => (ids || []).map((id) => map.get(id)).filter(Boolean).map((c) => ({ name: c.name, slug: c.slug }));
  return {
    id: p.id, type: type === 'page' ? 'page' : 'post', title: p.title?.raw ?? p.title?.rendered ?? '', content: p.content?.raw ?? '', excerpt: p.excerpt?.raw ?? '',
    date: p.date, dateGmt: p.date_gmt, status: p.status, slug: p.slug, parent: p.parent || 0, menuOrder: p.menu_order || 0, link: p.link || '',
    categories: pick(catMap, p.categories), tags: pick(tagMap, p.tags), featured: p.featured_media || 0,
  };
}
// Un medio de la biblioteca de Ecos (media:all) → adjunto del WXR; rel = ruta dentro de «uploads»
function mediaToAttachment(m) {
  const rel = uploadsRel(m.url || '');
  return { id: m.id, title: m.name || '', url: m.url, rel: safeRel(rel) ? rel : '', mime: m.mime || '', alt: m.alt || '', date: m.date, dateGmt: m.date, parent: m.parent || 0 };
}
// Ruta segura dentro del ZIP: sin «..», sin rutas absolutas ni letras de unidad
const safeRel = (rel) => !!rel && !/(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:/i.test(rel);

// ---------------------------------------------------------------- ZIP (sin comprimir, escrito archivo a archivo)
// Las fotos ya van comprimidas (JPEG, PNG, MP4…), así que se guardan tal cual; así no hace falta tener toda
// la biblioteca en memoria. Con ZIP64 para más de 65.535 archivos o más de 4 GB.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const dosTime = (d) => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() });

class ZipWriter {
  // limit: a partir de qué desplazamiento se usa ZIP64 (solo cambia en las pruebas)
  constructor(file, { limit = 0xffffffff } = {}) {
    this.out = fs.createWriteStream(file); this.entries = []; this.pos = 0; this.limit = limit;
    this.err = null; this.out.on('error', (e) => { this.err = e; });
  }
  async write(buf) {
    if (this.err) throw this.err;
    this.pos += buf.length;
    if (!this.out.write(buf)) await new Promise((res) => this.out.once('drain', res));
    if (this.err) throw this.err;
  }
  // deflate: comprime el archivo (para texto: HTML, CSS, JSON); sin él se guarda tal cual
  async add(name, data, when = new Date(), { deflate = false } = {}) {
    const nm = Buffer.from(name.replace(/\\/g, '/'), 'utf8'), crc = crc32(data);
    const packed = deflate && data.length > 64 ? zlib.deflateRawSync(data) : null;
    const body = packed && packed.length < data.length ? packed : data, method = body === data ? 0 : 8;
    const { time, date } = dosTime(isNaN(+when) || when.getFullYear() < 1980 ? new Date() : when);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28);
    this.entries.push({ nm, crc, size: data.length, csize: body.length, method, offset: this.pos, time, date });
    await this.write(h); await this.write(nm); if (body.length) await this.write(body);
  }
  async finish() {
    const start = this.pos;
    for (const e of this.entries) {
      const big = e.offset >= this.limit;
      const extra = big ? Buffer.alloc(12) : Buffer.alloc(0);
      if (big) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(8, 2); extra.writeBigUInt64LE(BigInt(e.offset), 4); }
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(big ? 45 : 20, 4); c.writeUInt16LE(big ? 45 : 20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.csize, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nm.length, 28); c.writeUInt16LE(extra.length, 30); c.writeUInt32LE(big ? 0xffffffff : e.offset, 42);
      await this.write(c); await this.write(e.nm); if (extra.length) await this.write(extra);
    }
    const size = this.pos - start, n = this.entries.length;
    const zip64 = n >= 0xffff || start >= this.limit || size >= this.limit;
    if (zip64) {
      const eocd64At = this.pos;
      const z = Buffer.alloc(56);
      z.writeUInt32LE(0x06064b50, 0); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14);
      z.writeBigUInt64LE(BigInt(n), 24); z.writeBigUInt64LE(BigInt(n), 32); z.writeBigUInt64LE(BigInt(size), 40); z.writeBigUInt64LE(BigInt(start), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(eocd64At), 8); loc.writeUInt32LE(1, 16);
      await this.write(z); await this.write(loc);
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(zip64 ? 0xffff : n, 8); e.writeUInt16LE(zip64 ? 0xffff : n, 10);
    e.writeUInt32LE(zip64 ? 0xffffffff : size, 12); e.writeUInt32LE(zip64 ? 0xffffffff : start, 16);
    await this.write(e);
    await new Promise((res, rej) => { this.out.once('error', rej); this.out.end(res); });
  }
}

// ---------------------------------------------------------------- crear la copia
const POST_FIELDS = 'id,title,content,excerpt,date,date_gmt,status,slug,categories,tags,featured_media,parent,menu_order,link';
const STATUSES = 'publish,future,draft,pending,private';
// deps = { listAll(ruta) → [] (todas las páginas de la API), media: [] (biblioteca), download(url) → Buffer|null, siteName, siteUrl }
// opts = { file, photos, onProgress(p), cancelled() → bool }
// zip/prefix: para escribir dentro de un ZIP ya abierto (la copia de emergencia) en la carpeta «prefix»; entonces no lo cierra
async function createBackup(deps, { file, photos = true, onProgress = () => {}, cancelled = () => false, zip: extZip = null, prefix = '' } = {}) {
  const stop = () => { if (cancelled()) throw new Error('Cancelado'); };
  onProgress({ step: 'entradas' });
  const [posts, pages, cats, tags] = [
    await deps.listAll(`/wp/v2/posts?context=edit&status=${STATUSES}&_fields=${POST_FIELDS}`),
    await deps.listAll(`/wp/v2/pages?context=edit&status=${STATUSES}&_fields=${POST_FIELDS}`),
    await deps.listAll('/wp/v2/categories?_fields=id,name,slug,parent').catch(() => []),
    await deps.listAll('/wp/v2/tags?_fields=id,name,slug').catch(() => []),
  ];
  stop();
  const catMap = new Map(cats.map((c) => [c.id, c])), tagMap = new Map(tags.map((c) => [c.id, c]));
  const items = [...posts.map((p) => restToItem(p, 'post', catMap, tagMap)), ...pages.map((p) => restToItem(p, 'page', catMap, tagMap))];
  const all = (deps.media || []).map(mediaToAttachment);
  const featured = new Set(items.map((x) => x.featured).filter(Boolean));
  // con fotos: toda la biblioteca; sin ellas: solo las imágenes destacadas (para que sigan enlazadas)
  const attachments = photos ? all : all.filter((a) => featured.has(a.id));
  const xml = buildWxr({ title: deps.siteName || '', link: deps.siteUrl || '', items, attachments, terms: { categories: cats, tags } });
  const result = { posts: posts.length, pages: pages.length, files: 0, missing: 0, bytes: 0, file };
  if (!photos) {
    onProgress({ step: 'guardar' });
    fs.writeFileSync(file, xml, 'utf8');
    result.bytes = Buffer.byteLength(xml);
    return result;
  }
  const zip = extZip || new ZipWriter(file);
  try {
    await zip.add(prefix + 'ecos-copia-de-seguridad.xml', Buffer.from(xml, 'utf8'));
    const files = [...new Map(attachments.filter((a) => a.rel && a.url).map((a) => [a.rel, a])).values()];
    const total = files.length;
    let done = 0;
    // se bajan de 4 en 4 y se escriben en orden
    for (let i = 0; i < files.length; i += 4) {
      stop();
      const batch = files.slice(i, i + 4);
      const bufs = await Promise.all(batch.map((a) => Promise.resolve(deps.download(a.url)).catch(() => null)));
      stop();
      for (let k = 0; k < batch.length; k++) {
        if (bufs[k]) { await zip.add(prefix + 'uploads/' + batch[k].rel, bufs[k], new Date(batch[k].date || Date.now())); result.files++; result.bytes += bufs[k].length; } else result.missing++;
        onProgress({ step: 'fotos', done: ++done, total, file: batch[k].rel });
      }
    }
    if (!extZip) { onProgress({ step: 'guardar' }); await zip.finish(); }
  } catch (e) {
    if (!extZip) { try { zip.out.destroy(); fs.unlinkSync(file); } catch { /* ya no está */ } }
    throw e;
  }
  return result;
}

module.exports = { buildWxr, restToItem, mediaToAttachment, safeRel, cdata, wpDate, ZipWriter, crc32, createBackup, POST_FIELDS, STATUSES };
