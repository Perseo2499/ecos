// Ecos · Modo sin conexión: detecta si hay conexión (navigator.onLine + fallos reales de red), muestra un indicador
// discreto en la barra, evita la cascada de avisos «No se ha podido conectar» y, al volver la conexión, avisa y
// procesa la cola de envíos. Los datos del Blog y de las entradas abiertas salen de la caché local (main.js).
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

const Net = (() => {
  const NET_RE = /Failed to fetch|fetch failed|NetworkError|Network request failed|Load failed|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|No se puede conectar con|No se ha podido conectar/i;
  let offline = false, probing = null, cacheAt = 0, announced = false;
  const isNet = (e) => NET_RE.test(String((e && (e.code ? e.code + ' ' : '') + (e.message || e)) || ''));

  function agoText(at) {
    const m = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (m < 1) return t('datos de hace un momento');
    if (m < 60) return t('datos de hace {n} min', { n: m });
    if (m < 60 * 36) return t('datos de hace {n} h', { n: Math.round(m / 60) });
    return t('datos de hace {n} días', { n: Math.round(m / 1440) });
  }
  function paint() {
    const el = $('#off-ind'); if (!el) return;
    el.classList.toggle('hidden', !offline);
    $('#off-text').textContent = t('Sin conexión — puedes seguir trabajando') + (cacheAt ? ' · ' + agoText(cacheAt) : '');
    el.title = t('Sin conexión — puedes seguir trabajando');
    document.documentElement.toggleAttribute('data-offline', offline);
  }
  async function ping() {
    if (!navigator.onLine) return false;
    try { return window.api.netPing ? await window.api.netPing() : true; } catch { return false; }
  }
  function setOffline(v, quiet) {
    if (v === offline) return;
    offline = v;
    if (v) {
      if (!quiet && !announced) { announced = true; toast(t('Sin conexión — puedes seguir trabajando. Los envíos se harán solos al volver la conexión.')); }
      startProbe();
    } else {
      announced = false; cacheAt = 0; clearInterval(probing); probing = null;
      toast(t('Conexión recuperada'));
      window.api.queueOnline?.().then((q) => renderQueue(q)).catch(() => {});
      if (typeof blog !== 'undefined' && blog.loaded && document.querySelector('.cache-note')) loadBlog();
    }
    paint();
  }
  function startProbe() {
    clearInterval(probing);
    probing = setInterval(async () => { if (await ping()) setOffline(false); }, 8000);
  }
  // Un error con aspecto de red: se confirma con una comprobación real y, si no hay conexión, se avisa UNA sola vez
  function swallow(e) {
    if (!isNet(e)) return false;
    if (offline) return true;
    if (!navigator.onLine) { setOffline(true); return true; }
    if (!swallow.checking) {
      swallow.checking = ping().then((ok) => { if (!ok) setOffline(true); }).finally(() => { swallow.checking = null; });
    }
    return !!offline; // mientras se comprueba, el primero se muestra y los siguientes caen en la comprobación
  }
  return {
    get offline() { return offline; },
    isNet, swallow, paint,
    cached(at) { cacheAt = Math.max(cacheAt, at || 0); if (!offline) setOffline(true, true); else paint(); },
    cacheNote: agoText,
    sendDone() { $('#send-prog')?.classList.add('hidden'); },
    set: setOffline,
  };
})();
window.Net = Net;

window.addEventListener('offline', () => Net.set(true));
window.addEventListener('online', async () => { if (await (navigator.onLine && window.api.netPing ? window.api.netPing().catch(() => false) : navigator.onLine)) { Net.set(false); window.api.queueOnline?.().then(renderQueue).catch(() => {}); } });
if (!navigator.onLine) Net.set(true, true);

// Las listas del Blog / Inicio que llegan de la caché marcan «sin conexión» con su fecha
(() => {
  const orig = window.api.blogList;
  if (typeof orig !== 'function') return;
  window.api.blogList = async (...a) => { const r = await orig.apply(window.api, a); if (r && r.cached) Net.cached(r.cached.at); return r; };
})();

// Progreso por pasos del envío (subir fotos → imagen destacada → crear la entrada)
window.api.onSendProgress?.((p) => {
  const box = $('#send-prog'); if (!box) return;
  if (p.step === 'done') { box.classList.add('hidden'); return; }
  const total = p.total || p.mediaTotal || 0;
  const text = p.step === 'media' ? t('Subiendo foto {a} de {b}…', { a: Math.min((p.done || 0) + 1, total || 1), b: total })
    : p.step === 'retry' ? t('Se cortó la conexión; reintentando en {s} s…', { s: Math.round((p.wait || 0) / 1000) })
    : p.step === 'featured' ? t('Preparando la imagen destacada…')
    : p.step === 'finish' ? t('Entrada guardada en WordPress; terminando…')
    : t('Enviando la entrada…');
  const pct = p.step === 'media' && total ? Math.round(((p.done || 0) / total) * 70) : p.step === 'featured' ? 75 : p.step === 'post' ? 85 : p.step === 'finish' ? 95 : 0;
  $('#send-prog-text').textContent = text;
  $('#send-prog-bar').value = pct;
  box.classList.remove('hidden');
});
