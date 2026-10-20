import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCollection, DEFAULT_COLLECTION_PLAN } from '../src/collector.js';
import { openHistoryStore } from '../src/history-store.js';
import { AppError } from '../src/errors.js';
import { setup, SOURCE, FIRST } from './promotion-fixtures.js';

const PLAN = { ...DEFAULT_COLLECTION_PLAN, sourceId: SOURCE, enabled: true, targets: [{ locationId: 'TEST0001', term: 'milk' }] };
const PRODUCTS = [{ productId: 'synthetic-product', description: 'Synthetic milk', items: [{ itemId: 'synthetic-item',
  size: '12 oz', soldBy: 'unit', fulfillment: { instore: true }, price: { regular: 5, promo: 3 } }] }];
const later = (seconds) => new Date(Date.parse(FIRST) + seconds * 1000).toISOString();

test('second connection makes no source request while a source-wide collector lease is held', async t => {
  const { store, reopen } = setup(t);
  const other = reopen();
  let unblock;
  let announce;
  const admitted = new Promise(resolve => { announce = resolve; });
  const products = new Promise(resolve => { unblock = resolve; });
  const first = runCollection({ store, plan: PLAN, now: () => FIRST, runId: 'running', client: {
    configured: true, async searchProducts() { announce(); return products; },
  } });
  await admitted;
  let calls = 0;
  const second = await runCollection({ store: other, plan: PLAN, now: () => FIRST, runId: 'overlap', client: {
    configured: true, async searchProducts() { calls++; return PRODUCTS; },
  } });
  assert.equal(second.status, 'deferred'); assert.equal(second.category, 'collection_busy');
  assert.equal(calls, 0); assert.equal(other.getSummary().observations, 0);
  unblock(PRODUCTS);
  assert.equal((await first).status, 'completed');
  assert.equal(other.getSummary().observations, 1);
});

test('crash recovery expires a lease, fails abandoned attempts and fences late publication', async t => {
  const { store, reopen } = setup(t);
  store.acquireCollection({ sourceId: SOURCE, owner: 'terminated', now: FIRST });
  store.startRun({ runId: 'terminated', sourceId: SOURCE, startedAt: FIRST, targetCount: 1, limit: 20, targets: PLAN.targets });
  store.reserveCollection({ sourceId: SOURCE, owner: 'terminated', now: FIRST, maxRequests: 40 });
  assert.throws(() => store.completeRun({ sourceId: SOURCE, runId: 'terminated', leaseOwner: 'terminated', finishedAt: later(121),
    jobs: [{ jobKey: 'late-job', locationId: 'TEST0001', term: 'milk', observedAt: FIRST, returnedProductCount: 1,
      offers: [{ productId: 'synthetic-product', itemId: 'synthetic-item', price: { regular: 5, promo: 3 } }] }] }),
  { code: 'collection_lease_lost' });
  assert.equal(store.getSummary().observations, 0);
  const replacement = reopen();
  const recovered = await runCollection({ store: replacement, plan: PLAN, now: () => later(121), runId: 'replacement',
    client: { configured: true, async searchProducts() { return PRODUCTS; } } });
  assert.equal(recovered.status, 'completed'); assert.equal(replacement.getSummary().failedRuns, 1);
  assert.throws(() => store.completeRun({ sourceId: SOURCE, runId: 'terminated', leaseOwner: 'terminated', finishedAt: later(122), jobs: [] }));
  assert.equal(replacement.getSummary().observations, 1);
});

test('reservations survive restart and unknown outcomes; rolling window and lower budget are enforced', async t => {
  const { store, reopen } = setup(t);
  const plan = { ...PLAN, maxRequestsPerDay: 4 };
  let calls = 0;
  const client = { configured: true, async searchProducts() { calls++; throw new Error('unknown transport outcome'); } };
  const failed = await runCollection({ store, client, plan, now: () => FIRST });
  assert.equal(failed.status, 'failed'); assert.equal(failed.reservedHttpAttempts, 4);
  const reopened = reopen();
  const blocked = await runCollection({ store: reopened, client, plan, now: () => later(1) });
  assert.equal(blocked.status, 'deferred'); assert.equal(blocked.category, 'collection_quota');
  assert.equal(blocked.retryAt, later(86400)); assert.equal(blocked.requests, 0); assert.equal(calls, 1);
  const renewed = await runCollection({ store: reopened, plan, now: () => later(86400),
    client: { configured: true, async searchProducts() { calls++; return PRODUCTS; } } });
  assert.equal(renewed.status, 'completed'); assert.equal(calls, 2);
});

test('rolling reservations block boundary bursts and honor a lowered budget until enough actual calls age out', t => {
  const { store, reopen } = setup(t);
  let active = store;
  const reserve = (seconds, maxRequests = 8) => {
    const input = { sourceId: SOURCE, owner: 'synthetic-quota', now: later(seconds) };
    assert.equal(active.acquireCollection(input).status, 'acquired');
    try { return active.reserveCollection({ ...input, maxRequests }); }
    finally { active.releaseCollection(input); }
  };
  assert.equal(reserve(0).status, 'reserved');
  assert.equal(reserve(23 * 3600).status, 'reserved');
  active = reopen();
  assert.equal(reserve(24 * 3600).status, 'reserved');
  const boundary = reserve(24 * 3600 + 1);
  assert.equal(boundary.status, 'quota'); assert.equal(boundary.retryAt, later(47 * 3600));
  const lowered = reserve(24 * 3600 + 2, 4);
  assert.equal(lowered.status, 'quota'); assert.equal(lowered.retryAt, later(48 * 3600));
  assert.equal(reserve(47 * 3600, 4).status, 'quota');
  assert.equal(reserve(48 * 3600, 4).status, 'reserved');
});

test('explicit safe-read retries consume quota, wait with backoff and publish just one complete job', async t => {
  const { store } = setup(t);
  let seconds = 0;
  let calls = 0;
  const waits = [];
  const result = await runCollection({ store, plan: { ...PLAN, maxAttempts: 3 }, now: () => later(seconds),
    wait: async ms => { waits.push(ms); seconds += ms / 1000; }, client: {
      configured: true, async searchProducts() {
        calls++; if (calls < 3) throw new AppError('upstream_unavailable', 'synthetic failure', 502);
        return PRODUCTS;
      },
    } });
  assert.equal(result.status, 'completed'); assert.equal(result.requests, 3); assert.equal(result.reservedHttpAttempts, 12);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(store.getSummary().completedRuns, 1); assert.equal(store.getSummary().observations, 1);
});

test('long provider cooldown survives restart without sleeping, retrying or publishing partial jobs', async t => {
  const { store, reopen } = setup(t);
  let calls = 0;
  let waits = 0;
  const client = { configured: true, async searchProducts() {
    calls++; throw new AppError('provider_limit', 'synthetic limit', 429, { retryAfter: 300 });
  } };
  const failed = await runCollection({ store, client, plan: { ...PLAN, maxAttempts: 3 }, now: () => FIRST,
    wait: async () => { waits++; } });
  assert.equal(failed.status, 'failed'); assert.equal(failed.retryAt, later(300)); assert.equal(waits, 0);
  const again = await runCollection({ store: reopen(), client, plan: PLAN, now: () => later(299) });
  assert.equal(again.status, 'deferred'); assert.equal(again.category, 'collection_backoff');
  assert.equal(calls, 1); assert.equal(store.getSummary().observations, 0);
});

test('permission is rechecked after backoff without publishing buffered source facts', async t => {
  const { store } = setup(t);
  let calls = 0;
  const first = await runCollection({ store, plan: { ...PLAN, maxAttempts: 3 }, now: () => FIRST,
    client: { configured: true, async searchProducts() { calls++; throw new AppError('upstream_unavailable', 'synthetic', 502); } },
    wait: async () => { store.revokeSource(SOURCE, { now: FIRST }); } });
  assert.equal(first.category, 'source_permission_required'); assert.equal(calls, 1);
  assert.equal(store.getSummary().observations, 0);
});

test('cancellation during retry wait releases the lease but keeps cooldown and consumed reservations', async t => {
  const { store, reopen } = setup(t);
  const controller = new AbortController();
  let calls = 0;
  const result = await runCollection({ store, plan: { ...PLAN, maxAttempts: 3 }, now: () => FIRST, signal: controller.signal,
    client: { configured: true, async searchProducts() { calls++; throw new AppError('upstream_unavailable', 'synthetic', 502); } },
    wait: async () => { controller.abort(); throw new Error('synthetic abort'); } });
  assert.equal(result.status, 'cancelled'); assert.equal(result.reservedHttpAttempts, 4); assert.equal(calls, 1);
  const again = await runCollection({ store: reopen(), plan: PLAN, now: () => FIRST,
    client: { configured: true, async searchProducts() { calls++; return PRODUCTS; } } });
  assert.equal(again.category, 'collection_backoff'); assert.equal(calls, 1);
});

test('retry budget exhaustion never publishes a successful first target as a complete multi-target run', async t => {
  const { store } = setup(t);
  let calls = 0;
  const result = await runCollection({ store, plan: { ...PLAN, maxRequestsPerDay: 4,
    targets: [...PLAN.targets, { locationId: 'TEST0001', term: 'bread' }] }, now: () => FIRST,
    client: { configured: true, async searchProducts() { calls++; return PRODUCTS; } } });
  assert.equal(result.category, 'collection_quota'); assert.equal(calls, 1);
  assert.equal(store.getSummary().observations, 0); assert.equal(store.getSummary().completedRuns, 0);
  assert.equal(store.getLatestDeals({ sourceId: SOURCE, locationId: 'TEST0001', topic: 'milk', asOf: FIRST }).status, 'no_data');
});

test('cancellation after an in-flight source response discards the whole buffered snapshot', async t => {
  const { store } = setup(t);
  const controller = new AbortController();
  const result = await runCollection({ store, plan: PLAN, now: () => FIRST, signal: controller.signal,
    client: { configured: true, async searchProducts() { controller.abort(); return PRODUCTS; } } });
  assert.equal(result.status, 'cancelled'); assert.equal(result.reservedHttpAttempts, 4);
  assert.equal(store.getSummary().observations, 0); assert.equal(store.getSummary().failedRuns, 1);
});

test('lease-release storage failure reports already committed facts instead of claiming zero writes', async t => {
  const { store } = setup(t);
  const release = store.releaseCollection;
  store.releaseCollection = () => { throw new Error('synthetic private storage marker'); };
  const result = await runCollection({ store, plan: PLAN, now: () => FIRST,
    client: { configured: true, async searchProducts() { return PRODUCTS; } } });
  store.releaseCollection = release;
  assert.equal(result.status, 'failed'); assert.equal(result.category, 'storage_failed');
  assert.equal(result.observationsWritten, 1); assert.equal(result.completedJobs, 1);
  assert.equal(store.getSummary().completedRuns, 1); assert.equal(store.getSummary().observations, 1);
  assert.equal(JSON.stringify(result).includes('synthetic private storage marker'), false);
});

test('a genuine v4 database upgrades additively, preserves synthetic facts and pending sources, and reopens as v5', t => {
  const fixture = setup(t);
  const filename = join(fixture.folder, 'schema-four.sqlite');
  const legacy = new Database(filename);
  for (const [index, name] of ['001-history.sql', '002-history-scope.sql', '003-observation-description.sql', '004-latest-deals.sql'].entries()) {
    const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'); legacy.exec(sql);
    legacy.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(index + 1, createHash('sha256').update(sql).digest('hex'), Date.parse(FIRST));
  }
  legacy.pragma('application_id = 1212763211'); legacy.pragma('user_version = 4');
  legacy.prepare('INSERT INTO sources VALUES (?,?,?,?,?)').run('kroger-public', 'Synthetic pending source', 'pending', null, Date.parse(FIRST));
  legacy.prepare('INSERT INTO sources VALUES (?,?,?,?,?)').run(SOURCE, 'Synthetic legacy source', 'verified', 1, Date.parse(FIRST));
  legacy.prepare(`INSERT INTO source_rights VALUES (1, ?, 'verified', 'synthetic-evidence', 'synthetic-review', ?, ?, 30, 1, 1, 1, ?, ?)`)
    .run(SOURCE, Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-12-31T00:00:00Z'), JSON.stringify(['TEST0001']), JSON.stringify(['milk']));
  legacy.prepare(`INSERT INTO collection_runs(run_id,source_id,started_at,finished_at,status,target_count,page_limit,observation_count,coverage_type)
    VALUES ('synthetic-legacy', ?, ?, ?, 'completed', 1, 20, 1, 'bounded_topic_sample')`).run(SOURCE, Date.parse(FIRST), Date.parse(FIRST));
  legacy.prepare(`INSERT INTO collection_jobs(job_id,source_id,job_key,run_id,location_id,observed_at,returned_product_count,topic_key,rights_id,retain_until)
    VALUES (1, ?, 'synthetic-legacy-job', 'synthetic-legacy', 'TEST0001', ?, 1, ?, 1, ?)`)
    .run(SOURCE, Date.parse(FIRST), createHash('sha256').update('milk').digest('hex'), Date.parse(later(30 * 86400)));
  legacy.prepare(`INSERT INTO observations(job_id,source_id,rights_id,location_id,product_id,item_id,description,
    regular_cents,promo_cents,date_qualified,observed_at,retain_until) VALUES
    (1, ?, 1, 'TEST0001', 'synthetic-legacy-product', 'synthetic-legacy-item', 'Synthetic legacy milk', 500, 300, 1, ?, ?)`)
    .run(SOURCE, Date.parse(FIRST), Date.parse(later(30 * 86400)));
  legacy.close();
  const upgraded = openHistoryStore({ filename });
  assert.equal(upgraded.getSummary().schemaVersion, 6);
  assert.equal(upgraded.getSourceStatus().status, 'pending');
  const rows = upgraded.searchPromotions({ sourceId: SOURCE, locationId: 'TEST0001', term: 'Synthetic', asOf: FIRST }).observations;
  assert.equal(rows.length, 1); assert.equal(rows[0].description, 'Synthetic legacy milk'); assert.equal(rows[0].price.promo, 3);
  upgraded.close();
  const reopened = openHistoryStore({ filename });
  assert.equal(reopened.getSummary().schemaVersion, 6); assert.equal(reopened.getSummary().observations, 1); reopened.close();
});
