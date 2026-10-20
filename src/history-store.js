import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validPriceSearchRequest, validEstimateRequest, storedAvailability, storedPriceDecision,
  priceQualificationGaps, estimateStoredLine, storedEstimateTotals } from './stored-pricing.js';
import { createDirectoryStore, DIRECTORY_SOURCE } from './store-directory.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIGRATIONS = ['001-history.sql', '002-history-scope.sql', '003-observation-description.sql', '004-latest-deals.sql', '005-collection-control.sql', '006-store-directory.sql'].map((filename, index) => {
  const sql = readFileSync(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
  return { version: index + 1, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const SCHEMA_VERSION = MIGRATIONS.length;
const APPLICATION_ID = 0x48494c4b;
const DAY = 86_400_000;
export const DEFAULT_PROMOTION_MAX_AGE_SECONDS = 86_400;
const PURPOSES = ['historical-price-collection', 'historical-price-display', 'historical-agent-access'];
const REQUIRED_TABLES = ['schema_migrations', 'sources', 'source_rights', 'collection_runs', 'collection_jobs', 'observations'];
function topicKey(topic) { return createHash('sha256').update(topic).digest('hex'); }

export class HistoryError extends Error {
  constructor(code, message) { super(message); this.name = 'HistoryError'; this.code = code; }
}

function fail(code = 'history_input_invalid', message = 'History input is invalid. Check the documented fields and try again.') {
  throw new HistoryError(code, message);
}
function text(value, max = 200, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) fail();
    return null;
  }
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || value.trim() !== value) fail();
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(value)) fail();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) fail();
  return ms;
}
function estimate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) fail();
  return value;
}
function capturedPrice(cents, decimal) {
  if (cents !== undefined && cents !== null && !Number.isSafeInteger(cents)) fail();
  const reported = cents === undefined ? decimal ?? null : cents === null ? null : cents / 100;
  if (reported === null) return { reported: null, cents: null, qualified: true };
  if (typeof reported !== 'number' || !Number.isFinite(reported) || Math.abs(reported) > 1_000_000) fail();
  const rounded = Math.round(reported * 100);
  const qualified = reported >= 0 && Math.abs(rounded - reported * 100) <= 0.000001;
  // Keep an explicit invalid-price fact for snapshot replacement. Its original
  // bounded number stays private; public prices remain whole-cent values/null.
  return { reported, cents: qualified ? rounded : null, qualified };
}
function dateValue(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return JSON.stringify({ value: text(value.value, 100, true), timezone: text(value.timezone, 80) });
}
function windowAllows(effective, expiration, at) {
  const parseDate = (serialized) => {
    if (!serialized) return null;
    const entry = JSON.parse(serialized);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/u.test(entry.value) ||
        (entry.timezone && entry.timezone !== 'UTC' && !/^[+-]\d\d:\d\d$/u.test(entry.timezone))) return NaN;
    const parts = entry.value.slice(0, 10).split('-').map(Number);
    const calendar = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (calendar.getUTCFullYear() !== parts[0] || calendar.getUTCMonth() + 1 !== parts[1] || calendar.getUTCDate() !== parts[2]) return NaN;
    const value = Date.parse(entry.value);
    if (!Number.isFinite(value)) return NaN;
    return value;
  };
  const from = parseDate(effective);
  const until = parseDate(expiration);
  return (from === null || (Number.isFinite(from) && from <= at)) &&
    (until === null || (Number.isFinite(until) && until > at)) &&
    (from === null || until === null || from < until);
}

const COVERAGE_MESSAGE = 'Retained observations from approved, bounded operator collection; not a complete catalog, current availability, or all-time promotion history.';
function coverage() { return { type: 'bounded_topic_sample', message: COVERAGE_MESSAGE }; }
function location(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9]{8}$/u.test(value)) fail();
  return value;
}
function observationId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/u.test(value) || !Number.isSafeInteger(Number(value))) fail();
  return Number(value);
}
function observationView(row) {
  return {
    observationId: String(row.observation_id), sourceId: row.source_id, sourceLabel: row.source_label,
    locationId: row.location_id, productId: row.product_id, itemId: row.item_id,
    description: row.description, brand: row.brand, size: row.size, soldBy: row.sold_by,
    currency: row.currency, priceBasis: row.price_basis, modality: row.modality,
    eligibilityKey: row.eligibility_key, unitBasis: row.unit_basis,
    price: { regular: row.regular_cents === null ? null : row.regular_cents / 100,
      promo: row.promo_cents === null ? null : row.promo_cents / 100,
      regularCents: row.regular_cents, promoCents: row.promo_cents,
      regularPerUnitEstimate: row.regular_unit_estimate, promoPerUnitEstimate: row.promo_unit_estimate,
      effectiveDate: row.effective_date === null ? null : JSON.parse(row.effective_date),
      expirationDate: row.expiration_date === null ? null : JSON.parse(row.expiration_date) },
    observedAt: new Date(row.observed_at).toISOString(),
    priceQualification: row.price_qualified === 0 ? 'unsupported_source_price' : 'qualified',
    dateQualification: row.date_qualified === 1 ? 'qualified' : 'unqualified',
    promotionStatus: row.price_qualified !== 0 && row.date_qualified === 1 && row.promo_cents > 0 && row.regular_cents > row.promo_cents
      ? 'reported_promotion' : 'not_verified_promotion',
  };
}

// These fields retain the source's stated basis. Missing currency, eligibility,
// or unit measure is never guessed from a package description or a store region.
function normalize(offer) {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) fail();
  const source = offer.source ?? offer;
  const price = source.price ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !price || typeof price !== 'object' || Array.isArray(price)) fail();
  const inStore = source.inStore ?? source.fulfillment?.instore ?? null;
  if (inStore !== null && typeof inStore !== 'boolean') fail();
  const regular = capturedPrice(source.regularCents, price.regular);
  const promo = capturedPrice(source.promoCents, price.promo);
  return {
    product_id: text(source.productId, 100, true), item_id: text(source.itemId, 100, true),
    description: text(source.description, 1000), brand: text(source.brand, 200),
    instore: inStore === null ? null : Number(inStore), stock_level: text(source.stockLevel, 80),
    size: text(source.size), sold_by: text(source.soldBy, 50), currency: text(source.currency ?? offer.currency, 10),
    price_basis: text(source.priceBasis ?? offer.priceBasis, 100),
    modality: text(source.modality ?? offer.modality, 50),
    eligibility_key: text(source.eligibilityKey ?? offer.eligibilityKey, 200),
    regular_cents: regular.cents, promo_cents: promo.cents,
    reported_regular: regular.reported, reported_promo: promo.reported,
    price_qualified: Number(regular.qualified && promo.qualified),
    regular_unit_estimate: estimate(price.regularPerUnitEstimate ?? source.regularUnitEstimate),
    promo_unit_estimate: estimate(price.promoPerUnitEstimate ?? source.promoUnitEstimate),
    unit_basis: text(source.unitBasis ?? offer.unitBasis ?? offer.perUnit?.basis, 100),
    effective_date: dateValue(price.effectiveDate), expiration_date: dateValue(price.expirationDate),
  };
}

function checkPath(filename) {
  if (typeof filename !== 'string' || !filename.trim() || filename.includes('\0') || filename === ':memory:') {
    fail('history_path_invalid', 'Choose a regular local database file. In-memory history is not supported.');
  }
  const full = resolve(filename);
  let current = parse(full).root;
  for (const part of full.slice(current.length).split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink()) fail('history_path_linked', 'History cannot use a linked file or folder. Choose a regular local folder.');
      if (current !== full && !info.isDirectory()) fail('history_path_invalid');
      if (current === full && (!info.isFile() || info.nlink > 1)) fail('history_path_invalid');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return full;
}

export function validateSourcePolicy(policy, { now = new Date().toISOString() } = {}) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || policy.status !== 'verified') fail('source_policy_invalid');
  const sourceId = text(policy.sourceId, 80, true);
  if (!/^[a-z][a-z0-9-]{0,79}$/u.test(sourceId)) fail('source_policy_invalid');
  const sourceLabel = text(policy.sourceLabel, 100, true);
  const evidenceReference = text(policy.evidenceReference, 200, true);
  const reviewReference = text(policy.reviewReference, 200, true);
  // Private agreement contents, document paths, identities and URLs do not
  // belong in this store. These are opaque local record keys only.
  if (![evidenceReference, reviewReference].every(ref => /^[a-zA-Z][a-zA-Z0-9._:-]{0,159}$/u.test(ref))) fail('source_policy_invalid');
  const verifiedAt = instant(policy.verifiedAt);
  const expiresAt = instant(policy.expiresAt);
  const nowMs = instant(now);
  if (verifiedAt > nowMs || expiresAt <= nowMs || expiresAt <= verifiedAt ||
      !Number.isInteger(policy.retentionDays) || policy.retentionDays < 1 || policy.retentionDays > 3660) fail('source_policy_invalid');
  if (!Array.isArray(policy.allowedPurposes) || !PURPOSES.every(p => policy.allowedPurposes.includes(p)) ||
      policy.allowedPurposes.some(p => !PURPOSES.includes(p))) fail('source_policy_invalid');
  if (!Array.isArray(policy.allowedLocationIds) || policy.allowedLocationIds.length < 1 || policy.allowedLocationIds.length > 10 ||
      policy.allowedLocationIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9]{8}$/u.test(id))) fail('source_policy_invalid');
  if (!Array.isArray(policy.allowedTopics) || policy.allowedTopics.length < 1 || policy.allowedTopics.length > 10 ||
      policy.allowedTopics.some(topic => typeof topic !== 'string' || topic.length < 3 || topic.length > 80 ||
        topic.trim() !== topic || /[\u0000-\u001f\u007f]/u.test(topic) || topic.split(/\s+/u).length > 8 || topic === '*')) fail('source_policy_invalid');
  return { sourceId, sourceLabel, evidenceReference, reviewReference, verifiedAt, expiresAt, retentionDays: policy.retentionDays,
    locations: [...new Set(policy.allowedLocationIds)], topics: [...new Set(policy.allowedTopics)] };
}

export function openHistoryStore({ filename = process.env.HISTORY_DB_PATH || join(ROOT, '.runtime', 'history.sqlite'), mustExist = false } = {}) {
  let db;
  try {
    const full = checkPath(filename);
    if (mustExist && !lstatSync(full).isFile()) fail('history_unavailable');
    mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
    checkPath(full);
    const exists = (() => { try { return statSync(full).size > 0; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } })();
    db = new Database(full, { timeout: 5000 });
    if (exists) {
      const appId = db.pragma('application_id', { simple: true });
      const version = db.pragma('user_version', { simple: true });
      if (appId !== APPLICATION_ID || !Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) fail('history_schema_unknown', 'This is not a supported history database. Choose a new file or use the matching app version.');
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(row => row.name);
      const requiredTables = [...REQUIRED_TABLES, ...(version >= 5 ? ['collection_control', 'collection_reservations'] : []),
        ...(version >= 6 ? ['directory_rights', 'directory_runs', 'directory_snapshots', 'directory_stores'] : [])];
      if (tables.length !== requiredTables.length || !requiredTables.every(table => tables.includes(table))) fail('history_schema_unknown');
      const applied = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
      if (applied.length !== version || applied.some((row, index) => row.version !== index + 1 ||
          row.checksum !== MIGRATIONS[index].checksum)) fail('history_schema_unknown');
      const expected = new Database(':memory:');
      try {
        for (const migration of MIGRATIONS.slice(0, version)) expected.exec(migration.sql);
        const schema = database => database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
        if (JSON.stringify(schema(db)) !== JSON.stringify(schema(expected))) fail('history_schema_unknown');
      } finally { expected.close(); }
      if (db.pragma('quick_check', { simple: true }) !== 'ok') fail('history_schema_invalid');
      if (version < SCHEMA_VERSION) {
        db.transaction(() => {
          for (const migration of MIGRATIONS.slice(version)) {
            db.exec(migration.sql);
            db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.checksum, Date.now());
          }
          db.pragma(`user_version = ${SCHEMA_VERSION}`);
        }).immediate();
      }
    } else {
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
      if (tables.length) fail('history_schema_unknown');
      db.transaction(() => {
        for (const migration of MIGRATIONS) {
          db.exec(migration.sql);
          db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.checksum, Date.now());
        }
        db.pragma(`application_id = ${APPLICATION_ID}`);
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
        db.prepare('INSERT INTO sources VALUES (?, ?, ?, NULL, ?)').run('kroger-public', 'Kroger Products API', 'pending', Date.now());
      }).immediate();
    }
    db.pragma('foreign_keys = ON');
    db.prepare("INSERT INTO sources VALUES (?, 'Kroger Public Locations API', 'pending', NULL, ?) ON CONFLICT(source_id) DO NOTHING")
      .run(DIRECTORY_SOURCE, Date.now());
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.function('history_topic_key', { deterministic: true, directOnly: true }, value => typeof value === 'string' ? topicKey(value) : null);
  } catch (error) {
    db?.close();
    if (error instanceof HistoryError) throw error;
    throw new HistoryError('history_unavailable', 'History could not be opened. Check the local database setup and try again.');
  }

  const rightsQuery = db.prepare(`SELECT s.source_id, s.source_label, s.status AS source_status, r.*
    FROM sources s LEFT JOIN source_rights r ON r.rights_id = s.current_rights_id WHERE s.source_id = ?`);
  function permission(sourceId = 'kroger-public', asOf = new Date().toISOString(), targets = []) {
    const at = instant(asOf);
    const row = rightsQuery.get(sourceId);
    if (!row || row.source_status !== 'verified' || row.status !== 'verified' || !row.collection_allowed ||
        !row.display_allowed || !row.agent_access_allowed || row.verified_at > at || row.expires_at <= at) {
      return { status: 'permission_required', reason: 'source_permission_required', message: 'Historical collection and shared display require reviewed source permission.' };
    }
    const locations = JSON.parse(row.allowed_locations);
    const topics = JSON.parse(row.allowed_topics);
    if (targets.some(target => !locations.includes(target.locationId) || (target.term !== undefined && !topics.includes(target.term)))) {
      return { status: 'permission_required', reason: 'source_scope_not_approved', message: 'The selected collection or display scope is outside the reviewed source permission.' };
    }
    return { status: 'permitted', rightsId: row.rights_id, expiresAt: row.expires_at, retentionDays: row.retention_days,
      sourceLabel: row.source_label, locations, topics };
  }

  const savePolicy = db.transaction((policy, at) => {
    const p = validateSourcePolicy(policy, { now: at });
    if (p.sourceId === DIRECTORY_SOURCE || db.prepare('SELECT 1 FROM directory_rights WHERE source_id=?').get(p.sourceId)) fail('source_policy_conflict');
    const source = db.prepare('SELECT status, current_rights_id FROM sources WHERE source_id = ?').get(p.sourceId);
    if (source?.status === 'revoked') fail('source_revoked', 'This source was revoked. A separate reviewed reinstatement is required.');
    const activePolicy = source?.current_rights_id
      ? db.prepare('SELECT verified_at FROM source_rights WHERE rights_id = ?').get(source.current_rights_id) : null;
    if (activePolicy && p.verifiedAt < activePolicy.verified_at) {
      fail('source_policy_superseded', 'An older policy cannot replace the current reviewed permission.');
    }
    db.prepare(`INSERT INTO sources(source_id, source_label, status, updated_at) VALUES (?, ?, 'pending', ?)
      ON CONFLICT(source_id) DO UPDATE SET source_label = excluded.source_label, updated_at = excluded.updated_at`).run(p.sourceId, p.sourceLabel, instant(at));
    const existing = db.prepare(`SELECT * FROM source_rights WHERE source_id = ? AND evidence_reference = ?
      AND review_reference = ? AND verified_at = ?`).get(p.sourceId, p.evidenceReference, p.reviewReference, p.verifiedAt);
    let id;
    if (existing) {
      if (source?.current_rights_id !== existing.rights_id) {
        fail('source_policy_superseded', 'A superseded policy cannot become current again.');
      }
      if (existing.status !== 'verified' || existing.expires_at !== p.expiresAt || existing.retention_days !== p.retentionDays ||
          existing.allowed_locations !== JSON.stringify(p.locations) || existing.allowed_topics !== JSON.stringify(p.topics)) fail('source_policy_conflict');
      id = existing.rights_id;
    } else {
      id = db.prepare(`INSERT INTO source_rights(source_id,status,evidence_reference,review_reference,verified_at,expires_at,
        retention_days,collection_allowed,display_allowed,agent_access_allowed,allowed_locations,allowed_topics)
        VALUES (?, 'verified', ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)`).run(p.sourceId, p.evidenceReference, p.reviewReference,
        p.verifiedAt, p.expiresAt, p.retentionDays, JSON.stringify(p.locations), JSON.stringify(p.topics)).lastInsertRowid;
    }
    db.prepare("UPDATE sources SET status = 'verified', current_rights_id = ?, updated_at = ? WHERE source_id = ?")
      .run(id, instant(at), p.sourceId);
    // A later, broader grant must never revive data that already reached a
    // tighter retention deadline. Original grant/row limits are only shortened.
    db.prepare(`UPDATE observations SET retain_until = max(observed_at + 1,
      min(retain_until, observed_at + ?, ?)) WHERE source_id = ?`)
      .run(p.retentionDays * DAY, p.expiresAt, p.sourceId);
    db.prepare(`UPDATE collection_jobs SET retain_until = max(observed_at + 1,
      min(retain_until, observed_at + ?, ?)) WHERE source_id = ? AND retain_until IS NOT NULL`)
      .run(p.retentionDays * DAY, p.expiresAt, p.sourceId);
    return { status: 'policy_recorded', sourceId: p.sourceId };
  });

  const candidateQuery = db.prepare(`SELECT o.*, s.source_label, run.run_id FROM observations o
    JOIN collection_jobs j ON j.job_id = o.job_id AND j.source_id = o.source_id AND j.location_id = o.location_id
    JOIN collection_runs run ON run.run_id = j.run_id AND run.source_id = o.source_id AND run.status = 'completed'
    JOIN source_rights r ON r.rights_id = o.rights_id AND r.source_id = o.source_id JOIN sources s ON s.source_id = o.source_id
    JOIN source_rights cr ON cr.rights_id = s.current_rights_id AND cr.source_id = o.source_id
    WHERE o.source_id = ? AND o.location_id = ? AND o.product_id = ? AND o.item_id = ? AND o.observed_at < ?
    AND o.retain_until > ? AND s.status = 'verified' AND r.status = 'verified' AND r.display_allowed = 1
    AND r.agent_access_allowed = 1 AND r.expires_at > ? AND r.verified_at <= o.observed_at
    AND r.collection_allowed = 1
    AND o.observed_at + r.retention_days * 86400000 > ?
    AND EXISTS (SELECT 1 FROM json_each(r.allowed_locations) WHERE value = o.location_id)
    AND EXISTS (SELECT 1 FROM json_each(r.allowed_topics) WHERE history_topic_key(value) = j.topic_key)
    AND cr.status = 'verified' AND cr.collection_allowed = 1 AND cr.display_allowed = 1 AND cr.agent_access_allowed = 1
    AND cr.expires_at > ? AND cr.verified_at <= ? AND o.observed_at + cr.retention_days * 86400000 > ?
    AND EXISTS (SELECT 1 FROM json_each(cr.allowed_locations) WHERE value = o.location_id)
    AND EXISTS (SELECT 1 FROM json_each(cr.allowed_topics) WHERE history_topic_key(value) = j.topic_key)
    ORDER BY o.observed_at DESC, o.observation_id DESC`);
  function getComparisons({ locationId = null, offers = [], asOf = new Date().toISOString(), sourceId = 'kroger-public' } = {}) {
    if (!Array.isArray(offers) || offers.length > 500) fail();
    const at = instant(asOf);
    const access = permission(sourceId, asOf, locationId === null ? [] : [{ locationId }]);
    const empty = (status, message) => ({ status, observationCount: 0, lastPromo: null, lowestPromo: null,
      deltaFromLastCents: null, sourceLabels: [], unitComparison: { status: 'basis_unreported' }, message });
    if (access.status !== 'permitted') return { status: access.status, reason: access.reason, message: access.message,
      histories: offers.map(() => empty('permission_required', access.message)) };
    if (locationId === null) return { status: 'available', histories: [], message: 'History covers retained observations from approved, bounded collection only.' };
    const histories = offers.map(offer => {
      let current;
      try { current = normalize(offer); } catch { return empty('incomparable', 'The current item has no complete, valid history identity.'); }
      const seenRuns = new Set();
      const candidates = candidateQuery.all(sourceId, locationId, current.product_id, current.item_id, at, at, at, at, at, at, at)
        .filter(row => {
          if (seenRuns.has(row.run_id)) return false;
          seenRuns.add(row.run_id);
          return true;
        });
      if (!candidates.length) return empty('no_observations', 'No earlier retained observations exist for this exact store and item.');
      const identityFields = ['size', 'sold_by', 'currency', 'price_basis', 'modality', 'eligibility_key'];
      const matching = candidates.filter(row => identityFields.every(field => row[field] === current[field]));
      if (!matching.length) return empty('incomparable', 'Earlier observations use a different size, price basis, currency, modality, or eligibility.');
      const promos = matching.filter(row => row.price_qualified !== 0 && row.promo_cents > 0 && row.regular_cents > row.promo_cents && row.date_qualified === 1);
      if (!promos.length) return { ...empty('incomparable', 'Earlier observations have no date-qualified promotional price.'), observationCount: matching.length };
      const last = promos[0];
      const lowest = promos.reduce((best, row) => row.promo_cents < best.promo_cents ? row : best);
      const known = current.price_qualified === 1 && identityFields.every(field => current[field] !== null) && current.currency === 'USD' &&
        current.promo_cents !== null && windowAllows(current.effective_date, current.expiration_date, at);
      const unitRows = known && current.unit_basis ? promos.filter(row => row.unit_basis === current.unit_basis && row.promo_unit_estimate > 0) : [];
      const unit = !current.unit_basis ? { status: 'basis_unreported' } : unitRows.length === 0
        ? { status: 'no_history', basis: current.unit_basis } : { status: 'comparable', basis: current.unit_basis,
          lastPromoEstimate: unitRows[0].promo_unit_estimate,
          lowestPromoEstimate: Math.min(...unitRows.map(row => row.promo_unit_estimate)),
          deltaFromLastEstimate: !(current.promo_unit_estimate > 0) ? null : Number((current.promo_unit_estimate - unitRows[0].promo_unit_estimate).toFixed(8)) };
      const status = !known ? 'incomparable' : promos.length === 1 ? 'insufficient_history' : 'comparable';
      return { status, observationCount: matching.length, firstObservedAt: new Date(matching.at(-1).observed_at).toISOString(),
        lastObservedAt: new Date(last.observed_at).toISOString(), lowestObservedAt: new Date(lowest.observed_at).toISOString(),
        lastPromo: last.promo_cents / 100, lowestPromo: lowest.promo_cents / 100,
        deltaFromLastCents: known ? current.promo_cents - last.promo_cents : null,
        sourceLabels: [...new Set(promos.map(row => row.source_label))], unitComparison: unit,
        message: !known ? 'Prior reported prices are dated observations; missing price conditions prevent a qualified comparison.' :
          promos.length === 1 ? 'One earlier observation is available. This is not a price trend or a complete price history.' :
            'Compared with retained observations for this exact store, item, price basis, and conditions; coverage is a bounded sample.' };
    });
    return { status: 'available', histories, message: 'Observed history is a bounded sample, not a complete catalog or all-time history.' };
  }

  // Every database read checks the original grant and the current grant. A
  // cursor controls pagination only; it cannot restore earlier permission.
  const readableObservation = `FROM observations o
    JOIN collection_jobs j ON j.job_id = o.job_id AND j.source_id = o.source_id AND j.location_id = o.location_id
    JOIN collection_runs run ON run.run_id = j.run_id AND run.source_id = o.source_id AND run.status = 'completed'
    JOIN sources s ON s.source_id = o.source_id
    JOIN source_rights r ON r.rights_id = o.rights_id AND r.source_id = o.source_id
    JOIN source_rights cr ON cr.rights_id = s.current_rights_id AND cr.source_id = o.source_id
    WHERE o.source_id = @sourceId AND o.location_id = @locationId AND o.observed_at <= @at
    AND o.retain_until > @at AND s.status = 'verified'
    AND r.status = 'verified' AND r.collection_allowed = 1 AND r.display_allowed = 1 AND r.agent_access_allowed = 1
    AND r.verified_at <= o.observed_at AND r.expires_at > @at
    AND o.observed_at + r.retention_days * 86400000 > @at
    AND cr.status = 'verified' AND cr.collection_allowed = 1 AND cr.display_allowed = 1 AND cr.agent_access_allowed = 1
    AND cr.verified_at <= @at AND cr.expires_at > @at AND o.observed_at + cr.retention_days * 86400000 > @at
    AND EXISTS (SELECT 1 FROM json_each(r.allowed_locations) WHERE value = o.location_id)
    AND EXISTS (SELECT 1 FROM json_each(cr.allowed_locations) WHERE value = o.location_id)
    AND EXISTS (SELECT 1 FROM json_each(r.allowed_topics) WHERE history_topic_key(value) = j.topic_key)
    AND EXISTS (SELECT 1 FROM json_each(cr.allowed_topics) WHERE history_topic_key(value) = j.topic_key)`;
  const searchQuery = db.prepare(`SELECT o.*, s.source_label ${readableObservation}
    AND (@productId IS NULL OR o.product_id = @productId) AND (@itemId IS NULL OR o.item_id = @itemId)
    AND (@term IS NULL OR instr(lower(coalesce(o.description, '')), lower(@term)) > 0
      OR instr(lower(coalesce(o.brand, '')), lower(@term)) > 0)
    AND (@fromTime IS NULL OR o.observed_at >= @fromTime) AND (@toTime IS NULL OR o.observed_at <= @toTime)
    AND o.observed_at <= @snapshotAt AND o.observation_id <= @ceilingId
    AND (@lastAt IS NULL OR o.observed_at < @lastAt OR (o.observed_at = @lastAt AND o.observation_id < @lastId))
    ORDER BY o.observed_at DESC, o.observation_id DESC LIMIT @take`);
  const retrieveQuery = db.prepare(`SELECT o.*, s.source_label ${readableObservation} AND o.observation_id = @id`);
  function searchPromotions({ locationId, term, productId, itemId, observedFrom, observedTo, limit = 20,
    cursor, sourceId = 'kroger-public', asOf = new Date().toISOString() } = {}) {
    location(locationId); text(sourceId, 80, true);
    const at = instant(asOf);
    const query = { sourceId, locationId, term: text(term, 80), productId: text(productId, 100), itemId: text(itemId, 100),
      fromTime: observedFrom === undefined ? null : instant(observedFrom),
      toTime: observedTo === undefined ? null : instant(observedTo) };
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
        (term !== undefined && query.term === null) || (productId !== undefined && query.productId === null) ||
        (itemId !== undefined && query.itemId === null) ||
        (query.fromTime !== null && query.toTime !== null && query.fromTime > query.toTime)) fail();
    const signature = createHash('sha256').update(JSON.stringify({ ...query, limit })).digest('hex');
    let page = { snapshotAt: at, ceilingId: db.prepare('SELECT coalesce(max(observation_id), 0) AS id FROM observations WHERE source_id = ? AND location_id = ?').get(sourceId, locationId).id,
      lastAt: null, lastId: null };
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursor.length > 700 || !/^[a-zA-Z0-9_-]+$/u.test(cursor)) fail();
      let decoded;
      try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { fail(); }
      if (!decoded || decoded.v !== 1 || decoded.query !== signature ||
          Object.keys(decoded).sort().join(',') !== 'ceilingId,lastAt,lastId,query,snapshotAt,v' ||
          !Number.isSafeInteger(decoded.snapshotAt) || decoded.snapshotAt < 0 || decoded.snapshotAt > at ||
          !Number.isSafeInteger(decoded.ceilingId) || decoded.ceilingId < 1 ||
          !Number.isSafeInteger(decoded.lastAt) || decoded.lastAt < 0 || decoded.lastAt > decoded.snapshotAt ||
          !Number.isSafeInteger(decoded.lastId) || decoded.lastId < 1 || decoded.lastId > decoded.ceilingId) fail();
      page = { snapshotAt: decoded.snapshotAt, ceilingId: decoded.ceilingId, lastAt: decoded.lastAt, lastId: decoded.lastId };
    }
    const access = permission(sourceId, asOf, [{ locationId }]);
    const emptyPage = { limit, returned: 0, truncated: false, nextCursor: null };
    if (access.status !== 'permitted') return { ...access, locationId, observations: [], page: emptyPage, coverage: coverage() };
    const rows = searchQuery.all({ ...query, ...page, at, take: limit + 1 });
    const truncated = rows.length > limit;
    const visible = rows.slice(0, limit);
    const last = visible.at(-1);
    const nextCursor = truncated ? Buffer.from(JSON.stringify({ v: 1, query: signature, snapshotAt: page.snapshotAt,
      ceilingId: page.ceilingId, lastAt: last.observed_at, lastId: last.observation_id })).toString('base64url') : null;
    return { status: 'available', locationId, observations: visible.map(observationView),
      page: { limit, returned: visible.length, truncated, nextCursor }, coverage: coverage() };
  }
  function retrievePromotion({ locationId, observationId: id, sourceId = 'kroger-public', asOf = new Date().toISOString() } = {}) {
    location(locationId); text(sourceId, 80, true); const number = observationId(id); const at = instant(asOf);
    const access = permission(sourceId, asOf, [{ locationId }]);
    if (access.status !== 'permitted') return { ...access, locationId, observation: null, coverage: coverage() };
    const row = retrieveQuery.get({ sourceId, locationId, at, id: number });
    return { status: row ? 'available' : 'not_found', locationId, observation: row ? observationView(row) : null, coverage: coverage() };
  }

  const latestJobQuery = db.prepare(`SELECT j.*, run.finished_at, run.page_limit, r.*,
      j.rights_id AS job_rights_id, j.retain_until AS job_retain_until
    FROM collection_jobs j
    JOIN collection_runs run ON run.run_id = j.run_id AND run.source_id = j.source_id
    LEFT JOIN source_rights r ON r.rights_id = j.rights_id AND r.source_id = j.source_id
    WHERE j.source_id = ? AND j.location_id = ? AND j.topic_key = ?
      AND run.status = 'completed' AND run.finished_at <= ? AND j.observed_at <= ?
    ORDER BY j.observed_at DESC, j.job_id DESC LIMIT 1`);
  const latestRowsQuery = db.prepare(`SELECT o.*, s.source_label ${readableObservation}
    AND j.job_id = @jobId
    AND NOT EXISTS (
      SELECT 1 FROM observations newer
      JOIN collection_jobs nj ON nj.job_id = newer.job_id AND nj.source_id = newer.source_id
        AND nj.location_id = newer.location_id
      JOIN collection_runs nr ON nr.run_id = nj.run_id AND nr.source_id = nj.source_id
      WHERE newer.source_id = o.source_id AND newer.location_id = o.location_id
        AND newer.product_id = o.product_id AND newer.item_id = o.item_id
        AND nr.status = 'completed' AND nr.finished_at <= @at AND newer.observed_at <= @at
        AND (newer.observed_at > o.observed_at OR (newer.observed_at = o.observed_at
          AND nj.run_id <> j.run_id AND nj.job_id > j.job_id)))
    ORDER BY o.observation_id DESC`);
  const latestAttemptQuery = db.prepare(`SELECT status, started_at, finished_at FROM collection_runs run
    WHERE source_id = ? AND started_at <= ? AND EXISTS (
      SELECT 1 FROM json_each(run.target_scope) target
      WHERE json_extract(target.value, '$.locationId') = ? AND json_extract(target.value, '$.topicKey') = ?)
    ORDER BY started_at DESC, rowid DESC LIMIT 1`);
  const generationQuery = db.prepare(`SELECT coalesce(max(j.job_id), 0) AS id FROM collection_jobs j
    JOIN collection_runs run ON run.run_id = j.run_id AND run.source_id = j.source_id
    WHERE j.source_id = ? AND j.location_id = ? AND run.status = 'completed'
      AND run.finished_at <= ? AND j.observed_at <= ?`);

  // This view reads only completed operator snapshots. Selecting the snapshot
  // before filtering prevents an old promotion from surviving a regular-price,
  // unavailable-item, or empty replacement sample. A missing item reconciles
  // only this exact bounded topic, never the whole source catalog.
  function getLatestDeals({ locationId, topic, limit = 20, cursor, productId, itemId, sourceId = 'kroger-public',
    asOf = new Date().toISOString(), maxAgeSeconds = DEFAULT_PROMOTION_MAX_AGE_SECONDS } = {}, view = 'deals') {
    location(locationId); text(sourceId, 80, true); text(topic, 80, true);
    const at = instant(asOf);
    if (topic.length < 3 || topic.split(/\s+/u).length > 8 || topic === '*' || /\p{Cf}/u.test(topic) ||
        !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(maxAgeSeconds) ||
        maxAgeSeconds < 1 || maxAgeSeconds > 604_800) fail();
    const query = { sourceId, locationId, topic, limit, maxAgeSeconds,
      ...(view === 'prices' ? { view, productId: productId ?? null, itemId: itemId ?? null } : {}) };
    const signature = createHash('sha256').update(JSON.stringify(query)).digest('hex');
    let requestedPage = null;
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursor.length > 512 || !/^[a-zA-Z0-9_-]+$/u.test(cursor)) fail();
      try { requestedPage = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { fail(); }
      if (!requestedPage || Object.keys(requestedPage).sort().join(',') !== 'generation,lastId,query,snapshotId,v' ||
          requestedPage.v !== 1 || requestedPage.query !== signature || !Number.isSafeInteger(requestedPage.snapshotId) ||
          requestedPage.snapshotId < 1 || !Number.isSafeInteger(requestedPage.generation) || requestedPage.generation < 1 ||
          !Number.isSafeInteger(requestedPage.lastId) || requestedPage.lastId < 1) fail();
    }
    const resultCoverage = { type: 'bounded_topic_sample', topic, pagesPerTarget: 1,
      limitPerTarget: null, returnedProductCount: null, completeCatalog: false,
      message: 'Latest completed bounded topic sample; omitted items are not catalog deletions. Prices and stock are dated observations, not live availability.' };
    const emptyPage = { limit, returned: 0, truncated: false, nextCursor: null };
    const collection = view === 'prices' ? 'products' : 'deals';
    const base = { locationId, topic, [collection]: [], snapshot: null, latestAttempt: null, page: emptyPage, coverage: resultCoverage };
    const access = permission(sourceId, asOf, [{ locationId, term: topic }]);
    if (access.status !== 'permitted') return { ...base, ...access };
    const key = topicKey(topic);
    const attempt = latestAttemptQuery.get(sourceId, at, locationId, key);
    if (attempt) base.latestAttempt = { status: attempt.status, startedAt: new Date(attempt.started_at).toISOString(),
      finishedAt: attempt.finished_at === null ? null : new Date(attempt.finished_at).toISOString() };
    const job = latestJobQuery.get(sourceId, locationId, key, at, at);
    if (!job) return { ...base, status: 'no_data', reason: 'no_completed_collection',
      message: 'No completed collection is available for this exact store and approved topic.' };
    const readable = job.job_rights_id !== null && job.job_retain_until > at && job.status === 'verified' &&
      job.collection_allowed === 1 && job.display_allowed === 1 && job.agent_access_allowed === 1 &&
      job.verified_at <= job.observed_at && job.expires_at > at && job.observed_at + job.retention_days * DAY > at &&
      job.observed_at + access.retentionDays * DAY > at &&
      JSON.parse(job.allowed_locations).includes(locationId) && JSON.parse(job.allowed_topics).includes(topic);
    if (!readable) return { ...base, status: 'no_data', reason: 'snapshot_not_readable',
      message: 'The latest completed sample cannot be displayed under its original and current permission or retention. A new approved collection is needed.' };
    resultCoverage.limitPerTarget = job.page_limit;
    resultCoverage.returnedProductCount = job.returned_product_count;
    const ageSeconds = Math.floor((at - job.observed_at) / 1000);
    base.snapshot = { snapshotId: String(job.job_id), observedAt: new Date(job.observed_at).toISOString(),
      completedAt: new Date(job.finished_at).toISOString(), ageSeconds, maxAgeSeconds };
    if (at - job.observed_at >= maxAgeSeconds * 1000) return { ...base, status: 'stale', reason: 'snapshot_stale',
      message: 'The last completed sample exceeds this installation’s freshness limit. Collection is an operator action; this read did not refresh it.' };
    const generation = generationQuery.get(sourceId, locationId, at, at).id;
    let lastId = null;
    if (requestedPage !== null) {
      if (requestedPage.snapshotId !== job.job_id || requestedPage.generation !== generation) fail();
      lastId = requestedPage.lastId;
    }
    const rows = latestRowsQuery.all({ sourceId, locationId, at, jobId: job.job_id })
      .filter(row => (lastId === null || row.observation_id < lastId) &&
        (view === 'prices' ? (productId === undefined || row.product_id === productId) && (itemId === undefined || row.item_id === itemId)
          : row.instore !== 0 && !['TEMPORARILY_OUT_OF_STOCK', 'OUT_OF_STOCK'].includes(row.stock_level) &&
            row.price_qualified === 1 && row.date_qualified === 1 && row.promo_cents > 0 && row.regular_cents > row.promo_cents &&
            windowAllows(row.effective_date, row.expiration_date, at)));
    const visible = rows.slice(0, limit);
    const truncated = rows.length > limit;
    const nextCursor = truncated ? Buffer.from(JSON.stringify({ v: 1, query: signature, snapshotId: job.job_id,
      generation, lastId: visible.at(-1).observation_id })).toString('base64url') : null;
    return { ...base, status: 'available', [collection]: view === 'prices' ? visible.map(row => priceProduct(row, at))
      : visible.map(row => ({ ...observationView(row),
      availability: { inStore: row.instore === null ? null : row.instore === 1, stockLevel: row.stock_level,
        status: ['HIGH', 'LOW'].includes(row.stock_level) ? 'reported_in_stock' : 'unreported' },
      calculated: { savingsCents: row.regular_cents - row.promo_cents,
        percentOff: (row.regular_cents - row.promo_cents) / row.regular_cents * 100 } })),
      page: { limit, returned: visible.length, truncated, nextCursor } };
  }

  function priceProduct(row, at) {
    const product = { ...observationView(row), availability: storedAvailability(row.instore === null ? null : row.instore === 1, row.stock_level) };
    product.pricing = storedPriceDecision(product, windowAllows(row.effective_date, row.expiration_date, at));
    product.qualificationGaps = priceQualificationGaps(product);
    product.calculated = product.pricing.status === 'promotion' ? {
      savingsCents: row.regular_cents - row.promo_cents,
      percentOff: (row.regular_cents - row.promo_cents) / row.regular_cents * 100,
    } : null;
    return product;
  }

  function searchPrices({ sourceId = 'kroger-public', asOf = new Date().toISOString(),
    maxAgeSeconds = DEFAULT_PROMOTION_MAX_AGE_SECONDS, ...input } = {}) {
    if (!validPriceSearchRequest(input)) fail();
    return getLatestDeals({ ...input, sourceId, asOf, maxAgeSeconds }, 'prices');
  }

  function estimateBasket({ sourceId = 'kroger-public', asOf = new Date().toISOString(),
    maxAgeSeconds = DEFAULT_PROMOTION_MAX_AGE_SECONDS, ...input } = {}) {
    if (!validEstimateRequest(input)) fail();
    instant(asOf);
    const access = permission(sourceId, asOf, input.items.map(item => ({ locationId: input.locationId, term: item.topic })));
    const lines = input.items.map(item => {
      if (access.status !== 'permitted') return estimateStoredLine({ item, reason: 'permission_required' });
      // Exact identifiers narrow the completed snapshot before pagination. This
      // is not a lookup limited to the first public page of product results.
      const result = searchPrices({ sourceId, asOf, maxAgeSeconds, locationId: input.locationId, topic: item.topic,
        productId: item.productId, itemId: item.itemId, limit: 1 });
      return estimateStoredLine({ item, product: result.products[0] ?? null, snapshot: result.snapshot,
        reason: result.status === 'available' ? null : result.status });
    });
    const totals = storedEstimateTotals(lines);
    return { status: access.status !== 'permitted' ? 'permission_required'
      : totals.unresolvedLineCount === 0 ? 'complete' : totals.estimatedLineCount > 0 ? 'partial' : 'unavailable',
    locationId: input.locationId, evaluatedAt: asOf, lines, totals,
    exclusions: ['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes'],
    coverage: { type: 'bounded_topic_sample', completeCatalog: false,
      message: 'Calculated only from exact items in fresh completed approved-topic samples. Complete means arithmetic line coverage; this is not a payable checkout total or a complete catalog.' } };
  }

  function targetScope(targets) {
    if (!Array.isArray(targets) || targets.length > 10) fail();
    const scopes = targets.map(target => {
      location(target.locationId); text(target.term, 80, true);
      return { locationId: target.locationId, topicKey: topicKey(target.term) };
    });
    if (new Set(scopes.map(scope => JSON.stringify(scope))).size !== scopes.length) fail();
    return JSON.stringify(scopes);
  }
  function getStoreTopics({ locationId, sourceId = 'kroger-public', asOf = new Date().toISOString(),
    maxAgeSeconds = DEFAULT_PROMOTION_MAX_AGE_SECONDS } = {}) {
    location(locationId);
    const at = instant(asOf);
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 604_800) fail();
    const base = { locationId, topics: [], coverage: { type: 'completed_store_topics', completeCatalog: false,
      message: 'Only readable completed named topic samples for this store. Missing topics are not proof of missing promotions or a complete catalog.' } };
    const access = permission(sourceId, asOf, [{ locationId }]);
    if (access.status !== 'permitted') return { ...base, ...access };
    const labels = db.prepare(`SELECT DISTINCT j.topic_label FROM collection_jobs j
      JOIN collection_runs run ON run.run_id=j.run_id AND run.source_id=j.source_id
      WHERE j.source_id=? AND j.location_id=? AND j.topic_label IS NOT NULL
      AND run.status='completed' AND run.finished_at<=? AND j.observed_at<=? ORDER BY j.topic_label`).all(sourceId, locationId, at, at);
    for (const { topic_label: topic } of labels) {
      if (!access.topics.includes(topic)) continue;
      const result = getLatestDeals({ locationId, topic, sourceId, asOf, maxAgeSeconds, limit: 1 });
      if (!['available', 'stale'].includes(result.status)) continue;
      base.topics.push({ topic, status: result.status, snapshot: result.snapshot,
        latestAttempt: result.latestAttempt, returnedProductCount: result.coverage.returnedProductCount });
    }
    return { ...base, status: base.topics.length === 0 ? 'no_data' : base.topics.some(row => row.status === 'available') ? 'available' : 'stale',
      ...(base.topics.length === 0 ? { reason: 'no_completed_topics' } : {}) };
  }
  const topicsRead = db.transaction(getStoreTopics);
  const latestRead = db.transaction(getLatestDeals);
  const pricesRead = db.transaction(searchPrices);
  const estimateRead = db.transaction(estimateBasket);

  function startRun({ runId, sourceId, startedAt, targetCount, limit, targets }) {
    text(runId, 100, true); text(sourceId, 80, true);
    if (!Number.isInteger(targetCount) || targetCount < 0 || targetCount > 10 || !Number.isInteger(limit) || limit < 1 || limit > 50) fail();
    if (targets !== undefined && (!Array.isArray(targets) || targets.length !== targetCount)) fail();
    db.prepare(`INSERT INTO collection_runs(run_id,source_id,started_at,status,target_count,page_limit,coverage_type,target_scope)
      VALUES (?, ?, ?, 'running', ?, ?, 'bounded_topic_sample', ?)`)
      .run(runId, sourceId, instant(startedAt), targetCount, limit, targets === undefined ? null : targetScope(targets));
  }

  const complete = db.transaction(({ runId, sourceId, finishedAt, jobs, leaseOwner }) => {
    const finished = instant(finishedAt);
    if (permission(sourceId, finishedAt).status !== 'permitted') fail('source_permission_required');
    const run = db.prepare("SELECT * FROM collection_runs WHERE run_id = ? AND source_id = ? AND status = 'running'").get(runId, sourceId);
    if (!run || !Array.isArray(jobs) || jobs.length !== run.target_count || jobs.length > 10 || finished < run.started_at) fail();
    let observationCount = 0;
    let completedJobs = 0;
    const seenInRun = new Map();
    for (const job of jobs) {
      const access = permission(sourceId, finishedAt, [{ locationId: job.locationId, term: job.term }]);
      if (access.status !== 'permitted') fail('source_permission_required');
      const observed = instant(job.observedAt);
      if (observed < run.started_at || observed > finished || observed >= access.expiresAt) fail();
      const rightsId = job.rightsId ?? access.rightsId;
      if (!Number.isSafeInteger(rightsId) || rightsId < 1) fail();
      const original = db.prepare('SELECT * FROM source_rights WHERE rights_id = ? AND source_id = ?').get(rightsId, sourceId);
      if (!original || original.status !== 'verified' || original.collection_allowed !== 1 || original.display_allowed !== 1 ||
          original.agent_access_allowed !== 1 || original.verified_at > observed || original.expires_at <= finished ||
          !JSON.parse(original.allowed_locations).includes(job.locationId) || !JSON.parse(original.allowed_topics).includes(job.term)) {
        fail('source_permission_required');
      }
      text(job.jobKey, 100, true);
      if (!Array.isArray(job.offers) || job.offers.length > run.page_limit * 10 ||
          !Number.isInteger(job.returnedProductCount) || job.returnedProductCount < 0 || job.returnedProductCount > run.page_limit) fail();
      if (db.prepare('SELECT 1 FROM collection_jobs WHERE source_id = ? AND job_key = ?').get(sourceId, job.jobKey)) continue;
      const retain = Math.min(observed + access.retentionDays * DAY, access.expiresAt,
        observed + original.retention_days * DAY, original.expires_at);
      const jobId = db.prepare(`INSERT INTO collection_jobs(source_id,job_key,run_id,location_id,observed_at,returned_product_count,topic_key,rights_id,retain_until,topic_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sourceId, job.jobKey, runId, job.locationId, observed, job.returnedProductCount, topicKey(job.term), rightsId, retain, job.term).lastInsertRowid;
      const seenInJob = new Map();
      for (const offer of job.offers) {
        const row = normalize(offer);
        const sourcePrice = (offer.source ?? offer).price ?? {};
        const identity = JSON.stringify([job.locationId, row.product_id, row.item_id]);
        const fingerprint = JSON.stringify(row);
        const prior = seenInRun.get(identity);
        if (prior && prior.observed === observed && prior.fingerprint !== fingerprint) {
          fail('history_input_invalid', 'A collection run contains conflicting facts at the same time for the same store and item.');
        }
        seenInRun.set(identity, { observed, fingerprint });
        if (seenInJob.has(identity)) {
          if (seenInJob.get(identity) !== fingerprint) fail();
          continue;
        }
        seenInJob.set(identity, fingerprint);
        const fields = { ...row, job_id: jobId, source_id: sourceId, rights_id: rightsId, location_id: job.locationId,
          observed_at: observed, retain_until: retain,
          date_qualified: Number(windowAllows(row.effective_date, row.expiration_date, observed) &&
            ['effectiveDate', 'expirationDate'].every(key => !Object.hasOwn(sourcePrice, key) || sourcePrice[key] !== null)) };
        db.prepare(`INSERT INTO observations(job_id,source_id,rights_id,location_id,product_id,item_id,size,sold_by,currency,
          price_basis,modality,eligibility_key,regular_cents,promo_cents,regular_unit_estimate,promo_unit_estimate,unit_basis,
          effective_date,expiration_date,date_qualified,observed_at,retain_until,description,brand,instore,stock_level,
          reported_regular,reported_promo,price_qualified) VALUES
          (@job_id,@source_id,@rights_id,@location_id,@product_id,@item_id,@size,@sold_by,@currency,@price_basis,@modality,
          @eligibility_key,@regular_cents,@promo_cents,@regular_unit_estimate,@promo_unit_estimate,@unit_basis,
          @effective_date,@expiration_date,@date_qualified,@observed_at,@retain_until,@description,@brand,@instore,@stock_level,
          @reported_regular,@reported_promo,@price_qualified)`).run(fields);
        observationCount++;
      }
      completedJobs++;
    }
    const scope = targetScope(jobs.map(job => ({ locationId: job.locationId, term: job.term })));
    if (run.target_scope !== null && run.target_scope !== scope) fail();
    // Check ownership at the transaction's publication boundary. Any rows above
    // roll back on a lost lease; original/current rights failures remain explicit.
    if (leaseOwner !== undefined) requireLease(sourceId, leaseOwner, finished);
    db.prepare("UPDATE collection_runs SET status = 'completed', finished_at = ?, observation_count = ?, target_scope = ? WHERE run_id = ?")
      .run(finished, observationCount, scope, runId);
    return { observationCount, completedJobs };
  });

  // The source-wide lease prevents concurrent collectors from resetting quota or
  // racing publication. An expired worker must never publish after a takeover.
  const LEASE_MS = 120_000;
  function requireLease(sourceId, owner, at) {
    const row = db.prepare('SELECT * FROM collection_control WHERE source_id = ?').get(text(sourceId, 80, true));
    if (!row || row.lease_owner !== text(owner, 100, true) || row.lease_until <= at) fail('collection_lease_lost');
    return row;
  }
  const acquireCollection = db.transaction(({ sourceId, owner, now }) => {
    const at = instant(now); text(sourceId, 80, true); text(owner, 100, true);
    db.prepare('INSERT INTO collection_control(source_id) VALUES (?) ON CONFLICT(source_id) DO NOTHING').run(sourceId);
    const row = db.prepare('SELECT * FROM collection_control WHERE source_id = ?').get(sourceId);
    if (row.lease_owner !== null && row.lease_until > at) return { status: 'busy', retryAt: new Date(row.lease_until).toISOString() };
    if (row.cooldown_until > at) return { status: 'backoff', retryAt: new Date(row.cooldown_until).toISOString() };
    // A terminated process cannot finish its buffered observations. Mark that
    // attempt failed before the replacement run starts; completed jobs survive.
    db.prepare("UPDATE collection_runs SET status = 'failed', finished_at = max(started_at, ?), failure_category = 'collection_failed' WHERE source_id = ? AND status = 'running'")
      .run(at, sourceId);
    db.prepare("UPDATE directory_runs SET status='failed',finished_at=max(started_at,?),failure_category='collection_failed' WHERE source_id=? AND status='running'")
      .run(at, sourceId);
    db.prepare('UPDATE collection_control SET lease_owner = ?, lease_until = ? WHERE source_id = ?').run(owner, at + LEASE_MS, sourceId);
    return { status: 'acquired' };
  });
  const reserveCollection = db.transaction(({ sourceId, owner, now, maxRequests }) => {
    const at = instant(now); const row = requireLease(sourceId, owner, at);
    if (!Number.isInteger(maxRequests) || maxRequests < 4 || maxRequests > 1000) fail();
    if (row.cooldown_until > at) return { status: 'backoff', retryAt: new Date(row.cooldown_until).toISOString() };
    // Four is the implemented adapter's conservative upper bound for one search:
    // token + Products + one token renewal + one Products retry. Failed calls
    // retain their reservations, including across process restarts.
    db.prepare('DELETE FROM collection_reservations WHERE source_id = ? AND reserved_at <= ?').run(sourceId, at - DAY);
    // Keep individual reservations in the actual preceding 24 hours. A fixed
    // first-call reset would allow almost twice the budget at its boundary.
    // Future timestamps also remain counted if the local clock moves backward.
    const count = db.prepare('SELECT count(*) AS n FROM collection_reservations WHERE source_id = ?').get(sourceId).n;
    if ((count + 1) * 4 > maxRequests) {
      const slots = Math.floor(maxRequests / 4);
      const next = db.prepare('SELECT reserved_at FROM collection_reservations WHERE source_id = ? ORDER BY reserved_at,reservation_id LIMIT 1 OFFSET ?')
        .get(sourceId, Math.max(0, count - slots));
      return { status: 'quota', retryAt: new Date(next.reserved_at + DAY).toISOString() };
    }
    db.prepare('INSERT INTO collection_reservations(source_id,reserved_at) VALUES (?,?)').run(sourceId, at);
    db.prepare('UPDATE collection_control SET lease_until = ? WHERE source_id = ?').run(at + LEASE_MS, sourceId);
    return { status: 'reserved', reservedRequests: (count + 1) * 4 };
  });
  const directory = createDirectoryStore(db, { fail, instant, text, requireLease });
  const { revokeDirectory: _revokeDirectory, purgeDirectory: _purgeDirectory, ...directoryOperations } = directory;
  return {
    ...directoryOperations,
    getStoreTopics(input) { return topicsRead.deferred(input); },
    close() { if (db.open) db.close(); },
    getComparisons, searchPromotions, retrievePromotion, getSourcePermission: permission,
    getLatestDeals(input) { return latestRead.deferred(input); },
    searchPrices(input) { return pricesRead.deferred(input); },
    estimateBasket(input) { return estimateRead.deferred(input); },
    getPromotionStatus({ sourceId = 'kroger-public', asOf = new Date().toISOString() } = {}) {
      const access = permission(sourceId, asOf);
      return { status: access.status === 'permitted' ? 'available' : access.status,
        ...(access.status === 'permitted' ? {} : { reason: access.reason, message: access.message }), coverage: coverage() };
    },
    getSourceStatus(sourceId = 'kroger-public') {
      text(sourceId, 80, true);
      const row = db.prepare('SELECT status FROM sources WHERE source_id = ?').get(sourceId);
      return { status: row?.status ?? 'unknown' };
    },
    recordSourcePolicy(policy, { now = new Date().toISOString() } = {}) { return savePolicy.immediate(policy, now); },
    acquireCollection(input) { return acquireCollection.immediate(input); },
    reserveCollection(input) { return reserveCollection.immediate(input); },
    setCollectionBackoff({ sourceId, owner, now, retryAt }) {
      const at = instant(now); const until = instant(retryAt);
      if (until < at) fail();
      return db.transaction(() => {
        requireLease(sourceId, owner, at);
        db.prepare('UPDATE collection_control SET cooldown_until = max(cooldown_until, ?), lease_until = ? WHERE source_id = ?')
          .run(until, at + LEASE_MS, sourceId);
      }).immediate();
    },
    releaseCollection({ sourceId, owner }) {
      db.prepare('UPDATE collection_control SET lease_owner = NULL, lease_until = 0 WHERE source_id = ? AND lease_owner = ?')
        .run(text(sourceId, 80, true), text(owner, 100, true));
    },
    startRun,
    hasCompletedJob(sourceId, jobKey) { return Boolean(db.prepare('SELECT 1 FROM collection_jobs WHERE source_id = ? AND job_key = ?').get(sourceId, jobKey)); },
    completeRun(input) { return complete.immediate(input); },
    failRun({ runId, finishedAt, category = 'collection_failed' }) {
      if (!['collection_failed', 'source_permission_required', 'upstream_failed', 'unsupported_response', 'cancelled', 'storage_failed'].includes(category)) fail();
      db.prepare("UPDATE collection_runs SET status = 'failed', finished_at = ?, failure_category = ? WHERE run_id = ? AND status = 'running'")
        .run(instant(finishedAt), category, text(runId, 100, true));
    },
    revokeSource(sourceId, { now = new Date().toISOString(), purge = false } = {}) {
      text(sourceId, 80, true); const at = instant(now);
      return db.transaction(() => {
        if (!db.prepare('SELECT 1 FROM sources WHERE source_id = ?').get(sourceId)) fail('source_unknown', 'The selected history source is unknown. Check the source ID before changing history.');
        db.prepare("UPDATE sources SET status = 'revoked', updated_at = ? WHERE source_id = ?").run(at, sourceId);
        db.prepare("UPDATE source_rights SET status = 'revoked' WHERE source_id = ?").run(sourceId);
        const removedDirectorySnapshots = directory.revokeDirectory(sourceId, { purge });
        const removed = purge ? db.prepare('DELETE FROM observations WHERE source_id = ?').run(sourceId).changes : 0;
        return { status: 'revoked', removedObservations: removed, removedDirectorySnapshots };
      }).immediate();
    },
    purgeExpired({ now = new Date().toISOString(), sourceId = 'kroger-public' } = {}) {
      text(sourceId, 80, true); const at = instant(now);
      return db.transaction(() => {
        if (!db.prepare('SELECT 1 FROM sources WHERE source_id = ?').get(sourceId)) fail('source_unknown', 'The selected history source is unknown. Check the source ID before changing history.');
        const removedDirectorySnapshots = directory.purgeDirectory(sourceId, now);
        return { removedDirectorySnapshots, removedObservations: db.prepare(`DELETE FROM observations AS o WHERE o.source_id = ? AND
          (o.retain_until <= ? OR o.rights_id IN (SELECT rights_id FROM source_rights WHERE status = 'revoked' OR expires_at <= ?)
          OR NOT EXISTS (SELECT 1 FROM sources s JOIN source_rights cr ON cr.rights_id = s.current_rights_id
            JOIN collection_jobs j ON j.job_id = o.job_id
            WHERE s.source_id = o.source_id AND s.status = 'verified' AND cr.status = 'verified'
            AND cr.collection_allowed = 1 AND cr.display_allowed = 1 AND cr.agent_access_allowed = 1
            AND cr.expires_at > ? AND cr.verified_at <= ? AND o.observed_at + cr.retention_days * 86400000 > ?
            AND EXISTS (SELECT 1 FROM json_each(cr.allowed_locations) WHERE value = o.location_id)
            AND EXISTS (SELECT 1 FROM json_each(cr.allowed_topics) WHERE history_topic_key(value) = j.topic_key)))`)
          .run(sourceId, at, at, at, at, at).changes };
      }).immediate();
    },
    getSummary() {
      return { schemaVersion: SCHEMA_VERSION, observations: db.prepare('SELECT count(*) AS n FROM observations').get().n,
        completedRuns: db.prepare("SELECT count(*) AS n FROM collection_runs WHERE status = 'completed'").get().n,
        failedRuns: db.prepare("SELECT count(*) AS n FROM collection_runs WHERE status = 'failed'").get().n,
        coverage: 'bounded_topic_sample' };
    },
  };
}
