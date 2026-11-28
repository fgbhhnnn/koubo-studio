import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listTemplates, getTemplate, CLASSIC_PACK_DIR, ILLUSTRATION_HTML, TEMPLATES_ROOT } from '../index.mjs';

test('catalog lists the talking-head pack and illustration page', () => {
  const list = listTemplates();
  assert.ok(list.some((t) => t.id === 'classic-performance'));
  const pack = getTemplate('classic-performance');
  assert.equal(pack.contract, 'window.film.frame(t)');
  assert.equal(pack.path, CLASSIC_PACK_DIR);
  assert.ok(existsSync(join(CLASSIC_PACK_DIR, 'lib.js')));
  assert.ok(existsSync(join(CLASSIC_PACK_DIR, 'units', 'claim-into-container.js')));
  assert.equal(pack.preview, 'preview.svg');
  assert.ok(existsSync(join(CLASSIC_PACK_DIR, pack.preview)));
  assert.ok(existsSync(ILLUSTRATION_HTML));
  assert.ok(existsSync(join(TEMPLATES_ROOT, 'catalog.json')));
});

test('unknown template id throws', () => {
  assert.throws(() => getTemplate('does-not-exist'), /未知模板/);
});
