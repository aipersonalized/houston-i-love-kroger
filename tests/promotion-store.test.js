import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openHistoryStore } from '../src/history-store.js';
import { SOURCE, FIRST, SECOND, AS_OF, policy, offer, setup, save, search, retrieve } from './promotion-fixtures.js';

test('search/retrieve persist genuine synthetic source facts and omit private policy/storage fields', t => {
  const fixture = setup(t);
  save(fixture.store);
  fixture.store.close();
  const store = fixture.reopen();
  const result = search(store);
  assert.equal(result.status, 'available');
  assert.equal(result.coverage.type, 'bounded_topic_sample');
  assert.deepEqual(result.page, { limit: 20, returned: 1, truncated: false, nextCursor: null });
  const row = result.observations[0];
  assert.equal(row.description, 'Synthetic whole milk');
  assert.equal(row.brand, 'Example dairy');
  assert.equal(row.promotionStatus, 'reported_promotion');
  assert.equal(row.price.promo, 3);
  assert.equal(row.observedAt, FIRST);
  assert.equal(retrieve(store, row.observationId).observation.price.promoCents, 300);
  for (const forbidden of ['rights_id', 'rightsId', 'evidenceReference', 'evidence_reference', 'reviewReference', 'retain_until', 'topic_key', 'synthetic-permission', 'synthetic-review']) {
    assert.equal(JSON.stringify(result).includes(forbidden), false, forbidden);
  }
  assert.equal(retrieve(store, row.observationId, { locationId: 'TEST0002' }).status, 'not_found');
  assert.equal(retrieve(store, '99999').status, 'not_found');
});

test('literal description/brand search, exact IDs, inclusive dates and selected stores never widen results', t => {
  const { store } = setup(t);
  const unusual = offer({ productId: "product'); DROP TABLE observations; --", itemId: 'opaque%_item', description: '100%_milk' });
  save(store, { offers: [unusual] });
  save(store, { id: 'second', observedAt: SECOND, offers: [offer({ itemId: 'second-item', description: 'Bread' })] });
  save(store, { id: 'other-store', locationId: 'TEST0002' });
  assert.equal(search(store, { term: '%_' }).observations.length, 1);
  assert.equal(search(store, { term: 'EXAMPLE DAIRY' }).observations.length, 2);
  assert.equal(search(store, { term: 'whole milk' }).observations.length, 0);
  assert.equal(search(store, { productId: unusual.productId, itemId: unusual.itemId }).observations.length, 1);
  assert.equal(search(store, { productId: 'synthetic-product', itemId: unusual.itemId }).observations.length, 0);
  assert.equal(search(store, { observedFrom: FIRST, observedTo: FIRST }).observations.length, 1);
  assert.equal(search(store, { observedFrom: SECOND }).observations[0].itemId, 'second-item');
  assert.equal(search(store, { term: "' OR 1=1 --" }).observations.length, 0);
  assert.equal(store.getSummary().observations, 3);
  for (const input of [{ locationId: '1' }, { locationId: 'TEST0001 ' }, { observedFrom: '2026-02-31T00:00:00Z' },
    { observedFrom: SECOND, observedTo: FIRST }, { observedTo: '2026-01-02' }, { term: 'x'.repeat(81) },
    { itemId: 'x\n' }, { term: '' }, { productId: null }, { itemId: '' },
    { limit: 0 }, { limit: 51 }, { limit: '20' }, { cursor: 'not-a-cursor' }]) {
    assert.throws(() => search(store, input), { code: 'history_input_invalid' });
  }
  for (const id of [0, '0', '-1', '1 OR 1=1', '01', '9007199254740992']) {
    assert.throws(() => retrieve(store, id), { code: 'history_input_invalid' });
  }
});

test('pagination is bounded, query-bound, stable across restart/new insert and reports truncation', t => {
  const fixture = setup(t);
  const offers = Array.from({ length: 5 }, (_, index) => offer({ itemId: `item-${index}` }));
  save(fixture.store, { offers });
  const first = search(fixture.store, { limit: 2 });
  assert.equal(first.page.returned, 2);
  assert.equal(first.page.truncated, true);
  assert.ok(first.page.nextCursor);
  save(fixture.store, { id: 'newer-insert', observedAt: SECOND, offers: [offer({ itemId: 'newly-inserted' })] });
  fixture.store.close();
  const store = fixture.reopen();
  const next = search(store, { limit: 2, cursor: first.page.nextCursor });
  const final = search(store, { limit: 2, cursor: next.page.nextCursor });
  assert.equal(final.page.truncated, false);
  assert.equal(final.page.nextCursor, null);
  const ids = [...first.observations, ...next.observations, ...final.observations].map(row => row.itemId);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  assert.equal(ids.includes('newly-inserted'), false);
  for (const input of [{ locationId: 'TEST0002' }, { term: 'milk' }, { limit: 3 }]) {
    assert.throws(() => search(store, { limit: 2, cursor: first.page.nextCursor, ...input }), { code: 'history_input_invalid' });
  }
});

test('pending source, revoked grant and expired data never become empty-history claims or authorized retrieval', t => {
  const { store } = setup(t, { approved: false });
  const pending = search(store);
  assert.equal(pending.status, 'permission_required');
  assert.equal(retrieve(store, '1').status, 'permission_required');
  assert.equal(store.getPromotionStatus({ sourceId: SOURCE, asOf: AS_OF }).status, 'permission_required');
  store.recordSourcePolicy(policy(), { now: FIRST });
  save(store);
  const row = search(store).observations[0];
  assert.equal(search(store, { asOf: '2026-02-02T12:00:00Z' }).observations.length, 0);
  assert.equal(retrieve(store, row.observationId, { asOf: '2026-02-02T12:00:00Z' }).status, 'not_found');
  assert.equal(search(store, { asOf: '2027-01-01T00:00:00Z' }).status, 'permission_required');
  store.revokeSource(SOURCE, { now: AS_OF });
  assert.equal(search(store).status, 'permission_required');
  assert.equal(retrieve(store, row.observationId).status, 'permission_required');
});

test('both original and current topic/store/purpose rights apply even if imported data is inconsistent', t => {
  const { store, filename } = setup(t);
  save(store);
  save(store, { id: 'store-two', locationId: 'TEST0002' });
  save(store, { id: 'bread', term: 'bread', offers: [offer({ itemId: 'bread-item', description: 'Bread' })] });
  const milkId = search(store, { term: 'milk' }).observations[0].observationId;
  store.recordSourcePolicy(policy({ evidenceReference: 'new-scope', reviewReference: 'scope-review',
    verifiedAt: AS_OF, allowedTopics: ['bread'], allowedLocationIds: ['TEST0001'] }), { now: AS_OF });
  assert.deepEqual(search(store).observations.map(row => row.itemId), ['bread-item']);
  const breadId = search(store).observations[0].observationId;
  assert.equal(retrieve(store, milkId).status, 'not_found');
  assert.equal(search(store, { locationId: 'TEST0002' }).status, 'permission_required');
  // This is a synthetic corruption fixture only. Broader current permission
  // cannot manufacture proof of original permission to keep/display the row.
  const fixtureDb = new Database(filename);
  try {
    const original = fixtureDb.prepare('SELECT min(rights_id) AS id FROM source_rights WHERE source_id = ?').get(SOURCE).id;
    for (const update of [
      ['allowed_topics', JSON.stringify(['milk'])], ['allowed_locations', JSON.stringify(['TEST0002'])],
      ['display_allowed', 0], ['agent_access_allowed', 0], ['collection_allowed', 0], ['status', 'revoked'],
    ]) {
      const before = fixtureDb.prepare(`SELECT ${update[0]} AS value FROM source_rights WHERE rights_id = ?`).get(original).value;
      fixtureDb.prepare(`UPDATE source_rights SET ${update[0]} = ? WHERE rights_id = ?`).run(update[1], original);
      assert.equal(search(store).observations.length, 0, update[0]);
      assert.equal(retrieve(store, breadId).status, 'not_found', update[0]);
      assert.equal(store.getComparisons({ sourceId: SOURCE, locationId: 'TEST0001', asOf: AS_OF,
        offers: [offer({ itemId: 'bread-item', description: 'Bread' })] }).histories[0].status, 'no_observations', update[0]);
      fixtureDb.prepare(`UPDATE source_rights SET ${update[0]} = ? WHERE rights_id = ?`).run(before, original);
    }
    fixtureDb.prepare("UPDATE collection_jobs SET topic_key = 'unknown' WHERE source_id = ?").run(SOURCE);
    assert.equal(search(store).observations.length, 0);
  } finally { fixtureDb.close(); }
});

test('renewal and broader retention never revive expired original data; old cursor rechecks rights', t => {
  const { store } = setup(t);
  store.recordSourcePolicy(policy({ evidenceReference: 'short-original', reviewReference: 'short-review', expiresAt: '2026-01-05T00:00:00Z' }), { now: FIRST });
  save(store, { offers: [offer(), offer({ itemId: 'item-2' })] });
  const first = search(store, { limit: 1 });
  store.recordSourcePolicy(policy({ evidenceReference: 'renewed', reviewReference: 'renewed-review', verifiedAt: AS_OF }), { now: AS_OF });
  assert.equal(search(store, { asOf: '2026-01-06T00:00:00Z' }).observations.length, 0);
  assert.equal(retrieve(store, first.observations[0].observationId, { asOf: '2026-01-06T00:00:00Z' }).status, 'not_found');
  store.recordSourcePolicy(policy({ evidenceReference: 'tight', reviewReference: 'tight-review', verifiedAt: AS_OF, retentionDays: 1 }), { now: AS_OF });
  store.recordSourcePolicy(policy({ evidenceReference: 'wide', reviewReference: 'wide-review', verifiedAt: AS_OF, retentionDays: 365 }), { now: AS_OF });
  assert.equal(search(store).observations.length, 0);
  assert.equal(search(store, { limit: 1, cursor: first.page.nextCursor }).observations.length, 0);
});

test('source zero/regular prices, unqualified dates and missing metadata preserve facts without invented offers', t => {
  const { store } = setup(t);
  save(store, { offers: [
    offer({ itemId: 'zero', description: null, brand: null, price: { regular: 5, promo: 0 } }),
    offer({ itemId: 'regular-only', price: { regular: 5 } }),
    offer({ itemId: 'undated', price: { regular: 5, promo: 3, effectiveDate: { value: '2026-02-31T00:00:00Z', timezone: 'UTC' } } }),
  ] });
  const rows = search(store).observations;
  assert.ok(rows.every(row => row.promotionStatus === 'not_verified_promotion'));
  assert.equal(rows.find(row => row.itemId === 'zero').price.promo, 0);
  assert.equal(rows.find(row => row.itemId === 'zero').description, null);
  assert.equal(rows.find(row => row.itemId === 'regular-only').price.promo, null);
  assert.equal(rows.find(row => row.itemId === 'undated').dateQualification, 'unqualified');
});

test('exact known v2 schema upgrades additively without fabricating old descriptions or changing prices', t => {
  const fixture = setup(t, { approved: false });
  const filename = join(fixture.folder, 'version-two.sqlite');
  const legacy = new Database(filename);
  for (const [index, name] of ['001-history.sql', '002-history-scope.sql'].entries()) {
    const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    legacy.exec(sql);
    legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(index + 1, createHash('sha256').update(sql).digest('hex'), Date.parse(FIRST));
  }
  legacy.pragma('application_id = 1212763211'); legacy.pragma('user_version = 2');
  legacy.prepare('INSERT INTO sources VALUES (?, ?, ?, ?, ?)').run(SOURCE, 'Synthetic legacy source', 'verified', 1, Date.parse(FIRST));
  legacy.prepare(`INSERT INTO source_rights VALUES (1, ?, 'verified', 'legacy-evidence', 'legacy-review', ?, ?, 30, 1, 1, 1, ?, ?)`)
    .run(SOURCE, Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-12-31T00:00:00Z'), JSON.stringify(['TEST0001']), JSON.stringify(['milk']));
  legacy.prepare(`INSERT INTO collection_runs VALUES ('legacy', ?, ?, ?, 'completed', NULL, 1, 10, 1, 'bounded_topic_sample')`)
    .run(SOURCE, Date.parse(FIRST), Date.parse(FIRST));
  legacy.prepare(`INSERT INTO collection_jobs VALUES (1, ?, 'legacy-job', 'legacy', 'TEST0001', ?, 1, ?)`)
    .run(SOURCE, Date.parse(FIRST), createHash('sha256').update('milk').digest('hex'));
  legacy.prepare(`INSERT INTO observations(job_id,source_id,rights_id,location_id,product_id,item_id,
    regular_cents,promo_cents,date_qualified,observed_at,retain_until)
    VALUES (1, ?, 1, 'TEST0001', 'legacy-product', 'legacy-item', 500, 300, 1, ?, ?)`)
    .run(SOURCE, Date.parse(FIRST), Date.parse('2026-02-01T00:00:00Z'));
  legacy.close();
  // The synthetic v2 file must go through the production schema verifier.
  const upgraded = openHistoryStore({ filename });
  try {
    assert.equal(upgraded.getSummary().schemaVersion, 5);
    assert.equal(upgraded.getSummary().observations, 1);
    const row = search(upgraded).observations[0];
    assert.equal(row.description, null); assert.equal(row.brand, null);
    assert.equal(row.price.regularCents, 500); assert.equal(row.price.promoCents, 300);
    assert.equal(search(upgraded, { term: 'milk' }).observations.length, 0);
    assert.equal(search(upgraded, { productId: 'legacy-product' }).observations.length, 1);
    assert.equal(upgraded.getLatestDeals({ sourceId: SOURCE, locationId: 'TEST0001', topic: 'milk', asOf: FIRST }).reason, 'snapshot_not_readable');
  } finally { upgraded.close(); }
  const checked = new Database(filename, { readonly: true });
  try {
    const columns = checked.prepare('PRAGMA table_info(observations)').all().map(row => row.name);
    assert.ok(columns.includes('description')); assert.ok(columns.includes('brand'));
    assert.equal(checked.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 5);
  } finally { checked.close(); }
});
