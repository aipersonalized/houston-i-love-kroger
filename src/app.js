import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AppError, publicError } from './errors.js';
import { validateStoreSearch, validateDealSearch, compareOffers, SAMPLE_TOPICS, SAMPLE_QUERY_LIMIT, SEARCH_QUERY_LIMIT } from './deals.js';
import { historyAvailability } from './history.js';
import { orderOffers } from '../public/ordering.js';

const PUBLIC_FILES = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['ordering.js', ['ordering.js', 'text/javascript; charset=utf-8']],
  ['styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

async function requestJson(request, signal) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AppError('invalid_content_type', 'Send this search as JSON.', 415);
  }
  if (Number(request.headers['content-length']) > 4096) throw new AppError('request_too_large', 'Keep the search request under 4 KB.', 413);
  const chunks = await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      request.off('data', onData); request.off('end', onEnd); request.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = error => { cleanup(); request.pause(); reject(error); };
    const onData = chunk => {
      size += chunk.length;
      if (size > 4096) fail(new AppError('request_too_large', 'Keep the search request under 4 KB.', 413));
      else chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(chunks); };
    const onError = () => fail(new AppError('invalid_request', 'The request body could not be read. Send a complete JSON search body.'));
    const onAbort = () => fail(new AppError('request_timeout', 'The search took too long. Send the search again later.', 408));
    request.on('data', onData); request.on('end', onEnd); request.on('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('invalid_json', 'Send a valid JSON search request.'); }
}

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
}

function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readHistory(provider, args, environment) {
  if (environment !== 'production') {
    const unavailable = { status: 'unavailable', reason: 'history_environment_mismatch',
      message: 'Production price history is not used with certification responses.' };
    return { ...unavailable, histories: args.offers.map(() => ({ ...unavailable })) };
  }
  if (!provider) return { ...historyAvailability(), histories: args.offers.map(() => historyAvailability()) };
  try {
    const comparison = await provider(args);
    if (!comparison || typeof comparison.status !== 'string' ||
        !Array.isArray(comparison.histories) || comparison.histories.length !== args.offers.length ||
        comparison.histories.some(value => !value || typeof value.status !== 'string')) throw new Error('Unsupported history result.');
    const result = { status: comparison.status, histories: comparison.histories };
    for (const field of ['reason', 'message']) {
      if (typeof comparison[field] === 'string') result[field] = comparison[field];
    }
    return result;
  } catch {
    // Expose history failures without hiding current-price search results or
    // converting a failed lookup into a claim that no observations exist.
    const failure = { status: 'unavailable', reason: 'history_read_failed',
      message: 'Historical comparisons could not be read. Ask the operator to check the history source.' };
    return { ...failure, histories: args.offers.map(() => ({ ...failure })) };
  }
}

export async function createApp({ config, client, dataSource = 'kroger-api', now = Date.now,
  historyProvider }) {
  const assets = new Map();
  for (const [route, [file, mime]] of PUBLIC_FILES) {
    assets.set(route, { bytes: await readFile(new URL(`../public/${file}`, import.meta.url)), mime });
  }
  let active = 0;
  let windowStarted = null;
  let searches = 0;

  const server = createServer(async (request, response) => {
    securityHeaders(response);
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 35_000);
    deadline.unref();
    response.on('close', () => { if (!response.writableEnded) abort.abort(); });
    try {
      const port = server.address()?.port ?? config.port;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
      if (config.publicOrigin) allowedHosts.add(new URL(config.publicOrigin).host);
      const host = request.headers.host;
      if (!allowedHosts.has(host)) throw new AppError('invalid_host', 'Use this installation’s configured address.', 403);
      const url = new URL(request.url, 'http://local.invalid');
      if (url.pathname === '/' && config.basePath !== '/' ||
          config.basePath !== '/' && url.pathname === config.basePath.slice(0, -1)) {
        response.writeHead(308, { Location: config.basePath }); response.end(); return;
      }
      if (!url.pathname.startsWith(config.basePath)) throw new AppError('not_found', 'This page does not exist.', 404);
      const path = url.pathname.slice(config.basePath.length);
      if (request.method === 'GET' && assets.has(path)) {
        const asset = assets.get(path);
        response.writeHead(200, { 'Content-Type': asset.mime }); response.end(asset.bytes); return;
      }
      if (path === 'api/v1/status' && request.method === 'GET' && !url.search) {
        const { histories, ...history } = await readHistory(historyProvider, {
          locationId: null, offers: [], asOf: new Date(now()).toISOString(),
        }, client.environment);
        json(response, 200, { ok: true, apiVersion: 1, configured: client.configured,
          environment: client.environment, dataSource, history }); return;
      }
      if (!['api/v1/stores/search', 'api/v1/deals/search'].includes(path)) throw new AppError('not_found', 'This operation does not exist.', 404);
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new AppError('method_not_allowed', 'Use POST with a JSON search body.', 405);
      }
      if (url.search) throw new AppError('query_not_allowed', 'Put search details in the JSON body, not the URL.');
      const origin = request.headers.origin;
      const expectedOrigin = config.publicOrigin || `http://${host}`;
      if (origin && origin !== expectedOrigin) throw new AppError('origin_not_allowed', 'Open this app directly to search.', 403);
      // Origin-less requests support local/native/agent HTTP clients. Origin is
      // a browser CSRF control, not authentication. This is a public read app.
      const time = now();
      if (windowStarted === null || time - windowStarted >= 60_000) { searches = 0; windowStarted = time; }
      if (searches >= 30 || active >= 4) throw new AppError('busy', 'This installation is busy. Wait a moment before searching again.', 429, { retryAfter: 60 });
      searches++;
      active++;
      try {
        const body = await requestJson(request, abort.signal);
        const input = path.endsWith('/stores/search') ? validateStoreSearch(body) : validateDealSearch(body);
        if (!client.configured) throw new AppError('setup_required', 'This installation needs a Kroger API connection. Ask its operator to finish setup.', 503);
        if (path.endsWith('/stores/search')) {
          const stores = await client.searchStores(input.zipCode, { signal: abort.signal });
          json(response, 200, { ok: true, apiVersion: 1, stores, radiusInMiles: 10,
            limit: 10, dataSource, retrievedAt: new Date(now()).toISOString() });
        } else {
          const topics = input.term === null ? [...SAMPLE_TOPICS] : [input.term];
          const perQueryLimit = input.term === null ? SAMPLE_QUERY_LIMIT : SEARCH_QUERY_LIMIT;
          const products = [];
          const queries = [];
          // No pagination, catalog crawl, result cache or durable search history.
          for (const term of topics) {
            const found = await client.searchProducts(input.locationId, term, { signal: abort.signal, limit: perQueryLimit });
            if (!Array.isArray(found) || found.length > perQueryLimit) throw new AppError('upstream_format', 'Kroger returned an unsupported result. Try again later.', 502);
            products.push(...found);
            queries.push({ term, returnedProducts: found.length });
          }
          const result = compareOffers(products, { now: now() });
          const retrievedAt = new Date(now()).toISOString();
          const { histories, ...history } = await readHistory(historyProvider, {
            locationId: input.locationId, offers: result.offers, asOf: retrievedAt,
          }, client.environment);
          result.offers.forEach((offer, index) => { offer.history = histories[index]; });
          json(response, 200, { ok: true, apiVersion: 1,
            scope: { locationId: input.locationId, mode: input.term === null ? 'sample' : 'search',
              term: input.term, topics, queries, sort: input.sort,
              productLimit: topics.length * perQueryLimit, perQueryLimit, fulfillment: 'ais', exhaustive: false,
              coverage: input.term === null
                ? 'A bounded sample of up to 15 products each for milk, bread and eggs. This does not cover all store promotions.'
                : 'Up to 50 products matching this search. This does not cover all matching products or all store promotions.' },
            offers: orderOffers(result.offers, input.sort), summary: result.summary,
            history, dataSource, retrievedAt });
        }
      } finally { active--; }
    } catch (error) {
      const safe = publicError(error);
      if (safe.retryAfter) response.setHeader('Retry-After', String(safe.retryAfter));
      // Close a rejected/unfinished upload after its fixed error response. An
      // async-iterator throw would destroy the socket before that response.
      if (!request.complete) response.setHeader('Connection', 'close');
      json(response, safe.status, { ok: false, error: { code: safe.code, message: safe.message } });
    } finally {
      clearTimeout(deadline);
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}
