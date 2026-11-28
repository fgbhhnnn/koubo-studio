import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignUnits,
  loadUnitsManifest,
  fillUnitSlots,
  sceneById,
  sourceTimeAt,
  outputTimeAt,
  CLASSIC_PACK_DIR,
  alignSlotCopy,
  locatePhrase,
  mapSpeechClock,
  retimeAssignedClip,
  revealSourceTime,
  slotRevealsFor,
  assertSlotReveals,
} from '../index.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
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

test('reviewed typography reveal times still appear in the authored units', async () => {
  for (const scene of manifest.scenes) {
    const source = await readFile(join(CLASSIC_PACK_DIR, 'units', `${scene.id}.js`), 'utf8');
    assert.doesNotThrow(() => assertSlotReveals(scene, source));
    assert.ok(slotRevealsFor(scene).length > 0);
  }
});

test('locatePhrase finds a spoken span on the clean clock', () => {
  const words = wordsFrom('说实话，这个速度我自己都没有想到。', 3.64, 6.16);
  const hit = locatePhrase(words, '说实话，这个速度我自己都没有想到');
  assert.ok(hit);
  assert.ok(Math.abs(hit.start - 3.64) < 0.05, `start ${hit.start}`);
  assert.ok(hit.end <= 6.16 + 1e-6);
});

test('alignSlotCopy gives the first-revealed decompose title the first spoken clause', () => {
  const scene = sceneById(manifest, 'decompose-and-consolidate');
  const words = [
    ...wordsFrom('我的收益来源于三条路，第一条是付费咨询。', 15.6, 19.4),
    ...wordsFrom('第二条就是商单，像美团、剪映、豆。', 29.64, 33.0),
  ];
  const filled = fillUnitSlots(scene, words, { chapter: '02', label: '方法拆解' });
  const aligned = alignSlotCopy(scene, filled.values, words);
  assert.doesNotMatch(aligned['text-02'], /第二条就是商单/);
  assert.match(aligned['text-02'], /收益|三条路/);
});

test('mapSpeechClock does not reveal unit-01 “说实话…” 1.6s early', () => {
  const scene = sceneById(manifest, 'claim-into-container');
  const text = '做AI自媒体不到一个月，我竟然变现了四位数。说实话，这个速度我自己都没有想到。一共发了七条视频，涨了两千多个粉。';
  const words = [
    ...wordsFrom('做AI自媒体不到一个月，我竟然变现了四位数。', 0, 3.5),
    ...wordsFrom('说实话，这个速度我自己都没有想到。', 3.64, 6.16),
    ...wordsFrom('一共发了七条视频，涨了两千多个粉。', 6.26, 9.28),
  ];
  const filled = fillUnitSlots(scene, words, { chapter: '01', label: '开场主张' });
  const timed = retimeAssignedClip(scene, { words }, filled, 0, 15.6);
  const spoken = locatePhrase(words, '说实话，这个速度我自己都没有想到');
  assert.ok(spoken);
  const carriers = Object.entries(timed.values).filter(([, text]) => /说实话/.test(String(text)));
  assert.ok(carriers.length, 'expected a typography slot to carry 说实话…');
  for (const [id, text] of carriers) {
    const src = revealSourceTime(timed.reveals, id);
    if (src == null) continue;
    const when = outputTimeAt(timed.clock, src, 0);
    assert.ok(
      when >= spoken.start - 0.12,
      `slot ${id} (“${text}”) reveals at ${when?.toFixed(3)}s, spoken at ${spoken.start.toFixed(3)}s`,
    );
  }
  // The pack would have shown the original intro slot at 2.033s, 1.6s early.
  const introSrc = revealSourceTime(timed.reveals, 'text-03');
  const introOut = outputTimeAt(timed.clock, introSrc, 0);
  const introSpoken = locatePhrase(words, timed.values['text-03']);
  if (introSpoken && /说实话/.test(timed.values['text-03'])) {
    assert.ok(introOut > 2.5, `clock should have delayed 说实话 past 2.5s, got ${introOut}`);
  }
});

test('阿杜 opening sample: typography follows the spoken words, not the pack clock', async () => {
  const fixture = JSON.parse(await readFile(join(ROOT, 'fixtures', 'adu-opening-words.json'), 'utf8'));
  const { clips } = assignUnits({
    words: fixture.words,
    cleanDuration: fixture.cleanDuration,
    template: { id: 'classic-performance' },
  });
  const unit01 = clips.find((c) => c.id === 'unit-01');
  const unit02 = clips.find((c) => c.id === 'unit-02');
  assert.ok(unit01, 'expected unit-01');
  assert.ok(unit02, 'expected unit-02');
  assert.equal(unit01.unitId, 'claim-into-container');
  assert.equal(unit02.unitId, 'decompose-and-consolidate');

  const spokenHonest = locatePhrase(fixture.words, '说实话，这个速度我自己都没有想到');
  assert.ok(spokenHonest);
  assert.ok(Math.abs(spokenHonest.start - 3.64) < 0.05, `说实话 starts at ${spokenHonest.start}`);
  const honestSlots = Object.entries(unit01.slots).filter(([, text]) => /说实话/.test(String(text)));
  assert.ok(honestSlots.length, 'expected a unit-01 slot to carry 说实话…');
  for (const [id, text] of honestSlots) {
    const src = revealSourceTime(slotRevealsFor(sceneById(manifest, unit01.unitId)), id);
    if (src == null) continue;
    const when = outputTimeAt(unit01.clock, src, unit01.at);
    assert.ok(
      when >= spokenHonest.start - 0.15,
      `unit-01 slot ${id} (“${text}”) reveals at film ${when?.toFixed(3)}s but 说实话 is spoken at ${spokenHonest.start.toFixed(3)}s`,
    );
  }

  // unit-02 must not show “第二条就是商单…” at film 15.73s while he is
  // still saying “我的收益来源于三条路”.
  const leadText = unit02.slots['text-02'];
  assert.doesNotMatch(leadText, /第二条就是商单/);
  assert.match(leadText, /收益|三条路|我的/);

  const filmT = 15.73;
  const local = filmT - unit02.at;
  const srcAtStart = sourceTimeAt(unit02.clock, Math.max(0, local));
  // Any slot that actually carries “第二条就是商单” must reveal at/after that phrase is spoken (~29.64).
  const spokenSecond = locatePhrase(fixture.words, '第二条就是商单');
  assert.ok(spokenSecond);
  assert.ok(Math.abs(spokenSecond.start - 29.64) < 0.05, `fixture phrase start ${spokenSecond.start}`);
  for (const [id, text] of Object.entries(unit02.slots)) {
    if (!/第二条就是商单/.test(String(text))) continue;
    const src = revealSourceTime(slotRevealsFor(sceneById(manifest, unit02.unitId)), id);
    if (src == null) continue;
    const when = outputTimeAt(unit02.clock, src, unit02.at);
    assert.ok(
      when == null || when >= spokenSecond.start - 0.15,
      `slot ${id} (“${text}”) would reveal at film ${when}s, before “第二条就是商单” at ${spokenSecond.start}s`,
    );
    assert.ok(
      srcAtStart + 1e-9 < src || when >= spokenSecond.start - 0.15,
      `at film 15.73s the clock is already at pack ${srcAtStart}, which would show ${id}`,
    );
  }
});

test('mapSpeechClock keeps typography events in pack order on the output clock', () => {
  const scene = sceneById(manifest, 'claim-into-container');
  const words = [
    ...wordsFrom('做AI自媒体不到一个月。', 0, 1.76),
    ...wordsFrom('说实话这个速度我自己都没有想到。', 3.64, 6.16),
    ...wordsFrom('一共发了七条视频。', 6.26, 7.7),
    ...wordsFrom('就拿我自己来说上个月。', 13.72, 15.6),
  ];
  const filled = fillUnitSlots(scene, words, { chapter: '01', label: '开场主张' });
  const clock = mapSpeechClock(scene, 15.6, { words, values: filled.values, at: 0 });
  const reveals = slotRevealsFor(scene).filter((s) => s.kind !== 'label').sort((a, b) => a.src - b.src);
  let last = -1;
  for (const slot of reveals) {
    const t = outputTimeAt(clock, slot.src, 0);
    if (t == null) continue;
    assert.ok(t >= last - 1e-9, `pack ${slot.src} mapped to ${t}, before previous ${last}`);
    last = t;
  }
});
