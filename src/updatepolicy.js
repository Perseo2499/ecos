// Ecos · Retraso de las versiones nuevas en el canal estable (lógica pura).
// Una versión publicada hace menos de 24 h no se descarga todavía salvo que el usuario esté en el canal de pruebas.
const DELAY_HOURS = 24;

// releaseDate es la fecha de latest.yml (ISO). Sin fecha válida, no se retrasa. Devuelve el instante (ms) hasta el que
// esperar, o 0 si se puede descargar ya.
function holdUntil(releaseDate, beta, now = Date.now(), hours = DELAY_HOURS) {
  if (beta) return 0;
  const t = Date.parse(releaseDate);
  if (!Number.isFinite(t)) return 0;
  const until = t + hours * 3600 * 1000;
  return until > now ? until : 0;
}
module.exports = { holdUntil, DELAY_HOURS };
