// Fotos repetidas en la biblioteca: la misma foto subida varias veces (a menudo una pequeña y otra grande).
// Cada foto se resume en una «huella» de 64 bits (dHash: se reduce a 9×8 en gris y se compara cada punto
// con el de su derecha); dos fotos son la misma si sus huellas casi coinciden y tienen la misma forma.

// gray: 72 valores (9 columnas × 8 filas) → huella en hexadecimal (16 caracteres)
function dhash(gray) {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
// Puntos en los que se diferencian dos huellas
function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < 16; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}
// Mapa de bits BGRA (de nativeImage, 9×8) → 72 grises
function grayFromBGRA(buf) {
  const out = [];
  for (let i = 0; i < 72; i++) out.push(0.114 * buf[i * 4] + 0.587 * buf[i * 4 + 1] + 0.299 * buf[i * 4 + 2]);
  return out;
}
// items: [{ id, hash, width, height, size }] → grupos de repetidas [{ keep, drop: [ids] }]
// Se queda la de más resolución (y, a igualdad, la que más pesa).
function groupDuplicates(items, { maxDist = 6 } = {}) {
  const list = items.filter((m) => m.hash && m.width && m.height);
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const ra = a.width / a.height, rb = b.width / b.height;
      if (Math.abs(ra - rb) / ra > 0.03) continue; // otra forma: no es la misma foto
      if (hamming(a.hash, b.hash) <= maxDist) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  list.forEach((m, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(m); });
  return [...groups.values()].filter((g) => g.length > 1).map((g) => {
    const best = [...g].sort((x, y) => y.width * y.height - x.width * x.height || (y.size || 0) - (x.size || 0))[0];
    return { keep: best.id, drop: g.filter((m) => m.id !== best.id).map((m) => m.id) };
  });
}

module.exports = { dhash, hamming, grayFromBGRA, groupDuplicates };
