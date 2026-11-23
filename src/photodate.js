// Fecha real de una foto que no está en ninguna entrada: la escrita en el nombre del archivo (WhatsApp, móviles,
// cámaras…) o la que la cámara guardó dentro de la foto (EXIF, «fecha de captura»).

// «WhatsApp-Image-2023-02-04-at-…», «IMG_20190512_…», «20190512_123456», «Screenshot_2020-01-01…» → 'AAAA-MM-DD'
function dateFromName(name) {
  const n = decodeURIComponent(String(name || '')).split('/').pop();
  const m = n.match(/(?<!\d)((?:19|20)\d{2})([-_.]?)(0[1-9]|1[0-2])\2(0[1-9]|[12]\d|3[01])(?!\d)/);
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 1990 || y > new Date().getFullYear()) return null;
  return `${m[1]}-${m[3]}-${m[4]}`;
}

// Fecha de captura dentro de una JPEG (los primeros KB bastan). buf: Buffer → 'AAAA-MM-DDTHH:MM:SS' o null
function exifDate(buf) {
  if (isWebp(buf)) return webpExifDate(buf);
  if (!Buffer.isBuffer(buf) || buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 < buf.length) {
    if (buf[p] !== 0xff) return null;
    const marker = buf[p + 1], len = buf.readUInt16BE(p + 2);
    if (marker === 0xe1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') return tiffDate(buf, p + 10, Math.min(buf.length, p + 2 + len));
    if (marker === 0xda) return null; // empieza la imagen: no hay EXIF
    p += 2 + len;
  }
  return null;
}
function tiffDate(buf, t, end) {
  if (t + 8 > end) return null;
  const le = buf.toString('latin1', t, t + 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const readIfd = (off) => {
    const out = {};
    const at = t + off;
    if (at + 2 > end) return out;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > end) break;
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8), at: e + 8 };
    }
    return out;
  };
  const str = (tag) => {
    if (!tag || tag.type !== 2 || tag.count < 19) return null;
    const o = tag.count > 4 ? t + tag.value : tag.at;
    if (o + 19 > end) return null;
    const s = buf.toString('latin1', o, o + 19);
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
  };
  const ifd0 = readIfd(u32(t + 4));
  const exif = ifd0[0x8769] ? readIfd(ifd0[0x8769].value) : {};
  return str(exif[0x9003]) || str(exif[0x9004]) || str(ifd0[0x0132]); // captura, digitalización, modificación
}


// ---- WebP: el EXIF va en un trozo «EXIF» del contenedor RIFF (al convertir una foto a WebP se conserva la fecha de captura)
const isWebp = (b) => Buffer.isBuffer(b) && b.length >= 20 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
function webpExifDate(buf) {
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === 'EXIF') {
      let t = p + 8;
      if (buf.toString('latin1', t, t + 6) === 'Exif\0\0') t += 6;
      return tiffDate(buf, t, Math.min(buf.length, p + 8 + size));
    }
    p += 8 + size + (size & 1);
  }
  return null;
}
// EXIF mínimo (little endian) con la fecha de captura 'AAAA-MM-DDTHH:MM:SS'
function minimalExif(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const b = Buffer.alloc(64);
  b.write('II', 0, 'latin1'); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4);
  b.writeUInt16LE(1, 8); b.writeUInt16LE(0x8769, 10); b.writeUInt16LE(4, 12); b.writeUInt32LE(1, 14); b.writeUInt32LE(26, 18); b.writeUInt32LE(0, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(0x9003, 28); b.writeUInt16LE(2, 30); b.writeUInt32LE(20, 32); b.writeUInt32LE(44, 36); b.writeUInt32LE(0, 40);
  b.write(`${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6]}\0`, 44, 'latin1');
  return b;
}
// Añade a un WebP (sin EXIF) la fecha de captura. Si algo no cuadra devuelve el WebP tal cual.
function webpWithDate(webp, iso) {
  try {
    const exif = minimalExif(iso);
    if (!exif || !isWebp(webp)) return webp;
    const chunk = Buffer.concat([Buffer.from('EXIF'), Buffer.from(Uint32Array.of(exif.length).buffer), exif]);
    const first = webp.toString('latin1', 12, 16);
    let body;
    if (first === 'VP8X') {
      body = Buffer.from(webp.subarray(12)); body[8] |= 0x08; // bit de «hay EXIF»
    } else {
      const d = 20;
      let w, h;
      if (first === 'VP8 ') { w = webp.readUInt16LE(d + 6) & 0x3fff; h = webp.readUInt16LE(d + 8) & 0x3fff; }
      else if (first === 'VP8L' && webp[d] === 0x2f) { const bits = webp.readUInt32LE(d + 1); w = (bits & 0x3fff) + 1; h = ((bits >>> 14) & 0x3fff) + 1; }
      else return webp;
      const vp8x = Buffer.alloc(18);
      vp8x.write('VP8X', 0, 'latin1'); vp8x.writeUInt32LE(10, 4); vp8x[8] = 0x08;
      vp8x.writeUIntLE(w - 1, 12, 3); vp8x.writeUIntLE(h - 1, 15, 3);
      body = Buffer.concat([vp8x, webp.subarray(12)]);
    }
    const pad = (body.length & 1) ? Buffer.alloc(1) : Buffer.alloc(0);
    const all = Buffer.concat([body, pad, chunk, exif.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
    head.writeUInt32LE(all.length + 4, 4);
    return Buffer.concat([head, all]);
  } catch { return webp; }
}

module.exports = { dateFromName, exifDate, isWebp, webpWithDate };
