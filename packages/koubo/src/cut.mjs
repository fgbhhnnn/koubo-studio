import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Build an ffmpeg filter_complex that keeps the given source ranges, in order.
 * Video and audio are trimmed and concatenated so lip-sync is preserved.
 *
 * @param {{start:number,end:number}[]} keeps
 * @param {{hasVideo?: boolean, hasAudio?: boolean}} [opts]
 */
export function buildFilterComplex(keeps, opts = {}) {
  const hasVideo = opts.hasVideo !== false;
  const hasAudio = opts.hasAudio !== false;
  if (!keeps.length) throw new Error('裁切方案没有保留区间。');
  const parts = [];
  const concatPads = [];
  keeps.forEach((k, i) => {
    const start = k.start.toFixed(6);
    const end = k.end.toFixed(6);
    if (hasVideo) parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
    if (hasVideo && hasAudio) concatPads.push(`[v${i}][a${i}]`);
    else if (hasVideo) concatPads.push(`[v${i}]`);
    else concatPads.push(`[a${i}]`);
  });
  const n = keeps.length;
  if (hasVideo && hasAudio) {
    parts.push(`${concatPads.join('')}concat=n=${n}:v=1:a=1[v][a]`);
  } else if (hasVideo) {
    parts.push(`${concatPads.join('')}concat=n=${n}:v=1:a=0[v]`);
  } else {
    parts.push(`${concatPads.join('')}concat=n=${n}:v=0:a=1[a]`);
  }
  return parts.join(';');
}

/**
 * Write a concat demuxer list as a fallback (re-encode still recommended).
 */
export function writeConcatList(keeps, sourcePath) {
  return keeps
    .map((k) => {
      const dur = (k.end - k.start).toFixed(6);
      return `file '${escapeConcatPath(sourcePath)}'\ninpoint ${k.start.toFixed(6)}\noutpoint ${k.end.toFixed(6)}\nduration ${dur}`;
    })
    .join('\n') + '\n';
}

function escapeConcatPath(p) {
  return String(p).replace(/'/g, "'\\''");
}

function run(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const err = new Error(`${cmd} 退出码 ${code}`);
        err.stderr = sanitizeFfmpeg(stderr);
        err.code = code;
        reject(err);
      }
    });
  });
}

function sanitizeFfmpeg(text) {
  return String(text || '')
    .replace(/sk_[a-zA-Z0-9]+/g, '[redacted]')
    .split('\n')
    .slice(-20)
    .join('\n');
}

async function probeStreams(input) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type',
    '-of', 'csv=p=0',
    input,
  ]);
  const kinds = stdout.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  return { hasVideo: kinds.includes('video'), hasAudio: kinds.includes('audio') };
}

/**
 * Cut `input` to `output` using keep ranges. Re-encodes for accurate cuts.
 *
 * @param {{ input: string, output: string, keeps: {start:number,end:number}[], ffmpeg?: string }} opts
 */
export async function cutMedia(opts) {
  const { input, output, keeps } = opts;
  if (!keeps?.length) throw new Error('裁切方案没有保留区间。');
  const streams = await probeStreams(input);
  if (!streams.hasVideo && !streams.hasAudio) throw new Error('输入没有视频或音频流。');
  const filter = buildFilterComplex(keeps, streams);
  const args = ['-y', '-i', input, '-filter_complex', filter];
  if (streams.hasVideo) args.push('-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p');
  if (streams.hasAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', output);
  try {
    await run(opts.ffmpeg || 'ffmpeg', args);
  } catch (err) {
    err.message = `按方案裁切失败：${err.message}${err.stderr ? `\n${err.stderr}` : ''}`;
    throw err;
  }
  return { output, keeps: keeps.length, hasVideo: streams.hasVideo, hasAudio: streams.hasAudio };
}

export async function writeTempConcatList(keeps, sourcePath) {
  const dir = await mkdtemp(join(tmpdir(), 'koubo-cut-'));
  const list = join(dir, 'concat.txt');
  await writeFile(list, writeConcatList(keeps, sourcePath), 'utf8');
  return { dir, list, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
