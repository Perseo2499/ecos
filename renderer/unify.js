// Ecos · Lógica pura para juntar varias publicaciones de una misma actividad en una sola entrada
// (sirve en la app y en las pruebas): detectar las «de la misma actividad» y quitar lo repetido.
(function (root) {
  const DAY = 864e5;
  const ms = (d) => { const n = new Date(d).getTime(); return Number.isFinite(n) ? n : 0; };
  const keyOf = (p) => p.source + ':' + p.id;
  const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Hashtags de un texto (en minúsculas y sin tildes)
  const tagsOf = (text) => new Set([...String(text || '').matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => strip(m[1])));
  // Palabras de 4 letras o más, sin tildes, sin hashtags, menciones ni enlaces
  function wordsOf(text) {
    const t = strip(text).replace(/https?:\/\/\S+/g, ' ').replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/@[\w.]+/g, ' ');
    return new Set(t.match(/\p{L}{4,}/gu) || []);
  }
  // Coeficiente de solapamiento: compartidas / tamaño del conjunto más pequeño (0 si hay muy pocas palabras)
  function overlap(a, b) {
    const A = a instanceof Set ? a : wordsOf(a), B = b instanceof Set ? b : wordsOf(b);
    const min = Math.min(A.size, B.size);
    if (min < 3) return 0;
    let n = 0;
    for (const w of A) if (B.has(w)) n++;
    return n / min;
  }

  // Publicaciones sin seleccionar que parecen de la misma actividad que alguna seleccionada:
  // a ≤ 10 días y con un hashtag poco frecuente en común (≤ 30 % de las cargadas) o texto parecido (≥ 0,35).
  function relatedPosts(all, chosen, { isExported = () => false, days = 10, maxTagShare = 0.3, minOverlap = 0.35 } = {}) {
    if (!chosen.length) return [];
    const have = new Set(chosen.map(keyOf));
    const freq = new Map();
    for (const p of all) for (const t of tagsOf(p.text)) freq.set(t, (freq.get(t) || 0) + 1);
    const rare = (t) => (freq.get(t) || 0) / Math.max(1, all.length) <= maxTagShare;
    const info = chosen.map((p) => ({ t: ms(p.date), tags: [...tagsOf(p.text)].filter(rare), words: wordsOf(p.text) }));
    return all.filter((p) => {
      if (have.has(keyOf(p)) || isExported(p)) return false;
      const t = ms(p.date), tags = tagsOf(p.text), words = wordsOf(p.text);
      return info.some((c) => Math.abs(c.t - t) <= days * DAY && (c.tags.some((x) => tags.has(x)) || overlap(c.words, words) >= minOverlap));
    }).sort((a, b) => ms(a.date) - ms(b.date));
  }

  // Línea normalizada para comparar («Gracias a todos!» == «gracias  a todos»)
  const lineKey = (l) => strip(l).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const linesOf = (text) => String(text || '').split('\n');
  // Líneas (no vacías) que están idénticas en todas las publicaciones
  function commonLines(texts) {
    if (texts.length < 2) return new Set();
    const sets = texts.map((t) => new Set(linesOf(t).map(lineKey).filter(Boolean)));
    return new Set([...sets[0]].filter((k) => sets.every((s) => s.has(k))));
  }
  // Quita de cada texto las líneas repetidas en todos (y los párrafos que quedan vacíos)
  function removeCommon(texts) {
    const common = commonLines(texts);
    if (!common.size) return texts.map((t) => String(t || ''));
    return texts.map((t) => linesOf(t).filter((l) => !common.has(lineKey(l))).join('\n').replace(/\n\s*\n(\s*\n)+/g, '\n\n').trim());
  }
  // Primera línea (original) que se repite en todos los textos y cumple `ok`; '' si no hay
  function firstCommonLine(texts, ok = () => true) {
    const common = commonLines(texts);
    for (const l of linesOf(texts[0])) if (common.has(lineKey(l)) && ok(l)) return l;
    return '';
  }

  const api = { tagsOf, wordsOf, overlap, relatedPosts, commonLines, removeCommon, firstCommonLine, lineKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Unify = api;
})(typeof window !== 'undefined' ? window : globalThis);
