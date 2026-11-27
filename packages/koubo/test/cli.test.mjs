import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli, USAGE, EDITOR_COMMANDS } from '../src/cli.mjs';

function io() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    out,
    err,
    text: () => out.join(''),
  };
}

test('bare koubo prints product usage, not a second command name', async () => {
  const c = io();
  const code = await runCli([], { stdout: c.stdout, stderr: c.stderr, cwd: process.cwd(), env: { ...process.env } });
  assert.equal(code, 0);
  assert.match(c.text(), /koubo ingest/);
  assert.match(c.text(), /koubo open/);
  assert.match(c.text(), /koubo render/);
  assert.doesNotMatch(c.text(), /找不到本项目的渲染/);
});

test('--help is the same usage', async () => {
  const c = io();
  assert.equal(await runCli(['--help'], { stdout: c.stdout, stderr: c.stderr, env: {} }), 0);
  assert.equal(c.text(), USAGE + '\n');
});

test('--version prints the product version', async () => {
  const c = io();
  assert.equal(await runCli(['--version'], { stdout: c.stdout, stderr: c.stderr, env: {} }), 0);
  assert.match(c.text(), /koubo 0\.1\.0/);
});

test('editor subcommands are a fixed set the product CLI owns', () => {
  for (const cmd of ['open', 'look', 'render', 'get', 'skills', 'doctor']) {
    assert.ok(EDITOR_COMMANDS.has(cmd), cmd);
  }
});
