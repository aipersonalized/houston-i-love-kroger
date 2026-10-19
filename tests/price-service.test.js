import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { createPromotionService } from '../src/promotion-service.js';
import { createPromotionClient } from '../src/promotion-client.js';
import { SOURCE, FIRST, TOKEN, offer, setup, save } from './promotion-fixtures.js';

const AS_OF = '2026-01-02T14:00:00.000Z';
const requestItem = (itemId = 'synthetic-item', quantity = 1) => ({ topic: 'milk', productId: 'synthetic-product', itemId, quantity });
async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function post(url, path, body, token) {
  const response = await fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}
async function installation(t, { approved = true, maxAgeSeconds } = {}) {
  const fixture = setup(t, { approved });
  const privateUrl = await listen(t, createPromotionService({ store: fixture.store, token: TOKEN, sourceId: SOURCE, now: () => AS_OF,
    ...(maxAgeSeconds ? { maxAgeSeconds } : {}) }));
  const provider = createPromotionClient({ url: privateUrl, token: TOKEN });
  let sourceCalls = 0;
  const client = { configured: false, environment: 'production', async searchStores() { sourceCalls++; throw new Error('no source reads'); },
    async searchProducts() { sourceCalls++; throw new Error('no source reads'); } };
  const publicUrl = await listen(t, await createApp({ config: { port: 4173, basePath: '/', publicOrigin: '' }, client,
    promotionProvider: provider, now: () => Date.parse(AS_OF) }));
  return { ...fixture, privateUrl, publicUrl, provider, sourceCalls: () => sourceCalls };
}

test('actual price lookup and basket estimate HTTP paths use stored regular/promo prices without Kroger or collection', async t => {
  const fixture = await installation(t);
  save(fixture.store, { offers: [offer({ inStore: true, stockLevel: 'HIGH' }),
    offer({ itemId: 'regular', inStore: true, stockLevel: 'HIGH', price: { regular: 5, promo: 0 } })] });
  const before = fixture.store.getSummary();
  let mutations = 0;
  for (const method of ['startRun', 'completeRun', 'recordSourcePolicy']) fixture.store[method] = () => { mutations++; throw new Error('read must not mutate'); };
  const prices = await post(fixture.publicUrl, '/api/v1/promotions/prices', { locationId: 'TEST0001', topic: 'milk' });
  assert.equal(prices.response.status, 200);
  assert.equal(prices.body.status, 'available');
  assert.deepEqual(prices.body.products.map(row => row.pricing.status), ['regular_only', 'promotion']);
  const estimate = await post(fixture.publicUrl, '/api/v1/promotions/estimate', {
    locationId: 'TEST0001', items: [requestItem('regular', 3), requestItem('synthetic-item', 2)],
  });
  assert.equal(estimate.response.status, 200);
  assert.equal(estimate.body.status, 'complete');
  assert.equal(estimate.body.totals.reportedSubtotalCents, 2100);
  assert.equal(estimate.body.totals.qualifiedSubtotalCents, 2100);
  assert.equal(estimate.body.evaluatedAt, AS_OF);
  assert.equal(estimate.body.lines[0].observedAt, FIRST);
  assert.deepEqual(estimate.body.lines.map(line => line.itemId), ['regular', 'synthetic-item']);
  assert.equal(fixture.sourceCalls(), 0);
  assert.equal(mutations, 0);
  assert.deepEqual(fixture.store.getSummary(), before);
  assert.equal(estimate.response.headers.get('cache-control'), 'no-store');
  for (const value of [TOKEN, 'rights_id', 'evidenceReference', 'retain_until']) assert.equal(JSON.stringify(estimate.body).includes(value), false);
});

test('pending, stale, no-data and unavailable amounts remain distinct through the actual HTTP client', async t => {
  const pending = await installation(t, { approved: false });
  assert.equal((await pending.provider.searchPrices({ locationId: 'TEST0001', topic: 'milk' })).status, 'permission_required');
  const blocked = await pending.provider.estimateBasket({ locationId: 'TEST0001', items: [requestItem()] });
  assert.equal(blocked.status, 'permission_required');
  assert.equal(blocked.totals.reportedSubtotalCents, null);
  const fresh = await installation(t);
  const absent = await fresh.provider.estimateBasket({ locationId: 'TEST0001', items: [requestItem()] });
  assert.equal(absent.status, 'unavailable');
  assert.equal(absent.lines[0].reason, 'no_data');
  save(fresh.store, { offers: [offer({ currency: null, priceBasis: null, eligibilityKey: null, modality: null })] });
  const unknown = await fresh.provider.estimateBasket({ locationId: 'TEST0001', items: [requestItem('synthetic-item', 2)] });
  assert.equal(unknown.status, 'complete');
  assert.equal(unknown.totals.reportedSubtotalCents, 600);
  assert.equal(unknown.totals.qualifiedSubtotalCents, null);
  assert.equal(unknown.totals.currencyQualification, 'unreported');
  const stale = await installation(t, { maxAgeSeconds: 3600 });
  save(stale.store);
  assert.equal((await stale.provider.searchPrices({ locationId: 'TEST0001', topic: 'milk' })).status, 'stale');
  const expired = await stale.provider.estimateBasket({ locationId: 'TEST0001', items: [requestItem()] });
  assert.equal(expired.status, 'unavailable');
  assert.equal(expired.lines[0].reason, 'stale');
  assert.equal(expired.lines[0].snapshot.maxAgeSeconds, 3600);
  assert.equal(expired.lines[0].product, null);
});

test('HTTP input boundaries reject caller prices, duplicate IDs, invalid quantity and oversized bodies before any source action', async t => {
  const fixture = await installation(t);
  for (const input of [{ locationId: 'TEST0001', topic: 'milk', term: 'whole milk' },
    { locationId: 'TEST0001', topic: 'milk', currency: 'USD' }, { locationId: 'TEST0001', topic: 'milk', maxAgeSeconds: 604800 }]) {
    assert.equal((await post(fixture.publicUrl, '/api/v1/promotions/prices', input)).response.status, 400);
    assert.equal((await post(fixture.privateUrl, '/v1/prices/search', input, TOKEN)).response.status, 400);
  }
  for (const items of [[], Array(11).fill(requestItem()), [requestItem(), requestItem()], [requestItem('synthetic-item', 1.5)],
    [requestItem('synthetic-item', 100)], [{ ...requestItem(), unitPriceCents: 1 }]]) {
    assert.equal((await post(fixture.publicUrl, '/api/v1/promotions/estimate', { locationId: 'TEST0001', items })).response.status, 400);
    assert.equal((await post(fixture.privateUrl, '/v1/basket/estimate', { locationId: 'TEST0001', items }, TOKEN)).response.status, 400);
  }
  const maximum = { locationId: 'TEST0001', items: Array.from({ length: 10 }, (_, index) => ({
    topic: 'milk', productId: 'p'.repeat(100), itemId: String(index).padStart(100, 'i'), quantity: 99,
  })) };
  assert.ok(Buffer.byteLength(JSON.stringify(maximum)) < 4096);
  assert.equal((await post(fixture.publicUrl, '/api/v1/promotions/estimate', maximum)).response.status, 200);
  const tooLarge = { locationId: 'TEST0001', items: Array.from({ length: 10 }, (_, index) => ({
    topic: 'milk', productId: '🧮'.repeat(50), itemId: '🧮'.repeat(49) + String(index), quantity: 99,
  })) };
  assert.ok(Buffer.byteLength(JSON.stringify(tooLarge)) > 4096);
  const rejected = await post(fixture.publicUrl, '/api/v1/promotions/estimate', tooLarge);
  assert.equal(rejected.response.status, 413);
  assert.equal(rejected.body.error.code, 'request_too_large');
  assert.equal((await post(fixture.privateUrl, '/v1/basket/estimate', { locationId: 'TEST0001', items: [requestItem()] })).response.status, 401);
  assert.equal(fixture.sourceCalls(), 0);
  assert.equal(fixture.store.getSummary().observations, 0);
});

test('price and estimate clients reject falsified totals, identities, currency context and unusable current prices', async t => {
  const { store } = setup(t);
  save(store, { offers: [offer({ inStore: true, stockLevel: 'HIGH' })] });
  const priceRequest = { locationId: 'TEST0001', topic: 'milk' };
  const estimateRequest = { locationId: 'TEST0001', items: [requestItem('synthetic-item', 2)] };
  const validPrices = store.searchPrices({ ...priceRequest, sourceId: SOURCE, asOf: AS_OF });
  const validEstimate = store.estimateBasket({ ...estimateRequest, sourceId: SOURCE, asOf: AS_OF });
  let priceResult = validPrices;
  let estimateResult = validEstimate;
  const url = await listen(t, createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(request.url === '/v1/prices/search' ? priceResult : estimateResult));
  }));
  const client = createPromotionClient({ url, token: TOKEN });
  assert.equal((await client.searchPrices(priceRequest)).products.length, 1);
  assert.equal((await client.estimateBasket(estimateRequest)).totals.reportedSubtotalCents, 600);
  for (const mutate of [value => { value.products[0].pricing.currentCents = 1; },
    value => { value.products[0].availability.inStore = false; }, value => { value.products[0].price.regular = 0; },
    value => { value.products[0].priceQualification = 'unsupported_source_price'; }, value => { value.topic = 'bread'; }]) {
    priceResult = structuredClone(validPrices); mutate(priceResult);
    await assert.rejects(() => client.searchPrices(priceRequest), { code: 'promotion_service_unavailable' });
  }
  for (const mutate of [value => { value.lines[0].quantity = 3; }, value => { value.lines[0].itemId = 'other'; },
    value => { value.lines[0].lineTotalCents = 1; }, value => { value.totals.reportedSubtotalCents = 1; },
    value => { value.totals.currency = null; }, value => { value.totals.currencyQualification = 'unreported'; },
    value => { value.lines[0].product.pricing.status = 'unavailable'; }, value => { value.lines = []; }]) {
    estimateResult = structuredClone(validEstimate); mutate(estimateResult);
    await assert.rejects(() => client.estimateBasket(estimateRequest), { code: 'promotion_service_unavailable' });
  }
});
