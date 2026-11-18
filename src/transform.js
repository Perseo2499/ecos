// Convierte una o varias publicaciones en una entrada con bloques de Gutenberg.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HASHTAG = /#([\p{L}\p{N}_]+)/gu;

function extractTags(text) {
  return [...new Set([...text.matchAll(HASHTAG)].map((m) => m[1]))];
}

function cleanText(text, source) {
  // Quita el bloque de hashtags final y enlaza las @menciones
  let t = text.replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim();
  t = esc(t);
  const base = source === 'instagram' ? 'https://www.instagram.com/' : 'https://www.facebook.com/';
  t = t.replace(/(^|\s)@([\w.]+)/g, (_m, sp, u) => `${sp}<a href="${base}${u}">@${u}</a>`);
  t = t.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  return t;
}

function makeTitle(text, date) {
  const first = text.replace(HASHTAG, '').split(/\n|(?<=[.!?¡¿])\s/)[0].trim();
  if (first.length >= 8) return first.length > 80 ? first.slice(0, 77).trimEnd() + '…' : first;
  return 'Publicación del ' + new Date(date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Clave única de un medio: URL remota (API) o ruta local (importaciones)
const mediaKey = (m) => m.url || m.path;

const para = (html) => `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;

function imageBlock(img) {
  return `<!-- wp:image {"id":${img.id},"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="${img.url}" class="wp-image-${img.id}"/></figure>\n<!-- /wp:image -->`;
}

function galleryBlock(imgs) {
  return `<!-- wp:gallery {"linkTo":"none"} -->\n<figure class="wp-block-gallery has-nested-images columns-default is-cropped">\n${imgs.map(imageBlock).join('\n')}\n</figure>\n<!-- /wp:gallery -->`;
}

function videoBlock(v) {
  return `<!-- wp:video {"id":${v.id}} -->\n<figure class="wp-block-video"><video controls src="${v.url}"></video></figure>\n<!-- /wp:video -->`;
}

function embedBlock(url, provider) {
  return `<!-- wp:embed {"url":"${url}","type":"rich","providerNameSlug":"${provider}"} -->\n<figure class="wp-block-embed is-type-rich is-provider-${provider}"><div class="wp-block-embed__wrapper">\n${url}\n</div></figure>\n<!-- /wp:embed -->`;
}

// uploaded: Map(urlOriginal -> {id, url}) con las imágenes ya subidas a WordPress
function postToBlocks(post, uploaded) {
  const blocks = [];
  const imgs = post.media.filter((m) => m.type === 'image').map((m) => uploaded.get(mediaKey(m))).filter(Boolean);
  const videos = post.media.filter((m) => m.type === 'video' && m.path).map((m) => uploaded.get(mediaKey(m))).filter(Boolean);
  const hasRemoteVideo = post.media.some((m) => m.type === 'video' && !m.path);

  const paragraphs = cleanText(post.text, post.source).split(/\n\s*\n/).filter(Boolean);
  for (const p of paragraphs) blocks.push(para(p.replace(/\n/g, '<br>')));

  if (imgs.length === 1) blocks.push(imageBlock(imgs[0]));
  else if (imgs.length > 1) blocks.push(galleryBlock(imgs));
  for (const v of videos) blocks.push(videoBlock(v));
  if (hasRemoteVideo && post.permalink) blocks.push(embedBlock(post.permalink, post.source));

  const red = post.source === 'instagram' ? 'Instagram' : 'Facebook';
  if (post.permalink) blocks.push(para(`<em>Publicado originalmente en <a href="${post.permalink}">${red}</a>.</em>`));
  else blocks.push(para(`<em>Publicado originalmente en ${red}.</em>`));
  return blocks.join('\n\n');
}

function buildDraft(posts, uploaded) {
  const sorted = [...posts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const tags = [...new Set(sorted.flatMap((p) => extractTags(p.text)))];
  const title = sorted.length === 1 ? makeTitle(sorted[0].text, sorted[0].date) : 'Resumen de nuestras últimas publicaciones';
  const content = sorted.map((p) => postToBlocks(p, uploaded)).join('\n\n<!-- wp:separator -->\n<hr class="wp-block-separator"/>\n<!-- /wp:separator -->\n\n');
  // La primera imagen se usa como imagen destacada
  const firstImg = sorted.flatMap((p) => p.media).filter((m) => m.type === 'image').map((m) => uploaded.get(mediaKey(m))).find(Boolean);
  return { title, content, tags, featuredImageId: firstImg?.id, date: sorted[sorted.length - 1].date };
}

module.exports = { buildDraft, extractTags, mediaKey };
