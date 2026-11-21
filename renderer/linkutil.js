// Utilidades puras para enlaces dentro de HTML: sacarlos, cambiarlos y quitarlos.
// Las usan el editor (renderer), el proceso principal (src/links.js) y las pruebas.
(function (root) {
  const decodeAmp = (s) => String(s ?? '').replace(/&#0?38;|&#x26;|&amp;/gi, '&');
  const encodeAmp = (s) => String(s).replace(/&/g, '&amp;');
  const decodeText = (s) => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
  const plain = (h) => decodeText(String(h ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const ATTR = (name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const isWeb = (u) => /^https?:\/\/[^\s/]+/i.test(u);

  // [{ url, text }] de los <a href> y, con kind:'image', de los <img src>. Sin duplicados.
  function extractLinks(html) {
    const out = [], seen = new Set();
    const add = (url, text, kind) => {
      url = decodeAmp(url).trim();
      if (!isWeb(url) || seen.has(url)) return;
      seen.add(url);
      out.push(kind ? { url, text, kind } : { url, text });
    };
    const s = String(html ?? '');
    for (const m of s.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const a = ATTR('href').exec(m[1]);
      if (a) add(a[1] ?? a[2] ?? '', plain(m[2]), null);
    }
    // enlaces <a> sin cierre (HTML roto)
    for (const m of s.matchAll(/<a\b([^>]*)>/gi)) {
      const a = ATTR('href').exec(m[1]);
      if (a) add(a[1] ?? a[2] ?? '', '', null);
    }
    for (const m of s.matchAll(/<img\b([^>]*)>/gi)) {
      const a = ATTR('src').exec(m[1]);
      if (a) add(a[1] ?? a[2] ?? '', plain((ATTR('alt').exec(m[1]) || [])[1] || ''), 'image');
    }
    return out;
  }

  // Cambia `from` por `to` solo dentro de atributos href="…" y src="…" (con o sin &amp;). No toca el texto visible.
  function replaceLinkInHtml(html, from, to) {
    const f = decodeAmp(from).trim();
    return String(html ?? '').replace(/<[a-z][^>]*>/gi, (tag) => tag.replace(/\b(href|src)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (all, name, eq, dq, sq) => {
      const v = dq ?? sq;
      if (decodeAmp(v).trim() !== f) return all;
      const q = dq !== undefined ? '"' : "'";
      return `${name}${eq}${q}${encodeAmp(to)}${q}`;
    }));
  }

  // Quita las etiquetas <a> que apuntan a `url`, dejando su texto
  function unlinkInHtml(html, url) {
    const f = decodeAmp(url).trim();
    return String(html ?? '').replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (all, attrs, inner) => {
      const a = ATTR('href').exec(attrs);
      return a && decodeAmp(a[1] ?? a[2] ?? '').trim() === f ? inner : all;
    });
  }

  const api = { extractLinks, replaceLinkInHtml, unlinkInHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LinkUtil = api;
})(typeof self !== 'undefined' ? self : this);
