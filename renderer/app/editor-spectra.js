// Ecos · Editor de entradas (convertir bloques de Spectra). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
// --- Convertir bloques de Spectra en bloques de Ecos ---------------------------------------------------
// Las páginas montadas con Spectra (uagb/*) llegan al editor como bloques «raw» que no se pueden editar.
// El aviso de arriba ofrece convertirlos; se hace en el sitio con BlockEditor.change (Ctrl+Z lo deshace).
const SPECTRA_LABELS = {
  'post-carousel': 'carrusel de entradas', 'post-grid': 'cuadrícula de entradas', 'post-masonry': 'mosaico de entradas', 'post-timeline': 'línea de tiempo de entradas',
  forms: 'formulario', form: 'formulario', 'cf7-styler': 'formulario', 'gf-styler': 'formulario', slider: 'slider', tabs: 'pestañas', timeline: 'línea de tiempo', 'content-timeline': 'línea de tiempo',
  countdown: 'cuenta atrás', 'table-of-contents': 'índice', 'social-share': 'botones para compartir', 'star-rating': 'valoración con estrellas', review: 'reseña', lottie: 'animación',
  modal: 'ventana emergente', 'popup-builder': 'ventana emergente', 'price-list': 'lista de precios', 'how-to': 'guía paso a paso', 'inline-notice': 'aviso', 'marketing-button': 'botón de marketing', 'taxonomy-list': 'lista de categorías',
};
// Cuántos bloques de Spectra (también dentro de secciones y columnas) quedan sin convertir en el borrador
function spectraCount() {
  const BE = window.BlockEditor;
  if (!draft || !BE) return 0;
  return BE.flat(draft.blocks || []).filter((b) => b.type === 'raw' && /^\s*<!--\s+wp:uagb\//.test(b.markup || ''))
    .reduce((n, b) => n + (b.markup.match(/<!--\s+wp:uagb\/[a-z0-9-]+(?=[\s{/])/g) || []).length, 0);
}
// Bloques de Spectra que Ecos ya edita (tipo «third»): «Convertir en página de Ecos» también los pasa a bloques normales
function spectraThird() {
  const BE = window.BlockEditor;
  return !!(draft && BE && BE.flat(draft.blocks || []).some((b) => b.type === 'third' && b.plugin === 'spectra'));
}
function renderSpectraNote() {
  const box = $('#d-spectra');
  if (!box) return;
  const n = draft && !draft.previewOnly ? spectraCount() : 0;
  box.classList.toggle('hidden', !n);
  if (!n) { box.innerHTML = ''; return; }
  const page = isPageDraft();
  const head = n === 1
    ? (page ? t('Esta página tiene 1 bloque de Spectra que Ecos no puede editar.') : t('Esta entrada tiene 1 bloque de Spectra que Ecos no puede editar.'))
    : (page ? t('Esta página tiene {n} bloques de Spectra que Ecos no puede editar.', { n }) : t('Esta entrada tiene {n} bloques de Spectra que Ecos no puede editar.', { n }));
  box.innerHTML = `<span class="ms">view_quilt</span><div class="spx-txt"><b>${escHtml(head)}</b> ${escHtml(t('Al convertirlos se podrán editar aquí. Hasta que pulses «Enviar a WordPress» no cambia nada en la web, y la versión anterior queda en el Historial. Puedes deshacerlo con Ctrl+Z.'))}</div>`
    + `<button class="btn filled small spx-btn" type="button" id="spx-convert"><span class="ms">auto_fix_high</span>${escHtml(page ? t('Convertir en página de Ecos') : t('Convertir en entrada de Ecos'))}</button>`;
  $('#spx-convert').onclick = (e) => busy(e.currentTarget, convertSpectraDraft);
}
async function convertSpectraDraft() {
  const BE = window.BlockEditor;
  const r = await window.api.convertSpectra(JSON.parse(JSON.stringify(draft.blocks || [])));
  const kept = (r.kept || []).map((k) => {
    const name = String(k).replace(/^uagb\//, ''), label = SPECTRA_LABELS[name] ? t(SPECTRA_LABELS[name]) : name;
    return `${label} (${(r.keptCounts || {})[k] || 1})`;
  });
  if (!r.converted) { toast(kept.length ? t('Ecos no puede convertir estos bloques; se mantienen tal cual: {k}', { k: kept.join(', ') }) : t('No había nada que convertir.'), !!kept.length); return; }
  BE.change(() => { draft.blocks = r.blocks; });
  const base = r.converted === 1 ? t('Convertido 1 bloque') : t('Convertidos {n} bloques', { n: r.converted });
  toast(kept.length ? `${base}; ${t('se mantienen tal cual: {k}', { k: kept.join(', ') })}` : base + '.');
}
