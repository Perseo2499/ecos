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
      const wrap = $('#d-blocks');
      wrap.innerHTML = '';
      wrap.appendChild(this.inserter(0));
      this.draft.blocks.forEach((b, i) => { wrap.appendChild(this.block(b, i)); wrap.appendChild(this.inserter(i + 1)); });
      if (!this.draft.blocks.length) {
        const empty = document.createElement('div'); empty.className = 'blk-empty';
        empty.innerHTML = `<span class="ms">add_circle</span>${t('Pulsa + para añadir un bloque o arrastra aquí una foto')}`;
        wrap.appendChild(empty);
      }
      $('#ed-count').textContent = t('{n} bloques', { n: this.draft.blocks.length });
      $('#ed-undo').disabled = !this.undo.length; $('#ed-redo').disabled = !this.redo.length;
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
        if (drag?.kind === 'block') {
          const from = this.draft.blocks.findIndex((b) => b.id === drag.id);
          if (from < 0) return;
          this.change(() => { const [b] = this.draft.blocks.splice(from, 1); this.draft.blocks.splice(from < i ? i - 1 : i, 0, b); });
        } else if (drag?.kind === 'media') {
          const m = drag.media;
          this.insertAt(i, m.type === 'video' ? this.create('video', { video: m }) : this.create('image', { img: { ...m } }), false);
        } else if (drag?.kind === 'img') {
          // una foto sacada de una galería o carrusel pasa a ser un bloque de imagen propio
          const src = this.draft.blocks.find((b) => b.id === drag.block);
          this.change(() => { const [img] = src.images.splice(drag.index, 1); this.draft.blocks.splice(i, 0, this.create('image', { img })); });
        }
        drag = null;
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
      handle.ondragstart = (e) => { drag = { kind: 'block', id: b.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(el, 20, 20); el.classList.add('dragging'); document.body.classList.add('dragging-block'); };
      handle.ondragend = () => { el.classList.remove('dragging'); document.body.classList.remove('dragging-block'); drag = null; };
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
          if (!b.img) { body.appendChild(this.dropZone(t('Arrastra aquí una foto de la bandeja'), (m) => this.change(() => (b.img = { ...m })))); break; }
          const fig = document.createElement('figure');
          fig.appendChild(this.photo(b.img, () => this.change(() => (b.img = null)), b));
          fig.appendChild(this.editable('figcaption', b.caption, t('Pie de foto (opcional)'), (h) => (b.caption = h)));
          body.appendChild(fig);
          this.acceptMedia(body, (m) => this.change(() => (b.img = { ...m })));
          break;
        }

        case 'gallery': case 'carousel': {
          const grid = document.createElement('div');
          grid.className = b.type === 'gallery' ? 'g-grid' : 'g-car';
          if (b.type === 'gallery') grid.style.setProperty('--cols', b.columns);
          b.images.forEach((img, k) => grid.appendChild(this.photo(img, () => this.change(() => b.images.splice(k, 1)), b, k)));
          const add = this.dropZone(b.images.length ? t('Suelta más fotos aquí') : t('Arrastra aquí fotos de la bandeja'), (m) => this.change(() => b.images.push({ ...m })), true);
          grid.appendChild(add);
          body.appendChild(grid);
          this.acceptMedia(body, (m) => this.change(() => b.images.push({ ...m })));
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
          this.acceptMedia(side, (m) => this.change(() => (b.img = { ...m })));
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
    photo(img, remove, block, index) {
      const fig = document.createElement('div');
      fig.className = 'ph' + (this.draft.featuredImageId === img.id ? ' featured' : '');
      fig.innerHTML = `<img src="${esc(img.url)}" alt="">
        <button class="star" title="${t('Usar como imagen destacada')}"><span class="ms fill">star</span></button>
        <button class="del" title="${t('Quitar')}"><span class="ms">close</span></button>
        <input class="alt" placeholder="${t('Descripción (alt)')}">`;
      $('.alt', fig).value = img.alt || '';
      $('.alt', fig).oninput = (e) => { img.alt = e.target.value; this.onChange(); };
      $('.star', fig).onclick = () => this.change(() => (this.draft.featuredImageId = img.id));
      $('.del', fig).onclick = remove;
      $('img', fig).onclick = () => this.onOpenMedia(img);
      if (index !== undefined) {
        // reordenar dentro de la galería/carrusel, o arrastrar fuera para convertirla en bloque propio
        fig.draggable = true;
        fig.ondragstart = (e) => { e.stopPropagation(); drag = { kind: 'img', block: block.id, index }; e.dataTransfer.effectAllowed = 'move'; fig.classList.add('dragging'); };
        fig.ondragend = () => { fig.classList.remove('dragging'); drag = null; };
        fig.ondragover = (e) => { if (drag?.kind === 'img' && drag.block === block.id) { e.preventDefault(); e.stopPropagation(); } };
        fig.ondrop = (e) => {
          if (drag?.kind !== 'img' || drag.block !== block.id) return;
          e.preventDefault(); e.stopPropagation();
          const from = drag.index; drag = null;
          this.change(() => { const [m] = block.images.splice(from, 1); block.images.splice(index, 0, m); });
        };
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
    acceptMedia(el, onMedia) {
      el.addEventListener('dragover', (e) => { if (drag?.kind === 'media' || drag?.kind === 'img') { e.preventDefault(); el.classList.add('over'); } });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        el.classList.remove('over');
        if (drag?.kind === 'media' && drag.media.type !== 'video') { e.preventDefault(); e.stopPropagation(); const m = drag.media; drag = null; onMedia(m); }
        else if (drag?.kind === 'img') {
          e.preventDefault(); e.stopPropagation();
          const src = this.draft.blocks.find((x) => x.id === drag.block); const idx = drag.index; drag = null;
          this.change(() => { const [m] = src.images.splice(idx, 1); onMedia.call(null, m); }, true);
        }
      });
    },
    // Al pulsar una zona vacía, se resaltan las fotos de la bandeja para elegir una
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
          ? `${m.poster ? `<img src="${esc(m.poster)}" alt="">` : `<video src="${esc(m.url)}" muted preload="metadata"></video>`}<span class="ms fill play">play_circle</span>`
          : `<img src="${esc(m.url)}" alt="">`;
        it.ondragstart = (e) => { drag = { kind: 'media', media: { ...m } }; e.dataTransfer.effectAllowed = 'copy'; document.body.classList.add('dragging-media'); };
        it.ondragend = () => { drag = null; document.body.classList.remove('dragging-media'); };
        it.ondblclick = () => this.onOpenMedia(m);
        tray.appendChild(it);
      });
    },

    // Texto de todos los bloques (para la IA)
    plainText() {
      return this.draft.blocks.map((b) => [b.html, b.cite, ...(b.items || [])].filter(Boolean).join('\n')).join('\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
    },
  };

  let drag = null;
  window.BlockEditor = E;
})();
