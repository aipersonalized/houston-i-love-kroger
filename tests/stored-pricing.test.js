import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateStoredLine, storedEstimateTotals } from '../src/stored-pricing.js';
import { SOURCE, FIRST, SECOND, policy, offer, setup, save } from './promotion-fixtures.js';

const at = hours => new Date(Date.parse(FIRST) + hours * 3_600_000).toISOString();
const unit = (extra = {}) => offer({ inStore: true, stockLevel: 'HIGH', ...extra });
const item = (itemId = 'synthetic-item', extra = {}) => ({ topic: 'milk', productId: 'synthetic-product', itemId, quantity: 1, ...extra });
const prices = (store, input = {}) => store.searchPrices({ sourceId: SOURCE, asOf: at(2), locationId: 'TEST0001', topic: 'milk', ...input });
const estimate = (store, items = [item()], extra = {}) => store.estimateBasket({ sourceId: SOURCE, asOf: at(2), locationId: 'TEST0001', items, ...extra });

test('price lookup exposes regular, promotional and unavailable source facts without changing latest deals', t => {
  const { store } = setup(t);
  save(store, { offers: [unit(), unit({ itemId: 'regular', price: { regular: 5 } }),
    unit({ itemId: 'zero-promo', price: { regular: 5, promo: 0 } }), unit({ itemId: 'higher-promo', price: { regular: 5, promo: 6 } }),
    unit({ itemId: 'no-price', price: {} }), unit({ itemId: 'promo-only', price: { promo: 3 } }),
    unit({ itemId: 'oos', stockLevel: 'TEMPORARILY_OUT_OF_STOCK' }), unit({ itemId: 'not-instore', inStore: false }),
    unit({ itemId: 'unsupported', price: { regular: 5, promo: -1 } }),
    unit({ itemId: 'expired', price: { regular: 5, promo: 3, expirationDate: { value: at(1), timezone: 'UTC' } } }),
    unit({ itemId: 'ambiguous-date', price: { regular: 5, promo: 3, effectiveDate: { value: '2026-01-02' } } }),
  ] });
  const result = prices(store);
  assert.equal(result.status, 'available');
  assert.equal(result.products.length, 11);
  assert.equal(Object.hasOwn(result, 'deals'), false);
  const byId = new Map(result.products.map(row => [row.itemId, row]));
  assert.equal(byId.get('synthetic-item').pricing.currentCents, 300);
  assert.equal(byId.get('synthetic-item').calculated.savingsCents, 200);
  for (const id of ['regular', 'zero-promo', 'higher-promo']) {
    assert.deepEqual(byId.get(id).pricing, { status: 'regular_only', currentCents: 500, reason: null });
    assert.equal(byId.get(id).calculated, null);
  }
  for (const [id, reason] of [['no-price', 'missing_price'], ['promo-only', 'missing_regular_price'], ['oos', 'out_of_stock'],
    ['not-instore', 'not_in_store'], ['unsupported', 'unsupported_source_price'], ['expired', 'unqualified_dates'], ['ambiguous-date', 'unqualified_dates']]) {
    assert.deepEqual(byId.get(id).pricing, { status: 'unavailable', currentCents: null, reason });
    assert.equal(byId.get(id).calculated, null);
  }
  assert.equal(byId.get('expired').price.regularCents, 500);
  assert.equal(byId.get('oos').price.promoCents, 300);
  assert.equal(byId.get('unsupported').price.promoCents, null);
  assert.equal(byId.get('oos').availability.status, 'reported_out_of_stock');
  assert.equal(byId.get('not-instore').availability.status, 'not_in_store');
  assert.deepEqual(store.getLatestDeals({ sourceId: SOURCE, locationId: 'TEST0001', topic: 'milk', asOf: at(2) }).deals.map(row => row.itemId), ['synthetic-item']);
});

test('price exact filters and cursors remain query/topic bound; estimation can resolve beyond the first public page', t => {
  const fixture = setup(t);
  save(fixture.store, { offers: Array.from({ length: 40 }, (_, index) => unit({ itemId: `item-${index}` })) });
  const first = prices(fixture.store, { limit: 2 });
  const next = prices(fixture.store, { limit: 2, cursor: first.page.nextCursor });
  assert.equal(first.page.truncated, true);
  assert.notEqual(first.products[0].observationId, next.products[0].observationId);
  assert.deepEqual(prices(fixture.store, { itemId: 'item-0' }).products.map(row => row.itemId), ['item-0']);
  assert.equal(prices(fixture.store, { productId: 'unknown', itemId: 'item-0' }).products.length, 0);
  assert.equal(estimate(fixture.store, [item('item-0', { quantity: 3 })]).totals.reportedSubtotalCents, 900);
  for (const change of [{ limit: 3 }, { itemId: 'item-1' }, { topic: 'bread' }, { locationId: 'TEST0002' }]) {
    assert.throws(() => prices(fixture.store, { limit: 2, cursor: first.page.nextCursor, ...change }), { code: 'history_input_invalid' });
  }
  assert.throws(() => fixture.store.getLatestDeals({ sourceId: SOURCE, locationId: 'TEST0001', topic: 'milk', asOf: at(2),
    limit: 2, cursor: first.page.nextCursor }), { code: 'history_input_invalid' });
  fixture.store.close();
  const reopened = fixture.reopen();
  assert.deepEqual(prices(reopened, { limit: 2, cursor: first.page.nextCursor }).products, next.products);
  save(reopened, { id: 'empty-replacement', observedAt: at(3), offers: [] });
  assert.equal(estimate(reopened, [item('item-0')], { asOf: at(4) }).lines[0].reason, 'not_in_latest_sample');
  assert.throws(() => prices(reopened, { asOf: at(4), limit: 2, cursor: first.page.nextCursor }), { code: 'history_input_invalid' });
});

test('exact stored unit prices produce an integer-cent subtotal with source-backed currency and conditions', t => {
  const { store } = setup(t);
  save(store, { offers: [unit(), unit({ itemId: 'regular', price: { regular: 5, promo: 0, promoPerUnitEstimate: 0.01 } })] });
  const result = estimate(store, [item('synthetic-item', { quantity: 2 }), item('regular', { quantity: 3 })]);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.lines.map(line => line.lineTotalCents), [600, 1500]);
  assert.equal(result.totals.reportedSubtotalCents, 2100);
  assert.equal(result.totals.qualifiedSubtotalCents, 2100);
  assert.equal(result.totals.currency, 'USD');
  assert.equal(result.totals.currencyQualification, 'source_reported');
  assert.equal(result.totals.unresolvedLineCount, 0);
  assert.deepEqual(result.totals.qualificationGaps, []);
  assert.deepEqual(result.exclusions, ['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes']);
  assert.equal(result.evaluatedAt, at(2));
  assert.equal(result.lines[0].observedAt, FIRST);
  assert.equal(result.lines[0].snapshot.ageSeconds, 7200);
});

test('unreported currency permits only labelled reported arithmetic; mixed currencies never get combined', t => {
  const { store } = setup(t);
  const unknown = { currency: null, priceBasis: null, eligibilityKey: null, modality: null, inStore: null, stockLevel: null };
  save(store, { offers: [unit({ ...unknown }), unit({ ...unknown, itemId: 'unknown-two' })] });
  const allUnknown = estimate(store, [item(), item('unknown-two', { quantity: 2 })]);
  assert.equal(allUnknown.status, 'complete');
  assert.equal(allUnknown.totals.reportedSubtotalCents, 900);
  assert.equal(allUnknown.totals.qualifiedSubtotalCents, null);
  assert.equal(allUnknown.totals.currency, null);
  assert.equal(allUnknown.totals.currencyQualification, 'unreported');
  assert.ok(allUnknown.totals.qualificationGaps.includes('currency_unreported'));
  assert.ok(allUnknown.totals.qualificationGaps.includes('eligibility_unreported'));
  assert.ok(allUnknown.totals.qualificationGaps.includes('stock_unreported'));
  assert.equal(JSON.stringify(allUnknown).includes('USD'), false);
  save(store, { id: 'mixed', observedAt: at(3), offers: [unit(), unit({ itemId: 'unknown', currency: null }), unit({ itemId: 'eur', currency: 'EUR' })] });
  for (const second of ['unknown', 'eur']) {
    const result = estimate(store, [item(), item(second)], { asOf: at(4) });
    assert.equal(result.status, 'complete');
    assert.equal(result.totals.reportedSubtotalCents, null);
    assert.equal(result.totals.qualifiedSubtotalCents, null);
    assert.equal(result.totals.currencyQualification, 'incomparable');
    assert.deepEqual(result.lines.map(line => line.lineTotalCents), [300, 300]);
  }
});

test('partial estimates preserve unusable facts and never turn missing, weight, expired or unavailable lines into zero', t => {
  const { store } = setup(t);
  save(store, { offers: [unit(), unit({ itemId: 'weight', soldBy: 'WEIGHT' }), unit({ itemId: 'unknown-basis', soldBy: null }),
    unit({ itemId: 'oos', stockLevel: 'TEMPORARILY_OUT_OF_STOCK' }),
    unit({ itemId: 'expired', price: { regular: 5, promo: 3, expirationDate: { value: at(1), timezone: 'UTC' } } }),
    unit({ itemId: 'invalid', price: { regular: 5, promo: 1.234 } }), unit({ itemId: 'zero', price: { regular: 0, promo: 0 } })] });
  const result = estimate(store, [item('synthetic-item', { quantity: 2 }), ...['weight', 'unknown-basis', 'oos', 'expired', 'invalid', 'zero', 'missing'].map(id => item(id))]);
  assert.equal(result.status, 'partial');
  assert.equal(result.totals.reportedSubtotalCents, 600);
  assert.equal(result.totals.qualifiedSubtotalCents, null);
  assert.equal(result.totals.unresolvedLineCount, 7);
  assert.deepEqual(result.lines.slice(1).map(line => line.reason), ['variable_or_unknown_quantity_basis', 'variable_or_unknown_quantity_basis',
    'out_of_stock', 'unqualified_dates', 'unsupported_source_price', 'missing_price', 'not_in_latest_sample']);
  assert.ok(result.lines.slice(1).every(line => line.lineTotalCents === null && line.unitPriceCents === null));
  assert.equal(result.lines[1].product.price.promoCents, 300);
  assert.equal(result.lines[3].product.availability.stockLevel, 'TEMPORARILY_OUT_OF_STOCK');
  const none = estimate(store, [item('missing')]);
  assert.equal(none.status, 'unavailable');
  assert.equal(none.totals.reportedSubtotalCents, null);
  assert.equal(none.totals.currencyQualification, 'unavailable');
});

test('freshness and current/original rights apply per exact approved topic without fetching replacements', t => {
  const { store } = setup(t, { approved: false });
  assert.equal(prices(store).status, 'permission_required');
  const pending = estimate(store, [item(), item('other', { topic: 'bread' })]);
  assert.equal(pending.status, 'permission_required');
  assert.ok(pending.lines.every(line => line.reason === 'permission_required' && line.product === null));
  store.recordSourcePolicy(policy(), { now: FIRST });
  assert.equal(estimate(store).lines[0].reason, 'no_data');
  save(store);
  save(store, { id: 'bread', term: 'bread', observedAt: SECOND, offers: [unit({ itemId: 'bread', price: { regular: 4 } })] });
  const mixedFreshness = estimate(store, [item(), item('bread', { topic: 'bread' })], { asOf: at(25) });
  assert.equal(mixedFreshness.status, 'partial');
  assert.equal(mixedFreshness.lines[0].reason, 'stale');
  assert.equal(mixedFreshness.lines[0].snapshot.observedAt, FIRST);
  assert.equal(mixedFreshness.totals.reportedSubtotalCents, 400);
  store.recordSourcePolicy(policy({ evidenceReference: 'narrow', verifiedAt: at(25), allowedTopics: ['bread'] }), { now: at(25) });
  assert.equal(estimate(store, [item(), item('bread', { topic: 'bread' })], { asOf: at(26) }).status, 'permission_required');
  store.revokeSource(SOURCE, { now: at(26) });
  assert.equal(prices(store, { asOf: at(26), topic: 'bread' }).status, 'permission_required');
});

test('newer same-item regular facts suppress older promotions before price lookup and basket math', t => {
  const { store } = setup(t);
  save(store, { offers: [unit()] });
  save(store, { id: 'newer-topic', term: 'bread', observedAt: at(1), offers: [unit({ price: { regular: 6, promo: 0 } })] });
  assert.equal(prices(store).products.length, 0);
  assert.equal(estimate(store).lines[0].reason, 'not_in_latest_sample');
  const actual = estimate(store, [item('synthetic-item', { topic: 'bread', quantity: 2 })]);
  assert.equal(actual.lines[0].product.pricing.status, 'regular_only');
  assert.equal(actual.totals.reportedSubtotalCents, 1200);
  save(store, { id: 'unavailable-newer', term: 'bread', observedAt: at(3), offers: [unit({ inStore: false })] });
  assert.equal(estimate(store, [item('synthetic-item', { topic: 'bread' })], { asOf: at(4) }).lines[0].reason, 'not_in_store');
});

test('request validation rejects duplicate identities, guessed prices and unsupported quantities; numeric bounds stay exact', t => {
  const { store } = setup(t);
  save(store, { offers: [unit({ price: { regular: 1_000_000 } })] });
  assert.equal(estimate(store, [item('synthetic-item', { quantity: 99 })]).totals.reportedSubtotalCents, 9_900_000_000);
  for (const items of [[], Array(11).fill(item()), [item(), item('synthetic-item', { topic: 'bread' })],
    ...[0, -1, 1.5, 100, '2'].map(quantity => [item('synthetic-item', { quantity })]),
    [item('synthetic-item', { price: 1 })], [item('', {})], [item('item\u200b')]]) {
    assert.throws(() => estimate(store, items), { code: 'history_input_invalid' });
  }
  for (const input of [{ productId: null }, { itemId: '' }, { productId: 'x'.repeat(101) }, { term: 'milk' }, { currency: 'USD' }, { maxPrice: 1 }]) {
    assert.throws(() => prices(store, input), { code: 'history_input_invalid' });
  }
  const product = prices(store).products[0];
  product.pricing.currentCents = Number.MAX_SAFE_INTEGER;
  const overflow = estimateStoredLine({ item: item('synthetic-item', { quantity: 2 }), product });
  assert.equal(overflow.reason, 'arithmetic_overflow');
  assert.equal(overflow.lineTotalCents, null);
  const total = storedEstimateTotals([0, 1].map(index => ({ ...overflow, itemId: `overflow-${index}`, status: 'estimated', lineTotalCents: Number.MAX_SAFE_INTEGER })));
  assert.equal(total.reportedSubtotalCents, null);
  assert.ok(total.qualificationGaps.includes('arithmetic_overflow'));
});
