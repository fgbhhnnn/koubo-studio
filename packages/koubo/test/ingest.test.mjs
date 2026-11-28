import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestTalkingHead } from '../src/ingest.mjs';
import { reapplyTemplate } from '../src/project.mjs';

const fixture = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript.json'), 'utf8'));

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-ingest-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('ingest auto-assigns classic-performance when no template is chosen', async () => {
  await withTemp(async (dir) => {
    const video = join(dir, 'talk.mp4');
    await writeFile(video, 'fake-video');
    const outDir = join(dir, 'project');
    const progress = [];
    const result = await ingestTalkingHead({
      video,
      outDir,
      title: '测试口播',
      transcript: fixture,
      env: {},
      cut: async ({ output }) => { await mkdir(dirname(output), { recursive: true }); await writeFile(output, 'clean'); },
      probe: async () => 12,
      refine: async (plan) => plan,
      onProgress: (e) => progress.push(e),
    });
    assert.equal(result.templateId, 'classic-performance');
    assert.equal(result.templateSource, 'auto');
    const workflow = JSON.parse(await readFile(join(outDir, 'koubo', 'workflow.json'), 'utf8'));
    assert.equal(workflow.mode, 'talking-head');
    assert.equal(workflow.templateId, 'classic-performance');
    assert.equal(workflow.templateSource, 'auto');
    assert.equal(workflow.sourceVideoName, 'talk.mp4');
    const dumped = JSON.stringify(workflow) + progress.map((p) => p.message).join('\n');
    assert.doesNotMatch(dumped, /sk_|api[_-]?key/i);
    assert.ok(existsSync(join(outDir, 'film.html')));
    assert.ok(existsSync(join(outDir, 'assets', 'talking-clean.mp4')));
  });
});

test('a user-picked template is stored as a user choice', async () => {
  await withTemp(async (dir) => {
    const video = join(dir, 'talk.mp4');
    await writeFile(video, 'fake-video');
    const outDir = join(dir, 'project');
    const result = await ingestTalkingHead({
      video,
      outDir,
      transcript: fixture,
      templateId: 'classic-performance',
      env: {},
      cut: async ({ output }) => { await mkdir(dirname(output), { recursive: true }); await writeFile(output, 'clean'); },
      probe: async () => 12,
      refine: async (plan) => plan,
    });
    assert.equal(result.templateSource, 'user');
    const plan = JSON.parse(await readFile(join(outDir, 'koubo', 'plan.json'), 'utf8'));
    assert.equal(plan.template.id, 'classic-performance');
    assert.equal(plan.template.source, 'user');
  });
});

test('unknown template id fails before cutting', async () => {
  await withTemp(async (dir) => {
    const video = join(dir, 'talk.mp4');
    await writeFile(video, 'fake-video');
    let cutCalled = false;
    await assert.rejects(() => ingestTalkingHead({
      video,
      outDir: join(dir, 'project'),
      transcript: fixture,
      templateId: 'does-not-exist',
      env: {},
      cut: async () => { cutCalled = true; },
    }), /未知模板/);
    assert.equal(cutCalled, false);
  });
});

test('reapplyTemplate records a new user-chosen pack without requiring a key', async () => {
  await withTemp(async (dir) => {
    const video = join(dir, 'talk.mp4');
    await writeFile(video, 'fake-video');
    const outDir = join(dir, 'project');
    await ingestTalkingHead({
      video,
      outDir,
      title: '换模板',
      transcript: fixture,
      env: {},
      cut: async ({ output }) => { await mkdir(dirname(output), { recursive: true }); await writeFile(output, 'clean'); },
      probe: async () => 12,
      refine: async (plan) => plan,
    });
    const again = await reapplyTemplate({ outDir, templateId: 'classic-performance', env: {} });
    assert.equal(again.templateId, 'classic-performance');
    assert.equal(again.templateSource, 'user');
    const workflow = JSON.parse(await readFile(join(outDir, 'koubo', 'workflow.json'), 'utf8'));
    assert.equal(workflow.templateSource, 'user');
    assert.equal(workflow.title, '换模板');
  });
});

test('ingest without a transcript or key fails with NO_API_KEY', async () => {
  await withTemp(async (dir) => {
    const video = join(dir, 'talk.mp4');
    await writeFile(video, 'fake-video');
    await assert.rejects(() => ingestTalkingHead({
      video,
      outDir: join(dir, 'project'),
      env: {},
      home: dir,
    }), (err) => err.code === 'NO_API_KEY');
  });
});
