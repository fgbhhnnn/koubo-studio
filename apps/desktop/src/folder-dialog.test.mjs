import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderDialogOptions, programDialogOptions, videoDialogOptions } from './folder-dialog.mjs';
import { kouboWorkflowWords } from './i18n/koubo-workflow.mjs';

test('with no options the dialog opens a project', () => {
  const o = folderDialogOptions(undefined);
  assert.equal(o.title, 'Open Project');
  assert.equal(o.buttonLabel, 'Open');
  assert.equal(o.defaultPath, undefined);
  assert.deepEqual(o.properties, ['openDirectory', 'createDirectory']);
});

test("Studio's words and starting folder are used", () => {
  const o = folderDialogOptions({ title: 'Export to', button: 'Choose', at: '/Users/me/Movies' });
  assert.equal(o.title, 'Export to');
  assert.equal(o.message, 'Export to');
  assert.equal(o.buttonLabel, 'Choose');
  assert.equal(o.defaultPath, '/Users/me/Movies');
});

test('a starting folder that is not a full path, and text that is not text, are left out', () => {
  const o = folderDialogOptions({ title: 42, button: '  ', at: 'Movies' });
  assert.equal(o.title, 'Open Project');
  assert.equal(o.buttonLabel, 'Open');
  assert.equal(o.defaultPath, undefined);
});

test("an agent's program: Studio's words; on Windows only programs and shims are offered", () => {
  const win = programDialogOptions({ title: 'Choose the Codex program', button: 'Use this' }, 'win32');
  assert.equal(win.title, 'Choose the Codex program');
  assert.equal(win.buttonLabel, 'Use this');
  assert.deepEqual(win.filters?.[0].extensions, ['exe', 'cmd', 'bat', 'ps1', 'js']);
  assert.ok(win.properties?.includes('openFile'));
  assert.equal(programDialogOptions(null, 'darwin').filters, undefined, 'on a Mac an app can be chosen too');
});

test('choosing an agent installation folder opens a directory picker without file filters on Windows', () => {
  const options = programDialogOptions({ title: 'Choose installation folder', kind: 'folder' }, 'win32');
  assert.deepEqual(options.properties, ['openDirectory', 'showHiddenFiles']);
  assert.equal(options.filters, undefined);
  assert.equal(options.title, 'Choose installation folder');
});

test('the installation-folder picker accepts macOS app bundles as directories', () => {
  assert.deepEqual(programDialogOptions({ kind: 'folder' }, 'darwin').properties, ['openDirectory', 'showHiddenFiles', 'treatPackageAsDirectory']);
});

test('a talking-head video picker opens a file, not a folder', () => {
  const o = videoDialogOptions({ title: '选择口播视频', button: '上传' });
  assert.equal(o.title, '选择口播视频');
  assert.equal(o.buttonLabel, '上传');
  assert.ok(o.properties?.includes('openFile'));
  assert.ok(!o.properties?.includes('openDirectory'));
  assert.ok(o.filters?.[0].extensions.includes('mp4'));
});


test('talking-head video picker defaults come from the i18n dictionary, not inline copy', () => {
  const en = videoDialogOptions(undefined);
  assert.equal(en.title, kouboWorkflowWords('en').pickVideo);
  assert.equal(en.buttonLabel, kouboWorkflowWords('en').choose);
  const zh = videoDialogOptions(undefined, 'zh-CN');
  assert.equal(zh.title, kouboWorkflowWords('zh-CN').pickVideo);
  assert.equal(zh.buttonLabel, kouboWorkflowWords('zh-CN').choose);
  assert.notEqual(en.title, zh.title);
});

test('koubo workflow words exist in every Studio language', () => {
  const keys = Object.keys(kouboWorkflowWords('en')).sort();
  for (const language of ['en', 'zh-CN', 'ja', 'ko', 'es']) {
    assert.deepEqual(Object.keys(kouboWorkflowWords(language)).sort(), keys);
    for (const key of keys) {
      assert.ok(String(kouboWorkflowWords(language)[key]).trim());
    }
  }
});
