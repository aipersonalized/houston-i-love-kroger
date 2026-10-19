import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';

test('portable defaults bind locally and leave credentials unconfigured', () => {
  assert.deepEqual(readConfig({}), { host: '127.0.0.1', port: 4173,
    basePath: '/apps/houston-i-love-kroger/', publicOrigin: '', environment: 'production',
    clientId: '', clientSecret: '', historyDbPath: undefined,
    cartEnabled: false, cartGranted: false, cartRedirectUri: '', promotionServiceUrl: '', promotionServiceToken: '' });
});

test('cart requires explicit opt-in flags and a same-origin registered HTTPS callback', () => {
  const origin = 'https://example.com';
  const redirect = `${origin}/apps/houston-i-love-kroger/api/v1/cart/callback`;
  assert.equal(readConfig({ PUBLIC_ORIGIN: origin, KROGER_CART_ENABLED: 'true', KROGER_CART_REDIRECT_URI: redirect }).cartGranted, false);
  assert.equal(readConfig({ KROGER_CART_ENABLED: 'true', KROGER_CART_GRANTED: 'true' }).cartRedirectUri, '');
  for (const env of [{ KROGER_CART_ENABLED: 'yes' }, { KROGER_CART_GRANTED: '1' },
    { PUBLIC_ORIGIN: origin, KROGER_CART_REDIRECT_URI: 'https://other.example/api/v1/cart/callback' },
    { PUBLIC_ORIGIN: origin, KROGER_CART_REDIRECT_URI: `${redirect}?state=fixture` },
    { PUBLIC_ORIGIN: 'http://example.com', KROGER_CART_REDIRECT_URI: redirect }]) {
    assert.throws(() => readConfig(env), /KROGER_CART_/);
  }
});

test('remote promotions config pairs a bounded private token with an origin-only URL', () => {
  const config = readConfig({ PROMOTION_SERVICE_URL: 'http://promotion-service:4180', PROMOTION_SERVICE_TOKEN: 'fixture-private-token-not-real-0001' });
  assert.equal(config.promotionServiceUrl, 'http://promotion-service:4180');
  for (const env of [{ PROMOTION_SERVICE_URL: 'https://example.com' }, { PROMOTION_SERVICE_TOKEN: 'fixture' },
    { PROMOTION_SERVICE_URL: 'https://example.com/path', PROMOTION_SERVICE_TOKEN: 'fixture' },
    { PROMOTION_SERVICE_URL: 'https://user:password@example.com', PROMOTION_SERVICE_TOKEN: 'fixture' },
    { PROMOTION_SERVICE_URL: 'https://example.com', PROMOTION_SERVICE_TOKEN: 'fixture\r\nleak' }]) assert.throws(() => readConfig(env));
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
