// Ecos · Recomendar categorías a partir del contenido de las entradas (sin IA).
// TF-IDF + agrupación (k-means esférico) + nombres a partir de los términos más característicos.
// Función pura: recommend(posts, cats, opts) → [{ name, isNew, existingId?, keywords, posts: [{ id, title, score }] }]
// posts: [{ id, title, excerpt, text, categories: [nombres] }]   cats: [{ id, name }]

const STOP = new Set(`a al algo algun alguna algunas alguno algunos alla alli ambos ante antes aquel aquella aquellas aquello aquellos aqui asi aun aunque bajo bastante bien cada casi como con contra cual cuales cuando cuanto de del desde donde dos durante e el ella ellas ello ellos en entre era erais eran eras eres es esa esas ese eso esos esta estaba estaban estado estamos estan estar estas este esto estos estoy fue fueron fui fuimos ha habia han hace hacen hacer hacia hasta hay la las le les lo los mas me mi mia mias mientras mio mios mis misma mismas mismo mismos mucha muchas mucho muchos muy nada ni ningun ninguna no nos nosotros nuestra nuestras nuestro nuestros nunca o os otra otras otro otros para pero poco por porque pues que quien quienes se sea sean segun ser si sido siempre sin sino sobre sois solo somos son soy su sus tambien tampoco tan tanto te tendra tener tengo ti tiene tienen todas todavia todo todos tras tu tus un una unas uno unos usted ustedes va vais valor vamos van varias varios vez voy vosotros vuestra vuestro y ya yo
dia dias ano anos hoy ayer manana gracias entrada entradas leer mas aqui asociacion elin ceuta web blog foto fotos imagen imagenes info informacion publicado publicada nuevo nueva nuevos nuevas gran grandes parte puede pueden podemos ademas primer primera primeros segundo tercer cuatro cinco seis siete ocho nueve diez cosas cosa forma manera lugar tiempo semana semanas mes meses vez veces dentro fuera junto junta juntos juntas puedes quieres quiere queremos hemos haber hecho hizo hicieron sido estaban estaremos sera seran seria ser esta estan estuvo tuvo tuvieron tenemos ello esto eso aquello cualquier quienes cuyo cuya todo toda ver vea vimos vamos www http https com org html`.split(/\s+/).filter(Boolean));

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (s) => strip(s).replace(/<[^>]+>/g, ' ').split(/[^a-zñ]+/).filter((w) => w.length >= 4 && !STOP.has(w));
// Clave de una palabra: quita el plural sencillo (talleres/taller, jornadas/jornada)
const keyOf = (w) => (w.length > 5 && w.endsWith('es') && !/[aeiou]es$/.test(w) ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function recommend(posts, cats = [], { maxGroups = 12, minPosts = 3, k } = {}) {
  const N = posts.length;
  if (N < minPosts) return [];
  const surface = new Map(); // clave → { forma: veces }
  const docs = posts.map((p) => {
    const tf = new Map();
    const add = (s, w) => {
      for (const word of tokens(s)) {
        const key = keyOf(word);
        tf.set(key, (tf.get(key) || 0) + w);
        const sf = surface.get(key) || new Map(); sf.set(word, (sf.get(word) || 0) + 1); surface.set(key, sf);
      }
    };
    add(p.title, 3); add(p.excerpt, 2); add(p.text, 1);
    return tf;
  });
  const df = new Map();
  for (const tf of docs) for (const key of tf.keys()) df.set(key, (df.get(key) || 0) + 1);
  const maxDf = Math.max(3, Math.floor(N * 0.6));
  const idf = (key) => Math.log((N + 1) / (df.get(key) + 0.5));
  // vector TF-IDF normalizado (solo términos que aparecen en 2 o más entradas y no en casi todas)
  const vecs = docs.map((tf) => {
    const v = new Map(); let n = 0;
    for (const [key, f] of tf) {
      const d = df.get(key);
      if (d < 2 || d > maxDf) continue;
      const w = (1 + Math.log(f)) * idf(key);
      v.set(key, w); n += w * w;
    }
    n = Math.sqrt(n) || 1;
    for (const [key, w] of v) v.set(key, w / n);
    return v;
  });
  const dot = (a, b) => { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const [key, w] of x) { const o = y.get(key); if (o) s += w * o; } return s; };
  const K = Math.min(maxGroups, Math.max(2, k || Math.round(N / 4)), N);
  // Centros iniciales: el primero es la entrada con más términos; los demás, la más alejada de los ya elegidos
  const first = vecs.reduce((bi, v, i) => (v.size > vecs[bi].size ? i : bi), 0);
  const centers = [new Map(vecs[first])];
  while (centers.length < K) {
    let best = -1, bs = Infinity;
    vecs.forEach((v, i) => {
      if (!v.size) return;
      const s = Math.max(...centers.map((c) => dot(v, c)));
      if (s < bs) { bs = s; best = i; }
    });
    if (best < 0) break;
    centers.push(new Map(vecs[best]));
  }
  let assign = new Array(N).fill(-1);
  for (let iter = 0; iter < 20; iter++) {
    const next = vecs.map((v) => {
      let b = -1, bs = 1e-9;
      centers.forEach((c, ci) => { const s = dot(v, c); if (s > bs) { bs = s; b = ci; } });
      return b;
    });
    const same = next.every((x, i) => x === assign[i]);
    assign = next;
    if (same) break;
    centers.forEach((c, ci) => {
      const sum = new Map();
      vecs.forEach((v, i) => { if (assign[i] === ci) for (const [key, w] of v) sum.set(key, (sum.get(key) || 0) + w); });
      if (!sum.size) return;
      let n = 0; for (const w of sum.values()) n += w * w; n = Math.sqrt(n) || 1;
      for (const [key, w] of sum) sum.set(key, w / n);
      centers[ci] = sum;
    });
  }
  const show = (key) => { const sf = surface.get(key); const w = [...sf.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0]; return w; };
  const real = (cats || []).filter((c) => c && c.name && !/^(uncategorized|sin categor)/.test(strip(c.name)));
  const catKeys = real.map((c) => ({ ...c, keys: tokens(c.name).map(keyOf) }));
  const hasCat = (p, name) => (p.categories || []).some((n) => strip(n) === strip(name));
  const out = [];
  centers.forEach((c, ci) => {
    const members = [];
    vecs.forEach((v, i) => { if (assign[i] === ci) members.push({ i, s: dot(v, c) }); });
    if (members.length < minPosts) return;
    const top = [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!top.length) return;
    const keywords = top.map(([key]) => show(key));
    // ¿encaja con una categoría que ya existe? (todas las palabras de su nombre entre las claves del grupo)
    const topKeys = new Set(top.slice(0, 6).map(([key]) => key));
    const ex = catKeys.find((cat) => cat.keys.length && cat.keys.every((key) => topKeys.has(key)));
    let name;
    if (ex) name = ex.name;
    else {
      name = cap(keywords[0]);
      if (top[1] && top[1][1] >= top[0][1] * 0.8) name += ' y ' + keywords[1];
    }
    const list = members.sort((a, b) => b.s - a.s)
      .filter((m) => !ex || !hasCat(posts[m.i], ex.name))
      .map((m) => ({ id: posts[m.i].id, title: posts[m.i].title, score: Math.round(m.s * 100) / 100 }));
    if (list.length < minPosts) return;
    out.push({ name, isNew: !ex, ...(ex ? { existingId: ex.id } : {}), keywords, posts: list });
  });
  // Categorías existentes cuyo nombre aparece mucho en las entradas (aunque no formen un grupo)
  for (const cat of catKeys) {
    if (!cat.keys.length || out.some((o) => o.existingId === cat.id)) continue;
    const hits = [];
    docs.forEach((tf, i) => {
      if (hasCat(posts[i], cat.name)) return;
      const f = Math.min(...cat.keys.map((key) => tf.get(key) || 0));
      if (f >= 3) hits.push({ id: posts[i].id, title: posts[i].title, score: Math.min(1, Math.round(f / 10 * 100) / 100) });
    });
    if (hits.length >= minPosts) out.push({ name: cat.name, isNew: false, existingId: cat.id, keywords: cat.keys.map(show), posts: hits.sort((a, b) => b.score - a.score) });
  }
  // Nombres repetidos entre grupos nuevos: se añade la segunda palabra clave
  const seen = new Set();
  for (const o of out) {
    let n = strip(o.name);
    if (seen.has(n) && o.isNew && o.keywords[1]) o.name += ' ' + o.keywords[1];
    seen.add(strip(o.name));
  }
  return out.sort((a, b) => b.posts.length - a.posts.length).slice(0, maxGroups);
}

module.exports = { recommend, tokens, keyOf, STOP };
