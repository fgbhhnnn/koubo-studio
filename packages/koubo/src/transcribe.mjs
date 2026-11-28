/**
 * ElevenLabs Scribe speech-to-text (official batch API).
 * POST https://api.elevenlabs.io/v1/speech-to-text
 * Header: xi-api-key
 * Form: file, model_id, timestamps_granularity=word
 *
 * Never log, print, or write the API key.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

export const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
export const DEFAULT_SCRIBE_MODEL = 'scribe_v2';
export const FALLBACK_SCRIBE_MODEL = 'scribe_v1';

/**
 * @param {string} filePath
 * @param {{ apiKey?: string, model?: string, languageCode?: string, fetchImpl?: typeof fetch }} [opts]
 */
export async function transcribeFile(filePath, opts = {}) {
  const apiKey = opts.apiKey || process.env.ELEVENLABS_API_KEY || '';
  if (!apiKey) {
    const err = new Error('未设置 ELEVENLABS_API_KEY，无法调用 ElevenLabs 转写。');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const info = await stat(filePath);
  if (!info.isFile() || info.size < 1) {
    throw new Error(`找不到可转写的文件：${basename(filePath)}`);
  }

  const model = opts.model || process.env.KOUBO_SCRIBE_MODEL || DEFAULT_SCRIBE_MODEL;
  const result = await postTranscript(filePath, apiKey, model, opts);
  return normalizeTranscript(result, { model, file: basename(filePath) });
}

async function postTranscript(filePath, apiKey, model, opts) {
  const body = new FormData();
  const buf = await readFile(filePath);
  const name = basename(filePath);
  body.set('file', new Blob([buf]), name);
  body.set('model_id', model);
  body.set('timestamps_granularity', 'word');
  if (opts.languageCode) body.set('language_code', opts.languageCode);
  if (opts.diarize) body.set('diarize', 'true');

  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await fetchImpl(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body,
    });
  } catch (err) {
    const wrapped = new Error(`${explainNetworkError(err, 'ElevenLabs 转写请求失败')}。请检查网络连接后重试。`);
    wrapped.cause = err;
    wrapped.code = 'ELEVENLABS_NETWORK';
    throw wrapped;
  }

  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      detail = sanitizeErrorBody(text);
    } catch {
      detail = '';
    }
    const err = new Error(`ElevenLabs 转写失败：HTTP ${res.status}${detail ? `（${detail}）` : ''}`);
    err.status = res.status;
    err.code = 'ELEVENLABS_HTTP';
    throw err;
  }

  return res.json();
}

/**
 * Extra detail from a failed fetch (a system code, a cause), never the empty
 * "fetch failed" on its own. Empty when there is nothing more to say.
 * @param {unknown} err
 */
export function networkErrorDetail(err) {
  const cause = err && typeof err === 'object' ? /** @type {any} */ (err).cause : null;
  const code = String(cause?.code || (err && typeof err === 'object' ? /** @type {any} */ (err).code : '') || '');
  const message = String((err && typeof err === 'object' && /** @type {any} */ (err).message) || err || '').trim();
  const causeMessage = String(cause?.message || '').trim();
  const parts = [code, causeMessage, message].filter((s, i, a) => s && a.indexOf(s) === i && !/^fetch failed$/i.test(s));
  return parts.join(': ');
}

/**
 * A failed fetch as a reason a person can act on, never the empty "fetch failed"
 * on its own. `what` names the request (already in the product language).
 * @param {unknown} err
 * @param {string} [what]
 */
export function explainNetworkError(err, what = 'The network request failed') {
  const detail = networkErrorDetail(err);
  const message = String((err && typeof err === 'object' && /** @type {any} */ (err).message) || err || '').trim();
  const failed = /fetch failed|Failed to fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR|CERT|unable to verify/i.test(`${networkErrorDetail(err)} ${message}`)
    || !message || /^fetch failed$/i.test(message);
  if (failed) return `${what}${detail ? ` (${detail})` : ''}`;
  return message;
}

/** Strip anything that looks like a key or token from an error payload. */
export function sanitizeErrorBody(text, limit = 240) {
  const cleaned = String(text || '')
    .replace(/sk_[a-zA-Z0-9]+/g, '[redacted]')
    .replace(/xi-api-key["'\s:=]+[^\s"',}]+/gi, 'xi-api-key=[redacted]')
    .replace(/["']?api[_-]?key["']?\s*[:=]\s*["']?[^\s"',}]+/gi, 'api_key=[redacted]');
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function normalizeTranscript(payload, meta = {}) {
  const words = Array.isArray(payload?.words) ? payload.words : [];
  return {
    text: payload?.text || words.map((w) => w.text).join(''),
    language_code: payload?.language_code || null,
    language_probability: payload?.language_probability ?? null,
    audio_duration_secs: payload?.audio_duration_secs ?? null,
    words,
    model: meta.model || null,
    sourceFile: meta.file || null,
  };
}

export async function loadTranscript(filePath) {
  const raw = JSON.parse(await readFile(filePath, 'utf8'));
  if (raw && Array.isArray(raw.words)) return raw;
  if (Array.isArray(raw)) return { words: raw, text: raw.map((w) => w.text).join('') };
  throw new Error(`无法识别的转写 JSON：${basename(filePath)}`);
}

export function redactEnv(env = process.env) {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (/key|token|secret|password/i.test(key)) out[key] = '[redacted]';
  }
  return out;
}
