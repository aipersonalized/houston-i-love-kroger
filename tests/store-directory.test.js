import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDirectoryCollection, validateDirectoryPlan, DEFAULT_DIRECTORY_PLAN } from '../src/directory-collector.js';
import { DIRECTORY_SOURCE, DIRECTORY_PURPOSES, validDiscoveryResponse } from '../src/store-directory.js';
import { runCollection, DEFAULT_COLLECTION_PLAN } from '../src/collector.js';
import { createPromotionService } from '../src/promotion-service.js';
import { createPromotionClient } from '../src/promotion-client.js';
import { createApp } from '../src/app.js';
import { KrogerClient } from '../src/kroger.js';
import { AppError } from '../src/errors.js';
import { FIRST, SOURCE, TOKEN, setup, save } from './promotion-fixtures.js';
import { openHistoryStore } from '../src/history-store.js';
import { main as collectStoresMain } from '../scripts/collect-stores.js';

const DIRECTORY = 'fixture-directory';
const PLAN = { ...DEFAULT_DIRECTORY_PLAN, sourceId: DIRECTORY, enabled: true, intervalMinutes: 60, zipCodes: ['00000'] };
const STORE = { locationId: 'TEST0001', name: 'Synthetic market',
  address: { addressLine1: 'Synthetic address', city: 'Synthetic city', state: 'XX', zipCode: '00000' } };
const policy = (extra = {}) => ({ sourceId: DIRECTORY, sourceLabel: 'Synthetic location source', status: 'verified',
  evidenceReference: 'synthetic-directory-evidence', reviewReference: 'synthetic-directory-review',
  verifiedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z', retentionDays: 30,
  allowedPurposes: [...DIRECTORY_PURPOSES], allowedZipCodes: ['00000', '00001'], ...extra });
const later = seconds => new Date(Date.parse(FIRST) + seconds * 1000).toISOString();
const input = (extra = {}) => ({ zipCode: '00000', sourceId: DIRECTORY, asOf: FIRST, ...extra });
function approved(t) {
  const fixture = setup(t);
  fixture.store.recordDirectoryPolicy(policy(), { now: FIRST });
  return fixture;
}
async function collect(store, extra = {}) {
  return runDirectoryCollection({ store, client: { configured: true, async searchStores() { return [STORE]; } },
    plan: PLAN, now: () => FIRST, ...extra });
}

test('directory is independently pending; disabled/missing directory grant writes no source rows or calls', async t => {
  const { store } = setup(t);
  assert.equal(store.getSourceStatus(DIRECTORY_SOURCE).status, 'pending');
  assert.equal(store.getPromotionStatus({ sourceId: SOURCE, asOf: FIRST }).status, 'available');
  let calls = 0;
  const result = await runDirectoryCollection({ store, now: () => FIRST, planProvided: false,
    client: { configured: false, async searchStores() { calls++; return [STORE]; } } });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers.map(row => row.code), ['permission_required', 'configuration_required', 'targets_required', 'collection_disabled', 'plan_required']);
  assert.equal(calls, 0); assert.deepEqual(store.getDirectorySummary(), { snapshots: 0, stores: 0 });
  assert.equal(store.getStoredStores(input()).status, 'permission_required');
});

test('finite plan and independent rights reject absent purposes, wildcards, duplicates and cross-source borrowing', t => {
  const { store } = setup(t);
  for (const change of [{ zipCodes: ['*'] }, { zipCodes: ['00000', '00000'] }, { zipCodes: Array(11).fill('00000') },
    { radiusMiles: 100 }, { intervalMinutes: 59 }, { sourceId: 'kroger-public' }, { maxRequestsPerDay: 3 }]) {
    assert.throws(() => validateDirectoryPlan({ ...PLAN, ...change }), { code: 'directory_plan_invalid' });
  }
  for (const change of [{ allowedPurposes: DIRECTORY_PURPOSES.slice(0, 2) }, { allowedZipCodes: ['*'] },
    { sourceId: SOURCE }, { sourceId: 'kroger-public' }, { evidenceReference: 'https://private.example/record' }]) {
    assert.throws(() => store.recordDirectoryPolicy(policy(change), { now: FIRST }));
  }
  store.recordDirectoryPolicy(policy(), { now: FIRST });
  assert.equal(store.getDirectoryPermission(DIRECTORY, FIRST, ['99999']).status, 'permission_required');
  assert.equal(store.getSourcePermission(DIRECTORY, FIRST).status, 'permission_required');
});

test('successful snapshots retain exact bounded ZIP query and normalize only supplied metadata', async t => {
  const { store, reopen } = approved(t);
  const result = await collect(store, { client: { configured: true, async searchStores(zip, options) {
    assert.equal(zip, '00000'); assert.equal(options.signal, undefined); return [STORE];
  } } });
  assert.equal(result.status, 'completed'); assert.equal(result.snapshotsWritten, 1); assert.equal(result.storesWritten, 1);
  const read = reopen().getStoredStores(input());
  assert.equal(read.status, 'available'); assert.equal(read.stores.length, 1);
  assert.equal(read.stores[0].locationId, 'TEST0001'); assert.equal(read.stores[0].address.county, null);
  assert.equal(read.coverage.zipCode, '00000'); assert.equal(read.coverage.returnedStoreCount, 1);
  assert.equal(read.coverage.radiusMiles, 10); assert.equal(read.coverage.limitPerQuery, 10);
  assert.equal(read.coverage.completeNearbyStores, false); assert.equal(read.snapshot.observedAt, FIRST);
  assert.equal(validDiscoveryResponse(read, 'getStoredStores', { zipCode: '00000' }), true);
  const forged = structuredClone(read); forged.coverage.returnedStoreCount = 10;
  assert.equal(validDiscoveryResponse(forged, 'getStoredStores', { zipCode: '00000' }), false);
  const malformedService = createPromotionClient({ url: 'http://127.0.0.1', token: TOKEN, fetchImpl: async () => Response.json(forged) });
  await assert.rejects(malformedService.getStoredStores({ zipCode: '00000' }), { code: 'promotion_service_unavailable' });
  assert.equal((await collect(store)).status, 'already_collected');
});

test('fresh empty replaces older directory; stale and no completed collection withhold store metadata', async t => {
  const { store } = approved(t);
  assert.equal(store.getStoredStores(input()).status, 'no_data');
  await collect(store);
  const stale = store.getStoredStores(input({ asOf: later(86400) }));
  assert.equal(stale.status, 'stale'); assert.deepEqual(stale.stores, []); assert.equal(stale.snapshot.observedAt, FIRST);
  await collect(store, { now: () => later(7200), client: { configured: true, async searchStores() { return []; } } });
  const empty = store.getStoredStores(input({ asOf: later(7200) }));
  assert.equal(empty.status, 'available'); assert.deepEqual(empty.stores, []); assert.equal(empty.coverage.returnedStoreCount, 0);
  assert.equal(empty.snapshot.observedAt, later(7200));
});

test('second ZIP failure publishes no partial replacement and preserves completed snapshot time plus failed attempt', async t => {
  const { store } = approved(t);
  await collect(store);
  const failed = await collect(store, { now: () => later(7200), plan: { ...PLAN, zipCodes: ['00000', '00001'] },
    client: { configured: true, async searchStores(zip) { if (zip === '00001') throw new Error('synthetic-private-marker'); return []; } } });
  assert.equal(failed.status, 'failed'); assert.equal(failed.snapshotsWritten, 0);
  const read = store.getStoredStores(input({ asOf: later(7200) }));
  assert.equal(read.snapshot.observedAt, FIRST); assert.equal(read.stores.length, 1); assert.equal(read.latestAttempt.status, 'failed');
  assert.equal(store.getStoredStores(input({ zipCode: '00001', asOf: later(7200) })).status, 'no_data');
  assert.equal(JSON.stringify(failed).includes('synthetic-private-marker'), false);
});

test('conflicting store IDs and cancellation abort the complete run rather than dropping unmatched source facts', async t => {
  const { store } = approved(t);
  const conflict = await collect(store, { client: { configured: true, async searchStores() { return [STORE, { ...STORE, name: 'Conflicting synthetic name' }]; } } });
  assert.equal(conflict.category, 'unsupported_response'); assert.equal(store.getDirectorySummary().snapshots, 0);
  const duplicate = await collect(store, { client: { configured: true, async searchStores() { return [STORE, STORE]; } } });
  assert.equal(duplicate.category, 'unsupported_response'); assert.equal(store.getDirectorySummary().snapshots, 0);
  const controller = new AbortController();
  const cancelled = await collect(store, { signal: controller.signal, client: { configured: true, async searchStores() { controller.abort(); return [STORE]; } } });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(store.getDirectorySummary().snapshots, 0);
});

test('original/current rights, narrower ZIP scope, expiry, retention and revocation never resurrect old directory snapshots', async t => {
  const { store, reopen } = approved(t);
  await collect(store);
  store.recordDirectoryPolicy(policy({ evidenceReference: 'synthetic-narrower', verifiedAt: later(1), allowedZipCodes: ['00001'], retentionDays: 1 }), { now: later(1) });
  assert.equal(store.getStoredStores(input({ asOf: later(1) })).status, 'permission_required');
  store.recordDirectoryPolicy(policy({ evidenceReference: 'synthetic-broader', verifiedAt: later(2) }), { now: later(2) });
  assert.equal(store.getStoredStores(input({ asOf: later(86400), maxAgeSeconds: 604800 })).reason, 'snapshot_not_readable');
  store.purgeExpired({ sourceId: DIRECTORY, now: later(86400) });
  assert.equal(store.getDirectorySummary().snapshots, 0);
  await collect(store, { now: () => later(90000) });
  store.revokeSource(DIRECTORY, { now: later(90001), purge: true });
  assert.equal(reopen().getStoredStores(input({ asOf: later(90001) })).status, 'permission_required');
  assert.deepEqual(store.getDirectorySummary(), { snapshots: 0, stores: 0 });
  assert.throws(() => store.recordDirectoryPolicy(policy(), { now: later(90002) }), { code: 'source_revoked' });
});

test('in-flight expiry rechecks original permission before publication', async t => {
  const { store } = approved(t);
  store.recordDirectoryPolicy(policy({ evidenceReference: 'short-synthetic', expiresAt: later(30) }), { now: FIRST });
  let clock = FIRST;
  const result = await collect(store, { now: () => clock, client: { configured: true, async searchStores() { clock = later(31); return [STORE]; } } });
  assert.equal(result.category, 'source_permission_required'); assert.equal(store.getDirectorySummary().snapshots, 0);
});

test('directory concurrency, rolling reservations and provider backoff survive independent connections/restarts', async t => {
  const { store, reopen } = approved(t);
  store.acquireCollection({ sourceId: DIRECTORY, owner: 'synthetic-existing', now: FIRST });
  const busy = await collect(reopen());
  assert.equal(busy.status, 'deferred'); assert.equal(busy.requests, 0);
  store.releaseCollection({ sourceId: DIRECTORY, owner: 'synthetic-existing' });
  const failed = await collect(store, { client: { configured: true, async searchStores() { throw new AppError('provider_limit', 'synthetic', 429, { retryAfter: 300 }); } } });
  assert.equal(failed.retryAt, later(300)); assert.equal(failed.reservedHttpAttempts, 4);
  assert.equal((await collect(reopen(), { now: () => later(299) })).category, 'collection_backoff');
  const quota = await collect(reopen(), { now: () => later(300), plan: { ...PLAN, maxRequestsPerDay: 4 } });
  assert.equal(quota.category, 'collection_quota'); assert.equal(quota.requests, 0); assert.equal(quota.retryAt, later(86400));
});

test('topic discovery uses only readable completed labels, preserves completed empty and exposes freshness without private uncollected labels', t => {
  const { store } = approved(t);
  assert.equal(store.getStoreTopics({ sourceId: SOURCE, locationId: 'TEST0001', asOf: FIRST }).status, 'no_data');
  save(store); save(store, { id: 'empty-bread', term: 'bread', offers: [] });
  const topics = store.getStoreTopics({ sourceId: SOURCE, locationId: 'TEST0001', asOf: FIRST });
  assert.equal(topics.status, 'available'); assert.deepEqual(topics.topics.map(row => [row.topic, row.returnedProductCount]), [['bread', 0], ['milk', 1]]);
  assert.equal(validDiscoveryResponse(topics, 'getStoreTopics', { locationId: 'TEST0001' }), true);
  const stale = store.getStoreTopics({ sourceId: SOURCE, locationId: 'TEST0001', asOf: later(86400) });
  assert.equal(stale.status, 'stale'); assert.ok(stale.topics.every(row => row.status === 'stale'));
  assert.equal(store.getStoreTopics({ sourceId: SOURCE, locationId: 'TEST9999', asOf: FIRST }).status, 'permission_required');
  store.revokeSource(SOURCE, { now: FIRST });
  assert.deepEqual(store.getStoreTopics({ sourceId: SOURCE, locationId: 'TEST0001', asOf: FIRST }).topics, []);
});

async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('actual synthetic ZIP→explicit store choice→completed topics→deals/prices/estimate crosses both HTTP services and native companion without source calls on reads', async t => {
  const { store } = approved(t);
  let supplierAttempts = 0;
  const supplier = new KrogerClient({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret', fetchImpl: async url => {
    supplierAttempts++;
    if (url.endsWith('/token')) return Response.json({ access_token: 'synthetic-token', token_type: 'bearer', expires_in: 1800 });
    const query = new URL(url);
    if (query.pathname === '/v1/locations') {
      assert.equal(query.searchParams.get('filter.zipCode.near'), '00000');
      assert.equal(query.searchParams.get('filter.radiusInMiles'), '10'); assert.equal(query.searchParams.get('filter.limit'), '10');
      return Response.json({ data: [STORE, { ...STORE, locationId: 'TEST0002', name: 'Synthetic chosen store' }] });
    }
    assert.equal(query.pathname, '/v1/products'); assert.equal(query.searchParams.get('filter.locationId'), 'TEST0002');
    return Response.json({ data: [{ productId: 'synthetic-product', description: 'Synthetic milk', items: [{ itemId: 'synthetic-item',
      size: '12 oz', soldBy: 'unit', fulfillment: { instore: true }, price: { regular: 5, promo: 3 } }] }] });
  } });
  assert.equal((await collect(store, { client: supplier })).status, 'completed');
  assert.equal((await runCollection({ store, client: supplier, now: () => FIRST, plan: { ...DEFAULT_COLLECTION_PLAN, sourceId: SOURCE,
    enabled: true, targets: [{ locationId: 'TEST0002', term: 'milk' }] } })).status, 'completed');
  const beforeReads = supplierAttempts;
  const privateUrl = await listen(t, createPromotionService({ store, token: TOKEN, sourceId: SOURCE, directorySourceId: DIRECTORY, now: () => FIRST }));
  const promotionProvider = createPromotionClient({ url: privateUrl, token: TOKEN });
  let forbiddenLiveCalls = 0;
  const app = await listen(t, await createApp({ config: { port: 4173, basePath: '/', publicOrigin: '' }, promotionProvider,
    client: { configured: false, environment: 'production', async searchStores() { forbiddenLiveCalls++; throw new Error('forbidden'); },
      async searchProducts() { forbiddenLiveCalls++; throw new Error('forbidden'); } } }));
  const read = async (operation, body) => {
    const response = await fetch(`${app}/api/v1/promotions/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  const directory = await read('stores', { zipCode: '00000' });
  assert.equal(directory.stores.length, 2);
  // Explicit synthetic user choice of the second returned record, never first-store guessing.
  const chosen = directory.stores.find(row => row.locationId === 'TEST0002');
  const topics = await read('topics', { locationId: chosen.locationId });
  const selection = { locationId: chosen.locationId, topic: topics.topics[0].topic };
  assert.equal((await read('latest', selection)).deals[0].price.promo, 3);
  assert.equal((await read('prices', selection)).products[0].price.promo, 3);
  const estimated = await read('estimate', { locationId: chosen.locationId,
    items: [{ topic: selection.topic, productId: 'synthetic-product', itemId: 'synthetic-item', quantity: 2 }] });
  assert.equal(estimated.totals.reportedSubtotalCents, 600); assert.equal(estimated.totals.qualifiedSubtotalCents, null);
  await t.test('native Python companion follows stored ZIP, exact choice, topics and prices without supplier calls', { skip: !process.env.COMPANION_PYTHON }, async () => {
    const tool = fileURLToPath(new URL('../skills/houston-i-love-kroger/scripts/promotions.py', import.meta.url));
    for (const [operation, fields] of [['stores', ['--zip', '00000']], ['topics', ['--store', chosen.locationId]],
      ['latest', ['--store', chosen.locationId, '--topic', selection.topic]], ['prices', ['--store', chosen.locationId, '--topic', selection.topic]],
      ['estimate', ['--store', chosen.locationId, '--item', selection.topic, 'synthetic-product', 'synthetic-item', '2']]]) {
      const result = await promisify(execFile)(process.env.COMPANION_PYTHON, [tool, operation, '--base-url', `${app}/`, ...fields,
        '--data-use-approved', '--json', '--no-input'], { timeout: 10000, env: { ...process.env, KROGER_CLIENT_ID: '', KROGER_CLIENT_SECRET: '', PROMOTION_SERVICE_TOKEN: '' } });
      const output = JSON.parse(result.stdout); assert.equal(output.ok, true); assert.ok(['available', 'complete'].includes(output.status), result.stdout);
    }
  });
  assert.equal(supplierAttempts, beforeReads); assert.equal(forbiddenLiveCalls, 0);
});

test('operator CLI dry-run/help/blocked JSON is clean and never creates a dry-run database', t => {
  const { folder, filename } = setup(t, { approved: false });
  const tool = fileURLToPath(new URL('../scripts/collect-stores.js', import.meta.url));
  const planFile = join(folder, 'directory-plan.json'); writeFileSync(planFile, JSON.stringify(DEFAULT_DIRECTORY_PLAN));
  const cli = args => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 10000,
    env: { ...process.env, KROGER_CLIENT_ID: '', KROGER_CLIENT_SECRET: '', KROGER_ENVIRONMENT: 'production' } });
  const fresh = join(folder, 'never-created.sqlite');
  const dry = cli(['--plan', planFile, '--database', fresh, '--dry-run', '--json', '--no-input']);
  assert.equal(dry.status, 0, dry.stdout); assert.equal(existsSync(fresh), false); assert.equal(JSON.parse(dry.stdout).status, 'dry_run');
  const blocked = cli(['--plan', planFile, '--database', filename, '--json', '--no-input']);
  assert.equal(blocked.status, 3); assert.equal(JSON.parse(blocked.stdout).requests, 0); assert.equal(blocked.stdout.includes(folder), false);
  const invalid = cli(['--unsupported', '--json']); assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stdout).code, 'invalid_arguments');
  assert.equal(cli(['--help']).status, 0);
});

test('schema5 upgrades to6 additively without inventing labels for existing completed topic snapshots', t => {
  const { folder } = setup(t);
  const filename = join(folder, 'synthetic-schema5.sqlite');
  const legacy = new Database(filename);
  for (const [index, name] of ['001-history.sql', '002-history-scope.sql', '003-observation-description.sql', '004-latest-deals.sql', '005-collection-control.sql'].entries()) {
    const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'); legacy.exec(sql);
    legacy.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(index + 1, createHash('sha256').update(sql).digest('hex'), Date.parse(FIRST));
  }
  legacy.pragma('application_id=1212763211'); legacy.pragma('user_version=5');
  legacy.prepare("INSERT INTO sources VALUES ('kroger-public','Synthetic pending','pending',NULL,?)").run(Date.parse(FIRST));
  legacy.prepare("INSERT INTO sources VALUES (?,'Synthetic history','verified',1,?)").run(SOURCE, Date.parse(FIRST));
  legacy.prepare("INSERT INTO source_rights VALUES (1,?,'verified','synthetic-old','synthetic-review',?,?,30,1,1,1,?,?)")
    .run(SOURCE, Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-12-31T00:00:00Z'), JSON.stringify(['TEST0001']), JSON.stringify(['milk']));
  legacy.prepare(`INSERT INTO collection_runs(run_id,source_id,started_at,finished_at,status,target_count,page_limit,observation_count,coverage_type)
    VALUES ('synthetic-old',?,?,?,'completed',1,20,1,'bounded_topic_sample')`).run(SOURCE, Date.parse(FIRST), Date.parse(FIRST));
  legacy.prepare(`INSERT INTO collection_jobs VALUES (1,?,'synthetic-old','synthetic-old','TEST0001',?,1,?,1,?)`)
    .run(SOURCE, Date.parse(FIRST), createHash('sha256').update('milk').digest('hex'), Date.parse(later(30 * 86400)));
  legacy.prepare(`INSERT INTO observations(job_id,source_id,rights_id,location_id,product_id,item_id,description,
    regular_cents,promo_cents,date_qualified,observed_at,retain_until) VALUES (1,?,1,'TEST0001','synthetic-old','synthetic-item','Synthetic old milk',500,300,1,?,?)`)
    .run(SOURCE, Date.parse(FIRST), Date.parse(later(30 * 86400))); legacy.close();
  const upgraded = openHistoryStore({ filename });
  try {
    assert.equal(upgraded.getSummary().schemaVersion, 6); assert.equal(upgraded.getSummary().observations, 1);
    assert.equal(upgraded.getSourceStatus().status, 'pending'); assert.equal(upgraded.getSourceStatus(DIRECTORY_SOURCE).status, 'pending');
    assert.equal(upgraded.searchPromotions({ sourceId: SOURCE, locationId: 'TEST0001', asOf: FIRST }).observations[0].price.promo, 3);
    assert.equal(upgraded.getStoreTopics({ sourceId: SOURCE, locationId: 'TEST0001', asOf: FIRST }).status, 'no_data');
    save(upgraded, { id: 'new-named', observedAt: later(1) });
    assert.equal(upgraded.getStoreTopics({ sourceId: SOURCE, locationId: 'TEST0001', asOf: later(1) }).topics[0].topic, 'milk');
  } finally { upgraded.close(); }
  const reopened = openHistoryStore({ filename });
  assert.equal(reopened.getSummary().schemaVersion, 6); assert.equal(reopened.getSummary().observations, 2); reopened.close();
});

test('stored discovery HTTP validates exact input and has truthful unavailable states without live-source fallback', async t => {
  let forbidden = 0;
  const app = await listen(t, await createApp({ config: { port: 4173, basePath: '/', publicOrigin: '' },
    client: { configured: true, environment: 'production', async searchStores() { forbidden++; } } }));
  for (const [operation, body] of [['stores', { zipCode: '00000' }], ['topics', { locationId: 'TEST0001' }]]) {
    const response = await fetch(`${app}/api/v1/promotions/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'promotion_service_not_configured');
    assert.equal(Object.hasOwn(result, 'stores'), false); assert.equal(Object.hasOwn(result, 'topics'), false);
    const invalid = await fetch(`${app}/api/v1/promotions/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, collect: true }) });
    assert.equal(invalid.status, 400);
  }
  assert.equal(forbidden, 0);
});

test('operator CLI reports uncertain post-request failure without false no-request/zero-write claims or automatic replay', async t => {
  const { store, folder, filename, reopen } = setup(t);
  store.recordDirectoryPolicy(policy({ sourceId: DIRECTORY_SOURCE }), { now: FIRST });
  const planFile = join(folder, 'synthetic-cli-plan.json');
  writeFileSync(planFile, JSON.stringify({ ...PLAN, sourceId: DIRECTORY_SOURCE }));
  let calls = 0;
  let output = '';
  const write = process.stdout.write;
  process.stdout.write = function (chunk) { output += chunk; return true; };
  let code;
  try {
    code = await collectStoresMain(['--plan', planFile, '--database', filename, '--json', '--no-input'], {}, {
      openStore: () => store,
      createClient: () => ({ configured: true, async searchStores() { calls++; return [STORE]; } }),
      collect: async args => {
        const committed = await runDirectoryCollection({ ...args, now: () => FIRST });
        assert.equal(committed.status, 'completed');
        throw new Error('synthetic-private-storage-marker');
      },
    });
  } finally { process.stdout.write = write; }
  const result = JSON.parse(output);
  assert.equal(code, 1); assert.equal(calls, 1); assert.equal(result.code, 'directory_outcome_unknown');
  assert.match(result.message, /inspect.*last attempt/iu);
  assert.equal(output.includes('No source request was started'), false);
  assert.equal(output.includes('synthetic-private-storage-marker'), false);
  assert.equal(Object.hasOwn(result, 'requests'), false); assert.equal(Object.hasOwn(result, 'snapshotsWritten'), false);
  assert.equal(reopen().getDirectorySummary().snapshots, 1);
});

test('unverified snapshot publication keeps unknown counts rather than replacing committed facts with zero', async t => {
  const { store } = approved(t);
  const complete = store.completeDirectoryRun;
  store.completeDirectoryRun = value => { complete(value); throw new Error('synthetic-lost-commit-ack'); };
  const result = await collect(store);
  assert.equal(result.status, 'failed'); assert.equal(result.snapshotsWritten, null); assert.equal(result.storesWritten, null);
  assert.equal(result.requests, 1); assert.equal(store.getDirectorySummary().snapshots, 1);
});
