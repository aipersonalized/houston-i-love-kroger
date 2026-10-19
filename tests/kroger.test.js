import test from 'node:test';
import assert from 'node:assert/strict';
import { KrogerClient, readJsonResponse } from '../src/kroger.js';
import { NOW, STORE_ID, product, store, jsonResponse, tokenResponse } from './fixtures.js';

const credentials = { clientId: 'fixture-client', clientSecret: 'fixture-secret' };

test('provider Retry-After seconds and dates survive token/product failures without early retry', async () => {
  for (const [header, expected] of [['300', 300], [new Date(NOW + 300000).toUTCString(), 300], ['172800', 172800], ['invalid', 60]]) {
    let calls = 0;
    const client = new KrogerClient({ ...credentials, now: () => NOW, fetchImpl: async url => {
      calls++;
      return url.endsWith('/token') ? tokenResponse() : Response.json({}, { status: 429, headers: { 'Retry-After': header } });
    } });
    await assert.rejects(client.searchProducts(STORE_ID, 'milk'), { code: 'provider_limit', retryAfter: expected });
    assert.equal(calls, 2);
  }
  const client = new KrogerClient({ ...credentials, now: () => NOW,
    fetchImpl: async () => Response.json({}, { status: 503, headers: { 'Retry-After': '300' } }) });
  await assert.rejects(client.searchProducts(STORE_ID, 'milk'), { code: 'upstream_unavailable', retryAfter: 300 });
});

test('client credentials stay on the server; fixed contextual upstream filters are encoded', async () => {
  const calls = [];
  const client = new KrogerClient({ ...credentials, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (url.endsWith('/token')) return tokenResponse();
    return jsonResponse({ data: url.includes('/locations?') ? [store()] : [product()] });
  } });
  assert.equal(client.configured, true);
  assert.deepEqual(await client.searchStores('00501'), [store()]);
  await client.searchProducts(STORE_ID, 'milk & bread', { limit: 15 });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.origin, 'https://api.kroger.com');
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`);
  assert.equal(calls[0].options.body, 'grant_type=client_credentials&scope=product.compact');
  assert.equal(calls[1].url.searchParams.get('filter.zipCode.near'), '00501');
  assert.equal(calls[1].url.searchParams.get('filter.chain'), 'Kroger');
  assert.equal(calls[1].url.searchParams.get('filter.radiusInMiles'), '10');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(calls[2].url.pathname, '/v1/products');
  assert.equal(calls[2].url.searchParams.get('filter.term'), 'milk & bread');
  assert.equal(calls[2].url.searchParams.get('filter.locationId'), STORE_ID);
  assert.equal(calls[2].url.searchParams.get('filter.limit'), '15');
  assert.equal(calls[2].url.searchParams.get('filter.fulfillment'), 'ais');
  assert.equal(calls[2].options.redirect, 'error');
  assert.equal(calls[2].options.cache, 'no-store');
});

test('concurrent calls share token acquisition; expiry comes from the actual response', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let tokens = 0;
  let now = NOW;
  const client = new KrogerClient({ ...credentials, now: () => now, fetchImpl: async url => {
    if (url.endsWith('/token')) { tokens++; await held; return tokenResponse({ expires_in: 1 }); }
    return jsonResponse({ data: [product()] });
  } });
  const a = client.searchProducts(STORE_ID, 'milk');
  const b = client.searchProducts(STORE_ID, 'bread');
  assert.equal(tokens, 1);
  release();
  await Promise.all([a, b]);
  assert.equal(tokens, 1);
  now += 901;
  await client.searchProducts(STORE_ID, 'eggs');
  assert.equal(tokens, 2);
});

test('a rejected safe read renews at most once; forbidden reads do not renew', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    let tokens = 0;
    const client = new KrogerClient({ ...credentials, fetchImpl: async url => {
      calls++;
      if (url.endsWith('/token')) { tokens++; return tokenResponse({ access_token: `fixture-${tokens}` }); }
      return jsonResponse({ secret: 'DO_NOT_EMIT_UPSTREAM_BODY' }, status);
    } });
    await assert.rejects(client.searchProducts(STORE_ID, 'milk'), error => {
      assert.equal(error.code, 'permission_denied');
      assert.ok(!error.message.includes('DO_NOT_EMIT_UPSTREAM_BODY'));
      return true;
    });
    assert.equal(calls, status === 401 ? 4 : 2);
    assert.equal(tokens, status === 401 ? 2 : 1);
  }
});

test('the local request budget counts token requests and failed HTTP attempts', async () => {
  let calls = 0;
  let now = NOW;
  const client = new KrogerClient({ ...credentials, maxRequests: 2, now: () => now, fetchImpl: async url => {
    calls++;
    return url.endsWith('/token') ? tokenResponse() : jsonResponse({}, 500);
  } });
  await assert.rejects(client.searchProducts(STORE_ID, 'milk'), { code: 'upstream_unavailable' });
  await assert.rejects(client.searchProducts(STORE_ID, 'milk'), { code: 'budget_reached', status: 429 });
  assert.equal(calls, 2);
  now += 86_400_000;
  await assert.rejects(client.searchProducts(STORE_ID, 'milk'), { code: 'upstream_unavailable' });
  assert.equal(calls, 4);
});

test('unsafe or malformed token responses fail before an API read or header injection', async () => {
  const invalid = [{ access_token: '' }, { access_token: 'bad\nheader' }, { access_token: 'has spaces' },
    { access_token: 'x'.repeat(8193) }, { token_type: 'basic' }, { expires_in: '1800' }, { expires_in: -1 }];
  for (const extra of invalid) {
    let calls = 0;
    const client = new KrogerClient({ ...credentials, fetchImpl: async () => { calls++; return tokenResponse(extra); } });
    await assert.rejects(client.searchProducts(STORE_ID, 'milk'), { code: 'upstream_format' });
    assert.equal(calls, 1);
  }
});

test('responses and array counts stay bounded even when the provider ignores its requested limit', async () => {
  await assert.rejects(readJsonResponse(jsonResponse({ text: 'x'.repeat(100) }), 32), { code: 'upstream_size' });
  await assert.rejects(readJsonResponse(new Response('{}', { headers: { 'Content-Type': 'application/json-extra' } })), { code: 'upstream_format' });
  await assert.rejects(readJsonResponse(new Response('not json', { headers: { 'Content-Type': 'application/json' } })), { code: 'upstream_format' });
  await assert.rejects(readJsonResponse(jsonResponse({}, 200, { 'Content-Length': '9999999' })), { code: 'upstream_size' });
  const client = new KrogerClient({ ...credentials, fetchImpl: async url => url.endsWith('/token')
    ? tokenResponse() : jsonResponse({ data: Array(16).fill(product()) }) });
  await assert.rejects(client.searchProducts(STORE_ID, 'milk', { limit: 15 }), { code: 'upstream_format' });
});

test('body cancellation cleans up stalled reads instead of waiting after headers', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { 'Content-Type': 'application/json' },
  });
  const abort = new AbortController();
  const pending = assert.rejects(readJsonResponse(response, 100, { signal: abort.signal }));
  abort.abort(new Error('fixture cancellation'));
  await pending;
  assert.equal(cancelled, true);
});

test('shopper cancellation does not cancel another caller’s shared token acquisition', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let tokens = 0;
  let reads = 0;
  const client = new KrogerClient({ ...credentials, fetchImpl: async url => {
    if (url.endsWith('/token')) { tokens++; await held; return tokenResponse(); }
    reads++; return jsonResponse({ data: [product()] });
  } });
  const abort = new AbortController();
  const a = assert.rejects(client.searchProducts(STORE_ID, 'milk', { signal: abort.signal }), { code: 'request_cancelled' });
  const b = client.searchProducts(STORE_ID, 'bread');
  abort.abort();
  release();
  await Promise.all([a, b]);
  assert.equal(tokens, 1);
  assert.equal(reads, 1);
});

test('network deadlines apply to fake slow fetches and fixed errors exclude raw failures', async () => {
  const client = new KrogerClient({ ...credentials, timeoutMs: 5, fetchImpl: async (_url, { signal }) => {
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('DO_NOT_EMIT_CREDENTIAL')), { once: true }));
  } });
  const pending = assert.rejects(client.searchProducts(STORE_ID, 'milk'), error => {
    assert.equal(error.code, 'upstream_unavailable');
    assert.ok(!error.message.includes('DO_NOT_EMIT_CREDENTIAL'));
    return true;
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  await pending;
});

test('invalid requests and unsupported origins never trigger fetch', async () => {
  let calls = 0;
  const client = new KrogerClient({ ...credentials, fetchImpl: async () => { calls++; throw new Error(); } });
  await assert.rejects(client.searchStores('1234'));
  await assert.rejects(client.searchProducts(STORE_ID, '   '));
  await assert.rejects(client.searchProducts('https://bad', 'milk'));
  assert.throws(() => new KrogerClient({ environment: 'https://bad.example' }));
  assert.throws(() => new KrogerClient({ ...credentials, maxRequests: 1001 }));
  assert.equal(calls, 0);
});
