/**
 * Assign classic-performance units across a talking-head cut plan.
 *
 * The three MIT authored units (claim / decompose / evidence) stay at their
 * source choreography clock. Protected motion windows play at 1x; only
 * inter-window gaps can shrink, and a trailing hold may extend up to
 * maxHoldFrames. Slot text is filled from the beat's own words — never the
 * pack's original copy.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
export const UNITS_MANIFEST_PATH = join(ROOT, 'classic-performance', 'units-manifest.json');

const UNIT_CYCLE = ['claim-into-container', 'decompose-and-consolidate', 'evidence-focus'];

const CLAIM_RE = /其实|核心|关键|就是|我认为|我发现|重要的是|我想|我要|结论是|总的来说|说实话|这一次|这次/;
const DECOMPOSE_RE = /第一|第二|第三|首先|其次|再次|最后|第[一二三123]|一步|二步|三步|分为|三个|两点|三件事|拆|步骤|分别/;
const EVIDENCE_RE = /比如|例如|举例|你看|看看|实际|证据|结果|演示|录屏|效果|对比|之前|之后|回看/;

const ROLE_LABEL = {
  'claim-into-container': '开场主张',
  'decompose-and-consolidate': '方法拆解',
  'evidence-focus': '证据镜头',
};

export function loadUnitsManifest(path = UNITS_MANIFEST_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function sceneById(manifest, id) {
  const scene = (manifest.scenes || []).find((s) => s.id === id);
  if (!scene) throw new Error(`未知镜头单位：${id}`);
  return scene;
}

export function unitBounds(scene) {
  const fps = scene.fps || 60;
  const sourceStart = Number(scene.sourceStart);
  const sourceEnd = Number(scene.sourceEnd);
  const native = sourceEnd - sourceStart;
  const action = (scene.motionWindows || []).reduce((n, w) => n + (w.end - w.start), 0);
  const minDuration = (scene.minFrames || Math.round(native * fps)) / fps;
  const maxHold = (scene.maxHoldFrames || 0) / fps;
  return {
    sourceStart,
    sourceEnd,
    native,
    action,
    minDuration,
    maxHold,
    maxDuration: native + maxHold,
    fps,
  };
}

/**
 * Map local output time [0, outDuration] onto the unit's source clock.
 * Action windows stay 1x; gaps absorb a shorter beat; a trailing hold
 * covers a longer beat up to maxHold.
 */
export function mapUnitClock(scene, outDuration) {
  const { sourceStart, sourceEnd, native, action, minDuration, maxHold, maxDuration } = unitBounds(scene);
  const windows = [...(scene.motionWindows || [])].sort((a, b) => a.start - b.start);
  const srcSegs = [];
  let cursor = sourceStart;
  for (const w of windows) {
    if (w.start > cursor + 1e-9) srcSegs.push({ type: 'gap', src0: cursor, src1: w.start });
    if (w.end > w.start) srcSegs.push({ type: 'action', src0: w.start, src1: w.end });
    cursor = Math.max(cursor, w.end);
  }
  if (sourceEnd > cursor + 1e-9) srcSegs.push({ type: 'gap', src0: cursor, src1: sourceEnd });

  const gap = srcSegs.filter((s) => s.type === 'gap').reduce((n, s) => n + (s.src1 - s.src0), 0);
  let outDur = Number(outDuration);
  if (!Number.isFinite(outDur) || outDur <= 0) outDur = native;
  outDur = Math.min(Math.max(outDur, Math.min(minDuration, native)), maxDuration);

  const segs = [];
  let outCursor = 0;
  if (outDur <= native + 1e-9) {
    const shrink = gap > 1e-9 ? Math.max(0, (outDur - action) / gap) : 1;
    for (const s of srcSegs) {
      const srcLen = s.src1 - s.src0;
      const outLen = s.type === 'action' ? srcLen : srcLen * shrink;
      segs.push({
        type: s.type,
        out0: outCursor,
        out1: outCursor + outLen,
        src0: s.src0,
        src1: s.src1,
        hold: false,
      });
      outCursor += outLen;
    }
  } else {
    for (const s of srcSegs) {
      const srcLen = s.src1 - s.src0;
      segs.push({
        type: s.type,
        out0: outCursor,
        out1: outCursor + srcLen,
        src0: s.src0,
        src1: s.src1,
        hold: false,
      });
      outCursor += srcLen;
    }
    const hold = Math.min(maxHold, outDur - outCursor);
    if (hold > 1e-9) {
      const freeze = sourceEnd - 1e-4;
      segs.push({
        type: 'hold',
        out0: outCursor,
        out1: outCursor + hold,
        src0: freeze,
        src1: freeze,
        hold: true,
      });
      outCursor += hold;
    }
  }
  if (Math.abs(outCursor - outDur) > 1e-6 && segs.length) {
    segs[segs.length - 1].out1 = outDur;
  }
  return { duration: Number(outDur.toFixed(4)), sourceStart, sourceEnd, segments: segs };
}

export function sourceTimeAt(clock, t) {
  const segs = clock.segments || [];
  if (!segs.length) return clock.sourceStart + Math.max(0, t);
  if (t <= segs[0].out0) return segs[0].hold ? segs[0].src0 : segs[0].src0;
  for (const seg of segs) {
    if (t <= seg.out1 + 1e-9) {
      if (seg.hold || seg.out1 - seg.out0 < 1e-9) return seg.src0;
      const u = (t - seg.out0) / (seg.out1 - seg.out0);
      return seg.src0 + u * (seg.src1 - seg.src0);
    }
  }
  const last = segs[segs.length - 1];
  return last.hold ? last.src0 : last.src1;
}

export function joinWords(words) {
  let s = '';
  let prev = null;
  for (const w of words || []) {
    const t = String(w.text ?? '');
    if (!t) continue;
    if (!s) {
      s = t;
      prev = w;
      continue;
    }
    const cjk = /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE10-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]$/.test(s)
      || /^[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE10-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(t);
    const tight = prev && Number.isFinite(prev.end) && Number.isFinite(w.start) && (w.start - prev.end) < 0.12;
    if (cjk || tight || /\s$/.test(s) || /^\s/.test(t)) s += t;
    else s += ` ${t}`;
    prev = w;
  }
  return s;
}

export function clipText(text, maxChars) {
  const chars = codePointArray(String(text ?? '').trim());
  if (!chars.length) return '';
  const max = Math.max(1, Number(maxChars) || chars.length);
  if (chars.length <= max) return chars.join('');
  let out = chars.slice(0, max);
  while (out.length > 1 && /[，。、,.!！？?;；：:\s]/.test(out[out.length - 1])) out.pop();
  return out.join('');
}

function codePointArray(text) {
  return [...String(text)];
}

export function splitSentences(words) {
  const list = Array.isArray(words) ? words : [];
  const sentences = [];
  let cur = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (!w || w.text == null) continue;
    cur.push(w);
    const next = list[i + 1];
    const hard = /[。！？!?；;]$/.test(String(w.text));
    const pause = next ? next.start - w.end >= 0.45 : true;
    if (cur.length && (hard || pause)) {
      sentences.push(cur);
      cur = [];
    }
  }
  if (cur.length) sentences.push(cur);
  return sentences;
}

export function classifyBeat(text) {
  const s = String(text || '');
  const ev = EVIDENCE_RE.test(s);
  const de = DECOMPOSE_RE.test(s);
  const cl = CLAIM_RE.test(s);
  if (de && ev) {
    // List markers are a stronger structural cue than a passing 比如/效果.
    return /第一|第二|第三|首先|其次|三步|分为|拆/.test(s)
      ? 'decompose-and-consolidate'
      : 'evidence-focus';
  }
  if (de) return 'decompose-and-consolidate';
  if (ev) return 'evidence-focus';
  if (cl) return 'claim-into-container';
  return null;
}

function spanOf(words) {
  if (!words?.length) return { start: 0, end: 0 };
  return { start: words[0].start, end: words[words.length - 1].end };
}

function uniqueAgainst(value, sourceText, fallback) {
  const v = String(value ?? '').trim();
  const src = String(sourceText ?? '');
  if (v && v !== src) return v;
  const alt = String(fallback ?? '').trim();
  if (alt && alt !== src) return alt;
  if (src.length) {
    const flipped = `要点·${clipText(src, Math.max(1, [...src].length - 1))}`;
    if (flipped !== src) return flipped;
  }
  return '本期口播';
}

function sentencesOf(text) {
  const parts = String(text || '').split(/(?<=[。！？!?；;])|\n+/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : (text ? [String(text)] : []);
}

function chunks(text, n, maxChars) {
  const compact = String(text || '').replace(/\s+/g, '');
  const chars = [...compact];
  const out = [];
  let i = 0;
  while (out.length < n && i < chars.length) {
    const piece = chars.slice(i, i + maxChars).join('');
    if (piece) out.push(piece);
    i += maxChars;
  }
  return out;
}

function twoLines(text, maxChars) {
  const compact = String(text || '').replace(/[。！？!?；;，,、\s]+/g, '');
  const chars = [...compact];
  if (chars.length <= maxChars) {
    return [chars.join('') || '本期', chars.length ? '要讲的是' : '口播要点'];
  }
  const mid = Math.min(maxChars, Math.max(2, Math.ceil(Math.min(chars.length, maxChars * 2) / 2)));
  return [chars.slice(0, mid).join(''), chars.slice(mid, mid + maxChars).join('') || '要点'];
}

/**
 * Build slot id → text for one unit from this beat's words.
 * Every mustChange slot is different from the pack placeholder.
 */
export function fillUnitSlots(scene, words, opts = {}) {
  const text = joinWords(words);
  const sents = sentencesOf(text);
  const first = sents[0] || text || '本期口播';
  const second = sents[1] || sents[0] || first;
  const last = sents[sents.length - 1] || first;
  const mid = sents[Math.min(1, sents.length - 1)] || first;
  const chapter = String(opts.chapter ?? '01').padStart(2, '0');
  const roleLabel = opts.label || ROLE_LABEL[scene.id] || '口播讲解';
  const parts = chunks(text.replace(/[。！？!?；;，,、]/g, ''), 6, 6);

  const inputs = {};
  if (scene.id === 'claim-into-container') {
    const [line1, line2] = twoLines(first, 6);
    inputs.chapter = chapter;
    inputs.label = clipText(roleLabel, 8);
    inputs.claim = { line1, line2, context: clipText(second, 24) };
    inputs.container = {
      heading: clipText(mid, 18) || '把方法，讲清楚',
      type: '口播讲解 · 本期内容',
      name: clipText(first, 20) || '本期方法',
      contents: parts.slice(0, 3).join('　·　') || '要点　·　方法　·　结论',
      status: '✓ 本片正在讲',
    };
    inputs.receivers = [parts[0], parts[1], parts[2]].map((p, i) => p || `要点${i + 1}`);
    inputs.proof = {
      heading: clipText(sents[Math.min(2, sents.length - 1)] || first, 13),
      chain: (parts.slice(0, 3).join(' → ') || '主张 → 方法 → 结论'),
    };
    inputs.response = {
      context: '口播内容 · 本期',
      setup: clipText(sents[Math.max(0, sents.length - 2)] || mid, 24),
      impact: clipText(last, 9),
      resolve: clipText(last, 18),
    };
  } else if (scene.id === 'decompose-and-consolidate') {
    const concept = clipText(parts[0] || first, 3) || '方法';
    inputs.chapter = chapter;
    inputs.label = clipText(roleLabel, 8);
    inputs.context = clipText(first, 24) || '方法拆解 · 本期';
    inputs.question = clipText(second.endsWith('？') || second.endsWith('?') ? second : `${clipText(second, 11)}？`, 13);
    inputs.concept = concept;
    inputs.explanation = clipText(mid, 24);
    inputs.decomposeHeading = clipText(sents[0] || '把内容拆开看', 14);
    inputs.consolidateHeading = clipText(sents[1] || '再把要点收拢', 16);
    inputs.parts = [0, 1, 2].map((i) => ({
      label: clipText(parts[i] || `部分${i + 1}`, 7),
      sample: clipText(parts[i] || `示例${i + 1}`, 5),
      record: clipText(parts[i + 3] || parts[i] || `记下${i + 1}`, 8),
    }));
    inputs.result = {
      file: clipText(first, 16) || '本期要点',
      label: clipText(concept, 6) || '要点',
      contents: parts.slice(0, 3).join('　·　') || '拆解　·　对照　·　收拢',
      conclusion: clipText(last, 22),
    };
  } else if (scene.id === 'evidence-focus') {
    inputs.chapter = chapter;
    inputs.label = clipText(roleLabel, 8);
    inputs.entry = clipText(first, 14);
    inputs.claim = clipText(second, 15);
    inputs.evidence = {
      title: clipText(mid, 24) || '本期画面 · 对照',
      resultTitle: clipText(last, 24) || '看完这一段',
    };
    inputs.observations = [0, 1, 2].map((i) => ({
      before: clipText(parts[i] || `之前${i + 1}`, 6),
      after: clipText(parts[i + 3] || parts[i] || `之后${i + 1}`, 6),
    }));
    inputs.conclusion = clipText(last, 14);
  }

  const values = {};
  for (const slot of scene.slots || []) {
    if (slot.type !== 'text' && slot.type !== 'dynamicText') continue;
    let raw = '';
    if (slot.inputTemplate) {
      raw = slot.inputTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
        const v = inputs[name];
        return v == null ? '' : String(v);
      });
    } else if (slot.inputPath) {
      raw = pathGet(inputs, slot.inputPath);
    }
    let textValue = clipText(raw == null ? '' : String(raw), slot.maxChars || 32);
    textValue = uniqueAgainst(textValue, slot.sourceText, `${ROLE_LABEL[scene.id] || '口播'}${slot.id}`);
    textValue = clipText(textValue, slot.maxChars || 32);
    if (slot.mustChange && textValue === slot.sourceText) {
      textValue = clipText(`本期${slot.id}`, slot.maxChars || 32);
    }
    values[slot.id] = textValue;
  }
  return { values, inputs, text };
}

function pathGet(obj, path) {
  if (!path) return '';
  return path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

function pickUnitId(preferred, usedLast, manifest) {
  const available = (manifest.scenes || []).map((s) => s.id);
  const tryIds = [];
  if (preferred && available.includes(preferred)) tryIds.push(preferred);
  for (const id of UNIT_CYCLE) {
    if (!tryIds.includes(id) && available.includes(id) && id !== usedLast) tryIds.push(id);
  }
  for (const id of available) {
    if (!tryIds.includes(id)) tryIds.push(id);
  }
  return tryIds;
}

function wordsFrom(startAt, sentences) {
  const out = [];
  for (const sentence of sentences) {
    const part = (sentence || []).filter((w) => w.end > startAt + 1e-6);
    if (part.length) out.push(part);
  }
  return out;
}

function prefixUntil(words, start, cutAt) {
  return words.filter((w) => w.start < cutAt - 1e-6);
}

function packBeat(sentences, minDur, native, maxDur, startAt = 0) {
  const usable = wordsFrom(startAt, sentences);
  if (!usable.length) return null;
  const used = [];
  let partial = [];
  const target = Math.min(Math.max(native, minDur), maxDur);
  for (const s of usable) {
    const trial = used.concat([s]).flat();
    const start = Math.max(startAt, spanOf(trial).start);
    const end = spanOf(trial).end;
    const dur = end - start;
    if (used.length && dur > maxDur + 1e-6) {
      const cutAt = start + target;
      partial = prefixUntil(s, start, cutAt);
      break;
    }
    if (!used.length && dur > maxDur + 1e-6) {
      const cutAt = start + maxDur;
      used.push(prefixUntil(s, start, cutAt));
      break;
    }
    used.push(s);
    if (dur >= native && dur >= minDur) break;
  }
  const words = used.flat().concat(partial);
  if (!words.length) return null;
  const start = Math.max(startAt, spanOf(words).start);
  const end = spanOf(words).end;
  const dur = Math.min(end - start, maxDur);
  if (dur + 1e-6 < minDur) {
    return { words, start, end, duration: dur, complete: false, usedCount: used.length };
  }
  // Fully consumed sentences only; a partial leftover stays for the next clip.
  return { words, start, end: start + dur, duration: dur, complete: true, usedCount: used.length };
}

/**
 * @param {{ words?: object[], cleanDuration?: number, duration?: number }} plan
 * @param {{ manifest?: object, templateId?: string }} [opts]
 * @returns {{ clips: object[], skipped: string|null }}
 */
export function assignUnits(plan = {}, opts = {}) {
  const templateId = opts.templateId || plan?.template?.id || 'classic-performance';
  if (templateId !== 'classic-performance') {
    return { clips: [], skipped: 'template-mismatch' };
  }
  const manifest = opts.manifest || loadUnitsManifest();
  const words = Array.isArray(plan.words) ? plan.words : [];
  const filmEnd = Number(plan.cleanDuration ?? plan.duration);
  const duration = Number.isFinite(filmEnd) && filmEnd > 0
    ? filmEnd
    : (words.length ? words[words.length - 1].end : 0);

  const minNeeded = Math.min(...(manifest.scenes || []).map((s) => unitBounds(s).minDuration));
  if (!words.length || duration + 1e-6 < minNeeded) {
    return { clips: [], skipped: 'too-short' };
  }

  const sentences = splitSentences(words);
  const clips = [];
  let cursorSent = 0;
  let usedLast = null;
  let lastEnd = 0;

  while (cursorSent < sentences.length) {
    const remainingSentences = wordsFrom(lastEnd, sentences.slice(cursorSent));
    const remainingWords = remainingSentences.flat();
    if (!remainingWords.length) break;
    const remStart = Math.max(lastEnd, remainingWords[0].start);
    const remEnd = Math.max(remainingWords[remainingWords.length - 1].end, duration);
    const remDur = remEnd - remStart;
    const upcoming = [];
    let acc = 0;
    for (const sentence of remainingSentences) {
      upcoming.push(...sentence);
      const span = spanOf(upcoming);
      acc = span.end - Math.max(remStart, span.start);
      if (acc >= 8) break;
    }
    const classified = classifyBeat(joinWords(upcoming.length ? upcoming : remainingWords.slice(0, 24)));
    const cycled = UNIT_CYCLE[clips.length % UNIT_CYCLE.length];
    // Cycle claim → decompose → evidence across the film so all three units appear.
    // Classification may still win the opening beat, or a fallback if the cycled unit cannot fit.
    const preferred = clips.length === 0 ? (classified || cycled) : cycled;
    const candidates = pickUnitId(preferred, usedLast, manifest);
    let placed = false;
    for (const unitId of candidates) {
      const scene = sceneById(manifest, unitId);
      const bounds = unitBounds(scene);
      if (remDur + 1e-6 < bounds.minDuration) continue;
      const packed = packBeat(remainingSentences, bounds.minDuration, bounds.native, bounds.maxDuration, remStart);
      if (!packed?.complete) continue;
      const at = clips.length === 0 && packed.start < 0.4 ? 0 : Math.max(lastEnd, packed.start);
      const clipEnd = Math.min(duration, at + packed.duration);
      const outDur = clipEnd - at;
      if (outDur + 1e-6 < bounds.minDuration) continue;
      const clock = mapUnitClock(scene, outDur);
      const chapter = String(clips.length + 1).padStart(2, '0');
      const filled = fillUnitSlots(scene, packed.words, {
        chapter,
        label: ROLE_LABEL[unitId],
      });
      clips.push({
        id: `unit-${chapter}`,
        unitId,
        role: scene.role || unitId,
        at: Number(at.toFixed(4)),
        duration: clock.duration,
        sourceStart: clock.sourceStart,
        sourceEnd: clock.sourceEnd,
        clock,
        slots: filled.values,
        text: filled.text,
        faceTracking: false,
        requiresFaceTracking: Boolean(scene.requiresFaceTracking),
      });
      usedLast = unitId;
      lastEnd = Number((at + clock.duration).toFixed(4));
      while (cursorSent < sentences.length && spanOf(sentences[cursorSent]).end <= lastEnd + 1e-6) {
        cursorSent += 1;
      }
      placed = true;
      break;
    }
    if (!placed) {
      // Skip a sentence that cannot seed a unit and keep covering the film.
      cursorSent += 1;
      continue;
    }
    if (lastEnd >= duration - 1e-3) break;
  }

  return { clips, skipped: clips.length ? null : 'no-fit' };
}

export function listUnitIds(manifest) {
  return (manifest.scenes || []).map((s) => s.id);
}
