import { mkdir, writeFile, copyFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillIllustrationSlot, pickIllustrationSlots, createCompatImageGenerator } from './images.mjs';
import { formatPlanSummary } from './plan.mjs';
import {
  TEMPLATES_ROOT,
  CLASSIC_PACK_DIR,
  ILLUSTRATION_HTML,
  assignUnits,
  bindAuthoredBlock,
  loadUnitsManifest,
  sceneById,
  renderUnitPage,
} from '@koubo/templates';

const HERE = dirname(fileURLToPath(import.meta.url));
/** @deprecated use TEMPLATES_ROOT from @koubo/templates */
export const TEMPLATES_DIR = TEMPLATES_ROOT;
export { CLASSIC_PACK_DIR, ILLUSTRATION_HTML };

/**
 * Build a Koubo Studio / OpenFilm-format project from a cut plan and clean media.
 *
 * @param {{
 *   outDir: string,
 *   title?: string,
 *   cleanVideo: string,
 *   plan: object,
 *   width?: number,
 *   height?: number,
 *   illustrations?: object[],
 *   imageGenerator?: Function,
 *   env?: object,
 *   includeClassicUnit?: boolean,
 *   templateId?: string,
 *   templateSource?: 'user' | 'auto',
 *   sourceVideoName?: string,
 * }} opts
 */
export async function buildProject(opts) {
  const outDir = opts.outDir;
  const title = opts.title || '口播成片';
  const width = opts.width || 1920;
  const height = opts.height || 1080;
  const plan = opts.plan;
  const duration = Number(plan.cleanDuration.toFixed(4));
  if (!opts.cleanVideo) throw new Error('缺少干净口播视频。');

  const scenesDir = join(outDir, 'scenes');
  const assetsDir = join(outDir, 'assets');
  const illusDir = join(assetsDir, 'illustrations');
  const dataDir = join(outDir, 'koubo');
  await mkdir(scenesDir, { recursive: true });
  await mkdir(illusDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(outDir, 'skills', 'koubo-talking'), { recursive: true });

  const talkDest = join(assetsDir, `talking-clean${extname(opts.cleanVideo) || '.mp4'}`);
  if (resolve(opts.cleanVideo) !== resolve(talkDest)) {
    await copyFile(opts.cleanVideo, talkDest);
  }
  const talkRel = `assets/${basename(talkDest)}`;

  const slots = opts.illustrations || pickIllustrationSlots(plan.words || []);
  const filled = [];
  for (const slot of slots) {
    const dest = join(illusDir, `${slot.id}.png`);
    const result = await fillIllustrationSlot({
      prompt: slot.prompt,
      outPath: dest,
      index: slot.index,
      width: 960,
      height: 600,
      generator: opts.imageGenerator ?? (opts.env ? createCompatImageGenerator(opts.env) : null),
    });
    const clipEnd = Math.min(duration, slot.at + slot.duration);
    const clipDur = Math.max(0.8, clipEnd - slot.at);
    filled.push({
      ...slot,
      duration: clipDur,
      src: `assets/illustrations/${basename(result.path)}`,
      placeholder: result.placeholder,
    });
  }

  const captionsHtml = renderCaptionsPage({
    title,
    duration,
    words: plan.words || [],
    width,
    height: 320,
  });
  await writeFile(join(scenesDir, 'captions.html'), captionsHtml, 'utf8');

  const illustrationHtml = await readTemplate('illustration.html');
  await writeFile(join(scenesDir, 'illustration.html'), illustrationHtml, 'utf8');
  for (const slot of filled) {
    const page = renderIllustrationPage(slot);
    await writeFile(join(scenesDir, `${slot.id}.html`), page, 'utf8');
  }

  const includeClassic = opts.includeClassicUnit ?? shouldIncludeClassic(opts.templateId);
  let units = [];
  if (includeClassic && existsSync(join(CLASSIC_PACK_DIR, 'lib.js'))) {
    units = await embedClassicUnits(outDir, {
      duration,
      plan,
      templateId: opts.templateId || plan?.template?.id,
      talkRel,
      illustrations: filled,
    });
  }

  const film = renderFilmHtml({
    title,
    width,
    height,
    duration,
    talkRel,
    illustrations: filled,
    units,
  });
  await writeFile(join(outDir, 'film.html'), film, 'utf8');

  await writeFile(join(dataDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf8');
  await writeFile(join(dataDir, 'illustrations.json'), JSON.stringify(filled, null, 2) + '\n', 'utf8');
  await writeFile(join(dataDir, 'units.json'), JSON.stringify(units, null, 2) + '\n', 'utf8');
  await writeFile(join(dataDir, 'README.md'), renderProjectNotes({ title, plan, filled, units }), 'utf8');
  const workflow = workflowRecord(opts, plan, units);
  await writeFile(join(dataDir, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n', 'utf8');

  const skillSrc = join(HERE, '..', 'skills', 'koubo-talking', 'SKILL.md');
  const skillDst = join(outDir, 'skills', 'koubo-talking', 'SKILL.md');
  if (existsSync(skillSrc)) await copyFile(skillSrc, skillDst);

  return {
    outDir,
    film: join(outDir, 'film.html'),
    duration,
    illustrations: filled,
    units,
    templateId: workflow.templateId,
    templateSource: workflow.templateSource,
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderFilmHtml({ title, width, height, duration, talkRel, illustrations, units = [] }) {
  const d = duration.toFixed(4);
  const illusClips = illustrations.map((slot) => {
    const left = 1240;
    const top = 96;
    const w = 600;
    const h = 380;
    return `  <iframe id="${escapeHtml(slot.id)}" src="scenes/${escapeHtml(slot.id)}.html#t=0,${slot.duration.toFixed(4)}" at="${slot.at.toFixed(4)}" size="960x600" style="left: ${left}px; top: ${top}px; width: ${w}px; height: ${h}px"></iframe>`;
  }).join('\n');

  const unitClips = (units || []).map((clip) => {
    const dur = Number(clip.duration).toFixed(4);
    const at = Number(clip.at).toFixed(4);
    return `  <iframe id="${escapeHtml(clip.id)}" src="scenes/${escapeHtml(clip.id)}.html#t=0,${dur}" at="${at}" size="1920x1080" style="left: 0px; top: 0px; width: ${width}px; height: ${height}px"></iframe>`;
  }).join('\n');

  const unitSection = unitClips
    ? `\n<section>\n${unitClips}\n</section>`
    : '';
  const illusSection = illustrations.length
    ? `\n<section>\n${illusClips}\n</section>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}">
<title>${escapeHtml(title)}</title>
</head>
<body>
<section>
  <iframe id="captions" src="scenes/captions.html#t=0,${d}" at="0" size="${width}x320" style="left: 0px; top: 760px; width: ${width}px; height: 320px"></iframe>
</section>${illusSection}${unitSection}
<section>
  <video id="talk" src="${escapeHtml(talkRel)}#t=0,${d}" at="0" style="object-fit: cover"></video>
</section>
</body>
</html>
`;
}

/** Visible width of a caption token, in CJK-em units (one Han character = 1). */
function captionCharUnits(text) {
  let units = 0;
  for (const ch of String(text)) {
    if (/[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE10-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch)) units += 1;
    else if (/\s/.test(ch)) units += 0.3;
    else units += 0.55;
  }
  return Math.max(units, 0.55);
}

function isCaptionHardBreak(text) {
  return /[。！？!?；;]$/.test(String(text));
}

function isCaptionSoftBreak(text) {
  return /[，、,]$/.test(String(text));
}

function isSkippedCaptionToken(text) {
  const s = String(text ?? '').trim();
  if (!s) return true;
  return /^\[[^\]]+\]$/.test(s);
}

/**
 * Pack word-level timestamps into one-line cues: break on sentence punctuation,
 * on pauses, and before the bar would overflow. Non-current lines must not stay
 * in the bar's layout (see renderCaptionsPage).
 */
function groupCaptionLines(words, opts = {}) {
  const maxUnits = opts.maxUnits ?? 24;
  const pauseGap = opts.pauseGap ?? 0.45;
  const lines = [];
  let cur = [];
  let units = 0;

  const flush = () => {
    if (!cur.length) return;
    lines.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      words: cur,
    });
    cur = [];
    units = 0;
  };

  for (const raw of words || []) {
    const text = String(raw.text ?? '');
    if (isSkippedCaptionToken(text)) continue;
    const word = {
      text,
      start: Number(raw.start),
      end: Number(raw.end),
    };
    const u = captionCharUnits(word.text);
    const prev = cur[cur.length - 1];
    const gap = prev ? word.start - prev.end : 0;
    if (cur.length && ((prev && gap >= pauseGap) || units + u > maxUnits)) flush();
    cur.push(word);
    units += u;
    if (isCaptionHardBreak(word.text)) flush();
    else if (isCaptionSoftBreak(word.text) && units >= maxUnits * 0.55) flush();
  }
  flush();
  return mergeShortCaptionLines(lines, maxUnits, pauseGap);
}

/** Fold a width-wrap orphan into the previous line. Do not undo a punctuation or pause break. */
function mergeShortCaptionLines(lines, maxUnits, pauseGap) {
  const hardMax = maxUnits + 4;
  const unitsOf = (line) => line.words.reduce((n, w) => n + captionCharUnits(w.text), 0);
  const out = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const u = unitsOf(line);
    const hard = prev && isCaptionHardBreak(prev.words[prev.words.length - 1].text);
    const gap = prev ? line.start - prev.end : 0;
    if (prev && !hard && gap < pauseGap && u <= 6 && unitsOf(prev) + u <= hardMax) {
      prev.words = prev.words.concat(line.words);
      prev.end = line.end;
    } else {
      out.push({ start: line.start, end: line.end, words: line.words.slice() });
    }
  }
  return out;
}

/**
 * Which cue is on screen at t: the line that covers t, held until the next
 * line starts. Returns -1 before the first line (unless it begins almost immediately).
 */
function captionLineAt(lines, t, duration = 0, opts = {}) {
  const lead = opts.lead ?? 0.08;
  if (!lines?.length) return -1;
  if (t < lines[0].start - lead) return lines[0].start <= 0.8 ? 0 : -1;
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    const until = next ? next.start - lead : (Number(duration) || lines[i].end) + 1;
    if (t < until) return i;
  }
  return lines.length - 1;
}

function renderCaptionsPage({ title, duration, words, width, height }) {
  const lines = groupCaptionLines(words).map((line) => ({
    start: Number(line.start.toFixed(3)),
    end: Number(line.end.toFixed(3)),
    words: line.words.map((w) => ({
      text: w.text,
      start: Number(w.start.toFixed(3)),
      end: Number(w.end.toFixed(3)),
    })),
  }));
  const data = { title, duration, width, height, lines };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}">
<title>captions</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  #stage { position: relative; width: ${width}px; height: ${height}px; }
  .bar {
    position: absolute; left: 80px; right: 80px; bottom: 48px;
    min-height: 120px; padding: 22px 36px 26px;
    border-radius: 28px;
    background: linear-gradient(180deg, rgba(10,10,12,.55), rgba(10,10,12,.78));
    color: #fff;
    font: 700 52px/1.25 "PingFang SC", "Noto Sans SC", "Source Han Sans SC", ui-sans-serif, sans-serif;
    letter-spacing: 0.02em;
    text-shadow: 0 2px 12px rgba(0,0,0,.35);
  }
  .word { display: inline-block; margin-right: 0.18em; opacity: 0.45; color: #fff; }
  .word.on { opacity: 1; }
  .word.cur { color: #8cb4ff; }
</style>
</head>
<body>
<div id="stage"><div class="bar" id="bar"></div></div>
<script>
const DATA = ${json};
function lineIndexAt(t) {
  const lines = DATA.lines || [];
  const lead = 0.08;
  if (!lines.length) return -1;
  if (t < lines[0].start - lead) return lines[0].start <= 0.8 ? 0 : -1;
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    const until = next ? next.start - lead : (DATA.duration || lines[i].end) + 1;
    if (t < until) return i;
  }
  return lines.length - 1;
}
let shown = -1;
function paint(i) {
  const bar = document.getElementById('bar');
  bar.replaceChildren();
  if (i < 0) return;
  DATA.lines[i].words.forEach((w) => {
    const s = document.createElement('span');
    s.className = 'word';
    s.textContent = w.text;
    bar.appendChild(s);
  });
}
function frame(t) {
  const i = lineIndexAt(t);
  if (i !== shown) { shown = i; paint(i); }
  if (i < 0) return;
  const line = DATA.lines[i];
  const nodes = document.getElementById('bar').querySelectorAll('.word');
  line.words.forEach((w, k) => {
    const el = nodes[k];
    if (!el) return;
    const appear = t >= w.start - 0.08;
    const current = t >= w.start && t <= w.end + 0.05;
    el.classList.toggle('on', appear);
    el.classList.toggle('cur', current);
  });
}
window.film = { duration: DATA.duration, width: DATA.width, height: DATA.height, frame };
if (!window.filmHost) {
  const t0 = performance.now();
  const loop = () => {
    const t = ((performance.now() - t0) / 1000) % (DATA.duration || 1);
    frame(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
</script>
</body>
</html>
`;
}


function renderIllustrationPage(slot) {
  const src = escapeHtml('../' + slot.src);
  const label = escapeHtml(slot.prompt || '');
  const duration = Number(slot.duration || 4);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=960, height=600">
<title>${escapeHtml(slot.id)}</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  #card {
    position: absolute; inset: 0;
    border-radius: 28px;
    overflow: hidden;
    background: #f6f4ee;
    box-shadow: 0 18px 50px rgba(0,0,0,.22);
    transform-origin: 50% 50%;
  }
  #card img { width: 100%; height: 100%; object-fit: cover; display: block; }
  #label {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 16px 22px 20px;
    font: 600 28px/1.3 "PingFang SC", "Noto Sans SC", ui-sans-serif, sans-serif;
    color: #fff;
    background: linear-gradient(transparent, rgba(0,0,0,.62));
  }
</style>
</head>
<body>
<div id="card"><img id="pic" alt="" src="${src}"><div id="label">${label}</div></div>
<script>
const DURATION = ${duration.toFixed(4)};
function frame(t) {
  const fade = Math.max(0, Math.min(1, t / 0.28));
  const outStart = DURATION - 0.28;
  const fadeOut = t > outStart ? Math.max(0, 1 - (t - outStart) / 0.28) : 1;
  const k = fade * fadeOut;
  const el = document.getElementById('card');
  el.style.opacity = String(k);
  el.style.transform = 'translateY(' + ((1 - k) * 24).toFixed(1) + 'px) scale(' + (0.96 + 0.04 * k).toFixed(3) + ')';
}
window.film = { duration: DURATION, width: 960, height: 600, frame };
if (!window.filmHost) {
  const t0 = performance.now();
  const loop = () => { frame((performance.now() - t0) / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
</script>
</body>
</html>
`;
}

async function readTemplate(name) {
  return readFile(join(TEMPLATES_DIR, name), 'utf8');
}

/**
 * Copy every file under `src` into `dest` with mkdir + copyFile.
 * Packed Electron asar trees allow readdir and copyFile of individual files,
 * but not a recursive directory copy of a packed folder.
 */
async function copyPackFiles(src, dest) {
  if (!existsSync(src)) return;
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) await copyPackFiles(from, to);
    else await copyFile(from, to);
  }
}

async function embedClassicRuntime(outDir) {
  const dest = join(outDir, 'scenes', 'classic-runtime');
  await mkdir(dest, { recursive: true });
  for (const name of ['lib.js', 'motion.js', 'config.js', 'style.css', 'main.js', 'LICENSE', 'README.md']) {
    const src = join(CLASSIC_PACK_DIR, name);
    if (existsSync(src)) await copyFile(src, join(dest, name));
  }
  await copyPackFiles(join(CLASSIC_PACK_DIR, 'units'), join(dest, 'units'));
}

function unitTalkRel(talkRel) {
  if (!talkRel) return '';
  return talkRel.startsWith('../') ? talkRel : `../${talkRel}`;
}

function pickSeqMedia(clip, illustrations) {
  if (clip.unitId !== 'evidence-focus') return {};
  const srcs = (illustrations || []).map((s) => s.src).filter(Boolean);
  const media = {};
  const keys = ['soft_match', 'soft_tpl', 'prev'];
  keys.forEach((key, i) => {
    const src = srcs[i] || srcs[0];
    if (src) media[key] = src.startsWith('../') ? src : `../${src}`;
  });
  return media;
}

async function writeEvidenceFallback(outDir, clip, seqMedia) {
  if (clip.unitId !== 'evidence-focus') return seqMedia;
  if (seqMedia.soft_match && seqMedia.soft_tpl && seqMedia.prev) return seqMedia;
  const dir = join(outDir, 'assets', 'unit-media');
  await mkdir(dir, { recursive: true });
  const title = clip.slots?.['text-03'] || clip.slots?.['text-01'] || '本期对照';
  const result = clip.slots?.['text-11'] || clip.slots?.['text-10'] || title;
  const cards = [
    ['soft_match', title],
    ['soft_tpl', title],
    ['prev', result],
  ];
  const next = { ...seqMedia };
  for (const [key, label] of cards) {
    if (next[key]) continue;
    const file = `${clip.id}-${key}.svg`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
<rect width="960" height="600" fill="#161616"/>
<rect x="48" y="48" width="864" height="504" rx="28" fill="#1f1f1f" stroke="#333"/>
<text x="80" y="280" fill="#f7f7f5" font-size="48" font-family="PingFang SC, sans-serif">${escapeHtml(label)}</text>
</svg>
`;
    await writeFile(join(dir, file), svg, 'utf8');
    next[key] = `../assets/unit-media/${file}`;
  }
  return next;
}

async function embedClassicUnits(outDir, { duration, plan, templateId, talkRel, illustrations }) {
  const assigned = assignUnits(plan, { templateId });
  if (!assigned.clips.length) return [];
  await embedClassicRuntime(outDir);
  const manifest = loadUnitsManifest();
  const boundDir = join(outDir, 'scenes', 'classic-runtime', 'bound');
  await mkdir(boundDir, { recursive: true });
  const talk = unitTalkRel(talkRel);
  const written = [];
  for (const clip of assigned.clips) {
    const scene = sceneById(manifest, clip.unitId);
    const sourceName = basename(scene.sourceCodeFile || `${clip.unitId}.js`);
    const sourcePath = join(CLASSIC_PACK_DIR, 'units', sourceName);
    const source = await readFile(sourcePath, 'utf8');
    const { block } = bindAuthoredBlock(source, scene, clip.slots, clip.id);
    const boundName = `${clip.id}.js`;
    await writeFile(join(boundDir, boundName), block, 'utf8');
    let seqMedia = pickSeqMedia(clip, illustrations);
    seqMedia = await writeEvidenceFallback(outDir, clip, seqMedia);
    const html = renderUnitPage({
      clip,
      talkRel: talk,
      seqMedia,
      boundScript: block,
    });
    await writeFile(join(outDir, 'scenes', `${clip.id}.html`), html, 'utf8');
    written.push({
      ...clip,
      page: `scenes/${clip.id}.html`,
      seqMedia,
    });
  }
  void duration;
  return written;
}

function renderProjectNotes({ title, plan, filled, units = [] }) {
  return `# ${title}

这是 Koubo Studio 生成的口播工程，可用本仓库的 Studio / 桌面端打开 \`film.html\`，用左侧对话继续改字幕、插图或裁切，再导出 MP4。

${formatPlanSummary(plan)}

## 插图槽

${filled.length ? filled.map((s) => `- \`${s.id}\` @ ${s.at.toFixed(2)}s（${s.placeholder ? '占位图' : '已生成'}）：${s.prompt}`).join('\n') : '（本片没有自动插入插图槽）'}

## 阿杜镜头单位

${units.length ? units.map((u) => `- \`${u.id}\`（${u.unitId}）@ ${Number(u.at).toFixed(2)}s，${Number(u.duration).toFixed(2)}s`).join('\n') : '（本片时长不够，或未选择口播讲解模板，没有排入镜头单位）'}

手改会进 OpenFilm 格式的 \`overrides\`，智能体再改时不应覆盖。口播和 BGM 只走时间线音轨，不要在镜头页里播放声音。官方面标默认关闭。当前版本尚未做面部追踪。
`;
}


function shouldIncludeClassic(templateId) {
  if (!templateId) return true;
  return templateId === 'classic-performance';
}

function workflowRecord(opts, plan, units = []) {
  const templateId = opts.templateId || plan?.template?.id || 'classic-performance';
  const templateSource = opts.templateSource || plan?.template?.source || 'auto';
  return {
    mode: 'talking-head',
    title: opts.title || null,
    templateId,
    templateSource,
    sourceVideoName: opts.sourceVideoName || null,
    needsReview: Boolean(plan?.needsReview),
    unitCount: Array.isArray(units) ? units.length : 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Rebuild film.html and template pages from an existing plan and clean talking-head track,
 * after the person picks a different pack in the editor.
 *
 * @param {{ outDir: string, templateId: string, env?: object, imageGenerator?: Function }} opts
 */
export async function reapplyTemplate(opts) {
  const { readFile } = await import('node:fs/promises');
  const { assignTemplate, getTemplate } = await import('@koubo/templates');
  const outDir = opts.outDir;
  const planPath = join(outDir, 'koubo', 'plan.json');
  const workflowPath = join(outDir, 'koubo', 'workflow.json');
  if (!existsSync(planPath)) throw new Error('此工程没有口播方案，无法更换模板。');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const chosen = assignTemplate({ id: opts.templateId });
  getTemplate(chosen.template.id);
  const cleanVideo = join(outDir, 'assets', 'talking-clean.mp4');
  if (!existsSync(cleanVideo)) throw new Error('找不到干净口播轨，无法更换模板。');
  let title = '口播成片';
  if (existsSync(workflowPath)) {
    try {
      const prev = JSON.parse(await readFile(workflowPath, 'utf8'));
      if (prev.title) title = prev.title;
    } catch { /* ignore */ }
  }
  if (existsSync(join(outDir, 'film.html'))) {
    const html = await readFile(join(outDir, 'film.html'), 'utf8');
    const m = html.match(/<title>([^<]*)<\/title>/);
    if (m?.[1]) title = m[1];
  }
  plan.template = { id: chosen.template.id, source: 'user', name: chosen.template.name || null };
  let sourceVideoName = null;
  if (existsSync(workflowPath)) {
    try { sourceVideoName = JSON.parse(await readFile(workflowPath, 'utf8')).sourceVideoName || null; } catch { /* ignore */ }
  }
  return buildProject({
    outDir,
    title,
    cleanVideo,
    plan,
    env: opts.env,
    imageGenerator: opts.imageGenerator,
    templateId: chosen.template.id,
    templateSource: 'user',
    sourceVideoName,
  });
}

export const __test__ = { renderFilmHtml, renderCaptionsPage, escapeHtml, shouldIncludeClassic, workflowRecord, copyPackFiles, groupCaptionLines, captionLineAt, captionCharUnits, embedClassicUnits, pickSeqMedia };

