import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as basket from '../public/basket.js';
import * as catalog from '../public/catalog.js';
import * as ordering from '../public/ordering.js';

// Exercise actual page renderers with synthetic, currency-unreported products.
// The DOM is substituted; these checks establish text and arithmetic outcomes,
// not browser appearance, accessibility or a supplier's checkout currency.
class TextNode {
  constructor(tag = '') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.value = '';
    this.classList = { toggle() {} };
    this.ownText = '';
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.ownText = ''; this.children = [...children]; }
  setAttribute() {}
  addEventListener() {}
}

function renderedAmounts() {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, new TextNode());
    return nodes.get(id);
  };
  const context = vm.createContext({ ...basket, ...catalog, ...ordering, Intl, URL,
    document: { getElementById: getNode,
      createElement: tag => new TextNode(tag),
      createTextNode: text => { const node = new TextNode(); node.textContent = text; return node; } },
  });
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const wiring = source.indexOf("ui['store-form'].addEventListener");
  assert.ok(wiring > 0, 'The harness must stop before page startup and event wiring.');
  vm.runInContext(source.slice(0, wiring).replace(/^import .*$/gm, '') + `
    const syntheticProduct = {
      source: { description: 'Synthetic grocery', productId: 'synthetic-unit', itemId: 'synthetic-unit',
        upc: '0000000000001', soldBy: 'unit', price: { regular: 3, promo: 2.5 } },
      pricing: { status: 'promotion', regularCents: 300, promoCents: 250, currentCents: 250 },
      calculated: { savingsCents: 50, percentOff: 100 / 6 },
      perUnit: { status: 'reported_estimate', promoEstimate: 0.03125, regularEstimate: 0.0375 },
      history: { status: 'no_observations' },
    };
    const weightedProduct = { ...syntheticProduct,
      source: { ...syntheticProduct.source, description: 'Synthetic variable-weight grocery',
        productId: 'synthetic-weight', itemId: 'synthetic-weight', upc: '0000000000002', soldBy: 'weight' } };
    state.selectedStore = { locationId: 'TEST0001', name: 'Synthetic store', address: {} };
    state.results = { products: [syntheticProduct],
      scope: { mode: 'search', topics: ['synthetic'], productLimit: 50 }, summary: {},
      history: { status: 'no_observations' } };
    ui['sort-order'].value = 'savings';
    ui['product-view'].value = 'all';
    ui['snap-filter'].value = 'all';
    renderResults();
    state.basket = [
      { key: 'unit', product: syntheticProduct, quantity: 3, locationId: 'TEST0001' },
      { key: 'weight', product: weightedProduct, quantity: 1, locationId: 'TEST0001' },
    ];
    renderBasket();
    const pastPrices = document.createElement('div');
    appendHistory(pastPrices, { status: 'comparable', observationCount: 2,
      lastPromo: 1.75, lowestPromo: 1.5, deltaFromLastCents: 75,
      lastObservedAt: '2026-10-01T12:00:00Z', lowestObservedAt: '2026-09-01T12:00:00Z' });
    globalThis.rendered = {
      product: ui['offers-list'].textContent,
      basket: ui['basket-lines'].textContent,
      subtotal: ui['basket-total'].textContent,
      subtotalLabel: ui['basket-total-label'].textContent,
      unresolved: ui['basket-unresolved'].textContent,
      pastPrices: pastPrices.textContent,
      cart: JSON.stringify(cartItems(state.basket, state.selectedStore.locationId)),
    };
  `, context, { filename: 'public/app.js' });
  return context.rendered;
}

test('currency-unreported prices, savings and comparisons render numeric amounts without assuming dollars', () => {
  const view = renderedAmounts();
  assert.match(view.product, /Promo price 2\.50/u);
  assert.match(view.product, /Regular 3\.00/u);
  assert.match(view.product, /Save 0\.50 · 16\.7%/u);
  assert.match(view.product, /0\.03125 promo/u, 'Unit-estimate precision stays source-true.');
  assert.match(view.pastPrices, /Most recent collected promo: 1\.75/u);
  assert.match(view.pastPrices, /Lowest collected promo: 1\.50/u);
  assert.match(view.pastPrices, /0\.75 higher/u);
  assert.doesNotMatch(view.product + view.pastPrices, /\$|USD|dollars/iu);
});

test('list totals remain partial reported arithmetic and cart quantities do not depend on a guessed currency', () => {
  const view = renderedAmounts();
  assert.equal(view.subtotal, '7.50');
  assert.equal(view.subtotalLabel, 'Estimated subtotal of resolved lines');
  assert.match(view.basket, /2\.50 × 3/u);
  assert.match(view.basket, /Amount unresolved/u);
  assert.match(view.unresolved, /1 line has an unresolved amount/u);
  assert.doesNotMatch(view.basket + view.subtotal, /\$|USD|dollars/iu);
  assert.deepEqual(JSON.parse(view.cart), { items: [{ upc: '0000000000001', quantity: 3 }], excludedCount: 1 });
});

test('currency limits are explained at result and subtotal decisions while the savings sort key is preserved', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const results = html.slice(html.indexOf('id="results-region"'), html.indexOf('class="product-filters"'));
  const subtotal = html.slice(html.indexOf('id="shopping-list"'), html.indexOf('id="cart-panel"'));
  assert.match(results, /Currency not supplied\. Confirm the currency and final price at Kroger\./u);
  assert.match(subtotal, /Currency not supplied\. This estimate adds reported amounts/u);
  assert.match(subtotal, /Before tax and coupons/u);
  assert.match(subtotal, /unknown prices or variable weights are left out/u);
  assert.match(html, /<option value="savings">Largest price drop<\/option>/u);
  assert.doesNotMatch(html, /Biggest dollar savings|savings in dollars/iu);
});
