// Ecos · Manifiesto y verificación de copias de seguridad.
// Cada ZIP lleva al final «ecos-manifest.json» con la lista de archivos (nombre, tamaño, CRC32) y datos de la copia.
// verifyZip lee el ZIP entero: comprueba que el índice se lee, que cada archivo descomprime y cuadra con su CRC,
// y que lo que dice el manifiesto es lo que hay. Sin manifiesto (copias antiguas) solo comprueba la integridad.
const fs = require('fs');
const zlib = require('zlib');

const MANIFEST = 'ecos-manifest.json';
const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
// CRC32 incremental (prev = valor anterior)
function crcUpdate(prev, buf) {
  if (zlib.crc32) return zlib.crc32(buf, prev) >>> 0;
  let c = ~prev >>> 0;
  for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');

// Añade el manifiesto al ZipWriter (antes de zip.finish()). info: { kind, site, ecos, counts, incremental }
async function addManifest(zip, info = {}) {
  const files = zip.entries.map((e) => ({ n: e.nm.toString('utf8'), s: e.size, c: hex(e.crc) }));
  const body = { format: 'ecos-backup-manifest', version: 1, kind: info.kind || 'web', created: new Date().toISOString(), ecos: info.ecos || '', site: info.site || '', counts: info.counts || {}, incremental: info.incremental || null, files };
  await zip.add(MANIFEST, Buffer.from(JSON.stringify(body), 'utf8'), new Date(), { deflate: true });
  return body;
}

// → { ok, kind, entries, bytes, manifest: 'ok'|'missing'|'bad', problems: [texto], info }
// opts: { onProgress({done,total}), cancelled(), yauzl }
async function verifyZip(file, opts = {}) {
  const yauzl = opts.yauzl || require('yauzl');
  const res = { ok: false, kind: '', entries: 0, bytes: 0, manifest: 'missing', problems: [], info: null };
  let size = 0;
  try { size = fs.statSync(file).size; } catch { res.problems.push('El archivo ya no está.'); return res; }
  if (/\.xml$/i.test(file)) {
    const fd = fs.openSync(file, 'r'); const tail = Buffer.alloc(Math.min(size, 2048)); fs.readSync(fd, tail, 0, tail.length, size - tail.length); fs.closeSync(fd);
    res.kind = 'web'; res.bytes = size; res.manifest = 'missing';
    if (!/<\/rss>\s*$/.test(tail.toString('utf8'))) res.problems.push('El XML está cortado: no termina donde debería.');
    res.ok = !res.problems.length; return res;
  }
  const zip = await new Promise((ok, ko) => yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (e, z) => (e ? ko(e) : ok(z))))
    .catch((e) => { res.problems.push('El ZIP está incompleto o dañado (no se puede leer su índice): ' + e.message); return null; });
  if (!zip) return res;
  const seen = new Map();
  let manifest = null, done = 0;
  const total = zip.entryCount || 0;
  try {
    await new Promise((resolve, reject) => {
      const next = () => zip.readEntry();
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', (e) => {
        if (opts.cancelled?.()) return reject(new Error('Cancelado'));
        if (/\/$/.test(e.fileName)) return next();
        zip.openReadStream(e, (err, st) => {
          if (err) { res.problems.push(`No se puede leer «${e.fileName}»: ${err.message}`); return next(); }
          let crc = 0, n = 0; const chunks = e.fileName === MANIFEST ? [] : null;
          st.on('data', (b) => { crc = crcUpdate(crc, b); n += b.length; if (chunks) chunks.push(b); });
          st.on('error', (er) => { res.problems.push(`«${e.fileName}» está dañado: ${er.message}`); next(); });
          st.on('end', () => {
            if (crc !== (e.crc32 >>> 0)) res.problems.push(`«${e.fileName}» está dañado (la suma de comprobación no coincide).`);
            else if (e.fileName !== MANIFEST) seen.set(e.fileName, { s: n, c: hex(crc) });
            res.bytes += n; res.entries++;
            if (chunks) { try { manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.manifest = 'bad'; res.problems.push('El manifiesto no se puede leer.'); } }
            opts.onProgress?.({ done: ++done, total });
            next();
          });
        });
      });
      next();
    });
  } catch (e) { zip.close(); if (/Cancelado/.test(e.message)) throw e; res.problems.push('Error leyendo el ZIP: ' + e.message); return res; }
  zip.close();
  if (manifest && manifest.format === 'ecos-backup-manifest') {
    res.manifest = 'ok'; res.kind = manifest.kind || ''; res.info = { created: manifest.created, site: manifest.site, counts: manifest.counts, incremental: manifest.incremental };
    const listed = new Map((manifest.files || []).map((f) => [f.n, f]));
    let missing = 0, differ = 0;
    for (const [n, f] of listed) { const got = seen.get(n); if (!got) { if (++missing <= 3) res.problems.push(`Falta «${n}», que el manifiesto lista.`); } else if (got.s !== f.s || got.c !== f.c) { if (++differ <= 3) res.problems.push(`«${n}» no coincide con el manifiesto.`); } }
    if (missing > 3) res.problems.push(`… y faltan ${missing - 3} archivos más.`);
    if (differ > 3) res.problems.push(`… y ${differ - 3} más no coinciden.`);
    const extra = [...seen.keys()].filter((n) => !listed.has(n)).length;
    if (extra) res.problems.push(`Hay ${extra} archivos que el manifiesto no lista.`);
  } else if (res.manifest !== 'bad') {
    res.kind = seen.has('copia.json') ? 'emergency' : seen.has('ecos-copia-de-seguridad.xml') ? 'web' : '';
    if (!res.kind) res.problems.push('No parece una copia de Ecos (no tiene el XML ni copia.json).');
  }
  res.ok = !res.problems.length;
  return res;
}

module.exports = { MANIFEST, addManifest, verifyZip, crcUpdate };
