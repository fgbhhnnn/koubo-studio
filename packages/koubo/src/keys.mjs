/**
 * Koubo secrets on this computer: `~/.config/koubo/*.env` (dir 0700, files 0600).
 * Never log, print, or write a key into a project, a fixture, or a commit.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const ELEVENLABS_ENV = 'elevenlabs.env';
export const LLM_ENV = 'llm.env';

export function kouboConfigDir(home = homedir()) {
  return join(home, '.config', 'koubo');
}

export function elevenLabsKeyFile(home = homedir()) {
  return join(kouboConfigDir(home), ELEVENLABS_ENV);
}

export function llmEnvFile(home = homedir()) {
  return join(kouboConfigDir(home), LLM_ENV);
}

/** Parse a dotenv-style file. A bare line is treated as a raw value under `VALUE`. */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      if (!out.VALUE) out.VALUE = unquote(trimmed);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    out[key] = unquote(trimmed.slice(eq + 1).trim());
  }
  return out;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnvFile(path) {
  try {
    if (!existsSync(path)) return null;
    return parseEnvFile(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* best-effort on platforms that ignore mode */ }
}

function writeAtomic(path, text, mode = 0o600) {
  ensurePrivateDir(dirname(path));
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, text, { mode, flag: 'w' });
  try { chmodSync(tmp, mode); } catch { /* ignore */ }
  renameSync(tmp, path);
  try { chmodSync(path, mode); } catch { /* ignore */ }
}

/**
 * Last four characters of a key, for status UI. Empty when missing.
 * @param {string} [key]
 */
export function last4(key) {
  const s = String(key || '');
  return s.length >= 4 ? s.slice(-4) : '';
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, home?: string, file?: string }} [opts]
 * @returns {{ key: string, source: 'env' | 'file' } | null}
 */
export function readElevenLabsKey(opts = {}) {
  const env = opts.env || process.env;
  const fromEnv = String(env.ELEVENLABS_API_KEY || '').trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };
  const path = opts.file || elevenLabsKeyFile(opts.home);
  const parsed = readEnvFile(path);
  if (!parsed) return null;
  const key = String(parsed.ELEVENLABS_API_KEY || parsed.XI_API_KEY || parsed.VALUE || '').trim();
  return key ? { key, source: 'file' } : null;
}

/**
 * Status only — never includes the key itself.
 * @param {{ env?: NodeJS.ProcessEnv, home?: string, file?: string }} [opts]
 */
export function elevenLabsKeyStatus(opts = {}) {
  const found = readElevenLabsKey(opts);
  if (!found) return { hasKey: false, last4: '', source: null };
  return { hasKey: true, last4: last4(found.key), source: found.source };
}

/**
 * Store the ElevenLabs key under `~/.config/koubo/elevenlabs.env` (0600).
 * Pass an empty string to delete the file. Never writes into a project tree.
 * @param {string} key
 * @param {{ home?: string, file?: string }} [opts]
 */
export function writeElevenLabsKey(key, opts = {}) {
  const path = opts.file || elevenLabsKeyFile(opts.home);
  const value = String(key || '').trim();
  if (!value) {
    try { if (existsSync(path)) unlinkSync(path); } catch { /* ignore */ }
    return { hasKey: false, last4: '', source: null };
  }
  writeAtomic(path, `ELEVENLABS_API_KEY=${value}\n`, 0o600);
  return { hasKey: true, last4: last4(value), source: 'file' };
}

/**
 * Merge env-file keys into a copy of `env` when those variables are not already set.
 * Used so CLI and desktop ingest share the same files. Does not log values.
 * @param {{ env?: NodeJS.ProcessEnv, home?: string }} [opts]
 */
export function loadKouboEnv(opts = {}) {
  const env = { ...(opts.env || process.env) };
  const eleven = readElevenLabsKey({ env, home: opts.home });
  if (eleven?.key && !String(env.ELEVENLABS_API_KEY || '').trim()) {
    env.ELEVENLABS_API_KEY = eleven.key;
  }
  const llm = readEnvFile(llmEnvFile(opts.home));
  if (llm) {
    for (const [k, v] of Object.entries(llm)) {
      if (k === 'VALUE' || !v) continue;
      if (!String(env[k] || '').trim()) env[k] = v;
    }
  }
  return env;
}

/** Redact anything that looks like a secret from a progress or error string. */
export function sanitizePublicText(text, limit = 400) {
  return String(text || '')
    .replace(/sk_[a-zA-Z0-9]+/g, '[redacted]')
    .replace(/xi-api-key["'\s:=]+[^\s"',}]+/gi, 'xi-api-key=[redacted]')
    .replace(/["']?api[_-]?key["']?\s*[:=]\s*["']?[^\s"',}]+/gi, 'api_key=[redacted]')
    .replace(/ELEVENLABS_API_KEY\s*=\s*\S+/g, 'ELEVENLABS_API_KEY=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}
