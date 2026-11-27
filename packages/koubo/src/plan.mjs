/**
 * Rule-based talking-head cut planner.
 *
 * Keep 0.3–0.5s natural pauses between words. Cut fillers (嗯/啊/um…),
 * immediate repeats, false starts / repeated sentences, and trim long dead
 * silence down to a short natural pause. When the remaining speech looks
 * structurally messy, mark it for review and do not apply those structural
 * cuts — fillers and long silences are still trimmed.
 */

export const DEFAULT_PLAN_OPTIONS = Object.freeze({
  naturalPauseMin: 0.3,
  naturalPauseMax: 0.5,
  longSilence: 0.8,
  keepSilence: 0.35,
  fillerMaxDuration: 0.7,
  falseStartMaxWords: 4,
  sentenceRepeatSimilarity: 0.86,
  messyDeleteWordRatio: 0.35,
  messyFlagMinDeletes: 6,
});

const CORE_FILLERS = new Set([
  '嗯', '嗯嗯', '嗯啊', '啊', '呃', '额', '唔', '喔', '哎', '唉',
  '哼', '哈', '呵',
  'um', 'uh', 'uhh', 'erm', 'hmm', 'ah', 'er', 'uh-huh', 'mm', 'mmm',
]);

const HESITATION_PHRASES = new Set([
  '那个', '就是', '就是说', '然后那个', '怎么说', '什么来着',
  'you know', 'i mean', 'like',
]);

const PUNCT_RE = /[。！？!?；;，,、…]+$/;

/**
 * @param {unknown} raw
 * @returns {{ text: string, start: number, end: number, type: string, speaker_id?: string }[]}
 */
export function normalizeWords(raw) {
  const list = Array.isArray(raw) ? raw : raw?.words;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type || 'word';
    if (type === 'spacing' || type === 'audio_event') continue;
    const text = String(item.text ?? '').trim();
    if (!text) continue;
    const start = Number(item.start);
    let end = Number(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    if (end === start) end = start + 0.02; // some STT tokens are instantaneous
    out.push({
      text,
      start,
      end,
      type,
      ...(item.speaker_id ? { speaker_id: item.speaker_id } : {}),
    });
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

function normalizeToken(text) {
  return String(text).trim().toLowerCase().replace(PUNCT_RE, '').replace(/\s+/g, '');
}

function isCoreFiller(word, options) {
  const token = normalizeToken(word.text);
  if (!CORE_FILLERS.has(token)) return false;
  const dur = word.end - word.start;
  if (dur > options.fillerMaxDuration) return false;
  // Keep a trailing exclamation 啊/哦 that is glued to the previous word
  // (gap < 0.12s) and longer than a hesitation grunt.
  if ((token === '啊' || token === '哦' || token === '喔') && dur >= 0.28) {
    return false;
  }
  return true;
}

function isHesitationPhrase(word, prev, next, options) {
  const token = normalizeToken(word.text);
  if (!HESITATION_PHRASES.has(token)) return false;
  const gapBefore = prev ? word.start - prev.end : Infinity;
  const gapAfter = next ? next.start - word.end : Infinity;
  const dur = word.end - word.start;
  // Only cut when it behaves like a stall: isolated by pauses, or very short.
  return dur <= options.fillerMaxDuration && (gapBefore >= 0.22 || gapAfter >= 0.22 || dur <= 0.22);
}

/**
 * @param {string} a
 * @param {string} b
 */
export function similarity(a, b) {
  const s = normalizeToken(a);
  const t = normalizeToken(b);
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  if (s === t) return 1;
  if (s.includes(t) || t.includes(s)) {
    return Math.min(s.length, t.length) / Math.max(s.length, t.length);
  }
  const dist = levenshtein(s, t);
  return 1 - dist / Math.max(s.length, t.length);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * Split words into sentence-like groups: punctuation, or a pause longer than
 * naturalPauseMax (but 0.3–0.5s is still the same group).
 */
export function groupSentences(words, options = DEFAULT_PLAN_OPTIONS) {
  const groups = [];
  let current = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    current.push(w);
    const next = words[i + 1];
    const punct = PUNCT_RE.test(w.text);
    const longPause = next ? (next.start - w.end) > options.naturalPauseMax + 1e-9 : true;
    if (punct || longPause) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function sentenceText(group) {
  return group.map((w) => w.text).join('');
}

/**
 * Merge overlapping / touching intervals.
 * @param {{start:number,end:number}[]} ranges
 */
export function mergeRanges(ranges) {
  const list = ranges
    .filter((r) => r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (!last || r.start > last.end + 1e-4) out.push({ ...r });
    else {
      last.end = Math.max(last.end, r.end);
      if (r.reason && last.reason && r.reason !== last.reason) {
        last.reason = `${last.reason}+${r.reason}`;
      }
      if (r.text) last.text = `${last.text || ''} ${r.text}`.trim();
    }
  }
  return out;
}

/**
 * Invert delete ranges against [0, duration] into keep ranges.
 */
export function keepRangesFromDeletes(deletes, duration) {
  const cuts = mergeRanges(deletes.map((d) => ({ start: d.start, end: d.end })));
  const keeps = [];
  let cursor = 0;
  for (const c of cuts) {
    const start = Math.max(0, c.start);
    const end = Math.min(duration, c.end);
    if (start > cursor + 1e-4) keeps.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (duration > cursor + 1e-4) keeps.push({ start: cursor, end: duration });
  return keeps;
}

/**
 * Map a source time onto the clean timeline defined by keep ranges.
 * Times inside a deleted region clamp to the start of the following keep
 * (or the end of the clean timeline).
 */
export function mapSourceTimeToClean(keeps, t) {
  let acc = 0;
  for (const k of keeps) {
    if (t < k.start) return acc;
    if (t <= k.end) return acc + (t - k.start);
    acc += k.end - k.start;
  }
  return acc;
}

export function mapWordsToClean(words, keeps) {
  return words
    .filter((w) => keeps.some((k) => w.end > k.start + 1e-4 && w.start < k.end - 1e-4))
    .map((w) => {
      const start = mapSourceTimeToClean(keeps, Math.max(w.start, firstOverlapping(keeps, w).start));
      const end = mapSourceTimeToClean(keeps, Math.min(w.end, firstOverlapping(keeps, w).end));
      return { ...w, sourceStart: w.start, sourceEnd: w.end, start, end };
    })
    .map((w) => w.end > w.start ? w : { ...w, end: w.start + 0.02 });
}

function firstOverlapping(keeps, w) {
  return keeps.find((k) => w.end > k.start && w.start < k.end) || keeps[0] || { start: w.start, end: w.end };
}

function coveredBy(deletes, w) {
  return deletes.some((d) => w.start >= d.start - 1e-4 && w.end <= d.end + 1e-4);
}

/**
 * @param {unknown} transcript
 * @param {Partial<typeof DEFAULT_PLAN_OPTIONS> & { duration?: number }} [opts]
 */
export function planCuts(transcript, opts = {}) {
  const options = { ...DEFAULT_PLAN_OPTIONS, ...opts };
  const words = normalizeWords(transcript);
  const duration = Number.isFinite(opts.duration)
    ? opts.duration
    : (words.length ? Math.max(words[words.length - 1].end, opts.duration || 0) : (opts.duration || 0));

  /** @type {{start:number,end:number,reason:string,text?:string,kind:string}[]} */
  const fillerDeletes = [];
  /** @type {typeof fillerDeletes} */
  const repeatDeletes = [];
  /** @type {typeof fillerDeletes} */
  const silenceDeletes = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    const next = words[i + 1];
    if (isCoreFiller(w, options) || isHesitationPhrase(w, prev, next, options)) {
      fillerDeletes.push({
        start: w.start,
        end: w.end,
        reason: 'filler',
        kind: 'filler',
        text: w.text,
      });
    }
  }

  // Immediate repeated tokens: "这个 这个" / "对 对 对" — keep the last.
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    const next = words[i + 1];
    if (coveredBy(fillerDeletes, w) || coveredBy(fillerDeletes, next)) continue;
    if (normalizeToken(w.text) && normalizeToken(w.text) === normalizeToken(next.text) && (next.start - w.end) <= 0.55) {
      repeatDeletes.push({
        start: w.start,
        end: w.end,
        reason: 'repeat-word',
        kind: 'repeat',
        text: w.text,
      });
    }
  }

  const remaining = words.filter((w) => !coveredBy([...fillerDeletes, ...repeatDeletes], w));
  const sentences = groupSentences(remaining, options);

  for (let i = 0; i < sentences.length - 1; i++) {
    const a = sentences[i];
    const b = sentences[i + 1];
    if (!a.length || !b.length) continue;
    const ta = sentenceText(a);
    const tb = sentenceText(b);
    const sim = similarity(ta, tb);
    const gap = b[0].start - a[a.length - 1].end;
    if (sim >= options.sentenceRepeatSimilarity && gap <= 1.8) {
      // Repeated sentence or a restart of the same line: drop the earlier one.
      repeatDeletes.push({
        start: a[0].start,
        end: a[a.length - 1].end,
        reason: 'repeat-sentence',
        kind: 'repeat',
        text: ta,
      });
      continue;
    }
    // False start: a short fragment, then a longer sentence that starts the same way.
    if (a.length <= options.falseStartMaxWords && b.length > a.length && gap <= 1.2) {
      const head = b.slice(0, a.length).map((w) => w.text).join('');
      if (similarity(ta, head) >= 0.75) {
        repeatDeletes.push({
          start: a[0].start,
          end: a[a.length - 1].end,
          reason: 'false-start',
          kind: 'false-start',
          text: ta,
        });
      }
    }
  }

  const structuralDeletes = mergeRanges(repeatDeletes);
  const structuralWordCount = words.filter((w) => coveredBy(structuralDeletes, w)).length;
  const structuralRatio = words.length ? structuralWordCount / words.length : 0;
  const messy = structuralDeletes.length >= options.messyFlagMinDeletes && structuralRatio >= options.messyDeleteWordRatio;

  /** @type {{type:string,message:string,ranges?:unknown[]}[]} */
  const flags = [];
  const appliedStructural = messy ? [] : structuralDeletes;
  if (messy) {
    flags.push({
      type: 'messy-logic',
      message: '口播逻辑看起来比较乱（较多重复或说错重来）。已保留这些句子，没有硬剪；废话和过长死寂仍会去掉。请先看方案再决定是否重剪。',
      ranges: structuralDeletes,
    });
  }

  const appliedWordDeletes = mergeRanges([...fillerDeletes, ...appliedStructural]);

  // Long dead silence: gaps between kept words (and the edges) longer than longSilence,
  // trimmed down to keepSilence. Natural 0.3–0.5s pauses are never cut.
  const keptWords = words.filter((w) => !coveredBy(appliedWordDeletes, w));
  const anchors = [];
  if (keptWords.length) {
    if (keptWords[0].start > 0) anchors.push({ end: 0, start: 0, edge: 'start' });
    for (const w of keptWords) anchors.push(w);
    if (keptWords[keptWords.length - 1].end < duration) {
      anchors.push({ start: duration, end: duration, edge: 'end' });
    }
  } else if (duration > 0) {
    // nothing kept — still report the full span
    anchors.push({ start: 0, end: 0 }, { start: duration, end: duration });
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const gapStart = a.end;
    const gapEnd = b.start;
    const gap = gapEnd - gapStart;
    if (gap <= options.longSilence + 1e-9) continue;
    // Keep a short natural pause at the beginning of the gap (after the previous word).
    const cutStart = gapStart + options.keepSilence;
    if (cutStart < gapEnd - 1e-4) {
      silenceDeletes.push({
        start: cutStart,
        end: gapEnd,
        reason: 'long-silence',
        kind: 'silence',
        text: '',
      });
    }
  }

  const deleteEvents = [...fillerDeletes, ...appliedStructural, ...silenceDeletes]
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const deletes = mergeRanges(deleteEvents);
  let keeps = keepRangesFromDeletes(deletes, duration);
  keeps = dropEmptyEdgeKeeps(keeps, keptWords);
  const cleanWords = mapWordsToClean(keptWords, keeps);
  const cleanDuration = keeps.reduce((s, k) => s + (k.end - k.start), 0);

  return {
    engine: 'rules',
    deleteEvents,
    options: {
      naturalPauseMin: options.naturalPauseMin,
      naturalPauseMax: options.naturalPauseMax,
      longSilence: options.longSilence,
      keepSilence: options.keepSilence,
    },
    sourceDuration: duration,
    cleanDuration,
    keeps,
    deletes,
    flags,
    needsReview: flags.some((f) => f.type === 'messy-logic'),
    cleanTranscript: cleanWords.map((w) => w.text).join(looksMostlyCjk(cleanWords) ? '' : ' '),
    sourceTranscript: words.map((w) => w.text).join(looksMostlyCjk(words) ? '' : ' '),
    words: cleanWords,
    sourceWordCount: words.length,
    cleanWordCount: cleanWords.length,
    llm: { used: false },
  };
}

function looksMostlyCjk(words) {
  const text = words.map((w) => w.text).join('');
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return cjk >= text.length * 0.3;
}


function dropEmptyEdgeKeeps(keeps, words) {
  const hasWord = (k) => words.some((w) => w.end > k.start + 1e-4 && w.start < k.end - 1e-4);
  let list = keeps.slice();
  while (list.length && !hasWord(list[0])) list = list.slice(1);
  while (list.length && !hasWord(list[list.length - 1])) list = list.slice(0, -1);
  return list;
}

export function formatPlanSummary(plan) {
  const del = plan.deletes || [];
  const by = {};
  for (const d of del) {
    const reason = String(d.reason || d.kind || 'other').split('+')[0];
    by[reason] = (by[reason] || 0) + 1;
  }
  const reasons = Object.entries(by).map(([k, v]) => `${k}×${v}`).join('，') || '无';
  const lines = [
    `源时长 ${plan.sourceDuration.toFixed(2)}s → 干净时长 ${plan.cleanDuration.toFixed(2)}s`,
    `保留 ${plan.keeps.length} 段，删除 ${del.length} 段（${reasons}）`,
    `词数 ${plan.sourceWordCount} → ${plan.cleanWordCount}`,
  ];
  if (plan.needsReview) lines.push('需要人工看方案：逻辑标记为较乱，重复/说错重来未硬剪。');
  for (const f of plan.flags || []) lines.push(`标记：${f.message}`);
  return lines.join('\n');
}
