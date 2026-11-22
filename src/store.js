// Guarda la configuración en %APPDATA%; los tokens se cifran con safeStorage (DPAPI en Windows).
// Con contraseña (cfg.lock), las claves van además en una bóveda cifrada con ella (ver vault.js) y no
// se pueden leer hasta desbloquear la app.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const V = require('./vault');

const file = () => path.join(app.getPath('userData'), 'config.json');
const SECRET_KEYS = ['metaAppSecret', 'metaUserToken', 'wpClientSecret', 'wpToken', 'wpAppPassword', 'anthropicKey', 'gpClientSecret', 'gpAccessToken', 'gpRefreshToken'];
const sys = { enc: (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : s), dec: (s) => (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s, 'base64')) : s) };

let key = null;      // llave de la bóveda (solo en memoria y solo mientras está desbloqueada)
let vaultBlob = null; // bóveda tal como está en disco (para no perderla mientras está bloqueada)

// --- Claves dentro de la configuración ----------------------------------------------------
function takeSecrets(cfg) {
  const s = { top: {}, ai: {}, totp: cfg.__totp || null, recovery: cfg.__recovery || [] };
  for (const k of SECRET_KEYS) if (cfg[k]) s.top[k] = cfg[k];
  for (const [id, p] of Object.entries(cfg.ai?.providers || {})) if (p.key) s.ai[id] = p.key;
  return s;
}
function putSecrets(cfg, s) {
  for (const [k, v] of Object.entries(s.top || {})) cfg[k] = v;
  for (const [id, v] of Object.entries(s.ai || {})) { cfg.ai = cfg.ai || { providers: {} }; cfg.ai.providers = cfg.ai.providers || {}; cfg.ai.providers[id] = { ...(cfg.ai.providers[id] || {}), key: v }; }
  cfg.__totp = s.totp || null; cfg.__recovery = s.recovery || [];
}
function wipeSecrets(cfg) {
  for (const k of SECRET_KEYS) delete cfg[k];
  for (const p of Object.values(cfg.ai?.providers || {})) delete p.key;
  delete cfg.__totp; delete cfg.__recovery;
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (raw.lock) { // protegida con contraseña: las claves siguen cifradas hasta desbloquear
      vaultBlob = raw.vault || null; delete raw.vault; key = null;
      wipeSecrets(raw);
      return raw;
    }
    for (const k of SECRET_KEYS) {
      if (raw[k] && safeStorage.isEncryptionAvailable()) {
        try { raw[k] = safeStorage.decryptString(Buffer.from(raw[k], 'base64')); } catch { raw[k] = ''; } // una clave ilegible no borra el resto
      }
    }
    for (const prov of Object.values(raw.ai?.providers || {})) {
      if (prov.key && safeStorage.isEncryptionAvailable()) {
        try { prov.key = safeStorage.decryptString(Buffer.from(prov.key, 'base64')); } catch { prov.key = ''; }
      }
    }
    return raw;
  } catch {
    return {};
  }
}

function save(cfg) {
  const out = JSON.parse(JSON.stringify(cfg));
  delete out.__totp; delete out.__recovery;
  if (cfg.lock) {
    if (key) vaultBlob = sys.enc(V.encrypt(takeSecrets(cfg), key)); // desbloqueada: se actualiza la bóveda
    wipeSecrets(out);
    out.vault = vaultBlob; // bloqueada: se conserva tal cual
  } else {
    for (const k of SECRET_KEYS) if (out[k] && safeStorage.isEncryptionAvailable()) out[k] = safeStorage.encryptString(out[k]).toString('base64');
    for (const p of Object.values(out.ai?.providers || {})) if (p.key && safeStorage.isEncryptionAvailable()) p.key = safeStorage.encryptString(p.key).toString('base64');
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, file()); // escritura atómica: un corte de luz no deja el archivo a medias
}

// --- Contraseña ---------------------------------------------------------------------------
const isLocked = (cfg) => !!cfg.lock && !key;
// Comprueba la contraseña y devuelve las claves de la bóveda (sin aplicarlas todavía)
function open(cfg, password) {
  const k = V.deriveKey(password, cfg.lock.salt);
  try { return { k, secrets: V.decrypt(sys.dec(vaultBlob), k) }; } catch { throw new Error('Contraseña incorrecta'); }
}
function unlock(cfg, opened) { key = opened.k; putSecrets(cfg, opened.secrets); }
// Windows Hello: la llave de la bóveda llega envuelta con la llave de Hello
const currentKey = () => key;
function openWithKey(cfg, k) { try { return { k, secrets: V.decrypt(sys.dec(vaultBlob), k) }; } catch { throw new Error('No se pudo abrir la bóveda con Windows Hello'); } }
function lockNow(cfg) { if (!cfg.lock) return; save(cfg); key = null; wipeSecrets(cfg); }
function setPassword(cfg, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  cfg.lock = { v: 1, salt, kdf: 'scrypt', auto: cfg.lock?.auto ?? 15, at: new Date().toISOString() };
  key = V.deriveKey(password, salt);
  save(cfg);
}
function clearPassword(cfg) { delete cfg.lock; delete cfg.__totp; delete cfg.__recovery; key = null; vaultBlob = null; save(cfg); }
// Contraseña olvidada: se quita la protección y se pierden las claves (hay que volver a conectar)
function resetForgotten(cfg) { delete cfg.lock; wipeSecrets(cfg); key = null; vaultBlob = null; cfg.wpSelfOk = false; save(cfg); }

// Datos aparte (p. ej. el borrador autoguardado): cifrados con la bóveda si hay contraseña
const seal = (cfg, obj) => (cfg.lock && key ? 'ENC:' + V.encrypt(obj, key) : JSON.stringify(obj));
const unseal = (cfg, text) => { if (!text) return null; if (text.startsWith('ENC:')) return key ? V.decrypt(text.slice(4), key) : null; return JSON.parse(text); };

module.exports = { currentKey, openWithKey, seal, unseal, load, save, isLocked, open, unlock, lockNow, setPassword, clearPassword, resetForgotten, SECRET_KEYS };
