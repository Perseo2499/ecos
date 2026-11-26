// Editor de bloques · arrastrar y soltar: qué se puede soltar (fotos, vídeos, bloques), la línea «+» entre bloques, la portada
// (imagen destacada) y el desplazamiento automático al arrastrar cerca del borde.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, esc } = K;

  let dragEl = null; // el elemento que se está arrastrando (lleva la clase «dragging»)
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
  document.addEventListener('dragover', (e) => { if (!K.drag) return; autoScroll.y = e.clientY; autoScroll.box = scroller(e.target); }, true);
  function endDrag() {
    autoScroll.stop();
    dragEl?.classList.remove('dragging'); dragEl = null;
    document.body.classList.remove('dragging-media', 'dragging-block', 'dragging-internal');
    $$('#editor .over').forEach((x) => x.classList.remove('over'));
  }
  document.addEventListener('dragend', endDrag);
  Object.assign(K, { startDrag, ghost, endDrag }); // los usan block.js y media.js

  Object.assign(E, {
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
      el.addEventListener('dragover', (e) => { if (ok(K.drag)) { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); } });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
      el.addEventListener('drop', (e) => {
        el.classList.remove('over');
        if (!ok(K.drag)) return;
        e.preventDefault(); e.stopPropagation();
        const d = K.drag; K.drag = null; endDrag();
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
        if (!K.drag) return false;
        if (K.drag.kind === 'block') { const src = this.locate(K.drag.id)?.b; return !!src && src.type === 'image' && src.id !== b.id; }
        return this.isPhoto(K.drag);
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
        const d = K.drag; K.drag = null; endDrag();
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
        box.addEventListener('dragover', (e) => { if (this.isPhoto(K.drag)) { e.preventDefault(); box.classList.add('over'); } });
        box.addEventListener('dragleave', () => box.classList.remove('over'));
        box.addEventListener('drop', (e) => {
          box.classList.remove('over');
          if (!this.isPhoto(K.drag)) return;
          e.preventDefault();
          const d = K.drag; K.drag = null; endDrag();
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
      const ids = (d) => (d.ids?.length > 1 ? d.ids : [d.id]);
      const ok = () => K.drag && !(K.drag.kind === 'block' && owner && ids(K.drag).some((x) => this.within(x, owner)));
      el.ondragover = (e) => { if (ok()) { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); } };
      el.ondragleave = () => el.classList.remove('over');
      el.ondrop = (e) => {
        e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
        const d = K.drag; K.drag = null; endDrag();
        if (!d || (d.kind === 'block' && owner && ids(d).some((x) => this.within(x, owner)))) return;
        // posición estable: el bloque que estaba justo después de la línea (puede moverse al sacar la foto)
        const after = arr[i]?.id;
        const at = () => (after ? arr.findIndex((b) => b.id === after) : arr.length);
        if (d.kind === 'block' && d.ids?.length > 1) {
          // varios bloques seleccionados: se mueven juntos, en un solo paso de «deshacer»
          this.change(() => this.moveBlocks(d.ids, arr, after || null));
        } else if (d.kind === 'block') {
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
  });
})();
