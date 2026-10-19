import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runCollection, DEFAULT_COLLECTION_PLAN } from '../src/collector.js';
import { SOURCE, FIRST, SECOND, AS_OF, policy, offer, setup, save, search } from './promotion-fixtures.js';

const HOUR = 3_600_000;
const at = (hours, origin = FIRST) => new Date(Date.parse(origin) + hours * HOUR).toISOString();
function latest(store, input = {}) {
  return store.getLatestDeals({ sourceId: SOURCE, locationId: 'TEST0001', topic: 'milk', asOf: at(1), ...input });
}
function saveTopics(store, { id, observedAt = FIRST, jobs }) {
  store.startRun({ runId: id, sourceId: SOURCE, startedAt: observedAt, targetCount: jobs.length, limit: 50,
    targets: jobs.map(job => ({ locationId: job.locationId ?? 'TEST0001', term: job.term })) });
  return store.completeRun({ runId: id, sourceId: SOURCE, finishedAt: observedAt,
    jobs: jobs.map((job, index) => ({ jobKey: `${id}-${index}`, locationId: 'TEST0001', observedAt,
      returnedProductCount: job.offers.length, ...job })) });
}

test('permission, missing collection, fresh empty collection and stale collection are distinct', t => {
  const { store } = setup(t, { approved: false });
  assert.equal(latest(store).status, 'permission_required');
  store.recordSourcePolicy(policy(), { now: FIRST });
  assert.equal(latest(store).reason, 'no_completed_collection');
  assert.equal(latest(store).snapshot, null);
  save(store, { offers: [] });
  const empty = latest(store);
  assert.equal(empty.status, 'available');
  assert.deepEqual(empty.deals, []);
  assert.equal(empty.snapshot.observedAt, FIRST);
  assert.equal(empty.snapshot.completedAt, FIRST);
  assert.equal(empty.snapshot.ageSeconds, 3600);
  assert.equal(empty.snapshot.maxAgeSeconds, 86400);
  assert.equal(empty.coverage.returnedProductCount, 0);
  assert.equal(empty.coverage.limitPerTarget, 50);
  assert.equal(empty.coverage.completeCatalog, false);
  assert.deepEqual(empty.latestAttempt, { status: 'completed', startedAt: FIRST, finishedAt: FIRST });
  assert.equal(latest(store, { asOf: at(24) }).status, 'stale');
  assert.equal(latest(store, { asOf: at(24) }).reason, 'snapshot_stale');
  assert.equal(latest(store, { asOf: at(23.999) }).status, 'available');
  assert.equal(latest(store, { asOf: at(1), maxAgeSeconds: 3600 }).status, 'stale');
  assert.equal(latest(store, { topic: 'bread' }).status, 'no_data');
  assert.equal(latest(store, { locationId: 'TEST0002' }).status, 'no_data');
  assert.equal(latest(store, { topic: 'MILK' }).reason, 'source_scope_not_approved');
  assert.equal(latest(store, { topic: 'unapproved' }).status, 'permission_required');
});

test('latest complete snapshot precedes promotion qualification and never retrieves older qualifying rows', t => {
  const { store } = setup(t);
  const cases = [
    { itemId: 'regular', price: { regular: 5 } },
    { itemId: 'zero', price: { regular: 5, promo: 0 } },
    { itemId: 'negative', price: { regular: 5, promo: -1 } },
    { itemId: 'non-cent', price: { regular: 5, promo: 1.234 } },
    { itemId: 'not-discounted', price: { regular: 5, promo: 6 } },
    { itemId: 'oos', stockLevel: 'TEMPORARILY_OUT_OF_STOCK' },
    { itemId: 'not-instore', inStore: false },
    { itemId: 'future', price: { regular: 5, promo: 3, effectiveDate: { value: at(4), timezone: 'UTC' } } },
    { itemId: 'expired', price: { regular: 5, promo: 3, expirationDate: { value: at(0.5), timezone: 'UTC' } } },
    { itemId: 'date-unknown', price: { regular: 5, promo: 3, effectiveDate: { value: '2026-01-02', timezone: null } } },
    { itemId: 'date-null', price: { regular: 5, promo: 3, expirationDate: null } },
  ];
  save(store, { offers: [...cases.map(change => offer({ itemId: change.itemId })), offer({ itemId: 'removed' })] });
  save(store, { id: 'replacement', observedAt: at(1), offers: cases.map(change => offer(change)) });
  const result = latest(store, { asOf: at(2) });
  assert.equal(result.status, 'available');
  assert.deepEqual(result.deals, []);
  assert.equal(result.snapshot.observedAt, at(1));
  const retained = search(store, { asOf: at(2) }).observations;
  for (const id of ['negative', 'non-cent']) {
    const row = retained.find(value => value.itemId === id && value.observedAt === at(1));
    assert.equal(row.priceQualification, 'unsupported_source_price');
    assert.equal(row.price.promo, null);
    assert.equal(row.price.promoCents, null);
    assert.equal(row.promotionStatus, 'not_verified_promotion');
    assert.equal(JSON.stringify(row).includes('reported_promo'), false);
  }
  // History remains an independently dated observation search.
  assert.equal(search(store, { asOf: at(2), itemId: 'removed' }).observations.length, 1);
  save(store, { id: 'empty', observedAt: at(3), offers: [] });
  assert.deepEqual(latest(store, { asOf: at(4) }).deals, []);
});

test('current window expiry excludes a collected promotion without waiting for freshness expiry', t => {
  const { store } = setup(t);
  save(store, { offers: [offer({ price: { regular: 5, promo: 3,
    expirationDate: { value: at(2), timezone: 'UTC' } } })] });
  assert.equal(latest(store).deals.length, 1);
  const expired = latest(store, { asOf: at(2) });
  assert.equal(expired.status, 'available');
  assert.deepEqual(expired.deals, []);
  assert.equal(expired.snapshot.ageSeconds, 7200);
});

test('overlapping topic memberships survive, newer item facts suppress older promos, and absence remains topic scoped', t => {
  const { store } = setup(t);
  saveTopics(store, { id: 'overlap', jobs: [{ term: 'milk', offers: [offer()] }, { term: 'bread', offers: [offer()] }] });
  assert.equal(latest(store).deals.length, 1);
  assert.equal(latest(store, { topic: 'bread' }).deals.length, 1);
  save(store, { id: 'bread-empty', term: 'bread', observedAt: at(1), offers: [] });
  assert.equal(latest(store, { asOf: at(2), topic: 'bread' }).deals.length, 0);
  assert.equal(latest(store, { asOf: at(2) }).deals.length, 1);
  save(store, { id: 'bread-new-regular', term: 'bread', observedAt: at(3),
    offers: [offer({ size: '24 oz', price: { regular: 10, promo: 0 } })] });
  assert.equal(latest(store, { asOf: at(4) }).deals.length, 0);
  save(store, { id: 'milk-new-promo', observedAt: at(5), offers: [offer({ price: { regular: 5, promo: 2 } })] });
  assert.equal(latest(store, { asOf: at(6) }).deals[0].price.promo, 2);
});

test('collector retains names and unavailable tombstones; failed targeted collection preserves complete data', async t => {
  const { store } = setup(t);
  const plan = { ...DEFAULT_COLLECTION_PLAN, sourceId: SOURCE, enabled: true,
    intervalMinutes: 60, targets: [{ locationId: 'TEST0001', term: 'milk' }] };
  let fail = false;
  let stock = 'HIGH';
  let time = FIRST;
  let calls = 0;
  const client = { configured: true, async searchProducts() {
    calls++;
    if (fail) throw new Error('private raw failure should not be returned');
    return [{ productId: 'captured-product', description: 'Captured product name', brand: 'Captured brand',
      items: [{ itemId: 'captured-item', fulfillment: { instore: stock !== 'NOT_IN_STORE' },
        inventory: { stockLevel: stock }, price: { regular: 5, promo: 3 } }] }];
  } };
  assert.equal((await runCollection({ store, client, plan, now: () => time, runId: 'captured' })).status, 'completed');
  const good = latest(store);
  assert.equal(good.deals[0].description, 'Captured product name');
  assert.equal(good.deals[0].brand, 'Captured brand');
  assert.equal(good.deals[0].availability.status, 'reported_in_stock');
  assert.equal(good.deals[0].currency, null);
  assert.equal(good.deals[0].unitBasis, null);
  time = at(2); fail = true;
  assert.equal((await runCollection({ store, client, plan, now: () => time, runId: 'failed' })).status, 'failed');
  const afterFailure = latest(store, { asOf: at(3) });
  assert.equal(afterFailure.status, 'available');
  assert.equal(afterFailure.snapshot.snapshotId, good.snapshot.snapshotId);
  assert.equal(afterFailure.deals.length, 1);
  assert.deepEqual(afterFailure.latestAttempt, { status: 'failed', startedAt: at(2), finishedAt: at(2) });
  assert.equal(JSON.stringify(afterFailure).includes('private raw failure'), false);
  assert.equal(latest(store, { asOf: at(24) }).status, 'stale');
  time = at(4); fail = false; stock = 'TEMPORARILY_OUT_OF_STOCK';
  assert.equal((await runCollection({ store, client, plan, now: () => time, runId: 'captured-oos' })).status, 'completed');
  assert.deepEqual(latest(store, { asOf: at(5) }).deals, []);
  time = at(6); stock = 'NOT_IN_STORE';
  assert.equal((await runCollection({ store, client, plan, now: () => time, runId: 'captured-not-instore' })).observationsWritten, 1);
  assert.deepEqual(latest(store, { asOf: at(7) }).deals, []);
  assert.equal(calls, 4);
  assert.equal(latest(store, { topic: 'bread', asOf: at(7) }).latestAttempt, null);
});

test('latest cursor pins the exact completed generation, stays bounded across restart and rechecks freshness and scope', t => {
  const fixture = setup(t);
  save(fixture.store, { offers: Array.from({ length: 5 }, (_, n) => offer({ itemId: `item-${n}` })) });
  const first = latest(fixture.store, { limit: 2 });
  assert.equal(first.page.truncated, true);
  fixture.store.close();
  const store = fixture.reopen();
  const second = latest(store, { limit: 2, cursor: first.page.nextCursor });
  const third = latest(store, { limit: 2, cursor: second.page.nextCursor });
  const ids = [...first.deals, ...second.deals, ...third.deals].map(row => row.itemId);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  assert.equal(third.page.nextCursor, null);
  assert.equal(latest(store, { asOf: at(24), limit: 2, cursor: first.page.nextCursor }).status, 'stale');
  for (const input of [{ limit: 3 }, { topic: 'bread' }, { locationId: 'TEST0002' }]) {
    const action = () => latest(store, { limit: 2, cursor: first.page.nextCursor, ...input });
    assert.throws(action, { code: 'history_input_invalid' });
  }
  save(store, { id: 'new-generation', observedAt: at(2), offers: [] });
  assert.throws(() => latest(store, { asOf: at(3), limit: 2, cursor: first.page.nextCursor }), { code: 'history_input_invalid' });
  store.recordSourcePolicy(policy({ evidenceReference: 'scope-new', reviewReference: 'review-new',
    verifiedAt: at(3), allowedTopics: ['bread'] }), { now: at(3) });
  assert.equal(latest(store, { asOf: at(4), limit: 2, cursor: first.page.nextCursor }).status, 'permission_required');
});

test('original grant, current scope, retention and completed status apply to empty snapshots as well as item rows', t => {
  const { store, filename } = setup(t);
  store.recordSourcePolicy(policy({ evidenceReference: 'short-original', expiresAt: at(3) }), { now: FIRST });
  save(store, { offers: [] });
  store.recordSourcePolicy(policy({ evidenceReference: 'renewed', reviewReference: 'renewed-review', verifiedAt: at(2) }), { now: at(2) });
  assert.equal(latest(store, { asOf: at(4) }).reason, 'snapshot_not_readable');
  save(store, { id: 'renewed-empty', observedAt: at(5), offers: [] });
  assert.equal(latest(store, { asOf: at(6) }).status, 'available');
  const raw = new Database(filename);
  try {
    const rights = raw.prepare('SELECT rights_id FROM collection_jobs ORDER BY job_id DESC LIMIT 1').get().rights_id;
    raw.prepare('UPDATE source_rights SET collection_allowed = 0 WHERE rights_id = ?').run(rights);
    assert.equal(latest(store, { asOf: at(6) }).status, 'permission_required');
    raw.prepare('UPDATE source_rights SET collection_allowed = 1 WHERE rights_id = ?').run(rights);
    raw.prepare("UPDATE collection_runs SET status = 'failed' WHERE run_id = 'renewed-empty'").run();
    assert.equal(latest(store, { asOf: at(6) }).reason, 'snapshot_not_readable');
    raw.prepare("UPDATE collection_runs SET status = 'completed' WHERE run_id = 'renewed-empty'").run();
  } finally { raw.close(); }
  store.recordSourcePolicy(policy({ evidenceReference: 'tight-retention', verifiedAt: at(6), retentionDays: 1 }), { now: at(6) });
  store.recordSourcePolicy(policy({ evidenceReference: 'wide-again', verifiedAt: at(6), retentionDays: 365 }), { now: at(6) });
  assert.equal(latest(store, { asOf: at(30), maxAgeSeconds: 604800 }).reason, 'snapshot_not_readable');
});

test('capture permission is bound before fetching; renewal cannot revive an expired grant in flight', async t => {
  const { store } = setup(t);
  store.recordSourcePolicy(policy({ evidenceReference: 'original-short', expiresAt: at(1) }), { now: FIRST });
  let time = FIRST;
  const client = { configured: true, async searchProducts() {
    time = at(2);
    store.recordSourcePolicy(policy({ evidenceReference: 'replacement', reviewReference: 'replacement-review', verifiedAt: time }), { now: time });
    return [{ productId: 'product', items: [{ itemId: 'item', price: { regular: 5, promo: 3 } }] }];
  } };
  const result = await runCollection({ store, client, plan: { ...DEFAULT_COLLECTION_PLAN, sourceId: SOURCE, enabled: true,
    targets: [{ locationId: 'TEST0001', term: 'milk' }] }, now: () => time, runId: 'grant-changed' });
  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'source_permission_required');
  assert.equal(store.getSummary().observations, 0);
});

test('latest input bounds and fixed public fields exclude query overrides, raw policy and invalid prices', t => {
  const { store } = setup(t);
  save(store);
  for (const input of [{ locationId: 'wrong' }, { topic: '' }, { topic: '*' }, { topic: 'mi' }, { topic: 'milk\u200b' },
    { limit: 0 }, { limit: 51 }, { cursor: 'invalid?' }, { maxAgeSeconds: 0 }, { maxAgeSeconds: 604801 }]) {
    assert.throws(() => latest(store, input), { code: 'history_input_invalid' });
  }
  const result = latest(store);
  assert.equal(result.deals[0].availability.status, 'unreported');
  assert.equal(result.deals[0].availability.inStore, null);
  for (const forbidden of ['rights_id', 'rightsId', 'retain_until', 'topic_key', 'evidence_reference', 'synthetic-permission', 'reported_regular']) {
    assert.equal(JSON.stringify(result).includes(forbidden), false, forbidden);
  }
  assert.equal(latest(store, { asOf: FIRST }).snapshot.observedAt, FIRST);
  assert.equal(latest(store, { asOf: '2026-01-01T00:00:00.000Z' }).status, 'no_data');
});
