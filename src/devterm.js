// Modo desarrollador: terminal integrada (para usar Claude Code u otras herramientas de línea de
// comandos sobre el código de Ecos). Usa una pseudoterminal real (@lydell/node-pty), necesaria para
// programas interactivos como Claude Code.
const { execFile } = require('child_process');
const os = require('os');

let pty = null;
const sessions = new Map();
let nextId = 1;

function defaultShell() {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

// send(evento, datos) envía a la ventana: 'pty:data' { id, data } y 'pty:exit' { id, code }
function spawn({ cwd, cols = 100, rows = 30 }, send) {
  pty = pty || require('@lydell/node-pty');
  const sh = defaultShell();
  const p = pty.spawn(sh.file, sh.args, {
    name: 'xterm-256color', cols, rows, cwd: cwd || os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', ECOS_DEV: '1' },
    ...(process.platform === 'win32' ? { useConpty: true } : {}),
  });
  const id = nextId++;
  sessions.set(id, p);
  p.onData((data) => send('pty:data', { id, data }));
  p.onExit(({ exitCode }) => { sessions.delete(id); send('pty:exit', { id, code: exitCode }); });
  return { id, shell: sh.file };
}
const write = (id, data) => sessions.get(id)?.write(data);
const resize = (id, cols, rows) => { try { sessions.get(id)?.resize(Math.max(2, cols), Math.max(2, rows)); } catch { /* ya cerrada */ } };
const kill = (id) => { try { sessions.get(id)?.kill(); } catch { /* ya cerrada */ } sessions.delete(id); };
const killAll = () => { for (const id of [...sessions.keys()]) kill(id); };

// Versión de una herramienta instalada (o null). En Windows se pasa por la shell para encontrar .cmd/.exe.
function version(cmd) {
  return new Promise((resolve) => {
    execFile(cmd, ['--version'], { shell: process.platform === 'win32', timeout: 15000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      resolve(String(out).trim().split('\n')[0].slice(0, 80));
    });
  });
}
async function tools() {
  const [git, node, claude] = await Promise.all([version('git'), version('node'), version('claude')]);
  return { git, node, claude, platform: process.platform };
}

module.exports = { spawn, write, resize, kill, killAll, tools };
