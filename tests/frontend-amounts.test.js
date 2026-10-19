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
    globalThis.renderCoverage = ({ scope, summary = {}, view = 'all', snap = 'all', empty = false }) => {
      const regularProduct = { ...syntheticProduct,
        source: { ...syntheticProduct.source, description: 'Synthetic regular item', snapEligible: true },
        pricing: { status: 'regular_only', regularCents: 300, currentCents: 300 }, calculated: null };
      state.results = { products: empty ? [] : [syntheticProduct, regularProduct], scope, summary };
      ui['product-view'].value = view;
      ui['snap-filter'].value = snap;
      renderResults();
      return {
        count: ui['result-count'].textContent,
        summary: ui['result-summary'].textContent,
        coverage: ui['sample-coverage'].textContent,
        selection: ui['query-coverage'].textContent,
        empty: !ui['empty-results'].hidden,
        emptyTitle: ui['empty-results-title'].textContent,
        items: ui['offers-list'].children.length,
      };
    };
  `, context, { filename: 'public/app.js' });
  return { ...context.rendered, coverage: context.renderCoverage };
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

test('starter coverage separates raw checked results, loaded prices, promotions and visible filtered items', () => {
  const page = renderedAmounts();
  const input = {
    scope: { mode: 'sample', topics: ['milk', 'bread', 'eggs'], exhaustive: false,
      queries: [{ term: 'milk', returnedProducts: 15 }, { term: 'bread', returnedProducts: 15 },
        { term: 'eggs', returnedProducts: 15 }], perQueryLimit: 15, productLimit: 45 },
    summary: { products: 45, usablePriced: 2, qualifyingPromotions: 1 },
  };
  const all = page.coverage(input);
  assert.equal(all.count, '2 priced items shown');
  assert.equal(all.summary, '45 product results checked (may include repeats). 2 priced items loaded; 1 qualifying promotion.');
  assert.equal(all.coverage, 'This is a limited selection for this store. More promotions may be available.');
  assert.match(all.selection, /up to 15 results each for milk, bread, eggs \(45 at most in total\)/u);
  assert.match(all.selection, /Sorting and filters apply only to loaded items/u);
  const promotions = page.coverage({ ...input, view: 'promotions' });
  assert.equal(promotions.count, '1 qualifying promotion shown');
  assert.equal(promotions.items, 1);
  assert.equal(promotions.summary, all.summary);
  const filtered = page.coverage({ ...input, view: 'promotions', snap: 'yes' });
  assert.equal(filtered.count, '0 qualifying promotions shown');
  assert.equal(filtered.items, 0);
  assert.equal(filtered.empty, true);
  assert.equal(filtered.emptyTitle, 'No qualifying promotions match this view.');
  assert.equal(filtered.summary, all.summary);
  assert.equal(filtered.coverage, all.coverage);
  assert.equal(filtered.selection, all.selection);
});

test('a short explicit search remains limited to the first matching results and does not imply full coverage', () => {
  const view = renderedAmounts().coverage({
    scope: { mode: 'search', topics: ['synthetic'], exhaustive: false, productLimit: 50, perQueryLimit: 50,
      queries: [{ term: 'synthetic', returnedProducts: 4 }] },
    summary: { products: 4, usablePriced: 2, qualifyingPromotions: 1 },
  });
  assert.equal(view.summary, '4 product results checked. 2 priced items loaded; 1 qualifying promotion.');
  assert.match(view.selection, /up to the first 50 matching results for synthetic/u);
  assert.match(view.coverage, /limited selection for this store\. More promotions may be available/u);
  assert.doesNotMatch(view.coverage + view.selection, /all promotions found|full coverage|load more/iu);
});

test('missing coverage counts stay unknown while an actual empty check keeps its reported zero', () => {
  const page = renderedAmounts();
  const scope = { mode: 'search', topics: ['synthetic'] };
  const unknown = page.coverage({ scope });
  assert.match(unknown.summary, /^Number of checked results unavailable\./u);
  assert.match(unknown.coverage, /Coverage of all store promotions has not been verified/u);
  assert.match(unknown.selection, /limited results for synthetic/u);
  assert.doesNotMatch(unknown.selection, /50|45|15/u);
  const empty = page.coverage({ scope: { ...scope, exhaustive: false }, summary: { products: 0 }, empty: true });
  assert.equal(empty.summary, '0 product results checked. 0 priced items loaded; 0 qualifying promotions.');
  assert.equal(empty.empty, true);
  assert.equal(empty.count, '0 priced items shown');
  assert.match(empty.coverage, /More promotions may be available/u);
});

test('coverage and loaded counts precede sorting and filters, with limits visible before searching', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const results = html.slice(html.indexOf('id="results-region"'), html.indexOf('id="empty-results"'));
  assert.ok(results.indexOf('id="sample-coverage"') < results.indexOf('id="sort-order"'));
  assert.ok(results.indexOf('id="result-summary"') < results.indexOf('id="product-view"'));
  assert.equal(html.match(/id="sample-coverage"/gu).length, 1);
  assert.equal(html.match(/id="result-summary"/gu).length, 1);
  assert.match(html, /id="search-hint"[^>]*>[^<]*Search a limited selection for this store/u);
  assert.match(html, /id="search-term"[^>]*aria-describedby="search-hint search-error"/u);
});
