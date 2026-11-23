// Copia local antes de cada envío: antes de sobrescribir una entrada o página en WordPress, Ecos guarda en
// userData/send-backups/<tipo>-<id>/<fecha>.json lo que había en WordPress y lo que va a enviar (se conservan las 20
// últimas por entrada). Desde el Historial del editor se puede cargar una de esas copias en el editor (sin enviar).
const fs = require('fs');
const path = require('path');

const KEEP = 20;
const FILE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?\.json$/;
const kind = (type) => (type === 'page' ? 'page' : 'post');
const clean = (id) => String(id).replace(/[^0-9A-Za-z_-]/g, '');

const dirFor = (root, type, id) => path.join(root, 'send-backups', `${kind(type)}-${clean(id)}`);
// Solo lo que se guarda de cada lado (título, contenido, extracto, estado)
const slim = (p) => (p ? { title: String(p.title ?? ''), content: String(p.content ?? ''), excerpt: String(p.excerpt ?? ''), status: String(p.status ?? '') } : null);

// Guarda una copia y borra las más antiguas hasta dejar KEEP. Devuelve el nombre del archivo (o null si no se pudo).
function save(root, type, id, { current, sending, error } = {}, now = new Date(), keep = KEEP) {
  try {
    if (!clean(id)) return null;
    const dir = dirFor(root, type, id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    let name = `${stamp}.json`;
    for (let n = 1; fs.existsSync(path.join(dir, name)); n++) name = `${stamp}-${n}.json`;
    const rec = { version: 1, at: now.toISOString(), type: kind(type), id: Number(id) || String(id), current: slim(current), sending: slim(sending), ...(error ? { error: String(error) } : {}) };
    fs.writeFileSync(path.join(dir, name), JSON.stringify(rec, null, 1));
    prune(dir, keep);
    return name;
  } catch { return null; }
}
const names = (dir) => { try { return fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).sort((a, b) => (a.slice(0, -5) < b.slice(0, -5) ? 1 : -1)); } catch { return []; } };
function prune(dir, keep = KEEP) { for (const f of names(dir).slice(keep)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* nada */ } } }

// Lista (la más reciente primero) con un resumen de cada copia
function list(root, type, id) {
  const dir = dirFor(root, type, id);
  return names(dir).map((file) => {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const text = String(r.current?.content || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
      return { file, at: r.at, title: r.current?.title ?? '', status: r.current?.status ?? '', words: text.split(/\s+/).filter(Boolean).length, hasCurrent: !!r.current, error: r.error || '' };
    } catch { return null; }
  }).filter(Boolean);
}
// Una copia entera (solo nombres de archivo propios: nada de rutas)
function read(root, type, id, file) {
  if (!FILE_RE.test(String(file))) throw new Error('Copia no válida.');
  return JSON.parse(fs.readFileSync(path.join(dirFor(root, type, id), file), 'utf8'));
}

module.exports = { KEEP, save, list, read, dirFor, prune };
