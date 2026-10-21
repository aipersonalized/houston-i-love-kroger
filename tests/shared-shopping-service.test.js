import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { createApp } from '../src/app.js';
import { createPromotionService } from '../src/promotion-service.js';
import { createShoppingApi, SHOPPING_SERVICE_ID } from '../src/shopping-api.js';
import { createShoppingClient } from '../src/shopping-client.js';
import { createStoredPromotionProvider } from '../src/stored-promotion-provider.js';
import { AppError } from '../src/errors.js';
import { product, jsonResponse } from './fixtures.js';
import { SOURCE, AS_OF, TOKEN, setup, save } from './promotion-fixtures.js';

const basePath = '/api/groceries/';
const locationId = 'TEST0001';
const productId = '0000000000001';

async function listen(t, server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => stop(server));
  return `http://127.0.0.1:${server.address().port}`;
}
async function stop(server) {
  if (!server.listening) return;
  await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
}
async function service(t, { approved = true, publicLimits = {}, ...options } = {}) {
  const fixture = setup(t, { approved });
  if (approved) save(fixture.store);
  const calls = [];
  const source = { configured: true, environment: 'production',
    async searchStores(zip, { signal }) { calls.push(['stores', zip]); assert.equal(signal.aborted, false); return [{ locationId, name: 'Synthetic selected store', address: {} }]; },
    async searchProductPage(store, term, { limit, start, signal }) {
      calls.push(['products', store, term, limit, start]); assert.equal(signal.aborted, false);
      return { products: [product()], pagination: { start: start ?? 0, limit, total: 1 } };
    },
    async getProduct(store, id, { signal }) { calls.push(['retrieve', store, id]); assert.equal(signal.aborted, false); return product({ productId: id }); },
  };
  const promotions = createStoredPromotionProvider({ store: fixture.store, sourceId: SOURCE, maxAgeSeconds: 604_800, now: () => AS_OF });
  const shoppingApi = createShoppingApi({ client: source, dataSource: 'synthetic-fixture', now: () => Date.parse(AS_OF),
    promotionProvider: promotions, historyProvider: input => promotions.getComparisons(input) });
  const server = createPromotionService({ store: fixture.store, token: TOKEN, sourceId: SOURCE, shoppingApi,
    publicBasePath: basePath, now: () => AS_OF, publicLimits: { maxRequestsPerMinute: 120, ...publicLimits }, ...options });
  const origin = await listen(t, server);
  return { ...fixture, calls, server, origin, url: origin + basePath,
    client: createShoppingClient({ url: origin + basePath }) };
}
async function call(url, path, body, headers = {}) {
  const response = await fetch(new URL(path, url), { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, body: await response.json() };
}

test('dedicated public service completes current shopping and stored reads while no web process exists', async t => {
  const { client, calls, store } = await service(t);
  const status = await client.execute('api/v1/status');
  assert.deepEqual(status.service, SHOPPING_SERVICE_ID);
  assert.equal(status.capabilities.cart, false);
  assert.equal(status.cart, undefined);
  assert.equal(status.dataSource, 'synthetic-fixture');
  assert.equal(calls.length, 0, 'Status never contacts the supplier.');
  assert.equal((await client.execute('api/v1/stores/search', { zipCode: '77001' })).stores[0].locationId, locationId);
  const search = await client.execute('api/v1/products/search', { locationId, term: 'milk' });
  assert.equal(search.products[0].source.productId, productId);
  assert.equal(search.scope.locationId, locationId);
  assert.equal(search.scope.exhaustive, false);
  assert.equal(search.offers[0].calculated.savingsCents, 100);
  assert.equal((await client.execute('api/v1/deals/search', { locationId, term: 'milk' })).offers.length, 1);
  assert.equal((await client.execute('api/v1/products/retrieve', { locationId, productId })).scope.mode, 'product');
  const estimate = await client.execute('api/v1/basket/estimate', { locationId, items: [{ productId, itemId: productId, quantity: 2 }] });
  assert.equal(estimate.status, 'complete');
  assert.equal(estimate.lines[0].lineTotalCents, 600);
  const beforeStored = calls.length;
  assert.equal((await client.execute('api/v1/promotions/status')).status, 'available');
  const history = await client.execute('api/v1/promotions/search', { locationId });
  assert.equal(history.observations.length, 1);
  assert.equal((await client.execute('api/v1/promotions/retrieve', { locationId, observationId: history.observations[0].observationId })).status, 'available');
  assert.equal((await client.execute('api/v1/promotions/topics', { locationId })).topics[0].topic, 'milk');
  assert.equal((await client.execute('api/v1/promotions/latest', { locationId, topic: 'milk' })).deals.length, 1);
  assert.equal((await client.execute('api/v1/promotions/prices', { locationId, topic: 'milk' })).products.length, 1);
  assert.equal((await client.execute('api/v1/promotions/estimate', { locationId, items: [
    { topic: 'milk', productId: 'synthetic-product', itemId: 'synthetic-item', quantity: 2 },
  ] })).lines[0].lineTotalCents, 600);
  assert.equal((await client.execute('api/v1/promotions/stores', { zipCode: '77001' })).status, 'permission_required');
  assert.equal(calls.length, beforeStored, 'Stored requests cannot contact a supplier or fill missing data.');
  assert.equal(store.getSummary().observations, 1, 'Neither current nor stored shopper requests collect history.');
});

test('web app uses that same HTTP backend, keeps Cart ownership and its stop does not stop companion reads', async t => {
  const backend = await service(t);
  // No source client, local history provider or supplier credentials exist in
  // this web process. Its actual listener can only reach the shared service.
  const app = await createApp({ config: { basePath: '/apps/groceries/', publicOrigin: '', port: 4173 }, shoppingProvider: backend.client });
  const origin = await listen(t, app);
  const appUrl = origin + '/apps/groceries/';
  const page = await fetch(appUrl);
  assert.equal(page.status, 200);
  const status = await call(appUrl, 'api/v1/status');
  assert.equal(status.body.configured, true);
  assert.equal(status.body.service, undefined);
  assert.equal(status.body.cart.status, 'disabled');
  assert.equal(status.response.headers.get('x-houston-service'), null);
  const searched = await call(appUrl, 'api/v1/products/search', { locationId, term: 'bread' });
  assert.equal(searched.body.offers.length, 1);
  assert.equal(searched.response.headers.get('x-houston-service'), null);
  assert.deepEqual(backend.calls[0].slice(0, 3), ['products', locationId, 'bread']);
  await stop(app);
  assert.equal((await backend.client.execute('api/v1/products/search', { locationId, term: 'eggs' })).products.length, 1);
  assert.deepEqual(backend.calls.at(-1).slice(0, 3), ['products', locationId, 'eggs']);

  const remainingApp = await createApp({ config: { basePath: '/', publicOrigin: '', port: 4173 }, shoppingProvider: backend.client });
  const remainingOrigin = await listen(t, remainingApp);
  await stop(backend.server);
  const unavailable = await call(remainingOrigin + '/', 'api/v1/products/search', { locationId, term: 'milk' });
  assert.equal(unavailable.response.status, 503);
  assert.equal(unavailable.body.error.code, 'shopping_service_unavailable');
  assert.equal((await fetch(remainingOrigin)).status, 200, 'The page remains reachable during a backend outage.');
});

test('public read surface cannot bypass private token authentication, expose assets or start Cart/collection', async t => {
  const { origin, url, calls } = await service(t, { approved: false });
  for (const path of ['v1/status', 'v1/prices/search', 'v1/history/compare', 'v1/stores/search']) {
    const result = await call(origin + '/', path);
    assert.equal(result.response.status, 401);
    assert.equal(result.body.error.code, 'authentication_required');
    assert.equal(result.response.headers.get('x-houston-service'), null);
  }
  for (const path of ['api/v1/cart/status', 'api/v1/cart/add', 'api/v1/history/compare', 'api/v1/ingest', 'api/v1/policy/enable']) {
    const result = await call(url, path, {});
    assert.equal(result.response.status, 404);
    assert.equal(result.response.headers.get('x-houston-service'), SHOPPING_SERVICE_ID.name);
  }
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
  assert.equal((await fetch(new URL('app.js', url), { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
  const denied = await call(url, 'api/v1/promotions/prices', { locationId, topic: 'milk' });
  assert.equal(denied.body.status, 'permission_required');
  assert.equal(calls.length, 0);
});

test('public JSON, store binding, methods, origins, byte limits and request admission remain bounded', async t => {
  const { url, calls } = await service(t);
  for (const body of [{}, { locationId, term: 'milk', url: 'https://supplier.example' }, { locationId: '1', term: 'milk' }]) {
    assert.equal((await call(url, 'api/v1/products/search', body)).response.status, 400);
  }
  const method = await call(url, 'api/v1/products/search');
  assert.equal(method.response.status, 405);
  assert.equal(method.response.headers.get('allow'), 'POST');
  assert.equal((await call(url, 'api/v1/status', {})).response.status, 405);
  assert.equal((await call(url, 'api/v1/products/search?term=milk', {})).response.status, 400);
  assert.equal((await call(url, 'api/v1/products/search', {}, { Origin: 'https://other.example' })).response.status, 403);
  assert.equal((await call(url, 'api/v1/products/search', {}, { 'Content-Encoding': 'gzip' })).response.status, 415);
  assert.equal((await call(url, 'api/v1/products/search', { text: 'x'.repeat(4096) })).response.status, 413);
  const malformed = await fetch(new URL('api/v1/products/search', url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'invalid_json');
  assert.equal(calls.length, 0);
  const rate = await service(t, { publicLimits: { maxRequestsPerMinute: 1 } });
  assert.equal((await call(rate.url, 'api/v1/status')).response.status, 200);
  const busy = await call(rate.url, 'api/v1/status');
  assert.equal(busy.response.status, 429);
  assert.equal(busy.response.headers.get('retry-after'), '60');
  assert.equal((await call(rate.origin + '/', 'healthz')).response.status, 200);
});

test('public concurrency, deadlines and safe failures never yield fabricated empty results', async t => {
  let release;
  let entered;
  const admitted = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const fixture = await service(t, { publicLimits: { maxActive: 1, timeoutMs: 100 }, shoppingApi: {
    async execute(_path, _body, { signal }) { entered(signal); await held; throw new Error('PRIVATE_DIAGNOSTIC'); },
  } });
  const waiting = call(fixture.url, 'api/v1/status');
  const signal = await admitted;
  assert.equal((await call(fixture.url, 'api/v1/status')).response.status, 429);
  const timedOut = await waiting;
  assert.equal(timedOut.response.status, 408);
  assert.equal(signal.aborted, true);
  assert.equal(timedOut.body.ok, false);
  release();
  const failure = await call(fixture.url, 'api/v1/status');
  assert.equal(failure.response.status, 500);
  assert.equal(JSON.stringify(failure.body).includes('PRIVATE_DIAGNOSTIC'), false);
});

test('shared client refuses web URLs, malformed identity, unbounded responses and redirects with no retry', async t => {
  const goodStatus = { ok: true, apiVersion: 1, configured: false, environment: 'production', service: SHOPPING_SERVICE_ID };
  const cases = [
    () => jsonResponse(goodStatus), // A web app body cannot identify the transport.
    () => jsonResponse({ ...goodStatus, service: undefined }, 200, { 'X-Houston-Service': SHOPPING_SERVICE_ID.name }),
    () => new Response('<html>page</html>', { headers: { 'Content-Type': 'text/html', 'X-Houston-Service': SHOPPING_SERVICE_ID.name } }),
    () => jsonResponse(goodStatus, 200, { 'X-Houston-Service': SHOPPING_SERVICE_ID.name, 'Content-Length': '99999999' }),
    () => jsonResponse({ ...goodStatus, data: 'x'.repeat(2048) }, 200, { 'X-Houston-Service': SHOPPING_SERVICE_ID.name }),
    () => { throw new Error('PRIVATE_UPSTREAM'); },
  ];
  for (const response of cases) {
    let calls = 0;
    const client = createShoppingClient({ url: 'https://service.example/', maxResponseBytes: 1024, fetchImpl: async (_url, options) => {
      calls++; assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.equal(options.headers.Authorization, undefined); return response();
    } });
    await assert.rejects(client.execute('api/v1/status'), error => error.code === 'shopping_service_unavailable' && !error.message.includes('PRIVATE'));
    assert.equal(calls, 1);
  }
  const fakeWeb = await listen(t, createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(goodStatus));
  }));
  await assert.rejects(createShoppingClient({ url: fakeWeb + '/' }).execute('api/v1/status'), { code: 'shopping_service_unavailable' });
});

test('shared client enforces whole-response timeout/cancellation and preserves bounded service errors', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }), {
      headers: { 'Content-Type': 'application/json', 'X-Houston-Service': SHOPPING_SERVICE_ID.name },
    })]) {
      const client = createShoppingClient({ url: 'https://service.example/', timeoutMs: 30, fetchImpl });
      await assert.rejects(client.execute('api/v1/status'), { code: 'shopping_service_unavailable' });
    }
    const abort = new AbortController(); abort.abort();
    await assert.rejects(createShoppingClient({ url: 'https://service.example/', fetchImpl: async () => new Promise(() => {}) })
      .execute('api/v1/status', undefined, { signal: abort.signal }), { code: 'shopping_service_unavailable' });
    const client = createShoppingClient({ url: 'https://service.example/', fetchImpl: async () => jsonResponse({ ok: false,
      error: { code: 'busy', message: 'Wait before another search.' } }, 429,
    { 'X-Houston-Service': SHOPPING_SERVICE_ID.name, 'Retry-After': '60' }) });
    await assert.rejects(client.execute('api/v1/status'), error => error instanceof AppError && error.status === 429 && error.retryAfter === 60);
  } finally { clearInterval(keepAlive); }
});

test('web entrypoint refuses implicit local supplier fallback before opening storage or a listener', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/server.js', '--json', '--no-input'], { env: {}, windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject); child.once('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /Set SHOPPING_SERVICE_URL/u);
  assert.doesNotMatch(result.output, /listening/u);
});

test('optional independent native companion uses the shared service directly with all live and stored operations', {
  skip: !process.env.HOUSTON_COMPANION_PATH || !process.env.COMPANION_PYTHON,
}, async t => {
  const backend = await service(t);
  async function native(tool, operation, fields = [], expectedCode = 0) {
    const script = resolve(process.env.HOUSTON_COMPANION_PATH, 'skills', 'houston-i-love-kroger', 'scripts', tool + '.py');
    let result;
    try {
      result = await promisify(execFile)(process.env.COMPANION_PYTHON, ['-B', script, operation,
        '--base-url', backend.url, ...fields, '--data-use-approved', '--json', '--no-input'], {
        timeout: 10_000, maxBuffer: 1_000_000, windowsHide: true,
        env: { ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}), PYTHONDONTWRITEBYTECODE: '1' },
      });
      assert.equal(expectedCode, 0);
    } catch (error) {
      assert.equal(error.code, expectedCode, 'Synthetic native client returned an unexpected exit status.'); result = error;
    }
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true, JSON.stringify(output)); return output;
  }
  // No web server is constructed anywhere in this test.
  assert.equal((await native('shopping', 'status')).service.name, SHOPPING_SERVICE_ID.name);
  assert.equal((await native('shopping', 'stores', ['--zip', '77001'])).stores[0].locationId, locationId);
  const selected = ['--store', locationId];
  assert.equal((await native('shopping', 'products', [...selected, '--term', 'milk'])).products[0].source.productId, productId);
  assert.equal((await native('shopping', 'deals', [...selected, '--term', 'milk'])).offers.length, 1);
  assert.equal((await native('shopping', 'product', [...selected, '--product-id', productId])).scope.productId, productId);
  assert.equal((await native('shopping', 'estimate', [...selected, '--item', productId, productId, '2'])).lines[0].lineTotalCents, 600);
  const liveCalls = backend.calls.length;
  assert.equal((await native('promotions', 'status')).status, 'available');
  assert.equal((await native('promotions', 'stores', ['--zip', '77001'], 3)).status, 'permission_required');
  assert.equal((await native('promotions', 'topics', selected)).topics[0].topic, 'milk');
  for (const operation of ['latest', 'prices']) {
    assert.equal((await native('promotions', operation, [...selected, '--topic', 'milk'])).status, 'available');
  }
  const history = await native('promotions', 'search', selected);
  assert.equal((await native('promotions', 'retrieve', [...selected, '--observation-id', history.observations[0].observationId])).status, 'available');
  assert.equal((await native('promotions', 'estimate', [...selected, '--item', 'milk', 'synthetic-product', 'synthetic-item', '2'])).lines[0].lineTotalCents, 600);
  assert.equal(backend.calls.length, liveCalls);
  assert.equal(backend.store.getSummary().observations, 1);
});
