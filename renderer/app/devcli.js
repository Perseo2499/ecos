// Ecos · Modo desarrollador: CLI y terminal.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- Modo desarrollador: CLI
const isWin = navigator.userAgent.includes('Windows');
const CLAUDE_INSTALL = isWin ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash';
const dev = { tools: null };

function renderDevCard() {
  const on = !!prefs().devMode;
  $('#dev-card').classList.toggle('hidden', !on);
  $('#s-devmode').checked = on;
  if (!on) return;
  $('#dev-dir').value = CFG.devDir || '';
  checkDevDir();
  if (!dev.tools) refreshDevTools();
}
async function checkDevDir() {
  const dir = CFG.devDir;
  const ok = dir ? await window.api.devCheckDir(dir) : false;
  $('#dev-dir-hint').innerHTML = !dir ? t('Elige la carpeta con el código de Ecos o clónalo desde GitHub.')
    : ok ? `<span class="ok-text">✓ ${t('Es el código de Ecos.')}</span>` : `<span class="err-text">${t('Esa carpeta no parece el código de Ecos (falta su package.json).')}</span>`;
}
async function refreshDevTools() {
  $('#dev-tools').innerHTML = `<div class="dev-tool"><span class="spin"></span>${t('Comprobando herramientas…')}</div>`;
  dev.tools = await window.api.devTools().catch(() => ({}));
  const row = (name, v, help) => `<div class="dev-tool"><span class="ms ${v ? 'ok' : 'no'}">${v ? 'check_circle' : 'cancel'}</span><b>${name}</b>${v ? `<span class="v">${escHtml(v)}</span>` : help}</div>`;
  $('#dev-tools').innerHTML =
    row('Git', dev.tools.git, `<a class="v" href="#" data-url="https://git-scm.com/downloads">${t('Descargar')}</a>`) +
    row('Node.js', dev.tools.node, `<a class="v" href="#" data-url="https://nodejs.org">${t('Descargar')}</a>`) +
    row('Claude Code', dev.tools.claude, `<button class="btn tonal" id="dev-install">${t('Instalar')}</button>`);
  $$('#dev-tools [data-url]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); window.api.open(a.dataset.url); }));
  $('#dev-install')?.addEventListener('click', () => openTerminal({ cmd: CLAUDE_INSTALL, title: t('Instalar Claude Code') }));
}
$('#s-devmode').onchange = async () => { await savePrefs({ devMode: $('#s-devmode').checked }); renderDevCard(); renderAi(); if ($('#s-devmode').checked) toast(t('Modo desarrollador activado: tienes la tarjeta «CLI» en Conexiones.')); };
$('#dev-pick').onclick = async () => { const d = await window.api.devPickDir(); if (d) { CFG.devDir = d; renderDevCard(); } };
$('#dev-clone').onclick = async () => {
  if (!dev.tools?.git) return toast(t('Necesitas instalar Git para clonar el proyecto.'), true);
  toast(t('Elige la carpeta donde guardar el proyecto (se creará dentro la carpeta «ecos»).'));
  const parent = await window.api.devPickDir();
  if (!parent) return;
  const dir = parent.replace(/[\\/]$/, '') + (isWin ? '\\' : '/') + 'ecos';
  CFG = await window.api.setConfig({ devDir: dir });
  openTerminal({ cwd: parent, cmd: `git clone https://github.com/Perseo2499/ecos.git && cd ecos && npm install`, title: t('Clonar') });
  renderDevCard();
};
$('#dev-term').onclick = () => openTerminal({});
$('#dev-claude').onclick = () => {
  if (dev.tools && !dev.tools.claude) return toast(t('Claude Code no está instalado. Pulsa «Instalar» en la tarjeta.'), true);
  openTerminal({ cmd: 'claude', title: 'Claude Code' });
};

// --- Terminal con pestañas (xterm.js + pseudoterminal en el proceso principal) ---
const terms = new Map(); // id → { term, fit, pane, tab, alive }
let activeTerm = null;
const termTheme = () => ({ background: '#141615', foreground: '#e3e3e0', cursor: '#ffb454', selectionBackground: '#3d4a44',
  black: '#1c1f1e', red: '#f2777a', green: '#8fd18b', yellow: '#ffcc66', blue: '#7cb3ff', magenta: '#cc99cc', cyan: '#66cccc', white: '#e3e3e0',
  brightBlack: '#5c6360', brightRed: '#ff8c8c', brightGreen: '#a6e3a1', brightYellow: '#ffd98a', brightBlue: '#9ec5ff', brightMagenta: '#e0b0e0', brightCyan: '#8ee0e0', brightWhite: '#ffffff' });

async function openTerminal({ cwd, cmd, title } = {}) {
  $('#term').classList.remove('hidden'); document.body.classList.add('editing');
  const pane = document.createElement('div'); pane.className = 'term-pane';
  $('#term-panes').appendChild(pane);
  const term = new window.Terminal({ fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'DejaVu Sans Mono', monospace", fontSize: 14, cursorBlink: true,
    allowProposedApi: true, scrollback: 5000, theme: termTheme() });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit); term.open(pane); fit.fit();
  let info;
  try { info = await window.api.ptySpawn({ cwd: cwd || CFG.devDir || undefined, cols: term.cols, rows: term.rows }); }
  catch (e) { pane.remove(); toastError(e); return; }
  const tab = document.createElement('div'); tab.className = 'term-tab';
  tab.innerHTML = `<span class="ms">terminal</span><span class="tt"></span><button title="${t('Cerrar')}"><span class="ms">close</span></button>`;
  tab.querySelector('.tt').textContent = title || (info.shell.split(/[\\/]/).pop());
  $('#term-tabs').appendChild(tab);
  const s = { term, fit, pane, tab, alive: true };
  terms.set(info.id, s);
  term.onData((d) => window.api.ptyWrite(info.id, d));
  term.onResize(({ cols, rows }) => window.api.ptyResize(info.id, cols, rows));
  // Copiar con la selección y Ctrl+Shift+C / pegar con Ctrl+Shift+V o clic derecho
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') { navigator.clipboard.writeText(term.getSelection()); return false; }
    if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') { navigator.clipboard.readText().then((x) => window.api.ptyWrite(info.id, x)); return false; }
    return true;
  });
  pane.addEventListener('contextmenu', (e) => { e.preventDefault(); const sel = term.getSelection(); if (sel) { navigator.clipboard.writeText(sel); term.clearSelection(); } else navigator.clipboard.readText().then((x) => window.api.ptyWrite(info.id, x)); });
  tab.onclick = (e) => { if (e.target.closest('button')) closeTermTab(info.id); else focusTerm(info.id); };
  focusTerm(info.id);
  if (cmd) setTimeout(() => window.api.ptyWrite(info.id, cmd + '\r'), 400);
}
function focusTerm(id) {
  activeTerm = id;
  for (const [k, s] of terms) { s.pane.classList.toggle('hidden', k !== id); s.tab.classList.toggle('on', k === id); }
  const s = terms.get(id);
  if (s) requestAnimationFrame(() => { s.fit.fit(); s.term.focus(); });
}
function closeTermTab(id) {
  const s = terms.get(id); if (!s) return;
  if (s.alive) window.api.ptyKill(id);
  s.term.dispose(); s.pane.remove(); s.tab.remove(); terms.delete(id);
  const next = [...terms.keys()].pop();
  if (next) focusTerm(next); else closeTerminalScreen();
}
function closeTerminalScreen() { $('#term').classList.add('hidden'); document.body.classList.remove('editing'); }
window.api.onPtyData(({ id, data }) => terms.get(id)?.term.write(data));
window.api.onPtyExit(({ id, code }) => {
  const s = terms.get(id); if (!s) return;
  s.alive = false; s.tab.classList.add('dead');
  s.term.write(`\r\n\x1b[90m[${t('La terminal ha terminado')} (${code})]\x1b[0m\r\n`);
});
$('#term-close').onclick = closeTerminalScreen; // las terminales siguen abiertas en segundo plano
$('#term-new').onclick = () => openTerminal({});
$('#term-claude').onclick = () => openTerminal({ cmd: 'claude', title: 'Claude Code' });
$('#term-run').onclick = () => { if (activeTerm && terms.get(activeTerm)?.alive) { window.api.ptyWrite(activeTerm, 'npm start\r'); terms.get(activeTerm).term.focus(); } };
window.addEventListener('resize', () => { const s = terms.get(activeTerm); if (s && !$('#term').classList.contains('hidden')) s.fit.fit(); });
