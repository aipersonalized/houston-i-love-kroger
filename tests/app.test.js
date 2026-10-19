import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { NOW, STORE_ID, product, store } from './fixtures.js';

const config = { port: 4173, basePath: '/apps/houston-i-love-kroger/', publicOrigin: '' };
const base = config.basePath;

function fakeClient(overrides = {}) {
  return { configured: true, environment: 'production',
    searchStores: async () => [store()], searchProducts: async () => [product()], ...overrides };
}

// Exercise the real HTTP request listener in memory. No sockets, network calls
// or real credentials are needed for these route/stream contract checks.
function invoke(server, { method = 'POST', path = 'api/v1/deals/search', url = `${base}${path}`,
  body = { locationId: STORE_ID }, rawBody, headers = {}, chunks } = {}) {
  const bytes = rawBody ?? JSON.stringify(body);
  const request = Readable.from(chunks ?? [Buffer.from(bytes)]);
  request.method = method;
  request.url = url;
  request.headers = { host: 'localhost:4173', 'content-type': 'application/json', ...headers };
  request.complete = false;
  request.once('end', () => { request.complete = true; });
  const response = new EventEmitter();
  response.headers = {};
  response.destroyed = false;
  response.writableEnded = false;
  response.setHeader = (key, value) => { response.headers[key.toLowerCase()] = value; };
  response.writeHead = (status, values = {}) => {
    response.status = status;
    for (const [key, value] of Object.entries(values)) response.setHeader(key, value);
  };
  response.end = value => {
    response.writableEnded = true;
    response.bytes = value === undefined ? '' : value.toString();
    if (response.headers['content-type']?.includes('application/json')) response.body = JSON.parse(response.bytes);
  };
  return server.listeners('request')[0](request, response).then(() => response);
}

test('status truthfully reports setup and history without contacting Kroger', async () => {
  let calls = 0;
  const server = await createApp({ config, now: () => NOW,
    client: fakeClient({ configured: false, searchStores: async () => { calls++; } }) });
  const result = await invoke(server, { method: 'GET', path: 'api/v1/status' });
  assert.equal(result.status, 200);
  assert.equal(result.body.configured, false);
  assert.equal(result.body.history.status, 'unavailable');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(calls, 0);
});

test('certification never attaches production history or calls its provider', async () => {
  let historyCalls = 0;
  const server = await createApp({ config, now: () => NOW,
    client: fakeClient({ environment: 'certification' }),
    historyProvider: () => { historyCalls++; throw new Error('Production history must stay isolated.'); } });
  const status = await invoke(server, { method: 'GET', path: 'api/v1/status' });
  const deals = await invoke(server);
  assert.equal(status.body.history.reason, 'history_environment_mismatch');
  assert.equal(deals.body.history.reason, 'history_environment_mismatch');
  assert.equal(deals.body.offers.length, 1);
  assert.equal(deals.body.offers[0].history.reason, 'history_environment_mismatch');
  assert.equal(deals.body.offers[0].history.lastPromo, undefined);
  assert.equal(deals.body.offers[0].history.lowestPromo, undefined);
  assert.equal(historyCalls, 0);
});

test('ZIP selects a bounded nearby store list; data is not reflected into URLs or saved', async () => {
  const seen = [];
  const server = await createApp({ config, now: () => NOW, client: fakeClient({ searchStores: async (zipCode, options) => {
    seen.push(zipCode); assert.ok(options.signal instanceof AbortSignal); return [store()];
  } }) });
  const result = await invoke(server, { path: 'api/v1/stores/search', body: { zipCode: '00501' } });
  assert.equal(result.status, 200);
  assert.deepEqual(seen, ['00501']);
  assert.deepEqual(result.body.stores, [store()]);
  assert.equal(result.body.radiusInMiles, 10);
  assert.equal(result.body.limit, 10);
  assert.equal(result.body.retrievedAt, '2026-10-19T18:00:00.000Z');
  assert.equal(result.body.zipCode, undefined);
});

test('choosing a store starts a labeled three-topic sample with exact identity deduplication', async () => {
  const seen = [];
  const server = await createApp({ config, now: () => NOW, client: fakeClient({ searchProducts: async (locationId, term, options) => {
    seen.push({ locationId, term, limit: options.limit }); return [product()];
  } }) });
  const result = await invoke(server);
  assert.equal(result.status, 200);
  assert.deepEqual(seen, ['milk', 'bread', 'eggs'].map(term => ({ locationId: STORE_ID, term, limit: 15 })));
  assert.equal(result.body.scope.locationId, STORE_ID);
  assert.equal(result.body.scope.mode, 'sample');
  assert.equal(result.body.scope.term, null);
  assert.equal(result.body.scope.productLimit, 45);
  assert.equal(result.body.scope.exhaustive, false);
  assert.match(result.body.scope.coverage, /does not cover all store promotions/);
  assert.equal(result.body.offers.length, 1);
  assert.equal(result.body.summary.duplicateItems, 2);
});

test('refining a term uses one query and shared ranking; history follows each item when sorted', async () => {
  let providerArgs;
  const server = await createApp({ config, now: () => NOW, client: fakeClient({
    searchProducts: async (locationId, term, { limit }) => {
      assert.equal(locationId, STORE_ID); assert.equal(term, 'whole milk'); assert.equal(limit, 50);
      return [product({ productId: 'a', regular: 10, promo: 8 }), product({ productId: 'b', regular: 4, promo: 2 })];
    },
  }), historyProvider: args => {
    providerArgs = args;
    return { status: 'partial', histories: args.offers.map(offer => ({ status: 'incomparable',
      sourceLabels: ['Example authorized source'], lastPromo: offer.source.productId === 'a' ? 7 : 3 })) };
  } });
  const result = await invoke(server, { body: { locationId: STORE_ID, term: 'whole milk', sort: 'price' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.scope.mode, 'search');
  assert.deepEqual(result.body.scope.topics, ['whole milk']);
  assert.equal(result.body.history.status, 'partial');
  assert.equal(providerArgs.locationId, STORE_ID);
  assert.equal(providerArgs.asOf, '2026-10-19T18:00:00.000Z');
  assert.equal(result.body.offers[0].source.productId, 'b');
  assert.equal(result.body.offers[0].history.lastPromo, 3);
});

test('history provider errors are visible while current prices remain usable', async () => {
  const server = await createApp({ config, now: () => NOW, client: fakeClient(),
    historyProvider: () => { throw new Error('DO_NOT_EMIT_PRIVATE_SOURCE'); } });
  const result = await invoke(server);
  assert.equal(result.status, 200);
  assert.equal(result.body.offers.length, 1);
  assert.equal(result.body.history.reason, 'history_read_failed');
  assert.equal(result.body.offers[0].history.reason, 'history_read_failed');
  assert.ok(!result.bytes.includes('DO_NOT_EMIT_PRIVATE_SOURCE'));
});

test('history status capability can be checked without a store or current offers', async () => {
  const server = await createApp({ config, client: fakeClient(), historyProvider: args => {
    assert.equal(args.locationId, null); assert.deepEqual(args.offers, []);
    return { status: 'permission_required', reason: 'source_permission_required', histories: [] };
  } });
  const result = await invoke(server, { method: 'GET', path: 'api/v1/status' });
  assert.equal(result.body.history.status, 'permission_required');
  assert.equal(result.body.history.histories, undefined);
});

test('HTTP input boundaries reject cross-origin, arbitrary proxy, methods, queries and oversized JSON', async () => {
  let calls = 0;
  const server = await createApp({ config, client: fakeClient({ searchProducts: async () => { calls++; return []; } }) });
  const cases = [
    [{ headers: { host: 'attacker.example' } }, 403, 'invalid_host'],
    [{ headers: { origin: 'https://attacker.example' } }, 403, 'origin_not_allowed'],
    [{ url: `${base}api/v1/deals/search?term=milk` }, 400, 'query_not_allowed'],
    [{ method: 'GET' }, 405, 'method_not_allowed'],
    [{ url: `${base}api/v1/proxy` }, 404, 'not_found'],
    [{ body: { locationId: STORE_ID, url: 'https://attacker.example' } }, 400, 'invalid_request'],
    [{ headers: { 'content-type': 'text/plain' } }, 415, 'invalid_content_type'],
    [{ rawBody: '{bad' }, 400, 'invalid_json'],
    [{ rawBody: 'null' }, 400, 'invalid_request'],
    [{ rawBody: 'x'.repeat(4097) }, 413, 'request_too_large'],
    [{ headers: { 'content-length': '4097' } }, 413, 'request_too_large'],
  ];
  for (const [input, status, code] of cases) {
    const result = await invoke(server, input);
    assert.equal(result.status, status, code);
    assert.equal(result.body.error.code, code);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal(calls, 0);
});

test('setup errors and unexpected exceptions use fixed safe errors', async () => {
  const unavailable = await createApp({ config, client: fakeClient({ configured: false }) });
  assert.equal((await invoke(unavailable)).body.error.code, 'setup_required');
  const failed = await createApp({ config, client: fakeClient({ searchProducts: async () => { throw new Error('PRIVATE_UPSTREAM_DATA'); } }) });
  const result = await invoke(failed);
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'internal_error');
  assert.ok(!result.bytes.includes('PRIVATE_UPSTREAM_DATA'));
});

test('one global rate limit bounds requests without IP or shopper tracking', async () => {
  let now = NOW;
  let calls = 0;
  const server = await createApp({ config, now: () => now, client: fakeClient({ searchStores: async () => { calls++; return []; } }) });
  for (let i = 0; i < 30; i++) {
    assert.equal((await invoke(server, { path: 'api/v1/stores/search', body: { zipCode: '00501' } })).status, 200);
  }
  const limited = await invoke(server, { path: 'api/v1/stores/search', body: { zipCode: '00501' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '60');
  assert.equal(calls, 30);
  now += 60_000;
  assert.equal((await invoke(server, { path: 'api/v1/stores/search', body: { zipCode: '00501' } })).status, 200);
});

test('four concurrent searches are admitted and the fifth is rejected without another upstream call', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const server = await createApp({ config, client: fakeClient({ searchStores: async () => { calls++; await held; return []; } }) });
  const running = Array.from({ length: 4 }, () => invoke(server, { path: 'api/v1/stores/search', body: { zipCode: '00501' } }));
  await new Promise(resolve => setImmediate(resolve));
  const fifth = await invoke(server, { path: 'api/v1/stores/search', body: { zipCode: '00501' } });
  assert.equal(fifth.status, 429);
  assert.equal(calls, 4);
  release();
  assert.ok((await Promise.all(running)).every(result => result.status === 200));
});

test('only fixed frontend assets are served at the configured base path', async () => {
  const server = await createApp({ config, client: fakeClient() });
  const redirect = await invoke(server, { method: 'GET', url: '/' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, base);
  const page = await invoke(server, { method: 'GET', path: '' });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal((await invoke(server, { method: 'GET', path: '.env' })).status, 404);
  assert.equal((await invoke(server, { method: 'GET', path: '../src/server.js' })).status, 404);
});
