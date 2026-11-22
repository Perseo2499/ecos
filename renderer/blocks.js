// Editor de bloques de Ecos: el contenido de la entrada es una lista de bloques que se escriben, se
// reordenan arrastrando y se combinan con fotos y vídeos. Cada bloque corresponde a un bloque estándar
// de WordPress (ver composeBlocks en src/transform.js), así en la web se ve con la misma estructura.
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
    el.style.fontFamily = FONTS[b.font] || '';
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

  const E = {
    draft: null, media: [], onChange: () => {}, onOpenMedia: () => {},
    undo: [], redo: [],

    mount(draft, { media, onChange, onOpenMedia, onPeekCss }) {
      this.draft = draft; this.media = media; this.onChange = onChange || (() => {}); this.onOpenMedia = onOpenMedia || (() => {}); this.onPeekCss = onPeekCss;
      this.undo = []; this.redo = [];
      this.autoFeatured();
      this.liftFeatured(); // la destacada va arriba y sale del cuerpo
      this.wireTools();
      this.render(); this.renderMedia();
    },
    // --- Árbol de bloques: las secciones, columnas y portadas llevan bloques dentro ---------------------------------
    // children = [bloques] (sección, portada) · cols = [{ width, children }] (columnas)
    kids(b) { return Array.isArray(b.children) ? [b.children] : Array.isArray(b.cols) ? b.cols.map((c) => (c.children = c.children || [])) : []; },
    // Todos los bloques, también los de dentro, en el orden del documento
    flat(arr = this.draft?.blocks || [], out = []) { for (const b of arr || []) { out.push(b); for (const l of this.kids(b)) this.flat(l, out); } return out; },
    // Dónde está un bloque: { arr, i, b, parent }
    locate(id, arr = this.draft.blocks, parent = null) {
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (b.id === id) return { arr, i, b, parent };
        for (const l of this.kids(b)) { const r = this.locate(id, l, b); if (r) return r; }
      }
      return null;
    },
    // ¿El bloque `b` (o algo de dentro) es el que tiene ese id? (para no meter un contenedor dentro de sí mismo)
    holds(b, id) { return this.flat([b]).some((x) => x.id === id); },
    within(dragId, ownerId) { const loc = this.locate(dragId); return !!loc && this.holds(loc.b, ownerId); },
    // Copia de un bloque con identificadores nuevos (también los de dentro)
    cloneBlock(b) { const c = JSON.parse(JSON.stringify(b)); this.flat([c]).forEach((x) => (x.id = bid())); return c; },
    // Plantillas: lista de bloques sin id (con hijos) → bloques de verdad
    fromTemplate(list) {
      return (list || []).map(({ type, children, cols, ...rest }) => {
        const b = this.create(type, JSON.parse(JSON.stringify(rest)));
        if (children) b.children = this.fromTemplate(children);
        if (cols) b.cols = cols.map((c) => ({ width: c.width, children: this.fromTemplate(c.children) }));
        return b;
      });
    },
    // Fotos del cuerpo de la entrada
    bodyImages() { return this.flat().flatMap((b) => (b.img ? [b.img] : b.images || [])); },
    // Si la entrada tiene una sola foto y ninguna destacada, esa foto pasa a ser también la destacada (es la que se
    // ve en la lista del blog y al compartir) y se queda en el cuerpo, para que el texto no pierda sentido.
    // No se hace si se quitó la destacada a mano.
    autoFeatured() {
      if (this.draft.featuredImageId != null || this.draft.noAutoFeatured) return;
      const imgs = this.bodyImages().filter((i) => i && i.type !== 'video' && i.url);
      if (imgs.length !== 1) return;
      const img = imgs[0];
      this.draft.featuredImageId = img.id;
      this.draft.keepFeaturedInBody = true;
    },
    // Saca la imagen destacada del cuerpo (si está) para que no salga dos veces en la web
    liftFeatured() {
      const id = this.draft.featuredImageId;
      if (id == null || this.draft.keepFeaturedInBody) return false;
      let found = false;
      const lift = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          const b = arr[i];
          if (b.img?.id === id) { found = true; if (b.type === 'image') { arr.splice(i, 1); continue; } b.img = null; }
          if (b.images?.some((x) => x.id === id)) { found = true; b.images = b.images.filter((x) => x.id !== id); }
          for (const l of this.kids(b)) lift(l);
        }
      };
      lift(this.draft.blocks);
      return found;
    },

    // --- Historial (deshacer / rehacer) -------------------------------------------
    snapshot() {
      this.undo.push(JSON.stringify({ blocks: this.draft.blocks, f: this.draft.featuredImageId }));
      if (this.undo.length > 80) this.undo.shift();
      this.redo = [];
    },
    restore(from, to) {
      if (!from.length) return;
      to.push(JSON.stringify({ blocks: this.draft.blocks, f: this.draft.featuredImageId }));
      const s = JSON.parse(from.pop());
      this.draft.blocks = s.blocks; this.draft.featuredImageId = s.f;
      this.render();
      this.onChange?.();
    },
    doUndo() { this.restore(this.undo, this.redo); },
    doRedo() { this.restore(this.redo, this.undo); },
    change(fn, rerender = true) {
      this.snapshot();
      const before = this.draft.featuredImageId;
      fn();
      // si la destacada se ha metido en el cuerpo, deja de ser la destacada (no puede estar en los dos sitios)
      const id = this.draft.featuredImageId;
      if (id != null && id === before && this.bodyImages().some((x) => x.id === id)) {
        this.draft.featuredImageId = null;
        toast(t('La foto ha pasado al cuerpo de la entrada y ya no es la imagen destacada.'));
      }
      if (rerender) this.render();
      this.onChange();
    },

    // --- Bloques nuevos ------------------------------------------------------------
    create(type, extra = {}) {
      if (type === 'mosaic') return this.create('gallery', { layout: 'mosaic', ...extra });
      // bloques ya preparados: tarjeta y cifra son secciones con bloques dentro; la lista con iconos, una lista
      if (type === 'card' || type === 'figure') return Object.assign(this.fromTemplate([SK().PRESETS[type]()])[0], extra);
      if (type === 'iconlist') return this.create('list', { icons: [SK().ICONS[0]], ...extra });
      const b = { id: bid(), type };
      if (type === 'paragraph' || type === 'quote') b.html = '';
      if (type === 'heading') { b.html = ''; b.level = 2; }
      if (type === 'list') { b.items = ['']; b.ordered = false; }
      if (type === 'gallery') { b.images = []; b.columns = 3; }
      if (type === 'carousel') b.images = [];
      if (type === 'mediatext') { b.img = null; b.html = ''; b.right = false; }
      if (type === 'image') { b.img = null; b.caption = ''; }
      if (type === 'video') b.video = null;
      if (type === 'embed') { b.url = ''; b.provider = ''; b.caption = ''; }
      if (type === 'table') { b.rows = [['', '', ''], ['', '', ''], ['', '', '']]; b.head = true; b.stripes = false; }
      if (type === 'buttons') { b.html = ''; b.url = ''; b.align = 'left'; b.variant = 'fill'; }
      if (type === 'spacer') b.height = 40;
      if (type === 'details') { b.summary = ''; b.html = ''; }
      if (type === 'toc') b.title = t('En esta entrada');
      if (type === 'map') { b.address = ''; b.height = 360; b.radius = 16; }
      if (type === 'group') { b.children = [this.create('paragraph')]; b.pad = 'm'; }
      if (type === 'columns') { b.cols = [0, 1].map(() => ({ width: '50%', children: [this.create('paragraph')] })); b.stack = true; }
      if (type === 'cover') {
        b.img = null; b.overlay = '#000000'; b.dim = 50; b.height = 360;
        b.children = [this.create('heading', { level: 2, align: 'center', ph: t('Título de la portada') }), this.create('paragraph', { align: 'center', ph: t('Un texto breve…') }), this.create('buttons', { align: 'center', ph: t('Texto del botón') })];
      }
      return Object.assign(b, extra);
    },
    // Varios bloques de una vez (una sección lista de la galería)
    insertList(i, list, arr = this.draft.blocks) {
      this.change(() => arr.splice(i, 0, ...list));
    },
    insertAt(i, block, focus = true, arr = this.draft.blocks) {
      this.change(() => arr.splice(i, 0, block));
      if (focus) this.focus(block.id);
    },
    // Una sola barra a la vez: el bloque más interior bajo el ratón; si el ratón no está sobre ninguno, el que se edita
    toolsOwner(el) {
      const canvas = document.getElementById('ed-canvas');
      if (!canvas) return;
      if (this.pinned && !canvas.contains(this.pinned)) this.pinned = null;
      const pick = this.pinned || el || canvas.querySelector('.blk:focus-within:not(:has(.blk:focus-within))');
      canvas.querySelectorAll('.blk.tools-on').forEach((x) => { if (x !== pick) x.classList.remove('tools-on'); });
      pick?.classList.add('tools-on');
      // la barra no se sale del lienzo (en la última de varias columnas estrechas se desplaza hacia la izquierda)
      const bar = pick?.querySelector(':scope > .blk-tools');
      if (bar) {
        bar.style.left = '';
        const c = canvas.getBoundingClientRect(), r = bar.getBoundingClientRect(), over = r.right - (c.right - 8);
        if (over > 0) bar.style.left = Math.max(bar.offsetLeft - over, bar.offsetLeft - (r.left - (c.left + 8))) + 'px';
      }
    },
    wireTools() {
      const canvas = document.getElementById('ed-canvas');
      if (!canvas || canvas.dataset.toolsWired) return;
      canvas.dataset.toolsWired = '1';
      canvas.addEventListener('mouseover', (e) => {
        const blk = e.target.closest('.blk');
        // sobre la propia barra de un bloque, se queda la de ese bloque
        if (blk && canvas.contains(blk)) this.toolsOwner(blk);
      });
      canvas.addEventListener('mouseleave', () => this.toolsOwner(null));
      // pulsar una foto (o la zona de un bloque que no es texto) deja su barra fija; pulsar en un texto o fuera, la suelta
      canvas.addEventListener('mousedown', (e) => {
        const blk = e.target.closest('.blk');
        if (e.target.closest('.blk-tools')) return;
        const media = blk && e.target.closest('img, video, figure, .ph, .g-grid, .g-car, .mt-media') && !e.target.closest('.rt');
        this.pinned = media ? blk : null;
        canvas.querySelectorAll('.blk.pinned').forEach((x) => x.classList.toggle('pinned', x === this.pinned));
        if (this.pinned) { this.pinned.classList.add('pinned'); this.toolsOwner(this.pinned); }
      });
      canvas.addEventListener('focusin', () => { if (!canvas.querySelector('.blk:hover')) this.toolsOwner(null); });
    },
    focus(id, atEnd = false) {
      requestAnimationFrame(() => {
        const el = $(`.blk[data-id="${id}"] [contenteditable]`);
        if (!el) return;
        el.focus();
        if (atEnd) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      });
    },

    // --- Dibujo ----------------------------------------------------------------------
    // Pone el HTML en un menú flotante. Si el menú ya está abierto con la misma estructura, NO se reconstruye: solo se
    // copian las clases (opción marcada), valores y textos, así no parpadea ni se mueve al pulsar una opción.
    setPopHtml(el, html) {
      const visible = !el.classList.contains('hidden');
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      const a = [...el.querySelectorAll('*')], b = [...tmp.querySelectorAll('*')];
      const same = visible && a.length === b.length && a.every((x, i) => x.tagName === b[i].tagName);
      if (!same) { el.innerHTML = html; return false; }
      a.forEach((x, i) => {
        const y = b[i];
        if (x.className !== y.className) x.className = y.className;
        if ('disabled' in x && x.disabled !== y.disabled) x.disabled = y.hasAttribute('disabled');
        if (x.tagName === 'INPUT' && x !== document.activeElement && x.getAttribute('value') !== y.getAttribute('value')) { x.setAttribute('value', y.getAttribute('value') || ''); x.value = y.getAttribute('value') || ''; }
        if (x.tagName === 'OUTPUT' && x.textContent !== y.textContent) x.textContent = y.textContent;
        const st = y.getAttribute('style'); if (st !== x.getAttribute('style') && x.tagName !== 'INPUT') { if (st == null) x.removeAttribute('style'); else x.setAttribute('style', st); }
      });
      return true;
    },
    // Cambio que solo afecta a un bloque (opciones de estilo, menús del carrusel…): se vuelve a pintar solo ese bloque,
    // sin redibujar todo el editor ni cerrar el menú abierto (antes cada opción hacía parpadear la pantalla entera)
    repaintBlock(id) {
      const loc = this.locate(id), old = document.querySelector(`#d-blocks .blk[data-id="${CSS.escape(String(id))}"]`);
      if (!loc || !old) return false;
      const nu = this.block(loc.b, loc.i, loc.arr, loc.parent ? loc.parent.id : null);
      for (const c of ['tools-on', 'pinned']) if (old.classList.contains(c)) nu.classList.add(c);
      if (this.pinned === old) this.pinned = nu;
      old.replaceWith(nu);
      $$('img', nu).forEach((im) => { im.draggable = false; });
      window.FormatBar?.review();
      $('#ed-undo').disabled = !this.undo.length; $('#ed-redo').disabled = !this.redo.length;
      if (this.active && !document.contains(this.active.el)) { this.active = null; window.FormatBar?.update(); }
      if (this.pop && !this.popLock) this.openStyle(this.pop.id, true);
      return true;
    },
    changeBlock(id, fn) {
      this.snapshot();
      fn();
      if (!this.repaintBlock(id)) this.render();
      this.onChange();
    },
    render() {
      $('#dd-pop')?.classList.add('hidden');
      this.renderCover();
      const wrap = $('#d-blocks');
      wrap.innerHTML = '';
      wrap.appendChild(this.inserter(0));
      this.draft.blocks.forEach((b, i) => { wrap.appendChild(this.block(b, i)); wrap.appendChild(this.inserter(i + 1)); });
      if (!this.draft.blocks.length) {
        const empty = document.createElement('div'); empty.className = 'blk-empty';
        empty.innerHTML = `<span class="ms">add_circle</span>${t('Pulsa + para añadir un bloque o arrastra aquí una foto')}`;
        wrap.appendChild(empty);
      }
      // las imágenes no se arrastran «como archivo» (lo hace su contenedor)
      $$('#editor img').forEach((im) => { im.draggable = false; });
      window.FormatBar?.review();
      $('#ed-undo').disabled = !this.undo.length; $('#ed-redo').disabled = !this.redo.length;
      this.renderMedia();
      if (this.active && !document.contains(this.active.el)) { this.active = null; window.FormatBar?.update(); }
      if (this.pop && !this.popLock) this.openStyle(this.pop.id, true);
    },

    // --- Arrastrar fotos ---------------------------------------------------------------
    // drag = { kind: 'media', media } desde la bandeja · { kind: 'photo', block, index } desde un bloque
    //        (index: posición en galería/carrusel; null en imagen e imagen y texto) · { kind: 'block', id }
    isPhoto(d) { return !!d && (d.kind === 'photo' ? this.peek(d)?.type !== 'video' : d.kind === 'media' && d.media.type !== 'video'); },
    // foto o vídeo (para galerías y mosaicos)
    isItem(d) { return !!d && (d.kind === 'photo' || d.kind === 'media'); },
    peek(d) {
      if (d.kind === 'media') return { ...d.media };
      const b = this.locate(d.block)?.b;
      return b ? (d.index == null ? b.img : b.images[d.index]) : null;
    },
    // Saca la foto de donde estaba (si viene de un bloque) y la devuelve; llamar dentro de change()
    take(d) {
      if (d.kind === 'media') {
        const { type, poster, ...m } = d.media;
        return type === 'video' ? { ...m, type: 'video', ...(poster ? { poster } : {}) } : { ...m, alt: m.alt || '' };
      }
      const loc = this.locate(d.block);
      const b = loc?.b;
      if (!b) return null;
      if (d.index != null) return b.images.splice(d.index, 1)[0];
      const img = b.img;
      if (b.type === 'image') loc.arr.splice(loc.i, 1); else b.img = null;
      return img;
    },
    // Hace que un elemento acepte fotos soltadas; onDrop(img) se ejecuta ya dentro de change()
    acceptPhoto(el, onDrop, { sameOk = () => true, video = false } = {}) {
      const ok = (d) => (video ? this.isItem(d) : this.isPhoto(d)) && sameOk(d);
      el.addEventListener('dragover', (e) => { if (ok(drag)) { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); } });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
      el.addEventListener('drop', (e) => {
        el.classList.remove('over');
        if (!ok(drag)) return;
        e.preventDefault(); e.stopPropagation();
        const d = drag; drag = null; endDrag();
        this.change(() => { const img = this.take(d); if (img) onDrop(img, d); });
      });
    },

    // Soltar una foto DENTRO de un párrafo: el párrafo se parte por el final de la frase más cercana y la foto queda
    // entre las dos partes (si estaba a un lado del texto, el texto que sigue la rodea). Una línea marca dónde caerá.
    splitPoint(rt, x, y) {
      const txt = rt.textContent || '';
      let node = null, off = 0;
      if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r && rt.contains(r.startContainer)) { node = r.startContainer; off = r.startOffset; } }
      if (!node) return null;
      // posición del cursor en el texto plano
      let pos = 0;
      const w = document.createTreeWalker(rt, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { if (n === node) { pos += off; break; } pos += n.length; }
      // fronteras: inicio, final y después de cada «. », «! », «? », «… » o «: »
      const marks = [0, txt.length];
      const re = /[.!?…:]["»”')\]]*\s+/g;
      for (let m = re.exec(txt); m; m = re.exec(txt)) marks.push(m.index + m[0].length);
      let best = 0;
      for (const k of marks) if (Math.abs(k - pos) < Math.abs(best - pos)) best = k;
      return { at: best, len: txt.length };
    },
    // rango DOM en la posición «at» del texto plano
    rangeAt(rt, at) {
      const r = document.createRange();
      let acc = 0;
      const w = document.createTreeWalker(rt, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (acc + n.length >= at) { r.setStart(n, Math.max(0, at - acc)); r.collapse(true); return r; }
        acc += n.length;
      }
      r.selectNodeContents(rt); r.collapse(false); return r;
    },
    acceptSplitDrop(el, rt, b) {
      const okDrag = () => {
        if (!drag) return false;
        if (drag.kind === 'block') { const src = this.locate(drag.id)?.b; return !!src && src.type === 'image' && src.id !== b.id; }
        return this.isPhoto(drag);
      };
      let mark = null;
      const clear = () => { mark?.remove(); mark = null; el.classList.remove('split-over'); };
      el.addEventListener('dragover', (e) => {
        if (!okDrag() || e.target.closest('.blk') !== el) return;
        e.preventDefault(); e.stopPropagation();
        const sp = this.splitPoint(rt, e.clientX, e.clientY);
        if (!sp) return;
        const rr = sp.at >= sp.len ? null : this.rangeAt(rt, sp.at).getClientRects()[0];
        const box = el.getBoundingClientRect(), rb = rt.getBoundingClientRect();
        if (!mark) { mark = document.createElement('div'); mark.className = 'split-mark'; el.appendChild(mark); }
        el.classList.add('split-over');
        // línea horizontal en el punto donde se partirá (al principio o al final: borde del párrafo)
        const top = sp.at <= 0 ? rb.top - 4 : sp.at >= sp.len || !rr ? rb.bottom + 2 : rr.top - 2;
        Object.assign(mark.style, { top: Math.round(top - box.top) + 'px', left: Math.round(rb.left - box.left) + 'px', width: Math.round(rb.width) + 'px' });
        mark.dataset.where = sp.at <= 0 ? 'antes' : sp.at >= sp.len ? 'después' : 'frase';
      });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) clear(); });
      el.addEventListener('drop', (e) => {
        if (!okDrag() || e.target.closest('.blk') !== el) return;
        e.preventDefault(); e.stopPropagation();
        const sp = this.splitPoint(rt, e.clientX, e.clientY);
        clear();
        const d = drag; drag = null; endDrag();
        if (!sp) return;
        // texto antes y después del punto (conservando negritas, enlaces…)
        const r = this.rangeAt(rt, sp.at);
        const pre = document.createRange(); pre.selectNodeContents(rt); pre.setEnd(r.startContainer, r.startOffset);
        const post = document.createRange(); post.selectNodeContents(rt); post.setStart(r.startContainer, r.startOffset);
        const html = (rg) => { const dv = document.createElement('div'); dv.appendChild(rg.cloneContents()); return dv.innerHTML.replace(/^(\s|&nbsp;|<br>)+|(\s|&nbsp;|<br>)+$/g, ''); };
        const before = sp.at <= 0 ? '' : html(pre), after = sp.at >= sp.len ? '' : html(post);
        this.change(() => {
          // la foto: si viene de un bloque de imagen, se mueve el bloque entero (conserva lado, tamaño y estilo)
          let imgBlock = null;
          const srcId = d.kind === 'block' ? d.id : d.kind === 'photo' && d.index == null && this.locate(d.block)?.b.type === 'image' ? d.block : null;
          if (srcId) { const from = this.locate(srcId); if (from) imgBlock = from.arr.splice(from.i, 1)[0]; }
          else { const it = this.take(d); if (it) imgBlock = this.create('image', { img: it, align: 'left', width: 50 }); }
          if (!imgBlock) return;
          const loc = this.locate(b.id);
          if (!loc) return;
          const parts = [];
          if (before) parts.push({ ...b, html: before });
          parts.push(imgBlock);
          if (after) parts.push(before ? this.create('paragraph', { ...Object.fromEntries(Object.entries(b).filter(([k]) => !['id', 'html', 'type'].includes(k))), html: after }) : { ...b, html: after });
          loc.arr.splice(loc.i, 1, ...parts);
        });
      });
    },

    // Portada (imagen destacada) encima del título: se suelta aquí una foto para elegirla
    renderCover() {
      const box = $('#d-cover');
      if (!box) return;
      const all = [...this.draft.blocks.flatMap((b) => (b.img ? [b.img] : b.images || [])), ...this.media];
      const img = all.find((x) => x.id === this.draft.featuredImageId);
      box.className = 'cover' + (img ? ' has' : '');
      box.innerHTML = img
        ? `<img src="${esc(img.url)}" alt=""><span class="cover-tag"><span class="ms fill">star</span>${t('Imagen destacada')}</span><button class="cover-del" title="${t('Quitar imagen destacada')}"><span class="ms">close</span></button>`
        : `<span class="ms">add_photo_alternate</span>${t('Arrastra aquí la imagen destacada (se quita del cuerpo)')}`;
      $('.cover-del', box)?.addEventListener('click', () => this.change(() => { this.draft.featuredImageId = null; this.draft.noAutoFeatured = true; }));
      if (!box.dataset.wired) {
        box.dataset.wired = '1';
        // a la portada se copia la foto (no se saca de donde está)
        box.addEventListener('dragover', (e) => { if (this.isPhoto(drag)) { e.preventDefault(); box.classList.add('over'); } });
        box.addEventListener('dragleave', () => box.classList.remove('over'));
        box.addEventListener('drop', (e) => {
          box.classList.remove('over');
          if (!this.isPhoto(drag)) return;
          e.preventDefault();
          const d = drag; drag = null; endDrag();
          this.change(() => { const img = this.take(d); if (img) { this.draft.featuredImageId = img.id; this.draft.keepFeaturedInBody = false; this.liftFeatured(); } });
        });
      }
    },

    // Línea con «+» entre bloques; también recibe fotos y bloques arrastrados.
    // arr: la lista donde se inserta (la de la entrada o la de dentro de una sección o columna) · owner: id del contenedor
    inserter(i, arr = this.draft.blocks, owner = null) {
      const el = document.createElement('div');
      el.className = 'ins';
      el.innerHTML = `<button class="ins-btn" title="${t('Añadir bloque')}"><span class="ms">add</span></button>`;
      el.querySelector('button').onclick = (e) => this.openMenu(e.currentTarget, (type, list) => (list ? this.insertList(i, list, arr) : this.insertAt(i, this.create(type), true, arr)));
      // un contenedor no puede entrar en sí mismo
      const ok = () => drag && !(drag.kind === 'block' && owner && this.within(drag.id, owner));
      el.ondragover = (e) => { if (ok()) { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); } };
      el.ondragleave = () => el.classList.remove('over');
      el.ondrop = (e) => {
        e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
        const d = drag; drag = null; endDrag();
        if (!d || (d.kind === 'block' && owner && this.within(d.id, owner))) return;
        // posición estable: el bloque que estaba justo después de la línea (puede moverse al sacar la foto)
        const after = arr[i]?.id;
        const at = () => (after ? arr.findIndex((b) => b.id === after) : arr.length);
        if (d.kind === 'block') {
          const from = this.locate(d.id);
          if (!from || (from.arr === arr && (from.i === i || from.i === i - 1))) return;
          this.change(() => { const [b] = from.arr.splice(from.i, 1); arr.splice(at(), 0, b); });
        } else if (d.kind === 'media' && d.media.type === 'video') {
          this.change(() => arr.splice(at(), 0, this.create('video', { video: d.media })));
        } else {
          // foto de la bandeja o sacada de un bloque → bloque de imagen propio en esa posición
          this.change(() => {
            const it = this.take(d);
            if (!it) return;
            if (it.type === 'video') { const { type, ...video } = it; arr.splice(at(), 0, this.create('video', { video })); } else arr.splice(at(), 0, this.create('image', { img: it }));
          });
        }
      };
      return el;
    },

    // Lista de bloques con sus «+» (la de la entrada, o la de dentro de una sección o columna)
    list(arr, owner) {
      const wrap = document.createElement('div');
      wrap.className = 'blocks nested' + (arr.length ? '' : ' empty');
      const first = this.inserter(0, arr, owner);
      if (!arr.length) first.dataset.label = t('Añade bloques aquí');
      wrap.appendChild(first);
      arr.forEach((b, i) => { wrap.appendChild(this.block(b, i, arr, owner)); wrap.appendChild(this.inserter(i + 1, arr, owner)); });
      return wrap;
    },

    openMenu(anchor, pick) {
      const menu = $('#ins-menu');
      const r = anchor.getBoundingClientRect();
      menu.classList.toggle('page', this.draft?.type === 'page');
      menu.classList.remove('hidden');
      const h = menu.offsetHeight;
      menu.style.left = Math.min(innerWidth - menu.offsetWidth - 12, Math.max(12, r.left - 120)) + 'px';
      menu.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.bottom + h + 12 > innerHeight ? r.top - h - 6 : r.bottom + 6)) + 'px';
      $$('button', menu).forEach((b) => (b.onclick = () => {
        menu.classList.add('hidden');
        // «Secciones listas»: abre la galería y devuelve los bloques ya maquetados
        if (b.dataset.type === 'sections') { window.SectionsUI?.open().then((list) => { if (list && list.length) pick('sections', list); }); return; }
        pick(b.dataset.type);
      }));
      setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!menu.contains(e.target)) { menu.classList.add('hidden'); document.removeEventListener('mousedown', off); } }), 0);
    },

    block(b, i, arr = this.draft.blocks, owner = null) {
      const T = TYPES()[b.type] || { icon: 'help', name: b.type };
      const el = document.createElement('div');
      el.className = `blk blk-${b.type}` + (['group', 'columns', 'cover'].includes(b.type) ? ' blk-box' : '') + (b.type === 'image' && b.align ? ` img-${b.align} imgw-${b.width || 50}` : '') + (this.pop?.id === b.id ? ' sty-open' : '');
      if (b.type === 'image' && b.w) el.style.width = b.w;
      el.dataset.id = b.id;
      el.innerHTML = `
        <div class="blk-tools">
          <span class="blk-handle" draggable="true" title="${t('Arrastra para mover')}"><span class="ms">drag_indicator</span></span>
          <span class="blk-type"><span class="ms">${T.icon}</span>${esc(T.name)}</span>
          <span class="blk-extra"></span>
          <span class="spacer"></span>
          <button data-a="up" title="${t('Subir')}" ${i === 0 ? 'disabled' : ''}><span class="ms">arrow_upward</span></button>
          <button data-a="down" title="${t('Bajar')}" ${i === arr.length - 1 ? 'disabled' : ''}><span class="ms">arrow_downward</span></button>
          ${owner ? `<button data-a="out" title="${t('Sacar del contenedor')}"><span class="ms">north_west</span></button>` : ''}
          <button data-a="dup" title="${t('Duplicar')}"><span class="ms">content_copy</span></button>
          <button data-a="del" title="${t('Eliminar bloque')}"><span class="ms">delete</span></button>
        </div>
        <div class="blk-body"></div>`;
      const act = {
        up: () => this.change(() => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; }),
        down: () => this.change(() => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; }),
        dup: () => this.change(() => arr.splice(i + 1, 0, this.cloneBlock(b))),
        del: () => this.change(() => arr.splice(i, 1)),
        // sacarlo del contenedor: va justo debajo de él
        out: () => { const par = this.locate(owner); if (par) this.change(() => { arr.splice(i, 1); par.arr.splice(par.i + 1, 0, b); }); },
      };
      $$('.blk-tools [data-a]', el).forEach((btn) => (btn.onclick = act[btn.dataset.a]));
      const handle = $('.blk-handle', el);
      handle.ondragstart = (e) => { drag = { kind: 'block', id: b.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ecos', 'block'); ghost(e, `<span class="ms">${T.icon}</span>${esc(T.name)}`); startDrag(el, 'dragging-block'); };
      handle.ondragend = () => { drag = null; endDrag(); };
      // Un bloque arrastrado con el asa también se puede soltar ENCIMA de otro bloque: va antes o después de él según
      // la mitad en la que se suelte (antes solo valía la línea fina entre bloques y parecía que el asa no hacía nada)
      const canDropBlock = (e) => {
        if (!drag || drag.kind !== 'block' || drag.id === b.id || e.target.closest('.blk') !== el) return false;
        if (this.within(drag.id, b.id)) return false; // un contenedor no entra en sí mismo
        const src = this.locate(drag.id)?.b;
        return !(b.type === 'paragraph' && src?.type === 'image'); // foto sobre un párrafo: lo parte (acceptSplitDrop)
      };
      const sideOf = (e) => { const r = el.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
      const unmark = () => el.classList.remove('drop-before', 'drop-after');
      el.addEventListener('dragover', (e) => {
        if (!canDropBlock(e)) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
        const after = sideOf(e);
        el.classList.toggle('drop-before', !after); el.classList.toggle('drop-after', after);
      });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) unmark(); });
      el.addEventListener('drop', (e) => {
        if (!canDropBlock(e)) { unmark(); return; }
        e.preventDefault(); e.stopPropagation();
        const after = sideOf(e), id = drag.id;
        unmark(); drag = null; endDrag();
        this.change(() => {
          const from = this.locate(id);
          if (!from) return;
          const [mv] = from.arr.splice(from.i, 1);
          const to = this.locate(b.id);
          if (!to) { from.arr.splice(from.i, 0, mv); return; }
          to.arr.splice(to.i + (after ? 1 : 0), 0, mv);
        });
      });
      this.body(b, i, $('.blk-body', el), $('.blk-extra', el), arr);
      return el;
    },

    // Texto editable con negrita, cursiva y enlaces (Ctrl+B, Ctrl+I, Ctrl+K)
    editable(tag, html, placeholder, onInput, opts = {}) {
      const el = document.createElement(tag);
      el.contentEditable = 'true'; el.className = 'rt' + (opts.cls ? ' ' + opts.cls : ''); el.dataset.ph = placeholder;
      el.innerHTML = html || '';
      let snap = false;
      el.oninput = () => { if (!snap) { this.snapshot(); snap = true; } onInput(el.innerHTML); this.onChange(); if (opts.block?.type === 'heading') this.refreshToc(); };
      el.onblur = () => { snap = false; };
      el.onfocus = () => { if (opts.block) this.setActive(opts.block, el, opts.styleEl); };
      el.onpaste = (e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        const url = text.trim();
        const sel = getSelection();
        // Un enlace pegado sobre texto seleccionado lo convierte en enlace
        if (/^https?:\/\/\S+$/i.test(url) && sel.rangeCount && !sel.isCollapsed) { document.execCommand('createLink', false, url); return; }
        // Un enlace de vídeo pegado en un párrafo vacío se convierte en el vídeo
        const emb = opts.block?.type === 'paragraph' && !el.textContent.trim() ? detectEmbed(url) : null;
        if (emb) { this.replaceBlock(opts.block, emb.file ? this.create('video', { video: { url: emb.url } }) : this.create('embed', { url: emb.url, provider: emb.provider })); return; }
        document.execCommand('insertText', false, text);
      };
      el.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); window.FormatBar?.link(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') { e.preventDefault(); document.execCommand('underline'); return; }
        if (opts.block?.type === 'paragraph' && this.shortcut(e, el, opts.block)) return;
        opts.onKey?.(e, el);
      };
      return el;
    },

    // --- Bloque activo (para la barra de formato) ------------------------------------------
    active: null,
    setActive(b, el, styleEl) { this.active = { b, el, styleEl: styleEl || el }; window.FormatBar?.update(); },
    replaceBlock(b, nb, focus = true) {
      const loc = this.locate(b.id);
      if (!loc) return;
      this.change(() => loc.arr.splice(loc.i, 1, nb));
      if (focus) this.focus(nb.id);
    },
    // Atajos al estilo Markdown al principio de un párrafo: «## », «- », «1. », «> », «---» y «/» para el menú
    shortcut(e, el, b) {
      const txt = el.textContent;
      if (e.key === '/' && !txt.trim()) {
        e.preventDefault();
        this.openMenu(el, (type, list) => (list ? this.change(() => { const loc = this.locate(b.id); if (loc) loc.arr.splice(loc.i, 1, ...list); }) : this.replaceBlock(b, this.create(type))));
        return true;
      }
      if (e.key === 'Enter' && /^\s*(---|\*\*\*)\s*$/.test(txt)) { e.preventDefault(); this.replaceBlock(b, this.create('separator'), false); return true; }
      if (e.key !== ' ') return false;
      const sel = getSelection();
      if (!sel.rangeCount) return false;
      const r = document.createRange(); r.selectNodeContents(el); r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
      const before = r.toString();
      const map = { '#': ['heading', { level: 2 }], '##': ['heading', { level: 2 }], '###': ['heading', { level: 3 }], '####': ['heading', { level: 4 }],
        '-': ['list', {}], '*': ['list', {}], '1.': ['list', { ordered: true }], '>': ['quote', {}] };
      const hit = map[before];
      if (!hit) return false;
      e.preventDefault();
      const rest = el.innerHTML.replace(/^(\s|&nbsp;)*(#{1,4}|-|\*|1\.|&gt;)/, '').trim();
      const nb = this.create(hit[0], hit[1]);
      if (hit[0] === 'list') nb.items = [rest]; else nb.html = rest;
      this.replaceBlock(b, nb);
      return true;
    },
    // Convierte un bloque de texto en otro tipo conservando el texto y su estilo
    convert(b, type, extra = {}) {
      const text = b.type === 'list' ? (b.items || []).join('<br>') : b.html || '';
      const nb = this.create(type, extra);
      for (const k of ['align', 'size', 'font', 'color', 'bg', 'shadow', 'spacing']) if (b[k]) nb[k] = b[k];
      if (type === 'list') nb.items = b.type === 'list' ? b.items : text.split(/<br\s*\/?>/i).filter((x) => x.replace(/<[^>]+>/g, '').trim()).concat(text ? [] : ['']);
      else nb.html = text;
      if (type === 'list' && !nb.items.length) nb.items = [''];
      if (type === 'quote' && b.type === 'quote') { nb.cite = b.cite; }
      this.replaceBlock(b, nb);
    },
    refreshToc() {
      const heads = this.flat().filter((h) => h.type === 'heading' && (h.level || 2) <= 3 && (h.html || '').replace(/<[^>]+>/g, '').trim());
      $$('.toc-list').forEach((ul) => {
        ul.innerHTML = heads.length ? heads.map((h) => `<li class="lvl${h.level || 2}">${esc(h.html.replace(/<[^>]+>/g, ''))}</li>`).join('')
          : `<li class="hint">${t('Añade títulos (H2 o H3) y aparecerán aquí.')}</li>`;
      });
    },
    // Palabras y tiempo de lectura
    stats() {
      const words = this.plainText().split(/\s+/).filter(Boolean).length;
      return { words, minutes: Math.max(1, Math.round(words / 200)) };
    },

    body(b, i, body, extra, arr = this.draft.blocks) {
      const self = this;
      const textBlock = (tag, cls) => this.editable(tag, b.html, b.ph ? t(b.ph) : b.type === 'paragraph' ? t('Escribe aquí… (pulsa / para elegir un bloque)') : t('Escribe aquí…'), (h) => (b.html = h), {
        cls, block: b,
        onKey(e, el) {
          // Intro al final de un párrafo crea otro; Retroceso en un bloque vacío lo borra
          if (b.type === 'paragraph' && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            self.insertAt(i + 1, self.create('paragraph'), true, arr);
          }
          if (e.key === 'Backspace' && !el.textContent.trim() && arr.length > 1 && ['paragraph', 'heading'].includes(b.type)) {
            e.preventDefault();
            const prev = arr[i - 1];
            self.change(() => arr.splice(i, 1));
            if (prev) self.focus(prev.id, true);
          }
        },
      });

      switch (b.type) {
        case 'paragraph': { const p = textBlock('p'); applyStyle(p, b); body.appendChild(p); this.acceptSplitDrop(body.parentElement, p, b); break; }

        case 'heading': {
          const h = textBlock('h' + b.level, 'h'); applyStyle(h, b);
          body.appendChild(h);
          extra.innerHTML = [2, 3, 4, 5].map((l) => `<button class="lv ${b.level === l ? 'on' : ''}" data-l="${l}">H${l}</button>`).join('');
          $$('.lv', extra).forEach((x) => (x.onclick = () => this.change(() => (b.level = Number(x.dataset.l)))));
          break;
        }

        case 'quote': {
          const q = document.createElement('blockquote');
          if (b.pull) q.className = 'pull';
          const qp = this.editable('p', b.html, (b.ph ? t(b.ph) : '') || t('Escribe aquí…'), (h) => (b.html = h), { cls: '', block: b, styleEl: q });
          q.appendChild(qp);
          q.appendChild(this.editable('cite', b.cite, t('Autor o fuente (opcional)'), (h) => (b.cite = h), { block: b, styleEl: q }));
          applyStyle(q, b);
          body.appendChild(q);
          extra.innerHTML = `<button class="lv ${!b.pull ? 'on' : ''}" data-p="0" title="${t('Cita normal')}"><span class="ms">format_quote</span></button><button class="lv ${b.pull ? 'on' : ''}" data-p="1" title="${t('Cita destacada (grande y centrada)')}"><span class="ms">format_quote</span>+</button>`;
          $$('[data-p]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.pull = x.dataset.p === '1'))));
          break;
        }

        case 'list': {
          const iconic = Array.isArray(b.icons);
          const list = document.createElement(iconic ? 'div' : b.ordered ? 'ol' : 'ul');
          if (iconic) list.className = 'ed-ilist';
          b.items.forEach((it, k) => {
            const li = this.editable(iconic ? 'div' : 'li', it, (b.ph ? t(b.ph) : '') || t('Elemento'), (h) => (b.items[k] = h), {
              block: b, styleEl: list,
              onKey(e, el) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.change(() => { b.items.splice(k + 1, 0, ''); if (iconic) b.icons.splice(k + 1, 0, b.icons[k] || SK().ICONS[0]); }); requestAnimationFrame(() => $$(`.blk[data-id="${b.id}"] .rt`)[k + 1]?.focus()); }
                if (e.key === 'Backspace' && !el.textContent.trim() && b.items.length > 1) { e.preventDefault(); self.change(() => { b.items.splice(k, 1); if (iconic) b.icons.splice(k, 1); }); }
              },
            });
            if (!iconic) { list.appendChild(li); return; }
            // con iconos: cada elemento lleva su símbolo, que se cambia pulsándolo
            const row = document.createElement('div');
            row.className = 'ed-irow';
            const ib = document.createElement('button');
            ib.type = 'button'; ib.className = 'ed-ico'; ib.textContent = b.icons[k] || '•'; ib.title = t('Elegir el icono');
            ib.onclick = () => this.iconPop(ib, (sym) => this.change(() => { b.icons[k] = sym; }));
            row.append(ib, li);
            list.appendChild(row);
          });
          applyStyle(list, b);
          body.appendChild(list);
          extra.innerHTML = iconic
            ? `<button class="lv on" data-ic="0" title="${t('Quitar los iconos')}"><span class="ms">checklist</span></button>`
            : `<button class="lv ${!b.ordered ? 'on' : ''}" data-o="0"><span class="ms">format_list_bulleted</span></button><button class="lv ${b.ordered ? 'on' : ''}" data-o="1"><span class="ms">format_list_numbered</span></button><span class="lv-sep"></span><button class="lv" data-ic="1" title="${t('Poner un icono en cada elemento')}"><span class="ms">checklist</span></button>`;
          $$('[data-o]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.ordered = x.dataset.o === '1'))));
          $$('[data-ic]', extra).forEach((x) => (x.onclick = () => this.change(() => { if (x.dataset.ic === '1') { b.icons = b.items.map(() => SK().ICONS[0]); b.ordered = false; } else delete b.icons; })));
          break;
        }

        case 'image': {
          if (!b.img) { body.appendChild(this.dropZone(t('Arrastra aquí una foto'), (m) => this.change(() => (b.img = { ...m })))); this.acceptPhoto(body, (img) => (b.img = img)); break; }
          const fig = document.createElement('figure');
          const ph = this.photo(b.img, () => this.change(() => arr.splice(arr.indexOf(b), 1)), b);
          this.imgLook(ph, b);
          ph.appendChild(this.resizeHandle(b, body));
          fig.appendChild(ph);
          fig.appendChild(this.editable('figcaption', b.caption, t('Pie de foto (opcional)'), (h) => (b.caption = h), { block: b }));
          body.appendChild(fig);
          // soltar otra foto sobre esta imagen las junta en una galería
          this.acceptPhoto(body, (img) => { b.type = 'gallery'; b.images = [b.img, img]; b.columns = 2; delete b.img; delete b.caption; },
            { sameOk: (d) => !(d.kind === 'photo' && d.block === b.id) });
          // Barra: colocación (a todo el ancho, a un lado con el texto alrededor, o centrada) · tamaño · «Estilo» (recorte, marco, efecto)
          const place = b.align || 'full';
          extra.innerHTML = [['full', 'crop_landscape', t('A todo el ancho')], ['left', 'format_image_left', t('A la izquierda, con el texto alrededor')], ['center', 'format_align_center', t('Centrada')], ['right', 'format_image_right', t('A la derecha, con el texto alrededor')]]
            .map(([k, ic, n]) => `<button class="lv ${place === k ? 'on' : ''}" data-al="${k}" title="${n}"><span class="ms">${ic}</span></button>`).join('')
            + (place !== 'full' ? '<span class="lv-sep"></span>' + [[33, t('Pequeña')], [50, t('Mediana')], [75, t('Grande')]]
              .map(([w, n]) => `<button class="lv ${!b.w && (b.width || 50) === w ? 'on' : ''}" data-w="${w}" title="${n}">${n}</button>`).join('') : '');
          $$('[data-al]', extra).forEach((x) => (x.onclick = () => {
            let moved = false;
            this.change(() => {
              if (x.dataset.al === 'full') { delete b.align; delete b.width; delete b.w; return; }
              b.align = x.dataset.al; if (!b.w) b.width = b.width || 50;
              // el texto que rodea la foto es el que va DESPUÉS de ella: si el texto está justo antes, se sube la foto
              if (x.dataset.al !== 'center') {
                const loc = this.locate(b.id), TXT = ['paragraph', 'heading', 'list', 'quote'];
                if (loc && loc.i > 0 && TXT.includes(loc.arr[loc.i - 1].type) && !TXT.includes(loc.arr[loc.i + 1]?.type)) {
                  loc.arr.splice(loc.i, 1); loc.arr.splice(loc.i - 1, 0, b); moved = true;
                }
              }
            });
            if (moved) toast(t('He puesto la foto antes del texto para que el texto la rodee. El texto que quieras a su lado tiene que ir justo debajo de la foto.'));
          }));
          $$('[data-w]', extra).forEach((x) => (x.onclick = () => this.change(() => { b.width = Number(x.dataset.w); delete b.w; })));
          // foto a un lado con un párrafo justo debajo: se puede juntar con él en un bloque «Imagen y texto»
          const nx = (b.align === 'left' || b.align === 'right') ? this.locate(b.id) : null;
          if (nx && nx.arr[nx.i + 1]?.type === 'paragraph') {
            extra.insertAdjacentHTML('beforeend', `<span class="lv-sep"></span><button class="lv" data-join="1" title="${t('Junta la foto y el párrafo de debajo en un bloque «Imagen y texto»')}"><span class="ms">vertical_split</span><span class="lbl">${t('Juntar con el texto')}</span></button>`);
            $('[data-join]', extra).onclick = () => this.joinWithText(b);
          }
          this.styleBtn(extra, b);
          break;
        }

        case 'gallery': case 'carousel': {
          const grid = document.createElement('div');
          grid.className = b.type === 'gallery' ? 'g-grid' + (b.layout === 'mosaic' ? ' mosaic' : '') : `g-car v-${b.view || 'single'}`;
          if (b.type === 'carousel') this.carLook(grid, b);
          if (b.type === 'gallery') grid.style.setProperty('--cols', b.columns);
          const vids = b.type === 'gallery'; // los vídeos van en galerías y mosaicos (el carrusel de la web solo muestra fotos)
          const cells = b.layout === 'mosaic' && b.type === 'gallery' ? window.Mosaic.mosaicLayout(b.images.length).cells : null;
          b.images.forEach((img, k) => {
            const ph = this.photo(img, () => this.change(() => b.images.splice(k, 1)), b, k);
            if (cells) Object.assign(ph.style, { gridColumn: `${cells[k].col} / span ${cells[k].cols}`, gridRow: `${cells[k].row} / span ${cells[k].rows}` });
            grid.appendChild(ph);
          });
          const add = this.dropZone(b.images.length ? (vids ? t('Suelta más fotos o vídeos aquí') : t('Suelta más fotos aquí')) : (vids ? t('Arrastra aquí fotos o vídeos') : t('Arrastra aquí fotos')),
            (m) => this.change(() => b.images.push(this.take({ kind: 'media', media: m }))), true, vids ? 'any' : 'image');
          grid.appendChild(add);
          body.appendChild(grid);
          this.acceptPhoto(body, (img) => b.images.push(img), { video: vids }); // soltar en un hueco: al final
          // Colocación: cuadrícula (con columnas), mosaico o carrusel
          const lay = b.type === 'carousel' ? 'carousel' : b.layout === 'mosaic' ? 'mosaic' : 'grid';
          extra.innerHTML = [['grid', 'grid_view', t('Cuadrícula')], ['mosaic', 'dashboard', t('Mosaico')], ['carousel', 'view_carousel', t('Carrusel')]]
            .map(([k, ic, n]) => `<button class="lv ${lay === k ? 'on' : ''}" data-lay="${k}" title="${n}"><span class="ms">${ic}</span><span class="lbl">${n}</span></button>`).join('')
            + (lay === 'grid' ? '<span class="lv-sep"></span>' + [2, 3, 4].map((c) => `<button class="lv ${b.columns === c ? 'on' : ''}" data-c="${c}" title="${t('{n} columnas', { n: c })}">${c}<span class="ms">view_column</span></button>`).join('') : '')
            // estilo del carrusel
            + (lay === 'carousel' ? '<span class="lv-sep"></span>' + [['single', 'crop_landscape', t('Una a una')], ['multi', 'view_week', t('Varias a la vez')], ['peek', 'view_carousel', t('Vecinas asomando')]]
              .map(([k, ic, n]) => `<button class="lv ${(b.view || 'single') === k ? 'on' : ''}" data-view="${k}" title="${n}"><span class="ms">${ic}</span><span class="lbl">${n}</span></button>`).join('')
              + (b.view === 'peek' ? `<button class="lv" data-peekcss="1" title="${t('Copia el estilo que hay que pegar una vez en tu web')}"><span class="ms">palette</span><span class="lbl">${t('Estilo para la web')}</span></button>` : '') : '');
          $$('[data-c]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.columns = Number(x.dataset.c)))));
          $$('[data-view]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.view = x.dataset.view))));
          if (lay === 'carousel') this.carMenus(extra, b);
          $$('[data-peekcss]', extra).forEach((x) => (x.onclick = () => this.onPeekCss?.()));
          $$('[data-lay]', extra).forEach((x) => (x.onclick = () => this.change(() => {
            const k = x.dataset.lay;
            if (k === 'carousel') {
              // los vídeos no caben en el carrusel: salen como bloques de vídeo justo después
              const vs = b.images.filter((i) => i.type === 'video');
              if (vs.length) {
                b.images = b.images.filter((i) => i.type !== 'video');
                const loc = this.locate(b.id);
                loc.arr.splice(loc.i + 1, 0, ...vs.map(({ type, ...video }) => this.create('video', { video })));
                toast(t('Los vídeos no van en el carrusel: se han puesto debajo como bloques de vídeo.'));
              }
              b.type = 'carousel';
            } else { b.type = 'gallery'; b.layout = k; b.columns = b.columns || 3; }
          })));
          break;
        }

        case 'mediatext': {
          const mw = this.mtWidth(b);
          const row = document.createElement('div');
          row.className = 'mt' + (b.right ? ' right' : '') + (b.fill ? ' fill' : '') + (b.valign === 'top' || b.valign === 'bottom' ? ' va-' + b.valign : '');
          row.style.setProperty('--mtw', mw + '%');
          const side = document.createElement('div');
          side.className = 'mt-media';
          if (b.img) {
            const ph = this.photo(b.img, () => this.change(() => (b.img = null)), b);
            this.imgLook(ph, b.fill ? { ...b, ratio: null } : b);
            const wrap = document.createElement("div"); wrap.className = "mt-phwrap"; wrap.appendChild(ph); side.appendChild(wrap);
          } else side.appendChild(this.dropZone(t('Arrastra una foto'), (m) => this.change(() => (b.img = { ...m }))));
          this.acceptPhoto(side, (img) => (b.img = img), { sameOk: (d) => !(d.kind === 'photo' && d.block === b.id) });
          const text = this.editable('div', b.html, t('Texto junto a la imagen…'), (h) => (b.html = h), { cls: 'mt-text', block: b });
          applyStyle(text, b);
          row.append(side, text);
          if (b.img) row.appendChild(this.mtSplit(b, row));
          body.appendChild(row);
          const on = (c) => (c ? 'on' : '');
          extra.innerHTML = [[false, 'format_image_left', t('Imagen a la izquierda')], [true, 'format_image_right', t('Imagen a la derecha')]]
            .map(([r, ic, n]) => `<button class="lv ${on(!!b.right === r)}" data-side="${r ? 1 : 0}" title="${n}"><span class="ms">${ic}</span></button>`).join('')
            + '<span class="lv-sep"></span>'
            + MT_SIZES.map((w) => `<button class="lv ${on(mw === w)}" data-mw="${w}" title="${t('La imagen ocupa el {n} % del ancho', { n: w })}">${w}%</button>`).join('')
            + '<span class="lv-sep"></span>'
            + [['top', 'vertical_align_top', t('Texto arriba')], ['center', 'vertical_align_center', t('Texto en el centro')], ['bottom', 'vertical_align_bottom', t('Texto abajo')]]
              .map(([k, ic, n]) => `<button class="lv ${on((b.valign || 'center') === k)}" data-va="${k}" title="${n}"><span class="ms">${ic}</span></button>`).join('')
            + `<button class="lv ${on(b.fill)}" data-fill="1" title="${t('Rellenar: la imagen ocupa todo el alto de su lado, recortándose')}"><span class="ms">fit_screen</span><span class="lbl">${t('Rellenar')}</span></button>`;
          $$('[data-side]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.right = x.dataset.side === '1'))));
          $$('[data-mw]', extra).forEach((x) => (x.onclick = () => this.change(() => this.setMtWidth(b, Number(x.dataset.mw)))));
          $$('[data-va]', extra).forEach((x) => (x.onclick = () => this.change(() => { if (x.dataset.va === 'center') delete b.valign; else b.valign = x.dataset.va; })));
          $('[data-fill]', extra).onclick = () => this.change(() => { if (b.fill) delete b.fill; else b.fill = true; });
          if (b.img) {
            this.styleBtn(extra, b);
            extra.insertAdjacentHTML('beforeend', `<span class="lv-sep"></span><button class="lv" data-drop="1" title="${t('Saca la foto del bloque y deja el texto rodeándola: la foto queda a un lado, dentro del texto')}"><span class="ms">wrap_text</span><span class="lbl">${t('Soltar en el texto')}</span></button>`);
            $('[data-drop]', extra).onclick = () => this.dropIntoText(b);
            // Barra propia sobre la foto (como en cualquier otra imagen): aparece al pasar el ratón o al pulsar la foto,
            // aunque el bloque sea alto y su barra general quede lejos
            const ib = document.createElement('div');
            ib.className = 'mt-imgbar';
            ib.innerHTML = [[false, 'format_image_left', t('Imagen a la izquierda')], [true, 'format_image_right', t('Imagen a la derecha')]]
              .map(([r, ic, n]) => `<button class="lv ${on(!!b.right === r)}" data-side="${r ? 1 : 0}" title="${n}"><span class="ms">${ic}</span></button>`).join('')
              + '<span class="lv-sep"></span>'
              + MT_SIZES.map((w) => `<button class="lv ${on(mw === w)}" data-mw="${w}" title="${t('La imagen ocupa el {n} % del ancho', { n: w })}">${w}%</button>`).join('')
              + `<span class="lv-sep"></span><button class="lv ${on(b.fill)}" data-fill="1" title="${t('Rellenar: la imagen ocupa todo el alto de su lado, recortándose')}"><span class="ms">fit_screen</span></button>`;
            $$('[data-side]', ib).forEach((x) => (x.onclick = (e) => { e.stopPropagation(); this.change(() => (b.right = x.dataset.side === '1')); }));
            $$('[data-mw]', ib).forEach((x) => (x.onclick = (e) => { e.stopPropagation(); this.change(() => this.setMtWidth(b, Number(x.dataset.mw))); }));
            $('[data-fill]', ib).onclick = (e) => { e.stopPropagation(); this.change(() => { if (b.fill) delete b.fill; else b.fill = true; }); };
            this.styleBtn(ib, b);
            ib.insertAdjacentHTML('beforeend', `<span class="lv-sep"></span><button class="lv show-lbl" data-drop="1" title="${t('El texto rodea la foto y sigue por debajo de ella (la foto queda a un lado, dentro del texto)')}"><span class="ms">wrap_text</span><span class="lbl">${t('Texto alrededor')}</span></button>`);
            $('[data-drop]', ib).onclick = (e) => { e.stopPropagation(); this.dropIntoText(b); };
            ib.addEventListener('mousedown', (e) => e.stopPropagation());
            (side.querySelector(".mt-phwrap") || side).appendChild(ib);
          }
          break;
        }

        case 'video': {
          if (!b.video) {
            body.appendChild(this.dropZone(t('Arrastra aquí un vídeo de la bandeja'), (m) => this.change(() => (b.video = m)), false, 'video'));
            body.appendChild(this.urlField(t('…o pega el enlace del vídeo (YouTube, Vimeo, TikTok, archivo .mp4…)'), (emb) => {
              if (emb.file) this.change(() => (b.video = { url: emb.url }));
              else this.replaceBlock(b, this.create('embed', { url: emb.url, provider: emb.provider }), false);
            }));
            break;
          }
          const v = document.createElement('video');
          v.src = b.video.url; v.controls = true; v.preload = 'metadata'; if (b.video.poster) v.poster = b.video.poster;
          body.appendChild(v);
          body.appendChild(this.editable('figcaption', b.caption, t('Pie del vídeo (opcional)'), (h) => (b.caption = h), { block: b }));
          break;
        }

        case 'embed': {
          if (!b.url) {
            body.appendChild(this.urlField(t('Pega el enlace (YouTube, Vimeo, TikTok, Spotify, X, Instagram…)'), (emb) => {
              if (emb.file) this.replaceBlock(b, this.create('video', { video: { url: emb.url } }), false);
              else this.change(() => { b.url = emb.url; b.provider = emb.provider; });
            }, true));
            break;
          }
          const emb = detectEmbed(b.url) || { name: b.provider === 'facebook' ? 'Facebook' : 'Instagram' };
          if (emb.player) {
            const fr = document.createElement('div');
            fr.className = 'embed-frame' + (b.provider === 'spotify' ? ' audio' : '');
            fr.innerHTML = `<iframe src="${esc(emb.player)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`;
            body.appendChild(fr);
          } else {
            body.innerHTML = `<div class="embed-box"><span class="ms fill">smart_display</span><div><b>${esc(emb.name || b.provider)}</b><div class="hint">${esc(b.url)}</div><div class="hint">${t('Tu web mostrará aquí el contenido original.')}</div></div></div>`;
          }
          if (!['instagram', 'facebook'].includes(b.provider) || b.caption) body.appendChild(this.editable('figcaption', b.caption, t('Pie (opcional)'), (h) => (b.caption = h)));
          extra.innerHTML = `<button class="lv" data-u="1" title="${t('Cambiar enlace')}"><span class="ms">link</span></button>`;
          $('[data-u]', extra).onclick = () => this.change(() => { b.url = ''; b.provider = ''; });
          break;
        }

        case 'table': {
          const tb = document.createElement('table');
          tb.className = 'ed-table' + (b.stripes ? ' stripes' : '');
          b.rows.forEach((row, r) => {
            const tr = document.createElement('tr');
            row.forEach((c, k) => {
              const cell = this.editable(b.head && r === 0 ? 'th' : 'td', c, '', (h) => (b.rows[r][k] = h), {
                block: b,
                onKey(e) { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); if (e.key === 'Tab') { e.preventDefault(); const cells = $$(`.blk[data-id="${b.id}"] [contenteditable]`); cells[cells.indexOf(e.target) + (e.shiftKey ? -1 : 1)]?.focus(); } },
              });
              tr.appendChild(cell);
            });
            tb.appendChild(tr);
          });
          body.appendChild(tb);
          body.appendChild(this.editable('figcaption', b.caption, t('Pie de tabla (opcional)'), (h) => (b.caption = h), { block: b }));
          const cols = b.rows[0]?.length || 0;
          extra.innerHTML = `<button class="lv" data-t="r+" title="${t('Añadir fila')}"><span class="ms">add_row_below</span></button>
            <button class="lv" data-t="r-" title="${t('Quitar la última fila')}" ${b.rows.length < 2 ? 'disabled' : ''}><span class="ms">remove</span><span class="ms">table_rows</span></button>
            <button class="lv" data-t="c+" title="${t('Añadir columna')}" ${cols >= 8 ? 'disabled' : ''}><span class="ms">add_column_right</span></button>
            <button class="lv" data-t="c-" title="${t('Quitar la última columna')}" ${cols < 2 ? 'disabled' : ''}><span class="ms">remove</span><span class="ms">view_column</span></button>
            <button class="lv ${b.head ? 'on' : ''}" data-t="h" title="${t('Primera fila como encabezado')}"><span class="ms">table_chart</span></button>
            <button class="lv ${b.stripes ? 'on' : ''}" data-t="s" title="${t('Filas a rayas')}"><span class="ms">reorder</span></button>`;
          const ops = { 'r+': () => b.rows.push(Array(cols).fill('')), 'r-': () => b.rows.pop(), 'c+': () => b.rows.forEach((r) => r.push('')), 'c-': () => b.rows.forEach((r) => r.pop()), h: () => (b.head = !b.head), s: () => (b.stripes = !b.stripes) };
          $$('[data-t]', extra).forEach((x) => (x.onclick = () => this.change(ops[x.dataset.t])));
          break;
        }

        case 'buttons': {
          const wrap = document.createElement('div');
          wrap.className = 'ed-btns' + (b.full ? ' full' : ''); wrap.style.justifyContent = b.align === 'center' ? 'center' : b.align === 'right' ? 'flex-end' : 'flex-start';
          const btn = this.editable('span', b.html, b.ph ? t(b.ph) : t('Texto del botón'), (h) => (b.html = h), { cls: 'ed-btn' + (b.variant === 'outline' ? ' outline' : ''), block: b, onKey(e) { if (e.key === 'Enter') e.preventDefault(); } });
          const st = btn.style;
          if (b.bg && b.variant !== 'outline') st.setProperty('--eb-bg', b.bg);
          if (b.color) st.setProperty('--eb-fg', b.color);
          if (b.radius) st.setProperty('--eb-r', { square: '0', round: '8px', pill: '9999px' }[b.radius]);
          if (b.size === 's') { st.setProperty('--eb-py', '8px'); st.setProperty('--eb-px', '18px'); st.setProperty('--eb-fs', '14px'); }
          if (b.size === 'l') { st.setProperty('--eb-py', '18px'); st.setProperty('--eb-px', '40px'); st.setProperty('--eb-fs', '20px'); }
          wrap.appendChild(btn);
          body.appendChild(wrap);
          const url = document.createElement('input');
          url.className = 'ed-btn-url'; url.placeholder = t('Enlace del botón (https://…)'); url.value = b.url || '';
          url.oninput = () => { b.url = url.value.trim(); this.onChange(); };
          body.appendChild(url);
          extra.innerHTML = ['left', 'center', 'right'].map((a) => `<button class="lv ${b.align === a ? 'on' : ''}" data-al="${a}" title="${t('Alineación')}"><span class="ms">format_align_${a}</span></button>`).join('')
            + `<span class="lv-sep"></span><button class="lv ${b.variant !== 'outline' ? 'on' : ''}" data-v="fill" title="${t('Relleno')}"><span class="ms fill">smart_button</span></button><button class="lv ${b.variant === 'outline' ? 'on' : ''}" data-v="outline" title="${t('Contorno')}"><span class="ms">smart_button</span></button>`;
          $$('[data-al]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.align = x.dataset.al))));
          $$('[data-v]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.variant = x.dataset.v))));
          this.styleBtn(extra, b);
          break;
        }

        case 'spacer': {
          body.innerHTML = `<div class="ed-spacer" style="height:${Number(b.height) || 40}px"><span>${Number(b.height) || 40} px</span></div>`;
          extra.innerHTML = [20, 40, 80, 120].map((h) => `<button class="lv ${Number(b.height) === h ? 'on' : ''}" data-h="${h}">${h}</button>`).join('');
          $$('[data-h]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.height = Number(x.dataset.h)))));
          break;
        }

        case 'details': {
          const d = document.createElement('div');
          d.className = 'ed-details';
          const sum = this.editable('div', b.summary, (b.ph ? t(b.ph) : '') || t('Pregunta o título que se ve siempre'), (h) => (b.summary = h), { cls: 'ed-sum', block: b, onKey(e) { if (e.key === 'Enter') e.preventDefault(); } });
          d.append(sum, this.editable('div', b.html, t('Contenido que se muestra al pulsar…'), (h) => (b.html = h), { cls: 'ed-det', block: b }));
          body.appendChild(d);
          break;
        }

        case 'toc': {
          const box = document.createElement('div');
          box.className = 'ed-toc';
          box.appendChild(this.editable('div', b.title, t('Título del índice (opcional)'), (h) => (b.title = h), { cls: 'ed-toc-title', onKey(e) { if (e.key === 'Enter') e.preventDefault(); } }));
          const ul = document.createElement('ul'); ul.className = 'toc-list';
          box.appendChild(ul);
          body.appendChild(box);
          requestAnimationFrame(() => this.refreshToc());
          break;
        }

        case 'group': {
          const g = document.createElement('div');
          g.className = `ed-group pad-${b.pad || 'none'} w-${b.width || 'normal'}`;
          Object.assign(g.style, { backgroundColor: b.gradient ? '' : b.bg || '', backgroundImage: b.gradient || '', color: b.color || '', borderRadius: b.radius ? b.radius + 'px' : '', boxShadow: b.shadow ? '6px 6px 9px rgba(0, 0, 0, 0.2)' : '' });
          if (b.border) { g.style.border = `1px solid ${b.border}`; g.style.outline = 'none'; }
          this.margins(g, b);
          g.appendChild(this.list(b.children, b.id));
          body.appendChild(g);
          this.saveBtn(extra, b);
          this.styleBtn(extra, b, false);
          break;
        }

        case 'columns': {
          const row = document.createElement('div');
          row.className = 'ed-cols' + (b.valign ? ' va-' + b.valign : '') + (b.stack !== false ? ' stack' : '');
          if (has(b.gap)) row.style.setProperty('--g', Number(b.gap) + 'px');
          if (b.gradient) row.style.backgroundImage = b.gradient; else if (b.bg) row.style.backgroundColor = b.bg;
          this.margins(row, b);
          b.cols.forEach((c) => {
            const col = document.createElement('div');
            col.className = 'ed-col';
            col.style.flexGrow = String(parseFloat(c.width) || 100 / b.cols.length);
            col.style.setProperty('--w', String(parseFloat(c.width) || 100 / b.cols.length) + '%');
            col.appendChild(this.list(c.children, b.id));
            row.appendChild(col);
          });
          body.appendChild(row);
          const n = b.cols.length, cur = b.cols.map((c) => parseFloat(c.width));
          const same = (p) => p.length === cur.length && p.every((w, k) => Math.abs(w - cur[k]) < 0.6);
          extra.innerHTML = [2, 3, 4].map((c) => `<button class="lv ${n === c ? 'on' : ''}" data-n="${c}" title="${t('{n} columnas', { n: c })}">${c}<span class="ms">view_column</span></button>`).join('')
            + '<span class="lv-sep"></span>' + (COLS[n] || []).map((p, k) => `<button class="lv ${same(p) ? 'on' : ''}" data-p="${k}" title="${t('Proporción de las columnas')}">${p.map((w) => Math.floor(w)).join('/')}</button>`).join('');
          $$('[data-n]', extra).forEach((x) => (x.onclick = () => this.setColumns(b, Number(x.dataset.n))));
          $$('[data-p]', extra).forEach((x) => (x.onclick = () => this.change(() => COLS[n][Number(x.dataset.p)].forEach((w, k) => (b.cols[k].width = pct(w))))));
          this.saveBtn(extra, b);
          this.styleBtn(extra, b);
          break;
        }

        case 'cover': {
          const cv = document.createElement('div');
          cv.className = `ed-cover w-${b.width || 'normal'}` + (b.parallax && b.img ? ' parallax' : '');
          cv.style.minHeight = (Number(b.height) || 0) + 'px';
          if (b.img) cv.style.backgroundImage = `url("${String(b.img.url).replace(/"/g, '%22')}")`;
          if (b.img && b.focalPoint) cv.style.backgroundPosition = `${Math.round(b.focalPoint.x * 100)}% ${Math.round(b.focalPoint.y * 100)}%`;
          this.margins(cv, b);
          const dim = document.createElement('div');
          dim.className = 'ed-cover-dim'; dim.style.background = b.gradient || b.overlay || '#000000'; dim.style.opacity = String((Number(b.dim ?? 50)) / 100);
          const inn = document.createElement('div');
          inn.className = 'ed-cover-in';
          const drop = document.createElement('div');
          drop.className = 'cover-bgdrop' + (b.img ? ' has' : '');
          drop.innerHTML = `<span class="ms">add_photo_alternate</span>${b.img ? t('Cambiar la imagen de fondo') : t('Arrastra aquí la imagen de fondo')}`;
          drop.onclick = () => this.pickFromTray((m) => this.change(() => this.setCoverImg(b, m)), 'image');
          this.acceptPhoto(drop, (img) => this.setCoverImg(b, img), { sameOk: (d) => !(d.kind === 'photo' && d.block === b.id) });
          inn.append(drop, this.list(b.children, b.id));
          cv.append(dim, inn);
          body.appendChild(cv);
          this.saveBtn(extra, b);
          this.styleBtn(extra, b);
          break;
        }

        case 'map': {
          const box = document.createElement('div');
          box.className = 'ed-map';
          const inp = document.createElement('input');
          inp.className = 'ed-map-addr'; inp.placeholder = t('Dirección (calle, número, ciudad)'); inp.value = b.address || '';
          const frame = document.createElement('div');
          frame.className = 'ed-map-frame'; frame.style.height = (Number(b.height) || 360) + 'px'; frame.style.borderRadius = (Number(b.radius) || 0) + 'px';
          const show = () => {
            const a = (b.address || '').trim();
            frame.innerHTML = a ? `<iframe src="${esc(SK().mapUrl(a))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${esc(a)}"></iframe>` : `<span class="ms">map</span><span>${t('Escribe una dirección y aquí verás el mapa')}</span>`;
          };
          let snap = false;
          inp.oninput = () => { if (!snap) { this.snapshot(); snap = true; } b.address = inp.value; this.onChange(); };
          inp.onblur = () => { snap = false; };
          inp.onchange = () => show();
          inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); show(); } };
          box.append(inp, frame);
          body.appendChild(box);
          show();
          this.styleBtn(extra, b, false);
          break;
        }

        case 'separator': body.innerHTML = '<hr>'; break;
        case 'raw': {
          const text = (b.markup || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          body.innerHTML = `<div class="raw-box"><span class="ms">code_blocks</span><div><b>${t('Bloque de WordPress «{n}»', { n: esc(b.label || 'html') })}</b><div class="hint">${t('Se hizo en WordPress; Ecos lo conserva tal cual al enviar.')}</div>${text ? `<div class="raw-text">${esc(text.slice(0, 220))}${text.length > 220 ? '…' : ''}</div>` : ''}</div></div>`;
          break;
        }
        default: body.textContent = b.type;
      }
    },

    // --- Diseño avanzado (fase 2) ---------------------------------------------------------------------------------------
    // Margen exterior arriba y abajo de un contenedor
    margins(el, b) {
      if (has(b.mt)) el.style.marginTop = Number(b.mt) + 'px';
      if (has(b.mb)) el.style.marginBottom = Number(b.mb) + 'px';
    },
    // Imagen de fondo de una portada: si estaba tapada del todo por la capa de color, se deja ver
    setCoverImg(b, m) {
      if (!b.img && Number(b.dim ?? 50) >= 100) b.dim = 50;
      b.img = { ...m };
    },
    // «Guardar como sección»: botón pequeño de la barra de secciones, columnas y portadas
    saveBtn(extra, b) {
      extra.insertAdjacentHTML('beforeend', `<span class="lv-sep"></span><button class="lv" data-sv="1" title="${t('Guardar como sección')}"><span class="ms">bookmark_add</span></button>`);
      $('[data-sv]', extra).onclick = () => window.SectionsUI?.save(b);
    },
    // Paleta pequeña de símbolos para la lista con iconos
    iconPop(anchor, pick) {
      let pop = $('#ico-pop');
      if (!pop) { pop = document.createElement('div'); pop.id = 'ico-pop'; pop.className = 'ico-pop'; document.body.appendChild(pop); }
      pop.innerHTML = SK().ICONS.map((c) => `<button type="button" data-i="${c}">${c}</button>`).join('');
      pop.classList.remove('hidden');
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
      pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 4) + 'px';
      const off = (e) => { if (!pop.contains(e.target)) { pop.classList.add('hidden'); document.removeEventListener('mousedown', off, true); } };
      $$('button', pop).forEach((x) => (x.onclick = () => { pop.classList.add('hidden'); document.removeEventListener('mousedown', off, true); pick(x.dataset.i); }));
      setTimeout(() => document.addEventListener('mousedown', off, true), 0);
    },
    // Recortar de verdad la foto de un bloque de imagen: el recortador la corta, se sube como foto nueva y sustituye a la
    // anterior en el bloque (la original se queda en la biblioteca)
    async cropImage(b) {
      if (!b.img || !window.Cropper) return;
      let res;
      try { res = await window.Cropper.crop(b.img); } catch (e) { window.toastError?.(e); return; }
      if (!res) return;
      window.toast?.(t('Subiendo la foto recortada…'));
      try {
        const up = await window.api.uploadPasted(res.bytes, res.name, res.type);
        const loc = this.locate(b.id);
        if (!loc) return;
        this.change(() => {
          const old = loc.b.img || {};
          loc.b.img = { id: up.id, url: up.url, alt: old.alt || '' };
          delete loc.b.ratio; // el recorte ya es la proporción buscada
          this.draft.extraMedia = [...(this.draft.extraMedia || []), up];
          if (typeof window.mediaPool === 'function') this.media = window.mediaPool();
        });
        window.toast?.(t('Foto recortada. La original sigue en tu biblioteca.'));
      } catch (e) { window.toastError?.(e); }
    },

    // --- Imagen y texto: tamaño de la foto, divisor que se arrastra, soltar en el texto y juntar de nuevo ---------------------
    mtWidth(b) { const w = Number(b.mediaWidth); return Number.isInteger(w) && w >= 10 && w <= 90 ? w : 50; },
    setMtWidth(b, w) { if (w === 50) delete b.mediaWidth; else b.mediaWidth = w; },
    // Tirador entre la foto y el texto: salta a 25/33/50/66 % y admite cualquier entero entre 20 y 80
    mtSplit(b, row) {
      const h = document.createElement('span');
      h.className = 'mt-split'; h.title = t('Arrastra para cambiar el tamaño de la imagen');
      h.innerHTML = '<span class="ms">drag_indicator</span>';
      h.onmousedown = (e) => {
        e.preventDefault(); e.stopPropagation();
        const r = row.getBoundingClientRect(), blk = row.closest('.blk');
        const tip = document.createElement('span');
        tip.className = 'rs-tip'; blk?.appendChild(tip);
        let w = this.mtWidth(b);
        const move = (ev) => {
          const x = b.right ? r.right - ev.clientX : ev.clientX - r.left;
          let v = Math.round(((x - 10) / r.width) * 100);
          v = Math.max(20, Math.min(80, v));
          const near = MT_SIZES.find((n) => Math.abs(n - v) <= 2);
          w = near || v;
          row.style.setProperty('--mtw', w + '%'); tip.textContent = w + '%';
        };
        const up = () => {
          document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
          tip.remove();
          if (w !== this.mtWidth(b)) this.change(() => this.setMtWidth(b, w));
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      };
      return h;
    },
    // «Imagen y texto» → foto flotante (a un lado, con el texto alrededor) + párrafo
    dropIntoText(b) {
      const loc = this.locate(b.id);
      if (!loc || !b.img) return;
      this.change(() => {
        const w = this.mtWidth(b), width = [33, 50, 75].reduce((a, c) => (Math.abs(c - w) < Math.abs(a - w) ? c : a));
        const img = this.create('image', { img: b.img, align: b.right ? 'right' : 'left', width });
        for (const k of ['ratio', 'frame', 'frameColor', 'fx']) if (b[k]) img[k] = b[k];
        loc.arr.splice(loc.i, 1, img, this.create('paragraph', { html: b.html || '' }));
      });
      info(t('La foto ya no está dentro del bloque: queda a un lado y el texto de debajo la rodea. Puedes arrastrarla a otro punto del texto; para volver a unirlas, pulsa «Juntar con el texto».'));
    },
    // Foto flotante + párrafo siguiente → «Imagen y texto»
    joinWithText(b) {
      const loc = this.locate(b.id), next = loc?.arr[loc.i + 1];
      if (!loc || next?.type !== 'paragraph') return;
      this.change(() => {
        let pct = b.w ? (/px$/.test(b.w) ? (parseFloat(b.w) / 760) * 100 : parseFloat(b.w)) : ({ 33: 33, 50: 50, 75: 66 }[b.width] || 50);
        if (!(pct > 0)) pct = 50;
        const mw = MT_SIZES.reduce((a, c) => (Math.abs(c - pct) < Math.abs(a - pct) ? c : a));
        const mt = this.create('mediatext', { img: b.img, html: next.html || '', right: b.align === 'right' });
        this.setMtWidth(mt, mw);
        for (const k of ['ratio', 'frame', 'frameColor', 'fx']) if (b[k]) mt[k] = b[k];
        loc.arr.splice(loc.i, 2, mt);
      });
      info(t('Foto y texto juntos en un bloque «Imagen y texto». Si quieres que el texto rodee la foto, usa «Soltar en el texto».'));
    },

    // --- Carrusel: tamaño, proporción y estilo (se ven igual en el editor y en la web) --------------------------------------------
    carLook(grid, b) {
      const ratio = b.ratio ?? (b.squares ? '1' : '');
      if (CAR_H[b.size]) { grid.classList.add('has-h'); grid.style.setProperty('--car-h', CAR_H[b.size]); }
      if (ratio) { grid.classList.add('has-r'); grid.style.setProperty('--car-r', ratio.replace('/', ' / ')); }
      if (b.corners) grid.classList.add('cc-' + b.corners);
      if (b.shadow) grid.classList.add('cs-' + b.shadow);
      if (b.gap !== undefined) grid.style.setProperty('--car-gap', { 0: '0px', s: '4px', l: '14px' }[b.gap] || '10px');
    },
    // Botones desplegables de la barra del carrusel: icono + nombre corto; abren un menú pequeño con las opciones
    carMenus(extra, b) {
      const ratio = b.ratio ?? (b.squares ? '1' : '');
      const set = (k, v) => () => { if (v === '' || v === undefined) delete b[k]; else b[k] = v; if (k === 'ratio') { delete b.squares; if (v === '') b.ratio = ''; } };
      const sw = (k, vals) => vals.map(([v, n]) => [v, n, (b[k] ?? '') === v, set(k, v)]);
      const menus = {
        size: { icon: 'photo_size_select_large', label: t('Tamaño'), title: t('Tamaño de las fotos (altura)'), groups: [{ label: t('Altura de las fotos'), opts: sw('size', [['', t('Original')], ['s', t('Pequeño')], ['m', t('Mediano')], ['l', t('Grande')], ['xl', t('Pantalla completa')]]) }] },
        ratio: { icon: 'aspect_ratio', label: t('Proporción'), title: t('Recorte de las fotos por proporción'), groups: [{ label: t('Recorte'), opts: [['', t('Original')], ['1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['3/4', '3:4']].map(([v, n]) => [v, n, ratio === v, set('ratio', v)]) }] },
        style: {
          icon: 'rounded_corner', label: t('Estilo'), title: t('Esquinas, sombra, separación, flechas y puntos'),
          groups: [
            { label: t('Esquinas'), opts: sw('corners', [['', t('Predeterminadas')], ['square', t('Rectas')], ['round', t('Redondeadas')]]) },
            { label: t('Sombra'), opts: sw('shadow', [['', t('Predeterminada')], ['off', t('Sin sombra')], ['on', t('Con sombra')]]) },
            { label: t('Separación entre fotos'), opts: sw('gap', [['', t('Predeterminada')], ['0', t('Sin')], ['s', t('Poca')], ['l', t('Mucha')]]) },
            { label: t('Flechas'), opts: [[true, t('Visibles'), b.arrows !== false, () => { delete b.arrows; }], [false, t('Ocultas'), b.arrows === false, () => { b.arrows = false; }]] },
            { label: t('Puntos'), opts: [[true, t('Visibles'), b.dots !== false, () => { delete b.dots; }], [false, t('Ocultos'), b.dots === false, () => { b.dots = false; }]] },
          ],
        },
      };
      extra.insertAdjacentHTML('beforeend', '<span class="lv-sep"></span>' + Object.entries(menus).map(([k, m]) => `<button class="lv dd ${this.dd?.id === b.id && this.dd.key === k ? 'on' : ''}" data-dd="${k}" title="${esc(m.title)}"><span class="ms">${m.icon}</span><span class="dd-l">${m.label}</span><span class="ms dd-ch">expand_more</span></button>`).join(''));
      $$('[data-dd]', extra).forEach((x) => {
        const m = menus[x.dataset.dd];
        x.onclick = () => {
          if (this.dd?.id === b.id && this.dd.key === x.dataset.dd && !$('#dd-pop')?.classList.contains('hidden')) { this.closeDrop(); return; }
          const r = x.getBoundingClientRect();
          this.dd = { id: b.id, key: x.dataset.dd, x: r.left, y: r.bottom + 8 };
          this.openDrop(x, m, b);
        };
        if (this.dd?.id === b.id && this.dd.key === x.dataset.dd) requestAnimationFrame(() => { const nb = $(`.blk[data-id="${b.id}"] [data-dd="${x.dataset.dd}"]`); if (nb) this.openDrop(nb, m, b); });
      });
    },
    dd: null,
    closeDrop() { $('#dd-pop')?.classList.add('hidden'); this.dd = null; $$('.lv.dd.on').forEach((x) => x.classList.remove('on')); },
    openDrop(btn, m, b) {
      let el = $('#dd-pop');
      if (!el) {
        el = document.createElement('div'); el.id = 'dd-pop'; el.className = 'sty-pop dd-pop hidden';
        document.body.appendChild(el);
        document.addEventListener('mousedown', (e) => { if (this.dd && !e.target.closest('#dd-pop, [data-dd]')) this.closeDrop(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.dd) this.closeDrop(); });
      }
      const kept = el.dataset.for === `${b.id}:${this.dd.key}` && this.setPopHtml(el, m.groups.map((g, gi) => `<div class="sp-row"><div class="sp-lbl">${esc(g.label)}</div><div class="sp-chips">${g.opts.map(([, n, on], oi) => `<button class="sp-chip ${on ? 'on' : ''}" data-g="${gi}" data-o="${oi}">${esc(n)}</button>`).join('')}</div></div>`).join(''));
      if (!kept) el.innerHTML = m.groups.map((g, gi) => `<div class="sp-row"><div class="sp-lbl">${esc(g.label)}</div><div class="sp-chips">${g.opts.map(([, n, on], oi) => `<button class="sp-chip ${on ? 'on' : ''}" data-g="${gi}" data-o="${oi}">${esc(n)}</button>`).join('')}</div></div>`).join('');
      el.dataset.for = `${b.id}:${this.dd.key}`;
      el.classList.remove('hidden');
      btn.classList.add('on');
      // la posición se fija al abrir (la barra puede ocultarse al llevar el ratón al menú); si ya estaba abierto, no se mueve
      if (!kept) {
        el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, this.dd.x)) + 'px';
        el.style.top = Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, this.dd.y)) + 'px';
      }
      $$('.sp-chip', el).forEach((x) => (x.onclick = () => { const o = m.groups[Number(x.dataset.g)].opts[Number(x.dataset.o)]; $$(`.sp-chip[data-g="${x.dataset.g}"]`, el).forEach((y) => y.classList.toggle('on', y === x)); this.changeBlock(b.id, o[3]); }));
      void b;
    },

    // --- Imagen: recorte, marco, efecto y tamaño libre (se ven igual en el editor y en la web) ------------------------------
    imgLook(ph, b) {
      const im = $('img', ph);
      if (!im) return;
      if (b.ratio) { im.style.aspectRatio = b.ratio; im.style.objectFit = 'cover'; im.style.maxHeight = 'none'; }
      if (b.frame === 'rounded') im.style.borderRadius = '16px';
      if (b.frame === 'circle') im.style.borderRadius = '9999px';
      if (b.frame === 'border') im.style.border = `2px solid ${b.frameColor || '#333333'}`;
      if (b.frame === 'shadow') im.style.boxShadow = '6px 6px 9px rgba(0, 0, 0, 0.2)';
      ph.classList.toggle('ecos-zoom', b.fx === 'zoom');
      ph.classList.toggle('ecos-bn', b.fx === 'bw');
    },
    // Tirador de la esquina: arrastrándolo se cambia el ancho (en % del ancho disponible o en px, según lo que ya tenga)
    resizeHandle(b, body) {
      const h = document.createElement('span');
      h.className = 'rs-handle'; h.title = t('Arrastra para cambiar el ancho');
      h.innerHTML = '<span class="ms">open_in_full</span>';
      h.draggable = false;
      h.onmousedown = (e) => {
        e.preventDefault(); e.stopPropagation();
        const blk = body.closest('.blk');
        if (!blk) return;
        const avail = blk.parentElement.clientWidth, w0 = blk.getBoundingClientRect().width, x0 = e.clientX;
        const px = /px$/.test(b.w || '');
        const tip = document.createElement('span');
        tip.className = 'rs-tip'; blk.appendChild(tip);
        let w = w0;
        const label = () => (px ? Math.round(w) + 'px' : Math.round((w / avail) * 100) + '%');
        const move = (ev) => { w = Math.max(60, Math.min(avail, w0 + (ev.clientX - x0))); blk.style.width = w + 'px'; tip.textContent = label(); };
        const up = () => {
          document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
          const v = label(); tip.remove();
          this.change(() => { b.w = v; delete b.width; if (!b.align) b.align = 'center'; });
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      };
      return h;
    },
    // Convierte una imagen en galería, mosaico o carrusel (empieza con esta foto; luego se sueltan más)
    convertImage(b, k) {
      this.change(() => {
        const img = b.img;
        for (const x of ['img', 'caption', 'align', 'width', 'w', 'ratio', 'frame', 'frameColor', 'fx']) delete b[x];
        b.images = [img];
        if (k === 'carousel') b.type = 'carousel'; else { b.type = 'gallery'; b.layout = k; b.columns = 2; }
      });
      toast(t('Ahora suelta aquí más fotos desde la bandeja (o pulsa el recuadro para elegirlas).'));
    },
    // Columnas: cambia el número conservando lo que hay dentro (las que sobran se juntan en la última)
    setColumns(b, n) {
      if (b.cols.length === n) return;
      this.change(() => {
        while (b.cols.length > n) { const last = b.cols.pop(); b.cols[b.cols.length - 1].children.push(...last.children.filter((x) => !(x.type === 'paragraph' && !(x.html || '').trim()))); }
        while (b.cols.length < n) b.cols.push({ width: '', children: [this.create('paragraph')] });
        COLS[n][0].forEach((w, k) => (b.cols[k].width = pct(w)));
      });
    },

    // --- Panel «Estilo»: ventanita con las opciones de un bloque, ordenadas por grupos -------------------------------------------
    pop: null, popLock: false, popSnap: false,
    styleBtn(extra, b, sep = true) {
      extra.insertAdjacentHTML('beforeend', `${sep ? '<span class="lv-sep"></span>' : ''}<button class="lv sty-btn ${this.pop?.id === b.id ? 'on' : ''}" data-sty="1" title="${t('Estilo del bloque')}"><span class="ms">tune</span><span class="lbl">${t('Estilo')}</span></button>`);
      $('[data-sty]', extra).onclick = (e) => {
        if (this.pop?.id === b.id) { this.closeStyle(); return; }
        const r = e.currentTarget.getBoundingClientRect();
        this.pop = { id: b.id, x: r.left, y: r.bottom + 8 };
        this.openStyle(b.id, true);
        this.render();
      };
    },
    closeStyle() {
      const el = $('#sty-pop');
      if (el) el.classList.add('hidden');
      const was = this.pop; this.pop = null; this.popLock = false; this.popSnap = false;
      if (was) $$('.blk.sty-open').forEach((x) => x.classList.remove('sty-open'));
      $$('.sty-btn.on').forEach((x) => x.classList.remove('on'));
    },
    // Cambio en directo (colores, deslizadores): un solo paso de «deshacer» por gesto y sin reconstruir el panel
    live(fn) {
      if (!this.popSnap) { this.snapshot(); this.popSnap = true; }
      this.popLock = true;
      fn();
      this.render();
      this.onChange();
    },
    // Filas del panel de cada tipo de bloque: { label, chips:[{t, ic, title, on, off, fn}] | color:{get,set,none} | range:{...} | html+wire }
    styleRows(b) {
      const chip = (txt, on, fn, o = {}) => ({ t: txt, on, fn, ...o });
      const set = (k, v) => () => { if (v === undefined || v === null || v === '') delete b[k]; else b[k] = v; };
      const choose = (k, opts) => opts.map(([v, n, o]) => chip(n, (b[k] ?? '') === v, set(k, v), o));
      const widthRow = () => ({ label: t('Ancho'), chips: choose('width', [['', t('Normal')], ['wide', t('Ancho')], ['full', t('Completo')]]) });
      // Degradado de fondo (atributo estándar style.color.gradient); al elegirlo se quita el color liso
      const gradRow = (label) => ({ label: label || t('Degradado de fondo'), grad: { get: () => b.gradient || '', set: (v) => { if (v) { b.gradient = v; delete b.bg; } else delete b.gradient; } } });
      // Margen exterior arriba y abajo (style.spacing.margin)
      const marginRows = () => [['mt', t('Margen exterior arriba')], ['mb', t('Margen exterior abajo')]].map(([k, label]) => ({
        label, chips: [chip(t('Normal'), !has(b[k]), () => { delete b[k]; }), ...[0, 16, 32, 64, 96].map((v) => chip(v + ' px', has(b[k]) && Number(b[k]) === v, () => { b[k] = v; }))],
      }));
      // Punto focal de la imagen de fondo de la portada: se pulsa sobre la miniatura
      const focalRow = () => {
        const f = b.focalPoint || { x: 0.5, y: 0.5 };
        return {
          label: t('Punto focal de la imagen'),
          html: `<div class="sp-focal" title="${t('Pulsa en la parte de la foto que siempre debe verse')}"><img src="${esc(b.img.url)}" alt="" draggable="false"><i style="left:${Math.round(f.x * 100)}%;top:${Math.round(f.y * 100)}%"></i></div><button class="sp-chip" data-fc="1" ${b.focalPoint ? '' : 'disabled'}>${t('Centrar')}</button>`,
          wire: (root) => {
            const box = $('.sp-focal', root);
            box.onclick = (e) => { const r = $('img', box).getBoundingClientRect(); const x = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100) / 100, y = Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 100) / 100; this.change(() => { b.focalPoint = { x, y }; }); };
            $('[data-fc]', root).onclick = () => this.change(() => { delete b.focalPoint; });
          },
        };
      };
      const rows = [];
      if (b.type === 'image' || b.type === 'mediatext') {
        const px = /px$/.test(b.w || '');
        rows.push({ label: t('Recortar la foto'), chips: [{ t: t('Recortar…'), ic: 'crop', on: false, raw: () => this.cropImage(b) }] });
        rows.push({ label: t('Recorte'), chips: [['', t('Original')], ['1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['9/16', '9:16']]
          .map(([v, n]) => chip(n, (b.ratio || '') === v, () => { set('ratio', v)(); if (v !== '1' && b.frame === 'circle') delete b.frame; })) });
        if (b.type === 'image') rows.push({
          label: t('Ancho'),
          html: `<input type="number" class="sp-num" min="5" max="2000" value="${parseFloat(b.w) || ''}" placeholder="${t('auto')}"><button class="sp-chip ${!px ? 'on' : ''}" data-u="%">%</button><button class="sp-chip ${px ? 'on' : ''}" data-u="px">px</button><button class="sp-chip" data-u="">${t('Auto')}</button>`,
          wire: (root) => {
            const num = $('.sp-num', root), unit = () => (/px$/.test(b.w || '') ? 'px' : '%');
            num.onchange = () => { const v = Math.max(5, Math.min(2000, parseFloat(num.value) || 0)); this.change(() => { if (!v) { delete b.w; return; } b.w = v + (unit() === 'px' ? 'px' : '%'); delete b.width; if (!b.align) b.align = 'center'; }); };
            $$('[data-u]', root).forEach((x) => (x.onclick = () => this.change(() => {
              const u = x.dataset.u;
              if (!u) { delete b.w; return; }
              const cur = parseFloat(b.w) || (u === 'px' ? 400 : 60);
              b.w = cur + u; delete b.width; if (!b.align) b.align = 'center';
            })));
          },
        });
        rows.push({ label: t('Marco'), chips: [
          chip(t('Sin marco'), !b.frame, () => { delete b.frame; }),
          chip(t('Redondeado'), b.frame === 'rounded', () => { b.frame = 'rounded'; }),
          chip(t('Círculo'), b.frame === 'circle', () => { b.frame = 'circle'; }, { off: b.ratio !== '1', title: t('Elige primero el recorte 1:1 para usar el círculo') }),
          chip(t('Borde'), b.frame === 'border', () => { b.frame = 'border'; }),
          chip(t('Sombra'), b.frame === 'shadow', () => { b.frame = 'shadow'; }),
        ] });
        if (b.frame === 'border') rows.push({ label: t('Color del borde'), color: { get: () => b.frameColor || '#333333', set: (v) => { b.frameColor = v; } } });
        rows.push({ label: t('Efecto'), chips: [chip(t('Ninguno'), !b.fx, () => { delete b.fx; }), chip(t('Zoom al pasar el ratón'), b.fx === 'zoom', () => { b.fx = 'zoom'; }), chip(t('Blanco y negro'), b.fx === 'bw', () => { b.fx = 'bw'; })] });
        if (b.type === 'image') rows.push({ label: t('Convertir en'), chips: [['grid', 'grid_view', t('Galería')], ['mosaic', 'dashboard', t('Mosaico')], ['carousel', 'view_carousel', t('Carrusel')]].map(([k, ic, n]) => ({ t: n, ic, on: false, raw: () => this.convertImage(b, k) })) });
      } else if (b.type === 'group') {
        rows.push({ label: t('Color de fondo'), color: { get: () => b.bg || '', set: (v) => { set('bg', v)(); if (v) delete b.gradient; }, none: true } });
        rows.push(gradRow());
        rows.push({ label: t('Color del texto'), color: { get: () => b.color || '', set: (v) => set('color', v)(), none: true } });
        rows.push({ label: t('Margen interior'), chips: choose('pad', [['none', t('Ninguno')], ['s', t('Pequeño')], ['m', t('Medio')], ['l', t('Grande')]]).map((c, k) => ({ ...c, on: (b.pad || 'none') === ['none', 's', 'm', 'l'][k] })) });
        rows.push(widthRow());
        rows.push({ label: t('Esquinas'), chips: [[0, t('Rectas')], [12, t('Suaves')], [28, t('Redondas')]].map(([v, n]) => chip(n, (Number(b.radius) || 0) === v, () => { if (v) b.radius = v; else delete b.radius; })) });
        rows.push({ label: t('Sombra'), chips: [chip(t('No'), !b.shadow, () => { delete b.shadow; }), chip(t('Sí'), !!b.shadow, () => { b.shadow = true; })] });
        rows.push({ label: t('Borde'), color: { get: () => b.border || '', set: (v) => set('border', v)(), none: true } });
        rows.push(...marginRows());
        rows.push({ label: t('Imagen de fondo'), chips: [{ t: t('Poner una imagen de fondo…'), ic: 'wallpaper', on: false, raw: () => this.pickFromTray((m) => this.change(() => { b.type = 'cover'; b.img = { ...m }; b.overlay = '#000000'; b.dim = 40; b.height = 300; delete b.bg; delete b.gradient; delete b.border; delete b.pad; delete b.radius; delete b.shadow; }), 'image') }] });
      } else if (b.type === 'columns') {
        rows.push({ label: t('Columnas'), chips: [2, 3, 4].map((n) => chip(String(n), b.cols.length === n, () => {}, { raw: () => this.setColumns(b, n), on: b.cols.length === n })) });
        const cur = b.cols.map((c) => parseFloat(c.width));
        rows.push({ label: t('Proporción'), chips: (COLS[b.cols.length] || []).map((p) => ({ t: p.map((w) => Math.floor(w)).join(' / '), on: p.length === cur.length && p.every((w, k) => Math.abs(w - cur[k]) < 0.6), fn: () => p.forEach((w, k) => (b.cols[k].width = pct(w))) })) });
        rows.push({ label: t('Alineación vertical'), chips: [['', t('Arriba')], ['center', t('Centro')], ['bottom', t('Abajo')]].map(([v, n]) => chip(n, (b.valign || '') === v, () => { if (v) b.valign = v; else delete b.valign; })) });
        rows.push({ label: t('Apilar en móvil'), chips: [chip(t('Sí'), b.stack !== false, () => { b.stack = true; }), chip(t('No'), b.stack === false, () => { b.stack = false; })] });
        rows.push({ label: t('Separación entre columnas'), chips: [chip(t('Normal'), !has(b.gap), () => { delete b.gap; }), ...[0, 16, 32, 48, 64].map((v) => chip(v + ' px', has(b.gap) && Number(b.gap) === v, () => { b.gap = v; }))] });
        rows.push({ label: t('Color de fondo'), color: { get: () => b.bg || '', set: (v) => { set('bg', v)(); if (v) delete b.gradient; }, none: true } });
        rows.push(gradRow());
        rows.push(...marginRows());
      } else if (b.type === 'cover') {
        rows.push({ label: t('Imagen de fondo'), chips: [{ t: t('Cambiar imagen…'), ic: 'add_photo_alternate', on: false, raw: () => this.pickFromTray((m) => this.change(() => this.setCoverImg(b, m)), 'image') }, chip(t('Quitar imagen'), false, () => { b.img = null; delete b.focalPoint; delete b.parallax; }, { off: !b.img })] });
        if (b.img) rows.push(focalRow());
        if (b.img) rows.push({ label: t('Efecto parallax (la imagen se mueve más despacio al bajar)'), chips: [chip(t('No'), !b.parallax, () => { delete b.parallax; }), chip(t('Sí'), !!b.parallax, () => { b.parallax = true; })] });
        rows.push({ label: t('Capa de color'), color: { get: () => b.overlay || '#000000', set: (v) => { b.overlay = v; } } });
        rows.push(gradRow(t('Degradado en la capa')));
        rows.push({ label: t('Opacidad de la capa'), range: { min: 0, max: 100, step: 10, get: () => Number(b.dim ?? 50), set: (v) => { b.dim = v; }, fmt: (v) => v + '%' } });
        rows.push({ label: t('Altura'), chips: [[0, t('Auto')], [240, t('Baja')], [360, t('Media')], [480, t('Alta')], [600, t('Muy alta')]].map(([v, n]) => chip(n, (Number(b.height) || 0) === v, () => { b.height = v; })) });
        rows.push(widthRow());
        rows.push(...marginRows());
      } else if (b.type === 'map') {
        rows.push({ label: t('Altura'), chips: [[260, t('Baja')], [360, t('Media')], [480, t('Alta')]].map(([v, n]) => chip(n, (Number(b.height) || 360) === v, () => { b.height = v; })) });
        rows.push({ label: t('Esquinas'), chips: [[0, t('Rectas')], [16, t('Suaves')], [28, t('Redondas')]].map(([v, n]) => chip(n, (Number(b.radius) || 0) === v, () => { b.radius = v; })) });
      } else if (b.type === 'buttons') {
        if (b.variant !== 'outline') rows.push({ label: t('Color de fondo'), color: { get: () => b.bg || '', set: (v) => set('bg', v)(), none: true } });
        rows.push({ label: b.variant === 'outline' ? t('Color del borde y del texto') : t('Color del texto'), color: { get: () => b.color || '', set: (v) => set('color', v)(), none: true } });
        rows.push({ label: t('Esquinas'), chips: [['', t('Tema')], ['square', t('Recto')], ['round', t('Redondeado')], ['pill', t('Píldora')]].map(([v, n]) => chip(n, (b.radius || '') === v, () => set('radius', v)())) });
        rows.push({ label: t('Tamaño'), chips: [['s', t('Pequeño')], ['', t('Mediano')], ['l', t('Grande')]].map(([v, n]) => chip(n, (b.size || '') === v, () => set('size', v)())) });
        rows.push({ label: t('Ancho'), chips: [chip(t('Normal'), !b.full, () => { delete b.full; }), chip(t('Completo'), !!b.full, () => { b.full = true; })] });
      }
      return rows;
    },
    openStyle(id, reopen) {
      const loc = this.locate(id);
      let el = $('#sty-pop');
      if (!loc) { this.closeStyle(); return; }
      if (!el) {
        el = document.createElement('div'); el.id = 'sty-pop'; el.className = 'sty-pop hidden';
        document.body.appendChild(el);
        document.addEventListener('mousedown', (e) => { if (this.pop && !e.target.closest('#sty-pop, [data-sty]')) this.closeStyle(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.pop) this.closeStyle(); });
      }
      const b = loc.b, rows = this.styleRows(b);
      if (!rows.length) { this.closeStyle(); return; }
      const T = TYPES()[b.type];
      const h = [`<div class="sp-title"><span class="ms">${T.icon}</span>${esc(T.name)}<button class="sp-x" title="${t('Cerrar')}"><span class="ms">close</span></button></div>`];
      rows.forEach((r, ri) => {
        let body = '';
        if (r.chips) body = `<div class="sp-chips">${r.chips.map((c, ci) => `<button class="sp-chip ${c.on ? 'on' : ''}" data-r="${ri}" data-c="${ci}" ${c.off ? 'disabled' : ''} ${c.title ? `title="${esc(c.title)}"` : ''}>${c.ic ? `<span class="ms">${c.ic}</span>` : ''}${esc(c.t)}</button>`).join('')}</div>`;
        else if (r.color) {
          const cur = r.color.get() || '';
          body = `<div class="sp-chips sp-sws">${r.color.none ? `<button class="sp-chip ${!cur ? 'on' : ''}" data-r="${ri}" data-sw="">${t('Ninguno')}</button>` : ''}${SWATCH.map((c) => `<button class="sp-sw ${cur.toLowerCase() === c ? 'on' : ''}" data-r="${ri}" data-sw="${c}" style="background:${c}" title="${c}"></button>`).join('')}<label class="sp-sw sp-custom" title="${t('Otro color')}"><span class="ms">palette</span><input type="color" data-r="${ri}" value="${/^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888'}"></label></div>`;
        } else if (r.grad) {
          const cur = r.grad.get() || '';
          body = `<div class="sp-chips sp-sws"><button class="sp-chip ${!cur ? 'on' : ''}" data-r="${ri}" data-gr="">${t('Ninguno')}</button>${SK().GRADIENTS.map((g) => `<button class="sp-sw ${cur === g.css ? 'on' : ''}" data-r="${ri}" data-gr="${esc(g.css)}" style="background:${g.css}" title="${esc(t(g.name))}"></button>`).join('')}</div>`;
        } else if (r.range) body = `<div class="sp-range"><input type="range" data-r="${ri}" min="${r.range.min}" max="${r.range.max}" step="${r.range.step}" value="${r.range.get()}"><output>${r.range.fmt(r.range.get())}</output></div>`;
        else if (r.html) body = `<div class="sp-chips sp-custom-row" data-r="${ri}">${r.html}</div>`;
        h.push(`<div class="sp-row"><div class="sp-lbl">${esc(r.label)}</div>${body}</div>`);
      });
      const keptSty = el.dataset.for === String(id) && this.setPopHtml(el, h.join(''));
      if (!keptSty) el.innerHTML = h.join('');
      el.dataset.for = String(id);
      el.classList.remove('hidden');
      // posición: bajo el botón «Estilo» (se conserva al reconstruir)
      const pos = this.pop || (this.pop = { id, x: 200, y: 120 });
      pos.id = id;
      const w = el.offsetWidth, hh = el.offsetHeight;
      el.style.left = Math.max(8, Math.min(innerWidth - w - 8, pos.x)) + 'px';
      el.style.top = Math.max(8, Math.min(innerHeight - hh - 8, pos.y)) + 'px';
      $('.sp-x', el).onclick = () => { this.closeStyle(); this.render(); };
      $$('.sp-chip[data-c]', el).forEach((x) => (x.onclick = () => { const c = rows[Number(x.dataset.r)].chips[Number(x.dataset.c)]; if (c.raw) c.raw(); else this.changeBlock(id, c.fn); }));
      $$('[data-sw]', el).forEach((x) => (x.onclick = () => this.changeBlock(id, () => rows[Number(x.dataset.r)].color.set(x.dataset.sw))));
      $$('[data-gr]', el).forEach((x) => (x.onclick = () => this.changeBlock(id, () => rows[Number(x.dataset.r)].grad.set(x.dataset.gr))));
      $$('input[type=color]', el).forEach((x) => {
        const r = rows[Number(x.dataset.r)];
        x.oninput = () => this.live(() => r.color.set(x.value));
        x.onchange = () => { this.popLock = false; this.popSnap = false; this.openStyle(id, true); };
      });
      $$('input[type=range]', el).forEach((x) => {
        const r = rows[Number(x.dataset.r)];
        x.oninput = () => { $('output', x.parentElement).textContent = r.range.fmt(Number(x.value)); this.live(() => r.range.set(Number(x.value))); };
        x.onchange = () => { this.popLock = false; this.popSnap = false; this.openStyle(id, true); };
      });
      $$('.sp-custom-row', el).forEach((x) => rows[Number(x.dataset.r)].wire(x));
      void reopen;
    },

    // Foto dentro de un bloque: ★ destacada, × quitar, alt, arrastrar para ordenar o sacar de la galería
    // Foto dentro de un bloque: ★ destacada, × quitar, alt; se arrastra a cualquier sitio
    photo(img, remove, block, index = null) {
      const fig = document.createElement('div');
      const isVid = img.type === 'video';
      fig.className = 'ph' + (isVid ? ' vid' : '') + (this.draft.featuredImageId === img.id ? ' featured' : '');
      fig.draggable = true;
      fig.innerHTML = `${isVid ? `<video src="${esc(img.url)}"${img.poster ? ` poster="${esc(img.poster)}"` : ''} muted preload="metadata" draggable="false"></video><span class="ms fill play">play_circle</span>` : `<img src="${esc(img.url)}" alt="" draggable="false">`}
        <button class="star" title="${t('Usar como imagen destacada (sale del cuerpo y va arriba)')}"><span class="ms fill">star</span></button>
        <button class="del" title="${t('Quitar')}"><span class="ms">close</span></button>
        <input class="alt" placeholder="${t('Descripción (alt)')}" draggable="false">`;
      $('.alt', fig).value = img.alt || '';
      $('.alt', fig).oninput = (e) => { img.alt = e.target.value; this.onChange(); };
      $('.star', fig).onclick = () => this.change(() => { this.draft.featuredImageId = img.id; this.draft.keepFeaturedInBody = false; this.liftFeatured(); });
      $('.del', fig).onclick = remove;
      $(isVid ? 'video' : 'img', fig).onclick = () => this.onOpenMedia(img);
      if (isVid) { $('.star', fig).remove(); $('.alt', fig).remove(); }
      fig.ondragstart = (e) => {
        if (e.target.tagName === 'INPUT') { e.preventDefault(); return; }
        e.stopPropagation();
        drag = { kind: 'photo', block: block.id, index };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-ecos', 'photo');
        ghost(e, isVid ? `<span class="ms">movie</span>${esc(t('Vídeo'))}` : `<img src="${esc(img.url)}" alt="">`);
        startDrag(fig);
      };
      fig.ondragend = () => { drag = null; endDrag(); };
      // Dentro de una galería o carrusel: soltar sobre una foto la coloca en su lugar
      if (index !== null) {
        this.acceptPhoto(fig, (got, d) => {
          const b = this.locate(block.id).b;
          let at = index;
          if (d.kind === 'photo' && d.block === block.id && d.index < index) at -= 1; // ya se sacó de antes
          b.images.splice(at + (d.kind === 'photo' && d.block === block.id && d.index < index ? 1 : 0), 0, got);
        }, { video: block.type === 'gallery' });
      }
      return fig;
    },

    urlField(label, onOk, focus = false) {
      const f = document.createElement('div');
      f.className = 'url-field';
      f.innerHTML = `<span class="ms">link</span><input placeholder="${esc(label)}"><button class="btn tonal small">${t('Insertar')}</button>`;
      const inp = $('input', f);
      const go = () => {
        const emb = detectEmbed(inp.value);
        if (!emb) { inp.classList.add('bad'); toast(t('Pega un enlace completo de YouTube, Vimeo, TikTok, Dailymotion, Spotify, SoundCloud, X, Instagram, Facebook o de un archivo de vídeo.')); return; }
        onOk(emb);
      };
      $('button', f).onclick = go;
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      inp.onpaste = () => setTimeout(() => { if (detectEmbed(inp.value)) go(); }, 0);
      if (focus) requestAnimationFrame(() => inp.focus());
      return f;
    },

    dropZone(label, onMedia, small = false, kind = 'image') {
      const z = document.createElement('div');
      z.className = 'drop-zone' + (small ? ' small' : '');
      z.innerHTML = `<span class="ms">${kind === 'video' ? 'movie' : 'add_photo_alternate'}</span><span>${esc(label)}</span>`;
      z.onclick = () => this.pickFromTray(onMedia, kind);
      return z;
    },
    // Acepta fotos/vídeos soltados desde la bandeja (o desde otra galería)
    // Compatibilidad: acepta fotos (de la bandeja o de otros bloques) en un contenedor
    acceptMedia(el, onMedia) { this.acceptPhoto(el, (img) => onMedia(img)); },

    pickFromTray(onMedia, kind) {
      const tray = $('#d-media');
      tray.classList.add('picking');
      const items = $$('.tray-item', tray).filter((x) => kind === 'any' || (kind === 'video') === (x.dataset.type === 'video'));
      const done = () => { tray.classList.remove('picking'); items.forEach((x) => (x.onclick = null)); };
      items.forEach((x) => (x.onclick = () => { done(); onMedia({ ...this.media[Number(x.dataset.i)] }); this.renderMedia(); }));
      setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!tray.contains(e.target)) { done(); document.removeEventListener('mousedown', off); } }), 0);
    },

    // --- Bandeja de fotos y vídeos ---------------------------------------------------
    renderMedia() {
      const tray = $('#d-media');
      const used = new Set(JSON.stringify(this.draft.blocks).match(/"id":\d+/g) || []);
      tray.innerHTML = this.media.length ? '' : `<p class="hint">${t('Sin fotos')}</p>`;
      this.media.forEach((m, i) => {
        const it = document.createElement('div');
        it.className = 'tray-item' + (used.has(`"id":${m.id}`) ? ' used' : '');
        it.dataset.i = i; it.dataset.type = m.type;
        it.draggable = true;
        it.innerHTML = m.type === 'video'
          ? `${m.poster ? `<img src="${esc(m.poster)}" alt="" draggable="false">` : `<video src="${esc(m.url)}" muted preload="metadata"></video>`}<span class="ms fill play">play_circle</span>`
          : `<img src="${esc(m.url)}" alt="" draggable="false">`;
        it.ondragstart = (e) => {
          drag = { kind: 'media', media: { ...m } }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/x-ecos', 'media');
          ghost(e, m.type === 'video' ? `<span class="ms">movie</span>${esc(t('Vídeo'))}` : `<img src="${esc(m.url)}" alt="">`); startDrag(it);
        };
        it.ondragend = () => { drag = null; endDrag(); };
        it.ondblclick = () => this.onOpenMedia(m);
        // ✕: quitar de la bandeja (y de la entrada, si está en ella). No se borra de la biblioteca de la web.
        const del = document.createElement('button');
        del.className = 'tray-del'; del.title = t('Quitar de la bandeja'); del.innerHTML = '<span class="ms">close</span>';
        del.draggable = false;
        del.onmousedown = (e) => e.stopPropagation();
        del.onclick = async (e) => {
          e.stopPropagation();
          const inBody = used.has(`"id":${m.id}`) || this.draft.featuredImageId === m.id;
          if (inBody && !await window.ask(t('Esta foto está puesta en la entrada. ¿Quitarla de la bandeja y también de la entrada? (Sigue en la biblioteca de medios de tu web.)'), { ok: t('Quitar'), danger: true })) return;
          this.change(() => {
            const d = this.draft, same = (x) => x && x.id === m.id;
            d.hiddenMedia = [...new Set([...(d.hiddenMedia || []), m.id])];
            d.extraMedia = (d.extraMedia || []).filter((x) => !same(x));
            if (d.featuredImageId === m.id) d.featuredImageId = null;
            const prune = (arr) => {
              for (let k = arr.length - 1; k >= 0; k--) if (['image', 'video'].includes(arr[k].type) && (same(arr[k].img) || same(arr[k].video))) arr.splice(k, 1);
              for (const b of arr) { if (b.images) b.images = b.images.filter((x) => !same(x)); if (same(b.img)) b.img = null; for (const l of this.kids(b)) prune(l); }
            };
            prune(d.blocks);
          });
          this.media = this.media.filter((x) => x.id !== m.id);
          this.renderMedia();
        };
        it.appendChild(del);
        tray.appendChild(it);
      });
      // Soltar en la bandeja una foto de la entrada la quita del contenido
      if (!tray.dataset.wired) {
        tray.dataset.wired = '1';
        const zone = tray.parentElement;
        zone.addEventListener('dragover', (e) => { if (drag?.kind === 'photo') { e.preventDefault(); zone.classList.add('over'); } });
        zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
        zone.addEventListener('drop', (e) => {
          zone.classList.remove('over');
          if (drag?.kind !== 'photo') return;
          e.preventDefault();
          const d = drag; drag = null; endDrag();
          this.change(() => this.take(d));
        });
      }
    },

    plainText() {
      return this.flat().map((b) => [b.summary, b.html, b.cite, ...(b.items || []), ...(b.rows || []).flat()].filter(Boolean).join('\n')).join('\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    },
  };

  let drag = null;
  let dragEl = null;
  // Marca visual mientras se arrastra (y avisa al resto de la app de que es un arrastre interno)
  function startDrag(el, cls = 'dragging-media') { dragEl = el; el.classList.add('dragging'); document.body.classList.add(cls, 'dragging-internal'); autoScroll.start(); }
  // Imagen pequeña que acompaña al ratón al arrastrar (en vez del bloque entero, que tapaba la pantalla)
  function ghost(e, html) {
    const g = document.createElement('div');
    g.className = 'drag-ghost';
    g.innerHTML = html;
    document.body.appendChild(g);
    e.dataTransfer.setDragImage(g, 18, 18);
    setTimeout(() => g.remove(), 0);
  }
  // Al arrastrar cerca del borde de arriba o de abajo, la página se desplaza sola (más rápido cuanto más cerca)
  const autoScroll = {
    y: -1, box: null, raf: 0,
    start() { if (!this.raf) this.raf = requestAnimationFrame(() => this.tick()); },
    stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.y = -1; this.box = null; },
    tick() {
      this.raf = requestAnimationFrame(() => this.tick());
      const box = this.box;
      if (!box || this.y < 0) return;
      const r = box.getBoundingClientRect(), edge = Math.min(110, r.height / 4);
      const top = this.y - r.top, bottom = r.bottom - this.y;
      if (top < edge) box.scrollTop -= Math.ceil(((edge - top) / edge) * 22);
      else if (bottom < edge) box.scrollTop += Math.ceil(((edge - bottom) / edge) * 22);
    },
  };
  const scroller = (el) => {
    for (let n = el instanceof Element ? el : null; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n;
    }
    return document.getElementById('ed-canvas');
  };
  document.addEventListener('dragover', (e) => { if (!drag) return; autoScroll.y = e.clientY; autoScroll.box = scroller(e.target); }, true);
  function endDrag() {
    autoScroll.stop();
    dragEl?.classList.remove('dragging'); dragEl = null;
    document.body.classList.remove('dragging-media', 'dragging-block', 'dragging-internal');
    $$('#editor .over').forEach((x) => x.classList.remove('over'));
  }
  document.addEventListener('dragend', endDrag);
  const toast = (m) => window.toast ? window.toast(m, true) : alert(m);
  const info = (m) => window.toast ? window.toast(m) : alert(m); // aviso que no es un error
  Object.assign(E, { detectEmbed, applyStyle, TEXT_TYPES, FONTS });
  window.BlockEditor = E;
})();
