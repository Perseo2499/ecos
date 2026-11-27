// Editor de bloques · «Editar en WordPress»: los bloques de otros plugins (Spectra, Kadence…) que Ecos no sabe editar (bloques «De WordPress»,
// tipo raw) se editan con el editor oficial de WordPress en una ventana propia; y desde el menú de insertar se añade cualquier bloque de la web.
// La lógica pura está en renderer/wpeditor.js; la ventana, en src/wpeditorwin.js (proceso principal).
(function () {
  const E = window.BlockEditor, K = window.BlockKit, L = window.WpEditorLogic;
  const { $, t, esc, bid } = K;
  const msg = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  let busy = false;

  const avail = () => L.availability(window.CFG || (typeof CFG !== 'undefined' ? CFG : {}));
  const cfgNow = () => window.CFG || (typeof CFG !== 'undefined' ? CFG : {});

  // Textos de la ventana (con su traducción) y colores del tema de la app (claro, oscuro, vinilo)
  function labels(kind) {
    return {
      title: kind === 'post' ? t('Editor de WordPress · entrada completa') : kind === 'new' ? t('Editor de WordPress · bloque nuevo') : t('Editor de WordPress · bloque'),
      done: t('Terminar y volver a Ecos'), cancel: t('Cancelar'), saving: t('Guardando en WordPress…'),
      saveFailed: t('No se pudo guardar en WordPress. Revisa el aviso del editor y vuelve a pulsar «Terminar», o cancela.'),
      notReady: t('El editor de WordPress aún no ha cargado. Espera un momento y vuelve a pulsar «Terminar».'),
      loginHint: t('Si WordPress te pide iniciar sesión, hazlo una vez: Ecos la recuerda. (Con el Complemento de Ecos 1.6 entra solo.)'),
    };
  }
  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    return { bg: v('--surface-c', v('--surface', '#f4f1ea')), fg: v('--on-surface', '#1d1b16'), accent: v('--primary', '#1f5c4a'), on: v('--on-primary', '#ffffff') };
  }
  const explain = (a) => (a.reason === 'mode' ? t('El editor de WordPress solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.') : t('Conecta tu web en Conexiones → WordPress para usar el editor de WordPress.'));

  // Abre el editor con `markup` (vacío = bloque nuevo). Devuelve los bloques resultantes o null (cancelado / error con aviso)
  async function run(markup, kind) {
    const a = avail();
    if (!a.ok) { K.toast(explain(a)); return null; }
    if (busy) return null;
    busy = true;
    K.info(t('Abriendo el editor de WordPress…'));
    try {
      const r = await window.api.wpEditorEdit({ markup, labels: labels(kind), colors: colors() });
      if (!r || r.cancelled) { K.info(t('Edición cancelada: no se ha cambiado nada.')); return null; }
      return L.freshIds(r.blocks, bid);
    } catch (e) { K.toast(msg(e)); return null; } finally { busy = false; }
  }

  Object.assign(E, {
    // «Editar en WordPress» de un bloque raw: sustituye el bloque por lo que devuelva el editor (se puede deshacer)
    async editInWp(id) {
      const loc = this.locate(id);
      const markup = L.rawMarkup(loc?.b);
      if (!markup) return;
      const blocks = await run(markup, 'block');
      if (!blocks) return;
      if (!blocks.length) { if (!(await window.ask?.(t('El editor ha devuelto el bloque vacío. ¿Quitarlo de la entrada?'), { danger: true, ok: t('Quitar') }))) return; }
      let ref = null;
      this.change(() => { L.replaceBlockIn(this.draft.blocks, id, blocks); ref = blocks[0]; });
      if (ref) this.setSel?.([ref.id], ref.id);
      K.info(blocks.every((b) => b.type !== 'raw') ? t('Bloque actualizado: ahora Ecos lo puede editar.') : t('Bloque actualizado con el editor de WordPress.'));
    },
  });

  // --- El bloque «De WordPress» (raw): botón «Editar en WordPress» (o por qué no está disponible) -----------------------------
  const rawType = E.types.raw;
  E.types.raw = function (b, i, body, extra) {
    rawType.call(this, b, i, body, extra);
    const a = avail();
    const box = $('.raw-box > div', body);
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'raw-acts';
    row.innerHTML = a.ok
      ? `<button type="button" class="btn tonal small" data-a="wped"><span class="ms">edit_square</span>${esc(t('Editar en WordPress'))}</button>`
      : `<button type="button" class="btn tonal small" data-a="wped" disabled aria-describedby="wped-why-${esc(b.id)}"><span class="ms">edit_square</span>${esc(t('Editar en WordPress'))}</button><span class="hint" id="wped-why-${esc(b.id)}">${esc(explain(a))}</span>`;
    box.appendChild(row);
    $('[data-a="wped"]', row).onclick = () => this.editInWp(b.id);
    if (extra && a.ok) {
      extra.insertAdjacentHTML('beforeend', `<span class="lv-sep"></span><button class="lv" data-wped="1" title="${esc(t('Editar con el editor de WordPress'))}"><span class="ms">edit_square</span><span class="lbl">${esc(t('Editar en WordPress'))}</span></button>`);
      $('[data-wped]', extra).onclick = () => this.editInWp(b.id);
    }
  };

  // --- Menú de insertar: «Bloque de WordPress (Spectra, Kadence…)» ------------------------------------------------------------
  const openMenu = E.openMenu;
  E.openMenu = function (anchor, pick) {
    openMenu.call(this, anchor, pick);
    const btn = $('#ins-menu [data-type="wpeditor"]');
    if (!btn) return;
    const a = avail();
    btn.classList.toggle('hidden', !a.ok); // en otros modos de WordPress la opción no aparece
    btn.onclick = () => { $('#ins-menu').classList.add('hidden'); run('', 'new').then((list) => { if (list && list.length) pick('sections', list); }); };
  };

  window.WpEditorUI = { run, labels, colors, avail, explain };
})();
