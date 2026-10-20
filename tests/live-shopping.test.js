import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { KrogerClient } from '../src/kroger.js';
import { estimateLiveBasket, readSelectedProduct, validateLiveEstimate } from '../src/live-shopping.js';
import { validSourceEvidence } from '../public/catalog.js';
import { NOW, STORE_ID, product, jsonResponse, tokenResponse } from './fixtures.js';

const config = { port: 4173, basePath: '/apps/houston-i-love-kroger/', publicOrigin: '' };
const ID = '0000000000001';
const SECOND_ID = '0000000000002';
const selection = (extra = {}) => ({ productId: ID, itemId: ID, quantity: 2, ...extra });
const clientWith = getProduct => ({ configured: true, environment: 'production', getProduct });

// Real request-listener, stream, validation and response paths, with synthetic
// source adapters and no socket, credentials, supplier call or database.
function invoke(server, { path = 'api/v1/basket/estimate', body = { locationId: STORE_ID, items: [selection()] },
  method = 'POST', headers = {}, onResponse } = {}) {
  const bytes = JSON.stringify(body);
  const request = Readable.from([Buffer.from(bytes)]);
  request.method = method;
  request.url = `${config.basePath}${path}`;
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
    response.body = JSON.parse(value.toString());
  };
  onResponse?.(response);
  return server.listeners('request')[0](request, response).then(() => response);
}

async function withApp(client, run, options = {}) {
  const server = await createApp({ config, client, now: () => NOW, ...options });
  try { return await run(server); }
  finally { server.emit('close'); }
}

test('exact product client preserves zero-prefixed IDs and uses the individual-product operation with store context', async () => {
  const calls = [];
  const client = new KrogerClient({ clientId: 'fixture-client', clientSecret: 'fixture-secret', fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return url.endsWith('/token') ? tokenResponse() : jsonResponse({ data: product() });
  } });
  const controller = new AbortController();
  assert.equal((await client.getProduct('00000001', ID, { signal: controller.signal })).productId, ID);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.pathname, `/v1/products/${ID}`);
  assert.deepEqual([...calls[1].url.searchParams], [['filter.locationId', '00000001']]);
  assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.signal.aborted, false);
});

test('exact product client rejects invalid inputs and mismatched, missing or list-shaped identities', async () => {
  let calls = 0;
  const client = new KrogerClient({ clientId: 'fixture-client', clientSecret: 'fixture-secret', fetchImpl: async () => { calls++; return tokenResponse(); } });
  for (const [store, id] of [[STORE_ID, 1], [STORE_ID, '123456789012'], [STORE_ID, '0000000000001/'], ['1', ID]]) {
    await assert.rejects(client.getProduct(store, id), { code: 'invalid_request' });
  }
  assert.equal(calls, 0);
  for (const data of [[product()], null, {}, product({ productId: SECOND_ID })]) {
    const invalid = new KrogerClient({ clientId: 'fixture-client', clientSecret: 'fixture-secret',
      fetchImpl: async url => url.endsWith('/token') ? tokenResponse() : jsonResponse({ data }) });
    await assert.rejects(invalid.getProduct(STORE_ID, ID), { code: 'upstream_format', status: 502 });
  }
});

test('exact retrieval runs normalization/evidence and a read-only history comparison with one shared instant', async () => {
  const calls = [];
  const histories = [];
  let clockReads = 0;
  await withApp(clientWith(async (store, id, options) => {
    calls.push({ store, id, options });
    const result = product({ price: { expirationDate: { value: new Date(NOW + 1).toISOString() } } });
    result.items.push({ ...result.items[0], itemId: 'other-variant', price: { regular: 5, promo: 0 } });
    return result;
  }), async server => {
    const { status, body } = await invoke(server, { path: 'api/v1/products/retrieve', body: { locationId: '00000001', productId: ID } });
    assert.equal(status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].store, '00000001');
    assert.equal(calls[0].id, ID);
    assert.ok(calls[0].options.signal instanceof AbortSignal);
    assert.equal(body.scope.mode, 'product');
    assert.equal(body.scope.productId, ID);
    assert.equal(body.scope.locationId, '00000001');
    assert.equal(body.scope.exhaustive, false);
    assert.equal(body.products.length, 2);
    assert.equal(body.offers.length, 1);
    assert.equal(body.page, null);
    assert.equal(body.retrievedAt, new Date(NOW).toISOString());
    assert.equal(validSourceEvidence(body.sourceEvidence, body.offers, body.retrievedAt), true);
    assert.equal(body.products[0].history.status, 'no_observations');
    assert.equal(body.products[1].history.reason, 'current_promotion_unqualified');
    assert.equal(histories[0].locationId, '00000001');
    assert.equal(histories[0].asOf, body.retrievedAt);
    assert.equal(clockReads, 2);
  }, { now: () => ++clockReads <= 2 ? NOW : NOW + 1,
    historyProvider: async input => { histories.push(input); return { status: 'available', histories: input.offers.map(() => ({ status: 'no_observations' })) }; } });
});

test('HTTP live inputs reject invented price/checkout fields, malformed identities, excessive lines and quantities before source reads', async () => {
  let calls = 0;
  await withApp(clientWith(async () => { calls++; return product(); }), async server => {
    const inputs = [null, {}, { locationId: STORE_ID, items: [] }, { locationId: 1400001, items: [selection()] },
      { locationId: STORE_ID, items: [selection()], currency: 'USD' },
      ...[0, -1, 100, 1.5, '2', null].map(quantity => ({ locationId: STORE_ID, items: [selection({ quantity })] })),
      ...['', ' variant', 'variant ', 'v\n', 'v\u200b', 'x'.repeat(65)].map(itemId => ({ locationId: STORE_ID, items: [selection({ itemId })] })),
      { locationId: STORE_ID, items: [selection({ productId: SECOND_ID.slice(1) })] },
      { locationId: STORE_ID, items: [selection({ price: 0.01 })] },
      { locationId: STORE_ID, items: [selection({ topic: 'milk' })] },
      { locationId: STORE_ID, items: [selection(), selection()] },
      { locationId: STORE_ID, items: Array.from({ length: 11 }, (_, i) => selection({ itemId: `variant${i}` })) }];
    for (const body of inputs) assert.equal((await invoke(server, { body })).status, 400);
    for (const body of [{ locationId: STORE_ID, productId: Number(ID) }, { locationId: STORE_ID, productId: ID, price: 1 },
      { locationId: STORE_ID, productId: '000000000001' }]) {
      assert.equal((await invoke(server, { path: 'api/v1/products/retrieve', body })).status, 400);
    }
    assert.equal(calls, 0);
  });
});

test('fresh basket arithmetic rechecks each unique product once, binds the store and never invokes history/storage/collection', async () => {
  const calls = [];
  const forbidden = () => { throw new Error('No history, database, search or Cart operation belongs to a fresh estimate.'); };
  let active = 0;
  await withApp({ ...clientWith(async (store, id) => {
    assert.equal(active++, 0, 'reads are sequential');
    calls.push([store, id]);
    await Promise.resolve();
    active--;
    const result = product({ productId: id, item: { inventory: { stockLevel: 'HIGH' }, fulfillment: { instore: true } } });
    if (id === ID) result.items.push({ ...result.items[0], itemId: 'variant-two', price: { regular: 8, promo: 0 } });
    return result;
  }), searchProducts: forbidden, searchStores: forbidden }, async server => {
    const { status, body } = await invoke(server, { body: { locationId: '00000001', items: [selection(), selection({ itemId: 'variant-two', quantity: 3 }), selection({ productId: SECOND_ID, itemId: SECOND_ID, quantity: 1 })] } });
    assert.equal(status, 200);
    assert.deepEqual(calls, [['00000001', ID], ['00000001', SECOND_ID]]);
    assert.equal(body.locationId, '00000001');
    assert.equal(body.dataSource, 'synthetic-fixture');
    assert.equal(body.status, 'complete');
    assert.deepEqual(body.lines.map(line => line.lineTotalCents), [600, 2400, 300]);
    assert.equal(body.totals.reportedSubtotalCents, 3300);
    assert.equal(body.totals.qualifiedSubtotalCents, null);
    assert.equal(body.totals.currency, null);
    assert.equal(body.totals.currencyQualification, 'unreported');
    assert.deepEqual(body.totals.qualificationGaps, ['currency_unreported', 'eligibility_unreported', 'modality_unreported', 'price_basis_unreported']);
    assert.equal(body.retrievedAt, body.evaluatedAt);
    assert.ok(body.lines.every(line => line.retrievedAt <= body.evaluatedAt));
    assert.deepEqual(body.coverage, { type: 'selected_products', requestedLineCount: 3, recheckedProductCount: 2, exhaustive: false,
      message: 'Fresh checks of the selected products only; no complete catalog or promotion coverage.' });
    assert.deepEqual(body.exclusions, ['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes']);
  }, { dataSource: 'synthetic-fixture', historyProvider: forbidden, promotionProvider: { getStatus: forbidden, estimateBasket: forbidden } });
});

test('ten unique product reads are bounded and successful request order is preserved', async () => {
  const items = Array.from({ length: 10 }, (_, i) => selection({ productId: String(i + 1).padStart(13, '0'), itemId: String(i + 1).padStart(13, '0'), quantity: 99 }));
  const calls = [];
  const body = await withApp(clientWith(async (_store, id) => { calls.push(id); return product({ productId: id }); }), async server => (await invoke(server, { body: { locationId: STORE_ID, items } })).body);
  assert.deepEqual(calls, items.map(item => item.productId));
  assert.deepEqual(body.lines.map(line => line.productId), calls);
  assert.equal(body.totals.reportedSubtotalCents, 297000);
  assert.equal(body.lines.length, 10);
});

test('missing variants and genuine 404s stay explicit beside partial prices; no result never becomes zero', async () => {
  await withApp(clientWith(async (_store, id) => {
    if (id === SECOND_ID) throw new AppError('upstream_not_found', 'Fixture missing product.', 502);
    return product();
  }), async server => {
    const body = { locationId: STORE_ID, items: [selection(), selection({ itemId: 'missing' }), selection({ productId: SECOND_ID, itemId: SECOND_ID })] };
    const partial = await invoke(server, { body });
    assert.equal(partial.status, 200);
    assert.equal(partial.body.status, 'partial');
    assert.deepEqual(partial.body.lines.map(line => line.reason), [null, 'item_not_found', 'product_not_found']);
    assert.equal(partial.body.totals.reportedSubtotalCents, 600);
    assert.equal(partial.body.totals.unresolvedLineCount, 2);
    assert.equal(partial.body.lines[1].source, null);
    const none = await invoke(server, { body: { ...body, items: body.items.slice(1) } });
    assert.equal(none.body.totals.reportedSubtotalCents, null);
    assert.equal(none.body.totals.qualifiedSubtotalCents, null);
    assert.equal(none.body.totals.estimatedLineCount, 0);
    assert.equal(none.body.totals.currencyQualification, 'unavailable');
    assert.ok(none.body.totals.qualificationGaps.includes('no_resolved_prices'));
    assert.equal((await invoke(server, { path: 'api/v1/products/retrieve', body: { locationId: STORE_ID, productId: SECOND_ID } })).body.error.code, 'upstream_not_found');
  });
});

test('live estimates preserve conflict variants, deduplicate exact repeats and never pick an arbitrary cheaper observation', async () => {
  for (const conflict of [true, false]) {
    await withApp(clientWith(async () => {
      const result = product();
      result.items.push({ ...result.items[0], price: conflict ? { regular: 4, promo: 1 } : { ...result.items[0].price } });
      return result;
    }), async server => {
      const { body } = await invoke(server);
      const line = body.lines[0];
      assert.equal(line.sourceEvidence.length, 2);
      assert.equal(line.sourceEvidence[1].recordIndex, 1);
      if (conflict) {
        assert.equal(line.reason, 'identity_conflict');
        assert.equal(line.source, null);
        assert.deepEqual(line.sourceEvidence.map(row => row.source.price.promo), [3, 1]);
        assert.equal(body.totals.reportedSubtotalCents, null);
      } else {
        assert.equal(line.reason, null);
        assert.equal(line.lineTotalCents, 600);
        assert.equal(line.sourceEvidence[1].duplicateOf, 0);
      }
    });
  }
});

test('missing, unsupported, out-of-stock, non-store, variable-unit and invalid date facts remain unresolved', async () => {
  const cases = [
    [product({ regular: null, promo: 0 }), 'missing_regular_price'],
    [product({ regular: 0, promo: 0 }), 'unsupported_price'],
    [product({ item: { inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } } }), 'out_of_stock'],
    [product({ item: { inventory: { stockLevel: 'OUT_OF_STOCK' } } }), 'out_of_stock'],
    [product({ item: { fulfillment: { instore: false } } }), 'not_in_store'],
    [product({ item: { soldBy: 'pound' } }), 'variable_or_unknown_quantity_basis'],
    [product({ item: { soldBy: null } }), 'variable_or_unknown_quantity_basis'],
    [product({ description: null }), 'incomplete_product'],
    [product({ price: { expirationDate: { value: new Date(NOW).toISOString() } } }), 'unqualified_dates'],
    [product({ price: { effectiveDate: { value: new Date(NOW + 1).toISOString() } } }), 'unqualified_dates'],
    [product({ price: { expirationDate: { value: '2026-10-20' } } }), 'unqualified_dates'],
  ];
  for (const [source, expected] of cases) {
    await withApp(clientWith(async () => source), async server => {
      const { status, body } = await invoke(server);
      assert.equal(status, 200);
      assert.equal(body.lines[0].reason, expected);
      assert.equal(body.lines[0].unitPriceCents, null);
      assert.equal(body.lines[0].lineTotalCents, null);
      assert.equal(body.totals.reportedSubtotalCents, null);
      assert.equal(body.lines[0].sourceEvidence.length, 1);
    });
  }
  await withApp(clientWith(async () => product()), async server => {
    const { body } = await invoke(server);
    assert.equal(body.lines[0].status, 'estimated');
    assert.ok(body.lines[0].qualificationGaps.includes('stock_unreported'));
    assert.ok(body.lines[0].qualificationGaps.includes('in_store_fulfillment_unreported'));
    assert.equal(body.lines[0].source.price.expirationDate, undefined, 'No supplied date is invented.');
  });
});

test('promo-only current price supports unqualified numeric quantity arithmetic without invented regular savings or currency', async () => {
  await withApp(clientWith(async () => product({ regular: null, promo: 2.5,
    price: { expirationDate: { value: new Date(NOW + 1000).toISOString() } } })), async server => {
    const { status, body } = await invoke(server, { body: { locationId: STORE_ID, items: [selection({ quantity: 3 })] } });
    assert.equal(status, 200);
    assert.equal(body.status, 'complete');
    const line = body.lines[0];
    assert.equal(line.status, 'estimated');
    assert.equal(line.reason, null);
    assert.equal(line.pricing.status, 'unqualified_promotion');
    assert.equal(line.pricing.reason, 'missing_regular_price');
    assert.equal(line.pricing.regularCents, null);
    assert.equal(line.pricing.currentCents, 250);
    assert.equal(line.unitPriceCents, 250);
    assert.equal(line.lineTotalCents, 750);
    assert.equal(line.source.price.regular, null);
    assert.equal(line.source.price.promo, 2.5);
    assert.equal(line.sourceEvidence[0].savingsArithmeticAvailable, false);
    assert.equal(line.sourceEvidence[0].includedInOffers, false);
    assert.equal(line.currency, null);
    assert.equal(body.totals.reportedSubtotalCents, 750);
    assert.equal(body.totals.qualifiedSubtotalCents, null);
    assert.equal(body.totals.currency, null);
    assert.equal(body.totals.currencyQualification, 'unreported');
  });
});

test('unsafe line multiplication and subtotal addition never become rounded totals', async () => {
  await withApp(clientWith(async (_store, id) => product({ productId: id, regular: 90_000_000_000_000, promo: 89_000_000_000_000 })), async server => {
    const lineOverflow = await invoke(server);
    assert.equal(lineOverflow.body.lines[0].reason, 'arithmetic_overflow');
    assert.equal(lineOverflow.body.totals.reportedSubtotalCents, null);
    const subtotalOverflow = await invoke(server, { body: { locationId: STORE_ID, items: [selection({ quantity: 1 }), selection({ productId: SECOND_ID, itemId: SECOND_ID, quantity: 1 })] } });
    assert.equal(subtotalOverflow.body.status, 'complete', 'All requested line arithmetic resolved, while subtotal is explicitly unsafe.');
    assert.equal(subtotalOverflow.body.totals.reportedSubtotalCents, null);
    assert.ok(subtotalOverflow.body.totals.qualificationGaps.includes('arithmetic_overflow'));
  });
});

test('source mismatches, malformed facts, unavailable responses and 429s fail the whole request and stop later reads', async () => {
  for (const failure of [new AppError('upstream_unavailable', 'Try again.', 502),
    new AppError('provider_limit', 'Wait.', 429, { retryAfter: 300 }),
    new AppError('permission_denied', 'Check setup.', 503)]) {
    let calls = 0;
    await withApp(clientWith(async () => { calls++; throw failure; }), async server => {
      const response = await invoke(server, { body: { locationId: STORE_ID, items: [selection(), selection({ productId: SECOND_ID, itemId: SECOND_ID })] } });
      assert.equal(response.status, failure.status);
      assert.equal(response.body.error.code, failure.code);
      assert.equal(response.body.ok, false);
      assert.equal(calls, 1);
      if (failure.retryAfter) assert.equal(String(response.headers['retry-after']), '300');
      assert.equal(response.body.lines, undefined);
    });
  }
  for (const source of [product({ productId: SECOND_ID }), { ...product(), items: [{ itemId: ID, price: { regular: '4', promo: 3 } }] }]) {
    let calls = 0;
    await withApp(clientWith(async () => { calls++; return source; }), async server => {
      for (const [path, body] of [['api/v1/products/retrieve', { locationId: STORE_ID, productId: ID }],
        ['api/v1/basket/estimate', { locationId: STORE_ID, items: [selection(), selection({ productId: SECOND_ID, itemId: SECOND_ID })] }]]) {
        assert.equal((await invoke(server, { path, body })).body.error.code, 'upstream_format');
      }
      assert.equal(calls, 2, 'Each request stops at its first invalid source response.');
    });
  }
});

test('sequential rechecks use the final common evaluation instant and preserve individual retrieval times', async () => {
  let clockReads = 0;
  await withApp(clientWith(async (_store, id) => product({ productId: id, price: id === ID
    ? { expirationDate: { value: new Date(NOW + 1).toISOString() } } : {} })), async server => {
    const { status, body } = await invoke(server, { body: { locationId: STORE_ID,
      items: [selection(), selection({ productId: SECOND_ID, itemId: SECOND_ID })] } });
    assert.equal(status, 200);
    assert.equal(body.lines[0].retrievedAt, new Date(NOW).toISOString());
    assert.equal(body.lines[1].retrievedAt, new Date(NOW + 1).toISOString());
    assert.equal(body.evaluatedAt, new Date(NOW + 1).toISOString());
    assert.equal(body.retrievedAt, body.evaluatedAt);
    assert.equal(body.lines[0].reason, 'unqualified_dates');
    assert.equal(body.lines[1].lineTotalCents, 600);
    assert.equal(body.totals.reportedSubtotalCents, 600);
  }, { now: () => ++clockReads <= 2 ? NOW : NOW + 1 });
});

test('exact retrieval preserves current facts when history fails and never attaches production history to certification', async () => {
  for (const environment of ['production', 'certification']) {
    let calls = 0;
    await withApp({ ...clientWith(async () => product()), environment }, async server => {
      const { status, body } = await invoke(server, { path: 'api/v1/products/retrieve', body: { locationId: STORE_ID, productId: ID } });
      assert.equal(status, 200);
      assert.equal(body.products[0].pricing.currentCents, 300);
      assert.equal(body.history.reason, environment === 'production' ? 'history_read_failed' : 'history_environment_mismatch');
      assert.equal(calls, environment === 'production' ? 1 : 0);
    }, { historyProvider: async () => { calls++; throw new Error('Fixture history unavailable.'); } });
  }
});

test('cancellation before or during a recheck stops the operation and subsequent product reads', async () => {
  const input = validateLiveEstimate({ locationId: STORE_ID, items: [selection(), selection({ productId: SECOND_ID, itemId: SECOND_ID })] });
  let calls = 0;
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(estimateLiveBasket(clientWith(async () => { calls++; }), input, { signal: cancelled.signal }), { code: 'request_cancelled' });
  assert.equal(calls, 0);
  const midRead = new AbortController();
  await assert.rejects(estimateLiveBasket(clientWith(async () => { calls++; midRead.abort(); return product(); }), input,
    { signal: midRead.signal }), { code: 'request_cancelled' });
  assert.equal(calls, 1);
  let response;
  await withApp(clientWith(async (_store, _id, { signal }) => {
    response.emit('close');
    assert.equal(signal.aborted, true);
    return product();
  }), async server => {
    const result = await invoke(server, { onResponse: value => { response = value; } });
    assert.equal(result.status, 499);
    assert.equal(result.body.error.code, 'request_cancelled');
  });
});

test('missing retrieval capability and setup remain actionable, while supplied methods/origins obey existing app boundaries', async () => {
  await withApp({ configured: true, environment: 'production' }, async server => {
    assert.equal((await invoke(server)).body.error.code, 'product_retrieval_unavailable');
    await assert.rejects(readSelectedProduct({}, { locationId: STORE_ID, productId: ID }), { status: 503 });
  });
  await withApp({ configured: false, environment: 'production' }, async server => {
    assert.equal((await invoke(server)).body.error.code, 'setup_required');
  });
  await withApp(clientWith(async () => product()), async server => {
    assert.equal((await invoke(server, { method: 'GET' })).status, 405);
    assert.equal((await invoke(server, { headers: { origin: 'https://elsewhere.invalid' } })).status, 403);
    assert.equal((await invoke(server)).status, 200, 'Native clients may omit Origin under the existing public-read contract.');
  });
});
