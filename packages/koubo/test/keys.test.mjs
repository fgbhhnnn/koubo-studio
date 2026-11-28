import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseEnvFile, readElevenLabsKey, writeElevenLabsKey, elevenLabsKeyStatus,
  loadKouboEnv, kouboConfigDir, elevenLabsKeyFile, sanitizePublicText, last4,
} from '../src/keys.mjs';

test('parseEnvFile accepts KEY=value, quotes, comments and a bare key line', () => {
  const parsed = parseEnvFile('# comment\nELEVENLABS_API_KEY="abc_secret"\n# more\n');
  assert.equal(parsed.ELEVENLABS_API_KEY, 'abc_secret');
  assert.equal(parseEnvFile('just-a-raw-key').VALUE, 'just-a-raw-key');
});

test('status and last4 never include the full key', async () => {
  const home = await mkdtemp(join(tmpdir(), 'koubo-keys-'));
  try {
    const status = writeElevenLabsKey('sk_test_fixture_not_real_ABCDEF1234', { home });
    assert.equal(status.hasKey, true);
    assert.equal(status.last4, '1234');
    assert.equal(status.source, 'file');
    assert.ok(!JSON.stringify(status).includes('sk_test_fixture_not_real'));
    assert.equal(last4('sk_test_fixture_not_real_ABCDEF1234'), '1234');
    const file = elevenLabsKeyFile(home);
    const info = await stat(file);
    assert.equal(info.mode & 0o777, 0o600);
    const disk = await readFile(file, 'utf8');
    assert.match(disk, /^ELEVENLABS_API_KEY=/);
    const again = elevenLabsKeyStatus({ home, env: {} });
    assert.equal(again.hasKey, true);
    assert.equal(again.last4, '1234');
    assert.ok(!JSON.stringify(again).includes('sk_test_fixture'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('environment key wins over the file, and clearing removes the file', async () => {
  const home = await mkdtemp(join(tmpdir(), 'koubo-keys-'));
  try {
    writeElevenLabsKey('file-key-xxxx', { home });
    const fromEnv = readElevenLabsKey({ home, env: { ELEVENLABS_API_KEY: 'env-key-zzzz' } });
    assert.equal(fromEnv.source, 'env');
    assert.equal(fromEnv.key, 'env-key-zzzz');
    const fromFile = readElevenLabsKey({ home, env: {} });
    assert.equal(fromFile.source, 'file');
    writeElevenLabsKey('', { home });
    assert.equal(readElevenLabsKey({ home, env: {} }), null);
    assert.deepEqual(elevenLabsKeyStatus({ home, env: {} }), { hasKey: false, last4: '', source: null });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('loadKouboEnv fills missing vars from ~/.config/koubo without exposing them in sanitizePublicText', async () => {
  const home = await mkdtemp(join(tmpdir(), 'koubo-keys-'));
  try {
    writeElevenLabsKey('file-key-abcd', { home });
    const env = loadKouboEnv({ home, env: { PATH: '/bin' } });
    assert.equal(env.ELEVENLABS_API_KEY, 'file-key-abcd');
    const publicText = sanitizePublicText('failed xi-api-key=file-key-abcd ELEVENLABS_API_KEY=file-key-abcd sk_live_ABC');
    assert.doesNotMatch(publicText, /file-key-abcd/);
    assert.doesNotMatch(publicText, /sk_live_ABC/);
    assert.match(publicText, /\[redacted\]/);
    assert.equal(kouboConfigDir(home), join(home, '.config', 'koubo'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
