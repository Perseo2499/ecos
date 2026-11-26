// Genera THIRD-PARTY-NOTICES.md a partir de package-lock.json (dependencias de producción y sus transitivas
// que se empaquetan en Windows). Reproducible: `node scripts/third-party.js` (o `--check` para comprobar que está al día).
// La licencia sale del propio lockfile; si falta, de node_modules/<paquete>/package.json.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'THIRD-PARTY-NOTICES.md');

// Licencias compatibles con GPL-3.0-or-later (como componente combinado o distribuido junto al programa)
const COMPATIBLE = /^(MIT|MIT-0|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|Zlib|BlueOak-1\.0\.0|Unlicense|CC0-1\.0|Python-2\.0|GPL-3\.0(-only|-or-later)?|LGPL-[23]\.[01](-only|-or-later)?|MPL-2\.0|CC-BY-4\.0)$/;

// Licencias declaradas de forma ambigua, revisadas a mano contra el LICENSE del paquete
const MANUAL = { 'parse-cache-control': 'BSD-3-Clause (declarada como «BSD»; revisado el LICENSE)' };

function licenseOf(p, lockEntry) {
  let l = lockEntry.license;
  const nm = p.replace(/^.*node_modules\//, '');
  if (MANUAL[nm] && (!l || l === 'BSD')) return MANUAL[nm];
  if (!l) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, p, 'package.json'), 'utf8'));
      l = j.license || (Array.isArray(j.licenses) ? j.licenses.map((x) => x.type).join(' OR ') : j.licenses && j.licenses.type);
    } catch { /* sin node_modules */ }
  }
  if (l && typeof l === 'object') l = l.type;
  return l || 'SIN LICENCIA DECLARADA';
}

// «MIT OR Apache-2.0», «(MIT AND Zlib)»: compatible si todas las alternativas AND lo son y alguna OR lo es
function isCompatible(expr) {
  const e = expr.replace(/\s*\(.*$/, '').replace(/[()]/g, ' ').trim();
  return e.split(/\s+AND\s+/).every((and) => and.split(/\s+OR\s+/).some((x) => COMPATIBLE.test(x.trim())));
}

function collect() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const P = lock.packages;
  const resolve = (from, name) => {
    // resolución de Node: node_modules más cercano hacia arriba
    let dir = from;
    for (;;) {
      const key = (dir ? dir + '/' : '') + 'node_modules/' + name;
      if (P[key]) return key;
      if (!dir) return null;
      const i = dir.lastIndexOf('/node_modules/');
      dir = i >= 0 ? dir.slice(0, i) : '';
    }
  };
  const seen = new Map();
  const visit = (key) => {
    if (seen.has(key)) return;
    const e = P[key];
    // plataformas que no son Windows no se empaquetan
    if (e.os && !e.os.includes('win32')) return;
    if (e.cpu && !e.cpu.some((c) => c === 'x64')) return;
    seen.set(key, e);
    for (const dep of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) {
      const k = resolve(key, dep);
      if (k) visit(k);
    }
  };
  for (const dep of Object.keys(pkg.dependencies || {})) { const k = resolve('', dep); if (k) visit(k); }
  const direct = new Set(Object.keys(pkg.dependencies || {}));
  return [...seen.entries()].map(([key, e]) => {
    const name = key.replace(/^.*node_modules\//, '');
    return { name, version: e.version, license: licenseOf(key, e), direct: direct.has(name) && key === 'node_modules/' + name };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function build() {
  const list = collect();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const ffv = (lock.packages['node_modules/ffmpeg-static'] || {}).version || '?';
  let ffTag = 'b6.1.1';
  try { ffTag = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/ffmpeg-static/package.json'), 'utf8'))['ffmpeg-static']['binary-release-tag']; } catch { /* valor por defecto */ }
  const elv = (pkg.devDependencies || {}).electron || '';
  const problem = list.filter((x) => !isCompatible(x.license));
  const L = [];
  L.push('# Avisos de software de terceros / Third-party notices', '');
  L.push('Ecos es software libre bajo la licencia [GPL-3.0-or-later](LICENSE) (© 2026 Perseo2499). Incluye los componentes de terceros de abajo, cada uno con su propia licencia.');
  L.push('Este archivo lo genera `node scripts/third-party.js` a partir de `package-lock.json`; no lo edites a mano.', '');
  L.push('## Componentes destacados', '');
  L.push('### FFmpeg (mediante `ffmpeg-static`)', '');
  L.push(`- Ecos incluye un ejecutable de **FFmpeg** (paquete npm \`ffmpeg-static\` ${ffv}, publicación de binarios \`${ffTag}\`, FFmpeg 6.1.1) para recomprimir vídeos y convertir imágenes a WebP. Se ejecuta como programa aparte (no se enlaza con el código de Ecos).`);
  L.push('- Licencia del binario: **GPL-3.0-or-later** (las compilaciones de Windows de gyan.dev usadas por `ffmpeg-static` se construyen con `--enable-gpl --enable-version3`). El paquete `ffmpeg-static` también es GPL-3.0-or-later.');
  L.push('- **Código fuente de FFmpeg**: <https://ffmpeg.org/download.html> (repositorio: <https://git.ffmpeg.org/ffmpeg.git>; etiqueta de la versión 6.1.1: `n6.1.1`). Texto de la licencia: <https://www.gnu.org/licenses/gpl-3.0.html>.');
  L.push('- Origen de los binarios: <https://github.com/eugeneware/ffmpeg-static/releases/tag/' + ffTag + '> (Windows x64 de <https://www.gyan.dev/ffmpeg/builds/>; sus scripts de compilación y opciones están en esa web). Si necesitas el código fuente exacto del binario incluido, pídelo abriendo una incidencia en <https://github.com/Perseo2499/ecos/issues> o consúltalo en los enlaces anteriores.');
  L.push('- FFmpeg es una marca registrada de Fabrice Bellard. Los derechos de autor de FFmpeg pertenecen a sus autores (<https://ffmpeg.org/legal.html>).', '');
  L.push('### Electron y Chromium', '');
  L.push(`- Ecos se ejecuta sobre **Electron** ${elv} (<https://www.electronjs.org>, licencia MIT, © GitHub Inc. y colaboradores), que incluye **Chromium** y **Node.js**.`);
  L.push('- Chromium incluye numerosos componentes con licencias BSD, MIT, Apache-2.0, MPL, LGPL y otras. Sus avisos completos están en los archivos `LICENSE` y `LICENSES.chromium.html` que acompañan a Electron en la carpeta de instalación de Ecos (y en <https://github.com/electron/electron/blob/main/LICENSE>).');
  L.push('- Código fuente: Electron <https://github.com/electron/electron>, Chromium <https://chromium.googlesource.com/chromium/src>, Node.js <https://github.com/nodejs/node>.', '');
  L.push('### Otros componentes incluidos', '');
  L.push('- **Real-ESRGAN ncnn Vulkan** (mejora de fotos con IA): <https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan> (licencia MIT). No forma parte del instalador: Ecos lo descarga de ese repositorio solo si el usuario activa «mejorar fotos con IA».', '');
  L.push('## Dependencias de producción (npm)', '');
  L.push(`Total: ${list.length} paquetes empaquetados en Windows x64. «Directa» = declarada en \`package.json\`.`, '');
  L.push('| Paquete | Versión | Licencia | Directa |', '|---|---|---|---|');
  for (const x of list) L.push(`| ${x.name} | ${x.version} | ${x.license} | ${x.direct ? 'sí' : ''} |`);
  L.push('', '## Compatibilidad con GPL-3.0', '');
  if (problem.length) {
    L.push('Dependencias que requieren revisión manual:', '');
    for (const x of problem) L.push(`- ${x.name}@${x.version}: ${x.license}`);
  } else {
    L.push('Todas las licencias anteriores (MIT, ISC, BSD, Apache-2.0, GPL, etc.) son compatibles con su distribución junto a un programa GPL-3.0-or-later. Apache-2.0 es compatible con GPL-3.0 (no con GPL-2.0).');
  }
  L.push('');
  return { text: L.join('\n'), list, problem };
}

module.exports = { collect, build, isCompatible };

if (require.main === module) {
  const { text, list, problem } = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('THIRD-PARTY-NOTICES.md está desactualizado: ejecuta node scripts/third-party.js'); process.exit(1); }
    console.log('THIRD-PARTY-NOTICES.md al día');
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`THIRD-PARTY-NOTICES.md: ${list.length} paquetes; a revisar: ${problem.length}`);
    for (const x of problem) console.log('  ' + x.name + '@' + x.version + ' ' + x.license);
  }
}
