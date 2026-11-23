// Recalcula sha512 (base64) y size de un instalador dentro de latest.yml.
// Se usa tras firmar el instalador (la firma cambia el archivo) y antes de publicar:
// electron-updater comprueba esos valores al descargar la actualización y rechaza el archivo si no coinciden.
//
// Uso: node scripts/update-latest-yml.js <latest.yml> <instalador.exe> [--blockmap <archivo.blockmap>]
//   --blockmap: si ya existe blockMapSize en la entrada, lo pone al tamaño de ese archivo; sin --blockmap, lo quita.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml'); // dependencia de electron-updater (producción)

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    let size = 0;
    fs.createReadStream(file)
      .on('data', (d) => { h.update(d); size += d.length; })
      .on('error', reject)
      .on('end', () => resolve({ sha512: h.digest('base64'), size }));
  });
}

async function updateLatestYml(ymlPath, exePath, opts = {}) {
  const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'));
  if (!doc || !Array.isArray(doc.files)) throw new Error('latest.yml no tiene la lista «files»');
  const name = path.basename(exePath);
  const sameName = (u) => { try { return decodeURIComponent(String(u)) === name; } catch { return String(u) === name; } };
  const entries = doc.files.filter((f) => sameName(f.url));
  if (!entries.length) throw new Error(`latest.yml no menciona ${name}`);
  const { sha512, size } = await hashFile(exePath);
  const blockSize = opts.blockmap && fs.existsSync(opts.blockmap) ? fs.statSync(opts.blockmap).size : null;
  for (const f of entries) {
    f.sha512 = sha512; f.size = size;
    if ('blockMapSize' in f) { if (blockSize) f.blockMapSize = blockSize; else delete f.blockMapSize; }
  }
  // campos antiguos de nivel superior (electron-updater 1.x), solo si apuntan a este mismo archivo
  if (doc.path && sameName(doc.path)) doc.sha512 = sha512;
  fs.writeFileSync(ymlPath, yaml.dump(doc, { lineWidth: -1 }));
  return { sha512, size, entries: entries.length };
}

module.exports = { updateLatestYml, hashFile };

if (require.main === module) {
  const a = process.argv.slice(2);
  const bi = a.indexOf('--blockmap');
  const blockmap = bi >= 0 ? a.splice(bi, 2)[1] : null;
  if (a.length !== 2) { console.error('Uso: node scripts/update-latest-yml.js <latest.yml> <instalador.exe> [--blockmap <archivo>]'); process.exit(2); }
  updateLatestYml(a[0], a[1], { blockmap }).then((r) => console.log(`latest.yml actualizado: size=${r.size} sha512=${r.sha512.slice(0, 16)}… (${r.entries} entrada/s)`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
