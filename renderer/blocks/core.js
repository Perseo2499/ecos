// Editor de bloques de Ecos: el contenido de la entrada es una lista de bloques que se escriben, se
// reordenan arrastrando y se combinan con fotos y vídeos. Cada bloque corresponde a un bloque estándar
// de WordPress (ver composeBlocks en src/transform.js), así en la web se ve con la misma estructura.
//
// El editor está repartido en varios archivos de renderer/blocks/ (scripts clásicos, mismo ámbito global); todos
// añaden sus métodos al objeto BlockEditor que crea este archivo, y se cargan en este orden (ver index.html):
//   kit.js (utilidades) → core.js (estado, árbol de bloques, deshacer, change / repaintBlock / render)
//   → drag.js (arrastrar y soltar) → block.js (marco de cada bloque y texto editable) → body.js (reparte por tipo)
//   → types/*.js (el cuerpo y la barra de cada tipo de bloque) → style.js (panel «Estilo» y menús desplegables)
//   → media.js (foto dentro de un bloque y bandeja)
(function () {
  const K = window.BlockKit;
  const { $, $$, t, bid, SK, toast, detectEmbed, applyStyle, TEXT_TYPES, FONTS } = K;

  const E = {
    draft: null, media: [], onChange: () => {}, onOpenMedia: () => {},
    undo: [], redo: [],

    mount(draft, { media, onChange, onOpenMedia, onPeekCss, onReplaceVideo }) {
      this.draft = draft; this.media = media; this.onChange = onChange || (() => {}); this.onOpenMedia = onOpenMedia || (() => {}); this.onPeekCss = onPeekCss; this.onReplaceVideo = onReplaceVideo;
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
    // --- Capas y selección múltiple (la interfaz está en layers.js; aquí la lógica, sin DOM) -----------------------
    // Texto corto de un bloque para la lista de capas: primeras palabras, nombre de la foto…
    summary(b) {
      const plain = (h) => String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
      const words = (s, n = 7) => { const w = plain(s).split(' ').filter(Boolean); return w.slice(0, n).join(' ') + (w.length > n ? '…' : ''); };
      const file = (u) => { try { return decodeURIComponent(String(u || '').split('?')[0].split('/').pop() || ''); } catch { return String(u || '').split('/').pop(); } };
      const photo = (i) => (i ? plain(i.alt) || plain(i.title) || file(i.url) : '');
      switch (b.type) {
        case 'paragraph': case 'heading': case 'quote': case 'buttons': return words(b.html);
        case 'list': return words((b.items || [])[0]);
        case 'image': return photo(b.img) || words(b.caption);
        case 'mediatext': return words(b.html) || photo(b.img);
        case 'gallery': case 'carousel': { const n = (b.images || []).length; return n ? t(n === 1 ? '{n} foto' : '{n} fotos', { n }) : ''; }
        case 'video': return plain(b.video?.title) || file(b.video?.url);
        case 'embed': return file(b.url) || b.url || '';
        case 'table': return words((b.rows || [])[0]?.[0]);
        case 'details': return words(b.summary);
        case 'toc': return words(b.title);
        case 'map': return words(b.address);
        case 'group': case 'cover': { const n = (b.children || []).length; return n ? t(n === 1 ? '{n} bloque' : '{n} bloques', { n }) : ''; }
        case 'columns': return t('{n} columnas', { n: (b.cols || []).length });
        default: return '';
      }
    },
    // Árbol de capas: [{ id, type, summary, kids: [...] }]. Las columnas aparecen como filas «col» con sus bloques dentro.
    layerTree(arr = this.draft?.blocks || []) {
      return arr.map((b) => {
        const n = { id: b.id, type: b.type, summary: this.summary(b), kids: [] };
        if (Array.isArray(b.children)) n.kids = this.layerTree(b.children);
        else if (Array.isArray(b.cols)) n.kids = b.cols.map((c, i) => ({ id: `${b.id}#${i}`, type: 'col', owner: b.id, index: i, summary: c.width || '', kids: this.layerTree(c.children || []) }));
        return n;
      });
    },
    // La lista en la que está `arr` pertenece a este contenedor (null si es la raíz)
    ownerOf(arr) {
      if (arr === this.draft.blocks) return null;
      return this.flat().find((b) => this.kids(b).includes(arr)) || null;
    },
    // Ids seleccionados reducidos a los de más arriba (si el contenedor está elegido, sus hijos no), en el orden del documento
    topIds(ids) {
      const set = new Set(ids);
      return this.flat().filter((b) => set.has(b.id)).filter((b) => {
        let loc = this.locate(b.id);
        while (loc?.parent) { if (set.has(loc.parent.id)) return false; loc = this.locate(loc.parent.id); }
        return true;
      }).map((b) => b.id);
    },
    // Rango entre dos bloques del mismo nivel (si no están en la misma lista, solo el segundo)
    rangeIds(fromId, toId) {
      const a = this.locate(fromId), b = this.locate(toId);
      if (!a || !b || a.arr !== b.arr) return b ? [toId] : [];
      const [i, j] = a.i < b.i ? [a.i, b.i] : [b.i, a.i];
      return a.arr.slice(i, j + 1).map((x) => x.id);
    },
    // Mueve bloques (por id) a la lista `dest`, justo antes del bloque `beforeId` (o al final). Un contenedor no entra en sí mismo.
    // Se llama dentro de change(); devuelve si ha movido algo.
    moveBlocks(ids, dest, beforeId = null) {
      const owner = this.ownerOf(dest);
      const top = this.topIds(ids).map((id) => this.locate(id)?.b).filter(Boolean);
      if (!top.length || top.some((m) => owner && this.holds(m, owner.id))) return false;
      // si el bloque de referencia también se mueve, se toma el siguiente que se quede
      const moving = new Set(top.map((m) => m.id));
      while (beforeId && moving.has(beforeId)) { const k = dest.findIndex((x) => x.id === beforeId); beforeId = dest[k + 1]?.id || null; }
      for (const m of top) { const l = this.locate(m.id); l.arr.splice(l.i, 1); }
      const at = beforeId ? dest.findIndex((x) => x.id === beforeId) : -1;
      dest.splice(at < 0 ? dest.length : at, 0, ...top);
      return true;
    },
    // ¿Se puede soltar `ids` dentro de `dest`? (un contenedor no entra en sí mismo)
    canMoveTo(ids, dest) {
      const owner = this.ownerOf(dest);
      return !owner || !this.topIds(ids).some((id) => { const l = this.locate(id); return l && this.holds(l.b, owner.id); });
    },
    // Subir (-1) o bajar (1) los bloques elegidos dentro de su lista; los de cada lista se mueven juntos
    shiftIds(ids, dir) {
      const set = new Set(this.topIds(ids));
      let moved = false;
      const lists = new Set([...set].map((id) => this.locate(id)?.arr).filter(Boolean));
      for (const arr of lists) {
        const idx = arr.map((b, i) => (set.has(b.id) ? i : -1)).filter((i) => i >= 0);
        if (dir < 0) { for (const i of idx) if (i > 0 && !set.has(arr[i - 1].id)) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; moved = true; } }
        else for (const i of idx.reverse()) if (i < arr.length - 1 && !set.has(arr[i + 1].id)) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; moved = true; }
      }
      return moved;
    },
    // Duplica los bloques elegidos (cada copia justo después de su original); devuelve los ids nuevos
    duplicateIds(ids) {
      const out = [];
      for (const id of this.topIds(ids)) { const l = this.locate(id); const c = this.cloneBlock(l.b); l.arr.splice(l.i + 1, 0, c); out.push(c.id); }
      return out;
    },
    deleteIds(ids) { for (const id of this.topIds(ids)) { const l = this.locate(id); if (l) l.arr.splice(l.i, 1); } },
    // Agrupa bloques del mismo nivel en una sección nueva (en el sitio del primero); devuelve el grupo o null
    groupIds(ids) {
      const top = this.topIds(ids).map((id) => this.locate(id));
      if (!top.length || top.some((l) => l.arr !== top[0].arr)) return null;
      const arr = top[0].arr, g = this.create('group');
      const blocks = top.map((l) => l.b), at = Math.min(...top.map((l) => l.i));
      g.children = blocks;
      for (const b of blocks) arr.splice(arr.indexOf(b), 1);
      arr.splice(at, 0, g);
      return g;
    },
    // Portapapeles interno de bloques (copias con sus hijos; al pegar reciben ids nuevos)
    clip: [],
    copyIds(ids) { this.clip = this.topIds(ids).map((id) => JSON.parse(JSON.stringify(this.locate(id).b))); return this.clip.length; },
    // Pega después de `afterId` (o al final de la entrada); devuelve los ids pegados. Llamar dentro de change()
    pasteClip(afterId = null) {
      const copies = this.clip.map((b) => this.cloneBlock(b));
      const l = afterId ? this.locate(afterId) : null;
      if (l) l.arr.splice(l.i + 1, 0, ...copies); else this.draft.blocks.push(...copies);
      return copies.map((b) => b.id);
    },

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
    // Marca que `fn` puede devolver a change(fn, id) para pedir que se repinte todo el editor (p. ej. si movió el bloque)
    FULL: Symbol('repintar todo'),
    // Un cambio con un solo paso de «deshacer»: `fn` modifica el borrador y después se repinta:
    //  · change(fn)        → todo el editor (render): para añadir, quitar o mover bloques y para cambiar fotos (la bandeja también cambia)
    //  · change(fn, id)    → solo el bloque `id` (repaintBlock): para las opciones que solo le afectan (colocación, tamaño, columnas,
    //                        vistas…); los demás bloques no se tocan, así no pierden foco, selección ni desplazamiento.
    //                        Si `fn` devuelve this.FULL, se repinta todo (p. ej. si de rebote movió el bloque)
    //  · change(fn, false) → no se repinta (lo hace quien llama)
    change(fn, target = true) {
      this.snapshot();
      const before = this.draft.featuredImageId;
      let full = fn() === this.FULL;
      // si la destacada se ha metido en el cuerpo, deja de ser la destacada (no puede estar en los dos sitios)
      const id = this.draft.featuredImageId;
      if (id != null && id === before && this.bodyImages().some((x) => x.id === id)) {
        this.draft.featuredImageId = null;
        toast(t('La foto ha pasado al cuerpo de la entrada y ya no es la imagen destacada.'));
        full = true; // la portada y la bandeja también cambian
      }
      if (target === true || target == null || full) this.render();
      else if (target !== false && !this.repaintBlock(target)) this.render();
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


    // Cambio que solo afecta a un bloque (opciones de estilo, menús del carrusel…): se vuelve a pintar solo ese bloque,
    // sin redibujar todo el editor ni cerrar el menú abierto (antes cada opción hacía parpadear la pantalla entera)
    repaintBlock(id) {
      const loc = this.locate(id), old = document.querySelector(`#d-blocks .blk[data-id="${CSS.escape(String(id))}"]`);
      if (!loc || !old) return false;
      // si el cursor estaba en un texto de este bloque, se vuelve a poner en el mismo sitio (si el bloque conserva sus textos)
      const eds = [...old.querySelectorAll('[contenteditable]')], at = eds.indexOf(document.activeElement);
      let caret = null;
      if (at >= 0) {
        const sel = getSelection();
        if (sel.rangeCount && eds[at].contains(sel.anchorNode)) {
          const r = document.createRange(); r.selectNodeContents(eds[at]); r.setEnd(sel.anchorNode, sel.anchorOffset);
          caret = r.toString().length;
        }
      }
      const nu = this.block(loc.b, loc.i, loc.arr, loc.parent ? loc.parent.id : null);
      for (const c of ['tools-on', 'pinned']) if (old.classList.contains(c)) nu.classList.add(c);
      if (this.pinned === old) this.pinned = nu;
      old.replaceWith(nu);
      $$('img', nu).forEach((im) => { im.draggable = false; });
      if (at >= 0) {
        const now = [...nu.querySelectorAll('[contenteditable]')];
        if (now.length === eds.length) {
          now[at].focus();
          if (caret !== null) {
            const w = document.createTreeWalker(now[at], NodeFilter.SHOW_TEXT);
            const r = document.createRange(); r.selectNodeContents(now[at]); r.collapse(false);
            let left = caret;
            for (let n = w.nextNode(); n; n = w.nextNode()) { if (left <= n.length) { r.setStart(n, left); r.collapse(true); break; } left -= n.length; }
            const s = getSelection(); s.removeAllRanges(); s.addRange(r);
          }
        }
      }
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

    // Palabras y tiempo de lectura
    stats() {
      const words = this.plainText().split(/\s+/).filter(Boolean).length;
      return { words, minutes: Math.max(1, Math.round(words / 200)) };
    },

    plainText() {
      return this.flat().map((b) => [b.summary, b.html, b.cite, ...(b.items || []), ...(b.rows || []).flat()].filter(Boolean).join('\n')).join('\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    },
  };

  Object.assign(E, { detectEmbed, applyStyle, TEXT_TYPES, FONTS });
  window.BlockEditor = E;
})();
