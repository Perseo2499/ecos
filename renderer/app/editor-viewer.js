// Ecos · Editor de entradas (visor de fotos y vídeos y vista previa). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
// ---------------------------------------------------------------- Visor de fotos y vídeos
const mediaItemsOf = (p) => p.media.map((m) => (m.type === 'video'
  ? { type: 'video', src: m.videoUrl || fileUrl(m.path), poster: m.url && !m.path ? m.url : '', fallback: m.url }
  : { type: 'image', src: m.url || fileUrl(m.path) }));
let lb = { items: [], i: 0 };
function openLightbox(items, i) {
  if (!items.length) return;
  lb = { items, i: Math.max(0, Math.min(i, items.length - 1)) };
  $('#lightbox').classList.remove('hidden'); renderLightbox();
}
function renderLightbox() {
  const it = lb.items[lb.i], stage = $('#lightbox .lb-stage');
  stage.innerHTML = '';
  if (it.type === 'video' && it.src) {
    const v = document.createElement('video');
    v.src = it.src; v.controls = true; v.autoplay = true; if (it.poster) v.poster = it.poster;
    v.onerror = () => { stage.innerHTML = ''; const img = document.createElement('img'); img.src = it.poster || it.fallback || ''; stage.appendChild(img); toast(t('No se puede reproducir este vídeo aquí; se muestra su miniatura.')); };
    stage.appendChild(v);
  } else {
    const img = document.createElement('img'); img.src = it.src || it.fallback || ''; img.alt = ''; stage.appendChild(img);
  }
  $('#lightbox .lb-count').textContent = lb.items.length > 1 ? `${lb.i + 1} / ${lb.items.length}` : '';
  $$('#lightbox .lb-prev, #lightbox .lb-next').forEach((b) => (b.style.visibility = lb.items.length > 1 ? 'visible' : 'hidden'));
}
const closeLightbox = () => { $('#lightbox').classList.add('hidden'); $('#lightbox .lb-stage').innerHTML = ''; };
const stepLightbox = (d) => { lb.i = (lb.i + d + lb.items.length) % lb.items.length; renderLightbox(); };
$('#lightbox .lb-close').onclick = closeLightbox;
$('#lightbox .lb-prev').onclick = () => stepLightbox(-1);
$('#lightbox .lb-next').onclick = () => stepLightbox(1);
$('#lightbox').onclick = (e) => { if (e.target.id === 'lightbox' || e.target.classList.contains('lb-stage')) closeLightbox(); };
document.addEventListener('keydown', (e) => {
  if ($('#lightbox').classList.contains('hidden')) {
    if (e.key === 'Escape') { if (!$('#pv-modal').classList.contains('hidden')) $('#pv-modal').classList.add('hidden'); else if (!$('#summary-modal').classList.contains('hidden')) $('#summary-modal').classList.add('hidden'); }
    return;
  }
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});

// ---------------------------------------------------------------- Vista previa de la entrada
// Dentro de Ecos con los estilos reales de tu web (leídos de su portada); «Ver en mi web» guarda un
// borrador y abre la vista previa de WordPress.
// Ventana de vista previa con los estilos reales de la web (editor y entradas de una copia)
async function showPreview({ title, date: when, cats = [], featured, content, web = false, pageBg = null }) {
  // enlaces de vídeo solos en una línea: el reproductor, como hace WordPress
  content = content.replace(/<p>\s*(https?:\/\/[^\s<]+)\s*<\/p>/g, (m, url) => {
    const e = window.BlockEditor.detectEmbed(url.replace(/&amp;/g, '&'));
    return e?.player ? `<figure class="wp-block-embed"><iframe src="${escHtml(e.player)}" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe></figure>` : m;
  });
  const date = new Date(typeof when === 'string' ? when.replace(' ', 'T') : when).toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  let site = { css: '', bodyClass: '' };
  try { site = await window.api.siteStyles(); } catch { /* sin conexión: estilo genérico */ }
  const generic = site.css ? '' : `body{font:18px/1.7 Georgia,serif;color:#1d1d1f}h1{font:700 40px/1.15 system-ui,sans-serif}
    .wp-block-gallery{display:grid;grid-template-columns:repeat(var(--c,3),1fr);gap:10px}.wp-block-gallery img{width:100%;aspect-ratio:1;object-fit:cover}
    .wp-block-media-text{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center}.wp-block-media-text.has-media-on-the-right figure{order:2}
    blockquote{border-left:4px solid #ccc;margin:1.5em 0;padding-left:1em}`;
  // Fondo de la página: misma estructura que Astra (#page > #content > .ast-container > #primary) y el mismo CSS que se envía
  const bgCss = window.PageBg ? PageBg.css(pageBg) : '';
  const bgOpen = bgCss ? '<div id="page" class="hfeed site"><div id="content" class="site-content"><div class="ast-container"><div id="primary" class="content-area">' : '';
  const bgClose = bgCss ? '</div></div></div></div><div class="ecos-page-bg" hidden></div>' : '';
  $('#pv-frame').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <style>${site.css}</style><style>${generic}
      .ecos-pv{max-width:760px;margin:0 auto;padding:40px 24px 80px}
      .ecos-pv img,.ecos-pv video{max-width:100%;height:auto}
      .ecos-pv .ecos-meta{opacity:.7;font-size:.9em;margin-bottom:1.5em}
      .ecos-pv .ecos-featured{width:100%;border-radius:12px;margin-bottom:1.5em}
      .ecos-pv .wp-block-embed:not(:has(iframe)){padding:18px;border:1px dashed #bbb;border-radius:10px;font-size:14px;word-break:break-all}
      .has-text-align-center{text-align:center}.has-text-align-right{text-align:right}.has-text-align-justify,.ecos-justify{text-align:justify}
      .has-background{padding:1.25em 2.375em}.has-drop-cap:first-letter{float:left;font-size:5.5em;line-height:.68;font-weight:100;margin:.05em .1em 0 0;text-transform:uppercase}
      mark.has-inline-color{padding:0 .1em}
      .wp-block-table table{width:100%;border-collapse:collapse}.wp-block-table td,.wp-block-table th{border:1px solid;padding:.5em}.wp-block-table.is-style-stripes tbody tr:nth-child(odd){background:#f0f0f0}
      .wp-block-buttons{display:flex;gap:.5em;flex-wrap:wrap;margin:1.5em 0}.wp-block-buttons.is-content-justification-center{justify-content:center}.wp-block-buttons.is-content-justification-right{justify-content:flex-end}
      .wp-block-button__link{display:inline-block;padding:.65em 1.4em;border-radius:9999px;background:#32373c;color:#fff;text-decoration:none}
      .is-style-outline .wp-block-button__link{background:transparent;color:inherit;border:2px solid}
      .wp-block-pullquote{text-align:center;border-block:4px solid;padding:2em 0;margin:2em 0;font-size:1.5em}.wp-block-pullquote blockquote{margin:0;border:0;padding:0}
      .wp-block-details{border:1px solid #ddd;border-radius:10px;padding:.8em 1.1em;margin:1.5em 0}.wp-block-details summary{cursor:pointer;font-weight:600}
      .wp-element-caption{font-size:.85em;opacity:.75;text-align:center}
    </style><style>${bgCss}</style></head>
    <body class="${escHtml(site.bodyClass.replace(/\bhome\b|\bblog\b|\bpage\b/g, ''))} single single-post wp-embed-responsive">
    ${bgOpen}<main class="site-main"><article class="post type-post status-publish hentry ecos-pv">
      <header class="entry-header">${cats.length ? `<div class="cat-links ecos-meta">${escHtml(cats.join(' · '))}</div>` : ''}
        <h1 class="entry-title wp-block-post-title">${escHtml(title)}</h1><div class="ecos-meta entry-meta">${date}</div></header>
      ${featured ? `<img class="ecos-featured wp-post-image" src="${escHtml(featured)}" alt="">` : ''}
      <div class="entry-content wp-block-post-content is-layout-constrained">${content}</div>
    </article></main>${bgClose}</body></html>`;
  $('#pv-frame').onload = () => $('#pv-frame').contentDocument.querySelectorAll('[data-ecos-carousel]').forEach((el) => window.ecosCarousel(el));
  $('#pv-web').classList.toggle('hidden', !web);
  $('#pv-modal').classList.remove('hidden');
  if (!site.css) toast(t('No se pudieron leer los estilos de tu web; la vista previa usa un estilo genérico.'));
}
$('#preview').onclick = (e) => busy(e.target, async () => {
  let content = await window.api.composeDraft(draft.blocks);
  // Lo que WordPress añade al mostrar la entrada: alineación de los botones y reproductores de vídeo
  content = content.replace(/<!-- wp:buttons \{"layout":\{"type":"flex","justifyContent":"(center|right)"\}\} -->\n<div class="wp-block-buttons/g, (_m, j) => `<div class="wp-block-buttons is-content-justification-${j}`)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div class="wp-block-embed__wrapper">\n(\S+)\n<\/div>/g, (m, url) => {
      const e = window.BlockEditor.detectEmbed(url.replace(/&amp;/g, '&'));
      return e?.player ? `<div class="wp-block-embed__wrapper"><iframe src="${escHtml(e.player)}" style="width:100%;aspect-ratio:${/spotify/.test(e.player) ? '16/5' : '16/9'};border:0" allowfullscreen></iframe></div>` : m;
    });
  const featured = window.BlockEditor.flat(draft.blocks).flatMap((b) => (b.img ? [b.img] : b.images || [])).filter((i) => i.type !== 'video').find((i) => i.id === draft.featuredImageId);
  const cats = $$('#d-cats input:checked').map((i) => i.value);
  await showPreview({ title: $('#d-title').value, date: $('#d-keepdate').checked ? draft.date : Date.now(), cats, featured: featured?.url, content, web: true, pageBg: draft.pageBg });
});

$$('#pv-size button').forEach((b) => b.onclick = () => {
  $$('#pv-size button').forEach((x) => x.classList.toggle('active', x === b));
  $('#pv-frame').style.maxWidth = b.dataset.w + 'px';
});
$('#pv-close').onclick = () => $('#pv-modal').classList.add('hidden');
$('#pv-web').onclick = (e) => busy(e.target, async () => {
  const r = await window.api.previewDraft(draftPayload('draft'));
  draft.postId = r.postId; draft.previewOnly = true; // borrador solo para ver la vista previa
  window.api.open(r.previewUrl);
  toast(t('Guardado como borrador. La vista previa se abre en tu navegador.'));
});


