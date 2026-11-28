import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assignUnits,
  loadUnitsManifest,
  fillUnitSlots,
  mapUnitClock,
  sourceTimeAt,
  unitBounds,
  classifyBeat,
  splitSentences,
  sceneById,
  bindAuthoredBlock,
  sha256Utf8,
  jsContent,
  CLASSIC_PACK_DIR,
} from '../index.mjs';

const manifest = loadUnitsManifest();

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

function talkingPlan() {
  const claim = wordsFrom('说实话，这个速度我自己都没有想到。AI赛道真的是这个时代每个人都该抓住的机会。', 0.2, 16.2);
  const decompose = wordsFrom('首先把选题拆成三步，第一是找到痛点，第二是讲清方法，第三是给出对照。', 16.5, 33.8);
  const evidence = wordsFrom('比如你看这三条视频的实际效果，涨粉和变现都比之前更稳。', 34.1, 51.0);
  const words = [...claim, ...decompose, ...evidence];
  return { words, cleanDuration: 51, template: { id: 'classic-performance', source: 'user' } };
}

test('classifyBeat distinguishes claim, decompose and evidence phrasing', () => {
  assert.equal(classifyBeat('说实话，这个速度我自己都没有想到'), 'claim-into-container');
  assert.equal(classifyBeat('首先把选题拆成三步，第一是痛点'), 'decompose-and-consolidate');
  assert.equal(classifyBeat('比如你看这三条视频的实际效果'), 'evidence-focus');
});

test('assignUnits places enabled, non-overlapping units across a film', () => {
  const { clips, skipped } = assignUnits(talkingPlan());
  assert.equal(skipped, null);
  assert.ok(clips.length >= 3, `expected at least 3 clips, got ${clips.length}`);
  const ids = clips.map((c) => c.unitId);
  assert.ok(ids.includes('claim-into-container'));
  assert.ok(ids.includes('decompose-and-consolidate'));
  assert.ok(ids.includes('evidence-focus'));
  let t = 0;
  for (const clip of clips) {
    assert.ok(clip.at >= t - 1e-9, `${clip.id} overlaps previous`);
    assert.ok(clip.duration >= 13.9, `${clip.id} shorter than protected windows`);
    const bounds = unitBounds(sceneById(manifest, clip.unitId));
    assert.ok(clip.duration <= bounds.maxDuration + 1e-6);
    t = clip.at + clip.duration;
    assert.ok(clip.slots['text-01']);
    assert.notEqual(clip.slots['text-01'], sceneById(manifest, clip.unitId).slots.find((s) => s.id === 'text-01').sourceText);
  }
  assert.ok(clips[0].at < 0.5, 'first unit should start at the opening');
  assert.ok(t <= 51 + 1e-6);
});

test('a short film does not get a stub unit', () => {
  const words = wordsFrom('你好。', 0, 2);
  const { clips, skipped } = assignUnits({ words, cleanDuration: 2, template: { id: 'classic-performance' } });
  assert.deepEqual(clips, []);
  assert.equal(skipped, 'too-short');
});

test('mapUnitClock keeps action windows at 1x and only holds or shrinks gaps', () => {
  const scene = sceneById(manifest, 'claim-into-container');
  const bounds = unitBounds(scene);
  const native = mapUnitClock(scene, bounds.native);
  const mid = bounds.native / 2;
  assert.ok(Math.abs(sourceTimeAt(native, mid) - (bounds.sourceStart + mid)) < 1e-6);

  const held = mapUnitClock(scene, bounds.native + 4);
  assert.equal(held.duration, bounds.native + 4);
  const freeze = sourceTimeAt(held, bounds.native + 2);
  assert.ok(Math.abs(freeze - (bounds.sourceEnd - 1e-4)) < 1e-6, `hold should freeze near source end, got ${freeze}`);
  // An action window keeps its output length.
  const first = scene.motionWindows[0];
  const actionOut = held.segments.find((s) => s.type === 'action');
  assert.ok(actionOut);
  assert.ok(Math.abs((actionOut.out1 - actionOut.out0) - (first.end - first.start)) < 1e-6);

  const shorter = mapUnitClock(scene, bounds.minDuration);
  for (const seg of shorter.segments) {
    if (seg.type === 'action') {
      assert.ok(Math.abs((seg.out1 - seg.out0) - (seg.src1 - seg.src0)) < 1e-6);
    } else {
      assert.ok((seg.out1 - seg.out0) <= (seg.src1 - seg.src0) + 1e-6);
    }
  }
});

test('bindAuthoredBlock replaces reviewed spans and rejects pack copy', async () => {
  const scene = sceneById(manifest, 'claim-into-container');
  const source = await readFile(join(CLASSIC_PACK_DIR, 'units', 'claim-into-container.js'), 'utf8');
  assert.equal(sha256Utf8(source), scene.sourceBlockSha256);

  const filled = fillUnitSlots(scene, talkingPlan().words.slice(0, 80), { chapter: '01', label: '开场主张' });
  const { block } = bindAuthoredBlock(source, scene, filled.values, 'unit-01');
  assert.notEqual(block, source);
  assert.match(block, /开场主张|本期|速度|机会/);
  assert.doesNotMatch(block, /公开蒸馏/);
  assert.doesNotMatch(block, /adu-motion-video/);

  assert.throws(
    () => bindAuthoredBlock(source, scene, { 'text-01': '公开蒸馏' }, 'unit-01'),
    /replace the source placeholder/,
  );
  assert.throws(
    () => bindAuthoredBlock(source + ' ', scene, filled.values, 'unit-01'),
    /source block hash/,
  );
});

test('jsContent escapes HTML and JS string metacharacters', () => {
  assert.equal(jsContent('a < b & "c"', true), 'a &lt; b &amp; &quot;c&quot;');
  assert.equal(jsContent("it's $", false), "it\\'s \\u0024");
});

test('source spans use Unicode code points, including non-BMP text in a synthetic block', () => {
  const text = '前😀后';
  const scene = {
    sourceBlockSha256: sha256Utf8(text),
    slots: [
      {
        id: 'text-00',
        type: 'text',
        sourceText: '😀',
        sourceSpans: [{ start: 1, end: 2, renderContext: 'text' }],
        mustChange: true,
        renderContext: 'text',
      },
    ],
  };
  const { block } = bindAuthoredBlock(text, scene, { 'text-00': '✨' }, 'emoji');
  assert.equal(block, '前✨后');
});

test('splitSentences breaks on punctuation and pauses', () => {
  const words = [
    ...wordsFrom('今天开讲。', 0, 1),
    ...wordsFrom('然后继续', 2, 2.8),
  ];
  const sents = splitSentences(words);
  assert.equal(sents.length, 2);
});
test('a long film without keywords still cycles all three units', () => {
  const chunks = [
    '今天我想跟大家聊一聊最近在做的这件事，它花了不少时间，也让我学到很多。',
    '接下来把这件事分成几个阶段慢慢讲清楚，每一步都对应一个可以跟着做的动作。',
    '后面这段会把过程里看到的结果拿出来对照，看看前后有什么变化。',
    '讲完这些，再回到最开始那个问题，看看现在能不能回答得更清楚。',
    '如果这些经验对你有用，你也可以按同样的节奏试一次，再根据自己的情况调整。',
  ];
  const words = [];
  let t0 = 0.2;
  for (const text of chunks) {
    words.push(...wordsFrom(text, t0, t0 + 16.8));
    t0 += 17.2;
  }
  const { clips } = assignUnits({ words, cleanDuration: t0, template: { id: 'classic-performance' } });
  assert.ok(clips.length >= 3, `got ${clips.length} clips`);
  const ids = new Set(clips.map((c) => c.unitId));
  assert.ok(ids.has('claim-into-container'));
  assert.ok(ids.has('decompose-and-consolidate'));
  assert.ok(ids.has('evidence-focus'));
});
