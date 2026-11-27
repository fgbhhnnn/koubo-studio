import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeErrorBody, normalizeTranscript } from '../src/transcribe.mjs';
import { refinePlanWithLlm } from '../src/llm.mjs';

test('sanitizeErrorBody never echoes an API key', () => {
  const raw = 'denied for key sk_abcdefghijklmnopqrstuvwxyz0123456789 and xi-api-key: supersecret';
  const cleaned = sanitizeErrorBody(raw);
  assert.equal(cleaned.includes('sk_abcdefghijklmnopqrstuvwxyz0123456789'), false);
  assert.equal(cleaned.includes('supersecret'), false);
  assert.match(cleaned, /redacted/);
});

test('normalizeTranscript keeps word-level payload', () => {
  const t = normalizeTranscript({
    text: '你好',
    language_code: 'cmn',
    words: [{ text: '你好', start: 0, end: 0.4, type: 'word' }],
  }, { model: 'scribe_v2', file: 'a.mp4' });
  assert.equal(t.words.length, 1);
  assert.equal(t.model, 'scribe_v2');
});

test('LLM slot is a no-op without a key', async () => {
  const plan = { keeps: [{ start: 0, end: 1 }], llm: { used: false } };
  const out = await refinePlanWithLlm(plan, { env: {} });
  assert.equal(out.llm.used, false);
  assert.equal(out.llm.reason, 'no-key');
});

test('LLM slot can apply a custom refiner', async () => {
  const plan = { keeps: [{ start: 0, end: 1 }] };
  const out = await refinePlanWithLlm(plan, {
    env: { OPENAI_API_KEY: 'x' },
    refiner: async (p) => ({ ...p, keeps: [{ start: 0, end: 2 }] }),
  });
  assert.equal(out.llm.used, true);
  assert.equal(out.keeps[0].end, 2);
});
