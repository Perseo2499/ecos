// Restaurar entradas desde una copia de seguridad de WordPress.
// Formatos: ZIP de UpdraftPlus / Duplicator / BackWPup (con .sql o .sql.gz y wp-content/uploads),
// .wpress de All-in-One WP Migration, exportación XML de WordPress (WXR), .sql / .sql.gz sueltos
// y carpetas ya descomprimidas. Se pueden abrir varios archivos a la vez (p. ej. la base de datos y
// el ZIP de «uploads» de UpdraftPlus).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const yauzl = require('yauzl');

// ---------------------------------------------------------------- lectores de archivos
// Cada fuente expone list() → [nombres] y read(nombre) → Buffer

function zipSource(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(new Error(`No se puede abrir ${path.basename(file)}: ${err.message}`));
      const entries = new Map();
      zip.readEntry();
      zip.on('entry', (e) => { if (!/\/$/.test(e.fileName)) entries.set(e.fileName.replace(/\\/g, '/'), e); zip.readEntry(); });
      zip.on('end', () => resolve({
        label: path.basename(file), kind: 'zip',
        list: () => [...entries.keys()],
        size: (n) => entries.get(n)?.uncompressedSize || 0,
        read: (n) => new Promise((res, rej) => {
          const e = entries.get(n);
          if (!e) return rej(new Error('No está en la copia: ' + n));
          zip.openReadStream(e, (er, st) => {
            if (er) return rej(er);
            const chunks = []; st.on('data', (c) => chunks.push(c)); st.on('end', () => res(Buffer.concat(chunks))); st.on('error', rej);
          });
        }),
        close: () => zip.close(),
      }));
      zip.on('error', reject);
    });
  });
}

// .wpress (All-in-One WP Migration): cabeceras de 4377 bytes (nombre 255, tamaño 14, fecha 12, ruta 4096)
function wpressSource(file) {
  const fd = fs.openSync(file, 'r');
  const total = fs.fstatSync(fd).size;
  const entries = new Map();
  const head = Buffer.alloc(4377);
  let pos = 0;
  const str = (b, a, l) => b.toString('utf8', a, a + l).replace(/\0[\s\S]*$/, '');
  while (pos + 4377 <= total) {
    fs.readSync(fd, head, 0, 4377, pos);
    if (head.every((x) => x === 0)) break; // bloque final
    const name = str(head, 0, 255), size = Number(str(head, 255, 14)), dir = str(head, 281, 4096);
    const full = (dir && dir !== '.' ? dir.replace(/\\/g, '/') + '/' : '') + name;
    entries.set(full, { offset: pos + 4377, size });
    pos += 4377 + size;
  }
  return {
    label: path.basename(file), kind: 'wpress',
    list: () => [...entries.keys()],
    size: (n) => entries.get(n)?.size || 0,
    read: async (n) => { const e = entries.get(n); const b = Buffer.alloc(e.size); fs.readSync(fd, b, 0, e.size, e.offset); return b; },
    close: () => fs.closeSync(fd),
  };
}

function dirSource(dir) {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(path.relative(dir, p).replace(/\\/g, '/')); } };
  walk(dir);
  return { label: path.basename(dir), kind: 'carpeta', list: () => files, size: (n) => fs.statSync(path.join(dir, n)).size, read: async (n) => fs.readFileSync(path.join(dir, n)), close() {} };
}

function fileSource(file) {
  const n = path.basename(file);
  return { label: n, kind: 'archivo', list: () => [n], size: () => fs.statSync(file).size, read: async () => fs.readFileSync(file), close() {} };
}

async function openSource(p) {
  if (fs.statSync(p).isDirectory()) return dirSource(p);
  const head = Buffer.alloc(4); const fd = fs.openSync(p, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
  if (head[0] === 0x50 && head[1] === 0x4b) return zipSource(p);           // «PK»: ZIP
  if (/\.wpress$/i.test(p)) return wpressSource(p);
  return fileSource(p);
}

// ---------------------------------------------------------------- base de datos SQL
// Lee las sentencias INSERT de las tablas de WordPress (con cualquier prefijo) sin cargar MySQL.
function parseSql(sql) {
  const tables = {};
  const create = /CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?\s*\(([\s\S]*?)\)\s*(?:(?:ENGINE|TYPE)\s*=|;)/gi;
  let m;
  while ((m = create.exec(sql))) {
    // columnas: nombres entre comillas invertidas al principio de cada definición (en una o varias líneas)
    const cols = [...m[2].matchAll(/(?:^|,)\s*`(\w+)`\s+[a-z]/gim)].map((x) => x[1]);
    tables[m[1]] = { columns: cols, rows: [] };
  }
  const ins = /INSERT (?:IGNORE )?INTO `?(\w+)`?\s*(\(([^)]*)\))?\s*VALUES\s*/gi;
  while ((m = ins.exec(sql))) {
    const name = m[1];
    const t = tables[name] || (tables[name] = { columns: [], rows: [] });
    if (m[3] && !t.columns.length) t.columns = m[3].split(',').map((c) => c.trim().replace(/`/g, ''));
    let i = ins.lastIndex;
    // tuplas ( … ), ( … ); con cadenas entre comillas y escapes de MySQL
    while (i < sql.length) {
      while (/\s/.test(sql[i])) i++;
      if (sql[i] !== '(') break;
      i++;
      const row = []; let val = ''; let inStr = false; let quote = '';
      let wasStr = false;
      for (; i < sql.length; i++) {
        const c = sql[i];
        if (inStr) {
          if (c === '\\') { const n = sql[++i]; val += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : n === '0' ? '\0' : n === 'Z' ? '\x1a' : n; continue; }
          if (c === quote) { if (sql[i + 1] === quote) { val += c; i++; continue; } inStr = false; continue; }
          val += c; continue;
        }
        if (c === "'" || c === '"') { inStr = true; quote = c; wasStr = true; continue; }
        if (c === ',' || c === ')') {
          const v = val.trim();
          row.push(wasStr ? val : v.toUpperCase() === 'NULL' ? null : v);
          val = ''; wasStr = false;
          if (c === ')') { i++; break; }
          continue;
        }
        val += c;
      }
      t.rows.push(row);
      while (/\s/.test(sql[i])) i++;
      if (sql[i] === ',') { i++; continue; }
      break;
    }
    ins.lastIndex = i;
  }
  return tables;
}

// Busca las tablas de WordPress (prefijo variable: wp_, wpxy_…) y las convierte en objetos
function wpFromSql(sql) {
  const tables = parseSql(sql);
  const postsT = Object.keys(tables).find((n) => /posts$/.test(n) && tables[n].columns.includes('post_title'));
  if (!postsT) return null;
  const prefix = postsT.replace(/posts$/, '');
  const objs = (n) => { const t = tables[prefix + n]; return t ? t.rows.map((r) => Object.fromEntries(t.columns.map((c, k) => [c, r[k]]))) : []; };
  const options = Object.fromEntries(objs('options').filter((o) => ['siteurl', 'home', 'blogname'].includes(o.option_name)).map((o) => [o.option_name, o.option_value]));
  return {
    prefix, siteUrl: options.home || options.siteurl || '', siteName: options.blogname || '',
    posts: objs('posts'), meta: objs('postmeta'), terms: objs('terms'), tax: objs('term_taxonomy'), rel: objs('term_relationships'),
  };
}

// ---------------------------------------------------------------- exportación XML (WXR)
function wpFromWxr(xml) {
  const cdata = (s) => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
  const tag = (block, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block); return m ? cdata(m[1]).trim() : ''; };
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
  const channel = xml.slice(0, xml.indexOf('<item>') > 0 ? xml.indexOf('<item>') : 2000);
  const posts = [], meta = [], terms = [], tax = [], rel = [];
  let termId = 1;
  const termIds = new Map();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const id = tag(b, 'wp:post_id');
    posts.push({
      ID: id, post_title: decode(tag(b, 'title')), post_content: tag(b, 'content:encoded'), post_excerpt: tag(b, 'excerpt:encoded'),
      post_date: tag(b, 'wp:post_date'), post_date_gmt: tag(b, 'wp:post_date_gmt'), post_status: tag(b, 'wp:status'),
      post_type: tag(b, 'wp:post_type'), post_name: tag(b, 'wp:post_name'), post_parent: tag(b, 'wp:post_parent'),
      guid: tag(b, 'wp:attachment_url') || tag(b, 'guid'), post_mime_type: '',
    });
    for (const pm of b.matchAll(/<wp:postmeta>([\s\S]*?)<\/wp:postmeta>/g)) meta.push({ post_id: id, meta_key: tag(pm[1], 'wp:meta_key'), meta_value: tag(pm[1], 'wp:meta_value') });
    for (const c of b.matchAll(/<category domain="(category|post_tag)" nicename="([^"]*)">([\s\S]*?)<\/category>/g)) {
      const key = c[1] + ':' + c[2];
      if (!termIds.has(key)) { const tid = String(termId++); termIds.set(key, tid); terms.push({ term_id: tid, name: decode(cdata(c[3])), slug: c[2] }); tax.push({ term_taxonomy_id: tid, term_id: tid, taxonomy: c[1] }); }
      rel.push({ object_id: id, term_taxonomy_id: termIds.get(key) });
    }
  }
  return { prefix: '', siteUrl: tag(channel, 'wp:base_blog_url') || tag(channel, 'link'), siteName: decode(tag(channel, 'title')), posts, meta, terms, tax, rel };
}

// ---------------------------------------------------------------- análisis
const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|mp4|mov|m4v|webm|mp3|pdf)$/i;
// «2017/03/foto-300x200.jpg» → «2017/03/foto.jpg» (las miniaturas apuntan al original)
const original = (rel) => rel.replace(/-\d+x\d+(?=\.\w+$)/, '').replace(/-scaled(?=\.\w+$)/, '');
// Ruta relativa dentro de «uploads» a partir de una URL (WordPress propio o WordPress.com)
function uploadsRel(url) {
  try {
    const u = new URL(url.replace(/&amp;/g, '&'));
    let p = decodeURIComponent(u.pathname);
    const k = p.indexOf('/wp-content/uploads/');
    if (k >= 0) return p.slice(k + 20);
    if (/\.files\.wordpress\.com$|\.wordpress\.com$|wp\.com$/.test(u.hostname)) return p.replace(/^\/+/, '');
    return null;
  } catch { return null; }
}

async function analyze(paths, progress = () => {}) {
  const sources = [];
  for (const p of paths) { progress({ step: 'abrir', file: path.basename(p) }); sources.push(await openSource(p)); }

  // Índice de archivos multimedia: «2017/03/foto.jpg» → { source, name, size }
  const files = new Map();
  let db = null, dbFile = '';
  for (const src of sources) {
    for (const name of src.list()) {
      const low = name.toLowerCase();
      const up = low.indexOf('uploads/');
      if (IMG_EXT.test(name) && (up >= 0 || src.kind === 'carpeta')) {
        const rel = up >= 0 ? name.slice(up + 8) : name;
        if (!files.has(rel)) files.set(rel, { src, name, size: src.size(name) });
      }
      const isSql = /\.sql$|\.sql\.gz$|[-_]db\.gz$|database\.sql$/i.test(name);
      const isXml = /\.xml$/i.test(name);
      if (!db && (isSql || isXml) && src.size(name) > 0) {
        progress({ step: 'leer', file: name });
        let buf = await src.read(name);
        if (/\.gz$/i.test(name) || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = zlib.gunzipSync(buf);
        const text = buf.toString('utf8');
        db = isXml || /<rss[\s\S]{0,400}wxr_version/.test(text.slice(0, 3000)) ? wpFromWxr(text) : wpFromSql(text);
        if (db) dbFile = `${src.label} → ${name}`;
      }
    }
  }
  if (!db) {
    for (const s of sources) s.close();
    throw new Error('No se encontró la base de datos de WordPress en la copia (un archivo .sql, .sql.gz o la exportación .xml). Si tu copia viene en varios archivos, ábrelos todos a la vez.');
  }

  progress({ step: 'analizar' });
  const metaOf = new Map();
  for (const m of db.meta) { if (!metaOf.has(m.post_id)) metaOf.set(m.post_id, {}); metaOf.get(m.post_id)[m.meta_key] = m.meta_value; }
  const termById = new Map(db.terms.map((t) => [String(t.term_id), t]));
  const taxById = new Map(db.tax.map((t) => [String(t.term_taxonomy_id), t]));
  const termsOf = new Map();
  for (const r of db.rel) {
    const tx = taxById.get(String(r.term_taxonomy_id)); if (!tx) continue;
    const term = termById.get(String(tx.term_id)); if (!term) continue;
    if (!termsOf.has(String(r.object_id))) termsOf.set(String(r.object_id), { category: [], post_tag: [] });
    termsOf.get(String(r.object_id))[tx.taxonomy]?.push(term.name.replace(/&amp;/g, '&'));
  }

  // Adjuntos (fotos, vídeos…) con su archivo dentro de la copia
  const attachments = new Map();
  for (const p of db.posts.filter((x) => x.post_type === 'attachment')) {
    const meta = metaOf.get(String(p.ID)) || {};
    const rel = meta._wp_attached_file || uploadsRel(p.guid) || '';
    attachments.set(String(p.ID), { id: String(p.ID), url: p.guid, rel, alt: meta._wp_attachment_image_alt || '', title: p.post_title, mime: p.post_mime_type });
  }
  const findFile = (rel) => (rel ? files.get(rel) || files.get(original(rel)) : null);

  const posts = db.posts
    .filter((p) => ['post', 'page'].includes(p.post_type) && !['auto-draft', 'inherit', 'trash'].includes(p.post_status))
    .map((p) => {
      const meta = metaOf.get(String(p.ID)) || {};
      const content = p.post_content || '';
      // Medios referenciados: imágenes y enlaces a «uploads», galerías [gallery ids="…"] e imagen destacada
      const urls = new Set([...content.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]).filter((u) => uploadsRel(u) && IMG_EXT.test(u.split('?')[0])));
      const galleryIds = [...content.matchAll(/\[gallery[^\]]*ids=["']?([\d,\s]+)/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean));
      const thumb = meta._thumbnail_id && attachments.get(String(meta._thumbnail_id));
      const media = [...urls].map((u) => ({ url: u, rel: original(uploadsRel(u)) }));
      for (const id of galleryIds) { const a = attachments.get(id); if (a) media.push({ url: a.url, rel: a.rel, attId: id }); }
      if (thumb) media.push({ url: thumb.url, rel: thumb.rel, attId: thumb.id, featured: true });
      const uniq = [...new Map(media.map((m) => [m.rel || m.url, m])).values()];
      const found = uniq.filter((m) => findFile(m.rel)).length;
      const t = termsOf.get(String(p.ID)) || { category: [], post_tag: [] };
      return {
        key: `${p.post_type}:${p.ID}`, id: String(p.ID), type: p.post_type, status: p.post_status, slug: p.post_name,
        title: (p.post_title || '').replace(/&amp;/g, '&') || '(sin título)', date: p.post_date, dateGmt: p.post_date_gmt,
        excerpt: p.post_excerpt || '', content, categories: t.category.filter((c) => c !== 'Uncategorized' && c !== 'Sin categoría'), tags: t.post_tag,
        media: uniq, mediaFound: found, mediaMissing: uniq.length - found,
        thumbRel: thumb?.rel || uniq[0]?.rel || null,
        words: content.replace(/<[^>]+>|\[[^\]]+\]/g, ' ').split(/\s+/).filter(Boolean).length,
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const kinds = sources.map((s) => `${s.label} (${s.kind})`);
  return {
    sources, kinds, dbFile, siteUrl: db.siteUrl, siteName: db.siteName, prefix: db.prefix,
    posts, attachments, files, findFile,
    stats: {
      posts: posts.filter((p) => p.type === 'post').length, pages: posts.filter((p) => p.type === 'page').length,
      published: posts.filter((p) => p.status === 'publish').length, drafts: posts.filter((p) => p.status !== 'publish').length,
      files: files.size, attachments: attachments.size,
      mediaRefs: posts.reduce((n, p) => n + p.media.length, 0), mediaMissing: posts.reduce((n, p) => n + p.mediaMissing, 0),
      categories: [...new Set(posts.flatMap((p) => p.categories))], tags: new Set(posts.flatMap((p) => p.tags)).size,
      from: posts.length ? posts[posts.length - 1].date : null, to: posts.length ? posts[0].date : null,
    },
  };
}

// ---------------------------------------------------------------- restauración de una entrada
// upload(buffer, filename) → { id, url } en el WordPress de destino.
// Devuelve los campos listos para crear la entrada, con los enlaces antiguos cambiados por los nuevos.
async function prepare(an, post, upload, { download = true } = {}) {
  const map = new Map();      // URL o ruta antigua → { id, url } nueva
  const idMap = new Map();    // ID de adjunto antiguo → ID nuevo (para [gallery ids])
  const problems = [];
  for (const m of post.media) {
    const key = m.rel || m.url;
    if (map.has(key)) continue;
    let buf = null, name = path.basename((m.rel || m.url).split('?')[0]);
    const f = an.findFile(m.rel);
    if (f) buf = await f.src.read(f.name);
    else if (download) {
      try { const r = await fetch(m.url.split('?')[0]); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); } catch { /* sin conexión */ }
    }
    if (!buf) { problems.push(name); continue; }
    try {
      const up = await upload(buf, name);
      map.set(key, up);
      if (m.attId) idMap.set(m.attId, up.id);
    } catch (e) { problems.push(`${name}: ${e.message}`); }
  }
  // Cambiar enlaces: cualquier URL de «uploads» cuya ruta (sin tamaño) coincida con un archivo subido
  let content = post.content.replace(/(https?:\/\/[^\s"'<>)]+)/g, (u) => {
    const rel = uploadsRel(u); if (!rel) return u;
    const hit = map.get(original(rel)) || map.get(rel) || map.get(u);
    return hit ? hit.url : u;
  });
  content = content.replace(/(\[gallery[^\]]*ids=["']?)([\d,\s]+)/g, (_m, a, ids) => a + ids.split(',').map((x) => idMap.get(x.trim()) || x.trim()).join(','));
  content = content.replace(/wp-image-(\d+)/g, (m, id) => (idMap.has(id) ? `wp-image-${idMap.get(id)}` : m));
  // Contenido del editor clásico (sin bloques): los saltos de línea dobles son párrafos
  if (!/<!-- wp:/.test(content) && !/<p[\s>]/i.test(content)) content = content.split(/\n\s*\n/).map((p) => (/^\s*<(h\d|ul|ol|figure|div|blockquote|table|\[)/i.test(p) ? p : `<p>${p.trim().replace(/\n/g, '<br>')}</p>`)).join('\n\n');
  const featured = post.media.find((m) => m.featured);
  return {
    fields: {
      title: post.title, content, excerpt: post.excerpt,
      date: post.dateGmt && !post.dateGmt.startsWith('0000') ? post.dateGmt.replace(' ', 'T') + 'Z' : post.date ? new Date(post.date.replace(' ', 'T')).toISOString() : undefined,
      categories: post.categories.join(','), tags: post.tags.join(','),
      ...(featured && map.get(featured.rel || featured.url) ? { featured_image: map.get(featured.rel || featured.url).id } : {}),
    },
    uploaded: map.size, problems,
  };
}

// Miniatura de una foto de la copia (para la lista), como data URL pequeña
async function thumbnail(an, rel, nativeImage) {
  const f = an.findFile(rel);
  if (!f || f.size > 25e6 || !/\.(jpe?g|png|gif|webp)$/i.test(f.name)) return null;
  const img = nativeImage.createFromBuffer(await f.src.read(f.name));
  if (img.isEmpty()) return null;
  return img.resize({ width: 120 }).toDataURL();
}

module.exports = { analyze, prepare, thumbnail, parseSql, wpFromSql, wpFromWxr, uploadsRel, original };
