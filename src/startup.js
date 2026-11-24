// Ecos · Modo seguro de arranque (lógica pura; main.js la usa con userData/startup.json).
// Estado: { pending, failures, version }. «pending» queda en true desde que arranca hasta que la ventana
// principal está lista; si en el siguiente arranque sigue en true, el anterior no llegó a mostrarse.
const FAILS_TO_OFFER = 2;
const READY_TIMEOUT_MS = 60000;
const REPO = { owner: 'Perseo2499', repo: 'ecos-releases' }; // instaladores públicos (el código es privado)

const clean = (s) => ({ pending: !!s?.pending, failures: Math.max(0, Number(s?.failures) || 0), version: String(s?.version || '') });

// Al arrancar: si el arranque anterior (misma versión) quedó pendiente, cuenta como fallo.
function begin(prev, version) {
  const p = clean(prev);
  const same = p.version === version || !p.version;
  let failures = same ? p.failures : 0; // otra versión: empieza de cero
  if (p.pending && same) failures += 1;
  return { pending: true, failures, version };
}
// La ventana principal ha llegado a ready-to-show
const ready = (s) => ({ ...clean(s), pending: false, failures: 0 });
// Error fatal o 60 s sin ventana: el arranque se da por fallido (y deja de estar pendiente para no contarlo dos veces)
const fail = (s) => { const c = clean(s); return { ...c, pending: false, failures: c.failures + 1 }; };
const shouldOffer = (s, threshold = FAILS_TO_OFFER) => clean(s).failures >= threshold;
// Tras ofrecer la reparación se vuelve a empezar la cuenta
const offered = (s) => ({ ...clean(s), failures: 0 });

// Del JSON de «latest release» de GitHub, el instalador (Ecos-Setup-x.y.z.exe)
function pickInstaller(release) {
  const a = (release?.assets || []).find((x) => /^Ecos-Setup-.*\.exe$/.test(x?.name || '') && x.browser_download_url);
  return a ? { name: a.name, url: a.browser_download_url } : null;
}

// Descarga el instalador más reciente a la carpeta indicada. Devuelve la ruta del archivo.
async function downloadInstaller(dir, { fetchFn = fetch, fsMod = require('fs'), pathMod = require('path') } = {}) {
  const r = await fetchFn(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Ecos' } });
  if (!r.ok) throw new Error('GitHub respondió ' + r.status);
  const inst = pickInstaller(await r.json());
  if (!inst) throw new Error('La versión publicada no tiene instalador');
  const d = await fetchFn(inst.url, { headers: { 'User-Agent': 'Ecos' } });
  if (!d.ok) throw new Error('Descarga fallida (' + d.status + ')');
  const file = pathMod.join(dir, inst.name);
  fsMod.writeFileSync(file, Buffer.from(await d.arrayBuffer()));
  return file;
}

module.exports = { begin, ready, fail, shouldOffer, offered, pickInstaller, downloadInstaller, FAILS_TO_OFFER, READY_TIMEOUT_MS, REPO };
