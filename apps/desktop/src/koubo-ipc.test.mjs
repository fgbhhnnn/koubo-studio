import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ingestRequestOf, publicProgress, publicTemplates, uniqueProjectDir, runDesktopIngest,
} from './koubo-ipc.mjs';

test('ingest request requires an absolute video path and strips the key from the public request', () => {
  assert.throws(() => ingestRequestOf({ video: 'relative.mp4' }), /Please choose a talking-head video first/);
  assert.throws(() => ingestRequestOf({ video: 'relative.mp4' }, 'zh-CN'), /请先选择口播视频/);
  const { request, apiKey, saveKey } = ingestRequestOf({
    video: '/tmp/talk.mp4',
    title: '  本期口播  ',
    templateId: 'classic-performance',
    apiKey: 'sk_test_not_a_real_key_zzzz',
    saveKey: true,
  });
  assert.deepEqual(request, {
    video: '/tmp/talk.mp4',
    title: '本期口播',
    templateId: 'classic-performance',
    mode: 'talking-head',
  });
  assert.equal(apiKey, 'sk_test_not_a_real_key_zzzz');
  assert.equal(saveKey, true);
  assert.ok(!JSON.stringify(request).includes('sk_test'));
});

test('missing template id means auto-assign later, not a fake pack name', () => {
  const { request } = ingestRequestOf({ video: '/tmp/talk.mp4' });
  assert.equal(request.templateId, null);
  assert.equal(request.title, 'talk');
});

test('progress events are sanitized and never include a key', () => {
  const out = publicProgress({
    step: 'transcribe',
    message: 'ElevenLabs failed xi-api-key=sk_live_SECRET ELEVENLABS_API_KEY=sk_live_SECRET',
    extra: 'ignored',
  });
  assert.equal(out.step, 'transcribe');
  assert.doesNotMatch(out.message, /sk_live_SECRET/);
  assert.ok(!('extra' in out));
});

test('public template list is catalog cards without filesystem paths', () => {
  const list = publicTemplates([
    { id: 'classic-performance', kind: 'talking-head', name: { 'zh-CN': '口播讲解', en: 'Talking-head explainer' }, description: 'captions', units: ['a'], path: '/secret/path' },
  ]);
  assert.equal(list[0].id, 'classic-performance');
  assert.equal(list[0].name['zh-CN'], '口播讲解');
  assert.ok(!JSON.stringify(list).includes('/secret/path'));
});

test('uniqueProjectDir increments when the title folder already exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-lib-'));
  try {
    await mkdir(join(dir, '本期口播'));
    const next = uniqueProjectDir(dir, '本期口播');
    assert.equal(next, join(dir, '本期口播-2'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runDesktopIngest calls the pipeline then opens the Studio project, without leaking the key', async () => {
  const video = '/tmp/does-not-need-to-exist-for-request-but-will'; // will fail existsSync
  // Use a real temp file:
  const { writeFile } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'koubo-run-'));
  try {
    const file = join(root, 'talk.mp4');
    await writeFile(file, 'x');
    const library = join(root, 'library');
    await mkdir(library);
    const events = [];
    const result = await runDesktopIngest({
      video: file,
      title: '桌面口播',
      apiKey: 'sk_test_should_not_leak_yyyy',
      saveKey: false,
    }, {
      home: join(root, 'home'),
      env: {},
      studioApi: async (path) => {
        assert.equal(path, '/api/locations');
        return { projects: { path: library } };
      },
      openProject: async (outDir) => ({ id: 'proj-1', path: outDir }),
      ingest: async (opts) => {
        assert.equal(opts.title, '桌面口播');
        assert.equal(opts.templateId, null);
        assert.ok(opts.outDir.startsWith(library));
        assert.equal(opts.apiKey, 'sk_test_should_not_leak_yyyy');
        opts.onProgress?.({ step: 'plan', message: 'ok' });
        return { outDir: opts.outDir, film: join(opts.outDir, 'film.html'), templateId: 'classic-performance', templateSource: 'auto', needsReview: false };
      },
      sender: { send: (_ch, payload) => events.push(payload) },
    });
    assert.equal(result.ok, true);
    assert.equal(result.projectId, 'proj-1');
    assert.equal(result.templateSource, 'auto');
    const all = JSON.stringify({ result, events });
    assert.doesNotMatch(all, /sk_test_should_not_leak/);
    assert.ok(events.some((e) => e.step === 'done' && e.projectId === 'proj-1'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
