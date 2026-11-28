import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPlaywrightRuntime, inspectPlaywrightRuntime } from './playwright-runtime.mjs';

function tree(platform = 'win32') {
  const root = mkdtempSync(join(tmpdir(), 'pw-runtime-'));
  const browsers = join(root, 'ms-playwright');
  const dir = join(browsers, 'chromium_headless_shell-1228', platform === 'win32' ? 'chrome-headless-shell-win64' : 'chrome-headless-shell-mac-arm64');
  mkdirSync(dir, { recursive: true });
  return { browsers, dir };
}

test('an incomplete Windows Playwright extract is reported unspawnable', () => {
  const { browsers, dir } = tree('win32');
  writeFileSync(join(dir, 'chrome-headless-shell.exe'), 'tiny');
  const found = inspectPlaywrightRuntime(browsers, 'win32');
  assert.ok(found.errors.some((e) => /too small|No DLLs|icudtl|pak/i.test(e)));
  assert.throws(() => assertPlaywrightRuntime(browsers, { platform: 'win32' }), /unspawnable/);
});

test('a complete Windows layout passes the pack check', () => {
  const { browsers, dir } = tree('win32');
  writeFileSync(join(dir, 'chrome-headless-shell.exe'), Buffer.alloc(12_000, 1));
  writeFileSync(join(dir, 'chrome.dll'), Buffer.alloc(100, 1));
  writeFileSync(join(dir, 'icudtl.dat'), 'icu');
  writeFileSync(join(dir, 'resources.pak'), 'pak');
  const found = assertPlaywrightRuntime(browsers, { platform: 'win32' });
  assert.match(found.exe, /chrome-headless-shell\.exe$/);
  assert.equal(found.errors.length, 0);
});

test('a missing revision folder fails the pack check', () => {
  const root = mkdtempSync(join(tmpdir(), 'pw-runtime-empty-'));
  mkdirSync(join(root, 'ms-playwright'));
  const found = inspectPlaywrightRuntime(join(root, 'ms-playwright'), 'win32');
  assert.match(found.errors.join('\n'), /chromium_headless_shell/);
});
