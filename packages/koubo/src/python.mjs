/**
 * Locate the portable 阿杜 Python runtime for CLI and ingest.
 *
 * Order: KOUBO_PYTHON, then the packaged / repo `runtime/python`, then
 * python3/python on PATH. Never throws when Python is missing — callers must
 * fall back. Reads no Electron APIs and never prints secrets.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_RUNTIME = join(HERE, '..', '..', '..', 'apps', 'desktop', 'runtime');
const REPO_PIPELINE = join(REPO_RUNTIME, 'adu', 'pipeline.py');

function whichOnPath(name, env = process.env) {
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const ext = process.platform === 'win32' && !/\.[A-Za-z0-9]+$/.test(name) ? '.exe' : '';
  const wanted = ext && !name.endsWith(ext) ? name + ext : name;
  for (const dir of String(env.PATH || '').split(pathSep)) {
    if (!dir) continue;
    const candidate = join(dir, wanted);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function pythonExecutable(dir, platform = process.platform) {
  return platform === 'win32' ? join(dir, 'python.exe') : join(dir, 'bin', 'python3');
}

function pythonIn(dir, platform = process.platform) {
  return Boolean(dir) && existsSync(pythonExecutable(dir, platform));
}

function pipelineBeside(pythonPath) {
  if (!pythonPath) return null;
  const needle = `${join('runtime', 'python')}`;
  const runtimeRoot = pythonPath.includes(needle)
    ? pythonPath.slice(0, pythonPath.indexOf(needle)) + 'runtime'
    : null;
  if (runtimeRoot && existsSync(join(runtimeRoot, 'adu', 'pipeline.py'))) {
    return join(runtimeRoot, 'adu', 'pipeline.py');
  }
  return null;
}

function pickPipeline(env, pythonPath = null) {
  const asked = env.KOUBO_ADU_PIPELINE?.trim();
  if (asked && existsSync(asked)) return asked;
  if (existsSync(REPO_PIPELINE)) return REPO_PIPELINE;
  return pipelineBeside(pythonPath);
}

function bundledRoots(env) {
  const roots = [];
  const askedPipeline = env.KOUBO_ADU_PIPELINE?.trim();
  if (askedPipeline && existsSync(askedPipeline)) {
    roots.push(join(dirname(askedPipeline), '..'));
  }
  roots.push(REPO_RUNTIME);
  return roots;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, allowSystem?: boolean, platform?: string }} [opts]
 * @returns {{ path: string, source: 'env' | 'bundled' | 'system', pipeline: string | null } | null}
 */
export function resolveKouboPython(opts = {}) {
  const env = opts.env || process.env;
  const allowSystem = opts.allowSystem !== false;
  const platform = opts.platform || process.platform;

  const asked = env.KOUBO_PYTHON?.trim();
  if (asked && existsSync(asked)) {
    return { path: asked, source: 'env', pipeline: pickPipeline(env, asked) };
  }

  for (const root of bundledRoots(env)) {
    const dir = join(root, 'python');
    if (pythonIn(dir, platform)) {
      return {
        path: pythonExecutable(dir, platform),
        source: 'bundled',
        pipeline: pickPipeline(env) || (existsSync(join(root, 'adu', 'pipeline.py')) ? join(root, 'adu', 'pipeline.py') : null),
      };
    }
  }

  if (allowSystem) {
    const system = whichOnPath('python3', env) ?? whichOnPath('python', env);
    if (system) return { path: system, source: 'system', pipeline: pickPipeline(env, system) };
  }
  return null;
}

export function pipelineCommand(resolved, args) {
  if (!resolved?.path || !resolved.pipeline) return null;
  return { command: resolved.path, args: [resolved.pipeline, ...args] };
}
