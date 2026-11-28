import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ADU_RUNTIME_PACKAGES,
  PYTHON_BUILDS,
  aduDoctorCommand,
  assertStagedRuntime,
  fetchPython,
  installAduRequirements,
  pythonChildEnv,
  pythonDownloadable,
  pythonExecutable,
  pythonIn,
  pythonSitePackages,
  resolvePython,
  stageAduScripts,
  stagePythonRuntime,
} from './python-runtime.mjs';

const answer = (bytes) => new Response(new ReadableStream({
  start(c) { c.enqueue(bytes); c.close(); },
}), { headers: { 'content-length': String(bytes.length) } });

const scratch = () => mkdtempSync(join(tmpdir(), 'koubo-python-'));

/** A tiny python-build-standalone-like tree packed as tar.gz. */
function fakeArchive(platform = 'darwin') {
  const tree = scratch();
  const python = join(tree, 'python');
  mkdirSync(python, { recursive: true });
  if (platform === 'win32') {
    writeFileSync(join(python, 'python.exe'), 'python');
    mkdirSync(join(python, 'Lib', 'site-packages'), { recursive: true });
  } else {
    mkdirSync(join(python, 'bin'), { recursive: true });
    /* Official python-build-standalone layout: python3 is a relative
       symlink to python3.12. A copy that rewrites this to an absolute
       temp path would fail existsSync after the extract dir is removed. */
    writeFileSync(join(python, 'bin', 'python3.12'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(python, 'bin', 'python3.12'), 0o755);
    symlinkSync('python3.12', join(python, 'bin', 'python3'));
    symlinkSync('python3.12', join(python, 'bin', 'python'));
    mkdirSync(join(python, 'lib', 'python3.12', 'site-packages'), { recursive: true });
  }
  const archive = join(scratch(), 'python.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', tree, 'python']);
  const bytes = readFileSync(archive);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), file: 'python.tar.gz' };
}

test('desktop pack targets have a pinned CPython and Linux does not', () => {
  assert.equal(pythonDownloadable('win32', 'x64'), true);
  assert.equal(pythonDownloadable('darwin', 'arm64'), true);
  assert.equal(pythonDownloadable('darwin', 'x64'), true);
  assert.equal(pythonDownloadable('linux', 'x64'), false);
  assert.equal(pythonDownloadable('win32', 'arm64'), false);
  for (const key of ['win32-x64', 'darwin-arm64', 'darwin-x64']) {
    assert.match(PYTHON_BUILDS[key].file, /install_only_stripped\.tar\.gz$/);
    assert.equal(PYTHON_BUILDS[key].sha256.length, 64);
  }
  assert.equal(PYTHON_BUILDS['win32-x64'].pipPlatform, 'win_amd64');
  assert.equal(PYTHON_BUILDS['darwin-arm64'].pipPlatform, 'macosx_12_0_arm64');
  assert.equal(PYTHON_BUILDS['darwin-x64'].pipPlatform, 'macosx_12_0_x86_64');
});

test('the 阿杜 runtime pins opencv-python-headless, not the GUI or CUDA builds', () => {
  assert.deepEqual(ADU_RUNTIME_PACKAGES, ['numpy', 'pillow', 'scipy', 'opencv-python-headless', 'fonttools']);
  assert.ok(!ADU_RUNTIME_PACKAGES.includes('opencv-python'));
  assert.ok(!ADU_RUNTIME_PACKAGES.some((name) => /cuda|contrib|gpu/i.test(name)));
});

test('a build whose checksum is not the pinned one is not kept', async () => {
  const dir = scratch();
  const cacheDir = scratch();
  const fetch = async () => answer(Buffer.from('not python'));
  await assert.rejects(fetchPython(dir, { platform: 'darwin', arch: 'arm64', fetch, cacheDir }), /did not match its checksum/);
  assert.equal(pythonIn(dir, 'darwin'), false);
  assert.equal(existsSync(join(cacheDir, PYTHON_BUILDS['darwin-arm64'].file)), false);
});

test('no portable Python for a platform says so', async () => {
  await assert.rejects(
    fetchPython(scratch(), { platform: 'linux', arch: 'x64' }),
    /no portable Python to download for linux-x64/,
  );
});

test('a download that fails is tried again, three times in all', async () => {
  const asked = [];
  const fetch = async (url) => { asked.push(url.split('/').pop()); throw new TypeError('fetch failed'); };
  await assert.rejects(fetchPython(scratch(), { platform: 'win32', arch: 'x64', fetch, cacheDir: scratch() }), /fetch failed/);
  assert.equal(asked.filter((name) => name === PYTHON_BUILDS['win32-x64'].file).length, 3);
});

test('a download that stops coming is stopped and tried again', async () => {
  let tries = 0;
  const fetch = async (url, { signal }) => {
    if (url.endsWith(PYTHON_BUILDS['darwin-x64'].file)) tries++;
    return new Response(new ReadableStream({
      start(c) { signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); },
    }));
  };
  await assert.rejects(fetchPython(scratch(), {
    platform: 'darwin', arch: 'x64', fetch, cacheDir: scratch(), stallMs: 50,
  }), /stalled/);
  assert.equal(tries, 3);
});

test('the staged runtime exists for the target platform when building', async () => {
  const { bytes, sha256, file } = fakeArchive('win32');
  const runtimeDir = scratch();
  const cacheDir = scratch();
  const pipCalls = [];
  const fetch = async () => answer(bytes);
  const pip = (argv) => {
    pipCalls.push(argv);
    const targetFlag = argv.indexOf('--target');
    const target = targetFlag >= 0 ? argv[targetFlag + 1] : pythonSitePackages(join(runtimeDir, 'python'), 'win32');
    mkdirSync(target, { recursive: true });
    for (const name of ADU_RUNTIME_PACKAGES) {
      mkdirSync(join(target, `${name.replaceAll('-', '_')}-1.0.dist-info`), { recursive: true });
    }
  };
  await stagePythonRuntime(runtimeDir, {
    platform: 'win32', arch: 'x64', fetch, pip, cacheDir,
    build: { file, sha256, pipPlatform: 'win_amd64', version: '3.12.16' },
  });
  assert.equal(pythonIn(join(runtimeDir, 'python'), 'win32'), true);
  assert.equal(existsSync(join(runtimeDir, 'adu', 'pipeline.py')), true);
  assert.equal(existsSync(join(runtimeDir, 'python', 'SOURCE')), true);
  assertStagedRuntime(runtimeDir, 'win32');
  const resolved = resolvePython({ runtimeDir, platform: 'win32', allowSystem: false, pathLookup: () => null });
  assert.equal(resolved.source, 'bundled');
  assert.equal(resolved.path, pythonExecutable(join(runtimeDir, 'python'), 'win32'));
  const pipLine = pipCalls[0].join(' ');
  assert.match(pipLine, /--only-binary=:all:/);
  assert.match(pipLine, /--platform=win_amd64/);
  assert.match(pipLine, /requirements-runtime\.txt/);
  assert.ok(!pipLine.includes('opencv-python '), 'must not install the GUI OpenCV package');
});

test('a cached archive that matches its checksum is not downloaded again', async () => {
  const { bytes, sha256, file } = fakeArchive('darwin');
  const cacheDir = scratch();
  const archive = join(cacheDir, file);
  writeFileSync(archive, bytes);
  let fetches = 0;
  const fetch = async () => { fetches++; return answer(bytes); };
  const dir = scratch();
  await fetchPython(dir, {
    platform: 'darwin', arch: 'arm64', fetch, cacheDir,
    build: { file, sha256, pipPlatform: 'macosx_11_0_arm64', version: '3.12.16' },
  });
  assert.equal(fetches, 0);
  assert.equal(pythonIn(dir, 'darwin'), true);
  const exe = pythonExecutable(dir, 'darwin');
  assert.equal(lstatSync(exe).isSymbolicLink(), true);
  assert.equal(readlinkSync(exe), 'python3.12');
  assert.equal(existsSync(exe), true);
});

test('cross-install uses wheels only and the Windows site-packages path', async () => {
  const dir = scratch();
  writeFileSync(join(dir, 'python.exe'), 'python');
  const seen = [];
  const pip = (argv) => { seen.push(argv); };
  await installAduRequirements(dir, { platform: 'win32', arch: 'x64', pip, cacheDir: scratch() });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].includes('--only-binary=:all:'), true);
  assert.equal(seen[0].includes('--platform=win_amd64'), true);
  assert.equal(seen[0].includes('--python-version=3.12'), true);
  const target = seen[0][seen[0].indexOf('--target') + 1];
  assert.equal(target, pythonSitePackages(dir, 'win32'));
  assert.match(target, /Lib[/\\]site-packages$/);
});

test('resolvePython prefers KOUBO_PYTHON, then the bundled runtime, and does not throw when missing', () => {
  const bundled = scratch();
  mkdirSync(join(bundled, 'bin'), { recursive: true });
  const bundledPy = join(bundled, 'bin', 'python3');
  writeFileSync(bundledPy, '');
  const envPy = join(scratch(), 'custom-python');
  writeFileSync(envPy, '');
  const pipeline = join(scratch(), 'pipeline.py');
  writeFileSync(pipeline, '');

  assert.deepEqual(resolvePython({
    env: { KOUBO_PYTHON: envPy },
    bundledDir: bundled,
    platform: 'darwin',
    pipeline,
    allowSystem: false,
    pathLookup: () => '/usr/bin/python3',
  }), { path: envPy, source: 'env', pipeline });

  assert.deepEqual(resolvePython({
    env: {},
    bundledDir: bundled,
    platform: 'darwin',
    pipeline,
    allowSystem: false,
    pathLookup: () => '/usr/bin/python3',
  }), { path: bundledPy, source: 'bundled', pipeline });

  const runtimeDir = scratch();
  mkdirSync(join(runtimeDir, 'python', 'bin'), { recursive: true });
  mkdirSync(join(runtimeDir, 'adu'), { recursive: true });
  writeFileSync(join(runtimeDir, 'python', 'bin', 'python3'), '');
  writeFileSync(join(runtimeDir, 'adu', 'pipeline.py'), '');
  const found = resolvePython({ env: {}, runtimeDir, platform: 'darwin', allowSystem: false, pathLookup: () => null });
  assert.equal(found.source, 'bundled');
  assert.equal(found.path, pythonExecutable(join(runtimeDir, 'python'), 'darwin'));
  assert.equal(found.pipeline, join(runtimeDir, 'adu', 'pipeline.py'));

  const fromSystem = resolvePython({
    env: {},
    bundledDir: scratch(),
    platform: 'darwin',
    allowSystem: true,
    pathLookup: (name) => (name === 'python3' ? '/opt/python3' : null),
  });
  assert.equal(fromSystem.source, 'system');
  assert.equal(fromSystem.path, '/opt/python3');

  assert.equal(resolvePython({
    env: { KOUBO_PYTHON: join(scratch(), 'gone') },
    bundledDir: join(scratch(), 'nope'),
    platform: 'darwin',
    allowSystem: true,
    pathLookup: () => null,
  }), null);

  assert.equal(resolvePython({
    env: {},
    bundledDir: scratch(),
    platform: 'win32',
    allowSystem: false,
    pathLookup: () => 'C:\\Python\\python.exe',
  }), null);
});

test('pythonChildEnv and aduDoctorCommand document the call path without requiring Python', () => {
  const base = { PATH: '/usr/bin', OTHER: '1' };
  assert.deepEqual(pythonChildEnv(base, null), { PATH: '/usr/bin', OTHER: '1' });
  assert.equal(aduDoctorCommand(null), null);

  const resolved = { path: '/app/runtime/python/bin/python3', source: 'bundled', pipeline: '/app/runtime/adu/pipeline.py' };
  const child = pythonChildEnv(base, resolved, { pathSep: ':' });
  assert.equal(child.KOUBO_PYTHON, resolved.path);
  assert.equal(child.KOUBO_ADU_PIPELINE, resolved.pipeline);
  assert.equal(child.PYTHONNOUSERSITE, '1');
  assert.equal(child.PATH.startsWith('/app/runtime/python/bin:'), true);
  assert.deepEqual(aduDoctorCommand(resolved), {
    command: resolved.path,
    args: [resolved.pipeline, 'doctor'],
  });
});

test('stageAduScripts copies the smoke-check pipeline next to the runtime', () => {
  const runtimeDir = scratch();
  stageAduScripts(runtimeDir);
  assert.equal(existsSync(join(runtimeDir, 'adu', 'pipeline.py')), true);
  assert.equal(existsSync(join(runtimeDir, 'adu', 'requirements-runtime.txt')), true);
  const requirements = readFileSync(join(runtimeDir, 'adu', 'requirements-runtime.txt'), 'utf8');
  assert.match(requirements, /opencv-python-headless>=4\.8,<6/);
  assert.doesNotMatch(requirements, /^opencv-python>=/m);
});

test('a Windows interpreter path is python.exe under runtime/python', () => {
  const dir = join(scratch(), 'python');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'python.exe'), '');
  assert.equal(pythonExecutable(dir, 'win32'), join(dir, 'python.exe'));
  assert.equal(pythonIn(dir, 'win32'), true);
  assert.equal(pythonIn(dir, 'darwin'), false);
});
