import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planCuts,
  normalizeWords,
  keepRangesFromDeletes,
  mapSourceTimeToClean,
  mapWordsToClean,
  groupSentences,
  similarity,
} from '../src/plan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(join(here, 'fixtures', 'transcript.json'), 'utf8'));
const messy = JSON.parse(await readFile(join(here, 'fixtures', 'transcript-messy.json'), 'utf8'));

test('normalizeWords drops spacing and keeps word timestamps', () => {
  const words = normalizeWords(fixture);
  assert.equal(words.some((w) => w.type === 'spacing' || w.text === ' '), false);
  assert.equal(words[0].text, '嗯');
  assert.ok(words.length < fixture.words.length);
});

test('0.3–0.5s natural pauses stay in a keep range', () => {
  const plan = planCuts({
    audio_duration_secs: 4,
    words: [
      { text: '先', start: 0.2, end: 0.4, type: 'word' },
      { text: '把', start: 0.75, end: 0.95, type: 'word' },
      { text: '方法', start: 1.30, end: 1.70, type: 'word' },
      { text: '讲完。', start: 2.05, end: 2.50, type: 'word' },
    ],
  }, { duration: 4 });
  // gaps are 0.35s — all natural, none should be cut between words
  const mid = plan.deletes.filter((d) => d.start >= 0.2 && d.end <= 2.5);
  assert.equal(mid.length, 0);
  assert.ok(plan.keeps.some((k) => k.start <= 0.2 && k.end >= 2.5) || (plan.keeps[0].start <= 0.2 && plan.keeps[plan.keeps.length - 1].end >= 2.5));
  // a single keep should cover the whole spoken span
  const spoken = plan.keeps.filter((k) => k.end > 0.2 && k.start < 2.5);
  assert.equal(spoken.length, 1);
  assert.match(plan.cleanTranscript, /先把方法讲完/);
});

test('fills 嗯/啊/呃 are deleted, repeated 这个 keeps one, repeated sentence drops the first', () => {
  const plan = planCuts(fixture, { duration: 16 });
  const events = plan.deleteEvents || plan.deletes;
  const texts = (reason) => events.filter((d) => String(d.reason).includes(reason) || d.kind === reason).map((d) => d.text || '');
  assert.ok(texts('filler').some((t) => t.includes('嗯')));
  assert.ok(texts('filler').some((t) => t.includes('啊')));
  assert.ok(texts('filler').some((t) => t.includes('呃')));
  assert.ok(events.some((d) => String(d.reason).includes('repeat-word') && String(d.text).includes('这个')));
  assert.ok(events.some((d) => String(d.reason).includes('repeat-sentence')));
  assert.match(plan.cleanTranscript, /今天我们来讲这个方法/);
  assert.equal(plan.cleanTranscript.includes('嗯'), false);
  assert.equal(plan.needsReview, false);
  // The earlier copy of the sentence is gone; the later one remains.
  const todays = (plan.words || []).filter((w) => w.text === '今天');
  assert.equal(todays.length, 1);
});

test('long dead silence is trimmed to a short natural pause', () => {
  const plan = planCuts(fixture, { duration: 16 });
  // Gap from 方法。 end 5.45 to 先 start 8.20 is 2.75s > 0.8; keep 0.35s then cut the rest
  const silence = plan.deletes.find((d) => String(d.reason).includes('long-silence') && d.start >= 5.4 && d.end <= 8.21);
  assert.ok(silence, 'the 2.7s gap must be trimmed');
  assert.ok(Math.abs(silence.start - (5.45 + 0.35)) < 0.05);
  assert.ok(Math.abs(silence.end - 8.20) < 0.05);
});

test('keepRangesFromDeletes inverts deletes and maps words onto the clean timeline', () => {
  const deletes = [
    { start: 1, end: 2, reason: 'filler' },
    { start: 4, end: 5, reason: 'silence' },
  ];
  const keeps = keepRangesFromDeletes(deletes, 6);
  assert.deepEqual(keeps.map((k) => [k.start, k.end]), [[0, 1], [2, 4], [5, 6]]);
  assert.equal(mapSourceTimeToClean(keeps, 0.5), 0.5);
  assert.equal(mapSourceTimeToClean(keeps, 2.5), 1.5);
  assert.equal(mapSourceTimeToClean(keeps, 5.5), 3.5);
  const mapped = mapWordsToClean(
    [{ text: 'A', start: 0.2, end: 0.8, type: 'word' }, { text: 'B', start: 2.1, end: 2.4, type: 'word' }],
    keeps,
  );
  assert.equal(mapped[0].start, 0.2);
  assert.ok(Math.abs(mapped[1].start - 1.1) < 1e-9);
});

test('groupSentences does not split on a 0.4s pause', () => {
  const words = [
    { text: '先', start: 0, end: 0.2, type: 'word' },
    { text: '走', start: 0.6, end: 0.8, type: 'word' },
  ];
  const groups = groupSentences(words, { naturalPauseMax: 0.5 });
  assert.equal(groups.length, 1);
});

test('messy repeated logic is flagged and not hard-cut', () => {
  const plan = planCuts(messy, { duration: 20, messyFlagMinDeletes: 6, messyDeleteWordRatio: 0.3 });
  assert.equal(plan.needsReview, true);
  assert.ok(plan.flags.some((f) => f.type === 'messy-logic'));
  assert.equal(plan.deletes.some((d) => String(d.reason).includes('repeat-sentence')), false);
  assert.match(plan.cleanTranscript, /这是第一句/);
});

test('similarity treats a restart of the same line as close', () => {
  assert.ok(similarity('今天我们来讲这个方法', '今天我们来讲这个方法。') >= 0.9);
});

test('zero-duration STT tokens stay in the clean transcript', () => {
  const plan = planCuts({
    audio_duration_secs: 2,
    words: [
      { text: '视', start: 0.2, end: 0.4, type: 'word' },
      { text: '频', start: 0.4, end: 0.4, type: 'word' },
      { text: '好', start: 0.6, end: 0.9, type: 'word' },
    ],
  }, { duration: 2 });
  assert.match(plan.cleanTranscript, /视频好/);
});
