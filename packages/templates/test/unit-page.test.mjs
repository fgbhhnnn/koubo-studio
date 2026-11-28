import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderUnitPage } from '../index.mjs';

test('a unit page does not preload a talk-live decoder until that page is framed', () => {
  const html = renderUnitPage({
    clip: { id: 'unit-01', duration: 8, at: 0, sourceEnd: 8, clock: { segments: [] } },
    talkRel: '../assets/talking-clean.mp4',
    boundScript: 'function renderAt() {}',
  });
  assert.match(html, /v\.preload = 'none'/);
  assert.doesNotMatch(html, /v\.preload = 'auto'/);
});
