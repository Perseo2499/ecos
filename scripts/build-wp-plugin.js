// Genera los archivos del complemento a partir del código de Ecos y empaqueta build/ecos-wordpress.zip
// (ese zip viaja dentro de la app: package.json → build.extraResources). ZIP sin compresión, sin dependencias.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'wp-plugin', 'ecos');
const ZIP_OUT = path.join(ROOT, 'build', 'ecos-wordpress.zip');

// Archivos de assets generados a partir del renderer y del CSS común
function writeAssets() {
  const assets = path.join(PLUGIN, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const head = (n) => `// Generado por scripts/build-wp-plugin.js a partir de ${n}. No lo edites a mano.\n`;
  const rd = (n) => fs.readFileSync(path.join(ROOT, 'renderer', n), 'utf8');
  fs.writeFileSync(path.join(assets, 'ecos-carousel.js'), head('renderer/carousel.js') + rd('carousel.js'));
  fs.writeFileSync(path.join(assets, 'ecos-videos.js'), head('renderer/videos.js') + rd('videos.js'));
  const { FX_CSS } = require('../src/transform');
  fs.writeFileSync(path.join(assets, 'ecos.css'), '/* Generado por scripts/build-wp-plugin.js: estilos comunes de los efectos de Ecos. */\n' + Object.values(FX_CSS).join('\n') + '\n');
}

const version = () => (/^\s*\*\s*Version:\s*([\d.]+)/m.exec(fs.readFileSync(path.join(PLUGIN, 'ecos.php'), 'utf8')) || [])[1] || '0';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// files: [{ name: 'ecos/ecos.php', data: Buffer }] → Buffer con un ZIP sin compresión
function makeZip(files) {
  const local = [], central = [];
  let offset = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

function build(out = ZIP_OUT) {
  writeAssets();
  const files = [];
  const walk = (dir, rel) => {
    for (const f of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, f), r = rel + '/' + f;
      if (fs.statSync(full).isDirectory()) walk(full, r); else files.push({ name: r, data: fs.readFileSync(full) });
    }
  };
  walk(PLUGIN, 'ecos');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, makeZip(files));
  return { out, version: version(), files: files.map((f) => f.name) };
}

module.exports = { build, writeAssets, version, makeZip, ZIP_OUT, PLUGIN };
if (require.main === module) { const r = build(); console.log(`Complemento v${r.version}: ${r.out} (${r.files.length} archivos)`); }
