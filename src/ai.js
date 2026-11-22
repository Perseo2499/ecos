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
async function askStructured(aiCfg, parts, schema, { effort = 'low', maxTokens = 16000, web = false } = {}) {
  const c = current(aiCfg);
  const instructions = 'Responde únicamente con un objeto JSON que cumpla este esquema:\n' + JSON.stringify(jsonSchema(schema));
  let raw;

  if (c.def.cli) {
    const data = await require('./clirun').ask({ tool: c.tool, model: c.model, web }, parts, jsonSchema(schema), cliLog);
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
// opts (preconfigurables en el editor): length 'shorter'|'same'|'longer' · tone 'same'|'friendly'|'formal'|'activist'
// · headings (subtítulos) · spelling (corregir) · notes (indicaciones de la persona) · research (lo hallado en internet)
const Article = z.object({
  title: z.string().describe('Titular claro y atractivo, sin emojis, máximo 90 caracteres'),
  excerpt: z.string().describe('Resumen de 1-2 frases para el extracto del blog y buscadores'),
  blocks: z.array(z.object({
    kind: z.enum(['h2', 'p']).describe('h2 = subtítulo de sección; p = párrafo'),
    text: z.string().describe('Texto plano, sin HTML ni Markdown ni hashtags'),
  })).describe('Cuerpo del artículo en orden: párrafos y, si se piden, subtítulos'),
  tags: z.array(z.string()).describe('Entre 3 y 8 etiquetas en minúsculas, sin #'),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).describe('Fuentes de internet usadas (vacío si no se buscó nada)'),
});

const LENGTH = {
  shorter: 'Hazlo más breve que el original: quédate con lo esencial (aprox. la mitad).',
  same: 'Mantén una extensión parecida a la del original; si es muy corto, desarrolla un poco el contexto con lo que ya dice.',
  longer: 'Desarróllalo más: explica el contexto, las causas y las consecuencias y añade transiciones, sin inventar hechos.',
};
const TONE = {
  same: 'Mantén el tono del original (reivindicativo o cercano).',
  friendly: 'Usa un tono cercano y cálido, en un lenguaje sencillo.',
  formal: 'Usa un tono formal e institucional, propio de un comunicado o una memoria.',
  activist: 'Usa un tono reivindicativo y movilizador, firme y respetuoso.',
};

function improveArticle(aiCfg, { title, text, extra = '', opts = {} }) {
  const o = { length: 'same', tone: 'same', headings: true, spelling: true, ...opts };
  const rules = [
    'Mantén los hechos, nombres, fechas y lugares del original. No inventes datos, citas ni cifras.',
    'Quita hashtags, emojis decorativos y fórmulas propias de redes («link en bio», «MÁXIMA DIFUSIÓN»…).',
    LENGTH[o.length] || LENGTH.same,
    TONE[o.tone] || TONE.same,
    o.headings ? 'Organiza el cuerpo en secciones con subtítulos (kind = "h2") cuando el texto tenga más de tres párrafos; no pongas subtítulo antes del primer párrafo.' : 'No uses subtítulos: solo párrafos (kind = "p").',
    o.spelling ? 'Corrige la ortografía, la gramática y la puntuación.' : '',
    'Escribe en el mismo idioma que el original.',
    o.searchNow ? 'Antes de escribir, haz como mucho 3 búsquedas web rápidas sobre el tema (contexto, datos oficiales, informes de ONG o prensa reconocida). No abras páginas: usa los resultados. Incorpora solo datos relevantes y verificables, atribúyelos en el texto («según…») y pon cada fuente usada en «sources» (título y URL). Si no encuentras nada fiable, escribe sin ellos.' : '',
    o.research ? 'Usa la información de internet de abajo para ampliar y contextualizar el artículo: incorpora solo los datos relevantes y verificables, atribúyelos en el texto («según…») y no copies frases literales. Si algo no encaja con el original, no lo uses.' : '',
    extra ? `Indicaciones generales de la asociación: ${extra}` : '',
    o.notes ? `Indicaciones para esta entrada: ${o.notes}` : '',
  ].filter(Boolean).map((r) => '- ' + r).join('\n');
  const prompt = `Eres editor del blog de una asociación. Convierte esta publicación de redes sociales en una entrada de blog de calidad.

Reglas:
${rules}

Título actual: ${title}

Publicación original:
<<<
${text}
>>>${o.research ? `

Información de internet (con sus fuentes):
<<<
${o.research}
>>>` : ''}`;
  // más rápido: esfuerzo bajo salvo cuando se pide desarrollar más el texto
  return askStructured(aiCfg, [{ type: 'text', text: prompt }], Article, { effort: o.length === 'longer' ? 'medium' : 'low', web: !!o.searchNow });
}

// --- Buscar en internet para ampliar un artículo ------------------------------------
// Devuelve { notes, sources: [{ title, url }] }. Cada proveedor usa su propia búsqueda web.
const RESEARCH_PROMPT = (title, text) => `Busca en internet información fiable y actual que sirva para ampliar y contextualizar esta publicación de una asociación (contexto, datos oficiales, antecedentes, informes de ONG o prensa reconocida).
Haz como mucho 3 búsquedas y no abras páginas: usa los resultados. Devuelve entre 4 y 6 puntos breves con hechos verificables, cada uno con su fuente. No inventes nada; si no encuentras información fiable, dilo.
Al final, añade una línea «FUENTES:» y debajo una fuente por línea con el formato «Título — URL».

Título: ${title}
Publicación:
<<<
${String(text).slice(0, 4000)}
>>>`;

const urlsIn = (text) => [...new Set((String(text).match(/https?:\/\/[^\s)\]>"'»]+/g) || []).map((u) => u.replace(/[.,;:]+$/, '')))];
function sourcesFrom(text, extra = []) {
  const out = new Map(extra.filter((s) => s?.url).map((s) => [s.url, { title: s.title || s.url, url: s.url }]));
  for (const line of String(text).split('\n')) {
    const u = urlsIn(line)[0];
    if (u && !out.has(u)) out.set(u, { title: line.replace(u, '').replace(/^[\s\-–—*•\d.]+|[\s\-–—:]+$/g, '').trim() || u, url: u });
  }
  return [...out.values()].slice(0, 12);
}

async function research(aiCfg, { title, text }) {
  const c = current(aiCfg);
  const prompt = RESEARCH_PROMPT(title, text);
  let notes = '', found = [];

  if (c.def.cli) {
    notes = await require('./clirun').search({ tool: c.tool, model: c.model }, prompt, cliLog);
  } else if (c.id === 'anthropic') {
    const client = new Anthropic({ apiKey: c.key, ...(c.base ? { baseURL: c.base } : {}) });
    const fallback = CLAUDE_FALLBACK.test(c.model);
    const run = async (toolType) => {
      const messages = [{ role: 'user', content: prompt }];
      for (let i = 0; i < 4; i++) { // la búsqueda puede pausar el turno (pause_turn): se reanuda tal cual
        const r = await client.beta.messages.create({
          model: c.model, max_tokens: 16000,
          ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
          ...(CLAUDE_EFFORT.test(c.model) ? { output_config: { effort: 'low' } } : {}),
          tools: [{ type: toolType, name: 'web_search', max_uses: 3 }],
          messages,
        });
        if (r.stop_reason === 'refusal') throw new Error('La IA no ha podido hacer esta búsqueda');
        for (const blk of r.content) {
          if (blk.type === 'text') { notes += blk.text; for (const ci of blk.citations || []) if (ci.url) found.push({ title: ci.title, url: ci.url }); }
          if (blk.type === 'web_search_tool_result' && Array.isArray(blk.content)) for (const w of blk.content) if (w.url) found.push({ title: w.title, url: w.url });
        }
        if (r.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: r.content });
      }
    };
    try {
      try { await run('web_search_20260209'); } catch (err) {
        // modelos antiguos: la búsqueda básica
        if (err instanceof Anthropic.BadRequestError && /web_search/.test(err.message)) { notes = ''; found = []; await run('web_search_20250305'); } else throw err;
      }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error('La clave de Anthropic no es válida');
      if (err instanceof Anthropic.RateLimitError) throw new Error('Claude: límite de uso alcanzado; espera un momento');
      if (err instanceof Anthropic.APIError) throw new Error(`Claude (búsqueda en internet): ${err.message}`);
      throw err;
    }
  } else if (c.id === 'openai') {
    const json = await httpJson(`${c.base}/responses`, {
      method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.model, tools: [{ type: 'web_search' }], input: prompt }),
    }, 'openai');
    for (const item of json.output || []) for (const part of item.content || []) {
      if (part.type === 'output_text') { notes += part.text; for (const an of part.annotations || []) if (an.url) found.push({ title: an.title, url: an.url }); }
    }
  } else if (c.id === 'gemini') {
    const json = await httpJson(`${c.base}/models/${encodeURIComponent(c.model)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
    }, 'gemini');
    const cand = json.candidates?.[0];
    notes = (cand?.content?.parts || []).map((p) => p.text || '').join('');
    for (const ch of cand?.groundingMetadata?.groundingChunks || []) if (ch.web?.uri) found.push({ title: ch.web.title, url: ch.web.uri });
  } else if (c.id === 'openrouter') {
    const json = await httpJson(`${c.base}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', 'X-Title': 'Ecos' },
      body: JSON.stringify({ model: c.model.endsWith(':online') ? c.model : c.model + ':online', messages: [{ role: 'user', content: prompt }] }),
    }, 'openrouter');
    const m = json.choices?.[0]?.message;
    notes = m?.content || '';
    for (const an of m?.annotations || []) if (an.url_citation?.url) found.push({ title: an.url_citation.title, url: an.url_citation.url });
  } else {
    throw new Error(`${c.def.name} no puede buscar en internet. Desmarca «Ampliar con información de internet» o usa Claude, ChatGPT, Gemini, OpenRouter o la CLI.`);
  }
  if (!notes.trim()) throw new Error('La búsqueda en internet no ha devuelto resultados');
  return { notes: notes.trim(), sources: sourcesFrom(notes, found) };
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

// --- Título y descripción para buscadores ---------------------------------------------
const SeoSuggest = z.object({
  title: z.string().describe('Título para Google, máximo 60 caracteres, natural y sin comillas'),
  description: z.string().describe('Descripción para Google, entre 120 y 155 caracteres, que invite a leer, sin inventar datos'),
});
async function seoSuggest(aiCfg, { title = '', text = '', keyword = '', extra = '' }) {
  const prompt = `Eres editor web de una asociación. Propón el título SEO y la descripción (meta description) de esta entrada, en el mismo idioma que el texto.
Reglas: título de 60 caracteres como máximo; descripción de 155 como máximo; no inventes hechos, cifras ni nombres; sin emojis${keyword ? `; incluye la palabra clave «${keyword}» de forma natural` : ''}.${extra ? `\nIndicaciones de la asociación: ${extra}` : ''}
Título actual: ${title}

Texto:
<<<
${String(text).slice(0, 6000)}
>>>`;
  const r = await askStructured(aiCfg, [{ type: 'text', text: prompt }], SeoSuggest);
  return { title: r.title.trim(), description: r.description.trim() };
}

// --- Categorías para entradas (revisión del blog) -----------------------------------
const CatSuggest = z.object({
  suggestions: z.array(z.object({
    id: z.number().int().describe('ID de la entrada'),
    categories: z.array(z.string()).describe('Nombres de categorías EXISTENTES (máx. 3), copiados tal cual de la lista'),
  })),
});
// posts: [{ id, title, excerpt, text }]; cats: nombres existentes. Por lotes de ~10; nunca inventa categorías.
async function suggestCategories(aiCfg, posts, cats, { batch = 10, conc = 3 } = {}) {
  const valid = new Map(cats.map((c) => [String(c).toLowerCase(), c]));
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < posts.length; i += batch) chunks.push(posts.slice(i, i + batch));
  let next = 0;
  const work = async () => {
    while (next < chunks.length) {
      const ch = chunks[next++];
      const prompt = `Elige para cada entrada de un blog de una asociación las categorías que mejor le encajan, SOLO entre estas categorías existentes (cópialas exactamente, no inventes ninguna; entre 1 y 3 por entrada, y ninguna si no encaja):\n${cats.map((c) => '- ' + c).join('\n')}\n\nEntradas:\n`
        + ch.map((p) => `[id ${p.id}] ${p.title}\n${(p.excerpt || '').slice(0, 200)}\n${(p.text || '').slice(0, 600)}`).join('\n---\n');
      const r = await askStructured(aiCfg, [{ type: 'text', text: prompt }], CatSuggest);
      for (const s of r.suggestions || []) {
        const names = [...new Set((s.categories || []).map((n) => valid.get(String(n).toLowerCase())).filter(Boolean))].slice(0, 3);
        out.set(s.id, names);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, chunks.length) }, work));
  return posts.map((p) => ({ id: p.id, categories: out.get(p.id) || [] }));
}
// Afina las propuestas del algoritmo: mejores nombres, fusionar o descartar grupos y reasignar entradas
const TopicRefine = z.object({
  groups: z.array(z.object({
    name: z.string().describe('Nombre corto y claro de la categoría, en español'),
    existing: z.boolean().describe('true solo si es exactamente una de las categorías existentes'),
    postIds: z.array(z.number().int()).describe('IDs de las entradas que encajan (mínimo 3)'),
  })),
});
async function refineTopics(aiCfg, proposals, posts, cats) {
  const titles = new Map(posts.map((p) => [p.id, p]));
  const ids = new Set(proposals.flatMap((g) => g.posts.map((p) => p.id)));
  const prompt = `Una asociación de Ceuta tiene un blog. Un algoritmo ha propuesto estas categorías para agrupar sus entradas. Mejora los nombres, fusiona grupos parecidos, descarta los que no tengan sentido y reasigna entradas si hace falta. Máximo 10 grupos, cada uno con 3 entradas o más. Si una categoría ya existe, usa su nombre exacto y marca existing = true. Usa solo IDs de entradas de la lista.\n\nCategorías existentes: ${cats.join(', ') || '(ninguna)'}\n\nPropuestas:\n`
    + proposals.map((g) => `* ${g.name} (${g.isNew ? 'nueva' : 'existente'}; palabras: ${g.keywords.join(', ')}) → ${g.posts.map((p) => p.id).join(', ')}`).join('\n')
    + '\n\nEntradas:\n' + [...ids].map((id) => { const p = titles.get(id); return p ? `[${id}] ${p.title} — ${(p.excerpt || '').slice(0, 120)}` : null; }).filter(Boolean).join('\n');
  const r = await askStructured(aiCfg, [{ type: 'text', text: prompt }], TopicRefine);
  const existing = new Map(cats.map((c) => [String(c).toLowerCase(), c]));
  return (r.groups || []).map((g) => {
    const ex = existing.get(String(g.name).toLowerCase());
    const list = [...new Set(g.postIds)].filter((id) => ids.has(id)).map((id) => ({ id, title: titles.get(id)?.title || '', score: proposals.flatMap((x) => x.posts).find((p) => p.id === id)?.score ?? 0.5 }));
    return { name: ex || g.name.trim(), isNew: !ex, keywords: proposals.find((x) => x.name === g.name)?.keywords || [], posts: list };
  }).filter((g) => g.name && g.posts.length >= 3);
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

const isCli = (aiCfg) => !!PROVIDERS[aiCfg?.active]?.cli;

module.exports = { suggestCategories, refineTopics, isCli, research, rewrite, setCliLog, PROVIDERS, askStructured, listModels, testConnection, improveArticle, altTexts, seoSuggest };
