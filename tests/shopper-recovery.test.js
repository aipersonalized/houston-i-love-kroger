import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as basket from '../public/basket.js';
import * as catalog from '../public/catalog.js';
import * as ordering from '../public/ordering.js';
import { compareOffers } from '../src/deals.js';
import { product as syntheticProduct, NOW } from './fixtures.js';
import { productPageContinuation } from '../src/product-pagination.js';

// Run the real page actions, request guards and event handlers. Only the DOM,
// clock's display timezone and fetch transport are substituted. These checks
// use synthetic data and establish no browser, account or supplier access.
class PageNode {
  constructor(tagName = '') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.ownText = '';
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(' '); }
  get firstElementChild() { return this.children[0]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.ownText = ''; this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  dispatch(name) { this.listeners.get(name)?.({ preventDefault() {} }); }
  focus() {}
}

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

function response(payload) {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function shopperPage(fetchImpl = async () => { throw new Error('Unexpected synthetic request.'); }) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, new PageNode());
    return nodes.get(id);
  };
  const calls = [];
  const context = vm.createContext({ ...basket, ...catalog, ...ordering, URL, AbortController,
    Intl: { NumberFormat: Intl.NumberFormat, DateTimeFormat: class extends Intl.DateTimeFormat {
      constructor(locale, options) { super('en-US', { ...options, timeZone: 'America/Chicago' }); }
    } },
    window: { setTimeout, clearTimeout },
    document: { baseURI: 'https://example.test/app/', getElementById: node,
      createElement: tag => new PageNode(tag),
      createTextNode: text => { const result = new PageNode(); result.textContent = text; return result; } },
    fetch: (url, options) => {
      const call = { path: url.pathname, body: options.body ? JSON.parse(options.body) : null,
        signal: options.signal };
      calls.push(call);
      return fetchImpl(call);
    },
  });
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const lifecycle = source.indexOf("window.addEventListener('pagehide'");
  assert.ok(lifecycle > source.indexOf("ui['cancel-history'].addEventListener"),
    'Load actual cancellation wiring, stopping before lifecycle hooks and startup.');
  vm.runInContext(source.slice(0, lifecycle).replace(/^import .*$/gm, ''), context,
    { filename: 'public/app.js' });
  const run = code => vm.runInContext(code, context);
  run("state.selectedStore = { locationId: 'TEST0001', name: 'Synthetic store', address: {} };");
  return { node, calls, run };
}

function observation(id) {
  return { observationId: id, locationId: 'TEST0001', description: 'Synthetic grocery',
    observedAt: '2026-10-01T12:00:00Z', promotionStatus: 'reported_promotion',
    price: { regular: 5, promo: 3 }, currency: 'USD', sourceLabel: 'Synthetic fixture' };
}

function sourceSalePage() {
  const result = compareOffers([
    syntheticProduct({ productId: 'fractional', description: '<script>not markup</script>', promo: 1.555,
      snapEligible: true, manufacturerDeclarations: ['Organic'] }),
    syntheticProduct({ productId: 'oos', description: null, snapEligible: false,
      item: { inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } } }),
    syntheticProduct({ productId: 'date', promo: 2.555,
      price: { effectiveDate: { value: '2026-10-19', timezone: 'UTC' } } }),
  ], { now: NOW });
  return { ...result, scope: { locationId: 'TEST0001', mode: 'search', term: 'milk', topics: ['milk'],
    productLimit: 50, perQueryLimit: 50, exhaustive: false }, retrievedAt: new Date(NOW).toISOString() };
}

function pagedProducts({ start = null, term = 'milk bread', locationId = 'TEST0001', reported, rows } = {}) {
  const products = rows ?? [syntheticProduct({ productId: `page-${start ?? 'initial'}` }),
    syntheticProduct({ productId: `fractional-${start ?? 'initial'}`, promo: 1.555 })];
  const result = compareOffers(products, { now: NOW });
  const pagination = reported ?? { start: start ?? 0, limit: 50, total: 1000 };
  return { ...result, retrievedAt: new Date(NOW).toISOString(),
    scope: { locationId, term, mode: 'search', topics: [term], productLimit: 50, perQueryLimit: 50, exhaustive: false },
    page: { requestedStart: start, reported: pagination, continuation: productPageContinuation(pagination, products.length) } };
}

function readyProductSearch(page, term = ' milk   bread ') {
  page.run(`state.connection = 'ready'; state.configured = true; ui['search-term'].value = ${JSON.stringify(term)};`);
}

test('next results explicitly replaces one page while retaining the store, basket and unrankable source sale access', async () => {
  const page = shopperPage(async call => response(pagedProducts({ start: call.body.start ?? null })));
  readyProductSearch(page);
  await page.run('loadDeals()');
  assert.equal(page.calls.length, 1, 'Loading a page must not start automatic traversal.');
  assert.equal(page.calls[0].body.term, 'milk bread', 'Repeated whitespace uses the same canonical confirmed query as the server.');
  assert.equal(Object.hasOwn(page.calls[0].body, 'start'), false);
  assert.equal(page.node('next-products').hidden, false);
  assert.match(page.node('product-page-context').textContent, /1000 matching products/u);
  assert.match(page.node('product-page-context').textContent, /not promotion totals/u);
  page.run("state.basket = [{ key: 'kept', product: state.results.products[0], quantity: 2, locationId: state.selectedStore.locationId }];");
  const basketBefore = page.run('JSON.stringify(state.basket)');
  await page.run('loadDeals({ next: true })');
  assert.equal(page.calls.length, 2);
  assert.equal(page.calls[1].body.start, 2);
  assert.equal(page.calls[1].body.locationId, 'TEST0001');
  assert.equal(page.calls[1].body.term, 'milk bread');
  assert.equal(page.run('state.results.products.length'), 2, 'Pages replace, never accumulate.');
  assert.equal(page.run('state.results.products[0].source.productId'), 'page-2');
  assert.equal(page.run('state.results.sourceEvidence.records.length'), 2);
  assert.equal(page.node('reported-sales-list').children.length, 1);
  assert.equal(page.run('JSON.stringify(state.basket)'), basketBefore);
  assert.equal(page.run('state.selectedStore.locationId'), 'TEST0001');
  assert.match(page.node('deal-status').textContent, /Results page replaced/u);
});

test('page captions show one-based raw-product ranges for first and replacement pages', async () => {
  const page = shopperPage(async call => {
    const start = call.body.start ?? null;
    const rows = Array.from({ length: 50 }, (_, index) => syntheticProduct({ productId: `range-${start ?? 0}-${index}` }));
    return response(pagedProducts({ start, rows }));
  });
  readyProductSearch(page);
  await page.run('loadDeals()');
  assert.match(page.node('product-page-context').textContent, /Product results 1–50\./u);
  assert.doesNotMatch(page.node('product-page-context').textContent, /reported starting position/u);
  await page.run('loadDeals({ next: true })');
  assert.equal(page.calls[1].body.start, 50);
  assert.match(page.node('product-page-context').textContent, /Product results 51–100\./u);
  assert.match(page.node('product-page-context').textContent, /50 product results before filters and price checks/u);
  assert.match(page.node('product-page-context').textContent, /1000 matching products.*not promotion totals/u);
  assert.match(page.node('product-page-status').textContent, /products may repeat or be skipped/u);
});

test('unknown positions, empty pages and unsafe arithmetic omit the displayed product range', async () => {
  for (const [reported, rows] of [
    [{ start: null, limit: 50, total: null }, [syntheticProduct()]],
    [{ start: 0, limit: 50, total: 0 }, []],
    [{ start: Number.MAX_SAFE_INTEGER, limit: 50, total: null }, [syntheticProduct()]],
  ]) {
    const page = shopperPage(async () => response(pagedProducts({ reported, rows })));
    readyProductSearch(page);
    await page.run('loadDeals()');
    assert.notEqual(page.run('state.results'), null, 'The valid returned page remains accessible.');
    const caption = page.node('product-page-context').textContent;
    assert.doesNotMatch(caption, /Product results \d+–\d+/u);
    assert.doesNotMatch(caption, /reported starting position/u);
    assert.match(caption, new RegExp(`This page returned ${rows.length} product results before filters and price checks`, 'u'));
    assert.match(caption, /not promotion totals/u);
    if (reported.total === null) assert.match(caption, /matching-product total is not reported/u);
  }
});

test('missing-item accounting uses singular and plural product-result grammar', async () => {
  for (const count of [1, 2]) {
    const rows = Array.from({ length: count }, (_, index) => ({ productId: `missing-${index}`, description: 'Details unavailable', items: [] }));
    const page = shopperPage(async () => response(pagedProducts({ rows })));
    readyProductSearch(page);
    await page.run('loadDeals()');
    assert.notEqual(page.run('state.results'), null);
    const caption = page.node('source-accounting').textContent;
    assert.match(caption, count === 1 ? /1 product result has no item details/u : /2 product results have no item details/u);
    assert.doesNotMatch(caption, /1 product results have/u);
    assert.match(caption, /sale status is unknown/u);
  }
});

test('a failed or cancelled next page keeps the current page and retries the exact confirmed offset', async () => {
  for (const failure of ['network', 'cancel']) {
    const waiting = deferred();
    let calls = 0;
    const page = shopperPage(async call => {
      calls++;
      if (calls === 2) {
        if (failure === 'network') throw new Error('Synthetic page failure.');
        return waiting.promise; // Ignore abort to exercise the late-response guard.
      }
      return response(pagedProducts({ start: call.body.start ?? null }));
    });
    readyProductSearch(page);
    await page.run('loadDeals()');
    const before = page.run('JSON.stringify(state.results)');
    const pending = page.run('loadDeals({ next: true })');
    await page.run('loadDeals({ next: true })');
    assert.equal(page.calls.length, 2, 'A repeated click during a pending page must not dispatch another request.');
    if (failure === 'cancel') {
      assert.equal(page.node('next-products').disabled, true);
      page.node('cancel-deals').dispatch('click');
      assert.equal(page.calls[1].signal.aborted, true);
      waiting.resolve(response(pagedProducts({ start: 2 })));
    }
    await pending;
    assert.equal(page.run('JSON.stringify(state.results)'), before);
    assert.equal(page.node('next-products').hidden, false);
    assert.equal(page.node('next-products').disabled, false);
    assert.match(page.node('deal-status').textContent, /current page/iu);
    await page.run('loadDeals({ next: true })');
    assert.equal(page.calls[2].body.start, page.calls[1].body.start);
    assert.equal(page.run('state.results.page.requestedStart'), 2);
  }
});

test('input and store changes invalidate page context and late responses cannot replace a newer search', async () => {
  for (const change of ['term', 'store']) {
    const waiting = deferred();
    let calls = 0;
    const page = shopperPage(async call => {
      if (++calls === 2) return waiting.promise;
      return response(pagedProducts({ start: call.body.start ?? null, term: call.body.term, locationId: call.body.locationId }));
    });
    readyProductSearch(page);
    await page.run('loadDeals()');
    const pending = page.run('loadDeals({ next: true })');
    if (change === 'term') page.run("ui['search-term'].value = 'salt'; ui['search-term'].dispatch('input');");
    else page.run("clearSelection(); state.selectedStore = { locationId: 'TEST0002', name: 'Other synthetic store', address: {} }; ui['search-term'].value = 'salt';");
    assert.equal(page.run('state.results'), null);
    assert.equal(page.node('next-products').hidden, true);
    await page.run('loadDeals({ next: true })');
    assert.equal(page.calls.length, 2, 'Reset context cannot continue the old page.');
    await page.run('loadDeals()');
    assert.equal(Object.hasOwn(page.calls[2].body, 'start'), false);
    waiting.resolve(response(pagedProducts({ start: 2 })));
    await pending;
    assert.equal(page.run('state.results.scope.term'), 'salt');
    assert.equal(page.run('state.results.scope.locationId'), change === 'store' ? 'TEST0002' : 'TEST0001');
    assert.equal(page.run('state.results.page.requestedStart'), null);
  }
});

test('wrong-context or malformed next pages fail visibly without replacing the confirmed page', async () => {
  for (const corrupt of [value => { value.scope.term = 'different'; }, value => { value.scope.locationId = 'TEST0002'; },
    value => { value.page.requestedStart = 3; }, value => { value.page.reported.start = 0; },
    value => { value.page.continuation.nextStart = 2; }, value => { value.page.reported.total = '1000'; },
    value => { value.summary.products = 0; }]) {
    let calls = 0;
    const page = shopperPage(async call => {
      const payload = pagedProducts({ start: call.body.start ?? null });
      if (++calls === 2) corrupt(payload);
      return response(payload);
    });
    readyProductSearch(page);
    await page.run('loadDeals()');
    const before = page.run('JSON.stringify(state.results)');
    await page.run('loadDeals({ next: true })');
    assert.equal(page.run('JSON.stringify(state.results)'), before);
    assert.match(page.node('deal-status').textContent, /could not load/u);
    assert.equal(page.node('next-products').hidden, false);
  }
});

test('unknown, source-limit and reported-end page states never guess a next page or a store promotion total', async () => {
  for (const [start, reported, expected] of [
    [null, { start: null, limit: null, total: null }, /cannot be confirmed/u],
    [null, { start: 250, limit: 50, total: 1000 }, /more specific/u],
    [null, { start: 0, limit: 50, total: 2 }, /end of the matching products/u],
  ]) {
    const page = shopperPage(async () => response(pagedProducts({ start, reported })));
    readyProductSearch(page);
    await page.run('loadDeals()');
    assert.equal(page.node('next-products').hidden, true);
    assert.match(page.node('product-page-status').textContent, expected);
    assert.match(page.node('product-page-context').textContent, /not promotion totals/u);
    await page.run('loadDeals({ next: true })');
    assert.equal(page.calls.length, 1);
  }
});

test('a shopper can inspect unrankable sale amounts with exact precision, qualifiers and source filters', async () => {
  const page = shopperPage(async () => response(sourceSalePage()));
  page.run("state.connection = 'ready'; ui['search-term'].value = 'milk'; ui['snap-filter'].value = 'all';");
  await page.run('loadDeals()');
  assert.equal(page.node('reported-sales').hidden, false);
  assert.equal(page.node('reported-sales-list').children.length, 3);
  const text = page.node('reported-sales-list').textContent;
  assert.match(text, /Reported sale amount: 1\.555/u);
  assert.match(text, /<script>not markup<\/script>/u, 'Source text stays text; the renderer uses textContent.');
  assert.match(text, /Product name not supplied/u);
  assert.match(text, /2026-10-19 \(UTC\)/u);
  assert.match(text, /temporarily out of stock/u);
  assert.match(text, /Currency is not identified in these displayed amounts/u);
  assert.doesNotMatch(text, /Add to shopping list|Save |Current price/u);
  page.run("ui['product-view'].value = 'promotions'; renderResults();");
  assert.equal(page.node('offers-list').children.length, 0);
  assert.equal(page.node('reported-sales-list').children.length, 3);
  assert.match(page.node('empty-results-message').textContent, /Other reported sale prices below/u);
  page.run("ui['snap-filter'].value = 'yes'; ui['declaration-filter'].value = 'Organic'; renderResults();");
  assert.equal(page.node('reported-sales-list').children.length, 1);
  assert.match(page.node('reported-sales-count').textContent, /1 returned result matches these filters/u);
  assert.equal(page.node('snap-filter-field').hidden, false, 'Source-only eligibility must expose its filter.');
  page.run('clearResults()');
  assert.equal(page.node('reported-sales').hidden, true);
  assert.equal(page.node('reported-sales-list').children.length, 0);
});

test('a malformed evidence response fails visibly and cannot preserve an earlier sale panel', async () => {
  let calls = 0;
  const page = shopperPage(async () => {
    const payload = sourceSalePage();
    if (++calls === 2) payload.sourceEvidence.records[0].source.price.promo = 'invented';
    return response(payload);
  });
  page.run("state.connection = 'ready'; ui['search-term'].value = 'milk'; ui['snap-filter'].value = 'all';");
  await page.run('loadDeals()');
  assert.equal(page.node('reported-sales').hidden, false);
  await page.run('loadDeals()');
  assert.equal(page.run('state.results'), null);
  assert.equal(page.node('reported-sales').hidden, true);
  assert.equal(page.node('reported-sales-list').children.length, 0);
  assert.match(page.node('deal-status').textContent, /unexpected|unsupported|could not/iu);
});

test('an included flag cannot turn an out-of-stock source sale into a hidden successful empty result', async () => {
  const page = shopperPage(async () => {
    const result = compareOffers([syntheticProduct({ item: { inventory: { stockLevel: 'TEMPORARILY_OUT_OF_STOCK' } } })], { now: NOW });
    result.sourceEvidence.records[0].includedInOffers = true;
    result.sourceEvidence.summary.otherReportedPromotions = 0;
    return response({ ...sourceSalePage(), ...result });
  });
  page.run("state.connection = 'ready'; ui['search-term'].value = 'milk'; ui['snap-filter'].value = 'all';");
  await page.run('loadDeals()');
  assert.equal(page.run('state.results'), null);
  assert.equal(page.node('results-region').hidden, true);
  assert.match(page.node('deal-status').textContent, /unexpected|unsupported|could not/iu);
});

test('differing prices from a missing-name variant cannot produce a qualified shopping row', async () => {
  const result = compareOffers([syntheticProduct({ description: null, promo: 2 }), syntheticProduct({ promo: 1 })], { now: NOW });
  const page = shopperPage(async () => response({ ...sourceSalePage(), ...result }));
  page.run("state.connection = 'ready'; ui['search-term'].value = 'milk'; ui['snap-filter'].value = 'all';");
  await page.run('loadDeals()');
  assert.equal(page.node('offers-list').children.length, 0);
  assert.equal(page.node('reported-sales-list').children.length, 2);
  assert.match(page.node('reported-sales-list').textContent, /Neither version is confirmed/u);
});

function historyPage(id = 'first', nextCursor = 'synthetic-next-page') {
  return { status: 'available', locationId: 'TEST0001', observations: [observation(id)],
    page: { nextCursor, truncated: nextCursor !== null } };
}

test('a failed next history page keeps existing results and retries the same cursor', async () => {
  let count = 0;
  const page = shopperPage(async () => {
    count++;
    if (count === 2) throw new Error('Synthetic connection failure.');
    return response(count === 1 ? historyPage() : historyPage('second', null));
  });
  await page.run('searchHistory()');
  const first = page.node('history-results').textContent;
  await page.run('searchHistory({ more: true })');
  assert.equal(page.node('history-results').children.length, 1);
  assert.equal(page.node('history-results').textContent, first);
  assert.equal(page.node('more-history').hidden, false);
  assert.equal(page.node('more-history').disabled, false);
  assert.match(page.node('history-search-status').textContent, /try again/iu);
  assert.equal(page.run('state.historyCursor'), 'synthetic-next-page');
  await page.run('searchHistory({ more: true })');
  assert.equal(page.calls[1].body.cursor, 'synthetic-next-page');
  assert.equal(page.calls[2].body.cursor, 'synthetic-next-page');
  assert.equal(page.node('history-results').children.length, 2);
  assert.equal(page.node('more-history').hidden, true);
});

test('cancelling a next history page preserves its retry control and cursor', async () => {
  const page = shopperPage(call => {
    if (!call.body.cursor) return response(historyPage());
    return new Promise((resolve, reject) => {
      call.signal.addEventListener('abort', () => reject(new Error('Synthetic abort.')), { once: true });
    });
  });
  await page.run('searchHistory()');
  const pending = page.run('searchHistory({ more: true })');
  assert.equal(page.node('more-history').hidden, true);
  assert.equal(page.node('cancel-history').hidden, false);
  page.node('cancel-history').dispatch('click');
  await pending;
  assert.equal(page.calls[1].signal.aborted, true);
  assert.equal(page.node('history-results').children.length, 1);
  assert.equal(page.run('state.historyCursor'), 'synthetic-next-page');
  assert.equal(page.node('more-history').hidden, false);
  assert.equal(page.node('more-history').disabled, false);
  assert.match(page.node('history-search-status').textContent, /cancelled.*search again/iu);
});

test('unqualified source dates stay raw instead of shifting or normalizing calendar days', () => {
  const page = shopperPage();
  for (const value of ['2026-10-19', '2026-02-31', '2026-02-31T12:00:00Z',
    '2025-02-29T12:00:00Z', '2026-10-19T12:30:00']) {
    const rendered = page.run(`priceDate('Reported expiration', ${JSON.stringify({ value, timezone: 'America/Chicago' })})`);
    assert.equal(rendered, `Reported expiration: ${value} (date or time not confirmed)`);
    assert.equal(page.run(`readableDate(${JSON.stringify(value)})`), null);
  }
});

test('valid explicit source instants format with the same confirmed local time and source timezone', () => {
  const page = shopperPage();
  for (const value of ['2026-10-19T12:30:00Z', '2026-10-19T07:30:00-05:00']) {
    assert.equal(page.run(`priceDate('Reported expiration', ${JSON.stringify({ value, timezone: 'America/Chicago' })})`),
      'Reported expiration: Oct 19, 2026, 7:30 AM CDT (source timezone: America/Chicago)');
  }
});

function cartPage() {
  const reply = deferred();
  const page = shopperPage(call => {
    assert.equal(call.path, '/app/api/v1/cart/add');
    return reply.promise;
  });
  page.run(`
    const syntheticProduct = { source: { description: 'Synthetic grocery', productId: 'product-one',
      itemId: 'item-one', upc: '0000000000001', soldBy: 'unit' }, pricing: { currentCents: 250 } };
    state.basket = [{ key: 'synthetic-line', product: syntheticProduct, locationId: 'TEST0001', quantity: 1 }];
    state.cart = { enabled: true, configured: true, connected: true, status: 'connected', csrfToken: 'synthetic-token' };
    renderBasket();
  `);
  return { ...page, acknowledge: () => reply.resolve(response({ acknowledged: true,
    cart: { enabled: true, configured: true, connected: true, status: 'connected', csrfToken: 'synthetic-token' } })) };
}

function findTag(node, tagName) {
  if (node.tagName === tagName) return node;
  for (const child of node.children) {
    const result = findTag(child, tagName);
    if (result) return result;
  }
}

test('an unchanged shopping list acknowledges the actual sent quantities normally', async () => {
  const page = cartPage();
  const pending = page.run('addCart()');
  assert.deepEqual(page.calls[0].body.items, [{ upc: '0000000000001', quantity: 1 }]);
  page.acknowledge();
  await pending;
  assert.equal(page.run('state.cartAcknowledged'), true);
  assert.equal(page.node('add-cart').disabled, true);
  assert.match(page.node('cart-status').textContent, /acknowledged the add request/iu);
  assert.doesNotMatch(page.node('cart-status').textContent, /earlier quantities|list changed/iu);
});

test('editing quantity during an add leaves the changed list unacknowledged and explains what was sent', async () => {
  const page = cartPage();
  const pending = page.run('addCart()');
  const quantity = findTag(page.node('basket-lines'), 'input');
  assert.ok(quantity, 'Use the actual rendered quantity control and its change handler.');
  quantity.value = '2';
  quantity.dispatch('change');
  assert.equal(page.run('state.basket[0].quantity'), 2);
  page.acknowledge();
  await pending;
  assert.deepEqual(page.calls[0].body.items, [{ upc: '0000000000001', quantity: 1 }]);
  assert.equal(page.run('state.cartAcknowledged'), false);
  assert.equal(page.node('add-cart').disabled, false);
  assert.match(page.node('cart-status').textContent, /Only the earlier quantities were sent/iu);
  assert.match(page.node('cart-status').textContent, /Check your Kroger cart before adding the full list again/iu);
});

test('a cart acknowledgement cannot transfer to a different selected store or product', async () => {
  for (const change of ['store', 'product']) {
    const page = cartPage();
    const pending = page.run('addCart()');
    page.run(change === 'store' ? `
      state.selectedStore = { locationId: 'TEST0002', name: 'Another synthetic store', address: {} };
      state.basket = state.basket.map(line => ({ ...line, locationId: 'TEST0002' }));
      renderBasket();
    ` : `
      state.basket = state.basket.map(line => ({ ...line, product: { ...line.product,
        source: { ...line.product.source, upc: '0000000000002' } } }));
      renderBasket();
    `);
    page.acknowledge();
    await pending;
    assert.equal(page.run('state.cartAcknowledged'), false, change);
    assert.deepEqual(page.calls[0].body.items, [{ upc: '0000000000001', quantity: 1 }]);
    assert.match(page.node('cart-status').textContent, /Only the earlier quantities were sent/iu);
  }
});

test('history permission loss clears previously opened details as well as results and pagination', async () => {
  for (const status of ['permission_required', 'unavailable']) {
    const page = shopperPage(call => {
      if (call.path.endsWith('/retrieve')) return response({ status: 'available', locationId: 'TEST0001', observation: observation('first') });
      return response(call.body.cursor ? { status, locationId: 'TEST0001' } : historyPage());
    });
    await page.run('searchHistory()');
    await page.run("loadHistoryDetail('first')");
    assert.equal(page.node('history-detail').hidden, false);
    assert.match(page.node('history-detail-content').textContent, /Synthetic grocery/u);
    await page.run('searchHistory({ more: true })');
    assert.equal(page.run('state.history'), null);
    assert.equal(page.run('state.historyCursor'), null);
    assert.equal(page.node('history-results').children.length, 0);
    assert.equal(page.node('more-history').hidden, true);
    assert.equal(page.node('history-detail').hidden, true);
    assert.equal(page.node('history-detail-content').textContent, '');
  }
});

test('a late history detail response cannot restore revoked content after its request is aborted', async () => {
  const detail = deferred();
  const page = shopperPage(call => {
    // Deliberately ignore abort in this synthetic transport to test the real
    // sequence guard even when a response arrives after cancellation.
    if (call.path.endsWith('/retrieve')) return detail.promise;
    return response(call.body.cursor ? { status: 'permission_required', locationId: 'TEST0001' } : historyPage());
  });
  await page.run('searchHistory()');
  const pending = page.run("loadHistoryDetail('first')");
  const detailCall = page.calls.find(call => call.path.endsWith('/retrieve'));
  await page.run('searchHistory({ more: true })');
  assert.equal(detailCall.signal.aborted, true);
  detail.resolve(response({ status: 'available', locationId: 'TEST0001', observation: observation('first') }));
  await pending;
  assert.equal(page.node('history-detail').hidden, true);
  assert.equal(page.node('history-detail-content').textContent, '');
  assert.equal(page.node('history-results').children.length, 0);
  assert.equal(page.run('state.history'), null);
});
