import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIGRATIONS = ['001-history.sql', '002-history-scope.sql'].map((filename, index) => {
  const sql = readFileSync(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
  return { version: index + 1, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const SCHEMA_VERSION = MIGRATIONS.length;
const APPLICATION_ID = 0x48494c4b;
const DAY = 86_400_000;
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
function amount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) fail();
  const cents = Math.round(value * 100);
  if (Math.abs(cents - value * 100) > 0.000001) fail();
  return cents;
}
function estimate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) fail();
  return value;
}
function centsValue(cents, decimal) {
  if (cents === undefined) return amount(decimal);
  if (cents === null) return null;
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000) fail();
  return cents;
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

// These fields retain the source's stated basis. Missing currency, eligibility,
// or unit measure is never guessed from a package description or a store region.
function normalize(offer) {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) fail();
  const source = offer.source ?? offer;
  const price = source.price ?? {};
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !price || typeof price !== 'object' || Array.isArray(price)) fail();
  return {
    product_id: text(source.productId, 100, true), item_id: text(source.itemId, 100, true),
    size: text(source.size), sold_by: text(source.soldBy, 50), currency: text(source.currency ?? offer.currency, 10),
    price_basis: text(source.priceBasis ?? offer.priceBasis, 100),
    modality: text(source.modality ?? offer.modality, 50),
    eligibility_key: text(source.eligibilityKey ?? offer.eligibilityKey, 200),
    regular_cents: centsValue(source.regularCents, price.regular),
    promo_cents: centsValue(source.promoCents, price.promo),
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
      if (tables.length !== REQUIRED_TABLES.length || !REQUIRED_TABLES.every(table => tables.includes(table))) fail('history_schema_unknown');
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
    return { status: 'policy_recorded', sourceId: p.sourceId };
  });

  const candidateQuery = db.prepare(`SELECT o.*, s.source_label FROM observations o
    JOIN collection_jobs j ON j.job_id = o.job_id
    JOIN source_rights r ON r.rights_id = o.rights_id JOIN sources s ON s.source_id = o.source_id
    JOIN source_rights cr ON cr.rights_id = s.current_rights_id
    WHERE o.source_id = ? AND o.location_id = ? AND o.product_id = ? AND o.item_id = ? AND o.observed_at < ?
    AND o.retain_until > ? AND s.status = 'verified' AND r.status = 'verified' AND r.display_allowed = 1
    AND r.agent_access_allowed = 1 AND r.expires_at > ? AND r.verified_at <= o.observed_at
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
      const candidates = candidateQuery.all(sourceId, locationId, current.product_id, current.item_id, at, at, at, at, at, at);
      if (!candidates.length) return empty('no_observations', 'No earlier retained observations exist for this exact store and item.');
      const identityFields = ['size', 'sold_by', 'currency', 'price_basis', 'modality', 'eligibility_key'];
      const matching = candidates.filter(row => identityFields.every(field => row[field] === current[field]));
      if (!matching.length) return empty('incomparable', 'Earlier observations use a different size, price basis, currency, modality, or eligibility.');
      const promos = matching.filter(row => row.promo_cents > 0 && row.regular_cents > row.promo_cents && row.date_qualified === 1);
      if (!promos.length) return { ...empty('incomparable', 'Earlier observations have no date-qualified promotional price.'), observationCount: matching.length };
      const last = promos[0];
      const lowest = promos.reduce((best, row) => row.promo_cents < best.promo_cents ? row : best);
      const known = identityFields.every(field => current[field] !== null) && current.currency === 'USD' &&
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

  function startRun({ runId, sourceId, startedAt, targetCount, limit }) {
    text(runId, 100, true); text(sourceId, 80, true);
    if (!Number.isInteger(targetCount) || targetCount < 0 || targetCount > 10 || !Number.isInteger(limit) || limit < 1 || limit > 50) fail();
    db.prepare(`INSERT INTO collection_runs(run_id,source_id,started_at,status,target_count,page_limit,coverage_type)
      VALUES (?, ?, ?, 'running', ?, ?, 'bounded_topic_sample')`).run(runId, sourceId, instant(startedAt), targetCount, limit);
  }

  const complete = db.transaction(({ runId, sourceId, finishedAt, jobs }) => {
    const finished = instant(finishedAt);
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
      text(job.jobKey, 100, true);
      if (!Array.isArray(job.offers) || job.offers.length > run.page_limit * 10 ||
          !Number.isInteger(job.returnedProductCount) || job.returnedProductCount < 0 || job.returnedProductCount > run.page_limit) fail();
      if (db.prepare('SELECT 1 FROM collection_jobs WHERE source_id = ? AND job_key = ?').get(sourceId, job.jobKey)) continue;
      const jobId = db.prepare(`INSERT INTO collection_jobs(source_id,job_key,run_id,location_id,observed_at,returned_product_count,topic_key)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sourceId, job.jobKey, runId, job.locationId, observed, job.returnedProductCount, topicKey(job.term)).lastInsertRowid;
      const retain = Math.min(observed + access.retentionDays * DAY, access.expiresAt);
      for (const offer of job.offers) {
        const row = normalize(offer);
        const identity = JSON.stringify([job.locationId, row.product_id, row.item_id]);
        const fingerprint = JSON.stringify(row);
        if (seenInRun.has(identity)) {
          if (seenInRun.get(identity) !== fingerprint) fail('history_input_invalid', 'A collection run contains conflicting prices for the same store and item.');
          continue;
        }
        seenInRun.set(identity, fingerprint);
        const fields = { ...row, job_id: jobId, source_id: sourceId, rights_id: access.rightsId, location_id: job.locationId,
          observed_at: observed, retain_until: retain, date_qualified: Number(windowAllows(row.effective_date, row.expiration_date, observed)) };
        db.prepare(`INSERT INTO observations(job_id,source_id,rights_id,location_id,product_id,item_id,size,sold_by,currency,
          price_basis,modality,eligibility_key,regular_cents,promo_cents,regular_unit_estimate,promo_unit_estimate,unit_basis,
          effective_date,expiration_date,date_qualified,observed_at,retain_until) VALUES
          (@job_id,@source_id,@rights_id,@location_id,@product_id,@item_id,@size,@sold_by,@currency,@price_basis,@modality,
          @eligibility_key,@regular_cents,@promo_cents,@regular_unit_estimate,@promo_unit_estimate,@unit_basis,
          @effective_date,@expiration_date,@date_qualified,@observed_at,@retain_until)`).run(fields);
        observationCount++;
      }
      completedJobs++;
    }
    db.prepare("UPDATE collection_runs SET status = 'completed', finished_at = ?, observation_count = ? WHERE run_id = ?")
      .run(finished, observationCount, runId);
    return { observationCount, completedJobs };
  });

  return {
    close() { if (db.open) db.close(); },
    getComparisons, getSourcePermission: permission,
    getSourceStatus(sourceId = 'kroger-public') {
      text(sourceId, 80, true);
      const row = db.prepare('SELECT status FROM sources WHERE source_id = ?').get(sourceId);
      return { status: row?.status ?? 'unknown' };
    },
    recordSourcePolicy(policy, { now = new Date().toISOString() } = {}) { return savePolicy.immediate(policy, now); },
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
        const removed = purge ? db.prepare('DELETE FROM observations WHERE source_id = ?').run(sourceId).changes : 0;
        return { status: 'revoked', removedObservations: removed };
      }).immediate();
    },
    purgeExpired({ now = new Date().toISOString(), sourceId = 'kroger-public' } = {}) {
      text(sourceId, 80, true); const at = instant(now);
      return db.transaction(() => {
        if (!db.prepare('SELECT 1 FROM sources WHERE source_id = ?').get(sourceId)) fail('source_unknown', 'The selected history source is unknown. Check the source ID before changing history.');
        return { removedObservations: db.prepare(`DELETE FROM observations AS o WHERE o.source_id = ? AND
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
