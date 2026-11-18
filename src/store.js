// Guarda la configuración en %APPDATA%; los tokens se cifran con safeStorage (DPAPI en Windows).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'config.json');
const SECRET_KEYS = ['metaAppSecret', 'metaUserToken', 'wpClientSecret', 'wpToken', 'anthropicKey'];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    for (const k of SECRET_KEYS) {
      if (raw[k] && safeStorage.isEncryptionAvailable()) {
        raw[k] = safeStorage.decryptString(Buffer.from(raw[k], 'base64'));
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
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(out, null, 2));
}

module.exports = { load, save };
