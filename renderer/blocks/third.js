// Editor de bloques · bloques de Spectra, Kadence y GenerateBlocks (tipo «third»): vista del HTML guardado con edición en línea de los
// textos, etiqueta del plugin, opciones seguras (enlace, nueva ventana, nivel, alineación, colores, imagen) en «Estilo» y «Editar en WordPress»
// para todo lo demás. La lógica (qué se edita y cómo se reescribe) está en renderer/thirdparty.js; aquí solo la interfaz.
(function () {
  const E = window.BlockEditor, K = window.BlockKit, P = window.ThirdParty;
  const { $, t, esc } = K;

  const pluginName = (b) => P.PLUGIN_NAMES[b.plugin] || b.plugin;
  const specOf = (b) => P.SPECS[b.name] || {};
  const cssCls = (c) => '.' + (window.CSS && CSS.escape ? CSS.escape(c) : c);
  // El elemento de la vista que corresponde a un hueco de texto (por su clase y etiqueta)
  function slotEl(root, sel) {
    for (const c of [].concat(sel.cls || [])) {
      const el = root.querySelector((sel.tag || '') + cssCls(c));
      if (el) return el;
    }
    return null;
  }

  E.types.third = function (b, i, body, extra) {
    const sp = specOf(b);
    const wrap = document.createElement('div');
    wrap.className = `tp-box tp-${b.plugin}` + (Array.isArray(b.children) ? ' tp-cont' : '') + (b.self ? ' tp-self' : '');
    wrap.dataset.tp = b.name;
    wrap.style.textAlign = ['left', 'center', 'right', 'justify'].includes(P.alignOf(b)) ? P.alignOf(b) : '';
    const tag = document.createElement('span');
    tag.className = 'tp-tag'; tag.textContent = pluginName(b);
    tag.title = t('Bloque de {n}: se conserva tal cual y se edita lo seguro', { n: pluginName(b) });
    wrap.appendChild(tag);
    const edit = (k, el, plain) => {
      el.contentEditable = 'true'; el.classList.add('rt', 'tp-ed'); el.spellcheck = true;
      let snap = false;
      el.oninput = () => { if (!snap) { this.snapshot(); snap = true; } P.setText(b, k, plain ? el.textContent : el.innerHTML); this.onChange(true); };
      el.onblur = () => { snap = false; };
      el.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); window.FormatBar?.link(); } else if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); } };
      el.onfocus = () => this.setActive?.(b, el, el);
    };
    if (Array.isArray(b.children)) {
      wrap.appendChild(this.list(b.children, b.id));
    } else if (b.self) {
      const x = P.texts(b)[0];
      const btn = document.createElement('span');
      btn.className = 'tp-btn'; btn.innerHTML = (x && x.v) || '';
      btn.dataset.ph = t('Texto del botón');
      if (P.colorOf(b, 'bg')) btn.style.backgroundColor = P.colorOf(b, 'bg');
      if (P.colorOf(b, 'color')) btn.style.color = P.colorOf(b, 'color');
      if (x) edit(x.k, btn, false);
      wrap.appendChild(btn);
    } else {
      const pv = document.createElement('div');
      pv.className = 'tp-pv'; pv.innerHTML = P.previewHtml(b);
      pv.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });
      for (const x of P.texts(b)) {
        const el = slotEl(pv, (sp.texts || []).find((y) => y.k === x.k).sel);
        if (el) edit(x.k, el, x.plain);
      }
      // color, botón y enlace como en el bloque (solo lo que es un atributo sencillo)
      const first = (sp.texts || [])[0] && slotEl(pv, sp.texts[0].sel);
      if (P.colorOf(b, 'color') && first) first.style.color = P.colorOf(b, 'color');
      const link = sp.link && sp.link.sel && slotEl(pv, sp.link.sel);
      if (link && (sp.bg || sp.color)) { if (P.colorOf(b, 'bg')) link.style.backgroundColor = P.colorOf(b, 'bg'); if (P.colorOf(b, 'color')) link.style.color = P.colorOf(b, 'color'); }
      wrap.appendChild(pv);
    }
    body.appendChild(wrap);
  };

  // Filas del panel «Estilo»: solo lo seguro
  const styleRows = E.styleRows;
  E.styleRows = function (b) {
    if (b.type !== 'third') return styleRows.call(this, b);
    const rows = [];
    const chip = (txt, on, fn, o = {}) => ({ t: txt, on, fn, ...o });
    const lk = P.linkOf(b);
    if (lk) {
      rows.push({
        label: t('Enlace'), html: `<input type="url" class="tp-url" placeholder="https://" value="${esc(lk.url)}" aria-label="${esc(t('Dirección del enlace'))}">`,
        wire: (root) => { const inp = $('.tp-url', root); inp.onchange = () => this.changeBlock(b.id, () => { if (!P.setLink(b, { url: inp.value })) K.toast(t('Escribe una dirección que empiece por https://')); }); },
      });
      if (lk.canBlank) rows.push({ label: t('Al pulsar'), chips: [chip(t('Misma pestaña'), !lk.blank, () => P.setLink(b, { blank: false })), chip(t('Nueva pestaña'), lk.blank, () => P.setLink(b, { blank: true }))] });
    }
    const lv = P.levelOf(b);
    if (lv) rows.push({ label: t('Nivel del título'), chips: [1, 2, 3, 4, 5, 6].map((n) => chip('H' + n, lv === n, () => P.setLevel(b, n))) });
    const al = (specOf(b).align || {}).vals;
    if (al) rows.push({ label: t('Alineación'), chips: [['', t('Como está')], ['left', t('Izquierda')], ['center', t('Centro')], ['right', t('Derecha')], ['justify', t('Justificada')]].filter(([v]) => !v || al.includes(v)).map(([v, n]) => chip(n, P.alignOf(b) === v, () => P.setAlign(b, v))) });
    for (const [k, lab] of [['color', 'color'], ['bg', 'bg']]) {
      const L = specOf(b)[k];
      if (L) rows.push({ label: t(L.label), color: { none: true, get: () => P.colorOf(b, k), set: (v) => P.setColor(b, k, v) } });
    }
    if (P.imageOf(b)) {
      const im = P.imageOf(b);
      rows.push({ label: t('Imagen'), chips: [{ t: t('Cambiar imagen…'), ic: 'add_photo_alternate', on: false, raw: () => this.pickFromTray((m) => this.changeBlock(b.id, () => P.setImage(b, m)), 'image') }] });
      rows.push({ label: t('Texto alternativo'), html: `<input type="text" class="tp-alt" value="${esc(im.alt)}" aria-label="${esc(t('Texto alternativo'))}">`, wire: (root) => { const inp = $('.tp-alt', root); inp.onchange = () => this.changeBlock(b.id, () => P.setAlt(b, inp.value)); } });
    }
    return rows;
  };
  const designRows = E.designRows;
  if (designRows) E.designRows = function (b) { return b.type === 'third' ? [] : designRows.call(this, b); };

  // Barra del bloque: etiqueta con el plugin, «Estilo» y «Editar en WordPress»
  const decorate = E.decorateBlock;
  E.decorateBlock = function (el, b, extra) {
    if (b.type !== 'third') return decorate.call(this, el, b, extra);
    const ty = $('.blk-type', el);
    if (ty) ty.innerHTML = `<span class="ms">extension</span>${esc(pluginName(b))} · ${esc(t(specOf(b).label || b.name))}`;
    if (this.styleRows(b).length) this.styleBtn(extra, b, false);
    const a = window.WpEditorUI?.avail?.();
    extra.insertAdjacentHTML('beforeend', `${extra.children.length ? '<span class="lv-sep"></span>' : ''}<button class="lv" data-wped="1" ${a && a.ok ? '' : 'disabled'} title="${esc(a && a.ok ? t('Editar con el editor de WordPress') : window.WpEditorUI?.explain?.(a) || '')}"><span class="ms">edit_square</span><span class="lbl">${esc(t('Editar en WordPress'))}</span></button>`);
    $('[data-wped]', extra).onclick = () => this.editInWp(b.id);
  };

  // «Editar en WordPress»: se compone el bloque (con sus hijos) y se abre en el editor oficial
  const editInWp = E.editInWp;
  E.editInWp = async function (id) {
    const loc = this.locate(id);
    if (!loc || loc.b.type !== 'third') return editInWp.call(this, id);
    const markup = await window.api.composeDraft([JSON.parse(JSON.stringify(loc.b))]);
    if (!markup) return;
    const blocks = await window.WpEditorUI.run(markup, 'block');
    if (!blocks) return;
    let ref = null;
    this.change(() => { window.WpEditorLogic.replaceBlockIn(this.draft.blocks, id, blocks); ref = blocks[0]; });
    if (ref) this.setSel?.([ref.id], ref.id);
    K.info(t('Bloque actualizado con el editor de WordPress.'));
  };

  // Lista de capas: el texto del bloque
  const summary = E.summary;
  E.summary = function (b) { return b.type === 'third' ? P.plainText(b).split(' ').slice(0, 7).join(' ') : summary.call(this, b); };
})();
