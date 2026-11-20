// IA a través de una CLI local (modo desarrollador): Claude Code, Codex o Gemini CLI responden a las
// peticiones de los botones de IA como si fueran una API. Se ejecutan en modo no interactivo, sin
// herramientas de escritura, en una carpeta temporal donde se dejan las imágenes de la petición.
// Parámetros comprobados con la ayuda de cada CLI (claude --help, codex exec --help, gemini --help).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOLS = {
  claude: { name: 'Claude Code', bin: 'claude', login: 'claude' },
  codex: { name: 'Codex', bin: 'codex', login: 'codex login' },
  gemini: { name: 'Gemini CLI', bin: 'gemini', login: 'gemini' },
};

// En Windows las CLI suelen ser .cmd/.exe y hay que pasar por la shell: se citan los argumentos
const q = (a) => (/[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function run(bin, args, { cwd, input, timeout = 180000 }) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const child = spawn(win ? bin : bin, win ? args.map(q) : args, { cwd, shell: win, windowsHide: true, env: { ...process.env, NO_COLOR: '1', CI: '1' } });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`La CLI no respondió en ${Math.round(timeout / 1000)} s`)); }, timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error(`No se encuentra «${bin}». ¿Está instalada?`) : e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

// Saca el primer objeto JSON de un texto (por si la CLI lo envuelve en ``` o añade una frase)
function extractJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch { /* buscar dentro */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* nada */ } }
  throw new Error('La CLI no devolvió un JSON válido');
}

const loginHint = (tool, text) => (/log ?in|sign ?in|auth|credential|api[ _]?key|unauthori[sz]ed|401/i.test(text)
  ? ` Inicia sesión abriendo la terminal (Conexiones → CLI) y ejecutando «${TOOLS[tool].login}».` : '');

// parts: [{type:'text', text}, {type:'image', base64, mediaType} | {type:'image', url}]
// schema: JSON Schema de la respuesta. Devuelve el objeto JSON (lo valida luego zod en ai.js).
async function ask({ tool, model, web = false }, parts, schema, log = () => {}) {
  const T = TOOLS[tool];
  if (!T) throw new Error('Elige una CLI (Claude Code, Codex o Gemini CLI)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-cli-'));
  const started = Date.now();
  try {
    // Imágenes a archivos de la carpeta temporal (se citan por su nombre relativo)
    const images = [];
    let text = '';
    for (const p of parts) {
      if (p.type === 'text') { text += p.text + '\n'; continue; }
      let buf, ext = 'png';
      if (p.base64) { buf = Buffer.from(p.base64, 'base64'); ext = (p.mediaType || 'image/png').split('/')[1].replace('jpeg', 'jpg'); }
      else { const r = await fetch(p.url); if (!r.ok) throw new Error(`No se pudo descargar una imagen (${r.status})`); buf = Buffer.from(await r.arrayBuffer()); ext = ((r.headers.get('content-type') || 'image/jpeg').split('/')[1] || 'jpg').split(';')[0].replace('jpeg', 'jpg'); }
      const name = `imagen-${images.length}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buf);
      images.push(name);
      text += `[${name}]\n`;
    }
    const schemaText = JSON.stringify(schema);
    const rules = '\n\nResponde ÚNICAMENTE con un objeto JSON válido (sin texto alrededor ni bloques de código) que cumpla este JSON Schema:\n' + schemaText;
    const imgNote = images.length ? `\n\nLas imágenes de la petición son los archivos ${images.join(', ')} de la carpeta actual; ábrelas para verlas.` : '';
    let res, data;

    if (tool === 'claude') {
      // Solo la herramienta de lectura (para ver las imágenes); sin MCP ni sesiones guardadas
      // la lectura, solo dentro de la carpeta temporal de la petición (un texto malicioso no puede pedirle leer otros archivos)
      const tools = [...(images.length ? ['Read'] : []), ...(web ? ['WebSearch'] : [])].join(',');
      const allow = [...(images.length ? ['Read(./**)'] : []), ...(web ? ['WebSearch'] : [])];
      const args = ['-p', 'Sigue exactamente las instrucciones recibidas por la entrada estándar.', '--output-format', 'json',
        '--tools', tools, ...(allow.length ? ['--allowedTools', ...allow] : []),
        '--strict-mcp-config', '--no-session-persistence', ...(model ? ['--model', model] : [])];
      res = await run(T.bin, args, { cwd: dir, input: text + imgNote + rules, ...(web ? { timeout: 300000 } : {}) });
      let j; try { j = JSON.parse(res.out); } catch { j = null; }
      if (res.code !== 0 || !j || j.is_error) throw new Error(`Claude Code: ${(j?.result || res.err || res.out || 'error').toString().trim().slice(0, 300)}.${loginHint(tool, res.err + res.out)}`);
      data = j.structured_output || extractJson(j.result);
    } else if (tool === 'codex') {
      fs.writeFileSync(path.join(dir, 'schema.json'), schemaText);
      const args = [...(web ? ['--search'] : []), 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never',
        '--output-schema', 'schema.json', '-o', 'respuesta.txt', ...(model ? ['-m', model] : []), ...images.flatMap((n) => ['-i', n]), '-'];
      res = await run(T.bin, args, { cwd: dir, input: text + rules, ...(web ? { timeout: 300000 } : {}) });
      const outFile = path.join(dir, 'respuesta.txt');
      if (res.code !== 0 || !fs.existsSync(outFile)) throw new Error(`Codex: ${(res.err || res.out || 'error').trim().split('\n').slice(-3).join(' ').slice(0, 300)}.${loginHint(tool, res.err + res.out)}`);
      data = extractJson(fs.readFileSync(outFile, 'utf8'));
    } else {
      // Gemini CLI: modo de solo lectura (plan); las imágenes se citan con @archivo
      const atRefs = images.length ? '\n\nImágenes: ' + images.map((n) => '@' + n).join(' ') : '';
      const args = ['-p', 'Sigue exactamente las instrucciones recibidas por la entrada estándar.' + atRefs, '--output-format', 'json',
        '--approval-mode', 'plan', '--skip-trust', ...(model ? ['-m', model] : [])];
      res = await run(T.bin, args, { cwd: dir, input: text + rules, ...(web ? { timeout: 300000 } : {}) });
      // la respuesta va por la salida estándar; los errores (también en JSON) por la de errores
      let j = null;
      for (const txt of [res.out, res.err]) { try { j = extractJson(txt); if (j.response !== undefined || j.error) break; } catch { /* siguiente */ } }
      if (res.code !== 0 || !j || j.error) throw new Error(`Gemini CLI: ${(j?.error?.message || res.err || res.out || 'error').toString().trim().split('\n').slice(-3).join(' ').slice(0, 300)}.${loginHint(tool, (j?.error?.message || '') + res.err + res.out)}`);
      data = extractJson(j.response);
    }
    log(`CLI ${T.name}: respuesta en ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return data;
  } catch (e) {
    log(`CLI ${T.name}: error tras ${((Date.now() - started) / 1000).toFixed(1)} s —`, e.message);
    throw e;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Modelos sugeridos (cada CLI usa el suyo por defecto si se deja vacío)
const MODELS = {
  claude: ['sonnet', 'opus', 'haiku', 'fable'],
  codex: [],
  gemini: ['auto', 'pro', 'flash', 'flash-lite'],
};

// Investigar en internet con la CLI: devuelve texto (con sus fuentes). Solo herramientas de búsqueda y lectura web.
async function search({ tool, model }, prompt, log = () => {}) {
  const T = TOOLS[tool];
  if (!T) throw new Error('Elige una CLI (Claude Code, Codex o Gemini CLI)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-cli-'));
  const started = Date.now();
  try {
    let res, text;
    if (tool === 'claude') {
      res = await run(T.bin, ['-p', 'Sigue exactamente las instrucciones recibidas por la entrada estándar.', '--output-format', 'json', '--tools', 'WebSearch',
        '--allowedTools', 'WebSearch', '--strict-mcp-config', '--no-session-persistence', ...(model ? ['--model', model] : [])], { cwd: dir, input: prompt, timeout: 300000 });
      let j; try { j = JSON.parse(res.out); } catch { j = null; }
      if (res.code !== 0 || !j || j.is_error) throw new Error(`Claude Code: ${(j?.result || res.err || res.out || 'error').toString().trim().slice(0, 300)}.${loginHint(tool, res.err + res.out)}`);
      text = j.result;
    } else if (tool === 'codex') {
      res = await run(T.bin, ['--search', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-o', 'respuesta.txt', ...(model ? ['-m', model] : []), '-'], { cwd: dir, input: prompt, timeout: 300000 });
      const outFile = path.join(dir, 'respuesta.txt');
      if (res.code !== 0 || !fs.existsSync(outFile)) throw new Error(`Codex: ${(res.err || res.out || 'error').trim().split('\n').slice(-3).join(' ').slice(0, 300)}.${loginHint(tool, res.err + res.out)}`);
      text = fs.readFileSync(outFile, 'utf8');
    } else {
      res = await run(T.bin, ['-p', 'Sigue exactamente las instrucciones recibidas por la entrada estándar. Usa la búsqueda web de Google.', '--output-format', 'json', '--approval-mode', 'plan', '--skip-trust', ...(model ? ['-m', model] : [])], { cwd: dir, input: prompt, timeout: 300000 });
      let j = null;
      for (const txt of [res.out, res.err]) { try { j = extractJson(txt); if (j.response !== undefined || j.error) break; } catch { /* siguiente */ } }
      if (res.code !== 0 || !j || j.error) throw new Error(`Gemini CLI: ${(j?.error?.message || res.err || res.out || 'error').toString().trim().split('\n').slice(-3).join(' ').slice(0, 300)}.${loginHint(tool, (j?.error?.message || '') + res.err + res.out)}`);
      text = j.response;
    }
    log(`CLI ${T.name}: búsqueda en ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return String(text || '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { ask, search, TOOLS, MODELS, extractJson };
