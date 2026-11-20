// Fotos más ligeras antes de subirlas: se reducen a 2560 px por el lado largo (lo que de sobra necesita una
// web) y las JPEG se vuelven a comprimir con calidad 85. Solo se usa el resultado si pesa menos.
// Las PNG (pueden tener transparencia) se reducen pero siguen siendo PNG; los GIF y vídeos no se tocan.
const MAX = 2560;
let isEnabled = () => true;
const setEnabled = (fn) => { isEnabled = fn; };

function optimize(buf, type = '', name = '') {
  try {
    if (!isEnabled() || !Buffer.isBuffer(buf) || buf.length < 150 * 1024) return { buf, type, name };
    const kind = /png/i.test(type) || /\.png$/i.test(name) ? 'png' : /jpe?g/i.test(type) || /\.jpe?g$/i.test(name) ? 'jpeg' : /webp/i.test(type) || /\.webp$/i.test(name) ? 'webp' : null;
    if (!kind) return { buf, type, name };
    const { nativeImage } = require('electron');
    let img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return { buf, type, name };
    const { width, height } = img.getSize();
    const scale = Math.min(1, MAX / Math.max(width, height));
    if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' });
    let out, outType = type, outName = name;
    if (kind === 'png') { if (scale === 1) return { buf, type, name }; out = img.toPNG(); }
    else { out = img.toJPEG(85); outType = 'image/jpeg'; outName = name.replace(/\.(webp|jpe?g)$/i, '') + '.jpg'; }
    if (out.length >= buf.length && scale === 1) return { buf, type, name }; // no se gana nada
    return { buf: out, type: outType, name: outName, saved: buf.length - out.length };
  } catch {
    return { buf, type, name };
  }
}

module.exports = { optimize, setEnabled, MAX };
