// Plantillas de contenido: bloques ya preparados para crear entradas y páginas.
// Lógica pura (sin DOM): la usa el selector de plantilla de editor.js y se prueba con `npm test`.
(function (root) {
  const P = (html, ph) => ({ type: 'paragraph', html: html || '', ...(ph ? { ph } : {}) });
  const H2 = (html) => ({ type: 'heading', level: 2, html });
  const BTN = (html, extra) => ({ type: 'buttons', html, url: '', align: 'left', variant: 'fill', ...extra });
  const QUOTE = (ph) => ({ type: 'quote', html: '', cite: '', ph });
  const LIST = (items, ph) => ({ type: 'list', ordered: false, items, ph });

  // Plantillas incluidas. `types`: dónde se ofrecen · `category`: categoría que se marca si existe · `featured`: hueco de foto destacada
  const BUILTIN = [
    {
      id: 'actividad', icon: 'volunteer_activism', name: 'Actividad', types: ['post'], category: 'Blog', featured: true,
      desc: 'Cuenta una actividad con fotos, participantes y una cita.',
      blocks: [
        P('', 'Entradilla: en dos líneas, qué ha pasado, cuándo y dónde.'),
        H2('Qué hicimos'),
        P('', 'Cuenta cómo fue la actividad.'), P('', 'Añade más detalles, si quieres.'),
        { type: 'gallery', images: [], columns: 3 },
        H2('Quiénes participaron'),
        P('', 'Quiénes estuvieron y qué aportaron.'),
        QUOTE('Palabras de una persona participante (con su permiso).'),
        BTN('Colabora con Elín', { align: 'center' }),
      ],
    },
    {
      id: 'comunicado', icon: 'campaign', name: 'Comunicado', types: ['post'], category: 'Comunicados',
      desc: 'Posición pública de la asociación, con contexto y reivindicaciones.',
      blocks: [
        P('<strong>Entradilla en negrita: la noticia en una o dos frases.</strong>'),
        H2('Contexto'),
        P('', 'Qué ha ocurrido y por qué importa.'), P('', 'Datos y antecedentes.'),
        QUOTE('Cita de la persona portavoz.'),
        H2('Nuestra posición'),
        LIST(['', '', ''], 'Reivindicación'),
        P('Contacto de prensa: ', 'Nombre, correo y teléfono para prensa.'),
      ],
    },
    {
      id: 'campana', icon: 'flag', name: 'Campaña', types: ['post'],
      desc: 'Pide ayuda para una causa: objetivo, cómo colaborar y botón.',
      blocks: [
        { type: 'image', img: null, caption: '' },
        H2('El objetivo'),
        P('', 'Qué queremos conseguir y para quién.'),
        H2('Cómo puedes ayudar'),
        LIST(['', '', ''], 'Una forma de ayudar'),
        BTN('Quiero ayudar', { align: 'center' }),
        { type: 'separator' },
        P('Comparte esta campaña con tu gente: cada difusión suma.'),
      ],
    },
    {
      id: 'informativa', icon: 'article', name: 'Página informativa', types: ['page'],
      desc: 'Secciones con títulos y preguntas frecuentes desplegables.',
      blocks: [
        P('', 'Presenta la página en una o dos frases.'),
        H2('Primera sección'), P('', 'Escribe aquí el contenido.'),
        H2('Segunda sección'), P('', 'Escribe aquí el contenido.'),
        H2('Preguntas frecuentes'),
        { type: 'details', summary: '', html: '', ph: 'Pregunta frecuente' },
        { type: 'details', summary: '', html: '', ph: 'Otra pregunta frecuente' },
      ],
    },
    {
      id: 'contacto', icon: 'contact_mail', name: 'Contacto', types: ['page'],
      desc: 'Cómo localizarnos: texto, datos de contacto y botón.',
      blocks: [
        P('', 'Cuenta cómo y cuándo pueden contactar con la asociación.'),
        LIST(['', '', ''], 'Dirección, teléfono, correo u horario'),
        BTN('Escríbenos', { align: 'center' }),
      ],
    },
  ];

  // Convierte bloques en la estructura de una plantilla propia: conserva textos y estructura, quita las fotos concretas
  // (pasan a huecos) y los identificadores. No toca el original.
  function blocksToTemplate(blocks) {
    const out = [];
    for (const src of blocks || []) {
      if (!src || !src.type) continue;
      const b = JSON.parse(JSON.stringify(src));
      delete b.id;
      if (b.type === 'image') { b.img = null; b.caption = ''; }
      else if (b.type === 'gallery' || b.type === 'carousel') b.images = [];
      else if (b.type === 'mediatext') b.img = null;
      else if (b.type === 'video') b.video = null;
      else if (b.type === 'raw' && /<img\b|wp-image/i.test(b.markup || '')) continue; // bloque suelto con fotos de la web: no es estructura
      out.push(b);
    }
    return out;
  }

  // Plantilla propia lista para guardar (sin el título del borrador)
  function makeUserTemplate(name, blocks, type) {
    return { name: String(name || '').trim().slice(0, 60), type: type === 'page' ? 'page' : 'post', blocks: blocksToTemplate(blocks) };
  }

  // Plantillas que se ofrecen para un tipo: las incluidas y después las propias
  function forType(type, userTemplates) {
    const ty = type === 'page' ? 'page' : 'post';
    return {
      builtin: BUILTIN.filter((x) => x.types.includes(ty)),
      own: (userTemplates || []).map((tp, index) => ({ tp, index })).filter(({ tp }) => tp && tp.name && Array.isArray(tp.blocks) && (!tp.type || tp.type === ty)),
    };
  }

  // Miniatura esquemática: una «barra» por bloque
  function sketch(blocks, featured) {
    const rows = [];
    if (featured) rows.push('cover');
    for (const b of blocks || []) {
      const ty = b.type;
      rows.push(ty === 'heading' ? 'h' : ty === 'list' ? 'list' : ty === 'quote' ? 'quote' : ty === 'buttons' ? 'btn'
        : ty === 'gallery' || ty === 'carousel' ? 'gal' : ty === 'image' || ty === 'video' || ty === 'mediatext' ? 'cover'
        : ty === 'separator' ? 'sep' : ty === 'details' ? 'det' : 'p');
    }
    return rows.slice(0, 14);
  }

  const api = { BUILTIN, blocksToTemplate, makeUserTemplate, forType, sketch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ContentTemplates = api;
})(typeof window !== 'undefined' ? window : globalThis);
