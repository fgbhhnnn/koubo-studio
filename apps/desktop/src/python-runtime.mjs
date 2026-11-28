/**
 * Portable CPython for the 阿杜 / adu-motion-video Python pipeline.
 *
 * Packaged desktop builds (scripts/release.mjs) download a pinned
 * python-build-standalone `install_only_stripped` archive for the target
 * (win-x64, mac-arm64, mac-x64; no Linux installer) into the app's resources
 * at `runtime/python`, then install the wheels in runtime/adu/requirements-runtime.txt
 * (numpy, pillow, scipy, opencv-python-headless, fonttools). Official MotionGit
 * `.motion` packs are never downloaded or shipped.
 *
 * The app locates the interpreter with `resolvePython` and, when one is found,
 * sets `KOUBO_PYTHON` and `KOUBO_ADU_PIPELINE` on Studio and the `koubo`
 * command. A missing runtime must not throw: the JavaScript talking-head path
 * still works from source without Python. Packaged builds include Python.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE = '20261124';
const VERSION = '3.12.16';
const PYTHON_VERSION_TAG = '3.12';
const ABI = 'cp312';
const BASE = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}`;

/**
 * Pinned builds: sha256 of the official install_only_stripped archives (from
 * the release SHA256SUMS). pipPlatform is always used when installing wheels
 * (`--target` + `--only-binary`), including on the same OS: a macOS 15 packer
 * must not pick OpenCV wheels that only run on macOS 15. The macOS 12 tag is
 * the newest SciPy/OpenCV combination that still resolves; the bundled
 * runtime therefore needs macOS 12+. Windows installers are built on macOS.
 */
export const PYTHON_BUILDS = Object.freeze({
  'darwin-arm64': {
    version: VERSION,
    file: `cpython-${VERSION}+${RELEASE}-aarch64-apple-darwin-install_only_stripped.tar.gz`,
    sha256: '9d6d9d0d85feda3f9cb4eb3e048f0fed21ed280feda087927eaa4fbc7124826f',
    pipPlatform: 'macosx_12_0_arm64',
  },
  'darwin-x64': {
    version: VERSION,
    file: `cpython-${VERSION}+${RELEASE}-x86_64-apple-darwin-install_only_stripped.tar.gz`,
    sha256: '6d7ef4efa1adf65f312e6e865040ce03ef8a4bd7e1b45415193295c9ffc0dbdd',
    pipPlatform: 'macosx_12_0_x86_64',
  },
  'win32-x64': {
    version: VERSION,
    file: `cpython-${VERSION}+${RELEASE}-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,
    sha256: '96694b50dcfde13d56e40346ddaa552a9cd650290e9b933cecf83c1d82226960',
    pipPlatform: 'win_amd64',
  },
});

export const PYTHON_SOURCE = `CPython ${VERSION}, python-build-standalone ${RELEASE} (${BASE}), Mozilla Public License 2.0.\n`
  + 'The CPython sources are under the PSF License: https://docs.python.org/3/license.html\n';

/** The packages the 阿杜 pipeline needs; opencv-python-headless is the CPU wheel, not GUI or CUDA builds. */
export const ADU_RUNTIME_PACKAGES = Object.freeze([
  'numpy', 'pillow', 'scipy', 'opencv-python-headless', 'fonttools',
]);

const STALL_MS = 30_000;
const TRIES = 3;

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
export const defaultAduDir = () => here('../runtime/adu');

const buildKey = (platform, arch) => `${platform}-${arch}`;

/** Whether this pack target has a pinned portable CPython. */
export const pythonDownloadable = (platform = process.platform, arch = process.arch) => (
  Object.hasOwn(PYTHON_BUILDS, buildKey(platform, arch))
);

/** The interpreter inside a staged `runtime/python` folder. */
export function pythonExecutable(dir, platform = process.platform) {
  return platform === 'win32' ? join(dir, 'python.exe') : join(dir, 'bin', 'python3');
}

/** Whether a folder looks like a staged portable CPython (the interpreter is there). */
export function pythonIn(dir, platform = process.platform) {
  return Boolean(dir) && existsSync(pythonExecutable(dir, platform));
}

/** site-packages of a python-build-standalone install_only tree. */
export function pythonSitePackages(dir, platform = process.platform) {
  return platform === 'win32'
    ? join(dir, 'Lib', 'site-packages')
    : join(dir, 'lib', `python${PYTHON_VERSION_TAG}`, 'site-packages');
}

/** Cache for the CPython archives (and pip's wheel cache underneath). */
export function pythonCacheDir(env = process.env) {
  const asked = env.KOUBO_PYTHON_CACHE?.trim();
  if (asked) return asked;
  return join(env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache'), 'koubo-python');
}

/**
 * Locate an interpreter. Never throws because the file is missing: returns null
 * so the editor can start without Python (from-source, or a broken pack).
 *
 * Order: `KOUBO_PYTHON`, the packaged `runtime/python`, then (when
 * `allowSystem`) a `python3`/`python` on PATH.
 *
 * @param {{ env?: NodeJS.ProcessEnv, runtimeDir?: string | null, bundledDir?: string | null, pipeline?: string | null, platform?: string, allowSystem?: boolean, pathLookup?: (name: string) => string | null }} [options]
 * @returns {{ path: string, source: 'env' | 'bundled' | 'system', pipeline: string | null } | null}
 */
export function resolvePython({
  env = process.env,
  runtimeDir = null,
  bundledDir = runtimeDir ? join(runtimeDir, 'python') : null,
  pipeline = null,
  platform = process.platform,
  allowSystem = true,
  pathLookup = whichOnPath,
} = {}) {
  const resolvedPipeline = pipeline
    ?? (runtimeDir && existsSync(join(runtimeDir, 'adu', 'pipeline.py')) ? join(runtimeDir, 'adu', 'pipeline.py') : null)
    ?? (existsSync(join(defaultAduDir(), 'pipeline.py')) ? join(defaultAduDir(), 'pipeline.py') : null);
  const asked = env.KOUBO_PYTHON?.trim();
  if (asked && existsSync(asked)) return { path: asked, source: 'env', pipeline: resolvedPipeline };
  if (pythonIn(bundledDir, platform)) {
    return { path: pythonExecutable(bundledDir, platform), source: 'bundled', pipeline: resolvedPipeline };
  }
  if (allowSystem) {
    const system = pathLookup('python3') ?? pathLookup('python');
    if (system) return { path: system, source: 'system', pipeline: resolvedPipeline };
  }
  return null;
}

/**
 * Env vars for a child that should use the resolved interpreter. When none was
 * found, the base env is returned unchanged (no KOUBO_PYTHON).
 * @param {NodeJS.ProcessEnv} base
 * @param {{ path: string, pipeline?: string | null } | null} resolved
 * @param {{ pathSep?: string }} [options]
 */
export function pythonChildEnv(base, resolved, { pathSep = process.platform === 'win32' ? ';' : ':' } = {}) {
  if (!resolved) return { ...base };
  const bin = dirname(resolved.path);
  const path = [bin, base.PATH].filter(Boolean).join(pathSep);
  return {
    ...base,
    PATH: path,
    KOUBO_PYTHON: resolved.path,
    PYTHONNOUSERSITE: '1',
    ...(resolved.pipeline ? { KOUBO_ADU_PIPELINE: resolved.pipeline } : {}),
  };
}

/** Command line for the smoke check: `$KOUBO_PYTHON $KOUBO_ADU_PIPELINE doctor`. */
export function aduDoctorCommand(resolved) {
  if (!resolved?.path || !resolved.pipeline) return null;
  return { command: resolved.path, args: [resolved.pipeline, 'doctor'] };
}

/**
 * Download, extract, and provision a portable CPython into `runtimeDir/python`,
 * install the 阿杜 wheels, and copy the smoke-check scripts to `runtimeDir/adu`.
 * @param {string} runtimeDir
 * @param {{ platform?: string, arch?: string, aduDir?: string, fetch?: typeof fetch, pip?: typeof runPip, stallMs?: number, cacheDir?: string }} [options]
 */
export async function stagePythonRuntime(runtimeDir, {
  platform = process.platform,
  arch = process.arch,
  aduDir = defaultAduDir(),
  fetch: fetchImpl = fetch,
  pip = runPip,
  stallMs = STALL_MS,
  cacheDir = pythonCacheDir(),
  build = null,
} = {}) {
  const pythonDir = join(runtimeDir, 'python');
  await fetchPython(pythonDir, { platform, arch, fetch: fetchImpl, stallMs, cacheDir, build });
  await installAduRequirements(pythonDir, { platform, arch, aduDir, pip, cacheDir });
  stageAduScripts(runtimeDir, aduDir);
  writePythonNotices(pythonDir, platform, arch);
  assertStagedRuntime(runtimeDir, platform);
  maybeSmokeDoctor(runtimeDir, platform);
  return pythonDir;
}

/**
 * Download and extract the pinned CPython into `dir` (the python root).
 * @param {string} dir
 * @param {{ platform?: string, arch?: string, fetch?: typeof fetch, stallMs?: number, cacheDir?: string }} [options]
 */
export async function fetchPython(dir, {
  platform = process.platform,
  arch = process.arch,
  fetch: fetchImpl = fetch,
  stallMs = STALL_MS,
  cacheDir = pythonCacheDir(),
  build: buildOverride = null,
} = {}) {
  const key = buildKey(platform, arch);
  const build = buildOverride ?? PYTHON_BUILDS[key];
  if (!build) throw new Error(`There is no portable Python to download for ${key}: desktop installers only ship win-x64, mac-arm64 and mac-x64.`);
  if (pythonIn(dir, platform)) return dir;
  mkdirSync(cacheDir, { recursive: true });
  const archive = join(cacheDir, build.file);
  const url = `${BASE}/${build.file}`;
  const cached = existsSync(archive) && sha256File(archive) === build.sha256;
  if (!cached) {
    const bytes = await retried(async () => {
      const got = await download(url, fetchImpl, stallMs);
      if (createHash('sha256').update(got).digest('hex') !== build.sha256) {
        throw new Error('The Python runtime download did not match its checksum; nothing was kept.');
      }
      return got;
    });
    const part = `${archive}.part`;
    writeFileSync(part, bytes);
    try {
      rmSync(archive, { force: true });
      renameSync(part, archive);
    } catch (error) {
      rmSync(part, { force: true });
      throw error;
    }
  }
  extractTarGz(archive, dir);
  const exe = pythonExecutable(dir, platform);
  if (!existsSync(exe)) throw new Error(`The Python archive for ${key} did not contain ${exe}.`);
  if (platform !== 'win32') chmodSync(exe, 0o755);
  return dir;
}

/** Copy the smoke-check scripts beside the runtime (`runtime/adu`). */
export function stageAduScripts(runtimeDir, aduDir = defaultAduDir()) {
  const dest = join(runtimeDir, 'adu');
  mkdirSync(dest, { recursive: true });
  for (const name of ['pipeline.py', 'face_track.py', 'sfx.py', 'requirements-runtime.txt', 'LICENSE', 'README.md']) {
    const from = join(aduDir, name);
    if (!existsSync(from)) throw new Error(`Missing ${from} (the 阿杜 smoke-check files).`);
    cpSync(from, join(dest, name));
  }
  const dataDir = join(aduDir, 'data');
  const haar = join(dataDir, 'haarcascade_frontalface_default.xml');
  const yunet = join(dataDir, 'face_detection_yunet_2023mar.onnx');
  if (!existsSync(haar)) throw new Error(`Missing ${haar} (OpenCV Haar cascade).`);
  if (!existsSync(yunet)) throw new Error(`Missing ${yunet} (OpenCV YuNet face model).`);
  mkdirSync(join(dest, 'data'), { recursive: true });
  cpSync(haar, join(dest, 'data', 'haarcascade_frontalface_default.xml'));
  cpSync(yunet, join(dest, 'data', 'face_detection_yunet_2023mar.onnx'));
  const notice = join(dataDir, 'NOTICE.md');
  if (existsSync(notice)) cpSync(notice, join(dest, 'data', 'NOTICE.md'));
  return dest;
}

/**
 * Install requirements-runtime.txt into the staged interpreter. Always uses
 * host pip with `--platform`, `--only-binary=:all:` and `--target` (wheels
 * only), so a macOS 15 packer cannot pick OpenCV wheels that only run on
 * macOS 15, and so the Windows installer can be built on macOS.
 *
 * @param {string} dir
 * @param {{ platform?: string, arch?: string, aduDir?: string, pip?: typeof runPip, cacheDir?: string }} [options]
 */
export async function installAduRequirements(dir, {
  platform = process.platform,
  arch = process.arch,
  aduDir = defaultAduDir(),
  pip = runPip,
  cacheDir = pythonCacheDir(),
} = {}) {
  const key = buildKey(platform, arch);
  const build = PYTHON_BUILDS[key];
  if (!build) throw new Error(`There is no portable Python to provision for ${key}.`);
  const requirements = join(aduDir, 'requirements-runtime.txt');
  if (!existsSync(requirements)) throw new Error(`Missing ${requirements}.`);
  const pipCache = join(cacheDir, 'pip');
  mkdirSync(pipCache, { recursive: true });
  const env = { ...process.env, PIP_CACHE_DIR: pipCache, PYTHONNOUSERSITE: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
  const target = pythonSitePackages(dir, platform);
  mkdirSync(target, { recursive: true });
  const host = hostPython();
  pip([
    host, '-m', 'pip', 'install',
    '--no-compile',
    '--only-binary=:all:',
    `--python-version=${PYTHON_VERSION_TAG}`,
    '--implementation=cp',
    `--abi=${ABI}`,
    `--platform=${build.pipPlatform}`,
    '--target', target,
    '-r', requirements,
  ], { env });
}

/** Confirm the staged tree has an interpreter, the five packages, and the smoke script. */
export function assertStagedRuntime(runtimeDir, platform = process.platform) {
  const pythonDir = join(runtimeDir, 'python');
  if (!pythonIn(pythonDir, platform)) {
    throw new Error(`The staged Python runtime is missing its interpreter at ${pythonExecutable(pythonDir, platform)}.`);
  }
  const site = pythonSitePackages(pythonDir, platform);
  const missing = ADU_RUNTIME_PACKAGES.filter((name) => !packageInSite(site, name));
  if (missing.length) throw new Error(`The staged Python runtime is missing packages: ${missing.join(', ')}.`);
  if (!existsSync(join(runtimeDir, 'adu', 'pipeline.py'))) {
    throw new Error(`The staged runtime is missing ${join(runtimeDir, 'adu', 'pipeline.py')}.`);
  }
}

function packageInSite(site, name) {
  const dist = name.replace(/-/g, '_');
  if (!existsSync(site)) return false;
  return readdirSync(site).some((entry) => {
    const lower = entry.toLowerCase();
    return lower === name.toLowerCase()
      || lower === dist.toLowerCase()
      || lower.startsWith(`${dist.toLowerCase()}-`) && (lower.endsWith('.dist-info') || lower.endsWith('.data'));
  });
}

function writePythonNotices(dir, platform, arch) {
  const build = PYTHON_BUILDS[buildKey(platform, arch)];
  writeFileSync(join(dir, 'SOURCE'), PYTHON_SOURCE + `Archive: ${build.file}\nsha256: ${build.sha256}\n`);
  writeFileSync(join(dir, 'PACKAGES'), `${ADU_RUNTIME_PACKAGES.join('\n')}\n`);
}

function maybeSmokeDoctor(runtimeDir, platform) {
  const resolved = resolvePython({ runtimeDir, platform, allowSystem: false });
  const doctor = aduDoctorCommand(resolved);
  if (!doctor || !canRunPython(doctor.command)) return;
  execFileSync(doctor.command, doctor.args, { stdio: 'inherit', env: { ...process.env, PYTHONNOUSERSITE: '1' } });
}

export function canRunPython(exe) {
  if (!exe || !existsSync(exe)) return false;
  const result = spawnSync(exe, ['-c', 'import sys'], {
    stdio: 'ignore', timeout: 15_000, windowsHide: true, env: { ...process.env, PYTHONNOUSERSITE: '1' },
  });
  return !result.error && result.status === 0;
}

function hostPython() {
  const found = whichOnPath('python3') ?? whichOnPath('python');
  if (!found) throw new Error('Packaging Python wheels needs a host python3 with pip (to cross-install when the bundled interpreter cannot run here).');
  const check = spawnSync(found, ['-m', 'pip', '--version'], { stdio: 'ignore', timeout: 15_000, windowsHide: true });
  if (check.error || check.status !== 0) {
    throw new Error(`${found} has no pip; install pip on the packaging machine.`);
  }
  return found;
}

/** @param {string[]} argv @param {{ env?: NodeJS.ProcessEnv }} [options] */
export function runPip(argv, { env = process.env } = {}) {
  const [cmd, ...args] = argv;
  execFileSync(cmd, args, { stdio: 'inherit', env, windowsHide: true });
}

function whichOnPath(name) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8', timeout: 5_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  const line = (result.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line && existsSync(line) ? line : null;
}

function extractTarGz(archive, dest) {
  const tmp = mkdtempSync(join(tmpdir(), 'koubo-python-'));
  try {
    execFileSync('tar', ['-xzf', archive, '-C', tmp], { stdio: 'inherit' });
    const root = findPythonRoot(tmp);
    if (!root) throw new Error(`The Python archive did not contain a python root (looked in ${tmp}).`);
    mkdirSync(dirname(dest), { recursive: true });
    rmSync(dest, { recursive: true, force: true });
    /* verbatimSymlinks: Node's default copy rewrites relative links
       (python3 -> python3.12 in python-build-standalone) to absolute
       paths under tmp, which break once this temp tree is deleted. */
    cpSync(root, dest, { recursive: true, verbatimSymlinks: true });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function findPythonRoot(dir) {
  if (existsSync(join(dir, 'python.exe')) || existsSync(join(dir, 'bin', 'python3'))) return dir;
  const python = join(dir, 'python');
  if (existsSync(join(python, 'python.exe')) || existsSync(join(python, 'bin', 'python3'))) return python;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findPythonRoot(join(dir, entry.name));
    if (found) return found;
  }
  return null;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function download(url, fetchImpl, stallMs, onSize = () => {}, onBytes = () => {}) {
  const stop = new AbortController();
  let timer = setTimeout(() => stop.abort(), stallMs);
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => stop.abort(), stallMs); };
  try {
    const res = await fetchImpl(url, { signal: stop.signal });
    if (!res.ok || !res.body) throw new Error(`Downloading ${url.split('/').pop()} failed (${res.status}).`);
    onSize(Number(res.headers.get('content-length')) || 0);
    const chunks = [];
    for await (const chunk of res.body) {
      alive();
      chunks.push(chunk);
      onBytes(chunk.length);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (stop.signal.aborted) throw new Error(`Downloading ${url.split('/').pop()} stalled.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function retried(attempt) {
  for (let i = 1; ; i++) {
    try { return await attempt(); } catch (error) { if (i >= TRIES) throw error; }
  }
}
