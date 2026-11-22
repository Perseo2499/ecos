// Ecos · Panel «Fondo de la página» del editor (la lógica pura está en renderer/pagebg.js → window.PageBg).
// Comparte el ámbito global con editor.js, que lo llama desde openEditor() y al traer cambios de WordPress.

const bgOn = () => !!(draft && draft.pageBg && (draft.pageBg.img || draft.pageBg.preset));
const bgState = () => ({ ...PageBg.DEFAULTS, ...(draft.pageBg || {}), overlay: { ...PageBg.DEFAULTS.overlay, ...(draft.pageBg?.overlay || {}) } });

// Cambia el fondo (patch parcial) y repinta; el autoguardado se entera como con cualquier otro ajuste
function setPageBg(patch, { quiet = false } = {}) {
  const cur = bgState();
  const next = { ...cur, ...patch, overlay: { ...cur.overlay, ...(patch.overlay || {}) } };
  draft.pageBg = PageBg.normalize(next) ? next : null;
  renderPageBg();
  if (!quiet) autosaveSoon();
}

function bgPickImage(img) {
  if (!img || !img.url) return;
  if (!PageBg.safeUrl(img.url)) return toast(t('Esa imagen no tiene una dirección web válida.'), true);
  setPageBg({ img: { id: img.id, url: img.url }, preset: null });
}

// Miniatura: el fondo con la tarjeta blanca encima, igual que en la web (se calcula con el mismo CSS)
function bgPreviewStyle() {
  const c = PageBg.normalize(draft.pageBg);
  if (!c) return { bg: '', card: '' };
  const p = c.preset ? PageBg.PRESETS[c.preset] : null;
  const ov = c.overlay.opacity ? (() => { const rgb = PageBg.OVERLAYS[c.overlay.color]; const a = c.overlay.opacity / 100; return `linear-gradient(rgba(${rgb},${a}),rgba(${rgb},${a}))`; })() : '';
  const img = c.img ? `url("${PageBg.safeUrl(c.img.url)}")` : p.image;
  const size = c.img ? (c.mode === 'repeat' ? '40px' : 'cover') : p.size === 'auto' ? 'auto' : '11px 11px';
  const rep = c.img ? (c.mode === 'repeat' ? 'repeat' : 'no-repeat') : p.size === 'auto' ? 'no-repeat' : 'repeat';
  const layers = [ov, img].filter(Boolean);
  const sizes = [ov && '100% 100%', size].filter(Boolean);
  const reps = [ov && 'no-repeat', rep].filter(Boolean);
  return {
    bg: `background-color:${c.img ? '#fff' : p.color};background-image:${layers.join(',')};background-size:${sizes.join(',')};background-repeat:${reps.join(',')};background-position:center;${c.blur ? `filter:blur(${Math.round(c.blur / 4)}px);` : ''}`,
    card: `width:${Math.round(40 + (c.width - 760) / 440 * 28)}%;border-radius:${Math.round(c.radius / 4)}px;margin-top:${Math.round(c.margin / 12) + 4}px;box-shadow:${c.shadow === 'none' ? 'none' : c.shadow === 'soft' ? '0 2px 8px rgba(0,0,0,.18)' : '0 4px 14px rgba(0,0,0,.4)'}`,
    header: c.header,
  };
}

function renderPageBg() {
  const box = $('#d-bg'); if (!box || !draft) return;
  const on = bgOn(), s = bgState();
  $('#bg-body').classList.toggle('hidden', !on);
  $('#bg-prev').classList.toggle('hidden', !on);
  $('#bg-sum').textContent = on ? (s.preset ? t(PageBg.PRESETS[s.preset].name) : t('Imagen')) : t('Sin fondo');
  const pv = bgPreviewStyle();
  const prev = $('#bg-prev');
  prev.classList.toggle('hdr', !!pv.header);
  let layer = $('.bg-prev-bg', prev);
  if (!layer) { layer = document.createElement('div'); layer.className = 'bg-prev-bg'; prev.prepend(layer); }
  layer.style.cssText = pv.bg || '';
  $('.bg-prev-card', prev).style.cssText = pv.card || '';
  for (const g of $$('[data-bg]', box)) {
    const key = g.dataset.bg;
    const cur = key === 'fixed' ? (s.fixed ? '1' : '0') : key === 'ovc' ? s.overlay.color : String(s[key]);
    $$('button', g).forEach((b) => b.classList.toggle('active', b.dataset.v === cur));
  }
  const rg = (id, v, suf) => { $(id).value = v; $(id + '-v').textContent = v + suf; };
  rg('#bg-ovo', s.overlay.opacity, ' %'); rg('#bg-blur', s.blur, ' px'); rg('#bg-radius', s.radius, ' px'); rg('#bg-margin', s.margin, ' px');
  $('#bg-header').checked = !!s.header;
  // fondos sugeridos
  $('#bg-presets').innerHTML = Object.entries(PageBg.PRESETS).map(([k, p]) => `<button type="button" class="bg-pre${s.preset === k && !s.img ? ' on' : ''}" data-k="${k}" title="${escHtml(t(p.name))}" style="background-color:${p.color};background-image:${p.image};background-size:${p.size === 'auto' ? 'auto' : '11px 11px'}"></button>`).join('');
  // imágenes de la bandeja de la entrada (hasta 10)
  const pool = (typeof mediaPool === 'function' ? mediaPool() : []).filter((m) => m.type !== 'video' && m.url).slice(0, 10);
  $('#bg-tray').innerHTML = pool.length ? `<span class="hint">${t('De la bandeja de la entrada')}</span><div class="bg-tray-row">${pool.map((m, i) => `<button type="button" class="bg-th${s.img && s.img.url === m.url ? ' on' : ''}" data-i="${i}" style="background-image:url('${PageBg.safeUrl(m.thumb || m.url)}')"></button>`).join('')}</div>` : '';
  box._pool = pool;
}

function initPageBgUi() {
  const box = $('#d-bg'); if (!box) return;
  box.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-bg] button');
    if (seg) {
      const k = seg.closest('[data-bg]').dataset.bg, v = seg.dataset.v;
      if (!bgOn()) return;
      if (k === 'fixed') setPageBg({ fixed: v === '1' });
      else if (k === 'mode') setPageBg({ mode: v });
      else if (k === 'ovc') setPageBg({ overlay: { color: v } });
      else if (k === 'width') setPageBg({ width: Number(v) });
      else if (k === 'shadow') setPageBg({ shadow: v });
      return;
    }
    const pre = e.target.closest('.bg-pre');
    if (pre) return setPageBg({ preset: pre.dataset.k, img: null });
    const th = e.target.closest('.bg-th');
    if (th) return bgPickImage(box._pool[Number(th.dataset.i)]);
  });
  const range = (id, fn) => $(id).addEventListener('input', (e) => fn(Number(e.target.value)));
  range('#bg-ovo', (v) => setPageBg({ overlay: { opacity: v } }));
  range('#bg-blur', (v) => setPageBg({ blur: v }));
  range('#bg-radius', (v) => setPageBg({ radius: v }));
  range('#bg-margin', (v) => setPageBg({ margin: v }));
  $('#bg-header').addEventListener('change', (e) => setPageBg({ header: e.target.checked }));
  $('#bg-off').onclick = () => { draft.pageBg = null; renderPageBg(); autosaveSoon(); };

  // Biblioteca de medios de WordPress: se elige una foto
  $('#bg-lib').onclick = () => {
    if (CFG.wpMode !== 'selfhosted') return toast(t('La biblioteca de medios solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.'), true);
    const m = document.createElement('div');
    m.className = 'modal mg-modal';
    m.innerHTML = `<div class="modal-box wide"><h2><span class="ms fill modal-icon">wallpaper</span>${t('Imagen de fondo')}</h2>
      <div class="mg-host"></div>
      <div class="modal-actions"><span class="hint mg-picked"></span><span class="spacer"></span><button class="btn text" data-r="0">${t('Cancelar')}</button><button class="btn filled" data-r="1" disabled><span class="ms">check</span>${t('Usar como fondo')}</button></div></div>`;
    const ok = m.querySelector('[data-r="1"]');
    const g = mediaGrid(m.querySelector('.mg-host'), { usage: false, onChange: () => { ok.disabled = !g.sel.size; m.querySelector('.mg-picked').textContent = g.sel.size > 1 ? t('Se usará la primera') : ''; } });
    const close = () => { m.remove(); document.removeEventListener('keydown', key, true); };
    const key = (e) => { if (e.key === 'Escape' && !$('#lightbox:not(.hidden)')) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    m.querySelector('[data-r="0"]').onclick = close;
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    ok.onclick = () => { const x = [...g.sel.values()].find((v) => v.type !== 'video'); if (x) bgPickImage({ id: x.id, url: x.large || x.url }); close(); };
    document.body.appendChild(m);
    g.reload();
  };
  // Subir desde el ordenador
  $('#bg-up').onclick = (e) => busy(e.currentTarget, async () => {
    const added = (await window.api.uploadMedia()) || [];
    const img = added.find((a) => a.type !== 'video');
    if (!img) return;
    draft.extraMedia = [...(draft.extraMedia || []), ...added.filter((a) => !(draft.extraMedia || []).some((x) => x.id === a.id))];
    bgPickImage(img);
  });
  // Google Fotos
  $('#bg-gp').onclick = (e) => busy(e.currentTarget, async () => {
    const got = (await pickFromGPhotos()) || [];
    const img = got.find((a) => a.type !== 'video');
    if (!img) return;
    draft.extraMedia = [...(draft.extraMedia || []), ...got.filter((a) => !(draft.extraMedia || []).some((x) => x.id === a.id))];
    bgPickImage(img);
  });
  box.addEventListener('toggle', () => { if (box.open) renderPageBg(); });
}
initPageBgUi();
