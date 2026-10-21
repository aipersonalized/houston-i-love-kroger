import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPromotionClient } from '../src/promotion-client.js';
import { TOKEN, SOURCE, FIRST, setup, save } from './promotion-fixtures.js';

const coverage = { type: 'bounded_topic_sample', message: 'Synthetic bounded coverage' };
async function remote(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
function json(response, body, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
}

test('client validates private configuration and never reflects configuration secrets', () => {
  for (const options of [{}, { url: 'file:///private.sqlite', token: TOKEN },
    { url: `http://example.invalid/?token=${TOKEN}`, token: TOKEN },
    { url: `https://${TOKEN}:private@example.invalid/`, token: TOKEN },
    { url: 'http://127.0.0.1/path', token: TOKEN }, { url: 'http://127.0.0.1', token: 'short' },
    { url: 'http://127.0.0.1', token: TOKEN, timeoutMs: 0 }]) {
    assert.throws(() => createPromotionClient(options), error => error.code === 'promotion_service_configuration_invalid' && !error.message.includes(TOKEN));
  }
});

test('client fails safely on non-JSON, raw upstream error, incomplete shape, wrong store and oversized responses', async t => {
  let behavior = (request, response) => json(response, { error: { message: TOKEN + ' private SQL' } }, 500);
  const { url } = await remote(t, (request, response) => behavior(request, response));
  const client = createPromotionClient({ url, token: TOKEN, maxResponseBytes: 1024 });
  const failsSafely = action => assert.rejects(action, error => error.code === 'promotion_service_unavailable' && !error.message.includes(TOKEN));
  await failsSafely(() => client.getStatus());
  behavior = (_request, response) => { response.end(TOKEN); };
  await failsSafely(() => client.getStatus());
  behavior = (_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{'); };
  await failsSafely(() => client.getStatus());
  behavior = (_request, response) => json(response, { status: 'available' });
  await failsSafely(() => client.getStatus());
  behavior = (_request, response) => json(response, { status: 'available', locationId: 'TEST0002', observations: [],
    page: { returned: 0, truncated: false, nextCursor: null }, coverage });
  await failsSafely(() => client.searchPromotions({ locationId: 'TEST0001' }));
  behavior = (_request, response) => json(response, { status: 'available', histories: [] });
  await failsSafely(() => client.getComparisons({ locationId: 'TEST0001', offers: [{}] }));
  behavior = (_request, response) => json(response, { status: 'available', coverage, huge: 'x'.repeat(2048) });
  await failsSafely(() => client.getStatus());
  behavior = (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
    response.write('{"huge":"'); response.end('x'.repeat(2048) + '"}');
  };
  await failsSafely(() => client.getStatus());
});

test('client applies a deadline to waiting for headers and streaming body bytes', async t => {
  let streamHeaders = false;
  const { url } = await remote(t, (_request, response) => {
    if (streamHeaders) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{'); }
  });
  const client = createPromotionClient({ url, token: TOKEN, timeoutMs: 100 });
  await assert.rejects(() => client.getStatus(), { code: 'promotion_service_timeout' });
  streamHeaders = true;
  await assert.rejects(() => client.getStatus(), { code: 'promotion_service_timeout' });
});

test('latest client rejects wrong snapshot identity, stale deals and unqualified source facts', async t => {
  const { store } = setup(t);
  save(store);
  const result = store.getLatestDeals({ sourceId: SOURCE, locationId: 'TEST0001', topic: 'milk', asOf: FIRST });
  let current = result;
  const { url } = await remote(t, (_request, response) => json(response, current));
  const client = createPromotionClient({ url, token: TOKEN });
  const input = { locationId: 'TEST0001', topic: 'milk' };
  assert.equal((await client.getLatestDeals(input)).deals.length, 1);
  for (const mutate of [
    value => { value.topic = 'bread'; },
    value => { value.snapshot = null; },
    value => { value.snapshot.ageSeconds = 86400; },
    value => { value.status = 'stale'; },
    value => { value.status = 'no_data'; },
    value => { value.deals[0].locationId = 'TEST0002'; },
    value => { value.deals[0].availability.inStore = false; },
    value => { value.deals[0].availability.stockLevel = 'TEMPORARILY_OUT_OF_STOCK'; },
    value => { value.deals[0].priceQualification = 'unsupported_source_price'; },
    value => { value.deals[0].price.promoCents = -100; },
    value => { value.page.returned = 2; },
    value => { value.page.truncated = true; },
  ]) {
    current = structuredClone(result);
    mutate(current);
    await assert.rejects(() => client.getLatestDeals(input), { code: 'promotion_service_unavailable' });
  }
});

test('invalid search cursor stays a caller error without forwarding private service messages', async t => {
  const remoteServer = await remote(t, (_request, response) => {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'PRIVATE_STORAGE_PATH' } }));
  });
  const client = createPromotionClient({ url: remoteServer.url, token: TOKEN });
  await assert.rejects(() => client.searchPromotions({ locationId: 'TEST0001', cursor: 'invalid' }), error =>
    error.code === 'promotion_request_invalid' && error.status === 400 && !error.message.includes('PRIVATE_STORAGE_PATH'));
});

test('client refuses redirects so the private token cannot be forwarded to another destination', async t => {
  let forwarded = false;
  const sink = await remote(t, (_request, response) => { forwarded = true; json(response, { status: 'available', coverage }); });
  const origin = await remote(t, (_request, response) => { response.writeHead(302, { Location: sink.url }); response.end(); });
  await assert.rejects(() => createPromotionClient({ url: origin.url, token: TOKEN }).getStatus(), { code: 'promotion_service_unavailable' });
  assert.equal(forwarded, false);
});

test('independent server entrypoint starts against a temporary pending database and serves bounded liveness/status', async t => {
  let child;
  t.after(async () => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 1500); deadline.unref();
    await exited;
    clearTimeout(deadline);
  });
  const fixture = setup(t, { approved: false });
  fixture.store.close();
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  child = spawn(process.execPath, [fileURLToPath(new URL('../src/promotion-server.js', import.meta.url))], {
    env: { PROMOTION_SERVICE_HOST: '127.0.0.1', PROMOTION_SERVICE_PORT: String(port),
      PROMOTION_SERVICE_TOKEN: TOKEN, HISTORY_DB_PATH: fixture.filename,
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Synthetic service did not start within its test deadline.')), 5000);
    let started = false;
    child.once('error', () => { clearTimeout(deadline); reject(new Error('Synthetic service process could not start.')); });
    child.once('exit', () => {
      clearTimeout(deadline);
      if (!started) reject(new Error('Synthetic service exited before readiness.'));
    });
    child.stdout.on('data', chunk => {
      if (chunk.toString('utf8').includes('Shared shopping service is listening')) {
        started = true; clearTimeout(deadline); resolve();
      }
    });
    child.stderr.resume();
  });
  const url = `http://127.0.0.1:${port}`;
  assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), { ok: true });
  const status = await createPromotionClient({ url, token: TOKEN }).getStatus();
  assert.equal(status.status, 'permission_required');
  const publicStatus = await fetch(`${url}/api/v1/status`);
  assert.equal(publicStatus.headers.get('x-houston-service'), 'houston-i-love-kroger-shopping');
  const publicBody = await publicStatus.json();
  assert.equal(publicBody.service.name, 'houston-i-love-kroger-shopping');
  assert.equal(publicBody.configured, false);
  assert.equal(publicBody.promotionService.status, 'permission_required');
});
