import { AppError } from './errors.js';
import { SHOPPING_GET_PATHS, SHOPPING_POST_PATHS, SHOPPING_SERVICE_ID } from './shopping-api.js';

export function shoppingServiceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('SHOPPING_SERVICE_URL must be an http(s) service base URL ending with /.'); }
  if (!['http:', 'https:'].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/u.test(url.pathname)) {
    throw new Error('SHOPPING_SERVICE_URL must be an http(s) service base URL ending with /.');
  }
  return url;
}

// No credentials, cookies, redirects, cache, retries or supplier fallback.
export function createShoppingClient({ url, timeoutMs = 30_000, maxResponseBytes = 8_388_608, fetchImpl = globalThis.fetch } = {}) {
  const base = shoppingServiceUrl(url);
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 30_000 ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 64 || maxResponseBytes > 8_388_608) throw new Error('Check the shopping service client bounds.');
  const unavailable = () => new AppError('shopping_service_unavailable', 'The shared shopping service could not be read. Try again later.', 503);
  return { async execute(path, body, { signal } = {}) {
    if (!SHOPPING_GET_PATHS.has(path) && !SHOPPING_POST_PATHS.has(path)) throw new AppError('not_found', 'This operation does not exist.', 404);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    let reader;
    let timer;
    const work = async () => {
      const get = SHOPPING_GET_PATHS.has(path);
      const response = await fetchImpl(new URL(path, base), { method: get ? 'GET' : 'POST',
        headers: get ? {} : { 'Content-Type': 'application/json' },
        ...(get ? {} : { body: JSON.stringify(body) }), signal: controller.signal, redirect: 'error', credentials: 'omit' });
      if (controller.signal.aborted || response.headers.get('x-houston-service') !== SHOPPING_SERVICE_ID.name ||
          response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
          Number(response.headers.get('content-length')) > maxResponseBytes || !response.body) {
        void response.body?.cancel().catch(() => {}); throw unavailable();
      }
      reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxResponseBytes) throw unavailable();
        chunks.push(Buffer.from(value));
      }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
      if (!response.ok) {
        if (value.ok !== false || !value.error || typeof value.error.code !== 'string' ||
            !/^[a-z][a-z0-9_]{0,79}$/u.test(value.error.code) || typeof value.error.message !== 'string' || value.error.message.length > 512 ||
            ![400, 403, 404, 405, 408, 413, 415, 429, 499, 500, 502, 503].includes(response.status)) throw unavailable();
        const retry = response.headers.get('retry-after');
        throw new AppError(value.error.code, value.error.message, response.status,
          retry && /^\d{1,6}$/u.test(retry) ? { retryAfter: Number(retry) } : {});
      }
      if (value.ok !== true || value.apiVersion !== 1 || path === 'api/v1/status' &&
          (value.service?.name !== SHOPPING_SERVICE_ID.name || value.service?.apiVersion !== 1 ||
           typeof value.configured !== 'boolean' || !['production', 'certification'].includes(value.environment))) throw unavailable();
      return value;
    };
    let onCancel;
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        onCancel = () => reject(unavailable());
        controller.signal.addEventListener('abort', onCancel, { once: true });
        timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref();
        if (controller.signal.aborted) onCancel();
      })]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controller.signal.removeEventListener('abort', onCancel);
      controller.abort();
      void reader?.cancel().catch(() => {});
    }
  } };
}
