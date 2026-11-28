import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBrowserSpawnFailure, explainBrowserSpawnFailure } from './host.mjs';

test('spawn UNKNOWN and a missing executable are launch failures the pack should have caught', () => {
  assert.equal(isBrowserSpawnFailure(new Error('browserType.launch: spawn UNKNOWN')), true);
  assert.equal(isBrowserSpawnFailure(new Error("browserType.launch: Executable doesn't exist at /tmp/none")), true);
  assert.equal(isBrowserSpawnFailure(new Error('browserType.launch: spawn ENOENT')), true);
  assert.equal(isBrowserSpawnFailure(new Error('Timeout 60000ms exceeded')), false);
  const said = explainBrowserSpawnFailure(new Error('browserType.launch: spawn UNKNOWN'));
  assert.match(said, /bundled headless browser/);
  assert.match(said, /spawn UNKNOWN/);
});
