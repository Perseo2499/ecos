// Ecos · Copias de seguridad programadas: lógica pura (sin Electron ni red) para poder probarla.
// Calendario (próxima ejecución, con horario de verano), cuándo toca, condiciones (enchufado, con red),
// retención (solo las automáticas), historial y validación de los ajustes.

const FREQS = ['daily', 'weekly', 'monthly'];
const KINDS = ['web', 'emergency'];
const CLOUDS = ['none', 'drive'];
const RETRY_MS = 2 * 3600e3; // tras un fallo, se reintenta como pronto a las 2 horas
const MAX_FAILS = 4;         // y como mucho 4 intentos por cada hora prevista
const HISTORY_MAX = 100;

const DEFAULTS = Object.freeze({
  enabled: false, kind: 'web', freq: 'weekly', weekday: 0, monthday: 1, time: '03:00',
  onlyPlugged: true, needNetwork: true, keep: 5, dir: '', photos: true, cloud: 'none',
  enabledAt: 0, lastOkAt: 0, lastAttempt: 0, lastFailed: false, failures: 0, lastFailure: null,
});

const num = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : d; };
const normTime = (s, d = '03:00') => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()); if (!m || +m[1] > 23 || +m[2] > 59) return d; return `${m[1].padStart(2, '0')}:${m[2]}`; };

// Ajustes completos a partir de lo guardado (valores raros → los de siempre)
function withDefaults(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = { ...DEFAULTS, ...r };
  s.enabled = !!s.enabled;
  s.kind = KINDS.includes(s.kind) ? s.kind : DEFAULTS.kind;
  s.freq = FREQS.includes(s.freq) ? s.freq : DEFAULTS.freq;
  s.weekday = Math.max(0, Math.min(6, num(s.weekday, 0)));
  s.monthday = Math.max(1, Math.min(31, num(s.monthday, 1)));
  s.time = normTime(s.time);
  s.onlyPlugged = s.onlyPlugged !== false; s.needNetwork = s.needNetwork !== false; s.photos = s.photos !== false;
  s.keep = Math.max(1, Math.min(60, num(s.keep, DEFAULTS.keep)));
  s.dir = String(s.dir || '').trim();
  s.cloud = CLOUDS.includes(s.cloud) ? s.cloud : 'none';
  for (const k of ['enabledAt', 'lastOkAt', 'lastAttempt', 'failures']) s[k] = Math.max(0, Number(s[k]) || 0);
  s.lastFailed = !!s.lastFailed;
  return s;
}

// Cambios que llegan de la interfaz: solo se aceptan los campos del usuario y se validan. Al activar la programación
// se anota cuándo, para no lanzar de golpe una copia «atrasada» de antes de activarla.
function applyPatch(cur, patch = {}, now = Date.now()) {
  const c = withDefaults(cur), next = { ...c };
  const bad = (m) => { throw new Error(m); };
  if ('kind' in patch) { if (!KINDS.includes(patch.kind)) bad('Tipo de copia no válido'); next.kind = patch.kind; }
  if ('freq' in patch) { if (!FREQS.includes(patch.freq)) bad('Frecuencia no válida'); next.freq = patch.freq; }
  if ('weekday' in patch) next.weekday = Math.max(0, Math.min(6, num(patch.weekday, c.weekday)));
  if ('monthday' in patch) next.monthday = Math.max(1, Math.min(31, num(patch.monthday, c.monthday)));
  if ('time' in patch) { if (normTime(patch.time, '') === '') bad('Hora no válida'); next.time = normTime(patch.time); }
  for (const k of ['onlyPlugged', 'needNetwork', 'photos']) if (k in patch) next[k] = !!patch[k];
  if ('keep' in patch) next.keep = Math.max(1, Math.min(60, num(patch.keep, c.keep)));
  if ('dir' in patch) next.dir = String(patch.dir || '').trim();
  if ('cloud' in patch) { if (!CLOUDS.includes(patch.cloud)) bad('Destino no válido'); next.cloud = patch.cloud; }
  if ('enabled' in patch) { next.enabled = !!patch.enabled; if (next.enabled && !c.enabled) { next.enabledAt = now; next.failures = 0; } }
  return next;
}

// ---------------------------------------------------------------- calendario (hora local; el cambio de hora lo resuelve Date)
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const matchesDay = (s, d) => (s.freq === 'daily' ? true : s.freq === 'weekly' ? d.getDay() === s.weekday : d.getDate() === Math.min(s.monthday, daysIn(d.getFullYear(), d.getMonth())));
// La hora prevista de un día. Si esa hora no existe (se adelanta el reloj) Date la pasa a la siguiente (02:30 → 03:30).
function slotAt(s, y, m, d) { const [hh, mm] = normTime(s.time).split(':').map(Number); return new Date(y, m, d, hh, mm, 0, 0); }

// Primera hora prevista estrictamente posterior a «now» (timestamp)
function nextRun(raw, now = Date.now()) {
  const s = withDefaults(raw), n = new Date(now);
  for (let i = 0; i <= 400; i++) {
    const day = new Date(n.getFullYear(), n.getMonth(), n.getDate() + i);
    if (!matchesDay(s, day)) continue;
    const t = slotAt(s, day.getFullYear(), day.getMonth(), day.getDate());
    if (+t > now) return +t;
  }
  return null;
}
// Última hora prevista que ya ha pasado (≤ now)
function prevRun(raw, now = Date.now()) {
  const s = withDefaults(raw), n = new Date(now);
  for (let i = 0; i <= 400; i++) {
    const day = new Date(n.getFullYear(), n.getMonth(), n.getDate() - i);
    if (!matchesDay(s, day)) continue;
    const t = slotAt(s, day.getFullYear(), day.getMonth(), day.getDate());
    if (+t <= now) return +t;
  }
  return null;
}

// ¿Toca hacer la copia programada ahora? (sin mirar enchufe ni red: eso es conditions)
// Se hace si ha pasado la hora prevista y todavía no hay una copia buena desde entonces. Si la app estaba cerrada,
// toca al abrirla. Tras un fallo se reintenta cada 2 horas, hasta 4 veces por hora prevista.
function isDue(raw, now = Date.now()) {
  const s = withDefaults(raw);
  if (!s.enabled) return false;
  const slot = prevRun(s, now);
  if (slot == null || slot <= Math.max(s.lastOkAt, s.enabledAt)) return false;
  if (s.lastFailed && s.lastAttempt >= slot) return now - s.lastAttempt >= RETRY_MS && s.failures < MAX_FAILS;
  return true;
}

// Enchufado y con red. {ok, reason: 'battery'|'offline'|null}
function conditions(raw, { onBattery = false, online = true } = {}) {
  const s = withDefaults(raw);
  if (s.onlyPlugged && onBattery) return { ok: false, reason: 'battery' };
  if (s.needNetwork && !online) return { ok: false, reason: 'offline' };
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------- historial
// Entrada: { id, at, kind, auto, ok, bytes, file, name, cloud: {ok, id, name, error}, error, stats, verified, removed }
const newId = (at = Date.now()) => `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function addEntry(list, e) { return [e, ...list.filter((x) => x.id !== e.id)].sort((a, b) => b.at - a.at).slice(0, HISTORY_MAX); }
const patchEntry = (list, id, patch) => list.map((x) => (x.id === id ? { ...x, ...patch } : x));

// Qué entradas del historial sobran para conservar las últimas «keep» copias AUTOMÁTICAS buenas de ese tipo.
// Las manuales y las fallidas nunca se tocan.
function pickRetention(list, kind, keep) {
  const n = Math.max(1, Math.floor(Number(keep)) || 1);
  return list.filter((e) => e.auto && e.ok && !e.removed && e.kind === kind && (e.file || e.cloud?.id)).sort((a, b) => b.at - a.at).slice(n);
}

// «today» | «yesterday» | «date», para el aviso de fallo
function whenLabel(at, now = Date.now()) {
  const d = new Date(at), n = new Date(now);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 864e5);
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : 'date';
}

// Nombre del archivo de la copia de la web
const pad = (n) => String(n).padStart(2, '0');
function webName(host, d = new Date(), photos = true) {
  const h = String(host || 'web').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '') || 'web';
  return `ecos-web-${h}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${photos ? 'zip' : 'xml'}`;
}
const isWebName = (n) => /^ecos-web-.+-\d{4}-\d{2}-\d{2}-\d{4}\.(zip|xml)$/.test(n);

module.exports = { DEFAULTS, FREQS, KINDS, CLOUDS, RETRY_MS, MAX_FAILS, HISTORY_MAX, withDefaults, applyPatch, nextRun, prevRun, isDue, conditions, newId, addEntry, patchEntry, pickRetention, whenLabel, webName, isWebName };
