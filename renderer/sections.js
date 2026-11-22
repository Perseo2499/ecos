// Editor de páginas (fase 2): paleta de colores, degradados, iconos y «Secciones listas».
// Lógica pura (sin DOM): la usan el editor de bloques, la galería de secciones y src/transform.js / parseblocks.js.
(function (root) {
  // --- Colores de la web (los de la marca primero) --------------------------------------------------------------
  const BRAND = { orange: '#fd9800', red: '#b3202a', dark: '#0f172a', cream: '#fff9e0' };
  // Paleta común de todos los selectores de color: marca, blanco, negro, grises (y «otro color» aparte)
  const PALETTE = [BRAND.orange, BRAND.red, BRAND.dark, BRAND.cream, '#ffffff', '#f3f4f6', '#d1d5db', '#6b7280', '#374151', '#000000'];
  // Degradados predefinidos (se guardan tal cual en style.color.gradient)
  const GRADIENTS = [
    { id: 'atardecer', name: 'Atardecer', css: 'linear-gradient(135deg,#fd9800 0%,#b3202a 100%)' },
    { id: 'naranja', name: 'Naranja', css: 'linear-gradient(135deg,#ffb84d 0%,#fd9800 100%)' },
    { id: 'rojo', name: 'Rojo', css: 'linear-gradient(135deg,#d6333f 0%,#7a121a 100%)' },
    { id: 'noche', name: 'Noche', css: 'linear-gradient(135deg,#1e293b 0%,#0f172a 100%)' },
    { id: 'crema', name: 'Crema', css: 'linear-gradient(180deg,#fff9e0 0%,#ffe9a8 100%)' },
    { id: 'amanecer', name: 'Amanecer', css: 'linear-gradient(135deg,#fff9e0 0%,#fd9800 100%)' },
  ];
  // Un degradado seguro: lineal, con 2 o 3 colores hexadecimales y sus posiciones
  const GRADIENT_RE = /^linear-gradient\(\d{1,3}deg,#[0-9a-f]{6} \d{1,3}%(?:,#[0-9a-f]{6} \d{1,3}%){1,2}\)$/i;
  const safeGradient = (g) => (GRADIENT_RE.test(String(g || '')) ? String(g) : '');
  // Símbolos para la lista con iconos
  const ICONS = ['✔', '★', '➜', '●', '♥', '☎', '✉', '⌂', '✿', '☀', '⚑', '✚'];
  const SAFE_ICON = /^[^<>&"'\s]{1,4}$/u;
  const safeIcon = (s) => (SAFE_ICON.test(String(s || '')) ? String(s) : '');
  // Mapa: dirección → enlace de Google Maps para incrustar
  const mapUrl = (address) => `https://www.google.com/maps?q=${encodeURIComponent(String(address || '').trim())}&output=embed`;
  const addressFromMap = (src) => {
    const m = String(src || '').match(/[?&]q=([^&"]+)/);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return ''; }
  };

  // --- Bloques de ejemplo (sin identificadores: el editor les pone los suyos) -----------------------------------
  const pct = (n) => `${Math.round(n * 100) / 100}%`;
  const P = (ph, extra) => ({ type: 'paragraph', html: '', ph, ...extra });
  const H = (ph, level, extra) => ({ type: 'heading', level, html: '', ph, ...extra });
  const BTN = (ph, extra) => ({ type: 'buttons', html: '', url: '', align: 'left', variant: 'fill', ph, ...extra });
  const IMG = (extra) => ({ type: 'image', img: null, caption: '', ...extra });
  const GROUP = (children, extra) => ({ type: 'group', pad: 'm', children, ...extra });
  const COLUMNS = (cols, extra) => ({ type: 'columns', stack: true, cols: cols.map((c) => (Array.isArray(c) ? { width: pct(100 / cols.length), children: c } : c)), ...extra });
  const CENTER = { align: 'center' };

  // Tarjeta: grupo con borde y sombra suave con imagen, título, texto y botón
  const CARD = () => GROUP([IMG(), H('Título de la tarjeta', 3), P('Cuenta aquí en pocas palabras de qué va.'), BTN('Saber más')], { pad: 's', radius: 12, shadow: true, border: '#e5e7eb', bg: '#ffffff' });
  // Cifra: número grande, etiqueta y color
  const FIGURE = () => GROUP([H('250', 4, { ...CENTER, size: '56px', color: BRAND.orange }), P('Personas atendidas', CENTER)], { pad: 's' });

  const SECTIONS = [
    {
      id: 'cabecera', icon: 'wallpaper', name: 'Cabecera', desc: 'Portada con título, texto y botón.',
      thumb: [['hero']],
      blocks: [{ type: 'cover', img: null, overlay: BRAND.dark, dim: 100, height: 480, width: 'full', children: [H('Título de la cabecera', 2, { ...CENTER, size: '48px' }), P('Un texto breve que explique de qué trata la página.', { ...CENTER, size: '22px' }), BTN('Texto del botón', { align: 'center', bg: BRAND.orange, color: BRAND.dark, radius: 'pill' })] }],
    },
    {
      id: 'tarjetas', icon: 'view_column', name: 'Tres tarjetas', desc: 'Tres columnas, cada una con imagen, título, texto y botón.',
      thumb: [['card', 'card', 'card']],
      blocks: [COLUMNS([[CARD()], [CARD()], [CARD()]])],
    },
    {
      id: 'colabora', icon: 'volunteer_activism', name: 'Llamada a colaborar', desc: 'Sección de color con título, texto y dos botones.',
      thumb: [['band']],
      blocks: [GROUP([
        H('Colabora con nosotras', 2, { ...CENTER, color: BRAND.dark }),
        P('Cuenta cómo puede ayudar la gente y por qué importa.', { ...CENTER, color: BRAND.dark }),
        COLUMNS([
          [BTN('Hazte socia', { align: 'right', bg: BRAND.dark, color: '#ffffff', radius: 'pill' })],
          [BTN('Dona', { align: 'left', variant: 'outline', color: BRAND.dark, radius: 'pill' })],
        ], { stack: false }),
      ], { bg: BRAND.orange, pad: 'l', width: 'full', radius: 0 })],
    },
    {
      id: 'faq', icon: 'help', name: 'Preguntas frecuentes', desc: 'Un título y varios desplegables.',
      thumb: ['h', 'det', 'det', 'det'],
      blocks: [GROUP([
        H('Preguntas frecuentes', 2),
        { type: 'details', summary: '', html: '', ph: 'Pregunta frecuente' },
        { type: 'details', summary: '', html: '', ph: 'Otra pregunta frecuente' },
        { type: 'details', summary: '', html: '', ph: 'Y una más' },
      ], { pad: 'm' })],
    },
    {
      id: 'testimonio', icon: 'format_quote', name: 'Testimonio', desc: 'Sección con una cita grande y el nombre de quien la dice.',
      thumb: [['quote']],
      blocks: [GROUP([{ type: 'quote', pull: true, html: '', cite: '', ph: 'Lo que dice una persona de la asociación, con sus palabras.' }], { bg: BRAND.cream, pad: 'l', width: 'full', radius: 0 })],
    },
    {
      id: 'cifras', icon: 'pin', name: 'Cifras', desc: 'Cuatro columnas con un número grande y su etiqueta.',
      thumb: [['num', 'num', 'num', 'num']],
      blocks: [COLUMNS([[FIGURE()], [FIGURE()], [FIGURE()], [FIGURE()]])],
    },
    {
      id: 'alternos', icon: 'splitscreen', name: 'Imagen y texto alternos', desc: 'Dos filas 50/50 con la imagen cambiando de lado.',
      thumb: [['img', 'txt'], ['txt', 'img']],
      blocks: [
        COLUMNS([[IMG()], [H('Título de la primera fila', 2), P('Cuenta aquí lo que quieras junto a la imagen.'), BTN('Saber más')]], { valign: 'center' }),
        COLUMNS([[H('Título de la segunda fila', 2), P('La imagen cambia de lado para dar ritmo a la página.'), BTN('Saber más')], [IMG()]], { valign: 'center' }),
      ],
    },
    {
      id: 'equipo', icon: 'groups', name: 'Equipo', desc: 'Columnas con foto redonda, nombre y cargo.',
      thumb: [['face', 'face', 'face', 'face']],
      blocks: [COLUMNS([0, 1, 2, 3].map(() => [IMG({ ratio: '1', frame: 'circle' }), H('Nombre y apellidos', 4, CENTER), P('Cargo o función', CENTER)]))],
    },
  ];

  // Bloques ya preparados que salen del menú «+» (se crean con BlockEditor.create)
  const PRESETS = { card: () => CARD(), figure: () => FIGURE() };

  // Miniatura esquemática de una lista de bloques (para «Mis secciones»)
  function thumbOf(blocks) {
    const row = (b) => {
      if (b.type === 'cover') return ['hero'];
      if (b.type === 'columns') return (b.cols || []).map(() => 'card').slice(0, 4);
      if (b.type === 'group') return ['band'];
      return ['p'];
    };
    return (blocks || []).slice(0, 4).map(row);
  }
  // HTML de una miniatura: filas de «piezas» (cada fila, una o varias columnas)
  function thumbHtml(rows) {
    return `<span class="sg-th">${rows.map((r) => (Array.isArray(r) ? `<span class="sg-row">${r.map((k) => `<i class="k-${k}"></i>`).join('')}</span>` : `<span class="sg-row"><i class="k-${r}"></i></span>`)).join('')}</span>`;
  }

  // «Mis secciones»: un contenedor guardado sin fotos ni identificadores
  const CT = typeof module !== 'undefined' && module.exports ? require('./templates') : root.ContentTemplates;
  function makeUserSection(name, block) {
    return { name: String(name || '').trim().slice(0, 60), blocks: CT.blocksToTemplate([block]) };
  }
  const validUserSections = (list) => (list || []).map((s, index) => ({ s, index })).filter(({ s }) => s && s.name && Array.isArray(s.blocks) && s.blocks.length);

  const api = { BRAND, PALETTE, GRADIENTS, GRADIENT_RE, safeGradient, ICONS, safeIcon, mapUrl, addressFromMap, SECTIONS, PRESETS, thumbOf, thumbHtml, makeUserSection, validUserSections };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sections = api;
})(typeof window !== 'undefined' ? window : globalThis);
