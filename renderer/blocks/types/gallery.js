// Editor de bloques · galería, mosaico y carrusel: columnas, vistas y los botones desplegables del carrusel (tamaño, proporción, estilo).
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, esc, CAR_H } = K;

  Object.assign(E, {
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
  });

  E.types.gallery = function (b, i, body, extra) {
    const grid = document.createElement('div');
    grid.className = b.type === 'gallery' ? 'g-grid' + (b.layout === 'mosaic' ? ' mosaic' : '') : `g-car v-${b.view || 'single'}`;
    if (b.type === 'carousel') this.carLook(grid, b);
    if (b.type === 'gallery') grid.style.setProperty('--cols', b.columns);
    const vids = true; // galerías, mosaicos y carruseles admiten fotos y vídeos
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
    $$('[data-c]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.columns = Number(x.dataset.c)), b.id)));
    $$('[data-view]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.view = x.dataset.view), b.id)));
    if (lay === 'carousel') this.carMenus(extra, b);
    $$('[data-peekcss]', extra).forEach((x) => (x.onclick = () => this.onPeekCss?.()));
    $$('[data-lay]', extra).forEach((x) => (x.onclick = () => this.change(() => {
      const k = x.dataset.lay;
      if (k === 'carousel') {
        b.type = 'carousel';
      } else { b.type = 'gallery'; b.layout = k; b.columns = b.columns || 3; }
    }, b.id)));
  };
  E.types.carousel = E.types.gallery; // galería y carrusel comparten cuerpo
})();
