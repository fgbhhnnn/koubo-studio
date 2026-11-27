import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, basename, isAbsolute, parse as parsePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcribeFile, loadTranscript, sanitizeErrorBody } from './transcribe.mjs';
import { planCuts, formatPlanSummary } from './plan.mjs';
import { refinePlanWithLlm } from './llm.mjs';
import { cutMedia } from './cut.mjs';
import { buildProject } from './project.mjs';
import { createCompatImageGenerator, hasImageKey } from './images.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KOUBO_ROOT = resolve(HERE, '..', '..', '..');

function print(io, ...args) {
  (io.stdout || process.stdout).write(args.join(' ') + '\n');
}
function printErr(io, ...args) {
  (io.stderr || process.stderr).write(args.join(' ') + '\n');
}

const USAGE = `koubo — Koubo Studio：口播自动去废话，套模板生成可剪辑工程，并在同一个编辑器里精修、导出

  koubo ingest <video> [--out 目录] [--title 标题] [--transcript json]
  koubo transcribe <video> --out transcript.json
  koubo plan <transcript.json> [--out plan.json] [--duration 秒]
  koubo cut <video> <plan.json> --out clean.mp4
  koubo project --plan plan.json --media clean.mp4 --out 目录 [--title 标题]
  koubo open [目录]              用 Studio 打开工程
  koubo look [目录|时间]         抽帧 / 联系表
  koubo render [目录] [a-b]      导出 MP4
  koubo studio                   从源码启动 Studio（浏览器）
  koubo desktop                  从源码启动桌面端
  koubo get | skills | skill | doctor | publish | <插件命令>
                                 编辑器与插件命令（同一套 CLI，不必再记另一条命令）

环境变量：ELEVENLABS_API_KEY（转写）、可选 KOUBO_SCRIBE_MODEL（默认 scribe_v2）。
逻辑整理：KOUBO_LLM_API_KEY（或 OPENAI_API_KEY）、KOUBO_LLM_BASE_URL、KOUBO_LLM_MODEL（默认 gpt6.2sol）。
生图：KOUBO_IMAGE_API_KEY（默认同 LLM 密钥）、KOUBO_IMAGE_BASE_URL（默认同 LLM base）、KOUBO_IMAGE_MODEL（默认 GPT Image 2.6 Sunburst）。
没有这些密钥时仍用规则引擎和占位图。不要把密钥写进工程、日志或仓库。
`;

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--version' || a === '-v') flags.version = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else args.push(a);
  }
  return { args, flags };
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

export async function runCli(argv, io = {}) {
  const cwd = io.cwd || process.cwd();
  const env = io.env || process.env;
  const { args, flags } = parseArgs(argv);
  if (flags.version && !args.length) { print(io, 'koubo 0.1.0'); return 0; }
  if (flags.help && !args.length) { print(io, USAGE); return 0; }
  /* humans get the product usage; an in-app agent with no args gets the editor system prompt */
  if (!args.length) {
    if (env.OPENFILM_AGENT || flags.prompt) {
      return await runEditorArgv([], { cwd, env, io });
    }
    print(io, USAGE);
    return 0;
  }

  const cmd = args[0];
  try {
    if (cmd === 'ingest') return await cmdIngest(args.slice(1), flags, { cwd, env, io });
    if (cmd === 'transcribe') return await cmdTranscribe(args.slice(1), flags, { cwd, env, io });
    if (cmd === 'plan') return await cmdPlan(args.slice(1), flags, { cwd, env, io });
    if (cmd === 'cut') return await cmdCut(args.slice(1), flags, { cwd, env, io });
    if (cmd === 'project') return await cmdProject(args.slice(1), flags, { cwd, env, io });
    if (cmd === 'desktop') {
      return await runDesktop({ cwd, env, io });
    }
    if (cmd === 'studio') {
      return await runStudio({ cwd, env, io });
    }
    /* open/look/render plus get/skills/doctor/publish and plugin verbs all live in the editor module */
    return await runEditor(cmd, args.slice(1), flags, { cwd, env, io });
  } catch (err) {
    printErr(io, err.message || String(err));
    return 1;
  }
}

function abs(p, cwd) {
  return isAbsolute(p) ? p : resolve(cwd, p);
}

async function cmdTranscribe(rest, flags, ctx) {
  const input = rest[0] || flags.input;
  if (!input) throw new Error('请提供视频或音频路径。');
  const out = flags.out || rest[1];
  if (!out) throw new Error('请用 --out 指定转写 JSON 路径。');
  print(ctx.io, '正在调用 ElevenLabs 词级转写…');
  const data = await transcribeFile(abs(input, ctx.cwd), {
    apiKey: ctx.env.ELEVENLABS_API_KEY,
    model: flags.model || ctx.env.KOUBO_SCRIBE_MODEL,
    languageCode: flags.language || flags['language-code'],
  });
  const dest = abs(out, ctx.cwd);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(data, null, 2) + '\n', 'utf8');
  print(ctx.io, `转写完成：${data.words?.length || 0} 个词，已写入 ${dest}`);
  return 0;
}

async function cmdPlan(rest, flags, ctx) {
  const input = rest[0];
  if (!input) throw new Error('请提供转写 JSON。');
  const transcript = await loadTranscript(abs(input, ctx.cwd));
  const duration = flags.duration != null ? Number(flags.duration) : (transcript.audio_duration_secs || undefined);
  let plan = planCuts(transcript, { duration });
  plan = await refinePlanWithLlm(plan, { env: ctx.env, transcript });
  const dest = flags.out ? abs(flags.out, ctx.cwd) : null;
  if (dest) {
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, JSON.stringify(plan, null, 2) + '\n', 'utf8');
  }
  print(ctx.io, formatPlanSummary(plan));
  if (plan.llm?.used) print(ctx.io, `大模型整理：${plan.llm.reason}${plan.llm.note ? ' — ' + plan.llm.note : ''}`);
  else if (plan.llm?.reason && plan.llm.reason !== 'no-key') print(ctx.io, `大模型整理未应用：${plan.llm.reason}${plan.llm.status ? ' ' + plan.llm.status : ''}`);
  if (dest) print(ctx.io, `方案已写入 ${dest}`);
  return 0;
}

async function cmdCut(rest, flags, ctx) {
  const video = rest[0];
  const planPath = rest[1];
  const out = flags.out;
  if (!video || !planPath || !out) throw new Error('用法：koubo cut <video> <plan.json> --out clean.mp4');
  const plan = JSON.parse(await (await import('node:fs/promises')).readFile(abs(planPath, ctx.cwd), 'utf8'));
  if (!plan.keeps?.length) throw new Error('方案里没有保留区间。');
  const dest = abs(out, ctx.cwd);
  await mkdir(dirname(dest), { recursive: true });
  print(ctx.io, `正在按 ${plan.keeps.length} 段保留区间裁切…`);
  await cutMedia({ input: abs(video, ctx.cwd), output: dest, keeps: plan.keeps });
  print(ctx.io, `干净口播已写入 ${dest}`);
  return 0;
}

async function cmdProject(rest, flags, ctx) {
  const planPath = flags.plan;
  const media = flags.media;
  const out = flags.out;
  if (!planPath || !media || !out) throw new Error('用法：koubo project --plan plan.json --media clean.mp4 --out 目录');
  const plan = JSON.parse(await (await import('node:fs/promises')).readFile(abs(planPath, ctx.cwd), 'utf8'));
  const result = await buildProject({
    outDir: abs(out, ctx.cwd),
    title: flags.title || '口播成片',
    cleanVideo: abs(media, ctx.cwd),
    plan,
    env: ctx.env,
    imageGenerator: createCompatImageGenerator(ctx.env),
  });
  print(ctx.io, `工程已生成：${result.film}`);
  if (hasImageKey(ctx.env)) print(ctx.io, '插图槽已尝试调用生图接口；失败的槽位会保留占位图。');
  print(ctx.io, `打开：pnpm koubo open ${result.outDir}`);
  return 0;
}

async function cmdIngest(rest, flags, ctx) {
  const input = rest[0];
  if (!input) throw new Error('用法：koubo ingest <视频> [--out 目录] [--title 标题] [--transcript json]');
  const video = abs(input, ctx.cwd);
  if (!existsSync(video)) throw new Error(`找不到视频：${input}`);
  const title = flags.title || parsePath(video).name;
  const outDir = abs(flags.out || join(cwdOr(ctx), 'projects', safeName(title)), ctx.cwd);
  await mkdir(join(outDir, 'koubo'), { recursive: true });
  await mkdir(join(outDir, 'assets'), { recursive: true });

  let transcript;
  if (flags.transcript) {
    print(ctx.io, `读取已有转写：${flags.transcript}`);
    transcript = await loadTranscript(abs(flags.transcript, ctx.cwd));
  } else {
    print(ctx.io, '正在调用 ElevenLabs 词级转写…');
    transcript = await transcribeFile(video, {
      apiKey: ctx.env.ELEVENLABS_API_KEY,
      model: flags.model || ctx.env.KOUBO_SCRIBE_MODEL,
      languageCode: flags.language || flags['language-code'],
    });
  }
  const transcriptPath = join(outDir, 'koubo', 'transcript.json');
  await writeFile(transcriptPath, JSON.stringify(transcript, null, 2) + '\n', 'utf8');
  print(ctx.io, `转写完成：${transcript.words?.length || 0} 个词`);

  let duration = transcript.audio_duration_secs;
  if (!Number.isFinite(duration)) duration = await probeDuration(video);
  let plan = planCuts(transcript, { duration });
  plan = await refinePlanWithLlm(plan, { env: ctx.env, transcript });
  const planPath = join(outDir, 'koubo', 'plan.json');
  await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8');
  print(ctx.io, formatPlanSummary(plan));
  if (plan.needsReview) print(ctx.io, '注意：方案已标记为需要审看，重复/说错重来未硬剪。');

  const cleanPath = join(outDir, 'assets', 'talking-clean.mp4');
  print(ctx.io, `正在按方案裁切干净口播轨（${plan.keeps.length} 段）…`);
  await cutMedia({ input: video, output: cleanPath, keeps: plan.keeps });

  const result = await buildProject({
    outDir,
    title,
    cleanVideo: cleanPath,
    plan,
    env: ctx.env,
    imageGenerator: createCompatImageGenerator(ctx.env),
  });
  if (plan.llm?.used) print(ctx.io, `大模型整理：${plan.llm.reason}${plan.llm.note ? ' — ' + plan.llm.note : ''}`);
  if (hasImageKey(ctx.env)) print(ctx.io, '插图槽已尝试调用生图接口；失败的槽位会保留占位图。');
  print(ctx.io, `工程已生成：${result.film}`);
  print(ctx.io, `打开编辑器：pnpm koubo open ${outDir}`);
  print(ctx.io, `抽帧检查：pnpm koubo look ${outDir} 0-3`);
  print(ctx.io, `导出 MP4：pnpm koubo render ${outDir}`);
  return 0;
}

function cwdOr(ctx) { return ctx.cwd || process.cwd(); }

function safeName(s) {
  return String(s).replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'koubo-project';
}

/** Editor subcommands that live in @koubo/editor/cli (plus plugin verbs). */
const EDITOR_COMMANDS = new Set(['open', 'look', 'render', 'get', 'skills', 'skill', 'update', 'doctor', 'publish']);

/**
 * Run an editor command by importing @koubo/editor/cli (same process when possible).
 * The editor CLI still uses process.exit / process.cwd / process.env in places, so we
 * align those with this invocation. This is a module call, not a second package's bin.
 */
class CliExit extends Error {
  constructor(code) {
    super(`cli-exit:${code}`);
    this.code = code;
    this.name = 'CliExit';
  }
}

async function runEditor(cmd, rest, flags, ctx) {
  const argv = [cmd, ...rest];
  for (const [k, v] of Object.entries(flags)) {
    argv.push(`--${k}`);
    if (v !== true) argv.push(String(v));
  }
  return runEditorArgv(argv, ctx);
}

async function runEditorArgv(argv, ctx) {
  const prevCwd = process.cwd();
  const prevExit = process.exit;
  const prevExitCode = process.exitCode;
  const prevEnv = {
    OPENFILM_NO_UPDATE_CHECK: process.env.OPENFILM_NO_UPDATE_CHECK,
    KOUBO_RUN: process.env.KOUBO_RUN,
    OPENFILM_RUN: process.env.OPENFILM_RUN,
  };
  process.exit = (code) => {
    const n = code ?? 0;
    process.exitCode = n;
    throw new CliExit(n);
  };
  try {
    if (ctx.cwd && ctx.cwd !== prevCwd) process.chdir(ctx.cwd);
    process.env.OPENFILM_NO_UPDATE_CHECK = ctx.env?.OPENFILM_NO_UPDATE_CHECK || '1';
    if (!process.env.KOUBO_RUN && !process.env.OPENFILM_RUN) process.env.KOUBO_RUN = 'koubo';
    const { runEditorCli } = await import('@koubo/editor/cli');
    const code = await runEditorCli(argv, { run: process.env.OPENFILM_RUN || process.env.KOUBO_RUN || 'koubo' });
    return code ?? process.exitCode ?? 0;
  } catch (err) {
    if (err instanceof CliExit) return err.code;
    throw err;
  } finally {
    process.exit = prevExit;
    process.exitCode = prevExitCode ?? 0;
    try { process.chdir(prevCwd); } catch { /* ignore */ }
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function runDesktop(ctx) {
  const script = join(KOUBO_ROOT, 'package.json');
  if (!existsSync(script)) throw new Error('请在 Koubo Studio 仓库根目录运行。');
  print(ctx.io, '正在从源码启动 Koubo Studio 桌面端…');
  const pnpm = existsSync(join(KOUBO_ROOT, 'node_modules', '.bin', 'pnpm')) ? join(KOUBO_ROOT, 'node_modules', '.bin', 'pnpm') : 'pnpm';
  return await new Promise((resolve) => {
    const child = spawn(pnpm, ['dev:desktop'], { cwd: KOUBO_ROOT, env: ctx.env, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      printErr(ctx.io, err.message);
      resolve(1);
    });
  });
}

async function runStudio(ctx) {
  const script = join(KOUBO_ROOT, 'package.json');
  if (!existsSync(script)) throw new Error('请在 Koubo Studio 仓库根目录运行。');
  print(ctx.io, '正在从源码启动 Studio（浏览器）…');
  const pnpm = existsSync(join(KOUBO_ROOT, 'node_modules', '.bin', 'pnpm')) ? join(KOUBO_ROOT, 'node_modules', '.bin', 'pnpm') : 'pnpm';
  return await new Promise((resolve) => {
    const child = spawn(pnpm, ['dev'], { cwd: KOUBO_ROOT, env: ctx.env, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      printErr(ctx.io, err.message);
      resolve(1);
    });
  });
}

export { USAGE, sanitizeErrorBody, runEditor, EDITOR_COMMANDS };
