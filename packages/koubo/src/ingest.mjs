/**
 * Programmatic talking-head ingest: transcribe → plan → cut → project.
 * The CLI and the desktop wizard both call this. Do not put secrets in
 * progress messages, the project tree, or returned metadata.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, parse as parsePath } from 'node:path';
import { spawn } from 'node:child_process';
import { assignTemplate } from '@koubo/templates';
import { transcribeFile, loadTranscript } from './transcribe.mjs';
import { planCuts, formatPlanSummary } from './plan.mjs';
import { refinePlanWithLlm } from './llm.mjs';
import { cutMedia } from './cut.mjs';
import { buildProject } from './project.mjs';
import { createCompatImageGenerator, hasImageKey } from './images.mjs';
import { loadKouboEnv, readElevenLabsKey, sanitizePublicText } from './keys.mjs';

export const WORKFLOW_MODE = 'talking-head';

function safeName(s) {
  return String(s).replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'koubo-project';
}

async function probeDuration(file) {
  return new Promise((resolveDur, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      const n = parseFloat(out);
      if (code === 0 && Number.isFinite(n)) resolveDur(n);
      else reject(new Error('无法读取视频时长'));
    });
  });
}

/**
 * @param {{
 *   video: string,
 *   outDir: string,
 *   title?: string,
 *   transcript?: object,
 *   transcriptPath?: string,
 *   templateId?: string | null,
 *   env?: NodeJS.ProcessEnv,
 *   home?: string,
 *   apiKey?: string,
 *   onProgress?: (event: { step: string, message: string }) => void,
 *   transcribe?: typeof transcribeFile,
 *   plan?: typeof planCuts,
 *   refine?: typeof refinePlanWithLlm,
 *   cut?: typeof cutMedia,
 *   build?: typeof buildProject,
 *   assign?: typeof assignTemplate,
 *   probe?: typeof probeDuration,
 * }} opts
 */
export async function ingestTalkingHead(opts) {
  const video = opts.video;
  if (!video) throw new Error('请提供视频路径。');
  if (!existsSync(video)) throw new Error(`找不到视频：${basename(video)}`);
  const title = opts.title || parsePath(video).name;
  const outDir = opts.outDir;
  if (!outDir) throw new Error('请指定输出目录。');
  const say = (step, message) => {
    const clean = sanitizePublicText(message);
    opts.onProgress?.({ step, message: clean });
  };

  const env = loadKouboEnv({ env: opts.env || process.env, home: opts.home });
  if (opts.apiKey) env.ELEVENLABS_API_KEY = opts.apiKey;
  const assign = opts.assign || assignTemplate;
  const chosen = assign({ id: opts.templateId ?? null });

  await mkdir(join(outDir, 'koubo'), { recursive: true });
  await mkdir(join(outDir, 'assets'), { recursive: true });

  let transcript = opts.transcript;
  if (!transcript && opts.transcriptPath) {
    say('transcribe', `读取已有转写：${basename(opts.transcriptPath)}`);
    transcript = await loadTranscript(opts.transcriptPath);
  }
  if (!transcript) {
    const found = readElevenLabsKey({ env, home: opts.home });
    if (!found?.key && !opts.apiKey) {
      const err = new Error('未设置 ElevenLabs 密钥，无法调用转写。请在设置里填写，或设置 ELEVENLABS_API_KEY。');
      err.code = 'NO_API_KEY';
      throw err;
    }
    say('transcribe', '正在调用 ElevenLabs 词级转写…');
    const transcribe = opts.transcribe || transcribeFile;
    transcript = await transcribe(video, {
      apiKey: found?.key || opts.apiKey || env.ELEVENLABS_API_KEY,
      model: env.KOUBO_SCRIBE_MODEL,
    });
  }
  const transcriptPath = join(outDir, 'koubo', 'transcript.json');
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2) + '\n', 'utf8');
  say('transcribe', `转写完成：${transcript.words?.length || 0} 个词`);

  let duration = transcript.audio_duration_secs;
  if (!Number.isFinite(duration)) {
    const probe = opts.probe || probeDuration;
    duration = await probe(video);
  }
  say('plan', '正在根据时间戳出剪辑方案…');
  const planFn = opts.plan || planCuts;
  let plan = planFn(transcript, { duration });
  const refine = opts.refine || refinePlanWithLlm;
  plan = await refine(plan, { env, transcript });
  plan.template = {
    id: chosen.template.id,
    source: chosen.source,
    name: chosen.template.name || null,
  };
  const planPath = join(outDir, 'koubo', 'plan.json');
  await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8');
  say('plan', formatPlanSummary(plan));
  if (plan.needsReview) say('plan', '注意：方案已标记为需要审看，重复/说错重来未硬剪。');

  const cleanPath = join(outDir, 'assets', 'talking-clean.mp4');
  say('cut', `正在按方案裁切干净口播轨（${plan.keeps.length} 段）…`);
  const cut = opts.cut || cutMedia;
  await cut({ input: video, output: cleanPath, keeps: plan.keeps });

  say('project', `正在套用模板「${templateLabel(chosen.template)}」…`);
  const build = opts.build || buildProject;
  const result = await build({
    outDir,
    title,
    cleanVideo: cleanPath,
    plan,
    env,
    imageGenerator: createCompatImageGenerator(env),
    templateId: chosen.template.id,
    templateSource: chosen.source,
    sourceVideoName: basename(video),
  });
  if (plan.llm?.used) say('project', `大模型整理：${plan.llm.reason}${plan.llm.note ? ' — ' + plan.llm.note : ''}`);
  if (hasImageKey(env)) say('project', '插图槽已尝试调用生图接口；失败的槽位会保留占位图。');
  say('done', `工程已生成：${basename(result.film)}`);

  return {
    outDir: result.outDir,
    film: result.film,
    duration: result.duration,
    templateId: chosen.template.id,
    templateSource: chosen.source,
    needsReview: Boolean(plan.needsReview),
    keepCount: plan.keeps?.length || 0,
  };
}

function templateLabel(template) {
  const name = template?.name;
  if (name && typeof name === 'object') return name['zh-CN'] || name.en || template.id;
  return name || template.id;
}

export { safeName, probeDuration, templateLabel };
