import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refinePlanWithLlm, parseVerdict, normalizeExtraDeletes } from '../src/llm.mjs';
import { planCuts } from '../src/plan.mjs';

const words = {
  text: '今天我们来讲方法。嗯 下一步开始。',
  audio_duration_secs: 6,
  words: [
    { text: '今天', start: 0.2, end: 0.5, type: 'word' },
    { text: '我们', start: 0.6, end: 0.9, type: 'word' },
    { text: '来', start: 1.0, end: 1.2, type: 'word' },
    { text: '讲', start: 1.3, end: 1.5, type: 'word' },
    { text: '方法。', start: 1.6, end: 2.1, type: 'word' },
    { text: '嗯', start: 2.3, end: 2.5, type: 'word' },
    { text: '下一步', start: 2.8, end: 3.3, type: 'word' },
    { text: '开始。', start: 3.4, end: 3.9, type: 'word' },
  ],
};

function mockChat(content, capture = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ choices: [{ message: { content } }] });
      },
    };
  };
}

const env = {
  KOUBO_LLM_BASE_URL: 'https://sub.lllltt.com/v1',
  KOUBO_LLM_API_KEY: 'test-key',
  KOUBO_LLM_MODEL: 'gpt6.2sol',
};

test('without a key, refinePlanWithLlm leaves the rule plan alone', async () => {
  const plan = planCuts(words, { duration: 6 });
  const out = await refinePlanWithLlm(plan, { env: {}, transcript: words });
  assert.equal(out.llm.used, false);
  assert.equal(out.llm.reason, 'no-key');
  assert.deepEqual(out.keeps, plan.keeps);
});

test('parseVerdict accepts raw JSON and fenced JSON', () => {
  assert.equal(parseVerdict('{"smooth":true,"needsReview":false}').smooth, true);
  assert.equal(parseVerdict('```json\n{"needsReview":true,"reason":"乱"}\n```').needsReview, true);
  assert.equal(parseVerdict('not json'), null);
});

test('a smooth verdict can add a conservative extra delete and recompute keeps', async () => {
  const plan = planCuts(words, { duration: 6 });
  const before = plan.keeps.slice();
  const out = await refinePlanWithLlm(plan, {
    env,
    transcript: words,
    fetchImpl: mockChat(JSON.stringify({
      smooth: true,
      needsReview: false,
      reason: '顺畅，只再去掉句末空白。',
      additionalDeletes: [{ start: 3.4, end: 3.9, reason: 'repeat', text: '开始。' }],
    })),
  });
  assert.equal(out.llm.used, true);
  assert.equal(out.engine, 'rules+llm');
  assert.equal(out.needsReview, false);
  assert.ok(out.deletes.some((d) => d.start <= 3.41 && d.end >= 3.89));
  assert.equal(out.cleanTranscript.includes('开始'), false);
  assert.notDeepEqual(out.keeps, before);
});

test('a messy verdict is flagged and does not apply extra hard cuts', async () => {
  const plan = planCuts(words, { duration: 6 });
  const out = await refinePlanWithLlm(plan, {
    env,
    transcript: words,
    fetchImpl: mockChat(JSON.stringify({
      smooth: false,
      needsReview: true,
      reason: '结构较乱，不要硬剪。',
      additionalDeletes: [{ start: 0.2, end: 2.1, reason: 'reorder', text: '今天我们来讲方法。' }],
    })),
  });
  assert.equal(out.llm.used, true);
  assert.equal(out.needsReview, true);
  assert.ok(out.flags.some((f) => f.type === 'messy-logic'));
  assert.equal(out.deletes.some((d) => d.start <= 0.2 && d.end >= 2.0 && String(d.reason).includes('reorder')), false);
  assert.match(out.cleanTranscript, /今天我们来讲方法/);
});

test('HTTP failures are sanitized and do not throw', async () => {
  const plan = planCuts(words, { duration: 6 });
  const out = await refinePlanWithLlm(plan, {
    env,
    transcript: words,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() { return 'denied Bearer sk-abcdefghijklmnopqrstuvwxyz012345 and payload AAAAAAAAAA'.padEnd(200, 'A'); },
    }),
  });
  assert.equal(out.llm.used, false);
  assert.equal(out.llm.reason, 'error');
  assert.equal(out.llm.status, 'HTTP 401');
  assert.equal(JSON.stringify(out.llm).includes('sk-abcdefghijklmnopqrstuvwxyz012345'), false);
});

test('normalizeExtraDeletes drops invalid ranges', () => {
  assert.equal(normalizeExtraDeletes([{ start: 3, end: 1 }, { start: 'x', end: 2 }], 10).length, 0);
  assert.equal(normalizeExtraDeletes([{ start: 1, end: 2, reason: 'filler' }], 10)[0].end, 2);
});
