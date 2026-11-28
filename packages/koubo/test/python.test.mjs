import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveKouboPython, pipelineCommand, pythonExecutable } from '../src/python.mjs';
import { remapUnitsSfx } from '../src/adu-runtime.mjs';

test('resolveKouboPython prefers KOUBO_PYTHON, then a packaged runtime, then PATH', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-py-'));
  try {
    const envPython = join(dir, 'env-python');
    await writeFile(envPython, '#!/bin/sh\nexit 0\n');
    await chmod(envPython, 0o755);
    const env = { ...process.env, KOUBO_PYTHON: envPython, PATH: '/no/such/bin' };
    const fromEnv = resolveKouboPython({ env, allowSystem: false });
    assert.equal(fromEnv.path, envPython);
    assert.equal(fromEnv.source, 'env');
    assert.ok(fromEnv.pipeline && fromEnv.pipeline.endsWith('pipeline.py'));

    const runtime = join(dir, 'runtime');
    const bundledDir = join(runtime, 'python');
    const pipeline = join(runtime, 'adu', 'pipeline.py');
    await mkdir(join(bundledDir, 'bin'), { recursive: true });
    await mkdir(join(runtime, 'adu'), { recursive: true });
    const bundled = pythonExecutable(bundledDir, 'linux');
    await writeFile(bundled, '#!/bin/sh\nexit 0\n');
    await chmod(bundled, 0o755);
    await writeFile(pipeline, '# pipeline\n');
    const fromBundled = resolveKouboPython({
      env: { PATH: '/no/such/bin', KOUBO_ADU_PIPELINE: pipeline },
      allowSystem: false,
      platform: 'linux',
    });
    assert.equal(fromBundled.source, 'bundled');
    assert.equal(fromBundled.path, bundled);
    assert.equal(fromBundled.pipeline, pipeline);

    const missing = resolveKouboPython({
      env: { PATH: '/no/such/bin' },
      allowSystem: false,
    });
    assert.equal(missing, null);
    assert.equal(pipelineCommand(null, ['doctor']), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('remapUnitsSfx maps claim cues onto the film clock', async () => {
  const events = await remapUnitsSfx([
    {
      id: 'unit-01',
      unitId: 'claim-into-container',
      at: 4,
      duration: 15.466,
      clock: { mode: 'linear', srcStart: 0, srcEnd: 15.466, outStart: 0, outEnd: 15.466, segments: [] },
    },
  ]);
  assert.ok(events.length >= 3);
  const hit = events.find((c) => c.type === 'hit' && Number(c.sourceT) === 0.16);
  assert.ok(hit, 'expected the 0.16s hit cue');
  assert.ok(Math.abs(hit.t - 4.16) < 1e-6);
});
