import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { openHistoryStore, validateSourcePolicy } from '../src/history-store.js';

const SOURCE = 'fixture-source';
const FIRST = '2026-01-02T12:00:00.000Z';
const SECOND = '2026-01-03T12:00:00.000Z';
const AS_OF = '2026-01-04T12:00:00.000Z';
function policy(extra = {}) {
  return { sourceId: SOURCE, sourceLabel: 'Deterministic test source', status: 'verified',
    evidenceReference: 'fixture-permission', reviewReference: 'fixture-review', verifiedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z', retentionDays: 30,
    allowedPurposes: ['historical-price-collection', 'historical-price-display', 'historical-agent-access'],
    allowedLocationIds: ['TEST0001', 'TEST0002'], allowedTopics: ['milk', 'bread'], ...extra };
}
function offer(extra = {}) {
  return { productId: 'fixture-product', itemId: 'fixture-item', size: '12 oz', soldBy: 'unit', currency: 'USD',
    priceBasis: 'one-package', modality: 'IN_STORE', eligibilityKey: 'all-shoppers', unitBasis: 'oz',
    price: { regular: 5, promo: 3, regularPerUnitEstimate: 0.41666667, promoPerUnitEstimate: 0.25 }, ...extra };
}
function setup(t, { approved = true } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'kroger-history-test-'));
  const filename = join(folder, 'history.sqlite');
  const store = openHistoryStore({ filename });
  t.after(() => {
    try { store.close(); } catch { /* A reopen test owns its replacement connection. */ }
    assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + '\\') || resolve(folder).startsWith(resolve(tmpdir()) + '/'));
    rmSync(folder, { recursive: true, force: true });
  });
  if (approved) store.recordSourcePolicy(policy(), { now: FIRST });
  return { store, filename, folder };
}
function save(store, { id = 'first', observedAt = FIRST, offers = [offer()], locationId = 'TEST0001', term = 'milk' } = {}) {
  store.startRun({ runId: id, sourceId: SOURCE, startedAt: observedAt, targetCount: 1, limit: 10 });
  return store.completeRun({ runId: id, sourceId: SOURCE, finishedAt: observedAt,
    jobs: [{ jobKey: id, locationId, term, observedAt, returnedProductCount: offers.length, offers }] });
}
function history(store, current = offer(), extra = {}) {
  return store.getComparisons({ sourceId: SOURCE, locationId: 'TEST0001', offers: [current], asOf: AS_OF, ...extra }).histories[0];
}

test('real SQLite file persists across close/reopen; default source has no permission or invented observations', t => {
  const { store, filename } = setup(t);
  assert.equal(store.getSourcePermission('kroger-public', FIRST).status, 'permission_required');
  assert.equal(store.getSummary().observations, 0);
  assert.equal(history(store).status, 'no_observations');
  save(store);
  store.close();
  const reopened = openHistoryStore({ filename });
  try {
    assert.equal(reopened.getSummary().observations, 1);
    const result = history(reopened);
    assert.equal(result.status, 'insufficient_history');
    assert.equal(result.lastPromo, 3);
    assert.equal(result.observationCount, 1);
    assert.equal(Object.hasOwn(result, 'average'), false);
    assert.equal(Object.hasOwn(result, 'trend'), false);
  } finally { reopened.close(); }
});

test('comparison uses only strictly earlier exact-store/item facts and reports sampled low/date and signed delta', t => {
  const { store } = setup(t);
  save(store);
  save(store, { id: 'second', observedAt: SECOND, offers: [offer({ price: { regular: 5, promo: 2.5, promoPerUnitEstimate: 0.2 } })] });
  save(store, { id: 'other-store', locationId: 'TEST0002', offers: [offer({ price: { regular: 5, promo: 0.5 } })] });
  save(store, { id: 'other-item', offers: [offer({ itemId: 'another-item', price: { regular: 5, promo: 0.1 } })] });
  save(store, { id: 'same-time', observedAt: AS_OF, offers: [offer({ price: { regular: 5, promo: 0.01 } })] });
  const result = history(store, offer({ price: { regular: 5, promo: 2, promoPerUnitEstimate: 0.15 } }));
  assert.equal(result.status, 'comparable');
  assert.equal(result.observationCount, 2);
  assert.equal(result.firstObservedAt, FIRST);
  assert.equal(result.lastObservedAt, SECOND);
  assert.equal(result.lowestObservedAt, SECOND);
  assert.equal(result.lastPromo, 2.5);
  assert.equal(result.lowestPromo, 2.5);
  assert.equal(result.deltaFromLastCents, -50);
  assert.deepEqual(result.sourceLabels, ['Deterministic test source']);
  assert.equal(result.unitComparison.basis, 'oz');
  assert.equal(result.unitComparison.deltaFromLastEstimate, -0.05);
});

test('job uniqueness is idempotent and a conflicting item rolls the complete transaction back', t => {
  const { store } = setup(t);
  save(store);
  store.startRun({ runId: 'replay', sourceId: SOURCE, startedAt: SECOND, targetCount: 1, limit: 10 });
  const replay = store.completeRun({ runId: 'replay', sourceId: SOURCE, finishedAt: SECOND,
    jobs: [{ jobKey: 'first', locationId: 'TEST0001', term: 'milk', observedAt: SECOND, returnedProductCount: 1, offers: [offer()] }] });
  assert.equal(replay.observationCount, 0);
  assert.equal(store.getSummary().observations, 1);
  assert.throws(() => save(store, { id: 'conflict', observedAt: SECOND, offers: [offer(), offer({ price: { regular: 5, promo: 1 } })] }));
  assert.equal(store.getSummary().observations, 1);
  assert.equal(store.hasCompletedJob(SOURCE, 'conflict'), false);
  store.failRun({ runId: 'conflict', finishedAt: SECOND });
  assert.equal(store.getSummary().failedRuns, 1);
});

test('size/sold-by/currency/eligibility/modality/price-basis mismatch never yields arithmetic', t => {
  const { store } = setup(t);
  save(store);
  for (const extra of [{ size: '24 oz' }, { soldBy: 'weight' }, { currency: 'CAD' }, { eligibilityKey: 'membership' },
    { modality: 'DELIVERY' }, { priceBasis: 'multi-buy' }]) {
    const result = history(store, offer(extra));
    assert.equal(result.status, 'incomparable');
    assert.equal(result.deltaFromLastCents, null);
    assert.equal(result.lastPromo, null);
  }
});

test('unknown conditions allow dated reported-price history without delta or invented unit basis', t => {
  const { store } = setup(t);
  const unknown = offer({ currency: null, priceBasis: null, modality: null, eligibilityKey: null, unitBasis: null });
  save(store, { offers: [unknown] });
  const result = history(store, { source: unknown, perUnit: { basis: null } });
  assert.equal(result.status, 'incomparable');
  assert.equal(result.lastPromo, 3);
  assert.equal(result.deltaFromLastCents, null);
  assert.equal(result.unitComparison.status, 'basis_unreported');
  assert.equal(history(store, { source: { productId: null, itemId: null, price: {} } }).status, 'incomparable');
});

test('date-invalid/future/expired price windows cannot become qualified history', t => {
  const { store } = setup(t);
  save(store, { offers: [offer({ price: { regular: 5, promo: 3,
    effectiveDate: { value: '2026-02-01T00:00:00Z', timezone: 'UTC' } } })] });
  assert.equal(history(store).status, 'incomparable');
  assert.equal(history(store).lastPromo, null);
  save(store, { id: 'valid', observedAt: SECOND });
  const expiredCurrent = history(store, offer({ price: { regular: 5, promo: 3,
    expirationDate: { value: '2026-01-04T00:00:00Z', timezone: 'UTC' } } }));
  assert.equal(expiredCurrent.status, 'incomparable');
  assert.equal(expiredCurrent.deltaFromLastCents, null);
  const differentBasis = history(store, offer({ unitBasis: 'lb' }));
  assert.equal(differentBasis.unitComparison.status, 'no_history');
  const impossibleDate = history(store, offer({ price: { regular: 5, promo: 3,
    effectiveDate: { value: '2026-02-31T00:00:00Z', timezone: 'UTC' } } }));
  assert.equal(impossibleDate.status, 'incomparable');
});

test('overlapping topics retain both memberships without inventing two historical collection periods', t => {
  const { store } = setup(t);
  const write = (runId, other) => {
    store.startRun({ runId, sourceId: SOURCE, startedAt: FIRST, targetCount: 2, limit: 10 });
    return store.completeRun({ runId, sourceId: SOURCE, finishedAt: FIRST, jobs: [
      { jobKey: `${runId}-milk`, locationId: 'TEST0001', term: 'milk', observedAt: FIRST, returnedProductCount: 1, offers: [offer()] },
      { jobKey: `${runId}-bread`, locationId: 'TEST0001', term: 'bread', observedAt: FIRST, returnedProductCount: 1, offers: [other] },
    ] });
  };
  assert.equal(write('same-item', offer()).observationCount, 2);
  assert.equal(store.getSummary().observations, 2);
  assert.equal(history(store).observationCount, 1);
  assert.equal(history(store).status, 'insufficient_history');
  assert.throws(() => write('topic-conflict', offer({ price: { regular: 5, promo: 1 } })), { code: 'history_input_invalid' });
  assert.equal(store.getSummary().observations, 2);
});

test('permission scope, all three purposes, retention, expiration and revocation exclude rows', t => {
  const { store } = setup(t);
  for (const missing of ['historical-price-collection', 'historical-price-display', 'historical-agent-access']) {
    assert.throws(() => validateSourcePolicy(policy({ allowedPurposes: policy().allowedPurposes.filter(p => p !== missing) }), { now: FIRST }));
  }
  assert.equal(store.getSourcePermission(SOURCE, FIRST, [{ locationId: 'TEST9999', term: 'milk' }]).status, 'permission_required');
  assert.equal(store.getSourcePermission(SOURCE, FIRST, [{ locationId: 'TEST0001', term: 'unapproved' }]).status, 'permission_required');
  save(store);
  assert.equal(history(store, offer(), { asOf: '2026-02-02T12:00:00.000Z' }).status, 'no_observations');
  assert.equal(store.purgeExpired({ sourceId: SOURCE, now: '2026-02-02T12:00:00.000Z' }).removedObservations, 1);
  save(store, { id: 'later', observedAt: '2026-03-01T12:00:00.000Z' });
  assert.equal(store.getSourcePermission(SOURCE, '2027-01-01T00:00:00.000Z').status, 'permission_required');
  assert.equal(store.revokeSource(SOURCE, { now: '2026-03-02T12:00:00.000Z' }).removedObservations, 0);
  assert.equal(history(store, offer(), { asOf: '2026-03-03T12:00:00.000Z' }).status, 'permission_required');
  assert.equal(store.purgeExpired({ sourceId: SOURCE, now: '2026-03-03T12:00:00.000Z' }).removedObservations, 1);
  assert.throws(() => store.recordSourcePolicy(policy(), { now: AS_OF }), { code: 'source_revoked' });
});

test('scope and source rights are rechecked inside atomic write; no collection using pending source', t => {
  const { store } = setup(t);
  store.startRun({ runId: 'outside', sourceId: SOURCE, startedAt: FIRST, targetCount: 1, limit: 10 });
  assert.throws(() => store.completeRun({ runId: 'outside', sourceId: SOURCE, finishedAt: FIRST,
    jobs: [{ jobKey: 'outside', locationId: 'TEST0001', term: 'unapproved', observedAt: FIRST, returnedProductCount: 1, offers: [offer()] }] }),
  { code: 'source_permission_required' });
  assert.equal(store.getSummary().observations, 0);
  const unchanged = policy();
  assert.equal(store.recordSourcePolicy(unchanged, { now: FIRST }).status, 'policy_recorded');
  assert.throws(() => store.recordSourcePolicy(policy({ retentionDays: 31 }), { now: FIRST }), { code: 'source_policy_conflict' });
  assert.throws(() => validateSourcePolicy(policy({ evidenceReference: 'This is a permission document body.' }), { now: FIRST }), { code: 'source_policy_invalid' });
});

test('tightened retention applies immediately and a later wider grant never revives expired rows', t => {
  const { store } = setup(t);
  save(store);
  const narrowed = policy({ evidenceReference: 'narrowed-permission', reviewReference: 'narrowed-review',
    verifiedAt: '2026-01-04T00:00:00.000Z', retentionDays: 1 });
  const now = '2026-01-04T01:00:00.000Z';
  store.recordSourcePolicy(narrowed, { now });
  assert.equal(history(store, offer(), { asOf: now }).status, 'no_observations');
  store.recordSourcePolicy({ ...narrowed, evidenceReference: 'wider-permission', reviewReference: 'wider-review', retentionDays: 30 }, { now });
  assert.equal(history(store, offer(), { asOf: now }).status, 'no_observations');
  assert.equal(store.purgeExpired({ sourceId: SOURCE, now }).removedObservations, 1);
  assert.equal(history(store, offer(), { asOf: now }).status, 'no_observations');
});

test('renewing source expiry never extends the original grant or observation retention limit', t => {
  const { store } = setup(t);
  store.recordSourcePolicy(policy({ evidenceReference: 'short-original', reviewReference: 'short-review',
    expiresAt: '2026-01-10T00:00:00.000Z' }), { now: FIRST });
  save(store);
  store.recordSourcePolicy(policy({ evidenceReference: 'longer-new', reviewReference: 'longer-review',
    verifiedAt: '2026-01-05T00:00:00.000Z', retentionDays: 100 }), { now: '2026-01-05T00:00:00.000Z' });
  const now = '2026-01-11T00:00:00.000Z';
  assert.equal(store.getSourcePermission(SOURCE, now).status, 'permitted');
  assert.equal(history(store, offer(), { asOf: now }).status, 'no_observations');
  assert.equal(store.purgeExpired({ sourceId: SOURCE, now }).removedObservations, 1);
});

test('current store and topic narrowing exclude only provable in-scope history and purge the rest', t => {
  const { store } = setup(t);
  save(store);
  save(store, { id: 'store-two', locationId: 'TEST0002' });
  const bread = offer({ productId: 'bread-product', itemId: 'bread-item' });
  save(store, { id: 'bread', term: 'bread', offers: [bread] });
  store.recordSourcePolicy(policy({ evidenceReference: 'scope-narrowed', reviewReference: 'scope-review',
    verifiedAt: '2026-01-04T00:00:00.000Z', allowedLocationIds: ['TEST0001'], allowedTopics: ['bread'] }), { now: AS_OF });
  assert.equal(history(store).status, 'no_observations');
  assert.equal(history(store, offer(), { locationId: 'TEST0002' }).status, 'permission_required');
  assert.equal(history(store, bread).lastPromo, 3);
  assert.equal(store.purgeExpired({ sourceId: SOURCE, now: AS_OF }).removedObservations, 2);
  assert.equal(store.getSummary().observations, 1);
  assert.equal(history(store, bread).lastPromo, 3);
});

test('old policy replays and backdated new policies cannot undo the current store/topic restriction', t => {
  const { store } = setup(t);
  const narrowed = policy({ evidenceReference: 'current-scope', reviewReference: 'current-review',
    verifiedAt: SECOND, allowedLocationIds: ['TEST0001'], allowedTopics: ['bread'] });
  store.recordSourcePolicy(narrowed, { now: AS_OF });
  const deniedTarget = [{ locationId: 'TEST0002', term: 'milk' }];
  assert.equal(store.getSourcePermission(SOURCE, AS_OF, deniedTarget).status, 'permission_required');
  assert.throws(() => store.recordSourcePolicy(policy(), { now: AS_OF }), { code: 'source_policy_superseded' });
  assert.throws(() => store.recordSourcePolicy(policy({ evidenceReference: 'previously-unseen-old-policy',
    reviewReference: 'backdated-review', verifiedAt: FIRST }), { now: AS_OF }), { code: 'source_policy_superseded' });
  assert.equal(store.getSourcePermission(SOURCE, AS_OF, deniedTarget).status, 'permission_required');
  assert.equal(store.recordSourcePolicy(narrowed, { now: AS_OF }).status, 'policy_recorded');
  assert.equal(store.getSourcePermission(SOURCE, AS_OF, [{ locationId: 'TEST0001', term: 'bread' }]).status, 'permitted');
  // A different old file with the same verification instant is still superseded.
  const sameInstant = policy({ evidenceReference: 'same-instant-new-review', reviewReference: 'same-instant-review',
    verifiedAt: SECOND, allowedLocationIds: ['TEST0001'], allowedTopics: ['bread'] });
  store.recordSourcePolicy(sameInstant, { now: AS_OF });
  assert.throws(() => store.recordSourcePolicy(narrowed, { now: AS_OF }), { code: 'source_policy_superseded' });
});

test('known v1 files migrate atomically and reopen; unknown legacy topic provenance is never guessed', t => {
  const { folder } = setup(t, { approved: false });
  const filename = join(folder, 'legacy-v1.sqlite');
  const migration = readFileSync(new URL('../migrations/001-history.sql', import.meta.url), 'utf8');
  const legacy = new Database(filename);
  legacy.exec(migration);
  legacy.pragma('application_id = 1212763211');
  legacy.pragma('user_version = 1');
  legacy.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(createHash('sha256').update(migration).digest('hex'), Date.parse(FIRST));
  legacy.prepare('INSERT INTO sources VALUES (?, ?, ?, ?, ?)').run(SOURCE, 'Legacy fixture source', 'verified', 1, Date.parse(FIRST));
  legacy.prepare(`INSERT INTO source_rights VALUES (1, ?, 'verified', ?, ?, ?, ?, 30, 1, 1, 1, ?, ?)`)
    .run(SOURCE, 'legacy-permission', 'legacy-review', Date.parse('2026-01-01T00:00:00.000Z'), Date.parse('2026-12-31T00:00:00.000Z'),
      JSON.stringify(['TEST0001']), JSON.stringify(['milk']));
  legacy.prepare(`INSERT INTO collection_runs VALUES ('legacy-run', ?, ?, ?, 'completed', NULL, 1, 10, 1, 'bounded_topic_sample')`)
    .run(SOURCE, Date.parse(FIRST), Date.parse(FIRST));
  legacy.prepare(`INSERT INTO collection_jobs VALUES (1, ?, 'legacy-key', 'legacy-run', 'TEST0001', ?, 1)`).run(SOURCE, Date.parse(FIRST));
  legacy.prepare(`INSERT INTO observations(job_id,source_id,rights_id,location_id,product_id,item_id,size,sold_by,currency,
    price_basis,modality,eligibility_key,regular_cents,promo_cents,date_qualified,observed_at,retain_until)
    VALUES (1, ?, 1, 'TEST0001', 'fixture-product', 'fixture-item', '12 oz', 'unit', 'USD', 'one-package', 'IN_STORE',
      'all-shoppers', 500, 300, 1, ?, ?)`)
    .run(SOURCE, Date.parse(FIRST), Date.parse('2026-02-01T12:00:00.000Z'));
  legacy.close();
  const migrated = openHistoryStore({ filename });
  assert.equal(migrated.getSummary().schemaVersion, 6);
  assert.equal(migrated.getSummary().observations, 1);
  assert.equal(history(migrated).status, 'no_observations');
  assert.equal(migrated.purgeExpired({ sourceId: SOURCE, now: AS_OF }).removedObservations, 1);
  migrated.close();
  const reopened = openHistoryStore({ filename });
  try { assert.equal(reopened.getSummary().schemaVersion, 6); assert.equal(reopened.getSummary().observations, 0); }
  finally { reopened.close(); }
});

test('opaque product IDs are bound as data, never interpolated into SQL', t => {
  const { store } = setup(t);
  const injected = offer({ productId: "fixture'); DROP TABLE observations; --" });
  save(store, { offers: [injected] });
  assert.equal(history(store, injected).lastPromo, 3);
  assert.equal(history(store).status, 'no_observations');
  assert.equal(store.getSummary().observations, 1);
});

test('unknown schema is refused without overwrite; linked parents and in-memory paths are refused', t => {
  const { folder } = setup(t, { approved: false });
  const other = join(folder, 'unrelated.sqlite');
  const original = new Database(other);
  original.exec('CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES (\'preserve\')');
  original.close();
  const before = readFileSync(other);
  assert.throws(() => openHistoryStore({ filename: other }), { code: 'history_schema_unknown' });
  assert.deepEqual(readFileSync(other), before);
  const malformed = join(folder, 'malformed.sqlite');
  const partial = new Database(malformed);
  partial.pragma('application_id = 1212763211');
  partial.pragma('user_version = 1');
  partial.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT, applied_at INTEGER)');
  partial.close();
  assert.throws(() => openHistoryStore({ filename: malformed }), { code: 'history_schema_unknown' });
  assert.throws(() => openHistoryStore({ filename: ':memory:' }), { code: 'history_path_invalid' });
  const real = join(folder, 'real'); mkdirSync(real);
  const linked = join(folder, 'linked'); symlinkSync(real, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => openHistoryStore({ filename: join(linked, 'history.sqlite') }), { code: 'history_path_linked' });
});
