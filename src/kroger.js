import { AppError } from './errors.js';
import { normalizeStore } from './catalog.js';

const ORIGINS = Object.freeze({
  production: 'https://api.kroger.com',
  certification: 'https://api-ce.kroger.com',
});
const DAY_MS = 86_400_000;

function cancelled() { return new AppError('request_cancelled', 'The search was cancelled.', 499); }
function unavailable() { return new AppError('upstream_unavailable', 'Kroger did not respond in time. Try again shortly.', 502); }
function formatError() { return new AppError('upstream_format', 'Kroger returned an unsupported response. Try again later.', 502); }

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch { /* The response is already closed or failed. */ }
}

// Cancellation includes the response body, not just arrival of the headers.
export async function readJsonResponse(response, maxBytes = 2_000_000, { signal } = {}) {
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mime !== 'application/json') {
    await cancelBody(response);
    throw formatError();
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await cancelBody(response);
    throw new AppError('upstream_size', 'The search response was too large. Try a more specific search.', 502);
  }
  if (!response.body) throw formatError();
  const reader = response.body.getReader();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maxBytes) throw new AppError('upstream_size', 'The search response was too large. Try a more specific search.', 502);
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { throw formatError(); }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export class KrogerClient {
  #clientId;
  #clientSecret;
  #accessToken = '';
  #expiresAt = 0;
  #tokenPending = null;
  #fetch;
  #now;
  #budgetStarted = null;
  #requestCount = 0;
  #maxRequests;
  #timeoutMs;

  constructor({ clientId = '', clientSecret = '', environment = 'production',
    fetchImpl = globalThis.fetch, now = Date.now, maxRequests = 1000, timeoutMs = 10_000 } = {}) {
    if (!Object.hasOwn(ORIGINS, environment)) throw new Error('Choose production or certification.');
    if (typeof clientId !== 'string' || typeof clientSecret !== 'string' ||
        clientId.length > 4096 || clientSecret.length > 4096 || /[\r\n:]/.test(clientId) || /[\r\n]/.test(clientSecret)) {
      throw new Error('The API credential settings have an unsupported format. Check private configuration.');
    }
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000 ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new Error('Use a request budget from 1 to 1000 and a timeout from 1 to 30000 milliseconds.');
    }
    this.environment = environment;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#maxRequests = maxRequests;
    this.#timeoutMs = timeoutMs;
  }

  get configured() { return Boolean(this.#clientId && this.#clientSecret); }

  #admit() {
    const now = this.#now();
    if (this.#budgetStarted === null || now - this.#budgetStarted >= DAY_MS) {
      this.#budgetStarted = now;
      this.#requestCount = 0;
    }
    if (this.#requestCount >= this.#maxRequests) {
      throw new AppError('budget_reached', 'This installation has reached its local request budget. Try again later.', 429,
        { retryAfter: Math.max(1, Math.ceil((DAY_MS - now + this.#budgetStarted) / 1000)) });
    }
    this.#requestCount++;
  }

  async #http(path, options, signal, maxBytes = 2_000_000) {
    if (signal?.aborted) throw cancelled();
    this.#admit(); // Every actual HTTP attempt, including tokens and failures.
    const deadline = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
    try {
      const response = await this.#fetch(`${ORIGINS[this.environment]}${path}`, {
        ...options, redirect: 'error', cache: 'no-store', signal: combined,
      });
      if (!response.ok) {
        await cancelBody(response);
        return { status: response.status, data: null };
      }
      return { status: response.status, data: await readJsonResponse(response, maxBytes, { signal: combined }) };
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
  }

  async #token(signal) {
    if (signal?.aborted) throw cancelled();
    if (!this.configured) {
      throw new AppError('setup_required', 'This installation needs a Kroger API connection. Ask its operator to finish setup.', 503);
    }
    if (this.#accessToken && this.#now() < this.#expiresAt) return this.#accessToken;
    if (!this.#tokenPending) {
      // A single shopper cancellation must not invalidate another caller's
      // shared authorization. The token request has its own short deadline.
      this.#tokenPending = this.#newToken().finally(() => { this.#tokenPending = null; });
    }
    return waitFor(this.#tokenPending, signal);
  }

  async #newToken() {
    const { status, data } = await this.#http('/v1/connect/oauth2/token', {
      method: 'POST', headers: {
        Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString('base64')}`,
      }, body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'product.compact' }).toString(),
    }, undefined, 16_384);
    if (status === 429) throw new AppError('provider_limit', 'Kroger has limited requests. Wait before searching again.', 429, { retryAfter: 60 });
    if (status !== 200) {
      throw new AppError('connection_rejected', 'The Kroger connection was rejected. Its operator should check credentials, environment and product scope.', 503);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        typeof data.access_token !== 'string' || !/^[A-Za-z0-9\-._~+/]+=*$/.test(data.access_token) ||
        data.access_token.length > 8192 || typeof data.expires_in !== 'number' ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer') throw formatError();
    this.#accessToken = data.access_token;
    const lifetime = Math.min(data.expires_in * 1000, DAY_MS);
    this.#expiresAt = this.#now() + lifetime - Math.min(30_000, lifetime / 10);
    return this.#accessToken;
  }

  async #get(path, query, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.#token(signal);
      const { status, data } = await this.#http(`${path}?${new URLSearchParams(query)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      }, signal);
      if (status === 401) {
        if (this.#accessToken === token) { this.#accessToken = ''; this.#expiresAt = 0; }
        if (attempt === 0) continue; // One renewal and one retry, for a safe read.
      }
      if (status !== 200) {
        if (status === 429) throw new AppError('provider_limit', 'Kroger has limited requests. Wait before searching again.', 429, { retryAfter: 60 });
        if ([401, 403].includes(status)) throw new AppError('permission_denied', 'Kroger did not allow this search. The operator should check API permissions.', 503);
        if (status === 400) throw new AppError('upstream_rejected', 'Kroger did not accept this search. Check the store and search term.', 502);
        if (status === 404) throw new AppError('upstream_not_found', 'Kroger could not find this store or product context. Choose a store again.', 502);
        throw unavailable();
      }
      return data;
    }
  }

  async searchStores(zipCode, { signal } = {}) {
    if (typeof zipCode !== 'string' || !/^\d{5}$/.test(zipCode)) throw new AppError('invalid_zip', 'Enter a five-digit US ZIP code.');
    const payload = await this.#get('/v1/locations', {
      'filter.zipCode.near': zipCode, 'filter.radiusInMiles': '10',
      'filter.limit': '10', 'filter.chain': 'Kroger',
    }, signal);
    if (!Array.isArray(payload?.data) || payload.data.length > 10) throw formatError();
    return payload.data.map(normalizeStore);
  }

  async searchProducts(locationId, term, { signal, limit = 50 } = {}) {
    if (typeof locationId !== 'string' || !/^[a-zA-Z0-9]{8}$/.test(locationId) ||
        typeof term !== 'string' || term.trim().length < 3 || term.length > 80 ||
        term.trim().split(/\s+/u).length > 8 || /[\p{Cc}\p{Cf}]/u.test(term) ||
        !Number.isInteger(limit) || limit < 1 || limit > 50) throw new AppError('invalid_search', 'Choose a store and a supported search term.');
    const payload = await this.#get('/v1/products', {
      'filter.locationId': locationId, 'filter.term': term,
      'filter.fulfillment': 'ais', 'filter.limit': String(limit),
    }, signal);
    if (!Array.isArray(payload?.data) || payload.data.length > limit) throw formatError();
    return payload.data;
  }
}
