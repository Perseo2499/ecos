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

module.exports = { dateFromName, exifDate };
