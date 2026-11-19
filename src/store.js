// Guarda la configuración en %APPDATA%; los tokens se cifran con safeStorage (DPAPI en Windows).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'config.json');
const SECRET_KEYS = ['metaAppSecret', 'metaUserToken', 'wpClientSecret', 'wpToken', 'wpAppPassword', 'anthropicKey'];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
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
  const out = { ...cfg };
  for (const k of SECRET_KEYS) {
    if (out[k] && safeStorage.isEncryptionAvailable()) {
      out[k] = safeStorage.encryptString(out[k]).toString('base64');
    }
  }
  if (out.ai?.providers) {
    out.ai = { ...out.ai, providers: Object.fromEntries(Object.entries(out.ai.providers).map(([id, prov]) => [id,
      prov.key && safeStorage.isEncryptionAvailable() ? { ...prov, key: safeStorage.encryptString(prov.key).toString('base64') } : prov])) };
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(out, null, 2));
}

module.exports = { load, save };
