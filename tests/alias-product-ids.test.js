import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { productDetails } from '../src/catalog.js';
import { compareOffers } from '../src/deals.js';
import { validSourceEvidence } from '../public/catalog.js';
import { NOW, STORE_ID, product } from './fixtures.js';

const config = { port: 4173, basePath: '/apps/houston-i-love-kroger/', publicOrigin: '' };

function aliases(count, width = 13) {
  const values = Array.from({ length: count }, (_, index) => String(count - index).padStart(width, '0'));
  if (count > 1) values[count - 1] = values[0];
  return values;
}

// Synthetic distribution matching the accepted shape buckets, not real records:
// 3 absent fields, 32 short arrays, 15 arrays in 51..500; 1,509 strings total.
function groceryPage(variants = 1, aliasWidth = 13) {
  const largerCounts = [500, ...Array(13).fill(60), 69];
  return Array.from({ length: 50 }, (_, index) => {
    const count = index < 3 ? null : index < 35 ? 5 : largerCounts[index - 35];
    const value = product({ productId: String(index + 1).padStart(13, '0'), description: 'Synthetic apples',
      ...(count === null ? {} : { aliasProductIds: aliases(count, aliasWidth) }) });
    value.items = Array.from({ length: variants }, (_, itemIndex) => ({ ...value.items[0],
      itemId: String(index * 10 + itemIndex + 1).padStart(13, '0') }));
    return value;
  });
}

async function invoke(server, path, body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = 'POST';
  request.url = `${config.basePath}${path}`;
  request.headers = { host: 'localhost:4173', 'content-type': 'application/json' };
  request.complete = false;
  request.once('end', () => { request.complete = true; });
  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  response.setHeader = () => {};
  response.writeHead = status => { response.status = status; };
  response.end = value => { response.writableEnded = true; response.body = JSON.parse(value.toString()); };
  await server.listeners('request')[0](request, response);
  assert.equal(response.status, 200);
  return response.body;
}

test('aliases at 50, 51 and the observed larger-count bucket preserve order, duplicates and zeros', () => {
  for (const count of [0, 50, 51, 69, 500]) {
    for (const width of [13, 64]) {
      const original = aliases(count, width);
      const input = { aliasProductIds: [...original] };
      assert.deepEqual(productDetails(input).aliasProductIds, original);
      assert.deepEqual(input.aliasProductIds, original);
    }
  }
  assert.deepEqual(productDetails({}).aliasProductIds, []);
  assert.deepEqual(productDetails({ aliasProductIds: null }).aliasProductIds, []);
});

test('malformed aliases, oversized elements and arrays beyond the supplier-byte-derived bound still fail', () => {
  for (const value of [false, 1, '', {}, [null], [1], [false], [{}], [[]], ['x'.repeat(65)],
    Array(Math.floor(2_000_000 / 3) + 1).fill('')]) {
    assert.throws(() => productDetails({ aliasProductIds: value }), { code: 'upstream_format', status: 502 });
  }
  assert.throws(() => compareOffers([product({ aliasProductIds: aliases(500), regular: '4' })]), { code: 'upstream_format' });
});

test('a mixed 50-product grocery page retains every row and all 1509 supplied aliases', () => {
  const input = groceryPage();
  const original = structuredClone(input);
  const result = compareOffers(input, { now: NOW });
  assert.equal(result.summary.products, 50);
  assert.equal(result.products.length, 50);
  assert.equal(result.offers.length, 50);
  assert.equal(result.sourceEvidence.records.length, 50);
  assert.equal(result.products.reduce((sum, row) => sum + row.source.aliasProductIds.length, 0), 1509);
  for (let index = 0; index < input.length; index++) {
    assert.deepEqual(result.products[index].source.aliasProductIds, input[index].aliasProductIds ?? []);
    assert.equal(result.products[index].source.productId, input[index].productId);
    assert.deepEqual(result.products[index].source.price, input[index].items[0].price);
  }
  assert.deepEqual(input, original);
  assert.equal(validSourceEvidence(result.sourceEvidence, result.offers, new Date(NOW).toISOString()), true);
});

test('search, exact retrieval and a fresh estimate preserve the same exact aliases', async t => {
  const inputs = groceryPage();
  const chosen = inputs[35];
  const reads = [];
  const server = await createApp({ config, now: () => NOW, dataSource: 'synthetic-fixture',
    client: { configured: true, environment: 'production',
      searchProductPage: async () => ({ products: inputs, pagination: { start: 1, limit: 50, total: 50 } }),
      getProduct: async (store, id) => { reads.push([store, id]); return inputs.find(value => value.productId === id); } },
  });
  try {
    const found = await invoke(server, 'api/v1/products/search', { locationId: STORE_ID, term: 'apples', includeAll: true });
    assert.equal(found.products.length, 50);
    assert.deepEqual(found.products[35].source.aliasProductIds, chosen.aliasProductIds);
    const retrieved = await invoke(server, 'api/v1/products/retrieve', { locationId: STORE_ID, productId: chosen.productId });
    assert.deepEqual(retrieved.products[0].source.aliasProductIds, chosen.aliasProductIds);
    const estimated = await invoke(server, 'api/v1/basket/estimate', { locationId: STORE_ID,
      items: [{ productId: chosen.productId, itemId: chosen.items[0].itemId, quantity: 2 }] });
    assert.deepEqual(estimated.lines[0].source.aliasProductIds, chosen.aliasProductIds);
    assert.equal(estimated.lines[0].lineTotalCents, 600);
    assert.deepEqual(reads, [[STORE_ID, chosen.productId], [STORE_ID, chosen.productId]]);
    const bytes = Buffer.byteLength(JSON.stringify(found));
    assert.ok(bytes < 8_000_000);
    t.diagnostic(`Synthetic 50-product search response: ${bytes} serialized UTF-8 bytes.`);
  } finally { server.emit('close'); }
});

test('representative multi-item response retains all aliases and fits unchanged byte budgets', t => {
  const inputs = groceryPage(10, 64);
  const sourceBytes = Buffer.byteLength(JSON.stringify({ data: inputs }));
  const result = compareOffers(inputs, { now: NOW });
  const normalizedBytes = Buffer.byteLength(JSON.stringify(result));
  assert.equal(result.products.length, 500);
  assert.equal(result.offers.length, 500);
  assert.equal(result.sourceEvidence.records.length, 500);
  assert.equal(result.products.reduce((sum, row) => sum + row.source.aliasProductIds.length, 0), 15090);
  assert.ok(sourceBytes < 2_000_000);
  assert.ok(normalizedBytes < 8_000_000);
  t.diagnostic(`Synthetic 50x10 variants, 1509 supplied alias entries of length64: supplier ${sourceBytes}, comparison ${normalizedBytes} UTF-8 bytes.`);
});

test('different alias metadata still participates in existing identity-conflict detection', () => {
  const first = product({ aliasProductIds: aliases(51) });
  const second = { ...structuredClone(first), aliasProductIds: aliases(500) };
  const result = compareOffers([first, second], { now: NOW });
  assert.equal(result.products.length, 0);
  assert.equal(result.summary.conflictingItems, 1);
  assert.ok(result.sourceEvidence.records.every(row => row.dispositions.includes('identity_conflict')));
});
