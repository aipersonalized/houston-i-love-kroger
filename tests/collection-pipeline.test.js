import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../src/app.js';
import { createPromotionService } from '../src/promotion-service.js';
import { createPromotionClient } from '../src/promotion-client.js';
import { KrogerClient } from '../src/kroger.js';
import { DEFAULT_COLLECTION_PLAN, runCollection } from '../src/collector.js';
import { FIRST, SOURCE, TOKEN, setup } from './promotion-fixtures.js';

const PLAN = { ...DEFAULT_COLLECTION_PLAN, enabled: true, sourceId: SOURCE, intervalMinutes: 60,
  targets: [{ locationId: 'TEST0001', term: 'milk' }, { locationId: 'TEST0001', term: 'bread' }] };
const PRODUCT = { productId: 'synthetic-product', description: 'Synthetic milk', brand: 'Synthetic dairy',
  items: [{ itemId: 'synthetic-item', size: '12 oz', soldBy: 'unit', fulfillment: { instore: true },
    price: { regular: 5, promo: 3 } }] };
async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('synthetic native adapter→collector→SQLite→private service→public companion API preserves complete publication and truth', async t => {
  const { store, reopen } = setup(t);
  let now = FIRST;
  let mode = 'promotion';
  let sourceCalls = 0;
  const source = new KrogerClient({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret', now: () => Date.parse(now),
    fetchImpl: async url => {
      sourceCalls++;
      if (url.endsWith('/token')) return Response.json({ access_token: 'synthetic-token', token_type: 'bearer', expires_in: 1800 });
      const query = new URL(url);
      assert.equal(query.pathname, '/v1/products');
      assert.equal(query.searchParams.get('filter.locationId'), 'TEST0001');
      assert.equal(query.searchParams.get('filter.fulfillment'), 'ais');
      if (mode === 'failed' && query.searchParams.get('filter.term') === 'bread') return Response.json({}, { status: 503 });
      return Response.json({ data: mode === 'empty' ? [] : [PRODUCT] });
    } });
  const collect = () => runCollection({ store, client: source, plan: PLAN, now: () => now });
  assert.equal((await collect()).status, 'completed');
  assert.equal(store.getSummary().observations, 2);
  const beforeReads = sourceCalls;
  const privateStore = reopen();
  const privateUrl = await listen(t, createPromotionService({ store: privateStore, sourceId: SOURCE, token: TOKEN, now: () => now }));
  const provider = createPromotionClient({ url: privateUrl, token: TOKEN });
  const appUrl = await listen(t, await createApp({ config: { port: 4173, basePath: '/', publicOrigin: '' },
    client: { configured: false, environment: 'production' }, promotionProvider: provider }));
  async function call(operation, input) {
    const response = await fetch(`${appUrl}/api/v1/promotions/${operation}`, {
      ...(input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
    });
    assert.equal(response.status, 200); return response.json();
  }
  const selection = { locationId: 'TEST0001', topic: 'milk' };
  const latest = await call('latest', selection);
  assert.equal(latest.status, 'available', JSON.stringify(latest)); assert.equal(latest.deals.length, 1);
  assert.equal(latest.snapshot.observedAt, FIRST); assert.equal(latest.deals[0].currency, null);
  assert.equal((await call('status')).status, 'available');
  assert.equal((await call('prices', selection)).products[0].price.promo, 3);
  const search = await call('search', { locationId: 'TEST0001', term: 'Synthetic' });
  assert.equal(search.status, 'available');
  assert.equal((await call('retrieve', { locationId: 'TEST0001', observationId: search.observations[0].observationId })).observation.price.promo, 3);
  assert.equal(sourceCalls, beforeReads);

  async function nativeRead(operation, fields = [], expectedStatus = 'available') {
    assert.ok(process.env.COMPANION_PYTHON, 'Native checks require the explicitly selected interpreter.');
    assert.ok(process.env.COMPANION_TOOL, 'Native checks require the explicitly selected external companion tool.');
    const tool = process.env.COMPANION_TOOL;
    let result;
    try {
      result = await promisify(execFile)(process.env.COMPANION_PYTHON, [tool, operation, '--base-url', `${appUrl}/`, ...fields,
        '--data-use-approved', '--json', '--no-input'], { timeout: 10000, maxBuffer: 1_000_000,
        env: { ...process.env, KROGER_CLIENT_ID: '', KROGER_CLIENT_SECRET: '', PROMOTION_SERVICE_TOKEN: '' } });
    } catch (error) {
      assert.equal(error.code, 3); result = error;
    }
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true); assert.equal(output.status, expectedStatus); return output;
  }

  // Optional native CLI check uses an explicitly chosen interpreter and external tool;
  // Node-only testing has no Python or package-manager runtime dependency.
  await t.test('native Python companion exercises all six stored-read operations', { skip: !process.env.COMPANION_PYTHON || !process.env.COMPANION_TOOL }, async () => {
    const fields = ['--store', 'TEST0001', '--topic', 'milk'];
    const output = await nativeRead('latest', fields);
    assert.equal(output.deals[0].price.promo, 3); assert.equal(sourceCalls, beforeReads);
    await nativeRead('status'); await nativeRead('prices', fields);
    await nativeRead('search', ['--store', 'TEST0001', '--term', 'Synthetic']);
    await nativeRead('retrieve', ['--store', 'TEST0001', '--observation-id', search.observations[0].observationId]);
    const estimated = await nativeRead('estimate', ['--store', 'TEST0001', '--item', 'milk', 'synthetic-product', 'synthetic-item', '2'], 'complete');
    assert.equal(estimated.totals.reportedSubtotalCents, 600);
    assert.equal(estimated.totals.qualifiedSubtotalCents, null);
    assert.equal(sourceCalls, beforeReads);
  });

  now = '2026-01-02T14:00:00.000Z'; mode = 'failed';
  assert.equal((await collect()).status, 'failed');
  const failed = await call('latest', selection);
  assert.equal(failed.status, 'available'); assert.equal(failed.snapshot.observedAt, FIRST);
  assert.equal(failed.latestAttempt.status, 'failed');
  assert.equal(store.getSummary().observations, 2);
  now = '2026-01-02T16:00:00.000Z'; mode = 'empty';
  assert.equal((await collect()).status, 'completed');
  const empty = await call('latest', selection);
  assert.equal(empty.status, 'available'); assert.deepEqual(empty.deals, []);
  assert.equal(empty.snapshot.observedAt, now);
  now = '2026-01-03T16:00:00.000Z';
  assert.equal((await call('latest', selection)).status, 'stale');
  await t.test('native Python companion withholds stale deals', { skip: !process.env.COMPANION_PYTHON || !process.env.COMPANION_TOOL }, async () => {
    await nativeRead('latest', ['--store', 'TEST0001', '--topic', 'milk'], 'stale');
  });
  const beforeRevokedReads = sourceCalls;
  store.revokeSource(SOURCE, { now });
  for (const operation of ['latest', 'prices']) assert.equal((await call(operation, selection)).status, 'permission_required');
  assert.equal((await call('status')).status, 'permission_required');
  await t.test('native Python companion withholds revoked deals', { skip: !process.env.COMPANION_PYTHON || !process.env.COMPANION_TOOL }, async () => {
    await nativeRead('latest', ['--store', 'TEST0001', '--topic', 'milk'], 'permission_required');
  });
  assert.equal(sourceCalls, beforeRevokedReads);
});
