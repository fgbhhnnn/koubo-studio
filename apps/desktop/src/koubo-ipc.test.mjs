import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTemplates } from 'koubo';
import { kouboWorkflowWords } from './i18n/koubo-workflow.mjs';
import {
  ingestRequestOf, publicPreview, publicProgress, publicTemplates, uniqueProjectDir, runDesktopIngest,
  publicIngestError, openProjectRetry,
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
  assert.equal(list[0].preview, '');
  assert.ok(!('path' in list[0]));
  assert.ok(!JSON.stringify(list).includes('/secret/path'));
});

test('publicTemplates embeds a pack preview as a data URL and still strips paths', () => {
  const list = publicTemplates();
  const pack = list.find((item) => item.id === 'classic-performance');
  assert.ok(pack);
  assert.match(pack.preview, /^data:image\/svg\+xml;base64,/);
  const raw = JSON.stringify(list);
  assert.ok(!raw.includes('/secret/path'));
  for (const item of listTemplates()) {
    assert.ok(!raw.includes(item.path), `must not leak ${item.path}`);
  }
  assert.ok(!('path' in pack));
  assert.ok(!raw.includes('packages/templates'));
});

test('publicPreview refuses a file outside the pack', () => {
  const root = '/secret/pack';
  assert.equal(publicPreview({ path: root, preview: '../escape.svg' }), '');
  assert.equal(publicPreview({ path: root, preview: '/etc/passwd' }), '');
  assert.equal(publicPreview({ path: root, preview: 'preview.exe' }), '');
  assert.equal(publicPreview({ path: root, preview: '' }), '');
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


test('publicIngestError never leaves the wizard with a raw "fetch failed"', () => {
  const words = kouboWorkflowWords('zh-CN');
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ENOTFOUND' };
  const said = publicIngestError(err, words);
  assert.notEqual(said, 'fetch failed');
  assert.match(said, /网络|ENOTFOUND/);
  assert.equal(publicIngestError(new TypeError('fetch failed'), kouboWorkflowWords('en')), kouboWorkflowWords('en').networkFailed);
});

test('openProjectRetry tries again and still resolves after ingest if opening never works', async () => {
  const asked = [];
  const project = await openProjectRetry(async (folder) => {
    asked.push(folder);
    throw new TypeError('fetch failed');
  }, '/tmp/proj', undefined, 3);
  assert.equal(project, null);
  assert.equal(asked.length, 3);
  assert.deepEqual(asked, ['/tmp/proj', '/tmp/proj', '/tmp/proj']);
});

test('openProjectRetry returns the project on a later try', async () => {
  let n = 0;
  const project = await openProjectRetry(async () => {
    n += 1;
    if (n < 2) throw new TypeError('fetch failed');
    return { id: 'p2', path: '/tmp/proj' };
  }, '/tmp/proj', undefined, 3);
  assert.equal(project?.id, 'p2');
  assert.equal(n, 2);
});
