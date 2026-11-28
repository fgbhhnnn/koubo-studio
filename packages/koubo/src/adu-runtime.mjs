/**
 * Call the packaged 阿杜 Python pipeline from ingest/buildProject.
 * Failures are returned, never thrown into the talking-head path.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUnitCues, remapClipCues } from '@koubo/templates';
import { resolveKouboPython, pipelineCommand } from './python.mjs';

const CLASSIC_UNITS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'classic-performance', 'units');

function run(command, args, { timeout = 180_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, PYTHONNOUSERSITE: '1' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

export async function prepareTalkFace({ cleanVideo, outDir, env, sampleFps = 8 } = {}) {
  const resolved = resolveKouboPython({ env });
  const cmd = pipelineCommand(resolved, [
    'prepare-talk',
    '--video', cleanVideo,
    '--out', outDir,
    '--sample-fps', String(sampleFps),
    '--fps', '60',
  ]);
  if (!cmd) return { ok: false, reason: 'no-python', track: null };
  const result = await run(cmd.command, cmd.args, { env, timeout: 240_000 });
  const facePath = join(outDir, 'face.json');
  if (!result.ok || !existsSync(facePath)) {
    return { ok: false, reason: 'prepare-talk-failed', track: null };
  }
  const track = JSON.parse(await readFile(facePath, 'utf8'));
  return { ok: true, reason: track.mode || 'ok', track, source: resolved.source };
}

export async function loadUnitCues(unitId) {
  const file = join(CLASSIC_UNITS, `${unitId}.js`);
  if (!existsSync(file)) return [];
  return parseUnitCues(await readFile(file, 'utf8'));
}

export async function remapUnitsSfx(clips) {
  const events = [];
  const cache = new Map();
  for (const clip of clips || []) {
    if (!cache.has(clip.unitId)) cache.set(clip.unitId, await loadUnitCues(clip.unitId));
    events.push(...remapClipCues(clip, cache.get(clip.unitId)));
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

export async function mixUnitSfx({ events, duration, outPath, env } = {}) {
  const resolved = resolveKouboPython({ env });
  if (!events?.length) return { ok: false, reason: 'no-cues' };
  const cmdProbe = pipelineCommand(resolved, ['mix-sfx']);
  if (!cmdProbe) return { ok: false, reason: 'no-python' };
  const cuesPath = join(dirname(outPath), 'unit-sfx-cues.json');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(cuesPath, JSON.stringify({ duration, events }, null, 2) + '\n', 'utf8');
  const cmd = pipelineCommand(resolved, ['mix-sfx', '--cues', cuesPath, '--out', outPath]);
  const result = await run(cmd.command, cmd.args, { env, timeout: 120_000 });
  if (!result.ok || !existsSync(outPath)) return { ok: false, reason: 'mix-sfx-failed' };
  return { ok: true, reason: 'ok', path: outPath, events: events.length };
}

export { resolveKouboPython, pipelineCommand };
