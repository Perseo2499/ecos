// Mosaico que se adapta al número de fotos: rejilla de 6 columnas hecha por grupos de 1 a 5 piezas que
// siempre encajan sin huecos (los grupos alternan de lado para que no se repita). Lo usan el editor y WordPress.
(function (root) {
  // [columna de inicio, columnas, fila de inicio, filas] dentro de cada grupo
  const T = {
    1: [[1, 6, 1, 2]],
    2: [[1, 3, 1, 2], [4, 3, 1, 2]],
    3: [[1, 4, 1, 2], [5, 2, 1, 1], [5, 2, 2, 1]],
    4: [[1, 4, 1, 2], [5, 2, 1, 2], [1, 3, 3, 1], [4, 3, 3, 1]],
    5: [[1, 2, 1, 2], [3, 4, 1, 2], [1, 2, 3, 1], [3, 2, 3, 1], [5, 2, 3, 1]],
  };
  const ROWS = { 1: 2, 2: 2, 3: 2, 4: 3, 5: 3 };
  // 6 → 3+3, 7 → 4+3, 8 → 5+3, 9 → 5+4… (nunca grupos de 1 o 2 salvo que solo haya 1 o 2 fotos)
  function groups(n) {
    const out = [];
    let r = n;
    while (r > 5) for (const s of [5, 4, 3]) { if (r - s === 0 || r - s >= 3) { out.push(s); r -= s; break; } }
    if (r) out.push(r);
    return out;
  }
  function mosaicLayout(n) {
    const cells = [];
    let row = 1;
    groups(n).forEach((size, gi) => {
      const mirror = gi % 2 === 1;
      // (en orden de lectura: de arriba abajo y de izquierda a derecha)
      cells.push(...T[size].map(([c, cs, r, rs]) => ({ col: mirror ? 8 - c - cs : c, cols: cs, row: row + r - 1, rows: rs }))
        .sort((x, y) => x.row - y.row || x.col - y.col));
      row += ROWS[size];
    });
    return { cells, rows: row - 1 };
  }
  const api = { mosaicLayout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Mosaic = api;
})(typeof window !== 'undefined' ? window : globalThis);
