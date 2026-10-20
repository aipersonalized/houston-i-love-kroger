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

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const form = html.match(/<form id="deal-form"[\s\S]*?<\/form>/u)?.[0] ?? '';
const shortcutMarkup = [...form.matchAll(/<button\b([^>]*data-grocery-term="([^"]+)"[^>]*)>([^<]+)<\/button>/gu)];
const expectedGroceries = [
  ['Apples', 'apples'], ['Bananas', 'bananas'], ['Chicken breast', 'chicken breast'],
  ['Salmon', 'salmon'], ['Milk', 'milk'], ['Eggs', 'eggs'], ['Rice', 'rice'], ['Paper towels', 'paper towels'],
];

// Exercise the real form handler, request guards and rendering with synthetic
// records. DOM and fetch are substitutes, so native keyboard/validation behavior
// and browser layout still need an actual browser check.
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
  dispatch(name, properties = {}) { return this.listeners.get(name)?.({ preventDefault() {}, ...properties }); }
  focus() {}
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const response = payload => new Response(JSON.stringify({ ok: true, ...payload }), {
  headers: { 'Content-Type': 'application/json' },
});

function syntheticPage({ locationId, term, start }) {
  const result = compareOffers([syntheticProduct({ description: `Synthetic ${term || 'starter grocery'}` })], { now: NOW });
  const reported = { start: start ?? 0, limit: 50, total: 100 };
  return { ...result, retrievedAt: new Date(NOW).toISOString(), dataSource: 'synthetic-fixture',
    scope: { locationId, mode: term ? 'search' : 'sample', term: term ?? null,
      topics: term ? [term] : ['milk', 'bread', 'eggs'], productLimit: term ? 50 : 45,
      perQueryLimit: term ? 50 : 15, exhaustive: false },
    ...(term ? { page: { requestedStart: start ?? null, reported,
      continuation: productPageContinuation(reported, result.summary.products) } } : {}),
  };
}

function shopperPage(fetchImpl = async call => response(syntheticPage(call.body))) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, new PageNode());
    return nodes.get(id);
  };
  const shortcuts = shortcutMarkup.map(([, attributes, term, label]) => {
    const button = new PageNode('BUTTON');
    button.dataset.groceryTerm = term;
    button.textContent = label;
    button.disabled = /\bdisabled\b/u.test(attributes);
    return button;
  });
  node('grocery-shortcuts').append(...shortcuts);
  const calls = [];
  const context = vm.createContext({ ...basket, ...catalog, ...ordering, URL, AbortController, Intl,
    window: { setTimeout, clearTimeout },
    document: { baseURI: 'https://example.test/app/', getElementById: node,
      createElement: tag => new PageNode(tag),
      createTextNode: text => { const result = new PageNode(); result.textContent = text; return result; } },
    fetch: (url, options) => {
      const call = { path: url.pathname, body: options.body ? JSON.parse(options.body) : null, signal: options.signal };
      calls.push(call);
      return fetchImpl(call);
    },
  });
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const lifecycle = source.indexOf("window.addEventListener('pagehide'");
  assert.ok(lifecycle > source.indexOf("ui['cancel-history'].addEventListener"));
  vm.runInContext(source.slice(0, lifecycle).replace(/^import .*$/gm, ''), context, { filename: 'public/app.js' });
  const run = code => vm.runInContext(code, context);
  const submit = async button => { node('deal-form').dispatch('submit', { submitter: button }); await settle(); };
  const chooseStore = async (locationId = 'TEST0001') => {
    run(`state.connection = 'ready'; state.configured = true;
      selectStore({ locationId: '${locationId}', name: 'Synthetic store', address: {} });`);
    await settle();
  };
  return { node, calls, run, shortcuts, submit, chooseStore };
}

test('varied groceries are native submit buttons with a named group and can replace invalid typed text', () => {
  assert.deepEqual(shortcutMarkup.map(([, , term, label]) => [label, term]), expectedGroceries);
  assert.match(form, /role="group" aria-labelledby="grocery-shortcuts-title"/u);
  assert.match(form, /id="grocery-shortcuts-title"[^>]*>Try a grocery<\/p>/u);
  for (const [, attributes] of shortcutMarkup) {
    assert.match(attributes, /type="submit"/u, 'Native buttons support pointer, Enter and Space activation.');
    assert.match(attributes, /\bformnovalidate\b/u, 'A prior too-short term must not block choosing a valid grocery.');
    assert.match(attributes, /\bdisabled\b/u, 'Buttons are unavailable before the connection/store is ready.');
  }
});

test('choosing a store keeps the existing starter search and each shortcut sends one current-store search', async () => {
  const page = shopperPage();
  await page.chooseStore();
  assert.deepEqual(page.calls.map(call => call.body), [{ locationId: 'TEST0001', includeAll: true }]);
  assert.equal(page.run('state.results.scope.mode'), 'sample');
  for (const [index, [, term]] of expectedGroceries.entries()) {
    assert.equal(page.shortcuts[index].disabled, false);
    const before = page.calls.length;
    await page.submit(page.shortcuts[index]);
    assert.equal(page.calls.length, before + 1, 'A shortcut must not search other groceries or traverse pages.');
    assert.equal(page.calls.at(-1).path, '/app/api/v1/products/search');
    assert.deepEqual(page.calls.at(-1).body, { locationId: 'TEST0001', includeAll: true, term });
    assert.equal(page.node('search-term').value, term);
    assert.equal(page.run('state.results.scope.mode'), 'search');
    assert.equal(page.run('state.results.scope.term'), term);
    assert.match(page.node('sample-coverage').textContent, /limited selection/u);
  }
});

test('a shortcut replaces short text, clears old paging and source filters, and retains the same-store list', async () => {
  const page = shopperPage();
  await page.chooseStore();
  await page.submit(page.shortcuts[0]);
  await page.run('loadDeals({ next: true })');
  assert.equal(page.run('state.results.page.requestedStart'), 1);
  page.run(`state.basket = addBasketItem([], state.results.products[0], 'TEST0001', state.results.retrievedAt);
    ui['sort-order'].value = 'price'; ui['snap-filter'].value = 'yes'; ui['declaration-filter'].value = 'Organic';
    ui['search-term'].value = 'x'; ui['search-error'].textContent = 'Use a longer search';
    ui['search-term'].setAttribute('aria-invalid', 'true');`);
  await page.submit(page.shortcuts[2]);
  assert.deepEqual(page.calls.at(-1).body, { locationId: 'TEST0001', includeAll: true, term: 'chicken breast' });
  assert.equal(page.node('search-error').textContent, '');
  assert.equal(page.node('search-term').attributes.has('aria-invalid'), false);
  assert.equal(page.run('state.results.page.requestedStart'), null);
  assert.equal(page.node('sort-order').value, 'savings');
  assert.equal(page.node('snap-filter').value, 'all');
  assert.equal(page.node('declaration-filter').value, '');
  assert.equal(page.run('state.basket.length'), 1);
  assert.equal(page.run('state.basket[0].quantity'), 1);
});

test('no-store and unavailable states keep shortcuts disabled without changing the term or sending a request', async () => {
  const page = shopperPage();
  for (const setup of [
    "state.connection = 'ready'; state.configured = true; state.selectedStore = null;",
    "state.selectedStore = { locationId: 'TEST0001' }; state.connection = 'checking';",
    "state.connection = 'ready'; state.configured = false;",
    "state.configured = true; state.alive = false;",
  ]) {
    page.run(`${setup} ui['search-term'].value = 'kept text'; updateControls();`);
    assert.ok(page.shortcuts.every(button => button.disabled));
    await page.submit(page.shortcuts[0]);
    assert.equal(page.calls.length, 0);
    assert.equal(page.node('search-term').value, 'kept text');
  }
});

test('pending shortcuts cannot replace a search, and cancellation makes a new explicit choice available', async () => {
  let resolve;
  const waiting = new Promise(accept => { resolve = accept; });
  const page = shopperPage(async call => call.body.term === 'apples' ? waiting : response(syntheticPage(call.body)));
  await page.chooseStore();
  await page.submit(page.shortcuts[0]);
  assert.ok(page.shortcuts.every(button => button.disabled));
  await page.submit(page.shortcuts[1]);
  assert.equal(page.calls.length, 2);
  assert.equal(page.node('search-term').value, 'apples');
  page.node('cancel-deals').dispatch('click');
  assert.ok(page.shortcuts.every(button => !button.disabled));
  assert.equal(page.calls[1].signal.aborted, true);
  await page.submit(page.shortcuts[1]);
  resolve(response(syntheticPage(page.calls[1].body)));
  await settle();
  assert.equal(page.run('state.results.scope.term'), 'bananas');
  assert.equal(page.calls.length, 3);
});

test('changing stores clears shortcuts context and rejects a late response for the previous store', async () => {
  let resolve;
  const waiting = new Promise(accept => { resolve = accept; });
  const page = shopperPage(async call => call.body.term === 'salmon' ? waiting : response(syntheticPage(call.body)));
  await page.chooseStore();
  await page.submit(page.shortcuts[3]);
  page.node('change-store').dispatch('click');
  assert.equal(page.node('deal-form').hidden, true);
  assert.equal(page.node('search-term').value, '');
  assert.ok(page.shortcuts.every(button => button.disabled));
  await page.submit(page.shortcuts[7]);
  assert.equal(page.calls.length, 2, 'No search can reuse the cleared store.');
  await page.chooseStore('TEST0002');
  await page.submit(page.shortcuts[7]);
  resolve(response(syntheticPage(page.calls[1].body)));
  await settle();
  assert.deepEqual(page.calls.at(-1).body, { locationId: 'TEST0002', includeAll: true, term: 'paper towels' });
  assert.equal(page.run('state.results.scope.locationId'), 'TEST0002');
  assert.equal(page.run('state.results.scope.term'), 'paper towels');
});

test('a failed shortcut search retains its term, shows the normal error, and permits an explicit retry', async () => {
  let failed = false;
  const page = shopperPage(async call => {
    if (call.body.term === 'rice' && !failed) { failed = true; throw new Error('Synthetic transport failure.'); }
    return response(syntheticPage(call.body));
  });
  await page.chooseStore();
  await page.submit(page.shortcuts[6]);
  assert.equal(page.node('search-term').value, 'rice');
  assert.match(page.node('deal-status').textContent, /could not be reached/u);
  assert.equal(page.run('state.results'), null);
  assert.ok(page.shortcuts.every(button => !button.disabled));
  assert.equal(page.calls.length, 2, 'A failed search must not retry automatically.');
  await page.submit(page.shortcuts[6]);
  assert.equal(page.calls.length, 3);
  assert.equal(page.run('state.results.scope.term'), 'rice');
});
