import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CartSessions, validateCartItems } from '../src/cart.js';
import { NOW, jsonResponse, tokenResponse } from './fixtures.js';

const config = { basePath: '/apps/houston-i-love-kroger/', environment: 'production',
  publicOrigin: 'https://example.com', clientId: 'fixture-client', clientSecret: 'fixture-secret',
  cartEnabled: true, cartGranted: true,
  cartRedirectUri: 'https://example.com/apps/houston-i-love-kroger/api/v1/cart/callback' };
const upc = '0000000000001';
function response() { return { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; } }; }
function visit(cart) {
  const res = response();
  const result = cart.connect({ headers: {} }, res);
  return { result, res, request: { headers: { cookie: res.headers['set-cookie'].split(';')[0] } } };
}
async function connected(cart) {
  const value = visit(cart);
  await cart.callback(value.request, response(), new URLSearchParams({ state: new URL(value.result.authorizationUrl).searchParams.get('state'), code: 'fixture-code' }));
  const status = cart.status(value.request, response());
  return { ...value, csrfToken: status.csrfToken };
}

test('cart is opt-in and requires independent granted scope, exact callback and production', t => {
  for (const change of [{ cartEnabled: false }, { cartGranted: false }, { cartRedirectUri: '' },
    { environment: 'certification' }, { clientSecret: '' }, { publicOrigin: 'http://example.com' }]) {
    const cart = new CartSessions({ config: { ...config, ...change } }); t.after(() => cart.close());
    assert.equal(cart.configured, false);
    assert.throws(() => visit(cart), { code: 'cart_setup_required' });
  }
});

test('confidential OAuth uses state, per-visit S256 PKCE and secure scoped session cookie', async t => {
  let exchange;
  const cart = new CartSessions({ config, now: () => NOW, fetchImpl: async (url, options) => {
    exchange = { url, options }; return tokenResponse({ scope: 'cart.basic:write', refresh_token: 'fixture-discarded-refresh' });
  } }); t.after(() => cart.close());
  const { result, res, request } = visit(cart);
  const authorization = new URL(result.authorizationUrl);
  assert.equal(authorization.origin, 'https://api.kroger.com');
  assert.equal(authorization.pathname, '/v1/connect/oauth2/authorize');
  assert.equal(authorization.searchParams.get('scope'), 'cart.basic:write');
  assert.equal(authorization.searchParams.get('redirect_uri'), config.cartRedirectUri);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.match(res.headers['set-cookie'], /Path=\/apps\/houston-i-love-kroger\/; HttpOnly; Secure; SameSite=Lax$/);
  await cart.callback(request, response(), new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'fixture-code' }));
  const form = new URLSearchParams(exchange.options.body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'fixture-code');
  assert.match(form.get('code_verifier'), /^[\w-]{43}$/);
  assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
  assert.equal(exchange.options.headers.Authorization, `Basic ${Buffer.from('fixture-client:fixture-secret').toString('base64')}`);
  const publicStatus = JSON.stringify(cart.status(request, response()));
  assert.equal(JSON.parse(publicStatus).connected, true);
  for (const privateValue of ['fixture-token', 'fixture-secret', 'fixture-discarded-refresh', 'fixture-code']) assert.ok(!publicStatus.includes(privateValue));
  await assert.rejects(cart.callback(request, response(), new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'fixture-code' })), { code: 'cart_state_invalid' });
});

test('state, expiry, denial and mismatched visit prevent token exchange', async t => {
  let calls = 0; let time = NOW;
  const cart = new CartSessions({ config, now: () => time, fetchImpl: async () => { calls++; return tokenResponse(); } }); t.after(() => cart.close());
  const { result, request } = visit(cart);
  const state = new URL(result.authorizationUrl).searchParams.get('state');
  for (const [req, parameters] of [[request, new URLSearchParams({ state: 'wrong', code: 'fixture' })],
    [{ headers: {} }, new URLSearchParams({ state, code: 'fixture' })],
    [request, new URLSearchParams(`state=${state}&state=${state}&code=fixture`)]]) {
    await assert.rejects(cart.callback(req, response(), parameters), { code: 'cart_state_invalid' });
  }
  await cart.callback(request, response(), new URLSearchParams({ state, error: 'access_denied', error_description: 'DO_NOT_EMIT' }));
  assert.equal(cart.status(request, response()).status, 'authorization_failed');
  const second = visit(cart);
  time += 10 * 60_000;
  await assert.rejects(cart.callback(second.request, response(), new URLSearchParams({ state: new URL(second.result.authorizationUrl).searchParams.get('state'), code: 'fixture' })), { code: 'cart_state_invalid' });
  assert.equal(calls, 0);
});

test('add sends one exact write, accepts native 204 and never parses a success body', async t => {
  const writes = [];
  const cart = new CartSessions({ config, fetchImpl: async (url, options) => {
    if (url.endsWith('/token')) return tokenResponse();
    writes.push({ url, options }); return new Response(null, { status: 204 });
  } }); t.after(() => cart.close());
  const { request, csrfToken } = await connected(cart);
  const result = await cart.add(request, response(), { items: [{ upc, quantity: 2, modality: 'PICKUP' }], csrfToken });
  assert.equal(result.acknowledged, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, 'https://api.kroger.com/v1/cart/add');
  assert.equal(writes[0].options.method, 'PUT');
  assert.equal(writes[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(writes[0].options.body), { items: [{ upc, quantity: 2, modality: 'PICKUP' }] });
  assert.ok(!JSON.stringify(result).includes('fixture-token'));
});

test('uncertain writes block another attempt; rejected writes and token expiry are distinct', async t => {
  for (const status of [500, 401, 403]) {
    let writes = 0;
    const cart = new CartSessions({ config, fetchImpl: async url => {
      if (url.endsWith('/token')) return tokenResponse();
      writes++; return jsonResponse({ error: 'DO_NOT_EMIT' }, status);
    } }); t.after(() => cart.close());
    const { request, csrfToken } = await connected(cart);
    const input = { items: [{ upc, quantity: 1 }], csrfToken };
    await assert.rejects(cart.add(request, response(), input), error => {
      assert.equal(error.code, status === 500 ? 'cart_write_outcome_unknown' : status === 401 ? 'cart_authorization_required' : 'cart_rejected');
      assert.ok(!error.message.includes('DO_NOT_EMIT')); return true;
    });
    assert.equal(writes, 1);
    if (status === 500) {
      await assert.rejects(cart.add(request, response(), input), { code: 'cart_write_outcome_unknown', status: 409 });
      assert.equal(writes, 1);
    }
  }
});

test('network failure is uncertain, malformed token is secret-safe and expiry requires reconnect', async t => {
  let time = NOW;
  const cart = new CartSessions({ config, now: () => time, fetchImpl: async url => {
    if (url.endsWith('/token')) return tokenResponse({ expires_in: 2 });
    throw new Error('DO_NOT_EMIT_PRIVATE_FAILURE');
  } }); t.after(() => cart.close());
  const { request, csrfToken } = await connected(cart);
  await assert.rejects(cart.add(request, response(), { items: [{ upc, quantity: 1 }], csrfToken }), error => {
    assert.equal(error.code, 'cart_write_outcome_unknown'); assert.ok(!error.message.includes('DO_NOT_EMIT_PRIVATE_FAILURE')); return true;
  });
  time += 2000;
  assert.equal(cart.status(request, response()).connected, false);
  const bad = new CartSessions({ config, fetchImpl: async () => tokenResponse({ access_token: 'DO_NOT_EMIT\nTOKEN' }) }); t.after(() => bad.close());
  await assert.rejects(connected(bad), { code: 'cart_authorization_failed' });
});

test('cart validation excludes arbitrary fields, fractional quantities, duplicate UPCs and missing CSRF', async t => {
  for (const values of [[], [{ upc, quantity: 0 }], [{ upc, quantity: 1.5 }], [{ upc: '123', quantity: 1 }],
    [{ upc, quantity: 1, url: 'https://attacker.example' }], [{ upc, quantity: 1, modality: 'SHIP' }],
    [{ upc, quantity: 1 }, { upc, quantity: 2 }]]) assert.throws(() => validateCartItems(values), { code: 'invalid_cart_items' });
  const cart = new CartSessions({ config, fetchImpl: async () => tokenResponse() }); t.after(() => cart.close());
  const { request, csrfToken } = await connected(cart);
  await assert.rejects(cart.add(request, response(), { items: [{ upc, quantity: 1 }], csrfToken: 'wrong' }), { code: 'cart_session_required' });
  const res = response();
  cart.disconnect(request, res, { csrfToken });
  assert.match(res.headers['set-cookie'], /Max-Age=0$/);
  await assert.rejects(cart.add(request, response(), { items: [{ upc, quantity: 1 }], csrfToken }), { code: 'cart_session_required' });
});

test('status retires an expired authorization attempt and a fresh attempt uses new state and PKCE', async t => {
  let time = NOW; let exchanges = 0;
  const cart = new CartSessions({ config, now: () => time, fetchImpl: async () => {
    exchanges++; return tokenResponse();
  } }); t.after(() => cart.close());
  const first = visit(cart);
  const oldAuthorization = new URL(first.result.authorizationUrl);
  time += 10 * 60_000;
  const expired = cart.status(first.request, response());
  assert.equal(expired.status, 'authorization_failed');
  assert.equal(expired.connected, false);
  await assert.rejects(cart.callback(first.request, response(), new URLSearchParams({
    state: oldAuthorization.searchParams.get('state'), code: 'fixture-expired-code',
  })), { code: 'cart_state_invalid' });
  assert.equal(exchanges, 0);
  const res = response();
  const next = cart.connect(first.request, res);
  const authorization = new URL(next.authorizationUrl);
  for (const field of ['state', 'code_challenge']) {
    assert.notEqual(authorization.searchParams.get(field), oldAuthorization.searchParams.get(field));
  }
  assert.notEqual(next.cart.csrfToken, expired.csrfToken);
  assert.notEqual(res.headers['set-cookie'], first.res.headers['set-cookie']);
});

test('an unknown add stays blocked after token expiry while the session survives', async t => {
  let time = NOW; let writes = 0;
  const cart = new CartSessions({ config, now: () => time, fetchImpl: async url => {
    if (url.endsWith('/token')) return tokenResponse({ expires_in: 60 });
    writes++; throw new Error('Synthetic dropped acknowledgement');
  } }); t.after(() => cart.close());
  const { request, csrfToken } = await connected(cart);
  const input = { items: [{ upc, quantity: 2 }], csrfToken };
  await assert.rejects(cart.add(request, response(), input), { code: 'cart_write_outcome_unknown' });
  time += 60_000;
  const status = cart.status(request, response());
  assert.equal(status.connected, false);
  assert.equal(status.status, 'write_outcome_unknown');
  assert.equal(status.csrfToken, csrfToken);
  await assert.rejects(cart.add(request, response(), input), { code: 'cart_write_outcome_unknown', status: 409 });
  assert.equal(writes, 1);
  cart.disconnect(request, response(), { csrfToken });
  assert.equal(cart.status(request, response()).status, 'authorization_required');
});

test('an in-flight add excludes another write, reconnect and disconnect; pre-send cancellation sends nothing', async t => {
  let finish; let writes = 0;
  const cart = new CartSessions({ config, fetchImpl: async url => {
    if (url.endsWith('/token')) return tokenResponse();
    writes++;
    return new Promise(resolve => { finish = () => resolve(new Response(null, { status: 204 })); });
  } }); t.after(() => cart.close());
  const { request, csrfToken } = await connected(cart);
  const input = { items: [{ upc, quantity: 1 }], csrfToken };
  await assert.rejects(cart.add(request, response(), input, { signal: AbortSignal.abort() }), { code: 'cart_cancelled' });
  assert.equal(writes, 0);
  const addition = cart.add(request, response(), input);
  try {
    await assert.rejects(cart.add(request, response(), input), { code: 'cart_write_outcome_unknown' });
    assert.throws(() => cart.connect(request, response()), { code: 'cart_busy' });
    assert.throws(() => cart.disconnect(request, response(), { csrfToken }), { code: 'cart_busy' });
    assert.equal(writes, 1);
  } finally { finish(); }
  assert.equal((await addition).acknowledged, true);
  assert.equal(cart.status(request, response()).status, 'connected');
});
