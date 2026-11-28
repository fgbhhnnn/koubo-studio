import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canStartIngest, initialWizardState, publicWizardSnapshot, reduceWizard, resolvedTemplateChoice,
} from './koubo-wizard.ts';

test('the wizard cannot start until a video, 口播 mode, and an ElevenLabs key are set', () => {
  let s = initialWizardState(false);
  assert.equal(canStartIngest(s), false);
  s = reduceWizard(s, { type: 'set-video', path: '/tmp/talk.mp4' });
  assert.equal(s.videoName, 'talk.mp4');
  assert.equal(s.title, 'talk');
  assert.equal(canStartIngest(s), false);
  s = reduceWizard(s, { type: 'set-mode', mode: 'talking-head' });
  assert.equal(canStartIngest(s), false);
  s = reduceWizard(s, { type: 'set-key-draft', key: 'sk_test_not_for_fixtures' });
  assert.equal(canStartIngest(s), true);
  const snap = publicWizardSnapshot(s);
  assert.equal(snap.keyEntered, true);
  assert.ok(!('keyDraft' in snap));
  assert.ok(!JSON.stringify(snap).includes('sk_test'));
});

test('a stored key is enough; a running wizard cannot be started again', () => {
  let s = initialWizardState(true);
  s = reduceWizard(s, { type: 'set-video', path: '/tmp/a.mov', name: 'a.mov' });
  s = reduceWizard(s, { type: 'set-mode', mode: 'talking-head' });
  assert.equal(canStartIngest(s), true);
  s = reduceWizard(s, { type: 'start' });
  assert.equal(s.status, 'running');
  assert.equal(canStartIngest(s), false);
  const ignored = reduceWizard(s, { type: 'start' });
  assert.equal(ignored.status, 'running');
});

test('skipped template means auto-assign; a picked id is a user choice', () => {
  let s = initialWizardState(true);
  assert.deepEqual(resolvedTemplateChoice(s, 'classic-performance'), { id: 'classic-performance', source: 'auto' });
  s = reduceWizard(s, { type: 'set-template', id: 'classic-performance' });
  assert.deepEqual(resolvedTemplateChoice(s, 'classic-performance'), { id: 'classic-performance', source: 'user' });
  s = reduceWizard(s, { type: 'set-template', id: null });
  assert.deepEqual(resolvedTemplateChoice(s, 'classic-performance'), { id: 'classic-performance', source: 'auto' });
});

test('progress and errors stay in the public snapshot without a key draft', () => {
  let s = initialWizardState(false);
  s = reduceWizard(s, { type: 'set-key-draft', key: 'sk_live_secret_value' });
  s = reduceWizard(s, { type: 'set-video', path: '/tmp/talk.mp4' });
  s = reduceWizard(s, { type: 'set-mode', mode: 'talking-head' });
  s = reduceWizard(s, { type: 'start' });
  s = reduceWizard(s, { type: 'progress', step: 'plan', message: '正在出方案' });
  assert.equal(s.step, 'plan');
  s = reduceWizard(s, { type: 'error', error: '转写失败' });
  assert.equal(s.status, 'error');
  const snap = publicWizardSnapshot(s);
  assert.equal(snap.error, '转写失败');
  assert.ok(!JSON.stringify(snap).includes('sk_live_secret_value'));
  s = reduceWizard(s, { type: 'done', projectId: 'abc' });
  assert.equal(s.status, 'done');
  assert.equal(s.keyDraft, '');
});
