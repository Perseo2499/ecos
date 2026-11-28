// Lanza las pruebas contra un WordPress real: `npm run test:wp`
//   WP_URL=https://mi-web.example WP_USER=pruebas WP_APP_PASSWORD="abcd efgh ijkl mnop qrst uvwx" npm run test:wp
// Opción --sim: usa un servidor simulado mínimo (solo para comprobar el guion en local, sin WordPress ni Docker).
// Códigos de salida: 0 todo bien · 1 alguna prueba falló · 2 faltan variables · 3 la web no responde (solo con --unreachable-ok)
const { spawn } = require('child_process');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  let sim = null;
  if (args.includes('--sim')) {
    sim = await require('./sim-server').start();
    Object.assign(process.env, { WP_URL: sim.url, WP_USER: sim.user, WP_APP_PASSWORD: sim.pass, WP_CONTRIB_USER: sim.contrib.user, WP_CONTRIB_APP_PASSWORD: sim.contrib.pass, WP_EDITOR_USER: sim.editor.user, WP_EDITOR_APP_PASSWORD: sim.editor.pass, WP_EXPECT_CPT: '1', WP_EXPECT_LANG: '1', WP_CLI_DOCKER: '1' });
    console.log('Usando el servidor simulado en ' + sim.url);
  }
  const missing = ['WP_URL', 'WP_USER', 'WP_APP_PASSWORD'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Faltan variables de entorno: ' + missing.join(', ') + '\nVer docs/pruebas-wordpress.md (o usa --sim para probar el guion sin WordPress).');
    process.exit(2);
  }
  if (args.includes('--unreachable-ok')) {
    // En CI: si la web ni siquiera responde (red caída, servicio externo), se avisa y no se falla; un fallo de compatibilidad sí falla.
    const ok = await fetch(process.env.WP_URL.replace(/\/+$/, '') + '/wp-json/', { signal: AbortSignal.timeout(20000) }).then((r) => r.status < 500, () => false);
    if (!ok) { console.log('::warning::WordPress no responde en ' + process.env.WP_URL + ': se omiten las pruebas'); process.exit(3); }
  }
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', path.join(__dirname, 'wp.test.js')], { stdio: 'inherit', env: process.env });
  child.on('exit', async (code) => { if (sim) await sim.close(); process.exit(code ?? 1); });
}
main().catch((e) => { console.error(e); process.exit(1); });
