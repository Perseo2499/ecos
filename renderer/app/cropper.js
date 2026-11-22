// Recortador de imágenes: muestra la foto con un rectángulo que se arrastra y se redimensiona (proporción fija o libre,
// zoom con la rueda y arrastrando el fondo) y devuelve los bytes de la foto recortada, que el editor sube a la
// biblioteca. Recorta con <canvas>; si la foto es de otro dominio y el lienzo no puede leerla («tainted»), se descarga antes
// por el proceso principal (window.api.mediaFetchImage) y se trabaja con una copia local.
window.Cropper = (() => {
  const MIN = 16;       // tamaño mínimo del recorte (en píxeles de la foto)
  const MAX_SIDE = 4096; // lado máximo de la foto recortada
  const RATIOS = () => [['', t('Libre')], ['1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['9/16', '9:16']];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadImage(src, cors) {
    return new Promise((ok, no) => {
      const im = new Image();
      if (cors && /^https?:/i.test(src)) im.crossOrigin = 'anonymous';
      im.onload = () => ok(im);
      im.onerror = () => no(new Error(t('No se pudo abrir la imagen')));
      im.src = src;
    });
  }
  // ¿El lienzo puede leer esta imagen? (si no, al exportar daría un error de seguridad)
  function readable(im) {
    try { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 1, 1); x.getImageData(0, 0, 1, 1); return true; } catch { return false; }
  }
  const typeOf = (url) => (/\.png(\?|#|$)/i.test(url) || /^data:image\/png/i.test(url) ? 'image/png' : 'image/jpeg');
  // Abre la foto de forma que el lienzo pueda leerla: directa si se puede; si no, descargada por el proceso principal
  async function prepare(url) {
    let im = null;
    try { im = await loadImage(url, true); } catch { /* sin permiso de lectura: se descarga */ }
    if (im && readable(im)) return { im, type: typeOf(url) };
    const r = await window.api.mediaFetchImage(url);
    const bytes = r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes);
    const obj = URL.createObjectURL(new Blob([bytes], { type: r.type }));
    try { return { im: await loadImage(obj), type: /png/.test(r.type) ? 'image/png' : 'image/jpeg', obj }; } catch (e) { URL.revokeObjectURL(obj); throw e; }
  }
  const baseName = (url) => {
    let n = String(url || '').split(/[?#]/)[0].split('/').pop() || 'foto';
    try { n = decodeURIComponent(n); } catch { /* se deja tal cual */ }
    return (n.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'foto') + '-recortada';
  };

  // Abre el recortador para la foto { url, … }. Resuelve { bytes, type, name } o null si se cancela.
  async function crop(img) {
    const prep = await prepare(img.url);
    const im = prep.im, NW = im.naturalWidth, NH = im.naturalHeight;
    return new Promise((resolve) => {
      const d = document.createElement('div');
      d.className = 'crop-scrim';
      d.innerHTML = `<div class="crop-box" role="dialog" aria-modal="true" aria-label="${escHtml(t('Recortar la foto'))}">
        <div class="crop-head"><b>${t('Recortar la foto')}</b><span class="hint">${t('Arrastra el recuadro o sus esquinas · rueda del ratón para acercar')}</span></div>
        <div class="crop-bar"><span class="crop-lbl">${t('Proporción')}</span>${RATIOS().map(([v, n]) => `<button type="button" class="sp-chip" data-ra="${v}">${n}</button>`).join('')}
          <span class="spacer"></span><button type="button" class="sp-chip" data-z="fit"><span class="ms">fit_screen</span>${t('Ajustar')}</button>
          <input type="range" class="crop-zoom" min="0" max="100" value="0" aria-label="${escHtml(t('Zoom'))}"></div>
        <div class="crop-stage"><img class="crop-img" alt="" draggable="false"><div class="crop-rect">${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<i class="ch ch-${h}" data-h="${h}"></i>`).join('')}</div></div>
        <div class="crop-foot"><span class="hint crop-size"></span><span class="spacer"></span><button class="btn text" data-r="x">${t('Cancelar')}</button><button class="btn filled" data-r="ok"><span class="ms">crop</span>${t('Recortar y usar')}</button></div></div>`;
      document.body.appendChild(d);
      const stage = $('.crop-stage', d), imgEl = $('.crop-img', d), rectEl = $('.crop-rect', d), zoom = $('.crop-zoom', d);
      imgEl.src = im.src;
      imgEl.style.width = NW + 'px'; imgEl.style.height = NH + 'px';
      let W = 0, H = 0, fit = 1, scale = 1, ox = 0, oy = 0, ratio = null;
      let r = { x: NW * 0.1, y: NH * 0.1, w: NW * 0.8, h: NH * 0.8 };

      const draw = () => {
        imgEl.style.transform = `translate(${ox}px,${oy}px) scale(${scale})`;
        Object.assign(rectEl.style, { left: ox + r.x * scale + 'px', top: oy + r.y * scale + 'px', width: r.w * scale + 'px', height: r.h * scale + 'px' });
        $('.crop-size', d).textContent = `${Math.round(r.w)} × ${Math.round(r.h)} px`;
        zoom.value = String(Math.round((Math.log(scale / fit) / Math.log(8)) * 100));
      };
      const layout = () => {
        const b = stage.getBoundingClientRect(); W = b.width; H = b.height;
        fit = Math.min(W / NW, H / NH) * 0.96; scale = fit; ox = (W - NW * scale) / 2; oy = (H - NH * scale) / 2;
        draw();
      };
      // Zoom alrededor de un punto del lienzo (mx, my)
      const zoomTo = (ns, mx = W / 2, my = H / 2) => {
        ns = clamp(ns, fit * 0.5, fit * 8);
        ox = mx - ((mx - ox) * ns) / scale; oy = my - ((my - oy) * ns) / scale; scale = ns; draw();
      };
      stage.addEventListener('wheel', (e) => { e.preventDefault(); const b = stage.getBoundingClientRect(); zoomTo(scale * Math.exp(-e.deltaY * 0.0018), e.clientX - b.left, e.clientY - b.top); }, { passive: false });
      zoom.oninput = () => zoomTo(fit * Math.pow(8, Number(zoom.value) / 100));
      $('[data-z="fit"]', d).onclick = () => { scale = fit; ox = (W - NW * scale) / 2; oy = (H - NH * scale) / 2; draw(); };

      // Proporción fija: se conserva el centro y más o menos la superficie
      const setRatio = (v) => {
        ratio = v ? (v.includes('/') ? Number(v.split('/')[0]) / Number(v.split('/')[1]) : Number(v)) : null;
        $$('[data-ra]', d).forEach((x) => x.classList.toggle('on', x.dataset.ra === v));
        if (ratio) {
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          let w = Math.sqrt(r.w * r.h * ratio), h = w / ratio;
          if (w > NW) { w = NW; h = w / ratio; } if (h > NH) { h = NH; w = h * ratio; }
          r = { x: clamp(cx - w / 2, 0, NW - w), y: clamp(cy - h / 2, 0, NH - h), w, h };
        }
        draw();
      };
      $$('[data-ra]', d).forEach((x) => (x.onclick = () => setRatio(x.dataset.ra)));

      // Arrastrar: mover el recuadro, cambiarle el tamaño por un tirador, o desplazar la foto
      stage.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const hdl = e.target.dataset?.h, inRect = e.target === rectEl;
        const mode = hdl ? 'size' : inRect ? 'move' : 'pan';
        const x0 = e.clientX, y0 = e.clientY, r0 = { ...r }, o0 = { x: ox, y: oy };
        stage.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const dx = (ev.clientX - x0) / scale, dy = (ev.clientY - y0) / scale;
          if (mode === 'pan') { ox = o0.x + (ev.clientX - x0); oy = o0.y + (ev.clientY - y0); }
          else if (mode === 'move') r = { ...r0, x: clamp(r0.x + dx, 0, NW - r0.w), y: clamp(r0.y + dy, 0, NH - r0.h) };
          else r = resize(hdl, r0, dx, dy);
          draw();
        };
        const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); };
        stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
      });
      // Nuevo recuadro al mover un tirador (dx, dy en píxeles de la foto)
      function resize(h, r0, dx, dy) {
        const W0 = h.includes('w'), E0 = h.includes('e'), N0 = h.includes('n'), S0 = h.includes('s');
        let L = r0.x, T = r0.y, R = r0.x + r0.w, B = r0.y + r0.h;
        if (!ratio) {
          if (W0) L = clamp(L + dx, 0, R - MIN); if (E0) R = clamp(R + dx, L + MIN, NW);
          if (N0) T = clamp(T + dy, 0, B - MIN); if (S0) B = clamp(B + dy, T + MIN, NH);
          return { x: L, y: T, w: R - L, h: B - T };
        }
        const px = (W0 ? L : R) + dx, py = (N0 ? T : B) + dy;
        if ((W0 || E0) && (N0 || S0)) { // esquina: se ancla la opuesta
          const ax = W0 ? R : L, ay = N0 ? B : T;
          let w = Math.max(Math.abs(px - ax), Math.abs(py - ay) * ratio);
          w = clamp(w, MIN * ratio, Math.min(W0 ? ax : NW - ax, (N0 ? ay : NH - ay) * ratio));
          const hh = w / ratio;
          return { x: W0 ? ax - w : ax, y: N0 ? ay - hh : ay, w, h: hh };
        }
        if (N0 || S0) { // borde de arriba o de abajo: la anchura sigue al alto, desde el centro
          const ay = N0 ? B : T, cx = r0.x + r0.w / 2;
          const hh = clamp(Math.abs(py - ay), MIN, Math.min(N0 ? ay : NH - ay, NW / ratio)), w = hh * ratio;
          return { x: clamp(cx - w / 2, 0, NW - w), y: N0 ? ay - hh : ay, w, h: hh };
        }
        const ax = W0 ? R : L, cy = r0.y + r0.h / 2; // borde de la izquierda o de la derecha
        const w = clamp(Math.abs(px - ax), MIN * ratio, Math.min(W0 ? ax : NW - ax, NH * ratio)), hh = w / ratio;
        return { x: W0 ? ax - w : ax, y: clamp(cy - hh / 2, 0, NH - hh), w, h: hh };
      }

      const close = (res) => {
        document.removeEventListener('keydown', key, true);
        window.removeEventListener('resize', layout);
        if (prep.obj) URL.revokeObjectURL(prep.obj);
        d.remove();
        resolve(res);
      };
      const accept = async () => {
        let cw = Math.round(r.w), ch = Math.round(r.h);
        const k = Math.min(1, MAX_SIDE / Math.max(cw, ch));
        cw = Math.max(1, Math.round(cw * k)); ch = Math.max(1, Math.round(ch * k));
        const cv = document.createElement('canvas');
        cv.width = cw; cv.height = ch;
        cv.getContext('2d').drawImage(im, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
        const blob = await new Promise((ok) => cv.toBlob(ok, prep.type, 0.92));
        if (!blob) { toast(t('No se pudo recortar la imagen'), true); return; }
        close({ bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || prep.type, name: baseName(img.url) });
      };
      const key = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (e.key === 'Enter' && !e.target.closest?.('button')) { e.preventDefault(); e.stopPropagation(); accept(); }
      };
      $('[data-r="x"]', d).onclick = () => close(null);
      $('[data-r="ok"]', d).onclick = () => accept().catch((e) => toast(e.message, true));
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
      document.addEventListener('keydown', key, true);
      window.addEventListener('resize', layout);
      layout();
      $('[data-r="ok"]', d).focus();
    });
  }
  return { crop };
})();
