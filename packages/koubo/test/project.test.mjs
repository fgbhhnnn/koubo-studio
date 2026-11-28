import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { planCuts } from '../src/plan.mjs';
import { buildProject, __test__ } from '../src/project.mjs';
import { readFile as read } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSIC_PACK_DIR } from '@koubo/templates';

const fixture = JSON.parse(await read(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript.json'), 'utf8'));

test('renderFilmHtml has viewport, talk clip, captions page and no in-page audio', () => {
  const html = __test__.renderFilmHtml({
    title: '测试片',
    width: 1920,
    height: 1080,
    duration: 12.5,
    talkRel: 'assets/talking-clean.mp4',
    illustrations: [{ id: 'illus-1', at: 2, duration: 4, src: 'assets/illustrations/illus-1.svg', prompt: '方法' }],
    hasClassic: true,
  });
  assert.match(html, /<meta name="viewport" content="width=1920, height=1080">/);
  assert.match(html, /<video id="talk" src="assets\/talking-clean\.mp4#t=0,12\.5000"/);
  assert.match(html, /<iframe id="captions" src="scenes\/captions\.html#t=0,12\.5000"/);
  assert.match(html, /<iframe id="illus-1" src="scenes\/illus-1.html#t=0,4.0000"/);
  assert.match(html, /classic-unit\.html/);
  assert.doesNotMatch(html, /<audio/);
  assert.match(html, /disabled/);
});

test('captions page exposes window.film.frame(t) and duration', () => {
  const html = __test__.renderCaptionsPage({
    title: '测试片',
    duration: 8,
    words: [{ text: '你好', start: 0.2, end: 0.8 }],
    width: 1920,
    height: 320,
  });
  assert.match(html, /window\.film = \{ duration: DATA\.duration, frame \}/);
  assert.match(html, /"text":"你好"/);
});

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || String(code))));
  });
}

test('buildProject writes film.html, captions, illustration slot and plan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-proj-'));
  const video = join(dir, 'clean.mp4');
  try {
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=2:r=25',
      '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', video,
    ]);
    const plan = planCuts(fixture, { duration: 16 });
    // Use a short clean duration matching the stub video so the film is consistent in tests
    const shortPlan = { ...plan, cleanDuration: 2, words: (plan.words || []).filter((w) => w.start < 2) };
    const out = join(dir, 'project');
    const result = await buildProject({ outDir: out, title: '单测工程', cleanVideo: video, plan: shortPlan });
    const film = await readFile(result.film, 'utf8');
    assert.match(film, /id="talk"/);
    assert.match(film, /id="captions"/);
    assert.match(film, /scenes\/captions\.html/);
    const captions = await readFile(join(out, 'scenes', 'captions.html'), 'utf8');
    assert.match(captions, /window\.film/);
    assert.match(captions, /function frame\(t\)/);
    const writtenPlan = JSON.parse(await readFile(join(out, 'koubo', 'plan.json'), 'utf8'));
    assert.ok(Array.isArray(writtenPlan.keeps));
    const classic = await readFile(join(out, 'scenes', 'classic-unit.html'), 'utf8');
    assert.match(classic, /window\.film/);
    assert.match(classic, /renderAt/);
    assert.match(classic, /hideOfficialBadge/);
    const unitName = 'claim-into-container.js';
    const copied = await readFile(join(out, 'scenes', 'classic-runtime', 'units', unitName), 'utf8');
    const original = await readFile(join(CLASSIC_PACK_DIR, 'units', unitName), 'utf8');
    assert.equal(copied, original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('copyPackFiles copies unit files with copyFile and project.mjs does not call fs.promises.cp', async () => {
  const srcText = await readFile(new URL('../src/project.mjs', import.meta.url), 'utf8');
  const importLine = srcText.split('\n').find((line) => line.includes("from 'node:fs/promises'"));
  assert.ok(importLine, 'expected an fs/promises import');
  assert.doesNotMatch(importLine, /\bcp\b/);
  assert.doesNotMatch(srcText, /await\s+cp\s*\(/);
  assert.match(srcText, /await readdir\(/);
  assert.match(srcText, /await copyFile\(/);

  const dir = await mkdtemp(join(tmpdir(), 'koubo-units-'));
  try {
    const src = join(dir, 'units');
    const dest = join(dir, 'out', 'units');
    await mkdir(join(src, 'nested'), { recursive: true });
    await writeFile(join(src, 'claim-into-container.js'), 'export const unit = 1;\n');
    await writeFile(join(src, 'nested', 'extra.js'), 'export const extra = 2;\n');
    await __test__.copyPackFiles(src, dest);
    assert.equal(await readFile(join(dest, 'claim-into-container.js'), 'utf8'), 'export const unit = 1;\n');
    assert.equal(await readFile(join(dest, 'nested', 'extra.js'), 'utf8'), 'export const extra = 2;\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
