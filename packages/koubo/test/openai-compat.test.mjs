import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  joinApi,
  resolveModel,
  sanitizeErrorBody,
  chatCompletions,
  generateImageBytes,
  llmConfig,
  imageConfig,
} from '../src/openai-compat.mjs';

test('joinApi does not double /v1 when the base already ends with it', () => {
  assert.equal(joinApi('https://sub.lllltt.com/v1', '/chat/completions'), 'https://sub.lllltt.com/v1/chat/completions');
  assert.equal(joinApi('https://sub.lllltt.com/v1/', '/v1/images/generations'), 'https://sub.lllltt.com/v1/images/generations');
  assert.equal(joinApi('https://sub.lllltt.com/v1', 'v1/images/generations'), 'https://sub.lllltt.com/v1/images/generations');
  assert.equal(joinApi('https://api.openai.com/v1', '/models'), 'https://api.openai.com/v1/models');
  assert.equal(joinApi('https://example.com', '/v1/chat/completions'), 'https://example.com/v1/chat/completions');
});

test('resolveModel maps the documented aliases to gateway ids', () => {
  assert.equal(resolveModel('gpt6.2sol'), 'gpt-6.2-sol');
  assert.equal(resolveModel('gpt-6.2-sol'), 'gpt-6.2-sol');
  assert.equal(resolveModel('GPT Image 2.6 Sunburst'), 'gpt-image-2.6-sunburst');
  assert.equal(resolveModel('gpt-image-2.6-sunburst'), 'gpt-image-2.6-sunburst');
});

test('llmConfig and imageConfig read the Koubo variables', () => {
  const env = {
    KOUBO_LLM_BASE_URL: 'https://sub.lllltt.com/v1',
    KOUBO_LLM_API_KEY: 'x',
    KOUBO_LLM_MODEL: 'gpt6.2sol',
    KOUBO_IMAGE_MODEL: 'GPT Image 2.6 Sunburst',
  };
  assert.equal(llmConfig(env).model, 'gpt-6.2-sol');
  assert.equal(llmConfig(env).baseUrl, 'https://sub.lllltt.com/v1');
  assert.equal(imageConfig(env).model, 'gpt-image-2.6-sunburst');
  assert.equal(imageConfig(env).apiKey, 'x');
  assert.equal(imageConfig(env).baseUrl, 'https://sub.lllltt.com/v1');
});

test('sanitizeErrorBody strips keys, bearer tokens and long base64', () => {
  const cleaned = sanitizeErrorBody('Bearer sk-abcdefghijklmnopqrstuvwxyz0123456789 data:image/png;base64,' + 'A'.repeat(120));
  assert.equal(cleaned.includes('sk-abcdefghijklmnopqrstuvwxyz0123456789'), false);
  assert.equal(cleaned.includes('A'.repeat(80)), false);
  assert.match(cleaned, /redacted|b64 omitted/);
});

test('chatCompletions posts to /chat/completions and reads message.content', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: Object.keys(init.headers), body: JSON.parse(init.body) });
    assert.equal(init.headers.Authorization, 'Bearer test-key');
    assert.ok(init.headers['User-Agent']);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          model: 'gpt-6.2-sol',
          choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        });
      },
    };
  };
  const out = await chatCompletions({
    messages: [{ role: 'user', content: 'ping' }],
    env: { KOUBO_LLM_BASE_URL: 'https://sub.lllltt.com/v1', KOUBO_LLM_API_KEY: 'test-key', KOUBO_LLM_MODEL: 'gpt6.2sol' },
    fetchImpl,
  });
  assert.equal(out.content, 'pong');
  assert.equal(calls[0].url, 'https://sub.lllltt.com/v1/chat/completions');
  assert.equal(calls[0].body.model, 'gpt-6.2-sol');
});

test('generateImageBytes decodes a data URL and never requires /v1/v1', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://sub.lllltt.com/v1/images/generations');
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ data: [{ url: dataUrl, model: 'gpt-image-2.6-sunburst' }] });
      },
    };
  };
  const out = await generateImageBytes({
    prompt: 'icon',
    env: {
      KOUBO_IMAGE_BASE_URL: 'https://sub.lllltt.com/v1',
      KOUBO_IMAGE_API_KEY: 'test-key',
      KOUBO_IMAGE_MODEL: 'GPT Image 2.6 Sunburst',
    },
    fetchImpl,
  });
  assert.equal(out.mime, 'image/png');
  assert.deepEqual(out.bytes, png);
});
