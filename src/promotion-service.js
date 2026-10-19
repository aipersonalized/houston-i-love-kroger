import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DEFAULT_PROMOTION_MAX_AGE_SECONDS, HistoryError } from './history-store.js';

const SEARCH_FIELDS = ['locationId', 'term', 'productId', 'itemId', 'observedFrom', 'observedTo', 'limit', 'cursor'];
const RETRIEVE_FIELDS = ['locationId', 'observationId'];
const COMPARE_FIELDS = ['locationId', 'offers'];
const LATEST_FIELDS = ['locationId', 'topic', 'limit', 'cursor'];
const PRICE_FIELDS = ['locationId', 'topic', 'productId', 'itemId', 'limit', 'cursor'];
const ESTIMATE_FIELDS = ['locationId', 'items'];

class RequestError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) ||
      typeof value.locationId !== 'string' || !/^[a-zA-Z0-9]{8}$/u.test(value.locationId)) {
    throw new RequestError('invalid_request', 'Use an exact selected locationId and the documented request fields.');
  }
  return value;
}
function send(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(payload);
}
function safeError(error) {
  if (error instanceof RequestError) return { status: error.status, error: { code: error.code, message: error.message } };
  if (error instanceof HistoryError && error.code === 'history_input_invalid') {
    return { status: 400, error: { code: 'invalid_request', message: 'Check the documented fields, bounds and cursor, then try again.' } };
  }
  return { status: 503, error: { code: 'promotion_service_unavailable', message: 'Promotion storage could not be read. Ask the operator to check the private service.' } };
}
function requestBody(request, { maxBodyBytes, requestTimeoutMs }) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
      (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')) {
    return Promise.reject(new RequestError('invalid_content_type', 'Send an uncompressed application/json body.', 415));
  }
  if (Number(request.headers['content-length']) > maxBodyBytes) {
    return Promise.reject(new RequestError('request_too_large', 'The request exceeds the documented body limit.', 413));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onError);
    };
    const fail = error => { cleanup(); request.pause(); reject(error); };
    const onData = chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) fail(new RequestError('request_too_large', 'The request exceeds the documented body limit.', 413));
      else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(new RequestError('invalid_json', 'Send a complete, valid JSON object.')); }
    };
    const onError = () => fail(new RequestError('invalid_request', 'The request body could not be read.'));
    const timer = setTimeout(() => fail(new RequestError('request_timeout', 'The request body took too long. Try again later.', 408)), requestTimeoutMs);
    timer.unref();
    request.on('data', onData); request.on('end', onEnd); request.on('error', onError); request.on('aborted', onError);
  });
}

// The token is installation-owned and never included in a response or log.
export function createPromotionService({ store, token, sourceId = 'kroger-public', now = () => new Date().toISOString(),
  maxAgeSeconds = DEFAULT_PROMOTION_MAX_AGE_SECONDS,
  maxBodyBytes = 1_048_576, requestTimeoutMs = 5000, maxActive = 8, maxRequestsPerMinute = 120 } = {}) {
  if (typeof token !== 'string' || !/^[\x21-\x7e]{32,512}$/u.test(token)) {
    throw new Error('Configure a private promotion service token of 32–512 printable characters without spaces.');
  }
  if (!store || !['searchPromotions', 'retrievePromotion', 'getComparisons', 'getPromotionStatus', 'getLatestDeals', 'searchPrices', 'estimateBasket'].every(key => typeof store[key] === 'function') ||
      typeof now !== 'function' || !/^[a-z][a-z0-9-]{0,79}$/u.test(sourceId) ||
      !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 604_800 ||
      !Number.isInteger(maxBodyBytes) || maxBodyBytes < 64 || maxBodyBytes > 1_048_576 ||
      !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 20 || requestTimeoutMs > 30_000 ||
      !Number.isInteger(maxActive) || maxActive < 1 || maxActive > 32 ||
      !Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute < 1 || maxRequestsPerMinute > 10_000) {
    throw new Error('Promotion service configuration is invalid.');
  }
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  let active = 0;
  let windowStarted = Date.now();
  let requests = 0;
  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    let admitted = false;
    try {
      if (request.method === 'GET' && (request.headers['transfer-encoding'] || Number(request.headers['content-length']) > 0)) {
        throw new RequestError('invalid_request', 'GET operations do not accept a body.');
      }
      // Liveness reveals no permission, source, file, row count or request data.
      if (request.method === 'GET' && request.url === '/healthz') return send(response, 200, { ok: true });
      const authorizations = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'authorization').length;
      const supplied = createHash('sha256').update(typeof request.headers.authorization === 'string' ? request.headers.authorization : '').digest();
      if (!timingSafeEqual(expected, supplied) || authorizations !== 1) {
        throw new RequestError('authentication_required', 'Private service authentication is required.', 401);
      }
      const time = Date.now();
      if (time - windowStarted >= 60_000) { windowStarted = time; requests = 0; }
      if (++requests > maxRequestsPerMinute || active >= maxActive) {
        response.setHeader('Retry-After', '60');
        throw new RequestError('service_busy', 'The private service is busy. Try again later.', 429);
      }
      active++; admitted = true;
      if (request.url === '/v1/status') {
        if (request.method !== 'GET') throw new RequestError('method_not_allowed', 'Use GET for service status.', 405);
        return send(response, 200, await store.getPromotionStatus({ sourceId, asOf: now() }));
      }
      const routes = new Map([
        ['/v1/promotions/search', [SEARCH_FIELDS, 'searchPromotions']],
        ['/v1/promotions/retrieve', [RETRIEVE_FIELDS, 'retrievePromotion']],
        ['/v1/history/compare', [COMPARE_FIELDS, 'getComparisons']],
        ['/v1/deals/search', [LATEST_FIELDS, 'getLatestDeals']],
        ['/v1/prices/search', [PRICE_FIELDS, 'searchPrices']],
        ['/v1/basket/estimate', [ESTIMATE_FIELDS, 'estimateBasket']],
      ]);
      const route = routes.get(request.url);
      if (!route) throw new RequestError('not_found', 'This service operation does not exist.', 404);
      if (request.method !== 'POST') throw new RequestError('method_not_allowed', 'Use POST with a JSON object for this operation.', 405);
      const body = fields(await requestBody(request, { maxBodyBytes, requestTimeoutMs }), route[0]);
      if (route[1] === 'getComparisons' && (!Array.isArray(body.offers) || body.offers.length > 500)) {
        throw new RequestError('invalid_request', 'Supply at most 500 current offers for comparison.');
      }
      const result = await store[route[1]]({ ...body, sourceId, asOf: now(),
        ...(['getLatestDeals', 'searchPrices', 'estimateBasket'].includes(route[1]) ? { maxAgeSeconds } : {}) });
      send(response, 200, result);
    } catch (error) {
      const failure = safeError(error);
      // Do not retain an unread attacker-controlled body on a keepalive socket.
      response.setHeader('Connection', 'close');
      send(response, failure.status, { error: failure.error });
    } finally {
      if (admitted) active--;
    }
  });
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.max(1000, requestTimeoutMs);
  server.keepAliveTimeout = 1000;
  server.setTimeout(requestTimeoutMs + 1000, socket => socket.destroy());
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => {
    if (!socket.writable) return socket.destroy();
    const body = JSON.stringify({ error: { code: 'invalid_request', message: 'Send a valid HTTP request.' } });
    socket.end(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
  return server;
}
