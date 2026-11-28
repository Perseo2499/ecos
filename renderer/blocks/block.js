// Editor de bloques · el marco de cada bloque (barra, asa de arrastre, subir/bajar/duplicar/eliminar), las listas anidadas, el menú «+»,
// el texto editable con negrita/cursiva/enlaces y las conversiones entre bloques de texto.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, esc, TYPES, detectEmbed, ghost, startDrag, endDrag } = K;

  Object.assign(E, {
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
      handle.ondragstart = (e) => { K.drag = { kind: 'block', id: b.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ecos', 'block'); ghost(e, `<span class="ms">${T.icon}</span>${esc(T.name)}`); startDrag(el, 'dragging-block'); };
      handle.ondragend = () => { K.drag = null; endDrag(); };
      // Un bloque arrastrado con el asa también se puede soltar ENCIMA de otro bloque: va antes o después de él según
      // la mitad en la que se suelte (antes solo valía la línea fina entre bloques y parecía que el asa no hacía nada)
      const canDropBlock = (e) => {
        if (!K.drag || K.drag.kind !== 'block' || K.drag.id === b.id || e.target.closest('.blk') !== el) return false;
        if (this.within(K.drag.id, b.id)) return false; // un contenedor no entra en sí mismo
        const src = this.locate(K.drag.id)?.b;
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
        const after = sideOf(e), id = K.drag.id;
        unmark(); K.drag = null; endDrag();
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
      this.decorateBlock?.(el, b, $('.blk-extra', el)); // botones «Estilo» y «⋯», diseño y ocultos por dispositivo (blocks/design-ui.js)
      return el;
    },


    // Texto editable con negrita, cursiva y enlaces (Ctrl+B, Ctrl+I, Ctrl+K)
    editable(tag, html, placeholder, onInput, opts = {}) {
      const el = document.createElement(tag);
      el.contentEditable = 'true'; el.className = 'rt' + (opts.cls ? ' ' + opts.cls : ''); el.dataset.ph = placeholder;
      el.innerHTML = html || '';
      let snap = false;
      el.oninput = () => { if (!snap) { this.snapshot(); snap = true; } onInput(el.innerHTML); this.onChange(true); if (opts.block?.type === 'heading') this.refreshToc(); };
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
      window.Design?.apply(nb, window.Design.pick(b)); // y su diseño (espaciado, bordes, fondo, dispositivos…)
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
  });
})();
