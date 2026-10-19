import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createPromotionService } from '../src/promotion-service.js';
import { createPromotionClient } from '../src/promotion-client.js';
import { startPromotionServer } from '../src/promotion-server.js';
import { SOURCE, FIRST, TOKEN, offer, setup, save } from './promotion-fixtures.js';

const AS_OF = '2026-01-02T14:00:00.000Z';
async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function request(url, path, body, token) {
  const response = await fetch(`${url}${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

test('actual public→private HTTP latest reads use only the collected DB without Kroger or collection on read', async t => {
  const { store } = setup(t);
  save(store, { offers: [offer(), offer({ itemId: 'other-item' })] });
  const before = store.getSummary();
  let collectionCalls = 0;
  for (const name of ['startRun', 'completeRun', 'recordSourcePolicy']) store[name] = () => {
    collectionCalls++;
    throw new Error('read must never collect or grant permission');
  };
  const privateUrl = await listen(t, createPromotionService({ store, token: TOKEN, sourceId: SOURCE, now: () => AS_OF }));
  const provider = createPromotionClient({ url: privateUrl, token: TOKEN });
  let krogerCalls = 0;
  const sourceClient = { configured: false, environment: 'production',
    async searchStores() { krogerCalls++; throw new Error('read must never query Kroger stores'); },
    async searchProducts() { krogerCalls++; throw new Error('read must never query Kroger products'); } };
  const basePath = '/apps/houston-i-love-kroger/';
  const publicUrl = await listen(t, await createApp({ config: { port: 4173, basePath, publicOrigin: '' }, client: sourceClient,
    promotionProvider: provider, now: () => Date.parse(AS_OF) }));
  const first = await request(publicUrl, `${basePath}api/v1/promotions/latest`, { locationId: 'TEST0001', topic: 'milk', limit: 1 });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.status, 'available');
  assert.equal(first.body.snapshot.observedAt, FIRST);
  assert.equal(first.body.snapshot.ageSeconds, 7200);
  assert.equal(first.body.snapshot.maxAgeSeconds, 86400);
  assert.equal(first.body.deals.length, 1);
  assert.equal(first.body.deals[0].price.promo, 3);
  assert.equal(first.body.page.truncated, true);
  const next = await request(publicUrl, `${basePath}api/v1/promotions/latest`, {
    locationId: 'TEST0001', topic: 'milk', limit: 1, cursor: first.body.page.nextCursor,
  });
  assert.equal(next.body.status, 'available');
  assert.notEqual(next.body.deals[0].observationId, first.body.deals[0].observationId);
  const missing = await request(publicUrl, `${basePath}api/v1/promotions/latest`, { locationId: 'TEST0001', topic: 'bread' });
  assert.equal(missing.body.status, 'no_data');
  const permission = await request(publicUrl, `${basePath}api/v1/promotions/latest`, { locationId: 'TEST0001', topic: 'unapproved' });
  assert.equal(permission.body.status, 'permission_required');
  assert.equal(krogerCalls, 0);
  assert.equal(collectionCalls, 0);
  assert.deepEqual(store.getSummary(), before);
  assert.equal(first.response.headers.get('cache-control'), 'no-store');
  for (const forbidden of [TOKEN, 'rightsId', 'evidenceReference', 'retain_until']) assert.equal(JSON.stringify(first.body).includes(forbidden), false);
});

test('private freshness is operator configured; caller controls cannot widen age/source/scope or start collection', async t => {
  const { store } = setup(t);
  save(store);
  const url = await listen(t, createPromotionService({ store, token: TOKEN, sourceId: SOURCE, now: () => AS_OF, maxAgeSeconds: 3600 }));
  const stale = await createPromotionClient({ url, token: TOKEN }).getLatestDeals({ locationId: 'TEST0001', topic: 'milk' });
  assert.equal(stale.status, 'stale');
  assert.deepEqual(stale.deals, []);
  assert.equal(stale.snapshot.maxAgeSeconds, 3600);
  for (const body of [{ locationId: 'TEST0001' }, { locationId: 'TEST0001', topic: 'milk', maxAgeSeconds: 604800 },
    { locationId: 'TEST0001', topic: 'milk', sourceId: SOURCE }, { locationId: 'TEST0001', topic: 'milk', asOf: FIRST },
    { locationId: 'TEST0001', topic: 'milk', refresh: true }, { locationId: 'TEST0001', topic: 'milk', term: 'milk' }]) {
    const result = await request(url, '/v1/deals/search', body, TOKEN);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, 'invalid_request');
  }
  assert.equal((await request(url, '/v1/deals/search', { locationId: 'TEST0001', topic: 'milk' })).response.status, 401);
  assert.equal((await request(url, '/v1/collect', {}, TOKEN)).response.status, 404);
  assert.equal(store.getSummary().observations, 1);
});

test('public latest distinguishes pending permission from unavailable storage and rejects live-search controls', async t => {
  const { store } = setup(t, { approved: false });
  const privateUrl = await listen(t, createPromotionService({ store, token: TOKEN, sourceId: SOURCE, now: () => AS_OF }));
  const provider = createPromotionClient({ url: privateUrl, token: TOKEN });
  const client = { configured: false, environment: 'production' };
  const app = await createApp({ config: { port: 4173, basePath: '/', publicOrigin: '' }, client, promotionProvider: provider });
  const url = await listen(t, app);
  const pending = await request(url, '/api/v1/promotions/latest', { locationId: 'TEST0001', topic: 'milk' });
  assert.equal(pending.body.status, 'permission_required');
  assert.equal(pending.body.snapshot, null);
  assert.deepEqual(pending.body.deals, []);
  for (const body of [{ locationId: 'TEST0001', topic: 'milk', maxAgeSeconds: 604800 },
    { locationId: 'TEST0001', term: 'milk' }, { locationId: 'TEST0001', topic: 'milk', sort: 'price' },
    { locationId: 'TEST0001', topic: 'milk', includeAll: true }, { locationId: 'TEST0001', topic: 'milk', limit: 51 }]) {
    assert.equal((await request(url, '/api/v1/promotions/latest', body)).response.status, 400);
  }
  provider.getLatestDeals = async () => { throw new Error('private service diagnostic'); };
  const unavailable = await request(url, '/api/v1/promotions/latest', { locationId: 'TEST0001', topic: 'milk' });
  assert.equal(unavailable.response.status, 503);
  assert.equal(unavailable.body.error.code, 'promotion_service_unavailable');
  assert.equal(JSON.stringify(unavailable.body).includes('private service diagnostic'), false);
  provider.getLatestDeals = async () => { const error = new Error('private cursor details'); error.code = 'promotion_request_invalid'; throw error; };
  assert.equal((await request(url, '/api/v1/promotions/latest', { locationId: 'TEST0001', topic: 'milk', cursor: 'valid_base64url' })).response.status, 400);
});

test('invalid operator freshness settings fail before opening or creating a database', async t => {
  const { folder } = setup(t, { approved: false });
  const filename = join(folder, 'must-not-create.sqlite');
  for (const value of ['', '0', '-1', '604801', '86400.5', '1e5', 'private-invalid']) {
    await assert.rejects(() => startPromotionServer({ env: { PROMOTION_SERVICE_TOKEN: TOKEN,
      HISTORY_DB_PATH: filename, PROMOTION_MAX_AGE_SECONDS: value } }));
    assert.equal(existsSync(filename), false);
  }
});
