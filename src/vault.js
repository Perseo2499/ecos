// Bóveda de claves protegida con contraseña (y doble factor opcional).
// Las claves (Meta, WordPress, IA) se cifran con AES-256-GCM usando una llave derivada de la contraseña
// con scrypt; además, el conjunto se vuelve a cifrar con el sistema (DPAPI en Windows) al guardarlo.
// Sin la contraseña no se pueden leer, aunque se copie el archivo de configuración.
// El doble factor (TOTP, RFC 6238: Google Authenticator, Microsoft Authenticator…) guarda su secreto
// dentro de la bóveda, así que solo se comprueba después de la contraseña.
const crypto = require('crypto');

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const deriveKey = (password, saltHex) => crypto.scryptSync(String(password).normalize('NFC'), Buffer.from(saltHex, 'hex'), 32, SCRYPT);

function encrypt(obj, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function decrypt(blob, key) {
  const b = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')); // falla si la llave no es la buena
}

// --- TOTP --------------------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secretB32, time = Date.now(), step = 30, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = crypto.createHmac('sha1', unbase32(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
// Se acepta el código del intervalo actual y el de al lado (por si el reloj va un poco desfasado)
const checkTotp = (secret, code, now = Date.now()) => /^\d{6}$/.test(String(code).trim()) && [-1, 0, 1].some((w) => crypto.timingSafeEqual(Buffer.from(totp(secret, now + w * 30000)), Buffer.from(String(code).trim())));
const newTotpSecret = () => base32(crypto.randomBytes(20));
const otpauthUrl = (secret, account = 'Ecos', issuer = 'Ecos') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
// Códigos de recuperación: 10 de un solo uso; se guardan solo sus resúmenes (sha256)
const newRecoveryCodes = () => Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})(.{5})/, '$1-$2'));
const hashCode = (c) => crypto.createHash('sha256').update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

module.exports = { deriveKey, encrypt, decrypt, totp, checkTotp, newTotpSecret, otpauthUrl, newRecoveryCodes, hashCode, base32, unbase32 };
