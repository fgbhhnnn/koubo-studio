/**
 * Dedicated screen-style evidence plates for evidence-focus units.
 * These are generated boards for this beat, not in-film illustration slots
 * and not a single-line text card.
 */

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function line(text, max) {
  const chars = [...String(text ?? '').trim()];
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

/**
 * @param {{
 *   variant: 'overview' | 'detail' | 'result',
 *   title?: string,
 *   resultTitle?: string,
 *   observations?: { before?: string, after?: string }[],
 *   conclusion?: string,
 *   claim?: string,
 *   chapter?: string,
 * }} opts
 */
export function renderEvidencePlate(opts = {}) {
  const variant = opts.variant || 'overview';
  const title = line(opts.title || '本期对照', 22);
  const resultTitle = line(opts.resultTitle || opts.conclusion || title, 22);
  const claim = line(opts.claim || '', 20);
  const conclusion = line(opts.conclusion || '', 18);
  const observations = (opts.observations || []).slice(0, 3);
  while (observations.length < 3) observations.push({ before: `对照${observations.length + 1}`, after: `结果${observations.length + 1}` });

  const heading = variant === 'result' ? resultTitle : title;
  const kicker = variant === 'result' ? '结果板' : variant === 'detail' ? '细节板 · 2.4×' : '证据板';
  const bg = variant === 'result' ? '#10151c' : '#161616';
  const accent = '#6d9bff';

  const rows = observations.map((item, i) => {
    const y = 230 + i * 86;
    const before = line(item.before || '', 8);
    const after = line(item.after || '', 8);
    const active = variant === 'detail' && i === 1;
    const fill = active ? '#15233e' : '#1c1c1c';
    const stroke = active ? accent : '#333';
    return `<g>
      <rect x="72" y="${y}" width="816" height="72" rx="16" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <text x="98" y="${y + 45}" fill="#888" font-size="24" font-family="PingFang SC, sans-serif">${escapeXml(before)}</text>
      <text x="400" y="${y + 45}" fill="${accent}" font-size="22" font-family="PingFang SC, sans-serif">→</text>
      <text x="460" y="${y + 45}" fill="#f7f7f5" font-size="26" font-family="PingFang SC, sans-serif" font-weight="600">${escapeXml(after)}</text>
    </g>`;
  }).join('\n');

  const footer = variant === 'result'
    ? `<text x="80" y="540" fill="${accent}" font-size="32" font-family="PingFang SC, sans-serif" font-weight="700">${escapeXml(conclusion || heading)}</text>`
    : `<text x="80" y="540" fill="#888" font-size="22" font-family="PingFang SC, sans-serif">${escapeXml(claim || '本期口播对照')}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
  <rect width="960" height="600" fill="${bg}"/>
  <rect x="36" y="28" width="888" height="544" rx="28" fill="#111" stroke="#2a2a2a" stroke-width="2"/>
  <circle cx="68" cy="58" r="7" fill="#ff5f57"/>
  <circle cx="90" cy="58" r="7" fill="#febc2e"/>
  <circle cx="112" cy="58" r="7" fill="#28c840"/>
  <text x="140" y="64" fill="#9aa" font-size="18" font-family="PingFang SC, sans-serif">${escapeXml(kicker)}</text>
  <text x="80" y="130" fill="#f7f7f5" font-size="36" font-family="PingFang SC, sans-serif" font-weight="700">${escapeXml(heading)}</text>
  <rect x="80" y="152" width="220" height="6" rx="3" fill="#2462EA"/>
  ${rows}
  ${footer}
</svg>
`;
}

export function evidencePlateFileName(clipId, key) {
  return `${clipId}-${key}.svg`;
}

/** Map evidence media keys to plate variants. */
export const EVIDENCE_PLATE_KEYS = Object.freeze({
  soft_match: 'overview',
  soft_tpl: 'detail',
  prev: 'result',
});
