/**
 * Bind this episode's text into an authored unit, using reviewed Unicode
 * code-point spans from the classic-performance manifest.
 *
 * Port of adu-motion-video `bind_authored_block` (MIT). Offsets are Unicode
 * code points, not UTF-16 units. The source block hash must match before
 * any replacement. Official MotionGit packs are not used here.
 */
import { createHash } from 'node:crypto';

export function sha256Utf8(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

export function codePoints(text) {
  return [...String(text)];
}

export function codePointLength(text) {
  return codePoints(text).length;
}

export function sliceCodePoints(text, start, end) {
  return codePoints(text).slice(start, end).join('');
}

export function indexOfCodePoints(haystack, needle) {
  const src = codePoints(haystack);
  const find = codePoints(needle);
  if (!find.length) return 0;
  outer: for (let i = 0; i + find.length <= src.length; i++) {
    for (let j = 0; j < find.length; j++) {
      if (src[i + j] !== find[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function countSubstring(haystack, needle) {
  if (!needle) return 0;
  const src = String(haystack);
  let n = 0;
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

/**
 * Escape a value so it is safe inside a JS string, optionally HTML-escaping
 * first when the span is interpolated into markup.
 */
export function jsContent(value, htmlContext) {
  let v = String(value);
  if (htmlContext) {
    v = v
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n/g, '<br>');
  }
  const map = {
    '\\': '\\\\',
    "'": "\\'",
    '"': '\\"',
    '`': '\\`',
    $: '\\u0024',
    '\n': '\\n',
    '\r': '\\r',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  return codePoints(v).map((c) => map[c] ?? c).join('');
}

/**
 * @param {string} block
 * @param {object} scene manifest scene
 * @param {Record<string, string|number>} values slot id → replacement
 * @param {string} instanceId
 * @returns {{ block: string, numbers: Record<string, number> }}
 */
export function bindAuthoredBlock(block, scene, values, instanceId) {
  const expected = scene?.sourceBlockSha256;
  const actual = sha256Utf8(block);
  if (!expected || expected !== actual) {
    throw new Error(`${instanceId}: source block hash changed or is absent; regenerate and review pack bindings`);
  }
  const changes = [];
  const numbers = {};
  for (const expression of scene.plainTextExpressions || []) {
    const source = `.textContent=${expression};`;
    if (typeof expression !== 'string' || countSubstring(block, source) !== 1) {
      throw new Error(`${instanceId}: reviewed plain-text expression changed`);
    }
    const start = indexOfCodePoints(block, source);
    if (start < 0) throw new Error(`${instanceId}: reviewed plain-text expression changed`);
    changes.push({
      start,
      end: start + codePointLength(source),
      next: `.textContent=PACK_PLAIN_TEXT(${expression});`,
      label: `${instanceId}.plainText`,
    });
  }
  for (const slot of scene.slots || []) {
    if (!Object.prototype.hasOwnProperty.call(values, slot.id)) continue;
    const kind = slot.type;
    const value = values[slot.id];
    const label = `${instanceId}.${slot.id}`;
    if (kind === 'text' || kind === 'dynamicText') {
      const old = slot.sourceText;
      const spans = slot.sourceSpans;
      if (!spans || !spans.length) {
        throw new Error(`${label}: a full pack needs reviewed sourceSpans for every text field`);
      }
      if (slot.mustChange && value === old) {
        throw new Error(`${label}: replace the source placeholder ${JSON.stringify(old)} with this episode's content`);
      }
      const cpLen = codePointLength(block);
      for (const span of spans) {
        const start = span.start;
        const end = span.end;
        if (!Number.isInteger(start) || !Number.isInteger(end) || !(start >= 0 && start < end && end <= cpLen)) {
          throw new Error(`${label}: invalid source span`);
        }
        if (sliceCodePoints(block, start, end) !== old) {
          throw new Error(`${label}: source span no longer matches its declared text`);
        }
        const context = span.renderContext ?? slot.renderContext;
        if (context !== 'html' && context !== 'text' && context != null) {
          throw new Error(`${label}: invalid render context`);
        }
        changes.push({
          start,
          end,
          next: jsContent(String(value), context === 'html'),
          label,
        });
      }
    } else if (kind === 'number') {
      if (slot.binding) {
        numbers[slot.binding] = value;
      } else {
        const old = slot.sourceCode;
        const template = slot.valueTemplate;
        if (!old || !template || old.length < 3 || /^\d+$/.test(old) || countSubstring(block, old) !== 1) {
          throw new Error(`${label}: numeric slot needs one unique source expression`);
        }
        if (countSubstring(template, '{value}') !== 1) {
          throw new Error(`${label}: invalid numeric valueTemplate`);
        }
        const start = indexOfCodePoints(block, old);
        if (start < 0) throw new Error(`${label}: numeric slot needs one unique source expression`);
        changes.push({
          start,
          end: start + codePointLength(old),
          next: template.replace('{value}', String(value)),
          label,
        });
      }
    }
  }
  changes.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < changes.length - 1; i++) {
    if (changes[i].end > changes[i + 1].start) {
      throw new Error(`Overlapping source bindings: ${changes[i].label} and ${changes[i + 1].label}`);
    }
  }
  const chars = codePoints(block);
  for (let i = changes.length - 1; i >= 0; i--) {
    const { start, end, next } = changes[i];
    chars.splice(start, end - start, ...codePoints(next));
  }
  return { block: chars.join(''), numbers };
}

/** Runtime helper injected into each bound unit page (HTML entities → plain text). */
export const PACK_PLAIN_TEXT_RUNTIME = `const PACK_PLAIN_TEXT = (() => {
  const decoder = document.createElement('textarea');
  const cache = new Map();
  return (value) => {
    if (!cache.has(value)) {
      decoder.innerHTML = value;
      cache.set(value, decoder.value);
    }
    return cache.get(value);
  };
})();
`;
