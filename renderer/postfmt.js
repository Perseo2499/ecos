// Ecos · Lógica pura del detalle de cada publicación (Redes): texto con enlaces, #hashtags y @menciones (siempre escapado),
// duración de vídeo y «hace X». (Sirve en la app —window.PostFmt— y en las pruebas —module.exports—.)
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
  const TAG_RE = /(^|[^\p{L}\p{N}_&/])([#@])([\p{L}\p{N}_][\p{L}\p{N}_.]*[\p{L}\p{N}_]|[\p{L}\p{N}_])/gu;
  // Separa los signos finales que no forman parte de la dirección («…/x).» → «…/x» + «).»)
  function splitUrl(u) {
    let url = u, tail = '';
    for (;;) {
      const m = /[.,;:!?)\]}»”’]+$/.exec(url);
      if (!m) break;
      if (m[0][0] === ')' && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
      tail = m[0] + tail; url = url.slice(0, url.length - m[0].length);
    }
    return { url, tail };
  }
  const tags = (s) => esc(s).replace(TAG_RE, (all, pre, ch, name) => (ch === '#' && /^\d+$/.test(name) ? all : `${pre}<span class="${ch === '#' ? 'pd-tag' : 'pd-men'}">${ch}${name}</span>`));
  // Texto de una publicación → HTML seguro: saltos de línea, enlaces (solo http/https), #hashtags y @menciones resaltados.
  function formatText(text) {
    const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    let out = '', last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(src))) {
      const { url, tail } = splitUrl(m[0]);
      out += tags(src.slice(last, m.index));
      if (url.length > 8) out += `<a href="${esc(url)}" class="pd-link" rel="noopener noreferrer" target="_blank">${esc(url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(0, 60) + (url.length > 70 ? '…' : url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').slice(60)))}</a>${esc(tail)}`;
      else out += esc(m[0]);
      last = m.index + m[0].length;
    }
    out += tags(src.slice(last));
    return out.replace(/\n/g, '<br>');
  }
  // 75 → «1:15»; 3725 → «1:02:05»; sin dato válido → ''
  function fmtDuration(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return '';
    const s = Math.round(n), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  }
  // «hace 3 días» / «3 days ago» (Intl.RelativeTimeFormat); fecha inválida → ''
  function relTime(date, now, lang) {
    const d = new Date(date), t = d.getTime();
    if (Number.isNaN(t)) return '';
    const diff = t - (now == null ? Date.now() : new Date(now).getTime());
    const rtf = new Intl.RelativeTimeFormat(lang === 'en' ? 'en' : 'es', { numeric: 'auto' });
    const a = Math.abs(diff);
    if (a < 60e3) return rtf.format(0, 'second');
    if (a < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
    if (a < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
    if (a < 30 * 86400e3) return rtf.format(Math.round(diff / 86400e3), 'day');
    if (a < 365 * 86400e3) return rtf.format(Math.round(diff / (30 * 86400e3)), 'month');
    return rtf.format(Math.round(diff / (365 * 86400e3)), 'year');
  }
  const api = { esc, formatText, fmtDuration, relTime, splitUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PostFmt = api;
})(typeof window !== 'undefined' ? window : globalThis);
