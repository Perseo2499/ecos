// Barra superior de la ventana del editor de WordPress: título, «Cancelar» y «Terminar y volver a Ecos».
// Los textos y colores llegan en la dirección (?p=JSON) y solo se pintan como texto; la única vía hacia la app son dos mensajes (wpedBar).
(function () {
  const $ = (id) => document.getElementById(id);
  let o = {};
  try { o = JSON.parse(new URLSearchParams(location.search).get('p') || '{}'); } catch { /* sin datos */ }
  const css = document.documentElement.style;
  const ok = (c) => (/^#[0-9a-f]{3,8}$/i.test(c) || /^rgba?\([\d\s.,%/]+\)$/i.test(c) ? c : '');
  for (const [k, v] of Object.entries({ bg: o.bg, fg: o.fg, accent: o.accent, on: o.on })) if (ok(v)) css.setProperty('--' + k, v);
  // el rojo del aviso de error se aclara sobre fondos oscuros (contraste)
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(ok(o.bg) || '');
  if (m && 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) < 110) css.setProperty('--err', '#ff9a90');
  $('title').textContent = o.title || '';
  $('hint').textContent = o.hint || '';
  $('cancel').textContent = o.cancel || 'Cancelar';
  $('done').textContent = o.done || 'Terminar y volver a Ecos';
  const busy = (on) => { $('done').disabled = on; $('cancel').disabled = false; };
  $('done').onclick = () => { busy(true); window.wpedBar.send('done'); };
  $('cancel').onclick = () => window.wpedBar.send('cancel');
  window.wpedBar.onState((s) => {
    busy(!!s.busy);
    $('msg').classList.toggle('err', !!s.error);
    $('hint').textContent = s.msg || (s.busy ? '' : o.hint || '');
  });
})();
