import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CartSessions } from '../src/cart.js';
import { NOW, tokenResponse } from './fixtures.js';
import * as basket from '../public/basket.js';
import * as catalog from '../public/catalog.js';
import * as ordering from '../public/ordering.js';

// Exercise the real page action functions and real session owner without a
// network listener, browser account, supplier request or persistent storage.
// DOM presentation and browser cookie transport are deliberately substituted;
// this is a client/session contract regression, not browser qualification.
function cartPage(t, { now, fetchImpl = async () => {
  throw new Error('Supplier access is forbidden in this test.');
} } = {}) {
  const config = { basePath: '/app/', environment: 'production',
    publicOrigin: 'https://example.test', clientId: 'synthetic-client',
    clientSecret: 'synthetic-secret', cartEnabled: true, cartGranted: true,
    cartRedirectUri: 'https://example.test/app/api/v1/cart/callback' };
  const cart = new CartSessions({ config, now, fetchImpl });
  t.after(() => cart.close());
  let cookie = '';
  const calls = [];
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, disabled: false, value: '', textContent: '',
      setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
      focus() {}, classList: { toggle() {} } });
    return nodes.get(id);
  };
  const context = vm.createContext({ ...basket, ...catalog, ...ordering, Intl,
    URL, AbortController, window: { setTimeout, clearTimeout },
    document: { baseURI: `${config.publicOrigin}${config.basePath}`, getElementById: getNode },
    fetch: async (url, options) => {
      const request = { headers: { cookie } };
      const response = { setHeader(name, value) {
        if (name.toLowerCase() === 'set-cookie') cookie = value.split(';')[0];
      } };
      const call = { path: url.pathname, status: 200 };
      calls.push(call);
      let payload;
      try {
        if (url.pathname.endsWith('/cart/status')) payload = { cart: cart.status(request, response) };
        else if (url.pathname.endsWith('/cart/connect')) payload = cart.connect(request, response);
        else if (url.pathname.endsWith('/cart/disconnect')) {
          payload = { cart: cart.disconnect(request, response, JSON.parse(options.body)) };
        } else if (url.pathname.endsWith('/cart/add')) {
          payload = await cart.add(request, response, JSON.parse(options.body));
        } else throw new Error('Unexpected client operation.');
        call.csrfToken = payload.cart.csrfToken;
        payload = { ok: true, ...payload };
      } catch (error) {
        call.status = error.status || 500;
        call.error = error.code;
        payload = { ok: false, error: { code: error.code || 'unexpected_test_request' } };
      }
      return new Response(JSON.stringify(payload), { status: call.status,
        headers: { 'Content-Type': 'application/json' } });
    },
  });
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const wiring = source.indexOf("ui['store-form'].addEventListener");
  assert.ok(wiring > 0, 'The harness must stop before page event wiring and startup.');
  vm.runInContext(source.slice(0, wiring).replace(/^import .*$/gm, '') + `
    globalThis.visit = async () => {
      await checkCart();
      await connectCart();
      await disconnectCart();
      return {
        status: ui['cart-status'].textContent,
        signInHidden: ui['cart-signin'].hidden,
        connected: state.cart?.connected,
      };
    };
  `, context, { filename: 'public/app.js' });
  return { visit: () => context.visit(), calls, node: getNode,
    run: code => vm.runInContext(code, context),
    callback: parameters => cart.callback({ headers: { cookie } }, { setHeader() {} }, parameters),
  };
}

test('a shopper can cancel a new cart connection after its visit cookie rotates', async t => {
  const page = cartPage(t);
  const result = await page.visit();
  assert.deepEqual(page.calls.map(call => call.path), [
    '/app/api/v1/cart/status', '/app/api/v1/cart/connect', '/app/api/v1/cart/disconnect',
  ]);
  assert.notEqual(page.calls[0].csrfToken, page.calls[1].csrfToken,
    'Starting authorization must create a different visit.');
  assert.equal(page.calls[2].status, 200,
    'Disconnect must use the newly returned visit token and succeed without a status refresh.');
  assert.match(result.status, /^Cart disconnected\./u);
  assert.equal(result.signInHidden, true);
  assert.equal(result.connected, false);
});

test('expired or denied sign-in removes the stale link and offers a fresh connection without adding items', async t => {
  for (const outcome of ['expired', 'visit-expired', 'denied']) {
    let time = NOW; let exchanges = 0;
    const page = cartPage(t, { now: () => time, fetchImpl: async () => {
      exchanges++; return tokenResponse();
    } });
    await page.run('checkCart()');
    await page.run('connectCart()');
    assert.equal(page.node('cart-signin').hidden, false);
    const previous = new URL(page.node('cart-signin').href);
    if (outcome === 'expired') time += 10 * 60_000;
    else if (outcome === 'visit-expired') time += 30 * 60_000;
    else await page.callback(new URLSearchParams({
      state: previous.searchParams.get('state'), error: 'access_denied',
    }));
    await page.run('checkCart()');
    assert.equal(page.node('cart-signin').hidden, true);
    assert.equal(page.node('cart-signin').href, undefined);
    assert.equal(page.node('connect-cart').hidden, false);
    assert.match(page.node('cart-status').textContent, outcome === 'visit-expired'
      ? /Sign in at Kroger to connect/u : /sign-in could not be completed/u);
    assert.equal(exchanges, 0);
    await page.run('connectCart()');
    assert.equal(page.node('cart-signin').hidden, false);
    assert.notEqual(new URL(page.node('cart-signin').href).searchParams.get('state'), previous.searchParams.get('state'));
    assert.ok(page.calls.every(call => !call.path.endsWith('/cart/add')));
  }
});

test('an observed unknown add keeps its warning through token and session expiry until explicit disconnect', async t => {
  let time = NOW; let writes = 0;
  const page = cartPage(t, { now: () => time, fetchImpl: async url => {
    if (url.endsWith('/token')) return tokenResponse({ expires_in: 60 });
    writes++; throw new Error('Synthetic dropped acknowledgement');
  } });
  await page.run('checkCart()');
  await page.run('connectCart()');
  const authorization = new URL(page.node('cart-signin').href);
  await page.callback(new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'fixture-code' }));
  await page.run('checkCart()');
  assert.equal(writes, 0, 'Sign-in and status must not add any items.');
  // An independent tab/client sends one explicitly requested synthetic add.
  // This page first learns its unknown outcome from status, not its own add.
  await page.run(`(async () => {
    try { await request('cart', './api/v1/cart/add', {
      items: [{ upc: '0000000000001', quantity: 2 }], csrfToken: state.cart.csrfToken,
    }, { credentials: 'same-origin' }); } catch {}
    await checkCart();
  })()`);
  assert.equal(page.node('cart-unknown').hidden, false);
  time += 60_000;
  await page.run('checkCart()');
  assert.equal(page.node('cart-unknown').hidden, false);
  assert.equal(page.node('connect-cart').hidden, true);
  time += 30 * 60_000;
  await page.run('checkCart()');
  assert.equal(page.node('cart-unknown').hidden, false);
  assert.equal(page.node('connect-cart').hidden, true);
  assert.equal(page.node('add-cart').hidden, true);
  assert.match(page.node('cart-status').textContent, /may have received/u);
  assert.equal(writes, 1);
  await page.run('disconnectCart()');
  assert.equal(page.node('cart-unknown').hidden, true);
  assert.equal(page.node('connect-cart').hidden, false);
  assert.equal(writes, 1);
});
