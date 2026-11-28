/**
 * Fill unit slot copy on complete clauses, not mid-phrase, and keep large
 * type from overflowing its designed maxChars.
 */

const HARD = /[。！？!?；;]/;
const PAUSE = /[，、,]/;
const TRAIL = /[的了着和与或在是把被就都还也及与]+$/u;
const PUNCT_TRIM = /[，。、,.!！？?;；：:\s]+$/;

export function splitClauses(text) {
  const parts = [];
  let buf = '';
  for (const ch of [...String(text ?? '')]) {
    buf += ch;
    if (HARD.test(ch) || PAUSE.test(ch)) {
      const piece = buf.trim();
      if (piece) parts.push(piece);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

export function codePointLength(text) {
  return [...String(text ?? '')].length;
}

function scriptKind(ch) {
  if (/[A-Za-z0-9]/.test(ch)) return 'latn';
  if (/\s/.test(ch)) return 'space';
  if (/[。！？!?；;，、,：:：]/.test(ch)) return 'punct';
  return 'cjk';
}

/** Break offsets (0…length) at punctuation, spaces, and CJK↔Latin seams. */
export function softBreaks(text) {
  const chars = [...String(text ?? '')];
  const breaks = new Set([0, chars.length]);
  for (let i = 1; i < chars.length; i++) {
    const a = scriptKind(chars[i - 1]);
    const b = scriptKind(chars[i]);
    if (a === 'space' || b === 'space') breaks.add(i);
    if (a === 'punct' || b === 'punct') breaks.add(i);
    if (a !== b && a !== 'space' && b !== 'space' && a !== 'punct' && b !== 'punct') breaks.add(i);
  }
  return [...breaks].sort((x, y) => x - y);
}


function extendFill(chars, at, max) {
  const limit = Math.min(max, chars.length);
  if (at >= limit) return Math.min(at, limit);
  const kind = scriptKind(chars[at]);
  if (kind === 'cjk' || kind === 'punct') {
    let i = at;
    while (i < limit && (scriptKind(chars[i]) === 'cjk' || scriptKind(chars[i]) === 'punct')) i++;
    return i;
  }
  if (kind === 'latn') {
    let i = at;
    while (i < chars.length && scriptKind(chars[i]) === 'latn') i++;
    if (i <= limit) return i;
  }
  return at;
}

function trimCopy(text) {
  let s = String(text ?? '').trim().replace(PUNCT_TRIM, '');
  if ([...s].length > 2) s = s.replace(TRAIL, '');
  return s.trim();
}

/**
 * Fit `text` into maxChars, preferring complete clauses, then a soft break.
 * Never returns a mid-phrase slice that ends on a dangling particle when a
 * shorter complete chunk is available.
 */
export function clipText(text, maxChars) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const max = Math.max(1, Number(maxChars) || codePointLength(raw));
  if (codePointLength(raw) <= max) return trimCopy(raw) || raw;

  const clauses = splitClauses(raw);
  let acc = '';
  for (const clause of clauses) {
    const trial = acc ? `${acc}${clause}` : clause;
    const fitted = trimCopy(trial);
    if (codePointLength(fitted) <= max) acc = fitted;
    else break;
  }
  if (acc) return acc;

  const first = clauses[0] || raw;
  const chars = [...first];
  const breaks = softBreaks(first).filter((i) => i > 0 && i <= max);
  const at = extendFill(chars, breaks.length ? breaks[breaks.length - 1] : max, max);
  const cut = trimCopy(chars.slice(0, at).join(''));
  if (cut) return cut;
  return chars.slice(0, max).join('').replace(PUNCT_TRIM, '');
}

export function twoLines(text, maxChars) {
  const max = Math.max(1, Number(maxChars) || 6);
  const clauses = splitClauses(text).map((c) => trimCopy(c)).filter(Boolean);
  if (clauses.length >= 2 && codePointLength(clauses[0]) <= max && codePointLength(clauses[1]) <= max) {
    return [clauses[0], clauses[1]];
  }
  if (clauses[0] && codePointLength(clauses[0]) <= max) {
    const rest = clauses.slice(1).join('');
    return [clauses[0], clipText(rest, max) || '要点'];
  }
  const first = clauses[0] || String(text || '本期');
  const chars = [...first];
  const breaks = softBreaks(first).filter((i) => i >= 2 && i <= max);
  const mid = extendFill(
    chars,
    breaks.length ? breaks[breaks.length - 1] : Math.min(max, Math.max(2, Math.ceil(Math.min(chars.length, max * 2) / 2))),
    max,
  );
  const line1 = trimCopy(chars.slice(0, mid).join('')) || clipText(first, max);
  const line2 = clipText(chars.slice(mid).join('') || clauses[1] || '要点', max);
  return [line1 || '本期', line2 || '要点'];
}

export function clauseChunks(text, n, maxChars) {
  const max = Math.max(1, Number(maxChars) || 6);
  const count = Math.max(1, Number(n) || 3);
  const clauses = splitClauses(text).map((c) => clipText(c, max)).filter(Boolean);
  const out = [];
  for (const c of clauses) {
    if (out.length >= count) break;
    if (!out.includes(c)) out.push(c);
  }
  if (out.length < count) {
    const compact = String(text || '').replace(/[。！？!?；;，,、\s]+/g, '');
    const chars = [...compact];
    const breaks = softBreaks(compact);
    for (let i = 0; i < breaks.length - 1 && out.length < count; i++) {
      const piece = clipText(chars.slice(breaks[i], Math.min(breaks[i + 1], breaks[i] + max)).join(''), max);
      if (piece && !out.includes(piece)) out.push(piece);
    }
  }
  while (out.length < count) out.push(`要点${out.length + 1}`);
  return out.slice(0, count);
}
