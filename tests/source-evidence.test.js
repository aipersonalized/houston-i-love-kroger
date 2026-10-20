import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOffers } from '../src/deals.js';
import { otherReportedSales, validSourceEvidence } from '../public/catalog.js';
import { product, NOW } from './fixtures.js';

test('all returned sale facts survive independently of strict shopping and savings eligibility', () => {
  const rows = [
    product({ productId: 'ranked' }),
    product({ productId: 'stock', item: { inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } } }),
    product({ productId: 'promo-only', regular: null }),
    product({ productId: 'fractional', promo: 1.555 }),
    product({ productId: 'equal', regular: 3, promo: 3 }),
    product({ productId: 'dates', price: { effectiveDate: { value: '2026-10-19', timezone: 'UTC' } } }),
    product({ productId: 'not-store', item: { fulfillment: { instore: false } } }),
    product({ productId: 'no-name', description: null }),
    product({ productId: 'no-sale', promo: 0 }),
    { productId: 'no-items', description: 'No item details', items: [] },
  ];
  const before = structuredClone(rows);
  const result = compareOffers(rows, { now: NOW });
  assert.deepEqual(rows, before, 'The source input must not change.');
  assert.deepEqual(result.offers.map(offer => offer.source.productId), ['ranked']);
  assert.equal(result.summary.qualifyingPromotions, 1);
  assert.equal(result.summary.outOfStock, 1);
  assert.equal(result.summary.incompleteProducts, 2);
  const evidence = result.sourceEvidence;
  assert.equal(validSourceEvidence(evidence, result.offers), true);
  assert.equal(evidence.records.length, 10);
  assert.equal(evidence.summary.returnedItems, 9);
  assert.equal(evidence.summary.reportedPromotions, 8);
  assert.equal(evidence.summary.missingItemLists, 1);
  const byId = id => evidence.records.find(record => record.source.productId === id);
  for (const [id, disposition] of [['stock', 'out_of_stock'], ['promo-only', 'missing_regular_price'],
    ['fractional', 'unsupported_price'], ['equal', 'not_discounted'], ['dates', 'unqualified_dates'],
    ['not-store', 'not_in_store'], ['no-name', 'missing_description']]) {
    assert.equal(byId(id).reportedPromotion, true, id);
    assert.equal(byId(id).includedInOffers, false, id);
    assert.ok(byId(id).dispositions.includes(disposition), id);
    assert.equal(byId(id).source.price.promo, before.find(row => row.productId === id).items[0].price.promo);
  }
  assert.equal(byId('no-sale').reportedPromotion, false, 'Zero must not become a free sale.');
  assert.equal(byId('stock').savingsArithmeticAvailable, true, 'Stock does not change arithmetic capability.');
  assert.equal(byId('dates').savingsArithmeticAvailable, true, 'Uncertain dates remain separate from arithmetic.');
  assert.equal(byId('fractional').savingsArithmeticAvailable, false);
  assert.equal(byId('no-items').itemIndex, null);
  assert.equal(byId('no-items').source.itemId, null, 'A placeholder must not invent an item ID.');
  assert.equal(byId('no-name').source.description, null, 'UI fallback text must not become a source name.');
  assert.equal(otherReportedSales(evidence).length, 7);
});

test('duplicate and conflicting observations remain separate without selecting a variant as truth', () => {
  const rows = [product({ productId: 'repeat' }), product({ productId: 'repeat' }),
    product({ productId: 'conflict', promo: 2 }), product({ productId: 'conflict', promo: 1 }),
    product({ productId: null, itemId: null }), product({ productId: null, itemId: null })];
  const result = compareOffers(rows, { now: NOW });
  const records = result.sourceEvidence.records;
  assert.equal(records.length, 6);
  assert.equal(records[1].duplicateOf, 0);
  assert.ok(records[1].dispositions.includes('duplicate'));
  assert.equal(records[1].includedInOffers, false);
  for (const record of records.slice(2, 4)) {
    assert.ok(record.dispositions.includes('identity_conflict'));
    assert.equal(record.includedInOffers, false);
    assert.equal(record.savingsArithmeticAvailable, true, 'A possible calculation does not choose a conflicting version as truth.');
  }
  assert.deepEqual(records.slice(2, 4).map(record => record.source.price.promo), [2, 1]);
  assert.deepEqual(records.slice(4).map(record => record.duplicateOf), [null, null]);
  assert.equal(result.summary.duplicateItems, 1);
  assert.equal(result.summary.conflictingItems, 1);
  assert.equal(result.offers.length, 3, 'Existing rankable-offer semantics are preserved.');
  const variantRepeats = compareOffers([product({ promo: 2 }), product({ promo: 1 }), product({ promo: 1 })], { now: NOW }).sourceEvidence;
  assert.equal(variantRepeats.records[2].duplicateOf, 1, 'Duplicates of a later conflicting variant retain their own earlier locator.');
  assert.ok(variantRepeats.records.every(record => record.dispositions.includes('identity_conflict')));
  assert.ok(variantRepeats.records.every(record => !record.includedInOffers));
  const incompleteConflict = compareOffers([product({ description: null, promo: 2 }), product({ promo: 1 })], { now: NOW });
  assert.equal(incompleteConflict.offers.length, 0, 'Differing prices on an incomplete same-identity row must exclude both variants.');
  assert.equal(incompleteConflict.products.length, 0);
  assert.equal(incompleteConflict.summary.conflictingItems, 1);
  assert.ok(incompleteConflict.sourceEvidence.records.every(record => record.dispositions.includes('identity_conflict')));
  assert.deepEqual(incompleteConflict.sourceEvidence.records.map(record => record.includedInOffers), [false, false]);
});

test('evidence is bounded to 500 returned items, with source order and all variants intact', () => {
  const rows = Array.from({ length: 50 }, (_, productIndex) => ({ ...product({ productId: String(productIndex) }),
    items: Array.from({ length: 10 }, (_, itemIndex) => ({ itemId: `${productIndex}:${itemIndex}`, price: { promo: 1.555 } })) }));
  const evidence = compareOffers(rows, { now: NOW }).sourceEvidence;
  assert.equal(evidence.records.length, 500);
  assert.equal(evidence.summary.returnedItems, 500);
  assert.equal(evidence.summary.withoutSavingsArithmetic, 500);
  assert.equal(evidence.records[499].source.itemId, '49:9');
  assert.equal(validSourceEvidence(evidence, []), true);
  const missing = compareOffers(Array.from({ length: 50 }, () => ({ items: [] })), { now: NOW }).sourceEvidence;
  assert.equal(missing.records.length, 50);
  assert.equal(missing.summary.missingItemLists, 50);
  assert.equal(validSourceEvidence(missing, []), true);
});

test('source sale inspection applies source-label filters without ranking or changing sale-only semantics', () => {
  const evidence = compareOffers([
    product({ productId: 'first', snapEligible: true, manufacturerDeclarations: ['Organic'], promo: 3.555 }),
    product({ productId: 'second', snapEligible: false, promo: 1.555 }),
  ], { now: NOW }).sourceEvidence;
  assert.deepEqual(otherReportedSales(evidence, { view: 'promotions' }).map(record => record.source.productId), ['first', 'second']);
  assert.deepEqual(otherReportedSales(evidence, { snap: 'yes', declaration: 'Organic' }).map(record => record.source.productId), ['first']);
  assert.equal(otherReportedSales(evidence, { snap: 'unknown' }).length, 0);
  assert.equal(otherReportedSales(evidence, { declaration: 'Unreported label' }).length, 0);
});

test('malformed evidence cannot masquerade as a successful empty sale inspection', () => {
  const evidence = compareOffers([product({ promo: 1.555 })], { now: NOW }).sourceEvidence;
  for (const mutate of [value => value.records.push(...Array(500).fill(value.records[0])),
    value => { value.records[0].reportedPromotion = false; },
    value => { value.records[0].source.price.promo = '1.555'; },
    value => { value.records[0].dispositions = ['made_up']; },
    value => { value.summary.reportedPromotions = 0; }]) {
    const malformed = structuredClone(evidence);
    mutate(malformed);
    assert.equal(validSourceEvidence(malformed, []), false);
  }
});

test('exact-once offer membership cannot hide positive source evidence or invent an included sale', () => {
  const result = compareOffers([product(), product({ productId: 'oos', item: { inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } } })], { now: NOW });
  assert.equal(validSourceEvidence(result.sourceEvidence, result.offers), true);
  const hidden = structuredClone(result.sourceEvidence);
  hidden.records[1].includedInOffers = true;
  hidden.summary.otherReportedPromotions = 0;
  assert.equal(validSourceEvidence(hidden, result.offers), false, 'The reproduced hidden OOS sale must fail at the response boundary.');
  const absentOffer = structuredClone(result.sourceEvidence);
  absentOffer.records[0].includedInOffers = false;
  absentOffer.summary.otherReportedPromotions++;
  assert.equal(validSourceEvidence(absentOffer, result.offers), false, 'An actual offer cannot lack its included evidence row.');
  assert.equal(validSourceEvidence(result.sourceEvidence, []), false, 'A claimed included row needs a literal offer.');
  assert.equal(validSourceEvidence(result.sourceEvidence, [...result.offers, result.offers[0]]), false, 'Offer membership is exact once.');
  const changedOffer = structuredClone(result.offers);
  changedOffer[0].source.price.promo = 2;
  assert.equal(validSourceEvidence(result.sourceEvidence, changedOffer), false, 'Identity alone cannot match different prices.');
  const fractional = compareOffers([product({ promo: 1.555 })], { now: NOW });
  fractional.sourceEvidence.records[0].savingsArithmeticAvailable = true;
  fractional.sourceEvidence.summary.withoutSavingsArithmetic = 0;
  assert.equal(validSourceEvidence(fractional.sourceEvidence, []), false, 'Arithmetic is recomputed from numbers, not trusted flags.');
  const expired = compareOffers([product({ price: { expirationDate: { value: '2026-01-01T00:00:00Z', timezone: 'UTC' } } })], { now: NOW });
  expired.sourceEvidence.records[0].includedInOffers = true;
  expired.sourceEvidence.records[0].dispositions = [];
  expired.sourceEvidence.summary.otherReportedPromotions = 0;
  const inventedOffer = compareOffers([product()], { now: NOW }).offers[0];
  inventedOffer.source.price = structuredClone(expired.sourceEvidence.records[0].source.price);
  assert.equal(validSourceEvidence(expired.sourceEvidence, [inventedOffer], new Date(NOW).toISOString()), false,
    'A copied offer and removed disposition cannot qualify expired source dates.');
});

test('product coverage, item positions, missing-item placeholders and fulfillment types must agree', () => {
  const evidence = compareOffers([product({ promo: 1.555 }), { description: 'Missing items', items: [] }], { now: NOW }).sourceEvidence;
  assert.equal(validSourceEvidence(evidence, []), true);
  for (const mutate of [value => { value.summary.returnedProducts = 0; },
    value => { value.summary.returnedProducts = 3; },
    value => { value.records[0].productIndex = 1; },
    value => { value.records[1].productIndex = 3; },
    value => { value.records[0].itemIndex = 1; },
    value => { value.records[0].source.fulfillment = { instore: 'false' }; },
    value => { value.records[0].source.fulfillment = []; },
    value => { value.records[1].source.itemId = 'invented'; },
    value => { value.records[1].source.price.regular = 3; },
    value => { value.records[1].dispositions = value.records[1].dispositions.filter(code => code !== 'missing_items'); }]) {
    const malformed = structuredClone(evidence);
    mutate(malformed);
    assert.equal(validSourceEvidence(malformed, []), false);
  }
});

test('duplicate locators require the matching known source variant and matching dispositions', () => {
  const result = compareOffers([product(), product()], { now: NOW });
  assert.equal(validSourceEvidence(result.sourceEvidence, result.offers), true);
  for (const mutate of [value => { value.records[1].duplicateOf = null; },
    value => { value.records[1].dispositions = []; },
    value => { value.records[1].source.productId = null; },
    value => { value.records[1].source.price.promo = 2; },
    value => { value.records[0].dispositions.push('identity_conflict'); }]) {
    const malformed = structuredClone(result.sourceEvidence);
    mutate(malformed);
    assert.equal(validSourceEvidence(malformed, result.offers), false);
  }
  const unknown = compareOffers([product({ productId: null, itemId: null }), product({ productId: null, itemId: null })], { now: NOW });
  assert.equal(validSourceEvidence(unknown.sourceEvidence, unknown.offers), true, 'Unknown identities remain independent permitted observations.');
  unknown.sourceEvidence.records[1].duplicateOf = 0;
  unknown.sourceEvidence.records[1].dispositions.push('duplicate');
  unknown.sourceEvidence.records[1].includedInOffers = false;
  unknown.sourceEvidence.summary.otherReportedPromotions++;
  assert.equal(validSourceEvidence(unknown.sourceEvidence, unknown.offers), false, 'Unknown identities cannot acquire invented duplicate relationships.');
});
