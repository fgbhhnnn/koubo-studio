/**
 * LLM refinement after the rule-engine plan.
 *
 * Needs KOUBO_LLM_API_KEY (or OPENAI_API_KEY) and KOUBO_LLM_BASE_URL.
 * Model: KOUBO_LLM_MODEL (default gpt6.2sol, resolved to the gateway id).
 * Without a key, the rule plan is returned unchanged.
 * Never log the key.
 */
import { hasLlmKey, llmConfig, chatCompletions, sanitizeErrorBody } from './openai-compat.mjs';
import { normalizeWords, recomputePlanFromDeletes } from './plan.mjs';

export { hasLlmKey };

const SYSTEM = `你是口播剪辑顾问。你会看到规则引擎已经给出的保留/删除方案。请判断整理后的口播在逻辑上是否顺畅，是否还需要合并或微调，但不要重排镜头顺序。

硬性规则：
- 时间码都是源视频秒数。
- 词与词之间 0.3～0.5 秒的自然停顿必须保留，不要当成卡顿去剪。
- 可以建议再剪掉明显的「嗯啊」口头禅、重复句、说错重来、过长死寂。
- 如果整体逻辑较乱、需要改结构或重排，把 needsReview 设为 true，并且不要输出 additionalDeletes（不要硬剪）。
- 只返回一个 JSON 对象，不要 Markdown，不要解释。

JSON 形状：
{"smooth":true,"needsReview":false,"reason":"简短中文说明","additionalDeletes":[{"start":0,"end":0,"reason":"filler","text":""}]}`;

/**
 * @param {object} plan
 * @param {object} [opts]
 * @param {(plan: object, ctx: object) => Promise<object|void>} [opts.refiner]
 * @param {object} [opts.env]
 * @param {object|string} [opts.transcript]
 * @param {typeof fetch} [opts.fetchImpl]
 */
export async function refinePlanWithLlm(plan, opts = {}) {
  const env = opts.env || process.env;
  if (typeof opts.refiner === 'function') {
    if (!hasLlmKey(env) && !opts.refiner) {
      return { ...plan, llm: { used: false, reason: 'no-key' } };
    }
    const refined = await opts.refiner(plan, { transcript: opts.transcript, env: redact(env) });
    if (refined && typeof refined === 'object') {
      return { ...refined, engine: refined.engine || 'rules+llm', llm: { used: true, reason: 'refiner' } };
    }
  }
  if (!hasLlmKey(env)) {
    return { ...plan, llm: { used: false, reason: 'no-key' } };
  }
  const cfg = llmConfig(env);
  if (!cfg.baseUrl) {
    return { ...plan, llm: { used: false, reason: 'no-base-url' } };
  }

  try {
    const user = buildUserMessage(plan, opts.transcript);
    const { content, model } = await chatCompletions({
      env,
      fetchImpl: opts.fetchImpl,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
      temperature: 0,
      maxTokens: 1200,
    });
    const verdict = parseVerdict(content);
    if (!verdict) {
      return {
        ...plan,
        engine: 'rules',
        llm: { used: true, reason: 'unparsed', model, note: '模型返回无法解析为 JSON，已保留规则方案。' },
      };
    }
    return applyVerdict(plan, verdict, opts.transcript, model);
  } catch (err) {
    const status = err.status ? `HTTP ${err.status}` : err.code || 'error';
    return {
      ...plan,
      engine: 'rules',
      llm: {
        used: false,
        reason: 'error',
        status,
        message: sanitizeErrorBody(err.message || String(err)),
      },
    };
  }
}

function buildUserMessage(plan, transcript) {
  const events = (plan.deleteEvents || plan.deletes || []).map((d) => ({
    start: Number(d.start?.toFixed?.(2) ?? d.start),
    end: Number(d.end?.toFixed?.(2) ?? d.end),
    reason: d.reason || d.kind,
    text: d.text || '',
  }));
  const text = typeof transcript === 'string'
    ? transcript
    : (transcript?.text || plan.sourceTranscript || plan.cleanTranscript || '');
  const payload = {
    sourceDuration: plan.sourceDuration,
    cleanDuration: plan.cleanDuration,
    alreadyNeedsReview: Boolean(plan.needsReview),
    sourceTranscript: text,
    cleanTranscript: plan.cleanTranscript || '',
    ruleDeletes: events,
  };
  return JSON.stringify(payload);
}

export function parseVerdict(content) {
  const raw = String(content || '').trim();
  if (!raw) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const jsonText = (fenced ? fenced[1] : raw).trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(jsonText.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

function applyVerdict(plan, verdict, transcript, model) {
  const needsReview = Boolean(verdict.needsReview) || verdict.smooth === false;
  const reason = typeof verdict.reason === 'string' ? verdict.reason.slice(0, 400) : '';
  const flags = [...(plan.flags || [])];
  if (needsReview && !flags.some((f) => f.type === 'messy-logic')) {
    flags.push({
      type: 'messy-logic',
      message: reason || '大模型认为口播逻辑较乱，已保留规则方案，没有追加硬剪。请先看方案再决定是否重剪。',
    });
  }

  let next = {
    ...plan,
    flags,
    needsReview: Boolean(plan.needsReview) || needsReview,
    engine: 'rules+llm',
    llm: {
      used: true,
      reason: needsReview ? 'review' : 'ok',
      model,
      note: reason,
    },
  };

  if (needsReview) return next;

  const extras = normalizeExtraDeletes(verdict.additionalDeletes, plan.sourceDuration);
  if (!extras.length) return next;

  const sourceWords = normalizeWords(transcript) || [];
  if (!sourceWords.length) {
    next.llm = { ...next.llm, reason: 'ok-no-source-words', note: reason };
    return next;
  }
  const events = [...(plan.deleteEvents || plan.deletes || []), ...extras];
  next = recomputePlanFromDeletes(next, events, sourceWords);
  next.engine = 'rules+llm';
  next.llm = {
    used: true,
    reason: 'ok',
    model,
    note: reason,
    extraDeletes: extras.length,
  };
  return next;
}

export function normalizeExtraDeletes(list, duration) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const cap = Number(duration) || 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const start = Number(item.start);
    const end = Number(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const lo = Math.max(0, start);
    const hi = cap ? Math.min(cap, end) : end;
    if (hi - lo < 0.04) continue;
    out.push({
      start: lo,
      end: hi,
      reason: String(item.reason || 'llm').slice(0, 40),
      kind: String(item.reason || 'llm').slice(0, 40),
      text: String(item.text || '').slice(0, 80),
    });
  }
  return out;
}

function redact(env) {
  const out = {};
  for (const k of Object.keys(env || {})) {
    if (/key|token|secret|password/i.test(k)) out[k] = '[present]';
  }
  return out;
}
