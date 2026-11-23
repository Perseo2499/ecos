// Editor de bloques · imagen suelta: colocación y tamaño, recorte, marco y efecto, tirador de ancho, recortar de verdad y convertir
// en galería, mosaico o carrusel.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, toast } = K;

  Object.assign(E, {
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
          this.change(() => { b.w = v; delete b.width; if (!b.align) b.align = 'center'; }, b.id);
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
      }, b.id);
      toast(t('Ahora suelta aquí más fotos desde la bandeja (o pulsa el recuadro para elegirlas).'));
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
  });

  E.types.image = function (b, i, body, extra, arr) {
    if (!b.img) { body.appendChild(this.dropZone(t('Arrastra aquí una foto'), (m) => this.change(() => (b.img = { ...m })))); this.acceptPhoto(body, (img) => (b.img = img)); return; }
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
        return moved ? this.FULL : undefined;
      }, b.id);
      if (moved) toast(t('He puesto la foto antes del texto para que el texto la rodee. El texto que quieras a su lado tiene que ir justo debajo de la foto.'));
    }));
    $$('[data-w]', extra).forEach((x) => (x.onclick = () => this.change(() => { b.width = Number(x.dataset.w); delete b.w; }, b.id)));
    // foto a un lado con un párrafo justo debajo: se puede juntar con él en un bloque «Imagen y texto»
    const nx = (b.align === 'left' || b.align === 'right') ? this.locate(b.id) : null;
    if (nx && nx.arr[nx.i + 1]?.type === 'paragraph') {
      extra.insertAdjacentHTML('beforeend', `<span class="lv-sep"></span><button class="lv" data-join="1" title="${t('Junta la foto y el párrafo de debajo en un bloque «Imagen y texto»')}"><span class="ms">vertical_split</span><span class="lbl">${t('Juntar con el texto')}</span></button>`);
      $('[data-join]', extra).onclick = () => this.joinWithText(b);
    }
    this.styleBtn(extra, b);
  };
})();
