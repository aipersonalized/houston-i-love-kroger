import test from 'node:test';
import assert from 'node:assert/strict';
import { addBasketItem, setBasketQuantity, estimateBasket, groupBasketByAisle, cartItems } from '../public/basket.js';

const STORE = '01400001';
const product = (id, cents, source = {}) => ({
  source: { productId: id, itemId: id, description: `Synthetic product ${id}`, soldBy: 'unit', upc: id, ...source },
  pricing: { status: 'regular_only', currentCents: cents },
});

test('shopping list keeps exact item variants, updates quantity and uses integer cent totals', () => {
  const first = product('0000000000001', 299);
  let entries = addBasketItem([], first, STORE, '2026-10-19T12:00:00Z');
  entries = addBasketItem(entries, first, STORE, '2026-10-19T12:00:00Z');
  entries = addBasketItem(entries, product('0000000000002', 115), STORE);
  entries = setBasketQuantity(entries, entries[1].key, 3);
  const estimate = estimateBasket(entries, STORE);
  assert.equal(estimate.knownSubtotalCents, 943);
  assert.equal(estimate.complete, true);
  assert.deepEqual(estimate.lines.map(line => line.estimateCents), [598, 345]);
  assert.equal(entries.length, 2);
  assert.equal(first.pricing.currentCents, 299);
});

test('unknown price, sold-by basis and variable weight stay unresolved rather than guessed', () => {
  const products = [product('a', 300), product('b', 400, { soldBy: 'weight' }),
    product('c', 200, { soldBy: null }), product('d', 0)];
  const entries = products.reduce((items, value) => addBasketItem(items, value, STORE), []);
  const estimate = estimateBasket(entries, STORE);
  assert.equal(estimate.knownSubtotalCents, 300);
  assert.equal(estimate.unresolvedCount, 3);
  assert.equal(estimate.complete, false);
  assert.deepEqual(estimate.lines.map(line => line.reason), [null, 'variable_measure', 'unknown_measure', 'unknown_price']);
  assert.equal(estimate.lines[1].estimateCents, null);
});

test('store changes cannot mix prices, missing identities cannot merge by name and quantity bounds hold', () => {
  let entries = addBasketItem([], product('a', 250), STORE);
  assert.throws(() => addBasketItem(entries, product('b', 100), '01400002'), /different_store/u);
  assert.throws(() => addBasketItem([], { source: { description: 'Same name' } }, STORE), /missing_identity/u);
  for (const quantity of [0, -1, 1.5, 100, NaN]) assert.throws(() => setBasketQuantity(entries, entries[0].key, quantity), /invalid_quantity/u);
  entries = setBasketQuantity(entries, entries[0].key, 99);
  assert.throws(() => addBasketItem(entries, product('a', 250), STORE), /quantity_limit/u);
  assert.equal(estimateBasket(entries, '01400002').unresolvedCount, 1);
});

test('reported aisle groups sort naturally, keep multiple locations visible and put unknown last', () => {
  const products = [product('a', 100), product('b', 100, { aisleLocations: [{ number: '10' }] }),
    product('c', 100, { aisleLocations: [{ number: '2' }, { number: '12' }] })];
  const entries = products.reduce((items, value) => addBasketItem(items, value, STORE), []);
  const groups = groupBasketByAisle(estimateBasket(entries, STORE).lines);
  assert.deepEqual(groups.map(group => group.aisle), ['Aisle 2', 'Aisle 10', null]);
  assert.deepEqual(groups[0].entries[0].aisles, ['Aisle 2', 'Aisle 12']);
  assert.equal(groups.flatMap(group => group.entries).length, 3);
});

test('cart handoff contains only known unit quantities and exact 13-digit UPCs', () => {
  const products = [product('0000000000001', 300), product('0000000000002', 200, { soldBy: 'weight' }),
    product('0000000000003', 100, { upc: null })];
  const entries = products.reduce((items, value) => addBasketItem(items, value, STORE), []);
  assert.deepEqual(cartItems(entries, STORE), { items: [{ upc: '0000000000001', quantity: 1 }], excludedCount: 2 });
});

test('cart handoff combines aliases with the same UPC and holds quantities beyond the provider limit', () => {
  const a = product('a', 300, { upc: '0000000000001' });
  const b = product('b', 300, { upc: '0000000000001' });
  let entries = addBasketItem(addBasketItem([], a, STORE), b, STORE);
  assert.deepEqual(cartItems(entries, STORE), { items: [{ upc: '0000000000001', quantity: 2 }], excludedCount: 0 });
  entries = setBasketQuantity(entries, entries[0].key, 99);
  assert.deepEqual(cartItems(entries, STORE), { items: [], excludedCount: 2 });
});
