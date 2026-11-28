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
    units: [{ id: 'unit-01', unitId: 'claim-into-container', at: 0, duration: 15.466 }],
  });
  assert.match(html, /<meta name="viewport" content="width=1920, height=1080">/);
  assert.match(html, /<video id="talk" src="assets\/talking-clean\.mp4#t=0,12\.5000"/);
  assert.match(html, /<iframe id="captions" src="scenes\/captions\.html#t=0,12\.5000"/);
  assert.match(html, /size="1920x320"/);
  assert.match(html, /<iframe id="illus-1" src="scenes\/illus-1.html#t=0,4.0000"/);
  assert.match(html, /size="960x600"/);
  assert.match(html, /<iframe id="unit-01" src="scenes\/unit-01.html#t=0,15.4660"/);
  assert.match(html, /size="1920x1080"/);
  assert.doesNotMatch(html, /classic-unit\.html/);
  assert.doesNotMatch(html, /<audio/);
  assert.doesNotMatch(html, /\bdisabled\b/);
  assert.doesNotMatch(html, /<section hidden>/);
});

test('captions page exposes window.film.frame(t) and duration', () => {
  const html = __test__.renderCaptionsPage({
    title: '测试片',
    duration: 8,
    words: [{ text: '你好', start: 0.2, end: 0.8 }],
    width: 1920,
    height: 320,
  });
  assert.match(html, /window\.film = \{ duration: DATA\.duration, width: DATA\.width, height: DATA\.height, frame \}/);
  assert.match(html, /"width":1920/);
  assert.match(html, /"height":320/);
  assert.match(html, /"text":"你好"/);
  assert.match(html, /function paint\(i\)/);
  assert.doesNotMatch(html, /DATA\.words\.forEach/);
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
    assert.match(captions, /width: DATA\.width, height: DATA\.height/);
    assert.match(film, /size="1920x320"/);
    const illus = await readFile(join(out, 'scenes', 'illustration.html'), 'utf8').catch(() => '');
    const illusPage = await readFile(join(out, 'scenes', (result.illustrations?.[0]?.id || 'illus-1') + '.html'), 'utf8').catch(() => '');
    if (illusPage) assert.match(illusPage, /width: 960, height: 600/);
    const writtenPlan = JSON.parse(await readFile(join(out, 'koubo', 'plan.json'), 'utf8'));
    assert.ok(Array.isArray(writtenPlan.keeps));
    const filmNoStub = film;
    assert.doesNotMatch(filmNoStub, /classic-unit\.html/);
    assert.doesNotMatch(filmNoStub, /\bdisabled\b/);
    const units = JSON.parse(await readFile(join(out, 'koubo', 'units.json'), 'utf8'));
    assert.equal(units.length, 0, 'a 2s stub is too short for a classic unit');
    const workflow = JSON.parse(await readFile(join(out, 'koubo', 'workflow.json'), 'utf8'));
    assert.equal(workflow.unitCount, 0);
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


test('groupCaptionLines breaks on punctuation, pauses and width, and skips non-speech tokens', () => {
  const { groupCaptionLines, captionCharUnits } = __test__;
  assert.ok(captionCharUnits('讲') >= 1);
  assert.ok(captionCharUnits('AI') < captionCharUnits('方法'));

  const words = [
    { text: '[音效]', start: 0, end: 0.3 },
    { text: '今天', start: 0.4, end: 0.7 },
    { text: '我们', start: 0.75, end: 1.0 },
    { text: '开讲。', start: 1.05, end: 1.4 },
    { text: '然后', start: 2.2, end: 2.5 },
    { text: '继续', start: 2.55, end: 2.9 },
  ];
  const lines = groupCaptionLines(words);
  assert.equal(lines.length, 2, 'hard stop then a pause should make two lines');
  assert.equal(lines[0].words.map((w) => w.text).join(''), '今天我们开讲。');
  assert.equal(lines[1].words.map((w) => w.text).join(''), '然后继续');
  assert.ok(!lines.some((line) => line.words.some((w) => w.text === '[音效]')));

  const long = [];
  const chars = '把每天重复的工作打包一起丢给人工智能助手去处理完毕之后再检查结果';
  let t = 0;
  for (const ch of chars) {
    long.push({ text: ch, start: t, end: t + 0.12 });
    t += 0.13;
  }
  const packed = groupCaptionLines(long);
  assert.ok(packed.length >= 2, 'a long run without punctuation still wraps before overflowing the bar');
  for (const line of packed) {
    const units = line.words.reduce((n, w) => n + captionCharUnits(w.text), 0);
    assert.ok(units <= 24 + 1e-9, `line too wide: ${line.words.map((w) => w.text).join('')} (${units})`);
  }
});

test('captionLineAt shows the spoken line at t, not the closing line', () => {
  const { groupCaptionLines, captionLineAt } = __test__;
  const words = [];
  const early = '就拿我自己来说上个月收益来源于三条路第一条是付费咨询。';
  const closing = '干中学才是普通人追上这个时代最快的方法。';
  let t = 0;
  for (const ch of early) {
    words.push({ text: ch, start: t, end: t + 0.16 });
    t += 0.18;
  }
  // gap, then a late closing sentence around 250s
  t = 250;
  for (const ch of closing) {
    words.push({ text: ch, start: t, end: t + 0.16 });
    t += 0.18;
  }
  const lines = groupCaptionLines(words);
  const atSpoken = 21;
  const i = captionLineAt(lines, atSpoken, 270);
  assert.ok(i >= 0);
  const textAt = lines[i].words.map((w) => w.text).join('');
  assert.match(textAt, /三条路|付费咨询|收益|自己来说/);
  assert.doesNotMatch(textAt, /干中学|最快的方法/);
  const last = captionLineAt(lines, 252, 270);
  const textLast = lines[last].words.map((w) => w.text).join('');
  assert.match(textLast, /干中学|最快的方法/);
  assert.ok(i !== last);
});

test('renderCaptionsPage only paints the current line and declares its own size', () => {
  const { renderCaptionsPage, groupCaptionLines, captionLineAt } = __test__;
  const early = '三条路，第一条是付费咨询。';
  const closing = '干中学才是普通人追上这个时代最快的方法。';
  const words = [];
  let t = 18;
  for (const ch of early) {
    words.push({ text: ch, start: t, end: t + 0.16 });
    t += 0.2;
  }
  t = 250;
  for (const ch of closing) {
    words.push({ text: ch, start: t, end: t + 0.16 });
    t += 0.2;
  }
  const html = renderCaptionsPage({ title: '测试片', duration: 270, words, width: 1920, height: 320 });
  assert.match(html, /window\.film = \{ duration: DATA\.duration, width: DATA\.width, height: DATA\.height, frame \}/);
  assert.match(html, /"width":1920,"height":320/);
  // The page script rebuilds #bar from one DATA.lines[i]; it must not mount every word up front.
  assert.match(html, /bar\.replaceChildren\(\)/);
  assert.match(html, /DATA\.lines\[i\]\.words\.forEach/);
  const lines = groupCaptionLines(words);
  const i = captionLineAt(lines, 21, 270);
  const spoken = lines[i].words.map((w) => w.text).join('');
  assert.match(spoken, /付费咨询|三条路|第一条/);
  assert.doesNotMatch(spoken, /干中学/);
  // DATA keeps every line for seeking, but each token is its own JSON string.
  assert.match(html, /"text":"付"/);
  assert.match(html, /"text":"干"/);
});

function wordsFrom(text, start, end) {
  const chars = [...text];
  const dt = (end - start) / chars.length;
  return chars.map((ch, i) => ({
    text: ch,
    start: Number((start + i * dt).toFixed(4)),
    end: Number((start + (i + 1) * dt).toFixed(4)),
    type: 'word',
  }));
}

test('buildProject writes enabled unit clips timed to a long talking-head plan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-units-proj-'));
  const video = join(dir, 'clean.mp4');
  try {
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=52:r=25',
      '-f', 'lavfi', '-i', 'sine=frequency=330:duration=52',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', video,
    ]);
    const words = [
      ...wordsFrom('说实话，这个速度我自己都没有想到。AI赛道真的是这个时代每个人都该抓住的机会。', 0.2, 16.2),
      ...wordsFrom('首先把选题拆成三步，第一是找到痛点，第二是讲清方法，第三是给出对照。', 16.5, 33.8),
      ...wordsFrom('比如你看这三条视频的实际效果，涨粉和变现都比之前更稳。', 34.1, 51.0),
    ];
    const plan = {
      words,
      sourceDuration: 51,
      cleanDuration: 51,
      sourceWordCount: words.length,
      cleanWordCount: words.length,
      keeps: [{ start: 0, end: 51 }],
      deletes: [],
      needsReview: false,
      template: { id: 'classic-performance', source: 'user' },
    };
    const out = join(dir, 'project');
    const result = await buildProject({
      outDir: out,
      title: '单位工程',
      cleanVideo: video,
      plan,
      templateId: 'classic-performance',
      templateSource: 'user',
      imageGenerator: async () => null,
    });
    assert.ok(result.units.length >= 3, `expected >=3 units, got ${result.units.length}`);
    const film = await readFile(result.film, 'utf8');
    assert.match(film, /id="captions"/);
    assert.match(film, /size="1920x320"/);
    assert.match(film, /id="unit-01"/);
    assert.doesNotMatch(film, /\bdisabled\b/);
    assert.doesNotMatch(film, /<section hidden>/);
    assert.doesNotMatch(film, /classic-unit\.html/);
    const captions = await readFile(join(out, 'scenes', 'captions.html'), 'utf8');
    assert.match(captions, /bar\.replaceChildren\(\)/);
    assert.match(captions, /"width":1920,"height":320/);
    const page = await readFile(join(out, 'scenes', 'unit-01.html'), 'utf8');
    assert.match(page, /window\.film/);
    assert.match(page, /hideOfficialBadge: true/);
    assert.match(page, /showOfficialBadge: false/);
    assert.doesNotMatch(page, /公开蒸馏/);
    assert.match(page, /function mapSource/);
    const unitIds = result.units.map((u) => u.unitId);
    assert.ok(unitIds.includes('claim-into-container'));
    assert.ok(unitIds.includes('decompose-and-consolidate'));
    assert.ok(unitIds.includes('evidence-focus'));
    const original = await readFile(join(CLASSIC_PACK_DIR, 'units', 'claim-into-container.js'), 'utf8');
    const copied = await readFile(join(out, 'scenes', 'classic-runtime', 'units', 'claim-into-container.js'), 'utf8');
    assert.equal(copied, original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
