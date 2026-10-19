import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import { readJsonResponse } from './kroger.js';

const ORIGIN = 'https://api.kroger.com';
const SCOPE = 'cart.basic:write';
const SESSION_MS = 30 * 60_000;
const AUTH_MS = 10 * 60_000;
const COOKIE = 'kroger_visit';
const opaque = () => randomBytes(32).toString('base64url');
const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, status = 400) => new AppError(code, message, status);
async function discard(response) { try { await response.body?.cancel(); } catch { /* Already closed. */ } }

export function validateCartItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw failure('invalid_cart_items', 'Choose between 1 and 50 exact products to add.');
  }
  const seen = new Set();
  return value.map(item => {
    if (!record(item) || Object.keys(item).some(key => !['upc', 'quantity', 'modality'].includes(key)) ||
        typeof item.upc !== 'string' || !/^\d{13}$/.test(item.upc) ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 ||
        item.modality !== undefined && !['PICKUP', 'DELIVERY'].includes(item.modality)) {
      throw failure('invalid_cart_items', 'Use an exact 13-digit UPC, a whole quantity from 1 to 99, and optional PICKUP or DELIVERY modality.');
    }
    const key = `${item.upc}:${item.modality ?? 'PICKUP'}`;
    if (seen.has(key)) throw failure('invalid_cart_items', 'Combine duplicate UPC and modality entries before adding.');
    seen.add(key);
    return { upc: item.upc, quantity: item.quantity, ...(item.modality ? { modality: item.modality } : {}) };
  });
}

// No customer identity, activity archive or durable session store. Refresh
// tokens are deliberately discarded; expiry asks the shopper to reconnect.
export class CartSessions {
  #config;
  #fetch;
  #now;
  #sessions = new Map();
  #cleanup;
  constructor({ config, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#cleanup = setInterval(() => this.#prune(), 60_000);
    this.#cleanup.unref();
  }
  get configured() {
    const c = this.#config;
    return Boolean(c.cartEnabled && c.cartGranted && c.cartRedirectUri && c.clientId && c.clientSecret &&
      c.environment === 'production' && c.publicOrigin?.startsWith('https://'));
  }
  readiness() {
    return { enabled: this.#config.cartEnabled === true, configured: this.configured, connected: false,
      status: !this.#config.cartEnabled ? 'disabled' : this.configured ? 'authorization_required' : 'setup_required' };
  }
  #prune() {
    for (const [id, session] of this.#sessions) if (session.expiresAt <= this.#now()) this.#sessions.delete(id);
  }
  #cookie(response, value = '') {
    response.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=${this.#config.basePath}; HttpOnly; Secure; SameSite=Lax${value ? '' : '; Max-Age=0'}`);
  }
  #session(request, response, create = false) {
    this.#prune();
    const cookie = typeof request.headers.cookie === 'string' && request.headers.cookie.length <= 4096
      ? request.headers.cookie.split(';').map(item => item.trim()).filter(item => item.startsWith(`${COOKIE}=`)) : [];
    const id = cookie.length === 1 ? cookie[0].slice(COOKIE.length + 1) : '';
    let session = /^[\w-]{43}$/.test(id) ? this.#sessions.get(id) : null;
    if (!session && create) {
      if (this.#sessions.size >= 200) throw failure('cart_busy', 'Cart connection capacity is full. Try again later.', 429);
      session = { id: opaque(), csrfToken: opaque(), expiresAt: this.#now() + SESSION_MS,
        status: 'authorization_required', accessToken: '', tokenExpiresAt: 0, pending: null, busy: false };
      this.#sessions.set(session.id, session);
      this.#cookie(response, session.id);
    }
    return session;
  }
  #view(session) {
    if (session?.pending && session.pending.expiresAt <= this.#now()) {
      session.pending = null;
      session.status = 'authorization_failed';
    }
    if (session?.accessToken && session.tokenExpiresAt <= this.#now()) {
      session.accessToken = '';
      // Token expiry says nothing about whether a previously sent add landed.
      // Keep that outcome until this visit is explicitly disconnected or ends.
      if (session.status !== 'write_outcome_unknown') session.status = 'authorization_required';
    }
    return { ...this.readiness(), connected: Boolean(session?.accessToken),
      ...(session ? { status: session.status, csrfToken: session.csrfToken } : {}) };
  }
  status(request, response) {
    return this.#view(this.configured ? this.#session(request, response, true) : null);
  }
  #requireSetup() {
    if (!this.configured) throw failure('cart_setup_required', 'Cart is unavailable until the operator enables its granted Cart scope and registered HTTPS callback.', 503);
  }
  #csrf(session, value) {
    if (!session || !same(session.csrfToken, value)) throw failure('cart_session_required', 'Open this app and reconnect your cart before trying this action.', 403);
  }
  connect(request, response) {
    this.#requireSetup();
    const previous = this.#session(request, response);
    if (previous?.busy) throw failure('cart_busy', 'Wait for the current cart action to finish.', 409);
    if (previous) this.#sessions.delete(previous.id);
    // Rotate visit identity whenever a new authorization starts.
    const session = this.#session({ headers: {} }, response, true);
    session.pending = { state: opaque(), verifier: opaque(), expiresAt: this.#now() + AUTH_MS };
    const authorization = new URL('/v1/connect/oauth2/authorize', ORIGIN);
    authorization.search = new URLSearchParams({ scope: SCOPE, response_type: 'code',
      client_id: this.#config.clientId, redirect_uri: this.#config.cartRedirectUri,
      state: session.pending.state,
      code_challenge: createHash('sha256').update(session.pending.verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return { authorizationUrl: authorization.href, cart: this.#view(session) };
  }
  async callback(request, response, parameters, { signal } = {}) {
    this.#requireSetup();
    const session = this.#session(request, response);
    const allowed = new Set(['state', 'code', 'error', 'error_description', 'error_uri']);
    if (!session?.pending || [...parameters.keys()].some(key => !allowed.has(key) || parameters.getAll(key).length !== 1) ||
        !same(session.pending.state, parameters.get('state')) || session.pending.expiresAt <= this.#now()) {
      throw failure('cart_state_invalid', 'This cart connection expired or could not be verified. Start a new connection.', 403);
    }
    const pending = session.pending;
    session.pending = null; // Codes and state are single-use, including failures.
    session.status = 'authorization_failed';
    const code = parameters.get('code');
    if (parameters.has('error')) return;
    if (typeof code !== 'string' || !code || code.length > 4096 || /[\p{Cc}\p{Cf}\s]/u.test(code)) {
      throw failure('cart_authorization_failed', 'Kroger did not return a usable authorization. Start a new connection.', 403);
    }
    const deadline = AbortSignal.timeout(10_000);
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    try {
      const result = await this.#fetch(`${ORIGIN}/v1/connect/oauth2/token`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: combined,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.#config.clientId}:${this.#config.clientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: pending.verifier,
          redirect_uri: this.#config.cartRedirectUri }).toString(),
      });
      if (result.status !== 200) { await discard(result); throw new Error(); }
      const token = await readJsonResponse(result, 16_384, { signal: combined });
      if (!record(token) || typeof token.access_token !== 'string' ||
          !/^[A-Za-z0-9\-._~+/]+=*$/.test(token.access_token) || token.access_token.length > 8192 ||
          token.token_type?.toLowerCase() !== 'bearer' || typeof token.expires_in !== 'number' ||
          !Number.isFinite(token.expires_in) || token.expires_in <= 0 ||
          token.scope != null && (typeof token.scope !== 'string' || !token.scope.split(' ').includes(SCOPE))) throw new Error();
      if (this.#sessions.get(session.id) !== session || session.expiresAt <= this.#now()) throw new Error();
      session.accessToken = token.access_token;
      session.tokenExpiresAt = Math.min(session.expiresAt, this.#now() + Math.min(token.expires_in * 1000, SESSION_MS) - 1000);
      session.status = 'connected';
    } catch {
      throw failure('cart_authorization_failed', 'Cart authorization did not finish. Start a new connection; no cart items were added.', 503);
    }
  }
  async add(request, response, input, { signal } = {}) {
    this.#requireSetup();
    if (!record(input) || Object.keys(input).some(key => !['items', 'csrfToken'].includes(key))) throw failure('invalid_cart_items', 'Use only items and csrfToken for a cart action.');
    const items = validateCartItems(input.items);
    const session = this.#session(request, response);
    this.#csrf(session, input.csrfToken);
    const view = this.#view(session);
    if (view.status === 'write_outcome_unknown') throw failure('cart_write_outcome_unknown', 'Check your Kroger cart before reconnecting. The previous addition may have succeeded.', 409);
    if (!view.connected) throw failure('cart_authorization_required', 'Connect to Kroger before adding items.', 401);
    if (session.busy) throw failure('cart_busy', 'Wait for the current cart action to finish.', 409);
    if (signal?.aborted) throw failure('cart_cancelled', 'The action was cancelled before any cart request was sent.', 408);
    session.busy = true;
    session.status = 'write_outcome_unknown';
    const deadline = AbortSignal.timeout(10_000);
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    try {
      const result = await this.#fetch(`${ORIGIN}/v1/cart/add`, { method: 'PUT', redirect: 'error', cache: 'no-store', signal: combined,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ items }) });
      await discard(result); // 204 has no JSON document.
      if (result.status === 204) {
        session.status = 'connected';
        return { acknowledged: true, cart: this.#view(session),
          message: 'Kroger acknowledged the addition. Verify items, fulfillment store, prices and availability in your Kroger cart before checkout.' };
      }
      if ([400, 401, 403, 404, 429].includes(result.status)) {
        session.status = 'connected';
        if (result.status === 401) { session.accessToken = ''; session.status = 'authorization_required'; }
        throw failure(result.status === 401 ? 'cart_authorization_required' : 'cart_rejected',
          result.status === 401 ? 'Your cart authorization expired. Connect again.' : 'Kroger rejected this cart request. Check the items and Cart permissions before trying again.', result.status === 401 ? 401 : 503);
      }
      throw new Error();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw failure('cart_write_outcome_unknown', 'The cart result is unknown. Check your Kroger cart before adding these items again.', 502);
    } finally { session.busy = false; }
  }
  disconnect(request, response, input) {
    const session = this.#session(request, response);
    if (!record(input) || Object.keys(input).some(key => key !== 'csrfToken')) throw failure('invalid_request', 'Use only csrfToken for disconnect.');
    this.#csrf(session, input.csrfToken);
    if (session.busy) throw failure('cart_busy', 'Wait for the current cart action to finish.', 409);
    this.#sessions.delete(session.id);
    this.#cookie(response);
    return this.readiness();
  }
  close() { clearInterval(this.#cleanup); this.#sessions.clear(); }
}
