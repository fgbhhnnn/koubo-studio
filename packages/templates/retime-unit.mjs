/**
 * Retime authored typography so filled slot text appears when those words
 * are spoken on the unit's output (clean) clock, without reversing the
 * pack's motion order.
 *
 * Two steps:
 *   1. alignSlotCopy — give earlier-revealed slots earlier spoken phrases,
 *      so a later sentence cannot occupy the opening title.
 *   2. mapSpeechClock — warp the pack choreography clock onto the unit
 *      output clock so each first-shown phrase waits until it is spoken.
 *      Recap / label slots stay in the motion sequence (flex). Action
 *      windows may stretch or compress; they are never played backwards.
 */
import { clipText, twoLines, splitClauses } from './typography.mjs';
import { joinWords, mapUnitClock, unitBounds } from './assign-units.mjs';
import { slotRevealsFor } from './slot-reveals.mjs';

const PUNCT = /[\s，。、,.!！？?;；：:·→\-—～~…“”‘’"'\(\)\[\]（）【】]/g;
const MAX_RATE = 4;
const MIN_GAP = 0.03;

export function normalizePhrase(text) {
  return [...String(text ?? '')].join('').replace(PUNCT, '');
}

/**
 * Locate `text` in a word list. Returns the spoken [start, end] on the same
 * timeline as the words (the clean / film clock), or null.
 */
export function locatePhrase(words, text) {
  const needle = normalizePhrase(text);
  if (!needle) return null;
  const chars = [];
  for (const w of words || []) {
    const piece = normalizePhrase(w.text);
    for (const ch of [...piece]) {
      chars.push({ ch, start: Number(w.start), end: Number(w.end) });
    }
  }
  if (!chars.length) return null;
  const hay = chars.map((c) => c.ch).join('');
  let idx = hay.indexOf(needle);
  let len = needle.length;
  if (idx < 0) {
    const minLen = Math.min(2, needle.length);
    for (let n = needle.length - 1; n >= minLen; n--) {
      idx = hay.indexOf(needle.slice(0, n));
      if (idx >= 0) {
        len = n;
        break;
      }
    }
  }
  if (idx < 0) return null;
  const last = chars[idx + len - 1];
  return { start: chars[idx].start, end: last.end, length: len };
}

function indexAfter(words, fromIndex, text) {
  const slice = (words || []).slice(fromIndex);
  const hit = locatePhrase(slice, text);
  if (!hit) return fromIndex + (text ? 1 : 0);
  let seen = 0;
  const needle = normalizePhrase(text).slice(0, hit.length);
  for (let i = 0; i < slice.length; i++) {
    seen += [...normalizePhrase(slice[i].text)].length;
    if (seen >= needle.length) return fromIndex + i + 1;
  }
  return words.length;
}

function isSpeechSlot(slot) {
  return slot && slot.kind !== 'label';
}

function speechGroups(reveals) {
  const groups = [];
  const byKey = new Map();
  for (const slot of reveals) {
    if (!isSpeechSlot(slot)) continue;
    const key = slot.group ? `g:${slot.group}` : `s:${slot.id}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, slots: [], src: slot.src, maxChars: 0 };
      byKey.set(key, group);
      groups.push(group);
    }
    group.slots.push(slot);
    group.src = Math.min(group.src, slot.src);
  }
  groups.sort((a, b) => a.src - b.src || a.key.localeCompare(b.key));
  return groups;
}

function maxCharsFor(scene, slotId) {
  const slot = (scene.slots || []).find((s) => s.id === slotId);
  return slot?.maxChars || 24;
}

function nextClause(text) {
  const clauses = splitClauses(String(text ?? '').replace(/^[。！？!?；;，、,\s]+/, ''));
  return clauses[0] || String(text ?? '').trim();
}

function nextChunk(text, maxChars) {
  const max = Number(maxChars) || 24;
  // Short slam / pill slots take one pause-delimited clause; wider titles
  // take a full sentence so “说实话，这个速度…” stays one line.
  if (max <= 8) return nextClause(text);
  return nextSentence(text);
}

function nextSentence(text) {
  const raw = String(text ?? '').replace(/^[。！？!?；;，、,\s]+/, '').trim();
  const parts = raw.split(/(?<=[。！？!?；;])/);
  const first = (parts[0] || raw).trim();
  return first || raw;
}

/**
 * Rewrite speech-bearing slot copy so typography appearance order follows
 * this beat's spoken order. Label / badge slots are left as they were filled.
 * Later recap slots keep their previous copy once the beat is exhausted.
 */
export function alignSlotCopy(scene, values, words, reveals = slotRevealsFor(scene)) {
  const next = { ...values };
  const list = Array.isArray(words) ? words : [];
  if (!list.length || !reveals.length) return next;

  const groups = speechGroups(reveals);
  let cursor = 0;
  const used = new Set();

  for (const group of groups) {
    const leftover = joinWords(list.slice(cursor)).replace(/^[。！？!?；;，、,\s]+/, '');
    if (!normalizePhrase(leftover)) break;
    const opening = group.slots.length >= 2 && group.slots.every((s) => s.group === 'opening');
    if (opening) {
      const max = Math.min(...group.slots.map((s) => maxCharsFor(scene, s.id)));
      const first = nextSentence(leftover);
      const [line1, line2] = twoLines(first, max);
      const ids = group.slots.map((s) => s.id).sort();
      if (line1) next[ids[0]] = line1;
      if (line2 && ids[1]) next[ids[1]] = line2;
      const consumed = `${line1 || ''}${line2 || ''}`;
      cursor = indexAfter(list, cursor, consumed);
      used.add(group.key);
      continue;
    }
    const max = Math.max(...group.slots.map((s) => maxCharsFor(scene, s.id)));
    const piece = clipText(nextChunk(leftover, max), max);
    if (!piece || used.has(piece)) {
      // Skip a clause we cannot place; do not stall the walk on a repeated slug.
      cursor = Math.min(list.length, indexAfter(list, cursor, nextChunk(leftover, max) || leftover.slice(0, 1)));
      continue;
    }
    for (const s of group.slots) next[s.id] = piece;
    cursor = indexAfter(list, cursor, piece);
    used.add(piece);
  }
  return next;
}

function firstOccurrenceDesired(reveals, values, words, clipAt, seen) {
  const desired = new Map();
  const ordered = [...reveals].filter(isSpeechSlot).sort((a, b) => a.src - b.src);
  for (const slot of ordered) {
    const text = values?.[slot.id];
    const hit = locatePhrase(words, text);
    if (!hit) continue;
    const key = normalizePhrase(text);
    const local = hit.start - Number(clipAt || 0);
    if (!seen.has(key)) {
      seen.add(key);
      desired.set(slot.id, local);
    }
  }
  return desired;
}

function minGapFor(srcDelta) {
  const delta = Math.max(0, srcDelta);
  return Math.max(MIN_GAP, delta / MAX_RATE);
}

/**
 * Place typography events on the output clock: first-shown phrases wait
 * until they are spoken; later events stay in pack order; flex (label /
 * recap) events interpolate between their neighbours.
 */
export function resolveSpeechAnchors(scene, outDuration, reveals, values, words, clipAt = 0) {
  const bounds = unitBounds(scene);
  const end = Number(outDuration);
  const seen = new Set();
  const desiredById = firstOccurrenceDesired(reveals, values, words, clipAt, seen);

  const points = [
    { src: bounds.sourceStart, kind: 'bound', desired: 0 },
  ];
  const bySrc = new Map();
  for (const slot of [...reveals].sort((a, b) => a.src - b.src || String(a.id).localeCompare(b.id))) {
    const want = desiredById.has(slot.id) ? desiredById.get(slot.id) : null;
    const cur = bySrc.get(slot.src);
    if (!cur) {
      bySrc.set(slot.src, { src: slot.src, desired: want, id: slot.id });
    } else if (want != null) {
      // Several slots share a pack-time beat: wait until the latest of
      // those first-shown phrases is spoken, so none appear early.
      cur.desired = cur.desired == null ? want : Math.max(cur.desired, want);
    }
  }
  for (const cur of bySrc.values()) {
    if (cur.src === bounds.sourceStart) continue;
    points.push({
      src: cur.src,
      kind: cur.desired == null ? 'flex' : 'speech',
      desired: cur.desired,
      id: cur.id,
    });
  }
  if (![...bySrc.keys(), bounds.sourceStart].includes(bounds.sourceEnd)) {
    points.push({ src: bounds.sourceEnd, kind: 'bound', desired: end });
  }
  points.sort((a, b) => a.src - b.src);

  const hard = points.map((p, i) => {
    if (p.kind === 'bound') return i;
    if (p.kind === 'speech' && p.desired != null) return i;
    return -1;
  }).filter((i) => i >= 0);

  const out = points.map(() => null);
  out[0] = 0;
  if (hard[hard.length - 1] !== points.length - 1) {
    points[points.length - 1].desired = end;
    hard.push(points.length - 1);
  }

  for (const i of hard) {
    if (i === 0) continue;
    const want = points[i].desired == null ? end : Number(points[i].desired);
    out[i] = Math.max(0, Math.min(end, want));
  }
  out[points.length - 1] = end;

  for (let n = 0; n < hard.length; n++) {
    const i = hard[n];
    if (n === 0) continue;
    const prev = hard[n - 1];
    const gap = minGapFor(points[i].src - points[prev].src);
    out[i] = Math.max(out[i], out[prev] + gap);
  }
  for (let n = hard.length - 2; n >= 0; n--) {
    const i = hard[n];
    const next = hard[n + 1];
    const gap = minGapFor(points[next].src - points[i].src);
    const floor = i === 0 ? 0 : (points[i].desired == null ? 0 : Math.max(0, points[i].desired));
    const latest = out[next] - gap;
    if (out[i] > latest) out[i] = Math.max(floor, latest);
  }
  for (let n = 1; n < hard.length; n++) {
    const i = hard[n];
    const prev = hard[n - 1];
    const gap = minGapFor(points[i].src - points[prev].src);
    out[i] = Math.max(out[i], out[prev] + gap);
  }
  out[0] = 0;
  if (out[points.length - 1] > end) {
    // Compress from the end so the unit still fits; never go before a
    // phrase's spoken start when that start still fits in the unit.
    const over = out[points.length - 1] - end;
    for (let n = hard.length - 1; n >= 0; n--) {
      const i = hard[n];
      const floor = points[i].desired == null || i === 0 ? (i === 0 ? 0 : 0) : Math.max(0, points[i].desired);
      const shifted = out[i] - over;
      out[i] = i === points.length - 1 ? end : Math.max(floor, Math.min(end, shifted));
    }
    out[0] = 0;
    out[points.length - 1] = end;
    for (let n = 1; n < hard.length; n++) {
      const i = hard[n];
      const prev = hard[n - 1];
      const gap = minGapFor(points[i].src - points[prev].src);
      out[i] = Math.max(out[i], out[prev] + gap);
    }
    if (out[points.length - 1] > end) out[points.length - 1] = end;
  }

  for (let i = 0; i < points.length; i++) {
    if (out[i] != null) continue;
    let lo = i - 1;
    let hi = i + 1;
    while (lo >= 0 && out[lo] == null) lo--;
    while (hi < points.length && out[hi] == null) hi++;
    if (lo < 0 || hi >= points.length) {
      out[i] = 0;
      continue;
    }
    const span = points[hi].src - points[lo].src;
    const u = span < 1e-9 ? 0 : (points[i].src - points[lo].src) / span;
    out[i] = out[lo] + u * (out[hi] - out[lo]);
  }

  for (let i = 1; i < points.length; i++) {
    const gap = minGapFor(points[i].src - points[i - 1].src);
    if (out[i] < out[i - 1] + gap - 1e-9) out[i] = Math.min(end, out[i - 1] + gap);
  }
  out[points.length - 1] = end;
  out[0] = 0;

  return points.map((p, i) => ({
    src: p.src,
    out: Number(out[i]),
    kind: p.kind,
    id: p.id,
    desired: p.desired,
  }));
}

function segmentsFromAnchors(anchors, outDuration, sourceStart, sourceEnd) {
  const segs = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const out0 = a.out;
    const out1 = b.out;
    if (out1 + 1e-9 < out0) continue;
    segs.push({
      type: 'action',
      out0,
      out1,
      src0: a.src,
      src1: b.src,
      hold: false,
    });
  }
  const last = segs[segs.length - 1];
  const end = Number(outDuration);
  if (last && end > last.out1 + 1e-9) {
    const freeze = sourceEnd - 1e-4;
    segs.push({
      type: 'hold',
      out0: last.out1,
      out1: end,
      src0: freeze,
      src1: freeze,
      hold: true,
    });
  }
  if (segs.length && Math.abs(segs[segs.length - 1].out1 - end) > 1e-6) {
    segs[segs.length - 1].out1 = end;
  }
  return segs;
}

/**
 * A unit clock (output t → pack source t) aligned to this beat's words.
 * Falls back to mapUnitClock when there is nothing to align.
 */
export function mapSpeechClock(scene, outDuration, opts = {}) {
  const fallback = mapUnitClock(scene, outDuration);
  const words = opts.words || [];
  const values = opts.values || {};
  const clipAt = Number(opts.at || 0);
  const reveals = opts.reveals || slotRevealsFor(scene);
  if (!reveals.length || !words.length) return fallback;

  const anchors = resolveSpeechAnchors(scene, fallback.duration, reveals, values, words, clipAt);
  if (anchors.length < 2) return fallback;
  const segs = segmentsFromAnchors(
    anchors,
    fallback.duration,
    fallback.sourceStart,
    fallback.sourceEnd,
  );
  if (!segs.length) return fallback;
  return {
    duration: fallback.duration,
    sourceStart: fallback.sourceStart,
    sourceEnd: fallback.sourceEnd,
    segments: segs,
    speechAnchors: anchors,
  };
}

/**
 * Fill + speech-order alignment + speech-aligned clock for one assigned clip.
 */
export function retimeAssignedClip(scene, packed, filled, at, outDur) {
  const reveals = slotRevealsFor(scene);
  const values = alignSlotCopy(scene, filled.values, packed.words, reveals);
  const clock = mapSpeechClock(scene, outDur, {
    words: packed.words,
    values,
    at,
    reveals,
  });
  return { values, clock, reveals, text: filled.text };
}

/** Pack source time at which `slotId` is first revealed, or null. */
export function revealSourceTime(reveals, slotId) {
  const slot = (reveals || []).find((s) => s.id === slotId);
  return slot ? Number(slot.src) : null;
}
