import test from 'node:test';
import assert from 'node:assert/strict';
import { KrogerClient } from '../src/kroger.js';
import { extractProductPagination, productPageContinuation } from '../src/product-pagination.js';
import { STORE_ID, product, tokenResponse } from './fixtures.js';

const credentials = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret' };
function fixture(payload) {
  const calls = [];
  const client = new KrogerClient({ ...credentials, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return url.endsWith('/token') ? tokenResponse() : Response.json(payload);
  } });
  return { client, calls };
}

test('default page preserves source numeric metadata and every raw product while omitting filter.start', async () => {
  const products = [product(), product({ description: 'Synthetic unknown-price item', items: [{ itemId: 'missing-price' }] }),
    product({ description: 'Synthetic zero promo', items: [{ itemId: 'zero-promo', price: { regular: 5, promo: 0 } }] }), product()];
  const { client, calls } = fixture({ data: products, meta: { pagination: { start: 0, limit: 50, total: 1000 }, ignored: 'not exposed' } });
  const page = await client.searchProductPage(STORE_ID, 'milk & bread');
  assert.deepEqual(page, { products, pagination: { start: 0, limit: 50, total: 1000 } });
  assert.equal(calls.length, 2); assert.equal(calls[1].url.origin, 'https://api.kroger.com');
  assert.equal(calls[1].url.pathname, '/v1/products');
  assert.equal(calls[1].url.searchParams.get('filter.locationId'), STORE_ID);
  assert.equal(calls[1].url.searchParams.get('filter.term'), 'milk & bread');
  assert.equal(calls[1].url.searchParams.get('filter.fulfillment'), 'ais');
  assert.equal(calls[1].url.searchParams.get('filter.limit'), '50');
  assert.equal(calls[1].url.searchParams.has('filter.start'), false);
  assert.equal(calls[1].options.cache, 'no-store'); assert.equal(calls[1].options.redirect, 'error');
});

test('explicit documented boundary starts and limits are encoded with exact store context and no automatic continuation', async () => {
  const { client, calls } = fixture({ data: [product()], meta: { pagination: { start: 1, limit: 1, total: 1000 } } });
  for (const [start, limit] of [[1, 1], [51, 50], [250, 50]]) {
    const before = calls.length;
    await client.searchProductPage(STORE_ID, 'milk', { start, limit });
    assert.equal(calls.length - before, before === 0 ? 2 : 1);
    assert.equal(calls.at(-1).url.searchParams.get('filter.start'), String(start));
    assert.equal(calls.at(-1).url.searchParams.get('filter.limit'), String(limit));
  }
});

test('legacy searchProducts remains one array page and does not adopt a caller-supplied start', async () => {
  const products = [product()];
  const { client, calls } = fixture({ data: products, meta: { pagination: { start: 0, limit: 50, total: 1000 } } });
  assert.deepEqual(await client.searchProducts(STORE_ID, 'milk', { start: 51 }), products);
  assert.equal(calls.length, 2); assert.equal(calls[1].url.searchParams.has('filter.start'), false);
});

test('an entire fifty-product page survives without ranking, deduplication or a first45 cutoff', async () => {
  const products = Array.from({ length: 50 }, (_, index) => product({ productId: `synthetic-${index}` }));
  products[49] = { productId: 'synthetic-last-unpriced', items: [] };
  const { client } = fixture({ data: products, meta: { pagination: { start: 200, limit: 50, total: 1000 } } });
  const result = await client.searchProductPage(STORE_ID, 'milk', { start: 200 });
  assert.equal(result.products.length, 50); assert.deepEqual(result.products, products);
  assert.deepEqual(productPageContinuation(result.pagination, result.products.length), { status: 'available', nextStart: 250 });
});

test('invalid page inputs fail before token or product requests, including explicit zero and noninteger starts', async () => {
  const { client, calls } = fixture({ data: [] });
  for (const start of [0, -0, -1, 251, 1.5, NaN, Infinity, '51', null, true, {}, []]) {
    await assert.rejects(client.searchProductPage(STORE_ID, 'milk', { start }), { code: 'invalid_search' });
  }
  for (const limit of [0, -1, 51, 1.5, NaN, Infinity, '50', null]) {
    await assert.rejects(client.searchProductPage(STORE_ID, 'milk', { limit }), { code: 'invalid_search' });
  }
  await assert.rejects(client.searchProductPage('bad-store', 'milk'), { code: 'invalid_search' });
  await assert.rejects(client.searchProductPage(STORE_ID, 'a b c d e f g h i'), { code: 'invalid_search' });
  await assert.rejects(client.searchProductPage(STORE_ID, 'mi\nlk'), { code: 'invalid_search' });
  assert.equal(calls.length, 0);
});

test('missing and malformed metadata cannot invent facts or discard a valid raw page', async () => {
  const products = [product()];
  for (const meta of [undefined, null, [], 'private-marker', {}, { pagination: null }, { pagination: [] },
    { pagination: { start: '0', limit: -1, total: 1.5 } }]) {
    const { client } = fixture({ data: products, ...(meta === undefined ? {} : { meta }) });
    const page = await client.searchProductPage(STORE_ID, 'milk', { start: 51, limit: 10 });
    assert.deepEqual(page, { products, pagination: { start: null, limit: null, total: null } });
    assert.deepEqual(productPageContinuation(page.pagination, products.length), { status: 'unknown', nextStart: null });
  }
  assert.deepEqual(extractProductPagination({ pagination: { start: 0, limit: 0, total: 0 } }), { start: 0, limit: 0, total: 0 });
  assert.deepEqual(extractProductPagination({ pagination: { start: 251, limit: 1000, total: Number.MAX_SAFE_INTEGER } }),
    { start: 251, limit: 1000, total: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(extractProductPagination({ pagination: { start: Infinity, limit: NaN, total: Number.MAX_SAFE_INTEGER + 1 } }),
    { start: null, limit: null, total: null });
});

test('continuation uses observed start and returned records, leaving source total independent of page count', () => {
  const reported = { start: 0, limit: 50, total: 1000 };
  assert.deepEqual(productPageContinuation(reported, 50), { status: 'available', nextStart: 50 });
  assert.deepEqual(productPageContinuation({ start: 51, limit: 50, total: 1000 }, 50), { status: 'available', nextStart: 101 });
  assert.deepEqual(productPageContinuation({ start: 0, limit: 50, total: null }, 3), { status: 'available', nextStart: 3 });
  assert.deepEqual(productPageContinuation({ start: 1, limit: null, total: null }, 3), { status: 'available', nextStart: 4 });
  assert.deepEqual(reported, { start: 0, limit: 50, total: 1000 });
});

test('source-reported end and documented continuation cap remain distinct, without an exhaustion claim', () => {
  for (const [pagination, count] of [[{ start: 0, limit: 50, total: 3 }, 3], [{ start: 51, limit: 50, total: 54 }, 3],
    [{ start: 0, limit: 50, total: 0 }, 0], [{ start: 51, limit: 50, total: 3 }, 0]]) {
    assert.deepEqual(productPageContinuation(pagination, count), { status: 'reported_end', nextStart: null });
  }
  assert.deepEqual(productPageContinuation({ start: 200, limit: 50, total: 1000 }, 50), { status: 'available', nextStart: 250 });
  assert.deepEqual(productPageContinuation({ start: 201, limit: 50, total: 1000 }, 50), { status: 'source_limit', nextStart: null });
  assert.deepEqual(productPageContinuation({ start: 250, limit: 50, total: null }, 1), { status: 'source_limit', nextStart: null });
  assert.deepEqual(productPageContinuation({ start: 250, limit: 50, total: 251 }, 1), { status: 'reported_end', nextStart: null });
});

test('changing reported totals stay local to each response, without a remembered total or catalog exhaustion promise', async () => {
  let reads = 0;
  const client = new KrogerClient({ ...credentials, fetchImpl: async url => {
    if (url.endsWith('/token')) return tokenResponse();
    reads++;
    return Response.json(reads === 1
      ? { data: Array(50).fill(product()), meta: { pagination: { start: 0, limit: 50, total: 1000 } } }
      : { data: Array(10).fill(product()), meta: { pagination: { start: 50, limit: 50, total: 60 } } });
  } });
  const first = await client.searchProductPage(STORE_ID, 'milk');
  const second = await client.searchProductPage(STORE_ID, 'milk', { start: 50 });
  assert.equal(first.pagination.total, 1000); assert.equal(second.pagination.total, 60);
  assert.deepEqual(productPageContinuation(first.pagination, first.products.length), { status: 'available', nextStart: 50 });
  assert.deepEqual(productPageContinuation(second.pagination, second.products.length), { status: 'reported_end', nextStart: null });
  assert.equal(reads, 2);
});

test('empty, inconsistent, missing and malformed source metadata cannot claim a next page or reported end', () => {
  for (const [pagination, count] of [[{ start: 0, limit: 50, total: null }, 0], [{ start: 0, limit: 50, total: 1000 }, 0],
    [{ start: null, limit: 50, total: 1000 }, 50], [{ start: 1, limit: 50, total: 50 }, 50],
    [{ start: 0, limit: 1, total: 1000 }, 2], [{ start: 0, limit: 0, total: 0 }, 0],
    [{ start: 0, limit: 51, total: 1000 }, 50], [{ start: 0, limit: null, total: '1000' }, 1],
    [{ start: Number.MAX_SAFE_INTEGER, limit: null, total: null }, 1], [{ start: 0, limit: null, total: null }, 51],
    [{ start: 0, limit: null, total: null }, -1], [null, 1], [{}, 1]]) {
    assert.deepEqual(productPageContinuation(pagination, count), { status: 'unknown', nextStart: null });
  }
});

test('invalid product array or a page exceeding the requested bound fails without exposing upstream content', async () => {
  for (const payload of [{ private: 'synthetic-private-marker' }, { data: null }, { data: {} },
    { data: Array(3).fill(product()) }, { data: Array(51).fill(product()) }]) {
    const { client, calls } = fixture(payload);
    await assert.rejects(client.searchProductPage(STORE_ID, 'milk', { limit: 2 }), error => {
      assert.equal(error.code, 'upstream_format'); assert.equal(error.message.includes('synthetic-private-marker'), false); return true;
    });
    assert.equal(calls.length, 2);
  }
});

test('page request cancellation stops before fetch or cancels a stalled response body', async () => {
  const before = new AbortController(); before.abort();
  const { client, calls } = fixture({ data: [] });
  await assert.rejects(client.searchProductPage(STORE_ID, 'milk', { start: 51, signal: before.signal }), { code: 'request_cancelled' });
  assert.equal(calls.length, 0);
  let cancelledBody = false;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const during = new AbortController();
  const slow = new KrogerClient({ ...credentials, fetchImpl: async url => {
    if (url.endsWith('/token')) return tokenResponse();
    const body = new ReadableStream({ start() { entered(); }, cancel() { cancelledBody = true; } });
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  } });
  const pending = assert.rejects(slow.searchProductPage(STORE_ID, 'milk', { signal: during.signal }), { code: 'request_cancelled' });
  await ready; during.abort(); await pending; assert.equal(cancelledBody, true);
});

test('page request inherits bounded authorization renewal and private error handling without traversal retries', async () => {
  for (const [status, code, expectedCalls] of [[400, 'upstream_rejected', 2], [401, 'permission_denied', 4],
    [403, 'permission_denied', 2], [404, 'upstream_not_found', 2], [429, 'provider_limit', 2], [503, 'upstream_unavailable', 2]]) {
    let calls = 0;
    const client = new KrogerClient({ ...credentials, fetchImpl: async url => {
      calls++;
      return url.endsWith('/token') ? tokenResponse() : Response.json({ private: 'synthetic-private-marker' }, { status, headers: { 'Retry-After': '300' } });
    } });
    await assert.rejects(client.searchProductPage(STORE_ID, 'milk', { start: 51 }), error => {
      assert.equal(error.code, code); assert.equal(error.message.includes('synthetic-private-marker'), false);
      assert.equal(error.message.includes(credentials.clientSecret), false);
      if ([429, 503].includes(status)) assert.equal(error.retryAfter, 300); return true;
    });
    assert.equal(calls, expectedCalls);
  }
});
