// Ecos · Importar una entrada o página exportada de WordPress (Herramientas → Exportar, archivo .xml «WXR»)
// o un archivo .html con el contenido en bloques de WordPress. Devuelve [{ title, type, slug, status, excerpt, content, date }].
const unCdata = (s) => String(s || '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
const ent = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name.replace(':', '\\:')}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace(':', '\\:')}>`));
  if (!m) return '';
  const v = m[1];
  return /^\s*<!\[CDATA\[/.test(v) ? unCdata(v) : ent(v.trim());
}
function parseWxr(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const type = tag(it, 'wp:post_type') || 'post';
    if (!['post', 'page'].includes(type)) continue; // adjuntos, menús, bloques reutilizables… no
    items.push({ title: tag(it, 'title'), type, slug: tag(it, 'wp:post_name'), status: tag(it, 'wp:status') || 'draft',
      excerpt: tag(it, 'excerpt:encoded'), content: tag(it, 'content:encoded'), date: tag(it, 'wp:post_date') });
  }
  return items;
}
// .html / .txt: contenido directo (con un <title> o un primer <h1> como título, si lo hay)
function parseHtml(html) {
  const s = String(html);
  const body = (s.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] ?? s;
  const title = ent(((s.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim());
  const content = body.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '').trim();
  return [{ title, type: 'page', slug: '', status: 'draft', excerpt: '', content, date: '' }];
}
function parseImport(text, name = '') {
  const isXml = /\.xml$/i.test(name) || /<rss[\s>]/i.test(text) && /<wp:post_type>/.test(text);
  const list = isXml ? parseWxr(text) : parseHtml(text);
  return list.filter((x) => x.title || x.content);
}
module.exports = { parseImport, parseWxr, parseHtml };
