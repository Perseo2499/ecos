// Lógica pura de buscadores y redes (sin tocar la pantalla). Se usa en el editor y se prueba con node --test.
(function (root) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // Corta un texto a n caracteres como lo hace Google: en el último espacio y con «…»
  function cut(s, n) {
    s = clean(s);
    if (s.length <= n) return s;
    const head = s.slice(0, n - 1);
    const sp = head.lastIndexOf(' ');
    return (sp > n * 0.6 ? head.slice(0, sp) : head).replace(/[\s,.;:–-]+$/, '') + '…';
  }

  // Color del contador: 'ok' (verde), 'warn' (naranja) o 'bad' (rojo)
  const TITLE = { min: 30, max: 60, hard: 70 };
  const DESC = { min: 70, max: 155, hard: 175 };
  function level(len, r) {
    if (!len || len > r.hard) return 'bad';
    if (len < r.min || len > r.max) return 'warn';
    return 'ok';
  }
  const titleLevel = (s) => level(clean(s).length, TITLE);
  const descLevel = (s) => level(clean(s).length, DESC);

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Avisos para el panel: devuelve códigos; la pantalla los traduce
  function warnings({ title, desc, keyword, hasImage, slug }) {
    const w = [];
    const tl = clean(title).length;
    if (tl > TITLE.max) w.push({ code: 'titleLong', n: tl });
    if (!clean(desc)) w.push({ code: 'noDesc' });
    else if (clean(desc).length > DESC.max) w.push({ code: 'descLong', n: clean(desc).length });
    if (clean(keyword) && !norm(title).includes(norm(clean(keyword)))) w.push({ code: 'kwTitle' });
    if (!hasImage) w.push({ code: 'noImage' });
    if (String(slug || '').length > 60) w.push({ code: 'slugLong', n: String(slug).length });
    return w;
  }

  // Texto de partida para Facebook: el extracto o, si no hay, los primeros párrafos
  function prefill(excerpt, plain, max = 400) {
    const ex = String(excerpt || '').replace(/<[^>]+>/g, '').trim();
    if (ex) return ex;
    const paras = String(plain || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
    let out = '';
    for (const p of paras) {
      if (out && (out + '\n\n' + p).length > max) break;
      out = out ? out + '\n\n' + p : p;
      if (out.length >= max) break;
    }
    return out.length > max ? cut(out, max) : out;
  }

  const URL_RE = /https?:\/\/\S+/gi;
  // Mensaje de Facebook: el enlace va aparte (parámetro link) y así sale la tarjeta; no se repite en el texto
  function fbMessage(text, link) {
    let m = String(text || '').replace(/\r\n/g, '\n');
    link = String(link || '').trim();
    if (link) m = m.split(link).join('');
    m = m.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return { message: m, link };
  }
  // Instagram no admite enlaces en el texto: se quitan y se avisa de que está en la bio
  function igText(text, note) {
    const m = String(text || '').replace(URL_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    return (m ? m + '\n\n' : '') + note;
  }

  const api = { cut, level, titleLevel, descLevel, warnings, prefill, fbMessage, igText, TITLE, DESC, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Seo = api;
})(typeof window !== 'undefined' ? window : globalThis);
