import { mkdir, writeFile, copyFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillIllustrationSlot, pickIllustrationSlots, createCompatImageGenerator } from './images.mjs';
import { formatPlanSummary } from './plan.mjs';
import { TEMPLATES_ROOT, CLASSIC_PACK_DIR, ILLUSTRATION_HTML } from '@koubo/templates';

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
  if (includeClassic && existsSync(join(CLASSIC_PACK_DIR, 'lib.js'))) {
    await embedClassicUnit(outDir, { duration });
  }

  const film = renderFilmHtml({
    title,
    width,
    height,
    duration,
    talkRel,
    illustrations: filled,
    hasClassic: includeClassic && existsSync(join(outDir, 'scenes', 'classic-unit.html')),
  });
  await writeFile(join(outDir, 'film.html'), film, 'utf8');

  await writeFile(join(dataDir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf8');
  await writeFile(join(dataDir, 'illustrations.json'), JSON.stringify(filled, null, 2) + '\n', 'utf8');
  await writeFile(join(dataDir, 'README.md'), renderProjectNotes({ title, plan, filled }), 'utf8');
  const workflow = workflowRecord(opts, plan);
  await writeFile(join(dataDir, 'workflow.json'), JSON.stringify(workflow, null, 2) + '\n', 'utf8');

  const skillSrc = join(HERE, '..', 'skills', 'koubo-talking', 'SKILL.md');
  const skillDst = join(outDir, 'skills', 'koubo-talking', 'SKILL.md');
  if (existsSync(skillSrc)) await copyFile(skillSrc, skillDst);

  return {
    outDir,
    film: join(outDir, 'film.html'),
    duration,
    illustrations: filled,
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

function renderFilmHtml({ title, width, height, duration, talkRel, illustrations, hasClassic }) {
  const d = duration.toFixed(4);
  const illusClips = illustrations.map((slot) => {
    const left = 1240;
    const top = 96;
    const w = 600;
    const h = 380;
    return `  <iframe id="${escapeHtml(slot.id)}" src="scenes/${escapeHtml(slot.id)}.html#t=0,${slot.duration.toFixed(4)}" at="${slot.at.toFixed(4)}" style="left: ${left}px; top: ${top}px; width: ${w}px; height: ${h}px"></iframe>`;
  }).join('\n');

  const classicSection = hasClassic
    ? `\n<section hidden>\n  <!-- Optional classic unit (adapted authored-unit, official badge off). Hidden by default; enable in Studio if you want that style as a B-roll. -->\n  <iframe id="classic-unit" src="scenes/classic-unit.html#t=0,15.466" at="0" disabled style="left: 80px; top: 80px; width: 1120px; height: 630px"></iframe>\n</section>`
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
  <iframe id="captions" src="scenes/captions.html#t=0,${d}" at="0" style="left: 0px; top: 760px; width: ${width}px; height: 320px"></iframe>
</section>${illusSection}${classicSection}
<section>
  <video id="talk" src="${escapeHtml(talkRel)}#t=0,${d}" at="0" style="object-fit: cover"></video>
</section>
</body>
</html>
`;
}

function renderCaptionsPage({ title, duration, words, width, height }) {
  const data = {
    title,
    duration,
    words: words.map((w) => ({
      text: w.text,
      start: Number(w.start.toFixed(3)),
      end: Number(w.end.toFixed(3)),
    })),
  };
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
  .word { display: inline-block; margin-right: 0.18em; opacity: 0.28; transform: translateY(12px); filter: blur(4px); }
  .word.on { opacity: 1; transform: none; filter: none; color: #fff; }
  .word.cur { color: #8cb4ff; }
</style>
</head>
<body>
<div id="stage"><div class="bar" id="bar"></div></div>
<script>
const DATA = ${json};
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function build() {
  const bar = document.getElementById('bar');
  bar.replaceChildren();
  DATA.words.forEach((w, i) => {
    const s = document.createElement('span');
    s.className = 'word';
    s.dataset.i = String(i);
    s.textContent = w.text;
    bar.appendChild(s);
  });
}
build();
function frame(t) {
  const nodes = document.querySelectorAll('.word');
  DATA.words.forEach((w, i) => {
    const el = nodes[i];
    if (!el) return;
    const appear = t >= w.start - 0.08;
    const current = t >= w.start && t <= w.end + 0.05;
    el.classList.toggle('on', appear);
    el.classList.toggle('cur', current);
    if (appear) {
      const k = clamp((t - (w.start - 0.12)) / 0.18, 0, 1);
      el.style.opacity = String(0.28 + 0.72 * k);
      el.style.transform = 'translateY(' + ((1 - k) * 12).toFixed(1) + 'px)';
      el.style.filter = k < 1 ? ('blur(' + ((1 - k) * 4).toFixed(1) + 'px)') : 'none';
    } else {
      el.style.opacity = '0.18';
    }
  });
}
window.film = { duration: DATA.duration, frame };
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
window.film = { duration: DURATION, frame };
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

async function embedClassicUnit(outDir, { duration }) {
  const dest = join(outDir, 'scenes', 'classic-runtime');
  await mkdir(dest, { recursive: true });
  for (const name of ['lib.js', 'motion.js', 'config.js', 'style.css', 'main.js', 'LICENSE', 'README.md']) {
    const src = join(CLASSIC_PACK_DIR, name);
    if (existsSync(src)) await copyFile(src, join(dest, name));
  }
  await copyPackFiles(join(CLASSIC_PACK_DIR, 'units'), join(dest, 'units'));
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<title>classic-unit</title>
<link rel="stylesheet" href="classic-runtime/style.css">
</head>
<body>
<div id="world"></div>
<div id="fx"></div>
<script src="classic-runtime/config.js"></script>
<script>window.CONFIG = Object.assign({ hideOfficialBadge: true, showOfficialBadge: false, end: 15.466 }, window.CONFIG || {});</script>
<script src="classic-runtime/lib.js"></script>
<script src="classic-runtime/motion.js"></script>
<script src="classic-runtime/units/claim-into-container.js"></script>
<script src="classic-runtime/main.js"></script>
<script>
/* Wrap the authored-unit renderAt(t) clock as window.film.frame(t). Audio stays on the film timeline, not in this page. */
function whenReady() {
  const render = window.renderAt;
  const wait = window.imgWait;
  const duration = 15.466;
  window.film = {
    duration,
    frame(t) {
      if (typeof render === 'function') render(t);
      if (typeof wait === 'function') return wait();
    }
  };
}
if (window.READY && typeof window.READY.then === 'function') {
  window.READY.then(whenReady);
} else {
  whenReady();
}
</script>
</body>
</html>
`;
  await writeFile(join(outDir, 'scenes', 'classic-unit.html'), html, 'utf8');
  void duration;
}

function renderProjectNotes({ title, plan, filled }) {
  return `# ${title}

这是 Koubo Studio 生成的口播工程，可用本仓库的 Studio / 桌面端打开 \`film.html\`，用左侧对话继续改字幕、插图或裁切，再导出 MP4。

${formatPlanSummary(plan)}

## 插图槽

${filled.length ? filled.map((s) => `- \`${s.id}\` @ ${s.at.toFixed(2)}s（${s.placeholder ? '占位图' : '已生成'}）：${s.prompt}`).join('\n') : '（本片没有自动插入插图槽）'}

手改会进 OpenFilm 格式的 \`overrides\`，智能体再改时不应覆盖。口播和 BGM 只走时间线音轨，不要在镜头页里播放声音。
`;
}


function shouldIncludeClassic(templateId) {
  if (!templateId) return true;
  return templateId === 'classic-performance';
}

function workflowRecord(opts, plan) {
  const templateId = opts.templateId || plan?.template?.id || 'classic-performance';
  const templateSource = opts.templateSource || plan?.template?.source || 'auto';
  return {
    mode: 'talking-head',
    title: opts.title || null,
    templateId,
    templateSource,
    sourceVideoName: opts.sourceVideoName || null,
    needsReview: Boolean(plan?.needsReview),
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

export const __test__ = { renderFilmHtml, renderCaptionsPage, escapeHtml, shouldIncludeClassic, workflowRecord, copyPackFiles };

