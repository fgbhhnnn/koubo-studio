/**
 * The `koubo` command the chat's agents run: this app's copy, so the Studio it finds is the one in the window, at the
 * version the window runs. A small script in the app's data folder, put first on the agents' PATH; it runs the product
 * CLI (`koubo`, packages/koubo) with the app's own Node (Electron as Node). Reads no Electron module.
 *
 * A same-target `openfilm` shim is also written, so format skills that still say `openfilm look` keep working.
 * COMPAT: remove the shim once those skills have been rewritten to `koubo`.
 *
 * OPENFILM_NO_UPDATE_CHECK: the editor CLI must not nag about the npm `openfilm` package. The app updates itself.
 *
 * What the command alone needs from the app is set in it, not given to the agent: the app's ffmpeg first on its PATH
 * (`ffmpeg`) and the headless browser it draws pages in (`env`, PLAYWRIGHT_BROWSERS_PATH). The agent's own commands run
 * with the person's ffmpeg and their own browsers, as in their terminal.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { nodeBinary } from './node-runtime.mjs';

const require = createRequire(import.meta.url);

/** The product CLI (`koubo`). Falls back to the editor CLI if the pipeline package is not packed. */
export function kouboCli() {
  try {
    const manifest = require.resolve('koubo/package.json');
    return join(dirname(manifest), 'bin/koubo.mjs');
  } catch {
    return require.resolve('@koubo/editor/cli');
  }
}

/** @deprecated use kouboCli — kept for call sites that still use the old name */
export const openfilmCli = kouboCli;

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The script's text: Electron as Node, running the CLI with whatever it was given, with the app's ffmpeg and `env`. */
export function commandScript(node, cli, { ffmpeg = null, env = {} } = {}) {
  const set = [...Object.entries(env).map(([k, v]) => `${k}=${sq(v)}`), ...(ffmpeg ? [`PATH=${sq(ffmpeg)}:"$PATH"`] : [])];
  return `#!/bin/sh\n# Koubo Studio's copy of the koubo command (written by the app; changes are lost)\n${set.map((s) => `${s} `).join('')}ELECTRON_RUN_AS_NODE=1 OPENFILM_NO_UPDATE_CHECK=1 exec ${sq(node)} ${sq(cli)} "$@"\n`;
}

/** The same for Windows: a `.cmd` (what a command line there finds as `koubo`). */
export function commandScriptWindows(node, cli, { ffmpeg = null, env = {} } = {}) {
  // Inside `set "K=V"` quotes cmd already takes & | < > ^ literally; only % needs doubling.
  const esc = (v) => String(v).replace(/%/g, '%%');
  const set = [...Object.entries(env).map(([k, v]) => `set "${k}=${esc(v)}"\r\n`), ...(ffmpeg ? [`set "PATH=${esc(ffmpeg)};%PATH%"\r\n`] : [])];
  return `@echo off\r\nrem Koubo Studio's copy of the koubo command (written by the app; changes are lost)\r\nsetlocal\r\n${set.join('')}set ELECTRON_RUN_AS_NODE=1\r\nset OPENFILM_NO_UPDATE_CHECK=1\r\n"${esc(node)}" "${esc(cli)}" %*\r\n`;
}

/**
 * The command in `bin` as an agent's shell types it: its whole path, quoted. Some agents' shells read the person's
 * shell profile again (Codex, Cursor, CodeBuddy, Claude Code), and a PATH set there can put another `openfilm` before
 * the app's: an older one installed globally, on the person's own Studio. Told to an agent whose PATH the app cannot
 * keep (agents.mjs PATH_KEPT), which the CLI then prints it as (OPENFILM_RUN, set by the agent's session). Null on
 * Windows, where the name on the PATH is kept.
 */
export function openfilmCommand(bin, platform = process.platform) {
  return platform === 'win32' ? null : sq(`${bin}/koubo`);
}

/**
 * Write the command into `<dir>/bin` and answer that folder, for PATH. `ffmpeg`: the app's ffmpeg folder, first on the
 * command's PATH; `env`: what else it runs with. It names itself by its whole path (OPENFILM_RUN, openfilmCommand) in
 * all it prints, the system prompt too.
 */
export function installOpenfilmCommand(dir, { node = nodeBinary(), platform = process.platform, ffmpeg = null, env = {} } = {}) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const cli = kouboCli();
  if (platform === 'win32') {
    writeFileSync(join(bin, 'koubo.cmd'), commandScriptWindows(node, cli, { ffmpeg, env }));
    /* COMPAT: same target, for skills that still type `openfilm`. Delete when skills say `koubo`. */
    writeFileSync(join(bin, 'openfilm.cmd'), commandScriptWindows(node, cli, { ffmpeg, env }));
    return bin;
  }
  const file = join(bin, 'koubo');
  writeFileSync(file, commandScript(node, cli, { ffmpeg, env }));
  chmodSync(file, 0o755);
  const shim = join(bin, 'openfilm');
  writeFileSync(shim, commandScript(node, cli, { ffmpeg, env }));
  chmodSync(shim, 0o755);
  return bin;
}

/**
 * Claude Code's CLAUDE_ENV_FILE for an agent session: a script it runs before each of its commands, after the person's
 * shell profile, putting the app's `koubo` (in `bin`) first on the PATH, so the agent types it by its name. The
 * person's own file (`theirs`, their shell's CLAUDE_ENV_FILE) runs first. Written beside `bin`; null on Windows.
 * @param {string} bin @param {string} [theirs] @param {string} [platform]
 */
export function claudeEnvFile(bin, theirs, platform = process.platform) {
  if (platform === 'win32') return null;
  const file = join(dirname(bin), theirs ? `claude-env-${createHash('sha256').update(theirs).digest('hex').slice(0, 8)}.sh` : 'claude-env.sh');
  writeFileSync(file, `# Koubo Studio: the app's koubo first (written by the app; changes are lost)\n${theirs ? `[ -f ${sq(theirs)} ] && . ${sq(theirs)}\n` : ''}export PATH=${sq(bin)}:"$PATH"\n`);
  return file;
}
