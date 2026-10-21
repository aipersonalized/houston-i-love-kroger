import { AppError, publicError } from './errors.js';
import { SHOPPING_GET_PATHS, SHOPPING_POST_PATHS, SHOPPING_SERVICE_ID } from './shopping-api.js';
import { requestJson, json } from './request-http.js';

// Public, read-only transport. The private database API is routed separately.
export function createShoppingHandler({ api, basePath = '/', publicOrigin = '', port,
  now = Date.now, maxRequestsPerMinute = 30, maxActive = 4, timeoutMs = 35_000 }) {
  if (!api || typeof api.execute !== 'function' || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/u.test(basePath) ||
      typeof port !== 'function' || !Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute < 1 ||
      !Number.isInteger(maxActive) || maxActive < 1 || !Number.isInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 35_000) {
    throw new Error('Check the public shopping service configuration.');
  }
  if (publicOrigin) {
    const origin = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== publicOrigin) {
      throw new Error('Check the public shopping service origin.');
    }
  }
  let windowStarted = null;
  let requests = 0;
  let active = 0;
  return async function handle(request, response) {
    response.setHeader('X-Houston-Service', SHOPPING_SERVICE_ID.name);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), timeoutMs);
    deadline.unref();
    const onClose = () => { if (!response.writableEnded) abort.abort(); };
    response.on('close', onClose);
    let admitted = false;
    try {
      const allowedHosts = new Set([`127.0.0.1:${port()}`, `localhost:${port()}`, `[::1]:${port()}`]);
      if (publicOrigin) allowedHosts.add(new URL(publicOrigin).host);
      if (!allowedHosts.has(request.headers.host)) throw new AppError('invalid_host', 'Use this service’s configured address.', 403);
      const url = new URL(request.url, 'http://local.invalid');
      if (!url.pathname.startsWith(basePath)) throw new AppError('not_found', 'This operation does not exist.', 404);
      const path = url.pathname.slice(basePath.length);
      if (!SHOPPING_GET_PATHS.has(path) && !SHOPPING_POST_PATHS.has(path)) throw new AppError('not_found', 'This operation does not exist.', 404);
      const method = SHOPPING_GET_PATHS.has(path) ? 'GET' : 'POST';
      if (request.method !== method) {
        response.setHeader('Allow', method);
        throw new AppError('method_not_allowed', `Use ${method} for this operation.`, 405);
      }
      if (url.search) throw new AppError('query_not_allowed', 'Put search details in the JSON body, not the URL.');
      if (method === 'GET' && (request.headers['transfer-encoding'] || Number(request.headers['content-length']) > 0)) {
        throw new AppError('invalid_request', 'GET operations do not accept a body.');
      }
      const origin = request.headers.origin;
      if (origin && origin !== (publicOrigin || `http://${request.headers.host}`)) {
        throw new AppError('origin_not_allowed', 'Use the configured service origin.', 403);
      }
      const time = now();
      if (windowStarted === null || time - windowStarted >= 60_000) { windowStarted = time; requests = 0; }
      if (requests >= maxRequestsPerMinute || active >= maxActive) {
        throw new AppError('busy', 'This installation is busy. Wait a moment before searching again.', 429, { retryAfter: 60 });
      }
      requests++; active++; admitted = true;
      const body = method === 'POST' ? await requestJson(request, abort.signal) : undefined;
      // Bound even providers that fail to observe cancellation. Native supplier
      // reads also receive this signal; no timeout starts a fallback or retry.
      let onAbort;
      const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(new AppError('request_timeout', 'The search took too long. Try again later.', 408));
        abort.signal.addEventListener('abort', onAbort, { once: true });
        if (abort.signal.aborted) onAbort();
      });
      try { json(response, 200, await Promise.race([api.execute(path, body, { signal: abort.signal }), cancelled])); }
      finally { abort.signal.removeEventListener('abort', onAbort); }
    } catch (error) {
      const failure = publicError(error);
      if (failure.retryAfter) response.setHeader('Retry-After', String(failure.retryAfter));
      if (!request.complete) response.setHeader('Connection', 'close');
      json(response, failure.status, { ok: false, error: { code: failure.code, message: failure.message } });
    } finally {
      clearTimeout(deadline);
      response.off('close', onClose);
      if (admitted) active--;
    }
  };
}
