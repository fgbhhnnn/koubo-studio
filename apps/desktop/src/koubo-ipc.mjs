/**
 * Desktop talking-head (口播) workflow: key storage, template list, one-shot ingest,
 * and re-applying a template on an existing project. Runs in the app process and
 * talks to the page over IPC. Secrets stay in ~/.config/koubo and never go into
 * a project, a log line, or a progress event.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, parse as parsePath, relative } from 'node:path';
import {
  ingestTalkingHead, reapplyTemplate, safeName, listTemplates,
  elevenLabsKeyStatus, writeElevenLabsKey, loadKouboEnv, sanitizePublicText,
  explainNetworkError,
} from 'koubo';
import { videoDialogOptions } from './folder-dialog.mjs';
import { kouboWorkflowWords } from './i18n/koubo-workflow.mjs';

export const KOUBO_STEPS = ['transcribe', 'plan', 'cut', 'project', 'done'];

function wordsOf(options) {
  const language = typeof options?.language === 'function' ? options.language() : options?.language;
  return kouboWorkflowWords(language);
}

/**
 * Validate what the page sent for a one-shot ingest. The API key, if the person
 * just pasted one, is returned separately and never copied onto the public request.
 * @param {unknown} raw
 * @param {string} [language]
 */
export function ingestRequestOf(raw, language = 'en') {
  const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const video = typeof o.video === 'string' ? o.video : '';
  if (!video || !isAbsolute(video)) throw new Error(kouboWorkflowWords(language).noVideo);
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 120) : parsePath(video).name;
  const templateId = typeof o.templateId === 'string' && o.templateId.trim() ? o.templateId.trim() : null;
  const key = typeof o.apiKey === 'string' ? o.apiKey.trim() : '';
  const saveKey = o.saveKey !== false;
  return {
    request: { video, title, templateId, mode: 'talking-head' },
    apiKey: key || null,
    saveKey,
  };
}

/** A progress or result payload the page may show: no secrets. */
export function publicProgress(event) {
  const step = typeof event?.step === 'string' ? event.step : '';
  return {
    step,
    message: sanitizePublicText(event?.message || ''),
    ...(event?.projectId ? { projectId: String(event.projectId) } : {}),
    ...(event?.error ? { error: sanitizePublicText(event.error) } : {}),
  };
}

const PREVIEW_TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/**
 * Turn a pack-relative preview file into a data URL the page can show.
 * Absolute paths and anything that would leave the pack are dropped.
 */
export function publicPreview(template) {
  const name = typeof template?.preview === 'string' ? template.preview.trim() : '';
  const root = typeof template?.path === 'string' ? template.path : '';
  if (!name || !root) return '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return '';
  const type = PREVIEW_TYPES[extname(name).toLowerCase()];
  if (!type) return '';
  const file = join(root, name);
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return '';
  try {
    const buf = readFileSync(file);
    if (!buf.length || buf.length > 512 * 1024) return '';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

export function publicTemplates(list = listTemplates()) {
  return list.map((t) => ({
    id: t.id,
    kind: t.kind,
    name: t.name || { 'zh-CN': t.id, en: t.id },
    description: t.description || '',
    units: t.units || [],
    preview: publicPreview(t),
  }));
}

/**
 * @param {{
 *   ipcMain: import('electron').IpcMain,
 *   fromPage: (event: import('electron').IpcMainInvokeEvent) => boolean,
 *   dialog: { showOpenDialog: Function },
 *   win: () => import('electron').BaseWindow | import('electron').BrowserWindow | null,
 *   studioApi: (path: string, method?: string, body?: unknown) => Promise<any>,
 *   openProject: (path: string) => Promise<{ id: string, path?: string, name?: string } | null>,
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   log?: (line: string) => void,
 *   ingest?: typeof ingestTalkingHead,
 *   reapply?: typeof reapplyTemplate,
 * }} options
 */
export function registerKouboIpc(ipcMain, options) {
  const home = options.home;
  const envOf = () => loadKouboEnv({ env: options.env || process.env, home });
  const trusted = (event) => options.fromPage(event);

  ipcMain.handle('desktop:koubo-templates', (event) => (trusted(event) ? publicTemplates() : []));

  ipcMain.handle('desktop:koubo-key-status', (event) => (trusted(event) ? elevenLabsKeyStatus({ env: envOf(), home }) : { hasKey: false, last4: '', source: null }));

  ipcMain.handle('desktop:koubo-key-set', (event, value) => {
    if (!trusted(event)) return { hasKey: false, last4: '', source: null };
    const key = typeof value === 'string' ? value : (value && typeof value === 'object' ? String(value.key || '') : '');
    return writeElevenLabsKey(key, { home });
  });

  ipcMain.handle('desktop:koubo-pick-video', async (event, words) => {
    if (!trusted(event)) return null;
    const win = options.win?.() ?? null;
    const { canceled, filePaths } = await options.dialog.showOpenDialog(win ?? undefined, videoDialogOptions(words, typeof options.language === 'function' ? options.language() : options.language));
    return canceled || !filePaths[0] ? null : filePaths[0];
  });

  ipcMain.handle('desktop:koubo-ingest', async (event, raw) => {
    if (!trusted(event)) return { ok: false, error: 'unauthorized' };
    try {
      return await runDesktopIngest(raw, { ...options, sender: event.sender });
    } catch (err) {
      const error = sanitizePublicText(publicIngestError(err, wordsOf(options)));
      options.log?.(`koubo ingest failed: ${error}\n`);
      return { ok: false, error };
    }
  });

  ipcMain.handle('desktop:koubo-workflow', async (event, folder) => {
    if (!trusted(event) || typeof folder !== 'string' || !isAbsolute(folder)) return null;
    return readWorkflow(folder);
  });

  ipcMain.handle('desktop:koubo-change-template', async (event, raw) => {
    if (!trusted(event)) return { ok: false, error: 'unauthorized' };
    try {
      const o = raw && typeof raw === 'object' ? raw : {};
      const folder = typeof o.path === 'string' ? o.path : '';
      const templateId = typeof o.templateId === 'string' ? o.templateId.trim() : '';
      if (!folder || !isAbsolute(folder) || !templateId) throw new Error(wordsOf(options).noTemplate);
      const reapply = options.reapply || reapplyTemplate;
      const result = await reapply({ outDir: folder, templateId, env: envOf() });
      return { ok: true, templateId: result.templateId, templateSource: result.templateSource, path: result.outDir };
    } catch (err) {
      const error = sanitizePublicText(err?.message || String(err));
      return { ok: false, error };
    }
  });
}

/**
 * @param {unknown} raw
 * @param {Parameters<typeof registerKouboIpc>[1]} options
 */
export async function runDesktopIngest(raw, options) {
  const words = wordsOf(options);
  const { request, apiKey, saveKey } = ingestRequestOf(raw, typeof options.language === 'function' ? options.language() : options.language);
  if (!existsSync(request.video)) throw new Error(words.videoMissing);
  if (apiKey && saveKey) writeElevenLabsKey(apiKey, { home: options.home });
  const env = loadKouboEnv({ env: options.env || process.env, home: options.home });
  if (apiKey) env.ELEVENLABS_API_KEY = apiKey;

  const locations = await options.studioApi('/api/locations').catch(() => null);
  const library = locations?.projects?.path;
  if (!library || typeof library !== 'string') throw new Error(words.noLibrary);
  const outDir = uniqueProjectDir(library, request.title, words.noProjectDir);

  const sender = options.sender;
  const ingest = options.ingest || ingestTalkingHead;
  const result = await ingest({
    video: request.video,
    outDir,
    title: request.title,
    templateId: request.templateId,
    env,
    home: options.home,
    apiKey: apiKey || undefined,
    onProgress: (event) => {
      const payload = publicProgress(event);
      sender?.send?.('desktop:koubo-progress', payload);
    },
  });

  const project = await openProjectRetry(options.openProject, result.outDir, options.log);
  const payload = publicProgress({
    step: 'done',
    message: words.done,
    projectId: project?.id,
  });
  sender?.send?.('desktop:koubo-progress', payload);
  return {
    ok: true,
    path: result.outDir,
    projectId: project?.id ?? null,
    templateId: result.templateId,
    templateSource: result.templateSource,
    needsReview: Boolean(result.needsReview),
  };
}

/**
 * Open the ingested folder in Studio, a few times: a long ingest can leave the
 * local API briefly unready, and a raw "fetch failed" must not hide a project
 * that is already on disk.
 * @param {(path: string) => Promise<{ id: string, path?: string, name?: string } | null>} openProject
 * @param {string} folder
 * @param {(line: string) => void} [log]
 */
export async function openProjectRetry(openProject, folder, log, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const project = await openProject(folder);
      if (project?.id) return project;
      last = new Error('openProject returned no id');
    } catch (err) {
      last = err;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  log?.(`koubo openProject failed after ingest: ${last?.message || last}\n`);
  return null;
}

/** An ingest error as shown in the wizard: a network failure says so, never only "fetch failed". */
export function publicIngestError(err, words) {
  const message = String(err?.message || err || '').trim();
  if (!message || /^fetch failed$/i.test(message) || /Failed to fetch/i.test(message)) {
    const explained = explainNetworkError(err, words.networkFailed);
    return explained && explained !== words.networkFailed ? explained : words.networkFailed;
  }
  if (/^fetch failed/i.test(message) || /Failed to fetch/i.test(message)) {
    return explainNetworkError(err, words.networkFailed);
  }
  return message;
}

export function uniqueProjectDir(library, title, noProjectDir = kouboWorkflowWords('en').noProjectDir) {
  const base = safeName(title);
  let dir = join(library, base);
  if (!existsSync(dir)) return dir;
  for (let n = 2; n < 1000; n++) {
    dir = join(library, `${base}-${n}`);
    if (!existsSync(dir)) return dir;
  }
  throw new Error(noProjectDir);
}

async function readWorkflow(folder) {
  const { readFile } = await import('node:fs/promises');
  const file = join(folder, 'koubo', 'workflow.json');
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!data || data.mode !== 'talking-head') return null;
    return {
      mode: 'talking-head',
      templateId: data.templateId || null,
      templateSource: data.templateSource || null,
      title: data.title || null,
      needsReview: Boolean(data.needsReview),
    };
  } catch {
    return null;
  }
}
