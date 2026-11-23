// Editor de bloques · «Imagen y texto»: lado, tamaño de la foto, alineación vertical, rellenar, tirador que se arrastra, soltar en el
// texto y juntar de nuevo.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, MT_SIZES, applyStyle, info } = K;

  Object.assign(E, {
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
          if (w !== this.mtWidth(b)) this.change(() => this.setMtWidth(b, w), b.id);
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
  });

  E.types.mediatext = function (b, i, body, extra) {
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
    $$('[data-side]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.right = x.dataset.side === '1'), b.id)));
    $$('[data-mw]', extra).forEach((x) => (x.onclick = () => this.change(() => this.setMtWidth(b, Number(x.dataset.mw)), b.id)));
    $$('[data-va]', extra).forEach((x) => (x.onclick = () => this.change(() => { if (x.dataset.va === 'center') delete b.valign; else b.valign = x.dataset.va; }, b.id)));
    $('[data-fill]', extra).onclick = () => this.change(() => { if (b.fill) delete b.fill; else b.fill = true; }, b.id);
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
      $$('[data-side]', ib).forEach((x) => (x.onclick = (e) => { e.stopPropagation(); this.change(() => (b.right = x.dataset.side === '1'), b.id); }));
      $$('[data-mw]', ib).forEach((x) => (x.onclick = (e) => { e.stopPropagation(); this.change(() => this.setMtWidth(b, Number(x.dataset.mw)), b.id); }));
      $('[data-fill]', ib).onclick = (e) => { e.stopPropagation(); this.change(() => { if (b.fill) delete b.fill; else b.fill = true; }, b.id); };
      this.styleBtn(ib, b);
      ib.insertAdjacentHTML('beforeend', `<span class="lv-sep"></span><button class="lv show-lbl" data-drop="1" title="${t('El texto rodea la foto y sigue por debajo de ella (la foto queda a un lado, dentro del texto)')}"><span class="ms">wrap_text</span><span class="lbl">${t('Texto alrededor')}</span></button>`);
      $('[data-drop]', ib).onclick = (e) => { e.stopPropagation(); this.dropIntoText(b); };
      ib.addEventListener('mousedown', (e) => e.stopPropagation());
      (side.querySelector(".mt-phwrap") || side).appendChild(ib);
    }
  };
})();
