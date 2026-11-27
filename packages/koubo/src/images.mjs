import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, basename } from 'node:path';

/**
 * Illustration slot interface.
 *
 * When a generator (third-party image model) is provided and returns a file
 * path, that file is used. Otherwise a placeholder SVG is written so the
 * main ingest path is never blocked by a missing image key.
 *
 * @typedef {{ prompt: string, outPath: string, width?: number, height?: number, index?: number }} ImageSlotRequest
 * @typedef {(req: ImageSlotRequest) => Promise<string | void | null>} ImageGenerator
 */

export function placeholderSvg({ prompt, width = 960, height = 600, index = 1 } = {}) {
  const title = escapeXml(`插图槽 ${index}`);
  const body = escapeXml(prompt || '可替换配图');
  const hint = escapeXml('未配置生图密钥时使用占位，可在 Studio 里换成自己的图或稍后再接模型。');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4f1ea"/>
      <stop offset="1" stop-color="#e7eefb"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="28" fill="url(#bg)"/>
  <rect x="18" y="18" width="${width - 36}" height="${height - 36}" rx="22" fill="none" stroke="#2462EA" stroke-width="3" stroke-dasharray="14 10" opacity="0.7"/>
  <text x="48" y="86" font-family="ui-sans-serif, 'PingFang SC', sans-serif" font-size="28" fill="#2462EA" font-weight="700">${title}</text>
  <foreignObject x="48" y="120" width="${width - 96}" height="${height - 220}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font: 500 36px/1.35 ui-sans-serif, 'PingFang SC', sans-serif; color:#161616;">${body}</div>
  </foreignObject>
  <text x="48" y="${height - 40}" font-family="ui-sans-serif, 'PingFang SC', sans-serif" font-size="18" fill="#667">${hint}</text>
</svg>
`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {ImageSlotRequest & { generator?: ImageGenerator }} req
 * @returns {Promise<{ path: string, placeholder: boolean, prompt: string }>}
 */
export async function fillIllustrationSlot(req) {
  const { outPath, prompt, generator } = req;
  await mkdir(dirname(outPath), { recursive: true });
  if (typeof generator === 'function') {
    try {
      const produced = await generator(req);
      if (produced) return { path: produced, placeholder: false, prompt };
    } catch (err) {
      // Fall through to a placeholder; do not block ingest.
      console.error(`生图槽 ${basename(outPath)} 调用失败，改用占位：${err.message || err}`);
    }
  }
  await writeFile(outPath, placeholderSvg(req), 'utf8');
  return { path: outPath, placeholder: true, prompt: prompt || '' };
}

/**
 * Pick a few illustration prompts from the cleaned transcript.
 * Prefer sentence-like chunks spread across the timeline.
 */
export function pickIllustrationSlots(cleanWords, opts = {}) {
  const max = opts.max ?? 4;
  const minGap = opts.minGap ?? 12;
  if (!cleanWords?.length) return [];
  const groups = [];
  let cur = [];
  for (let i = 0; i < cleanWords.length; i++) {
    const w = cleanWords[i];
    cur.push(w);
    const next = cleanWords[i + 1];
    const punct = /[。！？!?；;]$/.test(w.text);
    const pause = next ? next.start - w.end > 0.5 : true;
    if (punct || pause) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length) groups.push(cur);
  const candidates = groups
    .map((g) => ({
      start: g[0].start,
      end: g[g.length - 1].end,
      text: g.map((w) => w.text).join(''),
      score: scorePrompt(g),
    }))
    .filter((c) => c.text.replace(/\s+/g, '').length >= 4)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  for (const c of candidates) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.abs(p.start - c.start) < minGap)) continue;
    picked.push(c);
  }
  picked.sort((a, b) => a.start - b.start);
  return picked.map((c, i) => ({
    id: `illus-${i + 1}`,
    index: i + 1,
    at: c.start,
    duration: Math.max(3.2, Math.min(8, (c.end - c.start) + 2.4)),
    prompt: c.text.slice(0, 80),
  }));
}

function scorePrompt(group) {
  const text = group.map((w) => w.text).join('');
  let score = Math.min(text.length, 24);
  if (/[0-9一二三四五六七八九十]/.test(text)) score += 8;
  if (/方法|步骤|原因|结果|关键|首先|因此|所以|比如|核心|原则/.test(text)) score += 12;
  if (text.length < 6) score -= 6;
  return score;
}
