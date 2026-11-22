// Barra de formato del editor de entradas: tipo de bloque, fuente, tamaño, negrita/cursiva/subrayado/
// tachado, enlaces, color y resaltado, alineación, superíndice/subíndice/código, letra capital, quitar
// formato y ayuda de la IA para el bloque. Actúa sobre el bloque con el foco (BlockEditor.active).
// También pinta el panel «Revisión» (palabras, tiempo de lectura, estructura y comprobaciones).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const t = (s, v) => window.I18N.t(s, v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = () => window.BlockEditor;
  const bar = $('#fmt');
  const pop = $('#fmt-pop');
  if (!bar) return;

  const TEXT_COLORS = ['#1f1f1f', '#5f6368', '#c62828', '#e65100', '#f9a825', '#2e7d32', '#00838f', '#1565c0', '#6a1b9a', '#ad1457'];
  const BG_COLORS = ['#fff3c4', '#ffe0b2', '#ffcdd2', '#f8bbd0', '#e1bee7', '#c5cae9', '#bbdefb', '#b2ebf2', '#c8e6c9', '#eeeeee'];

  // --- Selección: se guarda para poder volver a ella tras usar un desplegable o un campo
  let range = null;
  document.addEventListener('selectionchange', () => {
    const a = E()?.active, s = getSelection();
    if (a && s.rangeCount && a.el.contains(s.anchorNode)) { range = s.getRangeAt(0).cloneRange(); state(); }
  });
  function restore() {
    const a = E().active;
    if (!a || !document.contains(a.el)) return false;
    a.el.focus();
    if (range && a.el.contains(range.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
    return true;
  }
  const hasSel = () => { const s = getSelection(); return s.rangeCount && !s.isCollapsed && E().active?.el.contains(s.anchorNode); };
  const fire = () => E().active?.el.dispatchEvent(new Event('input'));
  const isText = (b) => b && E().TEXT_TYPES.includes(b.type);

  // --- Formato del bloque (alineación, tamaño, fuente, colores, letra capital)
  function setBlock(prop, val) {
    const a = E().active;
    if (!a || !isText(a.b)) { window.toast?.(t('Pulsa primero dentro del texto que quieres cambiar. (El título de la página no es un bloque: su alineación la pone el tema de tu web.)'), true); return; }
    E().snapshot();
    if (val) a.b[prop] = val; else delete a.b[prop];
    E().applyStyle(a.styleEl, a.b);
    E().onChange();
    state();
  }

  // --- Formato en línea con etiquetas (<mark> de color, <code>)
  function wrap(tag, attrs = {}) {
    restore();
    if (!hasSel()) return false;
    const s = getSelection(), r = s.getRangeAt(0);
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.appendChild(r.extractContents());
    r.insertNode(el);
    const nr = document.createRange(); nr.selectNodeContents(el); s.removeAllRanges(); s.addRange(nr);
    fire();
    return true;
  }
  // Quita las marcas de color que toca la selección
  function unwrapMarks() {
    restore();
    const a = E().active, s = getSelection();
    if (!a || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    $$('mark', a.el).filter((m) => r.intersectsNode(m)).forEach((m) => m.replaceWith(...m.childNodes));
    fire();
  }

  // --- Ventanita (colores, enlace, IA) bajo un botón de la barra
  function openPop(anchor, html, wire) {
    pop.innerHTML = html;
    pop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = r.bottom + 6 + 'px';
    wire(pop);
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target) && !anchor.contains(e.target)) { closePop(); document.removeEventListener('mousedown', off); } }), 0);
  }
  const closePop = () => pop.classList.add('hidden');
  // los botones de la ventanita no quitan el foco al texto
  pop.addEventListener('mousedown', (e) => { if (e.target.closest('button, .sw')) e.preventDefault(); });

  function colorPop(anchor, kind) {
    const list = kind === 'bg' ? BG_COLORS : TEXT_COLORS;
    const sel = hasSel();
    openPop(anchor, `
      <div class="pop-title">${kind === 'bg' ? t('Resaltado') : t('Color del texto')} <span class="hint">· ${sel ? t('texto seleccionado') : t('todo el bloque')}</span></div>
      <div class="sw-grid">${list.map((c) => `<span class="sw" data-c="${c}" style="background:${c}" title="${c}"></span>`).join('')}</div>
      <div class="pop-row"><label class="btn text small"><span class="ms">palette</span>${t('Otro color')}<input type="color" class="pick"></label><span class="spacer"></span><button class="btn text small" data-clear><span class="ms">format_color_reset</span>${t('Quitar')}</button></div>`,
    (p) => {
      const apply = (c) => {
        if (sel) wrap('mark', { style: kind === 'bg' ? `background-color:${c}` : `background-color:rgba(0, 0, 0, 0);color:${c}`, class: 'has-inline-color' });
        else setBlock(kind === 'bg' ? 'bg' : 'color', c);
        closePop();
      };
      $$('.sw', p).forEach((x) => (x.onclick = () => apply(x.dataset.c)));
      $('.pick', p).onchange = (e) => apply(e.target.value);
      $('[data-clear]', p).onclick = () => { if (sel) unwrapMarks(); else setBlock(kind === 'bg' ? 'bg' : 'color', null); closePop(); };
    });
  }

  function link() {
    const a = E().active;
    if (!a) return;
    const s = getSelection();
    const cur = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest('a');
    if (!hasSel() && !cur) { window.toast?.(t('Selecciona el texto que quieres enlazar.'), true); return; }
    if (cur && !hasSel()) { const r = document.createRange(); r.selectNodeContents(cur); s.removeAllRanges(); s.addRange(r); range = r.cloneRange(); }
    openPop($('[data-x="link"]', bar), `
      <div class="pop-title">${t('Enlace')}</div>
      <div class="pop-row"><input class="pill-input" id="lk-url" placeholder="https://…" value="${esc(cur?.getAttribute('href') || '')}"></div>
      <div class="pop-row"><span class="hint">${t('También vale un correo (mailto:…) o un teléfono (tel:…).')}</span></div>
      <div class="pop-row"><span class="spacer"></span>${cur ? `<button class="btn text small danger" data-un>${t('Quitar enlace')}</button>` : ''}<button class="btn filled small" data-ok>${t('Aplicar')}</button></div>`,
    (p) => {
      const inp = $('#lk-url', p);
      inp.focus(); inp.select();
      const ok = () => {
        let u = inp.value.trim();
        if (!u) return;
        if (!/^(https?:|mailto:|tel:|#)/i.test(u)) u = (/^[^\s@]+@[^\s@]+$/.test(u) ? 'mailto:' : 'https://') + u;
        restore(); document.execCommand('createLink', false, u); closePop();
      };
      $('[data-ok]', p).onclick = ok;
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') closePop(); };
      $('[data-un]', p)?.addEventListener('click', () => { restore(); document.execCommand('unlink'); closePop(); });
    });
  }

  // --- IA sobre el bloque activo
  const AI_ACTIONS = () => [
    ['improve', 'auto_fix_high', t('Mejorar la redacción')], ['fix', 'spellcheck', t('Corregir ortografía y gramática')],
    ['shorter', 'compress', t('Hacerlo más breve')], ['longer', 'expand', t('Desarrollarlo un poco más')],
    ['friendly', 'sentiment_satisfied', t('Tono más cercano')], ['formal', 'work', t('Tono más formal')],
    ['headline', 'title', t('Proponer un título mejor')],
  ];
  function aiPop(anchor) {
    const a = E().active;
    if (!a || !isText(a.b) && !['details', 'buttons'].includes(a.b.type)) { window.toast?.(t('Haz clic en un bloque de texto primero.'), true); return; }
    if (!window.CFG_AI_READY?.()) { window.toast?.(t('Configura una IA en «Conexiones» para usar estos botones.'), true); return; }
    openPop(anchor, `<div class="pop-title">${t('IA para este bloque')}</div>` + AI_ACTIONS().map(([k, i, n]) => `<button class="pop-item" data-k="${k}"><span class="ms">${i}</span>${n}</button>`).join(''),
      (p) => $$('[data-k]', p).forEach((x) => (x.onclick = async () => {
        closePop();
        const b = a.b;
        const html = b.type === 'list' ? (b.items || []).join('<br>') : b.html || '';
        if (!html.replace(/<[^>]+>/g, '').trim()) { window.toast?.(t('El bloque está vacío.'), true); return; }
        a.el.closest('.blk')?.classList.add('ai-busy');
        try {
          const out = await window.api.aiRewrite({ html, action: x.dataset.k, title: $('#d-title').value, kind: b.type });
          E().change(() => {
            if (x.dataset.k === 'headline') { b.html = out.replace(/<br\s*\/?>/gi, ' '); if (b.type === 'paragraph') { b.type = 'heading'; b.level = 2; } }
            else if (b.type === 'list') b.items = out.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
            else b.html = out;
          });
          window.toast?.(t('Listo. Puedes deshacerlo con Ctrl+Z.'));
        } catch (e) { window.toast?.(e.message, true); } finally { $$('.ai-busy').forEach((x) => x.classList.remove('ai-busy')); }
      })));
  }

  // --- Barra
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  $$('[data-cmd]', bar).forEach((b) => (b.onclick = () => { restore(); document.execCommand(b.dataset.cmd); fire(); state(); }));
  $$('[data-al]', bar).forEach((b) => (b.onclick = () => setBlock('align', b.dataset.al === 'left' ? null : b.dataset.al)));
  $('[data-x="color"]', bar).onclick = (e) => colorPop(e.currentTarget, 'color');
  $('[data-x="bg"]', bar).onclick = (e) => colorPop(e.currentTarget, 'bg');
  $('[data-x="link"]', bar).onclick = link;
  $('[data-x="code"]', bar).onclick = () => { if (!wrap('code')) window.toast?.(t('Selecciona el texto primero.'), true); };
  $('[data-x="drop"]', bar).onclick = () => { const a = E().active; if (a?.b.type === 'paragraph') setBlock('dropCap', !a.b.dropCap); };
  $('[data-x="clear"]', bar).onclick = () => {
    const a = E().active; if (!a) return;
    if (hasSel()) { restore(); document.execCommand('removeFormat'); unwrapMarks(); document.execCommand('unlink'); fire(); }
    else if (isText(a.b)) { E().change(() => ['align', 'size', 'font', 'color', 'bg', 'dropCap', 'shadow', 'spacing'].forEach((k) => delete a.b[k])); }
  };
  $('[data-x="ai"]', bar).onclick = (e) => aiPop(e.currentTarget);
  $('#fmt-font').onchange = (e) => setBlock('font', e.target.value);
  $('#fmt-ls').onchange = (e) => setBlock('spacing', e.target.value);
  $('[data-x="shadow"]', bar).onclick = () => { const a = E().active; if (a && isText(a.b)) setBlock('shadow', !a.b.shadow); };
  $('#fmt-size').onchange = (e) => setBlock('size', e.target.value);
  $('#fmt-type').onchange = (e) => {
    const a = E().active, v = e.target.value;
    if (!a || !isText(a.b)) return;
    if (v === 'paragraph') E().convert(a.b, 'paragraph');
    else if (/^h\d$/.test(v)) { if (a.b.type === 'heading') E().change(() => (a.b.level = Number(v[1]))); else E().convert(a.b, 'heading', { level: Number(v[1]) }); E().focus(a.b.id); }
    else if (v === 'quote') E().convert(a.b, 'quote');
    else if (v === 'ul' || v === 'ol') { if (a.b.type === 'list') E().change(() => (a.b.ordered = v === 'ol')); else E().convert(a.b, 'list', { ordered: v === 'ol' }); }
  };

  // Estado de la barra según el bloque y la selección
  function state() {
    const a = E()?.active;
    const ok = !!a && document.contains(a.el);
    bar.classList.toggle('off', !ok);
    const text = ok && isText(a.b);
    $$('select, [data-al], [data-x="drop"], [data-x="shadow"]', bar).forEach((x) => (x.disabled = !text));
    $$('[data-cmd], [data-x="link"], [data-x="color"], [data-x="bg"], [data-x="code"], [data-x="clear"], [data-x="ai"]', bar).forEach((x) => (x.disabled = !ok));
    if (!ok) return;
    const b = a.b;
    if (text) {
      $('#fmt-type').value = b.type === 'heading' ? 'h' + (b.level || 2) : b.type === 'list' ? (b.ordered ? 'ol' : 'ul') : b.type;
      $('#fmt-font').value = b.font || '';
      $('#fmt-size').value = b.size || '';
      $('#fmt-ls').value = b.spacing || '';
      $('[data-x="shadow"]', bar).classList.toggle('on', !!b.shadow);
      $$('[data-al]', bar).forEach((x) => { x.classList.toggle('on', (b.align || 'left') === x.dataset.al); x.disabled = !['paragraph', 'heading'].includes(b.type); });
      $('[data-x="drop"]', bar).disabled = b.type !== 'paragraph';
      $('[data-x="drop"]', bar).classList.toggle('on', !!b.dropCap);
    }
    $('[data-x="color"] .cbar', bar).style.background = b.color || 'currentColor';
    $('[data-x="bg"] .cbar', bar).style.background = b.bg || 'transparent';
    for (const x of $$('[data-cmd]', bar)) { let on = false; try { on = document.queryCommandState(x.dataset.cmd); } catch { /* nada */ } x.classList.toggle('on', on); }
  }

  // --- Panel «Revisión»: cifras, estructura y comprobaciones antes de publicar
  let timer = null;
  function review() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const ed = E(), box = $('#d-review');
      if (!ed?.draft || !box) return;
      const { words, minutes } = ed.stats();
      const blocks = ed.flat();
      const heads = blocks.filter((b) => b.type === 'heading' && (b.html || '').replace(/<[^>]+>/g, '').trim());
      const imgs = blocks.flatMap((b) => (b.img ? [b.img] : b.images || [])).filter((i) => i.type !== 'video');
      const noAlt = imgs.filter((i) => !(i.alt || '').trim()).length;
      const title = $('#d-title').value.trim();
      const checks = [
        [title.length >= 10 && title.length <= 70, title.length > 70 ? t('El título es largo ({n} caracteres); mejor menos de 70.', { n: title.length }) : t('Título de buena longitud'), title.length < 10 ? t('Escribe un título más descriptivo') : null],
        [!!ed.draft.featuredImageId, t('Imagen destacada elegida'), t('Elige una imagen destacada (arrástrala encima del título)')],
        [!!$('#d-excerpt').value.trim(), t('Tiene extracto'), t('Añade un extracto: es lo que se ve en buscadores y redes')],
        [!imgs.length || !noAlt, t('Todas las fotos tienen descripción'), t('{n} foto(s) sin descripción (alt)', { n: noAlt })],
        [words < 350 || heads.length > 0, t('Texto bien estructurado'), t('Texto largo sin títulos: divídelo con alguno (H2)')],
      ];
      box.innerHTML = `
        <div class="rv-stats"><div><b>${words}</b><span>${t('palabras')}</span></div><div><b>${minutes}</b><span>${t('min de lectura')}</span></div><div><b>${imgs.length}</b><span>${t('fotos')}</span></div></div>
        ${checks.map(([ok, good, bad]) => `<div class="rv-check ${ok ? 'ok' : 'warn'}"><span class="ms fill">${ok ? 'check_circle' : 'error'}</span>${esc(ok ? good : bad || good)}</div>`).join('')}
        ${heads.length ? `<div class="rv-outline">${heads.map((h) => `<a href="#" data-id="${h.id}" class="lvl${h.level || 2}">${esc(h.html.replace(/<[^>]+>/g, ''))}</a>`).join('')}</div>` : ''}`;
      $$('.rv-outline a', box).forEach((x) => (x.onclick = (e) => { e.preventDefault(); const el = $(`.blk[data-id="${x.dataset.id}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); ed.focus(x.dataset.id, true); }));
      $('#ed-count').textContent = t('{n} palabras · {m} min', { n: words, m: minutes });
    }, 250);
  }
  ['#d-title', '#d-excerpt'].forEach((s) => $(s)?.addEventListener('input', review));

  window.FormatBar = { update: state, link, review };
})();
