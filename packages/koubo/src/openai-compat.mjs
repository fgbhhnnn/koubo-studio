/**
 * OpenAI-compatible chat + image client.
 * Base URLs often already include /v1 — never join as /v1/v1.
 * Never log API keys, and strip long base64 from error text.
 */

export const DEFAULT_LLM_MODEL = 'gpt6.2sol';
export const DEFAULT_IMAGE_MODEL = 'GPT Image 2.6 Sunburst';
export const DEFAULT_CHAT_PATH = '/chat/completions';
export const DEFAULT_IMAGE_PATH = '/images/generations';
/** Some reverse proxies (Cloudflare) reject requests without a browser-like UA (HTTP 403 / 1010). */
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MODEL_ALIASES = Object.freeze({
  'gpt6.2sol': 'gpt-6.2-sol',
  'gpt6.2-sol': 'gpt-6.2-sol',
  'gpt-6.2sol': 'gpt-6.2-sol',
  'gpt 6.2 sol': 'gpt-6.2-sol',
  'gpt-6.2 sol': 'gpt-6.2-sol',
  'gpt-6.2-sol': 'gpt-6.2-sol',
  'gpt image 2.6 sunburst': 'gpt-image-2.6-sunburst',
  'gpt-image-2.6-sunburst': 'gpt-image-2.6-sunburst',
});

export function resolveModel(name) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  if (MODEL_ALIASES[key]) return MODEL_ALIASES[key];
  const dashed = key.replace(/[\s_]+/g, '-');
  if (MODEL_ALIASES[dashed]) return MODEL_ALIASES[dashed];
  const compact = key.replace(/[\s._-]+/g, '');
  for (const [alias, id] of Object.entries(MODEL_ALIASES)) {
    if (alias.replace(/[\s._-]+/g, '') === compact) return id;
  }
  return raw;
}

/**
 * Join an API base and path without doubling /v1.
 * @param {string} base
 * @param {string} path
 */
export function joinApi(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  let p = String(path || '').trim() || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (/\/v1$/i.test(b) && /^\/v1(\/|$)/i.test(p)) p = p.replace(/^\/v1/i, '') || '/';
  return b + p;
}

export function sanitizeErrorBody(text, limit = 240) {
  const cleaned = String(text || '')
    .replace(/sk_[a-zA-Z0-9]+/g, '[redacted]')
    .replace(/sk-[a-zA-Z0-9]+/g, '[redacted]')
    .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [redacted]')
    .replace(/xi-api-key["'\s:=]+[^\s"',}]+/gi, 'xi-api-key=[redacted]')
    .replace(/["']?api[_-]?key["']?\s*[:=]\s*["']?[^\s"',}]+/gi, 'api_key=[redacted]')
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[b64 omitted]');
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function llmConfig(env = process.env) {
  const apiKey = env.KOUBO_LLM_API_KEY || env.OPENAI_API_KEY || '';
  const baseUrl = env.KOUBO_LLM_BASE_URL || env.OPENAI_BASE_URL || '';
  const model = resolveModel(env.KOUBO_LLM_MODEL || DEFAULT_LLM_MODEL);
  return { apiKey, baseUrl, model };
}

export function imageConfig(env = process.env) {
  const apiKey = env.KOUBO_IMAGE_API_KEY || env.KOUBO_LLM_API_KEY || env.OPENAI_API_KEY || '';
  const baseUrl = env.KOUBO_IMAGE_BASE_URL || env.KOUBO_LLM_BASE_URL || env.OPENAI_BASE_URL || '';
  const model = resolveModel(env.KOUBO_IMAGE_MODEL || DEFAULT_IMAGE_MODEL);
  const path = env.KOUBO_IMAGE_PATH || DEFAULT_IMAGE_PATH;
  return { apiKey, baseUrl, model, path };
}

export function hasLlmKey(env = process.env) {
  return Boolean(llmConfig(env).apiKey);
}

export function hasImageKey(env = process.env) {
  return Boolean(imageConfig(env).apiKey);
}

async function postJson(url, { apiKey, body, fetchImpl, timeoutMs = 60000, headers = {} }) {
  if (!apiKey) {
    const err = new Error('未设置 API 密钥。');
    err.code = 'NO_API_KEY';
    throw err;
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': DEFAULT_USER_AGENT,
        ...headers,
      },
      body: JSON.stringify(body),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } catch (err) {
    const e = new Error(`请求失败：${sanitizeErrorBody(err.message || err)}`);
    e.code = 'NETWORK';
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const raw = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}${raw ? `（${sanitizeErrorBody(raw)}）` : ''}`);
    err.status = res.status;
    err.code = 'HTTP';
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error(`HTTP ${res.status} 返回了无法解析的 JSON`);
    err.status = res.status;
    err.code = 'BAD_JSON';
    throw err;
  }
}

/**
 * POST {base}/chat/completions
 * @returns {Promise<{ content: string, model: string, raw: object }>}
 */
export async function chatCompletions({ messages, model, env = process.env, fetchImpl, temperature = 0, maxTokens, timeoutMs = 90000 } = {}) {
  const cfg = llmConfig(env);
  if (!cfg.baseUrl) {
    const err = new Error('未设置 KOUBO_LLM_BASE_URL（或 OPENAI_BASE_URL）。');
    err.code = 'NO_BASE_URL';
    throw err;
  }
  const url = joinApi(cfg.baseUrl, DEFAULT_CHAT_PATH);
  const payload = {
    model: resolveModel(model || cfg.model),
    messages,
    temperature,
  };
  if (maxTokens) payload.max_tokens = maxTokens;
  const raw = await postJson(url, { apiKey: cfg.apiKey, body: payload, fetchImpl, timeoutMs });
  const content = extractChatContent(raw);
  return { content, model: raw?.model || payload.model, raw };
}

function extractChatContent(raw) {
  const choice = Array.isArray(raw?.choices) ? raw.choices[0] : null;
  const msg = choice?.message;
  if (typeof msg?.content === 'string') return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  if (typeof choice?.text === 'string') return choice.text;
  return '';
}

/**
 * POST {base}/images/generations
 * @returns {Promise<{ bytes: Buffer, mime: string, model: string }>}
 */
export async function generateImageBytes({ prompt, model, size = '1536x1024', n = 1, env = process.env, fetchImpl, timeoutMs = 180000, path } = {}) {
  const cfg = imageConfig(env);
  if (!cfg.baseUrl) {
    const err = new Error('未设置 KOUBO_IMAGE_BASE_URL（或 KOUBO_LLM_BASE_URL）。');
    err.code = 'NO_BASE_URL';
    throw err;
  }
  const url = joinApi(cfg.baseUrl, path || cfg.path || DEFAULT_IMAGE_PATH);
  const payload = {
    model: resolveModel(model || cfg.model),
    prompt,
    n,
    size,
  };
  const raw = await postJson(url, { apiKey: cfg.apiKey, body: payload, fetchImpl, timeoutMs });
  const item = Array.isArray(raw?.data) ? raw.data[0] : null;
  if (!item) {
    const err = new Error('生图接口没有返回 data。');
    err.code = 'NO_IMAGE';
    throw err;
  }
  const decoded = await decodeImagePayload(item, fetchImpl);
  return { ...decoded, model: item.model || raw.model || payload.model, rawSize: raw.size || item.size };
}

async function decodeImagePayload(item, fetchImpl) {
  if (typeof item.b64_json === 'string' && item.b64_json) {
    return { bytes: Buffer.from(item.b64_json, 'base64'), mime: 'image/png' };
  }
  const url = item.url;
  if (typeof url === 'string' && url.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
    if (!m) throw new Error('无法解析 data URL 图片。');
    return { bytes: Buffer.from(m[2], 'base64'), mime: m[1] || 'image/png' };
  }
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    const fetchFn = fetchImpl || globalThis.fetch;
    const res = await fetchFn(url, { headers: { 'User-Agent': DEFAULT_USER_AGENT } });
    if (!res.ok) {
      const err = new Error(`下载生成图失败：HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers?.get?.('content-type') || 'image/png';
    return { bytes: buf, mime };
  }
  throw new Error('生图结果既没有 url 也没有 b64_json。');
}

export function extensionForMime(mime) {
  if (/jpeg|jpg/i.test(mime || '')) return '.jpg';
  if (/webp/i.test(mime || '')) return '.webp';
  return '.png';
}

export { extractChatContent };
