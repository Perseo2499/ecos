// Ecos · Pantalla de arranque. Se carga en <head> (antes de pintar nada): toma el tema que manda main.js en la dirección
// (?boot=light|dark|vinyl) para que el fondo coincida desde el primer instante, y ofrece BootSplash.done() para quitarla
// con un fundido cuando ya se ve la pantalla de acceso o Inicio. Si algo falla, se quita sola a los 12 s.
(function () {
  let theme = 'light';
  try { theme = new URLSearchParams(location.search).get('boot') || ''; } catch { /* sin dirección */ }
  if (!/^(light|dark|vinyl)$/.test(theme)) theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.boot = theme;
  let gone = false;
  const done = () => {
    if (gone) return; gone = true;
    const el = document.getElementById('boot-splash');
    if (!el) return;
    requestAnimationFrame(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    });
  };
  window.BootSplash = { done, theme };
  setTimeout(done, 12000);
})();
