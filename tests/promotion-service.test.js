import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPromotionService } from '../src/promotion-service.js';
import { createPromotionClient } from '../src/promotion-client.js';
import { startPromotionServer } from '../src/promotion-server.js';
import { SOURCE, AS_OF, TOKEN, offer, setup, save } from './promotion-fixtures.js';

async function service(t, { approved = true, ...options } = {}) {
  const fixture = setup(t, { approved });
  const server = createPromotionService({ store: fixture.store, token: TOKEN, sourceId: SOURCE, now: () => AS_OF, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { ...fixture, server, url: `http://127.0.0.1:${server.address().port}` };
}
async function call(url, path, body, { token = TOKEN, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  const response = await fetch(`${url}${path}`, { method,
    headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, body: await response.json() };
}
function rawRequest(url, headers, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/v1/promotions/search`, { method: 'POST', headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('service supports private status/search/retrieve/compare via actual HTTP and never collects shopper searches', async t => {
  const { url, store } = await service(t);
  save(store);
  const client = createPromotionClient({ url, token: TOKEN });
  assert.equal((await client.getStatus()).status, 'available');
  const result = await client.searchPromotions({ locationId: 'TEST0001', term: 'milk', limit: 1 });
  const row = result.observations[0];
  assert.equal(row.price.promo, 3);
  assert.equal((await client.retrievePromotion({ locationId: 'TEST0001', observationId: row.observationId })).observation.itemId, 'synthetic-item');
  const comparison = await client.getComparisons({ locationId: 'TEST0001', offers: [offer()], asOf: '2027-01-01T00:00:00Z' });
  assert.equal(comparison.histories[0].lastPromo, 3);
  assert.equal(store.getSummary().observations, 1);
  const source = await call(url, '/v1/status');
  assert.equal(source.response.headers.get('cache-control'), 'no-store');
  assert.equal(source.response.headers.get('access-control-allow-origin'), null);
  assert.equal(JSON.stringify(source.body).includes('synthetic-permission'), false);
});

test('missing source permission remains explicit over every operation; liveness has no storage data', async t => {
  const { url } = await service(t, { approved: false });
  const client = createPromotionClient({ url, token: TOKEN });
  assert.equal((await client.getStatus()).status, 'permission_required');
  assert.equal((await client.searchPromotions({ locationId: 'TEST0001' })).status, 'permission_required');
  assert.equal((await client.retrievePromotion({ locationId: 'TEST0001', observationId: '1' })).status, 'permission_required');
  assert.equal((await client.getComparisons({ locationId: 'TEST0001', offers: [offer()] })).histories[0].status, 'permission_required');
  assert.deepEqual((await call(url, '/healthz', undefined, { token: null })).body, { ok: true });
});

test('every data route authenticates; duplicate headers and wrong credentials cannot discover storage', async t => {
  const { url } = await service(t);
  for (const token of [null, 'wrong', TOKEN + 'x']) {
    for (const path of ['/v1/status', '/v1/promotions/search', '/v1/promotions/retrieve', '/v1/history/compare', '/v1/nonexistent']) {
      const result = await call(url, path, undefined, { token });
      assert.equal(result.response.status, 401);
      assert.equal(result.body.error.code, 'authentication_required');
      assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
    }
  }
  const duplicate = await rawRequest(url, { Authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`], 'Content-Type': 'application/json' }, '{}');
  assert.equal(duplicate.status, 401);
});

test('bounded valid inputs and operation allowlist reject unexpected controls and malformed bodies safely', async t => {
  const { url } = await service(t, { maxBodyBytes: 1024 });
  for (const input of [null, [], {}, { locationId: 'TEST0001', asOf: AS_OF }, { locationId: 'TEST0001', sourceId: SOURCE },
    { locationId: 'TEST0001', limit: 51 }, { locationId: 'TEST0001', path: 'private.sqlite' }]) {
    assert.equal((await call(url, '/v1/promotions/search', input)).response.status, 400);
  }
  assert.equal((await call(url, '/v1/history/compare', { locationId: 'TEST0001', offers: Array(501).fill({}) })).response.status, 413);
  assert.equal((await call(url, '/v1/history/compare', { locationId: 'TEST0001', offers: 'invalid' })).response.status, 400);
  assert.equal((await call(url, '/v1/policy/enable', {})).response.status, 404);
  assert.equal((await call(url, '/v1/ingest', {})).response.status, 404);
  assert.equal((await call(url, '/v1/promotions/search')).response.status, 405);
  assert.equal((await call(url, '/v1/status', {})).response.status, 405);
  assert.equal((await call(url, '/v1/promotions/search', {}, { headers: { 'Content-Type': 'text/plain' } })).response.status, 415);
  assert.equal((await call(url, '/v1/promotions/search', {}, { headers: { 'Content-Encoding': 'gzip' } })).response.status, 415);
  const invalid = await rawRequest(url, { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, '{"locationId":');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'invalid_json');
  const oversized = await rawRequest(url, { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, 'x'.repeat(2000));
  assert.equal(oversized.status, 413);
});

test('slow uploads expire, in-flight requests have bounded admission, and authenticated rate is bounded', async t => {
  const { url, server } = await service(t, { requestTimeoutMs: 150, maxActive: 1 });
  const admitted = new Promise(resolve => server.once('request', resolve));
  const slow = httpRequest(`${url}/v1/promotions/search`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
  });
  const slowResult = new Promise((resolve, reject) => {
    slow.on('response', response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    slow.on('error', reject);
  });
  t.after(() => slow.destroy());
  slow.write('{');
  // Wait until the slow request's handler has actually been admitted.
  await admitted;
  assert.equal((await call(url, '/v1/status')).response.status, 429);
  const expired = await slowResult;
  assert.equal(expired.status, 408);
  assert.equal(expired.body.error.code, 'request_timeout');
  assert.equal((await call(url, '/v1/status')).response.status, 200);
});

test('rate limit leaves bounded liveness available', async t => {
  const { url } = await service(t, { maxRequestsPerMinute: 1 });
  assert.equal((await call(url, '/v1/status')).response.status, 200);
  assert.equal((await call(url, '/v1/status')).response.status, 429);
  assert.equal((await call(url, '/healthz')).response.status, 200);
});

test('storage failures return fixed errors without source values, filesystem paths or token text', async t => {
  const fakeStore = Object.fromEntries(['searchPromotions', 'retrievePromotion', 'getComparisons', 'getPromotionStatus', 'getLatestDeals', 'searchPrices', 'estimateBasket'].map(name => [name, () => {
    throw new Error(`private SQL/path and ${TOKEN}`);
  }]));
  const { url } = await service(t, { store: fakeStore });
  const result = await call(url, '/v1/status');
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error.code, 'promotion_service_unavailable');
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
  assert.equal(JSON.stringify(result.body).includes('SQL/path'), false);
});

test('external listener without private authentication fails before creating any database', async t => {
  const fixture = setup(t, { approved: false });
  const filename = join(fixture.folder, 'must-not-exist.sqlite');
  await assert.rejects(() => startPromotionServer({ env: { PROMOTION_SERVICE_HOST: '0.0.0.0', HISTORY_DB_PATH: filename } }), /Configure PROMOTION_SERVICE_TOKEN/u);
  assert.equal(existsSync(filename), false);
  assert.throws(() => createPromotionService({ store: fixture.store, token: 'short' }), /private promotion service token/u);
});
