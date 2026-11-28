import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_QUICK_RELOADS, RELOAD_MAX_MS, RELOAD_MS, SETTLED_MS, reloadDelay, pageRendererReloads } from './page-renderer-restart.mjs';

test('a page that exits soon after each load is brought back later each time, up to a cap; one that ran a while, at once', () => {
  const waits = [];
  let last = 0;
  for (let i = 0; i < 6; i += 1) { last = reloadDelay(last, 200); waits.push(last); }
  assert.deepEqual(waits, [500, 1000, 2000, 4000, 8000, 8000]);
  assert.equal(reloadDelay(RELOAD_MAX_MS, 5 * 60_000), RELOAD_MS, 'ran several minutes: brought back at once');
});

test('a renderer that keeps exiting soon after each load is not reloaded without end; a quit cancels a pending reload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const waits = [];
  let reloads = 0;
  let gaveUp = 0;
  const pages = pageRendererReloads({
    reload: () => { reloads += 1; },
    onRetry: (wait) => waits.push(wait),
    onGiveUp: () => { gaveUp += 1; },
  });
  for (let i = 0; i < MAX_QUICK_RELOADS; i += 1) {
    pages.afterGone(200);
    t.mock.timers.tick(waits.at(-1) ?? 0);
  }
  assert.equal(reloads, MAX_QUICK_RELOADS);
  assert.deepEqual(waits, [500, 1000, 2000]);
  pages.afterGone(200);
  t.mock.timers.tick(RELOAD_MAX_MS);
  assert.equal(reloads, MAX_QUICK_RELOADS, 'a fourth quick exit is not retried');
  assert.equal(gaveUp, 1);

  let late = 0;
  const later = pageRendererReloads({
    reload: () => { late += 1; },
    onRetry: (wait) => waits.push(wait),
    onGiveUp: () => { gaveUp += 1; },
  });
  later.afterGone(SETTLED_MS);
  assert.equal(waits.at(-1), RELOAD_MS, 'a page that ran a while is brought back once');
  later.stop();
  t.mock.timers.tick(RELOAD_MAX_MS);
  assert.equal(late, 0, 'a quit cancels the pending reload');
});
