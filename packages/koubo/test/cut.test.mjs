import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { buildFilterComplex, cutMedia, writeConcatList } from '../src/cut.mjs';

test('buildFilterComplex concatenates keep ranges for A/V', () => {
  const filter = buildFilterComplex([{ start: 0, end: 0.5 }, { start: 1.5, end: 2 }], { hasVideo: true, hasAudio: true });
  assert.match(filter, /trim=start=0\.000000:end=0\.500000/);
  assert.match(filter, /atrim=start=1\.500000:end=2\.000000/);
  assert.match(filter, /concat=n=2:v=1:a=1\[v\]\[a\]/);
});

test('writeConcatList emits inpoint/outpoint pairs', () => {
  const list = writeConcatList([{ start: 1, end: 2 }], '/tmp/a.mp4');
  assert.match(list, /inpoint 1\.000000/);
  assert.match(list, /outpoint 2\.000000/);
});

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || String(code))));
  });
}

test('cutMedia keeps the selected ranges of a short synthetic clip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-cut-test-'));
  const src = join(dir, 'src.mp4');
  const out = join(dir, 'out.mp4');
  try {
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=3:r=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', src,
    ]);
    await cutMedia({
      input: src,
      output: out,
      keeps: [{ start: 0, end: 0.5 }, { start: 2.0, end: 2.5 }],
    });
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', out]);
    const dur = parseFloat(stdout);
    assert.ok(dur > 0.85 && dur < 1.25, `expected ~1s, got ${dur}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
