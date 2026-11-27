import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillIllustrationSlot, createCompatImageGenerator, visualPrompt, hasImageKey } from '../src/images.mjs';

test('hasImageKey is false without a key', () => {
  assert.equal(hasImageKey({}), false);
  assert.equal(createCompatImageGenerator({}), null);
});

test('visualPrompt asks for a no-text illustration', () => {
  assert.match(visualPrompt('三条变现路径'), /三条变现路径/);
  assert.match(visualPrompt('三条变现路径'), /不要出现任何文字/);
});

test('without a generator, fillIllustrationSlot writes a placeholder even if the dest is .png', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-img-'));
  try {
    const out = await fillIllustrationSlot({ prompt: '方法', outPath: join(dir, 'illus-1.png'), index: 1 });
    assert.equal(out.placeholder, true);
    assert.match(out.path, /\.svg$/);
    const svg = await readFile(out.path, 'utf8');
    assert.match(svg, /插图槽/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createCompatImageGenerator writes a PNG from a mocked images/generations response', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-img-'));
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const env = {
    KOUBO_IMAGE_BASE_URL: 'https://sub.lllltt.com/v1',
    KOUBO_IMAGE_API_KEY: 'test-key',
    KOUBO_IMAGE_MODEL: 'GPT Image 2.6 Sunburst',
  };
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://sub.lllltt.com/v1/images/generations');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-image-2.6-sunburst');
    assert.match(body.prompt, /方法/);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ data: [{ url: dataUrl }] });
      },
    };
  };
  try {
    const generator = createCompatImageGenerator(env, { fetchImpl });
    const out = await fillIllustrationSlot({
      prompt: '方法',
      outPath: join(dir, 'illus-1.png'),
      index: 1,
      generator,
    });
    assert.equal(out.placeholder, false);
    assert.match(out.path, /illus-1\.png$/);
    const written = await readFile(out.path);
    assert.deepEqual(written, png);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
