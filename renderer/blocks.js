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
    video: { icon: 'movie', name: t('Vídeo') }, embed: { icon: 'smart_display', name: t('Vídeo de la red social') },
    separator: { icon: 'horizontal_rule', name: t('Separador') },
  });

  const E = {
    draft: null, media: [], onChange: () => {}, onOpenMedia: () => {},
    undo: [], redo: [],

    mount(draft, { media, onChange, onOpenMedia }) {
      this.draft = draft; this.media = media; this.onChange = onChange || (() => {}); this.onOpenMedia = onOpenMedia || (() => {});
      this.undo = []; this.redo = [];
      this.render(); this.renderMedia();
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
    change(fn, rerender = true) { this.snapshot(); fn(); if (rerender) this.render(); this.onChange(); },

    // --- Bloques nuevos ------------------------------------------------------------
    create(type, extra = {}) {
      const b = { id: bid(), type };
      if (type === 'paragraph' || type === 'quote') b.html = '';
      if (type === 'heading') { b.html = ''; b.level = 2; }
      if (type === 'list') { b.items = ['']; b.ordered = false; }
      if (type === 'gallery') { b.images = []; b.columns = 3; }
      if (type === 'carousel') b.images = [];
      if (type === 'mediatext') { b.img = null; b.html = ''; b.right = false; }
      if (type === 'image') { b.img = null; b.caption = ''; }
      if (type === 'video') b.video = null;
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
      $('#ed-count').textContent = t('{n} bloques', { n: this.draft.blocks.length });
      $('#ed-undo').disabled = !this.undo.length; $('#ed-redo').disabled = !this.redo.length;
      this.renderMedia();
    },

    // --- Arrastrar fotos ---------------------------------------------------------------
    // drag = { kind: 'media', media } desde la bandeja · { kind: 'photo', block, index } desde un bloque
    //        (index: posición en galería/carrusel; null en imagen e imagen y texto) · { kind: 'block', id }
    isPhoto(d) { return d && (d.kind === 'photo' || (d.kind === 'media' && d.media.type !== 'video')); },
    peek(d) {
      if (d.kind === 'media') return { ...d.media };
      const b = this.draft.blocks.find((x) => x.id === d.block);
      return b ? (d.index == null ? b.img : b.images[d.index]) : null;
    },
    // Saca la foto de donde estaba (si viene de un bloque) y la devuelve; llamar dentro de change()
    take(d) {
      if (d.kind === 'media') { const { type, poster, ...img } = d.media; return { ...img, alt: img.alt || '' }; }
      const i = this.draft.blocks.findIndex((x) => x.id === d.block);
      const b = this.draft.blocks[i];
      if (!b) return null;
      if (d.index != null) return b.images.splice(d.index, 1)[0];
      const img = b.img;
      if (b.type === 'image') this.draft.blocks.splice(i, 1); else b.img = null;
      return img;
    },
    // Hace que un elemento acepte fotos soltadas; onDrop(img) se ejecuta ya dentro de change()
    acceptPhoto(el, onDrop, { sameOk = () => true } = {}) {
      el.addEventListener('dragover', (e) => { if (this.isPhoto(drag) && sameOk(drag)) { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); } });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
      el.addEventListener('drop', (e) => {
        el.classList.remove('over');
        if (!this.isPhoto(drag) || !sameOk(drag)) return;
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
        : `<span class="ms">add_photo_alternate</span>${t('Arrastra aquí la imagen destacada')}`;
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
          const img = this.peek(drag); drag = null; endDrag();
          if (img) this.change(() => (this.draft.featuredImageId = img.id));
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
          this.change(() => { const img = this.take(d); if (img) this.draft.blocks.splice(at(), 0, this.create('image', { img })); });
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
      handle.ondragstart = (e) => { drag = { kind: 'block', id: b.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ecos', 'block'); e.dataTransfer.setDragImage(el, 20, 20); startDrag(el, 'dragging-block'); };
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
      el.oninput = () => { if (!snap) { this.snapshot(); snap = true; } onInput(el.innerHTML); this.onChange(); };
      el.onblur = () => { snap = false; };
      el.onpaste = (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); };
      el.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const u = prompt(t('Dirección del enlace (https://…)')); if (u) document.execCommand('createLink', false, u); }
        opts.onKey?.(e, el);
      };
      return el;
    },

    body(b, i, body, extra) {
      const self = this;
      const textBlock = (tag, cls) => this.editable(tag, b.html, t('Escribe aquí…'), (h) => (b.html = h), {
        cls,
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
        case 'paragraph': body.appendChild(textBlock('p')); break;

        case 'heading': {
          body.appendChild(textBlock('h' + b.level, 'h'));
          extra.innerHTML = [2, 3, 4].map((l) => `<button class="lv ${b.level === l ? 'on' : ''}" data-l="${l}">H${l}</button>`).join('');
          $$('.lv', extra).forEach((x) => (x.onclick = () => this.change(() => (b.level = Number(x.dataset.l)))));
          break;
        }

        case 'quote': {
          const q = document.createElement('blockquote');
          q.appendChild(textBlock('p'));
          q.appendChild(this.editable('cite', b.cite, t('Autor o fuente (opcional)'), (h) => (b.cite = h)));
          body.appendChild(q);
          break;
        }

        case 'list': {
          const list = document.createElement(b.ordered ? 'ol' : 'ul');
          b.items.forEach((it, k) => {
            const li = this.editable('li', it, t('Elemento'), (h) => (b.items[k] = h), {
              onKey(e, el) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.change(() => b.items.splice(k + 1, 0, '')); requestAnimationFrame(() => $$(`.blk[data-id="${b.id}"] li`)[k + 1]?.focus()); }
                if (e.key === 'Backspace' && !el.textContent.trim() && b.items.length > 1) { e.preventDefault(); self.change(() => b.items.splice(k, 1)); }
              },
            });
            list.appendChild(li);
          });
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
          grid.className = b.type === 'gallery' ? 'g-grid' : 'g-car';
          if (b.type === 'gallery') grid.style.setProperty('--cols', b.columns);
          b.images.forEach((img, k) => grid.appendChild(this.photo(img, () => this.change(() => b.images.splice(k, 1)), b, k)));
          const add = this.dropZone(b.images.length ? t('Suelta más fotos aquí') : t('Arrastra aquí fotos'), (m) => this.change(() => b.images.push({ ...m })), true);
          grid.appendChild(add);
          body.appendChild(grid);
          this.acceptPhoto(body, (img) => b.images.push(img)); // soltar en un hueco: al final
          // Convertir galería ↔ carrusel y elegir columnas
          extra.innerHTML = (b.type === 'gallery'
            ? [2, 3, 4].map((c) => `<button class="lv ${b.columns === c ? 'on' : ''}" data-c="${c}" title="${t('{n} columnas', { n: c })}">${c}<span class="ms">view_column</span></button>`).join('')
            : '') + `<button class="lv" data-sw="1" title="${b.type === 'gallery' ? t('Convertir en carrusel') : t('Convertir en galería')}"><span class="ms">${b.type === 'gallery' ? 'view_carousel' : 'grid_view'}</span></button>`;
          $$('[data-c]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.columns = Number(x.dataset.c)))));
          $('[data-sw]', extra).onclick = () => this.change(() => { b.type = b.type === 'gallery' ? 'carousel' : 'gallery'; b.columns = b.columns || 3; });
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
          if (!b.video) { body.appendChild(this.dropZone(t('Arrastra aquí un vídeo de la bandeja'), (m) => this.change(() => (b.video = m)), false, 'video')); break; }
          const v = document.createElement('video');
          v.src = b.video.url; v.controls = true; v.preload = 'metadata'; if (b.video.poster) v.poster = b.video.poster;
          body.appendChild(v);
          break;
        }

        case 'embed': {
          body.innerHTML = `<div class="embed-box"><span class="ms fill">smart_display</span><div><b>${t('Vídeo de {r}', { r: b.provider === 'facebook' ? 'Facebook' : 'Instagram' })}</b><div class="hint">${t('Se insertará la publicación original con su vídeo.')}</div></div></div>`;
          break;
        }

        case 'separator': body.innerHTML = '<hr>'; break;
        default: body.textContent = b.type;
      }
    },

    // Foto dentro de un bloque: ★ destacada, × quitar, alt, arrastrar para ordenar o sacar de la galería
    // Foto dentro de un bloque: ★ destacada, × quitar, alt; se arrastra a cualquier sitio
    photo(img, remove, block, index = null) {
      const fig = document.createElement('div');
      fig.className = 'ph' + (this.draft.featuredImageId === img.id ? ' featured' : '');
      fig.draggable = true;
      fig.innerHTML = `<img src="${esc(img.url)}" alt="" draggable="false">
        <button class="star" title="${t('Usar como imagen destacada')}"><span class="ms fill">star</span></button>
        <button class="del" title="${t('Quitar')}"><span class="ms">close</span></button>
        <input class="alt" placeholder="${t('Descripción (alt)')}" draggable="false">`;
      $('.alt', fig).value = img.alt || '';
      $('.alt', fig).oninput = (e) => { img.alt = e.target.value; this.onChange(); };
      $('.star', fig).onclick = () => this.change(() => (this.draft.featuredImageId = img.id));
      $('.del', fig).onclick = remove;
      $('img', fig).onclick = () => this.onOpenMedia(img);
      fig.ondragstart = (e) => {
        if (e.target.tagName === 'INPUT') { e.preventDefault(); return; }
        e.stopPropagation();
        drag = { kind: 'photo', block: block.id, index };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-ecos', 'photo');
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
        });
      }
      return fig;
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
      const items = $$('.tray-item', tray).filter((x) => (kind === 'video') === (x.dataset.type === 'video'));
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
        it.ondragstart = (e) => { drag = { kind: 'media', media: { ...m } }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/x-ecos', 'media'); startDrag(it); };
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
      return this.draft.blocks.map((b) => [b.html, b.cite, ...(b.items || [])].filter(Boolean).join('\n')).join('\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    },
  };

  let drag = null;
  let dragEl = null;
  // Marca visual mientras se arrastra (y avisa al resto de la app de que es un arrastre interno)
  function startDrag(el, cls = 'dragging-media') { dragEl = el; el.classList.add('dragging'); document.body.classList.add(cls, 'dragging-internal'); }
  function endDrag() {
    dragEl?.classList.remove('dragging'); dragEl = null;
    document.body.classList.remove('dragging-media', 'dragging-block', 'dragging-internal');
    $$('#editor .over').forEach((x) => x.classList.remove('over'));
  }
  document.addEventListener('dragend', endDrag);
  window.BlockEditor = E;
})();
