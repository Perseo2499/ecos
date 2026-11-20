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
    raw: { icon: 'code_blocks', name: t('De WordPress') },
  });
  const TEXT_TYPES = ['paragraph', 'heading', 'quote', 'list'];

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
  }

  const E = {
    draft: null, media: [], onChange: () => {}, onOpenMedia: () => {},
    undo: [], redo: [],

    mount(draft, { media, onChange, onOpenMedia, onPeekCss }) {
      this.draft = draft; this.media = media; this.onChange = onChange || (() => {}); this.onOpenMedia = onOpenMedia || (() => {}); this.onPeekCss = onPeekCss;
      this.undo = []; this.redo = [];
      this.liftFeatured(); // la destacada va arriba y sale del cuerpo
      this.render(); this.renderMedia();
    },
    // Fotos del cuerpo de la entrada
    bodyImages() { return this.draft.blocks.flatMap((b) => (b.img ? [b.img] : b.images || [])); },
    // Saca la imagen destacada del cuerpo (si está) para que no salga dos veces en la web
    liftFeatured() {
      const id = this.draft.featuredImageId;
      if (id == null) return false;
      let found = false;
      for (let i = this.draft.blocks.length - 1; i >= 0; i--) {
        const b = this.draft.blocks[i];
        if (b.img?.id === id) { found = true; if (b.type === 'image') this.draft.blocks.splice(i, 1); else b.img = null; }
        if (b.images?.some((x) => x.id === id)) { found = true; b.images = b.images.filter((x) => x.id !== id); }
      }
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
      return Object.assign(b, extra);
    },
    insertAt(i, block, focus = true) {
      this.change(() => this.draft.blocks.splice(i, 0, block));
      if (focus) this.focus(block.id);
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
    render() {
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
    },

    // --- Arrastrar fotos ---------------------------------------------------------------
    // drag = { kind: 'media', media } desde la bandeja · { kind: 'photo', block, index } desde un bloque
    //        (index: posición en galería/carrusel; null en imagen e imagen y texto) · { kind: 'block', id }
    isPhoto(d) { return !!d && (d.kind === 'photo' ? this.peek(d)?.type !== 'video' : d.kind === 'media' && d.media.type !== 'video'); },
    // foto o vídeo (para galerías y mosaicos)
    isItem(d) { return !!d && (d.kind === 'photo' || d.kind === 'media'); },
    peek(d) {
      if (d.kind === 'media') return { ...d.media };
      const b = this.draft.blocks.find((x) => x.id === d.block);
      return b ? (d.index == null ? b.img : b.images[d.index]) : null;
    },
    // Saca la foto de donde estaba (si viene de un bloque) y la devuelve; llamar dentro de change()
    take(d) {
      if (d.kind === 'media') {
        const { type, poster, ...m } = d.media;
        return type === 'video' ? { ...m, type: 'video', ...(poster ? { poster } : {}) } : { ...m, alt: m.alt || '' };
      }
      const i = this.draft.blocks.findIndex((x) => x.id === d.block);
      const b = this.draft.blocks[i];
      if (!b) return null;
      if (d.index != null) return b.images.splice(d.index, 1)[0];
      const img = b.img;
      if (b.type === 'image') this.draft.blocks.splice(i, 1); else b.img = null;
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
      $('.cover-del', box)?.addEventListener('click', () => this.change(() => (this.draft.featuredImageId = null)));
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
          this.change(() => { const img = this.take(d); if (img) { this.draft.featuredImageId = img.id; this.liftFeatured(); } });
        });
      }
    },

    // Línea con «+» entre bloques; también recibe fotos y bloques arrastrados
    inserter(i) {
      const el = document.createElement('div');
      el.className = 'ins';
      el.innerHTML = `<button class="ins-btn" title="${t('Añadir bloque')}"><span class="ms">add</span></button>`;
      el.querySelector('button').onclick = (e) => this.openMenu(e.currentTarget, (type) => this.insertAt(i, this.create(type)));
      el.ondragover = (e) => { if (drag) { e.preventDefault(); el.classList.add('over'); } };
      el.ondragleave = () => el.classList.remove('over');
      el.ondrop = (e) => {
        e.preventDefault(); el.classList.remove('over');
        const d = drag; drag = null; endDrag();
        if (!d) return;
        // posición estable: el bloque que estaba justo después de la línea (puede moverse al sacar la foto)
        const after = this.draft.blocks[i]?.id;
        const at = () => (after ? this.draft.blocks.findIndex((b) => b.id === after) : this.draft.blocks.length);
        if (d.kind === 'block') {
          const from = this.draft.blocks.findIndex((b) => b.id === d.id);
          if (from < 0 || from === i || from === i - 1) return;
          this.change(() => { const [b] = this.draft.blocks.splice(from, 1); this.draft.blocks.splice(at(), 0, b); });
        } else if (d.kind === 'media' && d.media.type === 'video') {
          this.change(() => this.draft.blocks.splice(at(), 0, this.create('video', { video: d.media })));
        } else {
          // foto de la bandeja o sacada de un bloque → bloque de imagen propio en esa posición
          this.change(() => {
            const it = this.take(d);
            if (!it) return;
            if (it.type === 'video') { const { type, ...video } = it; this.draft.blocks.splice(at(), 0, this.create('video', { video })); } else this.draft.blocks.splice(at(), 0, this.create('image', { img: it }));
          });
        }
      };
      return el;
    },

    openMenu(anchor, pick) {
      const menu = $('#ins-menu');
      const r = anchor.getBoundingClientRect();
      menu.classList.remove('hidden');
      const h = menu.offsetHeight;
      menu.style.left = Math.min(innerWidth - menu.offsetWidth - 12, Math.max(12, r.left - 120)) + 'px';
      menu.style.top = (r.bottom + h + 12 > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
      $$('button', menu).forEach((b) => (b.onclick = () => { menu.classList.add('hidden'); pick(b.dataset.type); }));
      setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!menu.contains(e.target)) { menu.classList.add('hidden'); document.removeEventListener('mousedown', off); } }), 0);
    },

    block(b, i) {
      const T = TYPES()[b.type] || { icon: 'help', name: b.type };
      const el = document.createElement('div');
      el.className = `blk blk-${b.type}`;
      el.dataset.id = b.id;
      el.innerHTML = `
        <div class="blk-tools">
          <span class="blk-handle" draggable="true" title="${t('Arrastra para mover')}"><span class="ms">drag_indicator</span></span>
          <span class="blk-type"><span class="ms">${T.icon}</span>${esc(T.name)}</span>
          <span class="blk-extra"></span>
          <span class="spacer"></span>
          <button data-a="up" title="${t('Subir')}" ${i === 0 ? 'disabled' : ''}><span class="ms">arrow_upward</span></button>
          <button data-a="down" title="${t('Bajar')}" ${i === this.draft.blocks.length - 1 ? 'disabled' : ''}><span class="ms">arrow_downward</span></button>
          <button data-a="dup" title="${t('Duplicar')}"><span class="ms">content_copy</span></button>
          <button data-a="del" title="${t('Eliminar bloque')}"><span class="ms">delete</span></button>
        </div>
        <div class="blk-body"></div>`;
      const act = {
        up: () => this.change(() => { const a = this.draft.blocks; [a[i - 1], a[i]] = [a[i], a[i - 1]]; }),
        down: () => this.change(() => { const a = this.draft.blocks; [a[i + 1], a[i]] = [a[i], a[i + 1]]; }),
        dup: () => this.change(() => this.draft.blocks.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(b)), id: bid() })),
        del: () => this.change(() => this.draft.blocks.splice(i, 1)),
      };
      $$('.blk-tools [data-a]', el).forEach((btn) => (btn.onclick = act[btn.dataset.a]));
      const handle = $('.blk-handle', el);
      handle.ondragstart = (e) => { drag = { kind: 'block', id: b.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ecos', 'block'); ghost(e, `<span class="ms">${T.icon}</span>${esc(T.name)}`); startDrag(el, 'dragging-block'); };
      handle.ondragend = () => { drag = null; endDrag(); };
      this.body(b, i, $('.blk-body', el), $('.blk-extra', el));
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
      const i = this.draft.blocks.indexOf(b);
      if (i < 0) return;
      this.change(() => this.draft.blocks.splice(i, 1, nb));
      if (focus) this.focus(nb.id);
    },
    // Atajos al estilo Markdown al principio de un párrafo: «## », «- », «1. », «> », «---» y «/» para el menú
    shortcut(e, el, b) {
      const txt = el.textContent;
      if (e.key === '/' && !txt.trim()) {
        e.preventDefault();
        this.openMenu(el, (type) => this.replaceBlock(b, this.create(type)));
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
      for (const k of ['align', 'size', 'font', 'color', 'bg']) if (b[k]) nb[k] = b[k];
      if (type === 'list') nb.items = b.type === 'list' ? b.items : text.split(/<br\s*\/?>/i).filter((x) => x.replace(/<[^>]+>/g, '').trim()).concat(text ? [] : ['']);
      else nb.html = text;
      if (type === 'list' && !nb.items.length) nb.items = [''];
      if (type === 'quote' && b.type === 'quote') { nb.cite = b.cite; }
      this.replaceBlock(b, nb);
    },
    refreshToc() {
      const heads = this.draft.blocks.filter((h) => h.type === 'heading' && (h.level || 2) <= 3 && (h.html || '').replace(/<[^>]+>/g, '').trim());
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

    body(b, i, body, extra) {
      const self = this;
      const textBlock = (tag, cls) => this.editable(tag, b.html, b.type === 'paragraph' ? t('Escribe aquí… (pulsa / para elegir un bloque)') : t('Escribe aquí…'), (h) => (b.html = h), {
        cls, block: b,
        onKey(e, el) {
          // Intro al final de un párrafo crea otro; Retroceso en un bloque vacío lo borra
          if (b.type === 'paragraph' && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            self.insertAt(i + 1, self.create('paragraph'));
          }
          if (e.key === 'Backspace' && !el.textContent.trim() && self.draft.blocks.length > 1 && ['paragraph', 'heading'].includes(b.type)) {
            e.preventDefault();
            const prev = self.draft.blocks[i - 1];
            self.change(() => self.draft.blocks.splice(i, 1));
            if (prev) self.focus(prev.id, true);
          }
        },
      });

      switch (b.type) {
        case 'paragraph': { const p = textBlock('p'); applyStyle(p, b); body.appendChild(p); break; }

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
          const qp = this.editable('p', b.html, t('Escribe aquí…'), (h) => (b.html = h), { cls: '', block: b, styleEl: q });
          q.appendChild(qp);
          q.appendChild(this.editable('cite', b.cite, t('Autor o fuente (opcional)'), (h) => (b.cite = h), { block: b, styleEl: q }));
          applyStyle(q, b);
          body.appendChild(q);
          extra.innerHTML = `<button class="lv ${!b.pull ? 'on' : ''}" data-p="0" title="${t('Cita normal')}"><span class="ms">format_quote</span></button><button class="lv ${b.pull ? 'on' : ''}" data-p="1" title="${t('Cita destacada (grande y centrada)')}"><span class="ms">format_quote</span>+</button>`;
          $$('[data-p]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.pull = x.dataset.p === '1'))));
          break;
        }

        case 'list': {
          const list = document.createElement(b.ordered ? 'ol' : 'ul');
          b.items.forEach((it, k) => {
            const li = this.editable('li', it, t('Elemento'), (h) => (b.items[k] = h), {
              block: b, styleEl: list,
              onKey(e, el) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.change(() => b.items.splice(k + 1, 0, '')); requestAnimationFrame(() => $$(`.blk[data-id="${b.id}"] li`)[k + 1]?.focus()); }
                if (e.key === 'Backspace' && !el.textContent.trim() && b.items.length > 1) { e.preventDefault(); self.change(() => b.items.splice(k, 1)); }
              },
            });
            list.appendChild(li);
          });
          applyStyle(list, b);
          body.appendChild(list);
          extra.innerHTML = `<button class="lv ${!b.ordered ? 'on' : ''}" data-o="0"><span class="ms">format_list_bulleted</span></button><button class="lv ${b.ordered ? 'on' : ''}" data-o="1"><span class="ms">format_list_numbered</span></button>`;
          $$('.lv', extra).forEach((x) => (x.onclick = () => this.change(() => (b.ordered = x.dataset.o === '1'))));
          break;
        }

        case 'image': {
          if (!b.img) { body.appendChild(this.dropZone(t('Arrastra aquí una foto'), (m) => this.change(() => (b.img = { ...m })))); this.acceptPhoto(body, (img) => (b.img = img)); break; }
          const fig = document.createElement('figure');
          fig.appendChild(this.photo(b.img, () => this.change(() => this.draft.blocks.splice(this.draft.blocks.indexOf(b), 1)), b));
          fig.appendChild(this.editable('figcaption', b.caption, t('Pie de foto (opcional)'), (h) => (b.caption = h)));
          body.appendChild(fig);
          // soltar otra foto sobre esta imagen las junta en una galería
          this.acceptPhoto(body, (img) => { b.type = 'gallery'; b.images = [b.img, img]; b.columns = 2; delete b.img; delete b.caption; },
            { sameOk: (d) => !(d.kind === 'photo' && d.block === b.id) });
          break;
        }

        case 'gallery': case 'carousel': {
          const grid = document.createElement('div');
          grid.className = b.type === 'gallery' ? 'g-grid' + (b.layout === 'mosaic' ? ' mosaic' : '') : `g-car v-${b.view || 'single'}${b.squares ? ' squares' : ''}`;
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
            .map(([k, ic, n]) => `<button class="lv ${lay === k ? 'on' : ''}" data-lay="${k}" title="${n}"><span class="ms">${ic}</span>${n}</button>`).join('')
            + (lay === 'grid' ? '<span class="lv-sep"></span>' + [2, 3, 4].map((c) => `<button class="lv ${b.columns === c ? 'on' : ''}" data-c="${c}" title="${t('{n} columnas', { n: c })}">${c}<span class="ms">view_column</span></button>`).join('') : '')
            // estilo del carrusel
            + (lay === 'carousel' ? '<span class="lv-sep"></span>' + [['single', 'crop_landscape', t('Una a una')], ['multi', 'view_week', t('Varias a la vez')], ['peek', 'view_carousel', t('Vecinas asomando')]]
              .map(([k, ic, n]) => `<button class="lv ${(b.view || 'single') === k ? 'on' : ''}" data-view="${k}" title="${n}"><span class="ms">${ic}</span>${n}</button>`).join('')
              + `<button class="lv ${b.squares ? 'on' : ''}" data-sq="1" title="${t('Recorta todas las fotos en cuadrado')}"><span class="ms">crop_square</span>${t('Cuadradas')}</button>`
              + (b.view === 'peek' ? `<button class="lv" data-peekcss="1" title="${t('Copia el estilo que hay que pegar una vez en tu web')}"><span class="ms">content_copy</span>${t('Estilo para la web')}</button>` : '') : '');
          $$('[data-c]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.columns = Number(x.dataset.c)))));
          $$('[data-view]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.view = x.dataset.view))));
          $$('[data-sq]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.squares = !b.squares))));
          $$('[data-peekcss]', extra).forEach((x) => (x.onclick = () => this.onPeekCss?.()));
          $$('[data-lay]', extra).forEach((x) => (x.onclick = () => this.change(() => {
            const k = x.dataset.lay;
            if (k === 'carousel') {
              // los vídeos no caben en el carrusel: salen como bloques de vídeo justo después
              const vs = b.images.filter((i) => i.type === 'video');
              if (vs.length) {
                b.images = b.images.filter((i) => i.type !== 'video');
                const at = this.draft.blocks.indexOf(b) + 1;
                this.draft.blocks.splice(at, 0, ...vs.map(({ type, ...video }) => this.create('video', { video })));
                toast(t('Los vídeos no van en el carrusel: se han puesto debajo como bloques de vídeo.'));
              }
              b.type = 'carousel';
            } else { b.type = 'gallery'; b.layout = k; b.columns = b.columns || 3; }
          })));
          break;
        }

        case 'mediatext': {
          const row = document.createElement('div');
          row.className = 'mt' + (b.right ? ' right' : '');
          const side = document.createElement('div');
          side.className = 'mt-media';
          if (b.img) side.appendChild(this.photo(b.img, () => this.change(() => (b.img = null)), b));
          else side.appendChild(this.dropZone(t('Arrastra una foto'), (m) => this.change(() => (b.img = { ...m }))));
          this.acceptPhoto(side, (img) => (b.img = img), { sameOk: (d) => !(d.kind === 'photo' && d.block === b.id) });
          const text = this.editable('div', b.html, t('Texto junto a la imagen…'), (h) => (b.html = h), { cls: 'mt-text' });
          row.append(side, text);
          body.appendChild(row);
          extra.innerHTML = `<button class="lv" data-flip="1" title="${t('Cambiar de lado')}"><span class="ms">swap_horiz</span></button>`;
          $('[data-flip]', extra).onclick = () => this.change(() => (b.right = !b.right));
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
          body.appendChild(this.editable('figcaption', b.caption, t('Pie del vídeo (opcional)'), (h) => (b.caption = h)));
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
          body.appendChild(this.editable('figcaption', b.caption, t('Pie de tabla (opcional)'), (h) => (b.caption = h)));
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
          wrap.className = 'ed-btns'; wrap.style.justifyContent = b.align === 'center' ? 'center' : b.align === 'right' ? 'flex-end' : 'flex-start';
          const btn = this.editable('span', b.html, t('Texto del botón'), (h) => (b.html = h), { cls: 'ed-btn' + (b.variant === 'outline' ? ' outline' : ''), block: b, onKey(e) { if (e.key === 'Enter') e.preventDefault(); } });
          wrap.appendChild(btn);
          body.appendChild(wrap);
          const url = document.createElement('input');
          url.className = 'ed-btn-url'; url.placeholder = t('Enlace del botón (https://…)'); url.value = b.url || '';
          url.oninput = () => { b.url = url.value.trim(); this.onChange(); };
          body.appendChild(url);
          extra.innerHTML = ['left', 'center', 'right'].map((a) => `<button class="lv ${b.align === a ? 'on' : ''}" data-al="${a}"><span class="ms">format_align_${a}</span></button>`).join('')
            + `<button class="lv ${b.variant !== 'outline' ? 'on' : ''}" data-v="fill" title="${t('Relleno')}"><span class="ms fill">smart_button</span></button><button class="lv ${b.variant === 'outline' ? 'on' : ''}" data-v="outline" title="${t('Contorno')}"><span class="ms">smart_button</span></button>`;
          $$('[data-al]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.align = x.dataset.al))));
          $$('[data-v]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.variant = x.dataset.v))));
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
          const sum = this.editable('div', b.summary, t('Pregunta o título que se ve siempre'), (h) => (b.summary = h), { cls: 'ed-sum', block: b, onKey(e) { if (e.key === 'Enter') e.preventDefault(); } });
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

        case 'separator': body.innerHTML = '<hr>'; break;
        case 'raw': {
          const text = (b.markup || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          body.innerHTML = `<div class="raw-box"><span class="ms">code_blocks</span><div><b>${t('Bloque de WordPress «{n}»', { n: esc(b.label || 'html') })}</b><div class="hint">${t('Se hizo en WordPress; Ecos lo conserva tal cual al enviar.')}</div>${text ? `<div class="raw-text">${esc(text.slice(0, 220))}${text.length > 220 ? '…' : ''}</div>` : ''}</div></div>`;
          break;
        }
        default: body.textContent = b.type;
      }
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
      $('.star', fig).onclick = () => this.change(() => { this.draft.featuredImageId = img.id; this.liftFeatured(); });
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
          const b = this.draft.blocks.find((x) => x.id === block.id);
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
      return this.draft.blocks.map((b) => [b.summary, b.html, b.cite, ...(b.items || []), ...(b.rows || []).flat()].filter(Boolean).join('\n')).join('\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
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
  Object.assign(E, { detectEmbed, applyStyle, TEXT_TYPES, FONTS });
  window.BlockEditor = E;
})();
