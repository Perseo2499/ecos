// Ecos para WordPress · contador de visitas sin cookies ni datos personales.
// Una sola señal por entrada y navegador cada 30 minutos (se recuerda en sessionStorage, no en cookies).
(function () {
  var cfg = window.ecosHit;
  if (!cfg || !cfg.url || !cfg.id) return;
  if (navigator.webdriver || document.prerendering) return;
  var key = 'ecos_hit_' + cfg.id, WINDOW = 30 * 60 * 1000;
  try {
    var last = Number(window.sessionStorage.getItem(key) || 0);
    if (last && Date.now() - last < WINDOW) return;
  } catch (e) { /* sin sessionStorage: se cuenta igualmente (el servidor limita) */ }
  var sent = false;
  function send() {
    if (sent) return;
    sent = true;
    try { window.sessionStorage.setItem(key, String(Date.now())); } catch (e) { /* nada */ }
    var body = JSON.stringify({ id: cfg.id });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(cfg.url, new Blob([body], { type: 'application/json' }))) return;
    } catch (e) { /* se prueba con fetch */ }
    try { fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, credentials: 'omit' }); } catch (e) { /* nada */ }
  }
  // Solo si la pestaña se ve (no en precargas ni en segundo plano)
  if (document.visibilityState === 'visible') send();
  else document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') send(); });
})();
