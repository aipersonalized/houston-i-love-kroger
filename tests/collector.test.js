import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openHistoryStore } from '../src/history-store.js';
import { DEFAULT_COLLECTION_PLAN, runCollection, validateCollectionPlan } from '../src/collector.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const NOW = '2026-01-02T12:00:00.000Z';
const SOURCE = 'fixture-source';
const PLAN = { ...DEFAULT_COLLECTION_PLAN, sourceId: SOURCE, enabled: true, targets: [{ locationId: 'TEST0001', term: 'milk' }] };
const POLICY = { sourceId: SOURCE, sourceLabel: 'Deterministic test source', status: 'verified',
  evidenceReference: 'fixture-permission', reviewReference: 'fixture-review', verifiedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-12-31T00:00:00.000Z', retentionDays: 30,
  allowedPurposes: ['historical-price-collection', 'historical-price-display', 'historical-agent-access'],
  allowedLocationIds: ['TEST0001'], allowedTopics: ['milk', 'bread'] };
const PRODUCTS = [{ productId: 'fixture-product', items: [{ itemId: 'fixture-item', size: '12 oz', soldBy: 'unit',
  fulfillment: { instore: true }, price: { regular: 5, promo: 3, promoPerUnitEstimate: 0.25 } }] }];
function setup(t, approved = true) {
  const folder = mkdtempSync(join(tmpdir(), 'kroger-collector-test-'));
  const filename = join(folder, 'history.sqlite');
  const store = openHistoryStore({ filename });
  t.after(() => {
    store.close();
    assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + '\\') || resolve(folder).startsWith(resolve(tmpdir()) + '/'));
    rmSync(folder, { recursive: true, force: true });
  });
  if (approved) store.recordSourcePolicy(POLICY, { now: NOW });
  return { store, folder, filename };
}

test('blocked collector reports every prerequisite and makes zero calls or observations', async t => {
  const { store } = setup(t, false);
  let calls = 0;
  const client = { configured: false, async searchProducts() { calls++; throw new Error('must not call'); } };
  const result = await runCollection({ store, client, planProvided: false, now: () => NOW });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers.map(b => b.code), ['permission_required', 'configuration_required', 'targets_required', 'collection_disabled', 'plan_required']);
  assert.equal(calls, 0);
  assert.equal(store.getSummary().observations, 0);
  assert.equal(store.getSummary().completedRuns, 0);
});

test('permitted injected source creates real rows; repeated scheduled job skips all network', async t => {
  const { store } = setup(t);
  let calls = 0;
  const client = { configured: true, async searchProducts(locationId, term, options) {
    calls++;
    assert.equal(locationId, 'TEST0001'); assert.equal(term, 'milk'); assert.equal(options.limit, 20);
    return PRODUCTS;
  } };
  const first = await runCollection({ store, client, plan: PLAN, now: () => NOW, runId: 'fixture-run' });
  assert.equal(first.status, 'completed');
  assert.equal(first.observationsWritten, 1);
  assert.equal(first.coverage.completeCatalog, false);
  assert.equal(store.getSummary().observations, 1);
  const second = await runCollection({ store, client, plan: PLAN, now: () => NOW, runId: 'fixture-run-repeat' });
  assert.equal(second.status, 'already_collected');
  assert.equal(second.observationsWritten, 0);
  assert.equal(calls, 1);
  const result = store.getComparisons({ sourceId: SOURCE, locationId: 'TEST0001', asOf: '2026-01-03T12:00:00.000Z',
    offers: [{ source: { productId: 'fixture-product', itemId: 'fixture-item', size: '12 oz', soldBy: 'unit', price: { regular: 5, promo: 3 } } }] });
  assert.equal(result.histories[0].lastPromo, 3);
  assert.equal(result.histories[0].status, 'incomparable');
  assert.equal(result.histories[0].unitComparison.status, 'basis_unreported');
});

test('second target failure saves no partial history or completed jobs; fixed failure leaks no raw errors', async t => {
  const { store } = setup(t);
  let calls = 0;
  const client = { configured: true, async searchProducts() {
    calls++; if (calls === 2) throw new Error('private test marker'); return PRODUCTS;
  } };
  const plan = { ...PLAN, targets: [...PLAN.targets, { locationId: 'TEST0001', term: 'bread' }] };
  const result = await runCollection({ store, client, plan, now: () => NOW, runId: 'failed-fixture' });
  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'upstream_failed');
  assert.equal(result.observationsWritten, 0);
  assert.equal(store.getSummary().observations, 0);
  assert.equal(store.getSummary().failedRuns, 1);
  assert.equal(JSON.stringify(result).includes('private test marker'), false);
});

test('duplicate payloads deduplicate and unsupported finite prices replace older promotions explicitly', async t => {
  const { store } = setup(t);
  const client = { configured: true, async searchProducts() { return [PRODUCTS[0], PRODUCTS[0]]; } };
  const first = await runCollection({ store, client, plan: PLAN, now: () => NOW, runId: 'duplicates' });
  assert.equal(first.status, 'completed'); assert.equal(first.observationsWritten, 1);
  const malformed = { configured: true, async searchProducts() {
    return [{ productId: 'new', items: [{ itemId: 'new', price: { regular: 3, promo: 1.234 } }] }];
  } };
  const written = await runCollection({ store, client: malformed, plan: PLAN, now: () => '2026-01-03T12:00:00.000Z', runId: 'bad-price' });
  assert.equal(written.status, 'completed'); assert.equal(written.observationsWritten, 1);
  assert.equal(store.getSummary().observations, 2);
  const row = store.searchPromotions({ sourceId: SOURCE, locationId: 'TEST0001', asOf: '2026-01-03T12:00:00.000Z' }).observations[0];
  assert.equal(row.price.promo, null);
  assert.equal(row.priceQualification, 'unsupported_source_price');
  const invalid = { configured: true, async searchProducts() {
    return [{ productId: 'new', items: [{ itemId: 'new', price: { regular: 3, promo: 'private-invalid-number' } }] }];
  } };
  const failed = await runCollection({ store, client: invalid, plan: PLAN, now: () => '2026-01-04T12:00:00.000Z', runId: 'invalid-price-type' });
  assert.equal(failed.status, 'failed'); assert.equal(failed.category, 'unsupported_response');
  assert.equal(store.getSummary().observations, 2);
});

test('a zero no-promotion price does not abort a mixed sample or invent a free promotion', async t => {
  const { store } = setup(t);
  const client = { configured: true, async searchProducts() {
    return [...PRODUCTS, { productId: 'nonpromo-product', items: [{ itemId: 'nonpromo-item', size: '12 oz', soldBy: 'unit',
      price: { regular: 5, promo: 0, regularPerUnitEstimate: 0, promoPerUnitEstimate: 0 } }] }];
  } };
  const result = await runCollection({ store, client, plan: PLAN, now: () => NOW, runId: 'zero-plus-promo' });
  assert.equal(result.status, 'completed'); assert.equal(result.observationsWritten, 2);
  const prior = store.getComparisons({ sourceId: SOURCE, locationId: 'TEST0001', asOf: '2026-01-03T12:00:00.000Z',
    offers: [{ source: { productId: 'nonpromo-product', itemId: 'nonpromo-item', size: '12 oz', soldBy: 'unit', price: { regular: 5, promo: 3 } } }] });
  assert.equal(prior.histories[0].status, 'incomparable');
  assert.equal(prior.histories[0].lastPromo, null); assert.equal(prior.histories[0].deltaFromLastCents, null);
});

test('scope, expiry, revocation, disablement, invalid plan and dry run block source calls', async t => {
  const { store } = setup(t);
  let calls = 0;
  const client = { configured: true, async searchProducts() { calls++; return PRODUCTS; } };
  for (const options of [
    { plan: { ...PLAN, enabled: false } },
    { plan: { ...PLAN, targets: [{ locationId: 'TEST9999', term: 'milk' }] } },
    { plan: { ...PLAN, targets: [{ locationId: 'TEST0001', term: 'unapproved' }] } },
    { plan: { ...PLAN, limit: 51 } },
    { now: () => '2027-01-01T00:00:00.000Z' },
    { dryRun: true },
  ]) {
    const result = await runCollection({ store, client, plan: PLAN, now: () => NOW, ...options });
    assert.ok(['blocked', 'dry_run'].includes(result.status));
  }
  store.revokeSource(SOURCE, { now: NOW });
  assert.equal((await runCollection({ store, client, plan: PLAN, now: () => NOW })).status, 'blocked');
  assert.equal(calls, 0);
});

test('bounded plans reject catalog crawl, ZIPs, extra fields and unsupported fulfillment', () => {
  for (const change of [{ limit: 200 }, { targets: Array(11).fill(PLAN.targets[0]) }, { intervalMinutes: 0 },
    { maxRuns: 1000 }, { zipCode: '00000' }, { targets: [{ locationId: 'TEST0001', term: 'milk', fulfillment: 'DELIVERY' }] },
    { targets: [{ locationId: 'TEST0001', term: 'mi' }] }]) assert.throws(() => validateCollectionPlan({ ...PLAN, ...change }));
});

test('permission expiration while a fetch is in flight discards the buffered run', async t => {
  const { store } = setup(t);
  store.recordSourcePolicy({ ...POLICY, evidenceReference: 'short-fixture-permission', reviewReference: 'short-fixture-review',
    expiresAt: '2026-01-02T13:00:00.000Z' }, { now: NOW });
  let time = NOW;
  const client = { configured: true, async searchProducts() { time = '2026-01-02T14:00:00.000Z'; return PRODUCTS; } };
  const result = await runCollection({ store, client, plan: PLAN, now: () => time, runId: 'expired-during-fetch' });
  assert.equal(result.status, 'failed'); assert.equal(result.category, 'source_permission_required');
  assert.equal(store.getSummary().observations, 0); assert.equal(store.getSummary().failedRuns, 1);
});

function cli(script, args, env = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, KROGER_CLIENT_ID: '', KROGER_CLIENT_SECRET: '', KROGER_ENVIRONMENT: 'production', ...env } });
}
test('CLI help, JSON blockers and invalid arguments are clean and bounded; blocked watch exits', t => {
  const { folder, filename } = setup(t, false);
  const planFile = join(folder, 'plan.json'); writeFileSync(planFile, JSON.stringify(DEFAULT_COLLECTION_PLAN));
  const help = cli('collect-history.js', ['--help']);
  assert.equal(help.status, 0); assert.match(help.stdout, /--source-policy/); assert.equal(help.stderr, '');
  const blocked = cli('collect-history.js', ['--plan', planFile, '--database', filename, '--watch', '--max-runs', '2', '--json', '--no-input']);
  assert.equal(blocked.status, 3, blocked.stderr);
  const result = JSON.parse(blocked.stdout);
  assert.equal(result.status, 'blocked'); assert.equal(result.runs, 1); assert.equal(result.requests, 0);
  assert.equal(result.blockers.length, 4);
  assert.equal(blocked.stdout.includes(folder), false); assert.equal(blocked.stdout.includes('\u001b'), false);
  const invalid = cli('collect-history.js', ['--unrecognized', '--json']);
  assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stdout).code, 'invalid_arguments');
  assert.equal(invalid.stderr, '');
  const wrongSourcePlan = join(folder, 'wrong-source.json'); writeFileSync(wrongSourcePlan, JSON.stringify(PLAN));
  const wrongSource = cli('collect-history.js', ['--plan', wrongSourcePlan, '--database', filename, '--json']);
  assert.equal(wrongSource.status, 2); assert.equal(JSON.parse(wrongSource.stdout).code, 'collection_setup_invalid');
  const certification = cli('collect-history.js', ['--plan', planFile, '--database', filename, '--json'], { KROGER_ENVIRONMENT: 'certification' });
  assert.equal(certification.status, 2);
});

test('CLI dry runs create no database and initialization is idempotent with valid JSON', t => {
  const { folder } = setup(t, false);
  const fresh = join(folder, 'fresh.sqlite');
  const planFile = join(folder, 'plan.json'); writeFileSync(planFile, JSON.stringify(DEFAULT_COLLECTION_PLAN));
  const dry = cli('collect-history.js', ['--database', fresh, '--plan', planFile, '-n', '--json']);
  assert.equal(dry.status, 0); assert.equal(JSON.parse(dry.stdout).status, 'dry_run'); assert.equal(existsSync(fresh), false);
  const initDry = cli('init-history.js', ['--database', fresh, '--dry-run', '--json']);
  assert.equal(initDry.status, 0); assert.equal(existsSync(fresh), false);
  const blankEnvPath = cli('collect-history.js', ['--plan', planFile, '--dry-run', '--json'], { HISTORY_DB_PATH: '' });
  assert.equal(blankEnvPath.status, 0); assert.equal(JSON.parse(blankEnvPath.stdout).status, 'dry_run');
  const blankExplicitPath = cli('collect-history.js', ['--plan', planFile, '--database', '', '--dry-run', '--json']);
  assert.equal(blankExplicitPath.status, 2);
  const blankMaintenanceEnv = cli('maintain-history.js', ['--dry-run', '--json'], { HISTORY_DB_PATH: '' });
  assert.equal(blankMaintenanceEnv.status, 0); assert.equal(JSON.parse(blankMaintenanceEnv.stdout).status, 'dry_run');
  for (let i = 0; i < 2; i++) {
    const initialized = cli('init-history.js', ['--database', `  "${fresh}"  `, '--json', '--no-input', '--no-color']);
    assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
    assert.equal(JSON.parse(initialized.stdout).observations, 0);
  }
});

test('maintenance CLI status/help/preview/unknown source do not change retained facts or create missing files', async t => {
  const { store, folder, filename } = setup(t);
  const collected = await runCollection({ store, client: { configured: true, async searchProducts() { return PRODUCTS; } },
    plan: PLAN, now: () => NOW, runId: 'maintenance-fixture' });
  assert.equal(collected.status, 'completed');
  const before = store.getSummary();
  const status = cli('maintain-history.js', ['--database', filename, '--source', SOURCE, '--json', '--no-input']);
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).action, 'status');
  assert.equal(JSON.parse(status.stdout).observations, 1);
  const help = cli('maintain-history.js', ['--help']);
  assert.equal(help.status, 0); assert.match(help.stdout, /--revoke-source/);
  const preview = cli('maintain-history.js', ['--database', filename, '--revoke-source', SOURCE, '--purge', '--dry-run', '--json']);
  assert.equal(preview.status, 0); assert.equal(JSON.parse(preview.stdout).status, 'dry_run');
  assert.deepEqual(store.getSummary(), before);
  assert.equal(store.getSourceStatus(SOURCE).status, 'verified');
  const unknown = cli('maintain-history.js', ['--database', filename, '--revoke-source', 'unknown-fixture', '--purge', '--json']);
  assert.equal(unknown.status, 2); assert.equal(JSON.parse(unknown.stdout).code, 'source_unknown');
  assert.deepEqual(store.getSummary(), before);
  const invalid = cli('maintain-history.js', ['--purge', '--json']);
  assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stdout).code, 'invalid_arguments');
  const missingFile = join(folder, 'must-not-create.sqlite');
  const missing = cli('maintain-history.js', ['--database', missingFile, '--json']);
  assert.equal(missing.status, 1); assert.equal(existsSync(missingFile), false);
  const dryMissing = cli('maintain-history.js', ['--database', missingFile, '--purge-expired', '--dry-run', '--json']);
  assert.equal(dryMissing.status, 0); assert.equal(existsSync(missingFile), false);
  assert.equal(status.stdout.includes(filename), false); assert.equal(unknown.stdout.includes('fixture-permission'), false);
});

test('maintenance CLI scoped expiry purge and explicit revoke/purge preserve the other source', async t => {
  const { store, filename } = setup(t);
  const client = { configured: true, async searchProducts() { return PRODUCTS; } };
  const clock = Date.now();
  const observedAt = new Date(clock - 32 * 86_400_000).toISOString();
  const relativePolicy = { ...POLICY, verifiedAt: new Date(clock - 33 * 86_400_000).toISOString(),
    expiresAt: new Date(clock + 10 * 86_400_000).toISOString(), evidenceReference: 'relative-fixture-permission' };
  store.recordSourcePolicy(relativePolicy, { now: observedAt });
  await runCollection({ store, client, plan: PLAN, now: () => observedAt, runId: 'maintenance-expiry-fixture' });
  store.recordSourcePolicy({ ...relativePolicy, sourceId: 'other-fixture', evidenceReference: 'other-fixture-permission' }, { now: observedAt });
  await runCollection({ store, client, plan: { ...PLAN, sourceId: 'other-fixture' }, now: () => observedAt, runId: 'maintenance-other-fixture' });
  assert.equal(store.getSummary().observations, 2);
  const expired = cli('maintain-history.js', ['--database', filename, '--purge-expired', '--source', SOURCE, '--json', '--no-color']);
  assert.equal(expired.status, 0, expired.stderr); assert.equal(JSON.parse(expired.stdout).removedObservations, 1);
  assert.equal(store.getSummary().observations, 1);
  assert.equal(store.getSourceStatus('other-fixture').status, 'verified');
  const revoke = cli('maintain-history.js', ['--database', filename, '--revoke-source', 'other-fixture', '--purge', '--json', '--no-input']);
  assert.equal(revoke.status, 0, revoke.stderr); assert.equal(JSON.parse(revoke.stdout).removedObservations, 1);
  assert.equal(JSON.parse(revoke.stdout).sourceStatus, 'revoked');
  assert.equal(store.getSummary().observations, 0);
  const repeated = cli('maintain-history.js', ['--database', filename, '--revoke-source', 'other-fixture', '--purge', '--json']);
  assert.equal(repeated.status, 0); assert.equal(JSON.parse(repeated.stdout).removedObservations, 0);
});
