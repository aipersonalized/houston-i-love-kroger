import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOffers, validateDealSearch, validateProductSearch, validateStoreSearch } from '../src/deals.js';
import { orderOffers } from '../public/ordering.js';
import { NOW, STORE_ID, product } from './fixtures.js';

test('ZIP and exact store are required; omitting a term selects the bounded sample', () => {
  assert.deepEqual(validateStoreSearch({ zipCode: '00501' }), { zipCode: '00501' });
  assert.deepEqual(validateDealSearch({ locationId: STORE_ID }), { locationId: STORE_ID, term: null, sort: 'savings' });
  assert.equal(validateDealSearch({ locationId: STORE_ID, term: '  whole   milk ' }).term, 'whole milk');
  for (const value of [null, [], { zipCode: 77001 }, { zipCode: '77001-1234' }, { zipCode: '77001', extra: true }]) {
    assert.throws(() => validateStoreSearch(value));
  }
  for (const value of [{ term: 'milk' }, { locationId: STORE_ID, term: '' },
    { locationId: STORE_ID, term: 'mi\nlk' }, { locationId: STORE_ID, term: 'a b c d e f g h i' },
    { locationId: STORE_ID, term: 'milk', filter: {} }, { locationId: STORE_ID, sort: 'unit' }]) {
    assert.throws(() => validateDealSearch(value));
  }
});

test('missing promo is separate from missing regular and unsupported prices; empty item lists are incomplete', () => {
  const result = compareOffers([
    product({ productId: 'regular-only', promo: null }), product({ productId: 'zero-is-not-free', promo: 0 }),
    product({ productId: 'missing-regular', regular: null }), product({ productId: 'fractional-cent', promo: 2.001 }),
    { productId: 'empty', description: 'Empty items', items: [] },
  ], { now: NOW });
  assert.equal(result.offers.length, 0);
  assert.equal(result.products.length, 4);
  assert.equal(result.summary.unpriced, 4);
  assert.equal(result.summary.noReportedPromotion, 2);
  assert.equal(result.summary.missingRegularPrice, 1);
  assert.equal(result.summary.unsupportedPrice, 1);
  assert.equal(result.summary.incompleteProducts, 1);
  assert.equal(result.products[0].pricing.currentCents, 400);
  assert.equal(result.products[1].pricing.currentCents, 400);
  assert.equal(result.products[2].pricing.reason, 'missing_regular_price');
  assert.equal(result.products[2].calculated, null);
  const unsupportedRegular = compareOffers([product({ regular: -1, promo: 3 })], { now: NOW }).products[0];
  assert.equal(unsupportedRegular.pricing.status, 'unqualified_promotion');
  assert.equal(unsupportedRegular.pricing.reason, 'unsupported_price');
});

test('the reproduced 45-item sample reports 35 regular prices, eight promos and two out of stock', () => {
  const rows = Array.from({ length: 45 }, (_, i) => product({ productId: String(i), promo: i < 8 ? 3 : 0,
    item: i >= 43 ? { inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } } : {} }));
  const result = compareOffers(rows, { now: NOW });
  assert.equal(result.summary.noReportedPromotion, 35);
  assert.equal(result.summary.missingRegularPrice, 0);
  assert.equal(result.summary.unsupportedPrice, 0);
  assert.equal(result.summary.outOfStock, 2);
  assert.equal(result.products.length, 43);
  assert.equal(result.offers.length, 8);
});

test('identity conflicts include different descriptions and product metadata', () => {
  for (const changed of [product({ description: 'Different milk' }), product({ categories: ['Different category'] }),
    product({ item: { soldBy: 'weight' } })]) {
    const result = compareOffers([product(), changed], { now: NOW });
    assert.equal(result.summary.conflictingItems, 1);
    assert.equal(result.products.length, 0);
  }
});

test('products search defaults to all priced products and rejects invented browse fields', () => {
  assert.deepEqual(validateProductSearch({ locationId: STORE_ID }), { locationId: STORE_ID, term: null, sort: 'savings', includeAll: true });
  assert.equal(validateProductSearch({ locationId: STORE_ID, includeAll: false }).includeAll, false);
  assert.throws(() => validateProductSearch({ locationId: STORE_ID, includeAll: 'all' }));
  assert.throws(() => validateProductSearch({ locationId: STORE_ID, page: 2 }));
});

test('source facts, fractional per-unit estimates and soldBy stay unchanged', () => {
  const input = product({ description: '<b>Example® milk</b>', item: { size: '16 oz / 2 pk', soldBy: 'Weight',
    price: { regular: 4.99, promo: 3.49, regularPerUnitEstimate: 0.311875, promoPerUnitEstimate: 0.218125 } } });
  const original = structuredClone(input);
  const { offers } = compareOffers([input], { now: NOW });
  assert.deepEqual(input, original);
  assert.deepEqual(offers[0].source.price, input.items[0].price);
  assert.equal(offers[0].source.soldBy, 'Weight');
  assert.equal(offers[0].calculated.savingsCents, 150);
  assert.equal(offers[0].perUnit.promoEstimate, 0.218125);
  assert.equal(offers[0].perUnit.basis, null);
  assert.equal(offers[0].perUnit.status, 'reported_estimate');
  assert.equal(offers[0].history.status, 'unavailable');
  assert.equal(offers[0].dateStatus, 'not_provided');
});

test('zero, missing, negative and fractional-cent item prices are not promotions', () => {
  const rows = [product({ productId: 'a', promo: 0 }), product({ productId: 'b', promo: null }),
    product({ productId: 'c', regular: -1 }), product({ productId: 'd', promo: 3.001 }),
    product({ productId: 'e', promo: 4 }), product({ productId: 'f', promo: 5 }),
    product({ productId: 'g', item: { price: { promoPerUnitEstimate: 0.2 } } })];
  const result = compareOffers(rows, { now: NOW });
  assert.equal(result.offers.length, 0);
  assert.equal(result.summary.unpriced, 5);
  assert.equal(result.summary.notDiscounted, 2);
});

test('stock and in-store contradictions are excluded; unknown stock stays unknown', () => {
  const result = compareOffers([
    product({ productId: 'a', item: { inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } } }),
    product({ productId: 'b', item: { fulfillment: { instore: false } } }),
    product({ productId: 'c' }), product({ productId: 'd', item: { inventory: { stockLevel: 'UNKNOWN_NEW_SIGNAL' } } }),
  ], { now: NOW });
  assert.equal(result.summary.outOfStock, 1);
  assert.equal(result.summary.notInStore, 1);
  assert.equal(result.offers.length, 2);
  assert.equal(result.offers[0].source.stockLevel, null);
  assert.equal(result.offers[1].source.stockLevel, 'UNKNOWN_NEW_SIGNAL');
});

test('date boundaries use explicit offsets, with no invented date-only or local-time semantics', () => {
  const date = value => ({ value, timezone: 'UTC' });
  const rows = [
    product({ productId: 'a', price: { effectiveDate: date('2026-10-19T18:00:00Z'), expirationDate: date('2026-10-20T00:00:00Z') } }),
    product({ productId: 'b', price: { expirationDate: date('2026-10-19T18:00:00Z') } }),
    product({ productId: 'c', price: { effectiveDate: date('2026-10-19T18:00:01Z') } }),
    product({ productId: 'd', price: { expirationDate: date('2026-10-20') } }),
    product({ productId: 'e', price: { expirationDate: date('2026-10-20T00:00:00') } }),
    product({ productId: 'f', price: { expirationDate: date('2027-02-30T00:00:00Z') } }),
    product({ productId: 'g', price: { expirationDate: date('2026-10-19T14:00:00-05:00') } }),
  ];
  const result = compareOffers(rows, { now: NOW });
  assert.deepEqual(result.offers.map(offer => offer.source.productId), ['a', 'g']);
  assert.equal(result.summary.unqualifiedDates, 5);
  assert.equal(result.offers[0].dateStatus, 'within_reported_window');
  assert.deepEqual(result.offers[0].source.price.effectiveDate, rows[0].items[0].price.effectiveDate);
});

test('exact known duplicate identities collapse; conflicting observations are all excluded', () => {
  const same = product();
  const result = compareOffers([same, structuredClone(same), product({ promo: 2 }),
    product({ productId: null, itemId: null }), product({ productId: null, itemId: null })], { now: NOW });
  assert.equal(result.summary.duplicateItems, 1);
  assert.equal(result.summary.conflictingItems, 1);
  assert.equal(result.offers.length, 2);
  assert.ok(result.offers.every(offer => offer.source.productId === null));
});

test('missing optional product details remain explicit; malformed or amplified results fail safely', () => {
  assert.equal(compareOffers([{}], { now: NOW }).summary.incompleteProducts, 1);
  for (const rows of [Array(51).fill(product()), [product({ description: 'x'.repeat(513) })],
    [{ ...product(), items: Array(11).fill(product().items[0]) }], [product({ item: { price: { regular: '4', promo: 3 } } })]]) {
    assert.throws(() => compareOffers(rows, { now: NOW }), { code: 'upstream_format' });
  }
});

test('human and agent sorting share the same immutable ranking and safe ties', () => {
  const offers = compareOffers([product({ productId: 'a', regular: 10, promo: 8 }),
    product({ productId: 'b', regular: 4, promo: 2.5 }), product({ productId: 'c', regular: 4, promo: 3 })], { now: NOW }).offers;
  const ids = values => values.map(offer => offer.source.productId);
  assert.deepEqual(ids(orderOffers(offers, 'savings')), ['a', 'b', 'c']);
  assert.deepEqual(ids(orderOffers(offers, 'percent')), ['b', 'c', 'a']);
  assert.deepEqual(ids(orderOffers(offers, 'price')), ['b', 'c', 'a']);
  assert.deepEqual(ids(offers), ['a', 'b', 'c']);
});
