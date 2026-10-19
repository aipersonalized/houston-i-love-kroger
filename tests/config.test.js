import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';

test('portable defaults bind locally and leave credentials unconfigured', () => {
  assert.deepEqual(readConfig({}), { host: '127.0.0.1', port: 4173,
    basePath: '/apps/houston-i-love-kroger/', publicOrigin: '', environment: 'production',
    clientId: '', clientSecret: '', historyDbPath: undefined });
});

test('base path and public origin are explicit and normalized', () => {
  const config = readConfig({ PORT: '8080', APP_BASE_PATH: '/', PUBLIC_ORIGIN: 'https://example.com:443', KROGER_ENVIRONMENT: 'certification' });
  assert.equal(config.port, 8080);
  assert.equal(config.basePath, '/');
  assert.equal(config.publicOrigin, 'https://example.com');
  assert.equal(config.environment, 'certification');
  assert.equal(readConfig({ HISTORY_DB_PATH: '.runtime/example.sqlite' }).historyDbPath, '.runtime/example.sqlite');
});

test('invalid config cannot become response header injection or arbitrary API origins', () => {
  for (const env of [{ PORT: '0' }, { PORT: '65536' }, { PORT: '80x' },
    { APP_BASE_PATH: '/no-ending-slash' }, { APP_BASE_PATH: '/../../' }, { APP_BASE_PATH: '/\r\n/' },
    { PUBLIC_ORIGIN: 'https://user:secret@example.com' }, { PUBLIC_ORIGIN: 'https://example.com/path' },
    { PUBLIC_ORIGIN: 'file:///tmp' }, { KROGER_ENVIRONMENT: 'https://attacker.example' }, { HOST: 'localhost\r\n' }]) {
    assert.throws(() => readConfig(env));
  }
});
