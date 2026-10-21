import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AppError, publicError } from './errors.js';
import { IMAGE_HOSTS } from './catalog.js';
import { CartSessions } from './cart.js';
import { createShoppingApi, SHOPPING_POST_PATHS } from './shopping-api.js';
import { requestJson, json } from './request-http.js';

const PUBLIC_FILES = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['ordering.js', ['ordering.js', 'text/javascript; charset=utf-8']],
  ['catalog.js', ['catalog.js', 'text/javascript; charset=utf-8']],
  ['basket.js', ['basket.js', 'text/javascript; charset=utf-8']],
  ['styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src ${IMAGE_HOSTS.map(host => `https://${host}`).join(' ')}; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`);
}

export async function createApp({ config, client, dataSource = 'kroger-api', now = Date.now,
  historyProvider, promotionProvider, cartSessions, shoppingProvider }) {
  const assets = new Map();
  for (const [route, [file, mime]] of PUBLIC_FILES) {
    assets.set(route, { bytes: await readFile(new URL(`../public/${file}`, import.meta.url)), mime });
  }
  let active = 0;
  let windowStarted = null;
  let searches = 0;
  const cart = cartSessions ?? new CartSessions({ config, now });
  const shopping = shoppingProvider ?? createShoppingApi({ client, dataSource, now, historyProvider, promotionProvider });
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
        const { service, ...status } = await shopping.execute(path, undefined, { signal: abort.signal });
        json(response, 200, { ...status, capabilities: { ...status.capabilities, cart: cart.readiness().configured }, cart: cart.readiness() }); return;
      }
      if (path === 'api/v1/cart/status' && request.method === 'GET' && !url.search) {
        json(response, 200, { ok: true, cart: cart.status(request, response) }); return;
      }
      if (path === 'api/v1/promotions/status' && request.method === 'GET' && !url.search) {
        json(response, 200, await shopping.execute(path, undefined, { signal: abort.signal })); return;
      }
      if (path === 'api/v1/cart/callback' && request.method === 'GET') {
        // Callback codes/state are only consumed here and never reflected into
        // HTML, JSON, logs or a redirect target. A fixed redirect clears them.
        if (request.url.length > 8192) throw new AppError('invalid_request', 'The callback request is too large.');
        try { await cart.callback(request, response, url.searchParams, { signal: abort.signal }); }
        catch (error) { if (error.code === 'cart_setup_required') throw error; }
        response.writeHead(303, { Location: config.basePath }); response.end(); return;
      }
      if (!SHOPPING_POST_PATHS.has(path) && !['api/v1/cart/connect', 'api/v1/cart/add', 'api/v1/cart/disconnect'].includes(path)) throw new AppError('not_found', 'This operation does not exist.', 404);
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new AppError('method_not_allowed', 'Use POST with a JSON search body.', 405);
      }
      if (url.search) throw new AppError('query_not_allowed', 'Put search details in the JSON body, not the URL.');
      const origin = request.headers.origin;
      const expectedOrigin = config.publicOrigin || `http://${host}`;
      if (origin && origin !== expectedOrigin) throw new AppError('origin_not_allowed', 'Open this app directly to search.', 403);
      if (path.startsWith('api/v1/cart/') && origin !== expectedOrigin) throw new AppError('origin_required', 'Open this app directly for a cart action.', 403);
      // Origin-less requests support local/native/agent HTTP clients. Origin is
      // a browser CSRF control, not authentication. This is a public read app.
      const time = now();
      if (windowStarted === null || time - windowStarted >= 60_000) { searches = 0; windowStarted = time; }
      if (searches >= 30 || active >= 4) throw new AppError('busy', 'This installation is busy. Wait a moment before searching again.', 429, { retryAfter: 60 });
      searches++;
      active++;
      try {
        const body = await requestJson(request, abort.signal);
        if (path.startsWith('api/v1/cart/')) {
          let result;
          if (path.endsWith('/connect')) {
            if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new AppError('invalid_request', 'Use an empty JSON body to connect.');
            result = cart.connect(request, response);
          } else if (path.endsWith('/add')) result = await cart.add(request, response, body, { signal: abort.signal });
          else result = { cart: cart.disconnect(request, response, body) };
          json(response, 200, { ok: true, ...result }); return;
        }
        json(response, 200, await shopping.execute(path, body, { signal: abort.signal }));
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
  server.once('close', () => cart.close());
  return server;
}
