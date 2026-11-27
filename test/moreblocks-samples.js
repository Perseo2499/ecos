// Ejemplos de los «Más bloques» (pestañas, línea de tiempo, cifras…) que comparten las pruebas de validez de WordPress, de ida y vuelta y de salida.
const IMG = { id: 7, url: 'https://x.org/a.jpg', alt: 'Una foto' };
const IMG2 = { id: 8, url: 'https://x.org/b.jpg', alt: 'Otra foto' };
const P = (html, extra = {}) => ({ id: 'mp' + Math.random().toString(36).slice(2, 7), type: 'paragraph', html, ...extra });

module.exports = {
  IMG, IMG2,
  samples: {
    tabs: () => ({ id: 'm1', type: 'tabs', cols: [{ title: 'Uno', width: '', children: [P('Hola <strong>mundo</strong>'), { id: 'm1h', type: 'heading', level: 3, html: 'Dentro' }] }, { title: 'Dos', width: '', children: [P('Adiós')] }] }),
    tabsPill: () => ({ id: 'm1b', type: 'tabs', variant: 'pill', cols: [{ title: 'A', width: '', children: [] }, { title: 'B', width: '', children: [P('b')] }] }),
    timelineV: () => ({ id: 'm2', type: 'timeline', dir: 'v', items: [{ date: '1999', title: 'Fundación', html: 'Empezamos', img: IMG }, { date: '2010', title: 'Crecimos', html: 'Uno<br><br>Dos', img: null }] }),
    timelineH: () => ({ id: 'm2b', type: 'timeline', dir: 'h', items: [{ date: 'Mayo', title: 'Hito', html: '', img: null }, { date: 'Junio', title: 'Otro', html: 'Texto', img: IMG2 }] }),
    figures: () => ({ id: 'm3', type: 'figures', count: true, items: [{ value: '20', label: 'años' }, { value: '+1.200', label: 'personas' }, { value: '3,5', label: 'millones' }] }),
    figuresNoCount: () => ({ id: 'm3b', type: 'figures', count: false, items: [{ value: '5', label: 'sedes' }, { value: '7', label: 'países' }] }),
    testimonials: () => ({ id: 'm4', type: 'testimonials', items: [{ html: 'Muy bien', name: 'Ana', role: 'Voluntaria', img: IMG }, { html: 'Genial<br><br>De verdad', name: 'Luis', role: '', img: null }] }),
    testimonialsSlider: () => ({ id: 'm4b', type: 'testimonials', slider: true, items: [{ html: 'Uno', name: 'A', role: 'x', img: null }, { html: 'Dos', name: 'B', role: 'y', img: null }, { html: 'Tres', name: 'C', role: 'z', img: null }] }),
    cards: () => ({ id: 'm5', type: 'cards', items: [{ icon: 'star', title: 'Calidad', html: 'Texto', url: 'https://x.org/q', label: 'Saber más' }, { icon: 'calendar_month', title: 'Fechas', html: '', url: '', label: '' }, { icon: '🍕', title: 'Comida', html: 'Rica', url: '', label: '' }] }),
    cta: () => ({ id: 'm6', type: 'cta', title: 'Únete', html: 'Hazte socio', align: 'center', bg: '#1f2937', color: '#ffffff', pad: 'l', btnBg: '#fd9800', btnColor: '#000000', btnRadius: 'pill', buttons: [{ html: 'Apúntate', url: 'https://x.org/a' }, { html: 'Más info', url: 'https://x.org/b' }] }),
    ctaGradient: () => ({ id: 'm6b', type: 'cta', title: 'Dona', html: '', align: 'left', gradient: 'linear-gradient(135deg,#1e293b 0%,#0f172a 100%)', pad: 'm', buttons: [{ html: 'Hoy', url: 'https://x.org/h' }] }),
    donateBizum: () => ({ id: 'm7', type: 'donate', preset: 'bizum', title: 'Colabora', html: 'Gracias', value: '600 000 000', amounts: [5, 10, 25] }),
    donatePaypal: () => ({ id: 'm7b', type: 'donate', preset: 'paypal', title: 'Dona', html: '', value: 'asociacion', label: 'Dona ya', amounts: [5, 10] }),
    donateHosted: () => ({ id: 'm7c', type: 'donate', preset: 'paypal', title: 'Dona', html: '', hosted: 'ABCD1234', amounts: [] }),
    donateTransfer: () => ({ id: 'm7d', type: 'donate', preset: 'transfer', title: 'Transferencia', html: '', value: 'ES91 2100 0418 4502 0005 1332', holder: 'Asociación X', amounts: [20] }),
    donateLink: () => ({ id: 'm7e', type: 'donate', preset: 'link', title: 'Otra vía', html: 'Texto', url: 'https://donar.example.org/ya', label: 'Ir a donar', amounts: [] }),
    event: () => ({ id: 'm8', type: 'event', title: 'Cena benéfica', start: '2026-12-05T20:30', end: '2026-12-05T23:00', place: 'Calle Mayor 1, Madrid', html: 'Trae tu <em>apetito</em>', showMap: false }),
    eventMap: () => ({ id: 'm8b', type: 'event', title: 'Jornada', start: '2026-12-05', end: '2026-12-07', place: 'Plaza Nueva, Sevilla', html: '', showMap: true }),
    audioFile: () => ({ id: 'm9', type: 'audio', mode: 'file', url: 'https://x.org/podcast.mp3', title: 'Episodio 1', html: 'Hablamos de todo' }),
    audioEmbed: () => ({ id: 'm9b', type: 'audio', mode: 'embed', provider: 'spotify', url: 'https://open.spotify.com/episode/abc123', title: '', html: '' }),
    pdf: () => ({ id: 'm10', type: 'pdf', url: 'https://x.org/memoria.pdf', title: 'Memoria 2025', html: '', name: 'memoria.pdf', preview: true, download: true, height: 600 }),
    pdfNoPreview: () => ({ id: 'm10b', type: 'pdf', url: 'https://x.org/c.pdf', title: '', html: 'Texto', name: 'Cartel', preview: false, download: true, dlText: 'Bajar' }),
    pdfViewerOnly: () => ({ id: 'm10c', type: 'pdf', url: 'https://x.org/d.pdf', title: '', html: '', name: 'd.pdf', preview: true, download: false, height: 800 }),
    hotspots: () => ({ id: 'm11', type: 'hotspots', img: IMG, points: [{ x: 30, y: 40, title: 'Entrada', html: 'Aquí se entra' }, { x: 80, y: 70, title: 'Salida', html: '' }] }),
    compare: () => ({ id: 'm12', type: 'compare', before: IMG, after: IMG2, pos: 40 }),
    faq: () => ({ id: 'm13', type: 'faq', one: true, items: [{ q: '¿Cómo?', html: 'Así<br><br>Y asá' }, { q: '¿Cuándo?', html: 'Ya' }] }),
    faqMany: () => ({ id: 'm13b', type: 'faq', one: false, items: [{ q: '¿Qué?', html: 'Eso' }] }),
  },
};
