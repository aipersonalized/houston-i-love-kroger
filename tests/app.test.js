import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { CartSessions } from '../src/cart.js';
import { NOW, STORE_ID, product, store, tokenResponse } from './fixtures.js';

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

test('fixed frontend assets include linked privacy and use notes without requiring a search', async () => {
  const server = await createApp({ config, client: fakeClient() });
  const redirect = await invoke(server, { method: 'GET', url: '/' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, base);
  const page = await invoke(server, { method: 'GET', path: '' });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.match(page.bytes, /href="#privacy-notice"/);
  assert.match(page.bytes, /href="#use-notes"/);
  const notice = page.bytes.match(/<section id="privacy-notice"[\s\S]*?<\/section>/)?.[0];
  assert.ok(notice, 'privacy and use notes are in the delivered HTML');
  assert.match(notice, /in memory for this visit/);
  assert.match(notice, /sends the details needed for current-price searches to Kroger/);
  assert.match(notice, /At aipersonalized\.io, aipersonalized operates this installation/);
  assert.match(notice, /size limit rather than a guaranteed deletion date/);
  assert.match(notice, /href="https:\/\/www\.kroger\.com\/i\/privacy-policy"/);
  assert.match(notice, /href="https:\/\/developer\.kroger\.com\/terms"/);
  assert.match(notice, /href="https:\/\/developer\.kroger\.com\/documentation\/public\/getting-started\/acceptable-use"/);
  assert.match(notice, /Do not bulk-collect[\s\S]*other retailers/);
  assert.equal((await invoke(server, { method: 'GET', path: '.env' })).status, 404);
  assert.equal((await invoke(server, { method: 'GET', path: '../src/server.js' })).status, 404);
});

test('products search returns regular-only source facts and filters locally without additional API calls', async () => {
  let calls = 0;
  const server = await createApp({ config, now: () => NOW, client: fakeClient({ searchProducts: async () => {
    calls++; return [product(), product({ productId: 'regular', promo: 0 })];
  } }) });
  const result = await invoke(server, { path: 'api/v1/products/search', body: { locationId: STORE_ID, term: 'milk', sort: 'price' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.products.length, 2);
  assert.equal(result.body.products[1].pricing.reason, 'no_reported_promotion');
  assert.equal(result.body.products[1].history.reason, 'current_promotion_unqualified');
  assert.equal(result.body.products[1].pricing.currentCents, 400);
  assert.equal(result.body.summary.noReportedPromotion, 1);
  assert.equal(result.body.summary.unpriced, 1); // Compatibility aggregate only.
  assert.equal(result.body.scope.includeAll, true);
  const filtered = await invoke(server, { path: 'api/v1/products/search', body: { locationId: STORE_ID, term: 'milk', includeAll: false } });
  assert.equal(filtered.body.products.length, 1);
  assert.equal(filtered.body.offers.length, 1);
  assert.equal(calls, 2);
});

test('public promotions proxies are bounded, read-only and preserve permission-required status', async () => {
  const seen = [];
  let upstreamCalls = 0;
  const provider = {
    getStatus: async () => ({ status: 'permission_required', reason: 'source_permission_required' }),
    searchPromotions: async input => { seen.push(input); return { status: 'permission_required', locationId: input.locationId, observations: [],
      page: { returned: 0, limit: input.limit ?? 20, truncated: false, nextCursor: null } }; },
    retrievePromotion: async input => { seen.push(input); return { status: 'permission_required', locationId: input.locationId, observation: null }; },
  };
  const server = await createApp({ config, client: fakeClient({ configured: false,
    searchProducts: () => { upstreamCalls++; throw new Error(); } }), promotionProvider: provider });
  const status = await invoke(server, { method: 'GET', path: 'api/v1/promotions/status' });
  assert.equal(status.body.apiVersion, 1);
  assert.equal(status.body.status, 'permission_required');
  const appStatus = await invoke(server, { method: 'GET', path: 'api/v1/status' });
  assert.equal(appStatus.body.history.status, 'permission_required');
  const search = await invoke(server, { path: 'api/v1/promotions/search', body: { locationId: STORE_ID, term: 'milk', limit: 20 } });
  assert.equal(search.body.status, 'permission_required');
  const retrieve = await invoke(server, { path: 'api/v1/promotions/retrieve', body: { locationId: STORE_ID, observationId: '1' } });
  assert.equal(retrieve.body.status, 'permission_required');
  assert.equal(upstreamCalls, 0);
  assert.equal(seen.length, 2);
  for (const body of [{ locationId: STORE_ID, limit: 51 }, { locationId: STORE_ID, url: 'https://attacker.example' },
    { locationId: STORE_ID, cursor: 'x'.repeat(513) }, { locationId: STORE_ID, term: ' milk ' }]) {
    assert.equal((await invoke(server, { path: 'api/v1/promotions/search', body })).status, 400);
  }
  for (const observationId of ['9999999999999999999', '9007199254740992', '01', '0']) {
    assert.equal((await invoke(server, { path: 'api/v1/promotions/retrieve', body: { locationId: STORE_ID, observationId } })).status, 400);
  }
  assert.equal(seen.length, 2);
});

test('missing or failed promotions service is unavailable rather than an empty successful history', async () => {
  for (const provider of [undefined, { getStatus: async () => { throw new Error('PRIVATE_SERVICE_URL'); },
    searchPromotions: async () => { throw new Error('PRIVATE_SERVICE_TOKEN'); } }]) {
    const server = await createApp({ config, client: fakeClient(), promotionProvider: provider });
    const status = await invoke(server, { method: 'GET', path: 'api/v1/promotions/status' });
    assert.equal(status.body.status, 'unavailable');
    const search = await invoke(server, { path: 'api/v1/promotions/search', body: { locationId: STORE_ID } });
    assert.ok(!search.bytes.includes('PRIVATE_SERVICE'));
    if (!provider) assert.equal(search.body.status, 'unavailable');
    else assert.equal(search.body.error.code, 'promotion_service_unavailable');
  }
});

test('Cart status stays disabled without setup and rejects origin-less or cross-origin writes', async () => {
  const server = await createApp({ config, client: fakeClient() });
  const status = await invoke(server, { method: 'GET', path: 'api/v1/status' });
  assert.equal(status.body.cart.status, 'disabled');
  assert.equal(status.body.capabilities.products, true);
  assert.equal(status.body.capabilities.cart, false);
  assert.equal(status.headers['set-cookie'], undefined);
  const connect = await invoke(server, { path: 'api/v1/cart/connect', body: {} });
  assert.equal(connect.body.error.code, 'origin_required');
  const disabled = await invoke(server, { path: 'api/v1/cart/connect', body: {}, headers: { origin: 'http://localhost:4173' } });
  assert.equal(disabled.body.error.code, 'cart_setup_required');
  const callback = await invoke(server, { method: 'GET', url: `${base}api/v1/cart/callback?code=PRIVATE_FIXTURE&state=fixture` });
  assert.equal(callback.body.error.code, 'cart_setup_required');
  assert.ok(!callback.bytes.includes('PRIVATE_FIXTURE'));
});

test('Cart callback clears codes with a fixed redirect and tokens never reach HTTP responses', async t => {
  const configured = { ...config, publicOrigin: 'https://example.com', environment: 'production',
    cartEnabled: true, cartGranted: true, clientId: 'fixture-client', clientSecret: 'fixture-secret',
    cartRedirectUri: `https://example.com${base}api/v1/cart/callback` };
  const cart = new CartSessions({ config: configured, fetchImpl: async () => tokenResponse() });
  t.after(() => cart.close());
  const server = await createApp({ config: configured, client: fakeClient(), cartSessions: cart });
  const connect = await invoke(server, { path: 'api/v1/cart/connect', body: {}, headers: { origin: configured.publicOrigin } });
  assert.equal(connect.status, 200);
  const authorization = new URL(connect.body.authorizationUrl);
  const cookie = connect.headers['set-cookie'].split(';')[0];
  const callback = await invoke(server, { method: 'GET',
    url: `${base}api/v1/cart/callback?code=fixture-code&state=${authorization.searchParams.get('state')}`, headers: { cookie } });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, base);
  const status = await invoke(server, { method: 'GET', path: 'api/v1/cart/status', headers: { cookie } });
  assert.equal(status.body.cart.connected, true);
  assert.ok(status.body.cart.csrfToken);
  for (const value of ['fixture-token', 'fixture-secret', 'fixture-code']) {
    assert.ok(!status.bytes.includes(value)); assert.ok(!callback.bytes.includes(value));
  }
  assert.match(status.headers['content-security-policy'], /img-src https:\/\/www\.kroger\.com/);
});

test('configured Cart HTTP routes require Origin and matching visit CSRF before an explicit write', async t => {
  const configured = { ...config, publicOrigin: 'https://example.com', environment: 'production',
    cartEnabled: true, cartGranted: true, clientId: 'fixture-client', clientSecret: 'fixture-secret',
    cartRedirectUri: `https://example.com${base}api/v1/cart/callback` };
  let exchanges = 0; let writes = 0;
  const cart = new CartSessions({ config: configured, fetchImpl: async url => {
    if (url.endsWith('/token')) { exchanges++; return tokenResponse(); }
    writes++; return new Response(null, { status: 204 });
  } }); t.after(() => cart.close());
  const server = await createApp({ config: configured, client: fakeClient(), cartSessions: cart });
  const connect = await invoke(server, { path: 'api/v1/cart/connect', body: {}, headers: { origin: configured.publicOrigin } });
  const authorization = new URL(connect.body.authorizationUrl);
  const cookie = connect.headers['set-cookie'].split(';')[0];
  const csrfToken = connect.body.cart.csrfToken;
  const callbackUrl = `${base}api/v1/cart/callback?code=fixture-code&state=${authorization.searchParams.get('state')}`;
  await invoke(server, { method: 'GET', url: callbackUrl, headers: { cookie } });
  const replay = await invoke(server, { method: 'GET', url: callbackUrl, headers: { cookie } });
  assert.equal(replay.status, 303);
  assert.equal(replay.headers.location, base);
  assert.equal(exchanges, 1, 'A callback replay must not exchange its code twice.');
  const input = { items: [{ upc: '0000000000001', quantity: 2 }], csrfToken };
  for (const [operation, body] of [['connect', {}], ['add', input], ['disconnect', { csrfToken }]]) {
    for (const origin of [undefined, 'https://attacker.example', 'null']) {
      const headers = { cookie, ...(origin ? { origin } : {}) };
      const rejected = await invoke(server, { path: `api/v1/cart/${operation}`, body, headers });
      assert.equal(rejected.status, 403);
      assert.equal(rejected.body.error.code, origin ? 'origin_not_allowed' : 'origin_required');
    }
  }
  for (const headers of [{ origin: configured.publicOrigin }, { origin: configured.publicOrigin, cookie: `${cookie}; ${cookie}` },
    { origin: configured.publicOrigin, cookie }]) {
    const rejected = await invoke(server, { path: 'api/v1/cart/add', body: {
      ...input, ...(headers.cookie === cookie ? { csrfToken: 'wrong-visit' } : {}),
    }, headers });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error.code, 'cart_session_required');
  }
  const status = await invoke(server, { method: 'GET', path: 'api/v1/cart/status', headers: { cookie } });
  assert.equal(status.body.cart.connected, true);
  assert.equal(writes, 0, 'Connecting, callback, status and rejected requests must not write items.');
  const addition = await invoke(server, { path: 'api/v1/cart/add', body: input,
    headers: { origin: configured.publicOrigin, cookie } });
  assert.equal(addition.status, 200);
  assert.equal(addition.body.acknowledged, true);
  assert.equal(writes, 1);
});
