import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignTemplate, resolveAssignedTemplate, listTemplates } from '../index.mjs';

test('auto-assign uses the talking-head catalog pack when no id is given', () => {
  const { template, source } = assignTemplate();
  assert.equal(source, 'auto');
  assert.equal(template.id, 'classic-performance');
  assert.equal(template.kind, 'talking-head');
  assert.equal(template.name['zh-CN'], '口播讲解');
});

test('a named id is honored and marked as a user choice', () => {
  const { template, source } = assignTemplate({ id: 'classic-performance' });
  assert.equal(source, 'user');
  assert.equal(template.id, 'classic-performance');
});

test('blank or missing id still auto-assigns', () => {
  assert.equal(assignTemplate({ id: '' }).source, 'auto');
  assert.equal(assignTemplate({ id: '   ' }).source, 'auto');
  assert.equal(assignTemplate({ id: null }).source, 'auto');
});

test('unknown id throws without inventing a pack', () => {
  assert.throws(() => assignTemplate({ id: 'motiongit-official' }), /未知模板：motiongit-official/);
});

test('auto-assign hook can pick among a future catalog without call-site hardcoding', () => {
  const catalog = {
    templates: [
      { id: 'classic-performance', kind: 'talking-head', name: { 'zh-CN': '口播讲解' } },
      { id: 'later-pack', kind: 'talking-head', name: { 'zh-CN': '后续模板' } },
    ],
  };
  const first = assignTemplate({ catalog });
  assert.equal(first.source, 'auto');
  assert.equal(first.template.id, 'classic-performance');
  const chosen = assignTemplate({ catalog, id: 'later-pack' });
  assert.equal(chosen.source, 'user');
  assert.equal(chosen.template.id, 'later-pack');
});

test('empty catalog cannot auto-assign', () => {
  assert.throws(() => assignTemplate({ catalog: { templates: [] } }), /模板目录为空/);
});

test('resolved assignment includes pack paths from the live catalog', () => {
  const { template, source, list } = resolveAssignedTemplate();
  assert.equal(source, 'auto');
  assert.ok(template.path.endsWith('classic-performance'));
  assert.ok(list.some((t) => t.id === template.id));
  assert.equal(listTemplates().length, list.length);
});
