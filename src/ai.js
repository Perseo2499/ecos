// IA intercambiable: Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), Mistral u Ollama (local).
// Configuración en cfg.ai = { active, providers: { anthropic: {key, model}, openai: {...}, gemini: {...},
// mistral: {...}, ollama: {url, model} } }. Todas las funciones devuelven datos validados con zod.
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');

// compat: API compatible con OpenAI (chat/completions); base: URL por defecto (se puede cambiar en «URL personalizada»)
const PROVIDERS = {
  openai: { name: 'OpenAI', label: 'ChatGPT', compat: true, base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', needsKey: true, schema: true },
  gemini: { name: 'Google', label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', needsKey: true },
  anthropic: { name: 'Anthropic', label: 'Claude', defaultModel: 'claude-opus-5-5', keyUrl: 'https://console.anthropic.com/settings/keys', needsKey: true },
  deepseek: { name: 'DeepSeek', label: 'DeepSeek', compat: true, base: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys', needsKey: true, noVision: true },
  mistral: { name: 'Mistral AI', label: 'Mistral', compat: true, base: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', keyUrl: 'https://console.mistral.ai/api-keys', needsKey: true, imageUrlString: true },
  alibaba: { name: 'Alibaba', label: 'Qwen', compat: true, base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://modelstudio.console.alibabacloud.com/', needsKey: true },
  ollama: { name: 'Ollama', label: 'local y gratis', base: 'http://localhost:11434', keyUrl: 'https://ollama.com/download', needsKey: false },
  openrouter: { name: 'OpenRouter', label: 'cientos de modelos', compat: true, base: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', needsKey: true },
  // CLI local (modo desarrollador): Claude Code, Codex o Gemini CLI responden como si fueran una API
  cli: { name: 'CLI local', label: 'Claude Code · Codex · Gemini CLI', needsKey: false, cli: true, keyUrl: '' },
};

// Modelos de Claude que admiten el respaldo automático ante rechazos y el parámetro effort
const CLAUDE_FALLBACK = /^claude-(opus-5-5|opus-5|fable-5-[12]|sonnet-5-5)$/;
const CLAUDE_EFFORT = /^claude-(opus|sonnet|fable|mythos|haiku-5)/;

function current(aiCfg) {
  const id = aiCfg?.active || 'anthropic';
  const p = aiCfg?.providers?.[id] || {};
  const def = PROVIDERS[id];
  if (!def) throw new Error('Proveedor de IA desconocido');
  if (def.needsKey && !p.key) throw new Error(`La IA elegida es ${def.name} y le falta la clave. Pon su clave en Conexiones → IA, o elige allí «CLI local» → «Claude Code» para usar tu sesión de Claude Code (necesita el modo desarrollador).`);
  const model = (p.model || def.defaultModel || '').trim();
  if (def.cli) {
    if (!p.tool) throw new Error('Elige qué CLI usar (Conexiones → IA → CLI local)');
    return { id, def, tool: p.tool, model }; // el modelo es opcional: cada CLI tiene el suyo por defecto
  }
  if (!model) throw new Error(`Elige un modelo de ${def.name} (Conexiones → IA → Ver modelos disponibles)`);
  return { id, def, key: p.key, base: (p.url || def.base || '').trim().replace(/\/$/, ''), model };
}

// JSON Schema limpio para APIs que no aceptan todas las palabras clave
function jsonSchema(schema) {
  const s = z.toJSONSchema(schema);
  delete s.$schema;
  const strip = (o) => {
    if (Array.isArray(o)) return o.forEach(strip);
    if (o && typeof o === 'object') { delete o.minimum; delete o.maximum; Object.values(o).forEach(strip); }
  };
  strip(s);
  return s;
}

async function toBase64(part) {
  if (part.base64) return { data: part.base64, mediaType: part.mediaType || 'image/png' };
  const res = await fetch(part.url);
  if (!res.ok) throw new Error(`No se pudo descargar una imagen (${res.status})`);
  return { data: Buffer.from(await res.arrayBuffer()).toString('base64'), mediaType: res.headers.get('content-type') || 'image/jpeg' };
}

const parseJson = (text) => {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch { throw new Error('La IA no devolvió un resultado válido'); }
};

async function httpJson(url, opts, provider) {
  let res;
  try { res = await fetch(url, opts); } catch (e) {
    throw new Error(provider === 'ollama' ? 'No se puede conectar con Ollama. ¿Está abierto en este ordenador?' : `No se puede conectar con ${PROVIDERS[provider].name}: ${e.message}`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message || json.message || json.error || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new Error(`${PROVIDERS[provider].name}: la clave no es válida o no tiene permiso (${msg})`);
    if (res.status === 429) throw new Error(`${PROVIDERS[provider].name}: límite de uso alcanzado; espera o revisa tu saldo (${msg})`);
    throw new Error(`${PROVIDERS[provider].name}: ${msg}`);
  }
  return json;
}

let cliLog = () => {};
const setCliLog = (fn) => { cliLog = fn; };

// parts: [{type:'text', text}, {type:'image', url} | {type:'image', base64, mediaType}]
async function askStructured(aiCfg, parts, schema, { effort = 'low', maxTokens = 16000 } = {}) {
  const c = current(aiCfg);
  const instructions = 'Responde únicamente con un objeto JSON que cumpla este esquema:\n' + JSON.stringify(jsonSchema(schema));
  let raw;

  if (c.def.cli) {
    const data = await require('./clirun').ask({ tool: c.tool, model: c.model }, parts, jsonSchema(schema), cliLog);
    const ok = schema.safeParse(data);
    if (!ok.success) throw new Error('La CLI devolvió datos incompletos; prueba otra vez o con otro modelo');
    return ok.data;
  }

  if (c.id === 'anthropic') {
    const client = new Anthropic({ apiKey: c.key, ...(c.base ? { baseURL: c.base } : {}) });
    const content = parts.map((p) => (p.type === 'text' ? { type: 'text', text: p.text }
      : { type: 'image', source: p.url ? { type: 'url', url: p.url } : { type: 'base64', media_type: p.mediaType || 'image/png', data: p.base64 } }));
    const fallback = CLAUDE_FALLBACK.test(c.model);
    let response;
    try {
      response = await client.beta.messages.parse({
        model: c.model, max_tokens: maxTokens,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        output_config: { ...(CLAUDE_EFFORT.test(c.model) ? { effort } : {}), format: betaZodOutputFormat(schema) },
        messages: [{ role: 'user', content }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error('La clave de Anthropic no es válida');
      if (err instanceof Anthropic.RateLimitError) throw new Error('Claude: límite de uso alcanzado; espera un momento');
      if (err instanceof Anthropic.NotFoundError) throw new Error(`Claude: el modelo «${c.model}» no existe o no está disponible`);
      if (err instanceof Anthropic.APIError) throw new Error(`Claude: ${err.message}`);
      throw err;
    }
    if (response.stop_reason === 'refusal') throw new Error('La IA no ha podido procesar esta petición');
    if (response.stop_reason === 'max_tokens') throw new Error('La respuesta de la IA ha quedado incompleta; prueba con menos texto');
    if (!response.parsed_output) throw new Error('La IA no devolvió un resultado válido');
    return response.parsed_output;
  }

  if (c.def.compat) {
    if (c.def.noVision && parts.some((p) => p.type === 'image')) throw new Error(`${c.def.name} no puede ver imágenes. Elige otro proveedor para las capturas y las fotos.`);
    const content = parts.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      const url = p.url || `data:${p.mediaType || 'image/png'};base64,${p.base64}`;
      return { type: 'image_url', image_url: c.def.imageUrlString ? url : { url } };
    });
    const onlyText = content.every((x) => x.type === 'text');
    const userContent = onlyText ? content.map((x) => x.text).join('\n') : content;
    const body = c.def.schema
      ? { model: c.model, messages: [{ role: 'user', content: userContent }], response_format: { type: 'json_schema', json_schema: { name: 'resultado', schema: jsonSchema(schema) } } }
      : { model: c.model, messages: [{ role: 'system', content: instructions }, { role: 'user', content: userContent }], response_format: { type: 'json_object' } };
    const json = await httpJson(`${c.base}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(c.id === 'openrouter' ? { 'X-Title': 'Ecos' } : {}) }, body: JSON.stringify(body),
    }, c.id);
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) throw new Error('La IA no ha podido procesar esta petición');
    if (choice?.finish_reason === 'length') throw new Error('La respuesta de la IA ha quedado incompleta; prueba con menos texto');
    raw = choice?.message?.content;
  }

  if (c.id === 'gemini') {
    const gparts = await Promise.all(parts.map(async (p) => {
      if (p.type === 'text') return { text: p.text };
      const b = await toBase64(p);
      return { inline_data: { mime_type: b.mediaType, data: b.data } };
    }));
    const json = await httpJson(`${c.base}/models/${encodeURIComponent(c.model)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: gparts }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: jsonSchema(schema) } }),
    }, 'gemini');
    const cand = json.candidates?.[0];
    if (!cand) throw new Error('La IA no ha podido procesar esta petición');
    raw = (cand.content?.parts || []).map((p) => p.text || '').join('');
  }

  if (c.id === 'ollama') {
    const images = [];
    let text = '';
    for (const p of parts) {
      if (p.type === 'text') text += p.text + '\n';
      else images.push((await toBase64(p)).data);
    }
    const json = await httpJson(`${c.base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.model, stream: false, format: jsonSchema(schema), messages: [{ role: 'user', content: text, ...(images.length ? { images } : {}) }] }),
    }, 'ollama');
    raw = json.message?.content;
  }

  const result = schema.safeParse(parseJson(raw));
  if (!result.success) throw new Error('La IA devolvió datos incompletos; prueba otra vez o con otro modelo');
  return result.data;
}

// Lista de modelos disponibles para una clave (para el menú de selección)
async function listModels(id, p = {}) {
  const def = PROVIDERS[id];
  if (!def) throw new Error('Proveedor desconocido');
  if (def.cli) return require('./clirun').MODELS[p.tool] || [];
  if (def.needsKey && !p.key) throw new Error('Escribe primero la clave');
  const base = (p.url || def.base || '').trim().replace(/\/$/, '');
  if (id === 'anthropic') {
    const client = new Anthropic({ apiKey: p.key, ...(base ? { baseURL: base } : {}) });
    const out = [];
    for await (const m of client.models.list()) out.push(m.id);
    return out;
  }
  if (id === 'gemini') {
    const json = await httpJson(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': p.key } }, id);
    return json.models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')).reverse();
  }
  if (id === 'ollama') {
    const json = await httpJson(`${base}/api/tags`, {}, id);
    return json.models.map((m) => m.name);
  }
  const json = await httpJson(`${base}/models`, { headers: { Authorization: `Bearer ${p.key}` } }, id);
  const ids = (json.data || []).map((m) => m.id);
  if (id === 'openai') return ids.filter((m) => /^(gpt|o\d|chatgpt)/.test(m) && !/audio|realtime|tts|transcribe|search|image/.test(m)).sort().reverse();
  return ids.sort();
}

// Prueba rápida de conexión con el proveedor y modelo elegidos
async function testConnection(aiCfg) {
  const r = await askStructured(aiCfg, [{ type: 'text', text: 'Prueba de conexión. Responde con ok = true y saludo = «Listo para usar».' }],
    z.object({ ok: z.boolean(), saludo: z.string() }));
  if (!r.ok) throw new Error('La IA respondió, pero no como se esperaba');
  return current(aiCfg);
}

// --- Publicación → artículo de blog ------------------------------------------------
const Article = z.object({
  title: z.string().describe('Titular claro y atractivo, sin emojis, máximo 90 caracteres'),
  excerpt: z.string().describe('Resumen de 1-2 frases para el extracto del blog y buscadores'),
  paragraphs: z.array(z.string()).describe('Cuerpo del artículo: párrafos en texto plano, sin hashtags'),
  tags: z.array(z.string()).describe('Entre 3 y 8 etiquetas en minúsculas, sin #'),
});

function improveArticle(aiCfg, { title, text, extra = '' }) {
  const prompt = `Eres editor del blog de una asociación. Convierte esta publicación de redes sociales en una entrada de blog.

Reglas:
- Mantén los hechos, nombres, fechas, lugares y el tono reivindicativo o cercano del original. No inventes datos, citas ni cifras.
- Quita hashtags, emojis decorativos y fórmulas propias de redes («link en bio», «MÁXIMA DIFUSIÓN»…).
- Si el original es corto, desarrolla un poco el contexto con lo que ya dice, sin añadir información nueva. Si es largo, ordénalo en párrafos claros.
- Escribe en el mismo idioma que el original.
${extra ? `- Indicaciones de la asociación: ${extra}\n` : ''}
Título actual: ${title}

Publicación original:
"""
${text}
"""`;
  return askStructured(aiCfg, [{ type: 'text', text: prompt }], Article, { effort: 'medium' });
}

// --- Texto alternativo de imágenes -------------------------------------------------
const AltTexts = z.object({
  alts: z.array(z.object({
    index: z.number().int().describe('Índice de la imagen, desde 0'),
    alt: z.string().describe('Descripción breve y objetiva (máx. 125 caracteres); si hay texto visible importante, inclúyelo'),
  })),
});

async function altTexts(aiCfg, imageUrls, context = '') {
  const parts = [];
  imageUrls.forEach((url, i) => { parts.push({ type: 'text', text: `Imagen ${i}:` }); parts.push({ type: 'image', url }); });
  parts.push({ type: 'text', text: `Escribe el texto alternativo (atributo alt) de cada imagen para personas que usan lector de pantalla, en español. Contexto de la entrada: ${context.slice(0, 500)}` });
  const r = await askStructured(aiCfg, parts, AltTexts);
  return imageUrls.map((_, i) => r.alts.find((a) => a.index === i)?.alt || '');
}

// --- Reescribir un bloque del editor ----------------------------------------------
const Rewrite = z.object({ html: z.string().describe('El texto resultante en HTML en línea: solo <strong>, <em>, <a href> y <br>; sin <p> ni otras etiquetas') });
const REWRITE = {
  improve: 'Mejora la redacción: más clara, fluida y atractiva, sin cambiar el significado.',
  fix: 'Corrige solo la ortografía, la gramática y la puntuación. No cambies el estilo ni las palabras correctas.',
  shorter: 'Hazlo más breve (aprox. la mitad) conservando lo esencial.',
  longer: 'Desarróllalo un poco más (aprox. el doble) con explicaciones y transiciones, sin inventar hechos, cifras, nombres ni citas.',
  friendly: 'Reescríbelo con un tono más cercano y cálido.',
  formal: 'Reescríbelo con un tono más formal e institucional.',
  headline: 'Propón un título (encabezado) breve y atractivo para este fragmento, de menos de 70 caracteres, sin emojis.',
};
function rewrite(aiCfg, { html, action, title = '', kind = 'paragraph', extra = '' }) {
  const how = REWRITE[action] || REWRITE.improve;
  const prompt = `Eres editor del blog de una asociación. ${how}

Reglas:
- Escribe en el mismo idioma que el texto.
- Mantén los enlaces (<a href>) y las negritas/cursivas importantes.
- ${kind === 'list' ? 'Es una lista: separa cada elemento con <br> y no añadas viñetas ni números.' : 'Separa los párrafos con <br><br> si hay varios.'}
${extra ? `- Indicaciones de la asociación: ${extra}
` : ''}
Título de la entrada: ${title}

Texto:
<<<
${html}
>>>`;
  return askStructured(aiCfg, [{ type: 'text', text: prompt }], Rewrite).then((r) => r.html);
}

module.exports = { rewrite, setCliLog, PROVIDERS, askStructured, listModels, testConnection, improveArticle, altTexts };
