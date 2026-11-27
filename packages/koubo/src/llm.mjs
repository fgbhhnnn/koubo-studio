/**
 * Optional LLM refinement slot.
 *
 * When KOUBO_LLM_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY is missing,
 * the rule-engine plan is returned unchanged. When a key is present, a hook
 * may adjust keep/delete ranges. The default implementation is a no-op
 * beyond recording that a key was detected, unless `refiner` is supplied.
 * Never log the key.
 */

function hasLlmKey(env = process.env) {
  return Boolean(env.KOUBO_LLM_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY);
}

/**
 * @param {object} plan
 * @param {object} [opts]
 * @param {(plan: object, ctx: object) => Promise<object|void>} [opts.refiner]
 * @param {object} [opts.env]
 * @param {string} [opts.transcript]
 */
export async function refinePlanWithLlm(plan, opts = {}) {
  const env = opts.env || process.env;
  if (!hasLlmKey(env) && typeof opts.refiner !== 'function') {
    return { ...plan, llm: { used: false, reason: 'no-key' } };
  }
  if (typeof opts.refiner === 'function') {
    const refined = await opts.refiner(plan, { transcript: opts.transcript, env: redact(env) });
    if (refined && typeof refined === 'object') {
      return { ...refined, engine: refined.engine || 'rules+llm', llm: { used: true, reason: 'refiner' } };
    }
  }
  // Key present but no refiner wired yet: keep the rule plan, record the slot.
  return { ...plan, llm: { used: false, reason: 'slot-only' } };
}

function redact(env) {
  const out = {};
  for (const k of Object.keys(env)) {
    if (/key|token|secret|password/i.test(k)) out[k] = '[present]';
  }
  return out;
}

export { hasLlmKey };
