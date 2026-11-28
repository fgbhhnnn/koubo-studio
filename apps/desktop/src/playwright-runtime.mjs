/**
 * The packaged Playwright headless-shell tree (resources/runtime/ms-playwright).
 * A missing exe, empty file, or Windows extract without its DLLs is what shows
 * up later as `browserType.launch: spawn UNKNOWN`.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REVISION = /^chromium_headless_shell-/;
const SHELL = {
  win32: { folder: /^chrome-headless-shell-win/, exe: 'chrome-headless-shell.exe' },
  darwin: { folder: /^chrome-headless-shell-mac/, exe: 'chrome-headless-shell' },
  linux: { folder: /^chrome-headless-shell-linux/, exe: 'chrome-headless-shell' },
};

/**
 * @param {string} browsersDir `PLAYWRIGHT_BROWSERS_PATH` (runtime/ms-playwright)
 * @param {string} [platform]
 * @returns {{ exe: string | null, dir: string | null, revision: string | null, missing: string[], errors: string[] }}
 */
export function inspectPlaywrightRuntime(browsersDir, platform = process.platform) {
  /** @type {string[]} */
  const errors = [];
  const missing = [];
  const spec = SHELL[platform] ?? SHELL.linux;
  if (!browsersDir || !existsSync(browsersDir)) {
    errors.push(`No Playwright browsers directory at ${browsersDir || '(none)'}.`);
    return { exe: null, dir: null, revision: null, missing, errors };
  }
  const revision = readdirSync(browsersDir).find((name) => REVISION.test(name)) ?? null;
  if (!revision) {
    errors.push(`No chromium_headless_shell revision under ${browsersDir}.`);
    return { exe: null, dir: null, revision: null, missing, errors };
  }
  const revDir = join(browsersDir, revision);
  const folder = readdirSync(revDir).find((name) => spec.folder.test(name)) ?? null;
  if (!folder) {
    errors.push(`No ${spec.folder} folder under ${revDir} (wrong-platform extract?).`);
    return { exe: null, dir: null, revision, missing, errors };
  }
  const dir = join(revDir, folder);
  const exe = join(dir, spec.exe);
  if (!existsSync(exe)) {
    missing.push(spec.exe);
    errors.push(`Missing ${spec.exe} in ${dir}.`);
  } else {
    const size = statSync(exe).size;
    if (size < 10_000) errors.push(`${spec.exe} is too small (${size} bytes) to be a real browser.`);
  }
  const siblings = existsSync(dir) ? readdirSync(dir) : [];
  if (platform === 'win32') {
    if (!siblings.some((name) => /\.dll$/i.test(name))) {
      missing.push('*.dll');
      errors.push(`No DLLs next to ${spec.exe}: an incomplete extract cannot be spawned (spawn UNKNOWN).`);
    }
    if (!siblings.includes('icudtl.dat')) {
      missing.push('icudtl.dat');
      errors.push(`Missing icudtl.dat next to ${spec.exe}.`);
    }
    if (!siblings.some((name) => /\.pak$/i.test(name))) {
      missing.push('*.pak');
      errors.push(`Missing .pak resources next to ${spec.exe}.`);
    }
  }
  return { exe: existsSync(exe) ? exe : null, dir, revision, missing, errors };
}

/**
 * @param {string} browsersDir
 * @param {{ platform?: string }} [opts]
 */
export function assertPlaywrightRuntime(browsersDir, { platform = process.platform } = {}) {
  const found = inspectPlaywrightRuntime(browsersDir, platform);
  if (found.errors.length) {
    throw new Error(`Packaged Playwright runtime is unspawnable:\n${found.errors.map((e) => `  ${e}`).join('\n')}`);
  }
  return found;
}
