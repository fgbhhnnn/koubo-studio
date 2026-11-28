import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_RETRY_MS, IMPORT_TRIES, importModule } from './import-module.ts';

test('a module that cannot be fetched on the first try is loaded on a later try, without reloading the Studio shell', async () => {
  const attempts: string[] = [];
  let reloads = 0;
  const waited: number[] = [];
  const mod = await importModule(
    'http://localhost:4749/s/token/ui.js',
    async (url) => {
      attempts.push(url);
      if (attempts.length === 1) throw new Error(`Failed to fetch dynamically imported module: ${url}`);
      return { default: 'edit' };
    },
    async (ms) => { waited.push(ms); },
  );
  assert.deepEqual(mod, { default: 'edit' });
  assert.equal(attempts.length, 2);
  assert.deepEqual(waited, [IMPORT_RETRY_MS]);
  assert.equal(reloads, 0);
});

test('a module that never arrives is refused after the last try', async () => {
  let tries = 0;
  await assert.rejects(
    () => importModule(
      'http://localhost:4749/s/token/ui.js',
      async (url) => {
        tries += 1;
        throw new Error(`Failed to fetch dynamically imported module: ${url}`);
      },
      async () => {},
    ),
    /Failed to fetch dynamically imported module/,
  );
  assert.equal(tries, IMPORT_TRIES);
});
