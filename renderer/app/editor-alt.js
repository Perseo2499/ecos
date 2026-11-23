// Ecos · Editor de entradas (describir fotos con IA). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
// «Describir fotos»: de una en una (respuestas cortas y fiables), con progreso; cada descripción se ve al llegar.
// Si la IA no puede con una foto, se le pone una descripción básica (título de la página y pie de foto) para editar.
let altRun = null;
$('#ai-alts').onclick = async (e) => {
  const btn = e.currentTarget, E = window.BlockEditor;
  if (altRun) { altRun.stop = true; return; } // pulsar otra vez: detener
  const blocks = E.flat(draft.blocks);
  const all = blocks.flatMap((b) => (b.img ? [{ img: b.img, cap: b.caption }] : (b.images || []).map((img) => ({ img, cap: '' })))).filter((x) => x.img.type !== 'video');
  if (!all.length) return toast(t('Esta entrada no tiene fotos'), true);
  let list = all.filter((x) => !(x.img.alt || '').trim());
  if (!list.length) {
    if (!await ask(t('Todas las fotos ya tienen descripción. ¿Volver a describirlas todas?'), { ok: t('Describir de nuevo') })) return;
    list = all;
  }
  const title = $('#d-title').value.trim();
  const basic = (x, n) => [title, (x.cap || '').replace(/<[^>]+>/g, '').trim()].filter(Boolean).join(' — ') + (title || x.cap ? '' : t('Foto {n}', { n }));
  const label = btn.innerHTML;
  altRun = { stop: false };
  let ok = 0, fallback = 0;
  E.snapshot();
  try {
    for (let k = 0; k < list.length && !altRun.stop; k++) {
      btn.innerHTML = `<span class="ms">stop_circle</span>${escHtml(t('Describiendo {a} de {b}… (pulsa para parar)', { a: k + 1, b: list.length }))}`;
      const x = list[k];
      let alt = '';
      try { alt = await window.api.aiAlt(x.img.url, title); } catch { /* se sigue con la siguiente */ }
      if (alt) ok++; else { alt = basic(x, k + 1); fallback++; }
      x.img.alt = alt;
      // se ve al momento debajo de la foto (sin redibujar el editor)
      $$(`#ed-canvas .ph img[src="${CSS.escape(x.img.url)}"]`).forEach((im) => { const inp = im.closest('.ph')?.querySelector('.alt'); if (inp) inp.value = alt; });
    }
  } finally {
    const stopped = altRun.stop;
    altRun = null; btn.innerHTML = label;
    E.onChange();
    toast(fallback
      ? t('{a} fotos descritas con IA y {b} con una descripción básica (revísalas).', { a: ok, b: fallback })
      : stopped ? t('Parado: {a} fotos descritas.', { a: ok }) : t('{a} fotos descritas. Puedes corregirlas debajo de cada foto.', { a: ok }), !!fallback);
  }
};

