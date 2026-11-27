// Editor de bloques · utilidades compartidas: selectores, textos, tipos de bloque, enlaces de vídeo y otras webs, estilo de
// texto y el estado del arrastre. Los demás archivos de renderer/blocks/ las leen de window.BlockKit (no se repiten).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const t = (s, v) => window.I18N.t(s, v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let n = 0;
  const bid = () => 'u' + Date.now().toString(36) + (n++).toString(36);

  const TYPES = () => ({
    paragraph: { icon: 'notes', name: t('Párrafo') }, heading: { icon: 'title', name: t('Título') },
    image: { icon: 'image', name: t('Imagen') }, gallery: { icon: 'grid_view', name: t('Galería') },
    carousel: { icon: 'view_carousel', name: t('Carrusel') }, mediatext: { icon: 'vertical_split', name: t('Imagen y texto') },
    quote: { icon: 'format_quote', name: t('Cita') }, list: { icon: 'format_list_bulleted', name: t('Lista') },
    video: { icon: 'movie', name: t('Vídeo') }, embed: { icon: 'smart_display', name: t('Vídeo o contenido de otra web') },
    separator: { icon: 'horizontal_rule', name: t('Separador') }, table: { icon: 'table', name: t('Tabla') },
    buttons: { icon: 'smart_button', name: t('Botón') }, spacer: { icon: 'height', name: t('Espacio') },
    details: { icon: 'expand_circle_down', name: t('Desplegable') }, toc: { icon: 'toc', name: t('Índice') },
    group: { icon: 'web_asset', name: t('Sección') }, columns: { icon: 'view_column', name: t('Columnas') }, cover: { icon: 'wallpaper', name: t('Portada') },
    map: { icon: 'map', name: t('Mapa') },
    raw: { icon: 'code_blocks', name: t('De WordPress') },
    synced: { icon: 'sync', name: t('Sincronizado') },
  });
  const TEXT_TYPES = ['paragraph', 'heading', 'quote', 'list'];
  const MT_SIZES = [25, 33, 50, 66]; // tamaños de la foto en «Imagen y texto» (% del ancho)
  const CAR_H = { s: '240px', m: '360px', l: '480px', xl: '70vh' }; // altura de las fotos del carrusel

  // Enlaces de vídeo y otras webs → bloque «embed» (WordPress los inserta con oEmbed)
  const EMBEDS = [
    { id: 'youtube', name: 'YouTube', re: /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i, player: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}` },
    { id: 'vimeo', name: 'Vimeo', re: /vimeo\.com\/(?:video\/|channels\/[\w-]+\/)?(\d+)/i, player: (m) => `https://player.vimeo.com/video/${m[1]}` },
    { id: 'dailymotion', name: 'Dailymotion', re: /(?:dailymotion\.com\/video|dai\.ly)\/([a-z0-9]+)/i, player: (m) => `https://www.dailymotion.com/embed/video/${m[1]}` },
    { id: 'tiktok', name: 'TikTok', re: /tiktok\.com\/.+\/video\/\d+/i },
    { id: 'instagram', name: 'Instagram', re: /instagram\.com\/(?:p|reel|tv)\//i },
    { id: 'facebook', name: 'Facebook', re: /(?:facebook\.com|fb\.watch)\//i },
    { id: 'twitter', name: 'X (Twitter)', re: /(?:twitter|x)\.com\/\w+\/status\/\d+/i },
    { id: 'spotify', name: 'Spotify', re: /open\.spotify\.com\/(track|album|playlist|episode|show)\/(\w+)/i, player: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}` },
    { id: 'soundcloud', name: 'SoundCloud', re: /soundcloud\.com\/[\w-]+\/[\w-]+/i },
  ];
  const detectEmbed = (url) => {
    const u = String(url || '').trim();
    if (!/^https?:\/\/\S+$/i.test(u)) return null;
    if (/\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test(u)) return { file: true, url: u };
    for (const p of EMBEDS) { const m = u.match(p.re); if (m) return { provider: p.id, name: p.name, url: u, player: p.player?.(m) }; }
    return null;
  };

  // Aspecto de un bloque de texto en el editor (igual que lo pintará la web)
  const FONTS = { serif: 'Georgia, Times New Roman, serif', sans: 'Helvetica Neue, Arial, sans-serif', round: 'Trebuchet MS, Segoe UI, sans-serif', mono: 'Courier New, monospace', hand: 'Segoe Print, Comic Sans MS, cursive' };
  function applyStyle(el, b) {
    if (!el) return;
    el.style.textAlign = ['center', 'right', 'justify'].includes(b.align) ? b.align : '';
    el.style.fontSize = b.size || '';
    el.style.fontFamily = FONTS[b.font] || window.ThemeUI?.fontCss(b.font) || '';
    el.style.color = b.color || '';
    el.style.backgroundColor = b.bg || '';
    el.style.padding = b.bg ? '14px 18px' : '';
    el.style.borderRadius = b.bg ? '10px' : '';
    el.classList.toggle('drop-cap', !!b.dropCap);
    el.style.letterSpacing = b.spacing || '';
    el.classList.toggle('ecos-sombra', !!b.shadow);
  }

  // Proporciones de columnas (como las que escribe composeBlocks)
  const COLS = { 2: [[50, 50], [33.33, 66.66], [66.66, 33.33]], 3: [[33.33, 33.33, 33.33], [25, 50, 25], [50, 25, 25], [25, 25, 50]], 4: [[25, 25, 25, 25]] };
  const pct = (n) => `${Math.round(n * 100) / 100}%`;
  // Paleta común de todos los selectores de color (marca, blanco, negro y grises); «otro color» aparte
  const SK = () => window.Sections;
  const SWATCH = SK().PALETTE;
  const has = (v) => v !== undefined && v !== null && v !== '';
  const toast = (m) => window.toast ? window.toast(m, true) : alert(m);
  const info = (m) => window.toast ? window.toast(m) : alert(m); // aviso que no es un error

  window.BlockKit = {
    $, $$, t, esc, bid, TYPES, TEXT_TYPES, MT_SIZES, CAR_H, EMBEDS, detectEmbed, FONTS, applyStyle, COLS, pct, SK, SWATCH, has, toast, info,
    drag: null, // lo que se arrastra ahora mismo (ver blocks/drag.js)
  };
})();
