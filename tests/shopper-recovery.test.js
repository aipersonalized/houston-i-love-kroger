import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as basket from '../public/basket.js';
import * as catalog from '../public/catalog.js';
import * as ordering from '../public/ordering.js';

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
