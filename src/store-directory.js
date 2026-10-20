// This module owns the retained ZIP-query view. It never imports a supplier
// client, reads operator configuration, geocodes, or starts collection.
export const DIRECTORY_SOURCE = 'kroger-public-locations';
export const DIRECTORY_PURPOSES = Object.freeze(['store-directory-collection', 'store-directory-display', 'store-directory-agent-access']);
export const DIRECTORY_ADDRESS_FIELDS = Object.freeze(['addressLine1', 'addressLine2', 'city', 'county', 'state', 'zipCode']);
export const validZip = value => typeof value === 'string' && /^\d{5}$/u.test(value);
export const validDirectoryRequest = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === 1 && Object.hasOwn(value, 'zipCode') && validZip(value.zipCode);
export const validTopicsRequest = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === 1 && Object.hasOwn(value, 'locationId') && typeof value.locationId === 'string' && /^[a-zA-Z0-9]{8}$/u.test(value.locationId);

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const cleanText = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum &&
  value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value);
const utc = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function validSnapshot(value) {
  return fields(value, ['snapshotId', 'observedAt', 'completedAt', 'ageSeconds', 'maxAgeSeconds']) &&
    typeof value.snapshotId === 'string' && /^[1-9]\d{0,15}$/u.test(value.snapshotId) && utc(value.observedAt) && utc(value.completedAt) &&
    value.completedAt >= value.observedAt && Number.isInteger(value.ageSeconds) && value.ageSeconds >= 0 &&
    Number.isInteger(value.maxAgeSeconds) && value.maxAgeSeconds >= 1 && value.maxAgeSeconds <= 604_800;
}
function validAttempt(value) {
  return value === null || fields(value, ['status', 'startedAt', 'finishedAt']) &&
    ['running', 'completed', 'failed', 'blocked'].includes(value.status) && utc(value.startedAt) &&
    (value.finishedAt === null || utc(value.finishedAt) && value.finishedAt >= value.startedAt);
}
export function validDiscoveryResponse(value, operation, input) {
  const stores = operation === 'getStoredStores';
  const required = stores ? ['status', 'zipCode', 'stores', 'snapshot', 'latestAttempt', 'coverage'] : ['status', 'locationId', 'topics', 'coverage'];
  if (!fields(value, required, ['reason', 'message']) || !['available', 'no_data', 'stale', 'permission_required'].includes(value.status) ||
      value.reason !== undefined && !['directory_permission_required', 'directory_scope_not_approved', 'source_permission_required',
        'source_scope_not_approved', 'no_completed_directory', 'no_completed_topics', 'snapshot_not_readable', 'snapshot_stale'].includes(value.reason) ||
      value.message !== undefined && !cleanText(value.message, 1000)) return false;
  if (stores) {
    const { coverage, snapshot } = value;
    if (value.zipCode !== input.zipCode || !Array.isArray(value.stores) || value.stores.length > 10 || !validAttempt(value.latestAttempt) ||
        !fields(coverage, ['type', 'zipCode', 'radiusMiles', 'limitPerQuery', 'returnedStoreCount', 'completeNearbyStores', 'message']) ||
        coverage.type !== 'bounded_zip_directory' || coverage.zipCode !== input.zipCode || coverage.radiusMiles !== 10 ||
        coverage.limitPerQuery !== 10 || coverage.completeNearbyStores !== false || !cleanText(coverage.message, 1000)) return false;
    if (['available', 'stale'].includes(value.status)) {
      if (!validSnapshot(snapshot) || !Number.isInteger(coverage.returnedStoreCount) || coverage.returnedStoreCount < 0 ||
          coverage.returnedStoreCount > 10 || (value.status === 'available') !== (snapshot.ageSeconds < snapshot.maxAgeSeconds)) return false;
    } else if (snapshot !== null || coverage.returnedStoreCount !== null) return false;
    if ((value.status === 'available' ? value.stores.length !== coverage.returnedStoreCount : value.stores.length !== 0) ||
        value.status === 'permission_required' && value.latestAttempt !== null) return false;
    const seen = new Set();
    return value.stores.every(row => {
      if (!fields(row, ['locationId', 'name', 'address']) || !validTopicsRequest({ locationId: row.locationId }) || seen.has(row.locationId) ||
          row.name !== null && !cleanText(row.name, 200) || !fields(row.address, DIRECTORY_ADDRESS_FIELDS) ||
          !DIRECTORY_ADDRESS_FIELDS.every(key => row.address[key] === null || cleanText(row.address[key], 512))) return false;
      seen.add(row.locationId); return true;
    });
  }
  if (value.locationId !== input.locationId || !Array.isArray(value.topics) || value.topics.length > 10 ||
      !fields(value.coverage, ['type', 'completeCatalog', 'message']) || value.coverage.type !== 'completed_store_topics' ||
      value.coverage.completeCatalog !== false || !cleanText(value.coverage.message, 1000)) return false;
  const seen = new Set();
  if (!value.topics.every(row => {
    if (!fields(row, ['topic', 'status', 'snapshot', 'latestAttempt', 'returnedProductCount']) || !cleanText(row.topic, 80) ||
        row.topic.length < 3 || row.topic === '*' || row.topic.split(/\s+/u).length > 8 || seen.has(row.topic) ||
        !['available', 'stale'].includes(row.status) || !validSnapshot(row.snapshot) || !validAttempt(row.latestAttempt) ||
        (row.status === 'available') !== (row.snapshot.ageSeconds < row.snapshot.maxAgeSeconds) ||
        !Number.isInteger(row.returnedProductCount) || row.returnedProductCount < 0 || row.returnedProductCount > 50) return false;
    seen.add(row.topic); return true;
  })) return false;
  const status = !value.topics.length ? value.status === 'permission_required' ? 'permission_required' : 'no_data'
    : value.topics.some(row => row.status === 'available') ? 'available' : 'stale';
  return value.status === status;
}

export function createDirectoryStore(db, { fail, instant, text, requireLease }) {
  const DAY = 86_400_000;
  function validatePolicy(policy, now) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy) || policy.status !== 'verified' ||
        Object.keys(policy).some(key => !['sourceId', 'sourceLabel', 'status', 'evidenceReference', 'reviewReference',
          'verifiedAt', 'expiresAt', 'retentionDays', 'allowedPurposes', 'allowedZipCodes'].includes(key)) ||
        !Array.isArray(policy.allowedPurposes) || policy.allowedPurposes.length !== 3 ||
        !DIRECTORY_PURPOSES.every(p => policy.allowedPurposes.includes(p)) ||
        !Array.isArray(policy.allowedZipCodes) || policy.allowedZipCodes.length < 1 || policy.allowedZipCodes.length > 10 ||
        !policy.allowedZipCodes.every(validZip) || new Set(policy.allowedZipCodes).size !== policy.allowedZipCodes.length || !Number.isInteger(policy.retentionDays) ||
        policy.retentionDays < 1 || policy.retentionDays > 3660) fail('directory_policy_invalid');
    const sourceId = text(policy.sourceId, 80, true);
    if (!/^[a-z][a-z0-9-]{0,79}$/u.test(sourceId) || sourceId === 'kroger-public') fail('directory_policy_invalid');
    const sourceLabel = text(policy.sourceLabel, 100, true);
    const evidenceReference = text(policy.evidenceReference, 160, true);
    const reviewReference = text(policy.reviewReference, 160, true);
    if (![evidenceReference, reviewReference].every(ref => /^[a-zA-Z][a-zA-Z0-9._:-]{0,159}$/u.test(ref))) fail('directory_policy_invalid');
    const verifiedAt = instant(policy.verifiedAt); const expiresAt = instant(policy.expiresAt); const at = instant(now);
    if (verifiedAt > at || expiresAt <= at || expiresAt <= verifiedAt) fail('directory_policy_invalid');
    return { sourceId, sourceLabel, evidenceReference, reviewReference, verifiedAt, expiresAt,
      retentionDays: policy.retentionDays, zips: [...new Set(policy.allowedZipCodes)] };
  }
  function permission(sourceId = DIRECTORY_SOURCE, asOf = new Date().toISOString(), zips = []) {
    const at = instant(asOf); text(sourceId, 80, true);
    const row = db.prepare(`SELECT r.*,s.status AS source_status,s.source_label FROM sources s
      LEFT JOIN directory_rights r ON r.source_id=s.source_id AND r.is_current=1 WHERE s.source_id=?`).get(sourceId);
    if (!row || row.source_status !== 'verified' || row.status !== 'verified' || row.verified_at > at || row.expires_at <= at) {
      return { status: 'permission_required', reason: 'directory_permission_required' };
    }
    const allowed = JSON.parse(row.allowed_zips);
    if (zips.some(zip => !validZip(zip) || !allowed.includes(zip))) return { status: 'permission_required', reason: 'directory_scope_not_approved' };
    return { status: 'permitted', rightsId: row.rights_id, expiresAt: row.expires_at,
      retentionDays: row.retention_days, sourceLabel: row.source_label };
  }
  const savePolicy = db.transaction((policy, now) => {
    const p = validatePolicy(policy, now); const at = instant(now);
    const source = db.prepare('SELECT * FROM sources WHERE source_id=?').get(p.sourceId);
    if (source?.status === 'revoked') fail('source_revoked');
    // Directory permission is independent of product-history permission. Never
    // turn a product source or its current rights pointer into a directory grant.
    if (source?.current_rights_id !== null && source?.current_rights_id !== undefined) fail('directory_policy_invalid');
    const current = db.prepare('SELECT * FROM directory_rights WHERE source_id=? AND is_current=1').get(p.sourceId);
    if (current && p.verifiedAt < current.verified_at) fail('source_policy_superseded');
    const existing = db.prepare(`SELECT * FROM directory_rights WHERE source_id=? AND evidence_reference=?
      AND review_reference=? AND verified_at=?`).get(p.sourceId, p.evidenceReference, p.reviewReference, p.verifiedAt);
    if (existing) {
      if (!existing.is_current) fail('source_policy_superseded');
      if (existing.status !== 'verified' || existing.expires_at !== p.expiresAt || existing.retention_days !== p.retentionDays ||
          existing.allowed_zips !== JSON.stringify(p.zips)) fail('source_policy_conflict');
    } else {
      db.prepare(`INSERT INTO sources(source_id,source_label,status,updated_at) VALUES (?,?,'pending',?)
        ON CONFLICT(source_id) DO UPDATE SET source_label=excluded.source_label,updated_at=excluded.updated_at`).run(p.sourceId,p.sourceLabel,at);
      db.prepare('UPDATE directory_rights SET is_current=0 WHERE source_id=?').run(p.sourceId);
      db.prepare(`INSERT INTO directory_rights(source_id,status,is_current,evidence_reference,review_reference,
        verified_at,expires_at,retention_days,allowed_zips) VALUES (?,'verified',1,?,?,?,?,?,?)`)
        .run(p.sourceId,p.evidenceReference,p.reviewReference,p.verifiedAt,p.expiresAt,p.retentionDays,JSON.stringify(p.zips));
    }
    db.prepare("UPDATE sources SET status='verified',updated_at=? WHERE source_id=?").run(at,p.sourceId);
    db.prepare(`UPDATE directory_snapshots SET retain_until=max(observed_at+1,min(retain_until,observed_at+?,?))
      WHERE source_id=?`).run(p.retentionDays*DAY,p.expiresAt,p.sourceId);
    return { status:'policy_recorded',sourceId:p.sourceId };
  });
  function normalizeStore(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !validTopicsRequest({locationId:row.locationId}) ||
        !row.address || typeof row.address !== 'object' || Array.isArray(row.address)) fail('history_input_invalid');
    const address = Object.fromEntries(DIRECTORY_ADDRESS_FIELDS.map(key => [key,text(row.address[key],512)]));
    const name = text(row.name,200);
    if (name !== null && !cleanText(name,200) || Object.values(address).some(value => value !== null && !cleanText(value,512))) fail();
    return {locationId:row.locationId,name,address};
  }
  function snapshotView(row, at, maxAgeSeconds) {
    return {snapshotId:String(row.snapshot_id),observedAt:new Date(row.observed_at).toISOString(),
      completedAt:new Date(row.finished_at).toISOString(),ageSeconds:Math.floor((at-row.observed_at)/1000),maxAgeSeconds};
  }
  const complete = db.transaction(({runId,sourceId,finishedAt,jobs,leaseOwner}) => {
    const at=instant(finishedAt); requireLease(sourceId,leaseOwner,at);
    const run=db.prepare("SELECT * FROM directory_runs WHERE run_id=? AND source_id=? AND status='running'").get(runId,sourceId);
    if (!run || !Array.isArray(jobs) || !jobs.length || jobs.length>10 || at<run.started_at ||
        JSON.stringify(jobs.map(job=>job.zipCode))!==run.target_zips) fail();
    let storeCount=0;
    for (const job of jobs) {
      const access=permission(sourceId,finishedAt,[job.zipCode]);
      if (access.status!=='permitted') fail('source_permission_required');
      const observed=instant(job.observedAt);
      const original=db.prepare('SELECT * FROM directory_rights WHERE rights_id=? AND source_id=?').get(job.rightsId,sourceId);
      if (observed<run.started_at || observed>at || !original || original.status!=='verified' || original.verified_at>observed ||
          original.expires_at<=at || !JSON.parse(original.allowed_zips).includes(job.zipCode) || !Array.isArray(job.stores) || job.stores.length>10) fail('source_permission_required');
      text(job.jobKey,100,true);
      const retain=Math.min(observed+access.retentionDays*DAY,access.expiresAt,observed+original.retention_days*DAY,original.expires_at);
      const id=db.prepare(`INSERT INTO directory_snapshots(run_id,source_id,job_key,zip_code,radius_miles,query_limit,
        returned_store_count,observed_at,rights_id,retain_until) VALUES (?,?,?,?,10,10,?,?,?,?)`)
        .run(runId,sourceId,job.jobKey,job.zipCode,job.stores.length,observed,job.rightsId,retain).lastInsertRowid;
      const seen=new Set();
      for (const input of job.stores) {
        const row=normalizeStore(input);
        if (seen.has(row.locationId)) fail('history_input_invalid', 'The source returned duplicate store identities.');
        const position=seen.size; seen.add(row.locationId);
        db.prepare('INSERT INTO directory_stores VALUES (?,?,?,?,?)').run(id,position,row.locationId,row.name,JSON.stringify(row.address));
        storeCount++;
      }
    }
    requireLease(sourceId,leaseOwner,at);
    db.prepare("UPDATE directory_runs SET status='completed',finished_at=? WHERE run_id=?").run(at,runId);
    return {snapshotsWritten:jobs.length,storesWritten:storeCount};
  });
  const read = db.transaction(({zipCode,sourceId=DIRECTORY_SOURCE,asOf=new Date().toISOString(),maxAgeSeconds=86_400}) => {
    if (!validDirectoryRequest({zipCode}) || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds<1 || maxAgeSeconds>604_800) fail();
    const at=instant(asOf);
    const coverage={type:'bounded_zip_directory',zipCode,radiusMiles:10,limitPerQuery:10,returnedStoreCount:null,
      completeNearbyStores:false,message:'Stored first page of a 10-mile ZIP query, at most 10 returned locations. No distance ordering, all-nearby coverage or live availability is established.'};
    const base={zipCode,stores:[],snapshot:null,latestAttempt:null,coverage};
    const access=permission(sourceId,asOf,[zipCode]);
    if(access.status!=='permitted') return {...base,...access};
    const attempt=db.prepare(`SELECT * FROM directory_runs WHERE source_id=? AND started_at<=?
      AND EXISTS(SELECT 1 FROM json_each(target_zips) WHERE value=?) ORDER BY started_at DESC,rowid DESC LIMIT 1`).get(sourceId,at,zipCode);
    if(attempt) base.latestAttempt={status:attempt.status,startedAt:new Date(attempt.started_at).toISOString(),
      finishedAt:attempt.finished_at===null?null:new Date(attempt.finished_at).toISOString()};
    const row=db.prepare(`SELECT j.*,r.finished_at FROM directory_snapshots j JOIN directory_runs r ON r.run_id=j.run_id
      WHERE j.source_id=? AND j.zip_code=? AND r.status='completed' AND r.finished_at<=? AND j.observed_at<=?
      ORDER BY j.observed_at DESC,j.snapshot_id DESC LIMIT 1`).get(sourceId,zipCode,at,at);
    if(!row) return {...base,status:'no_data',reason:'no_completed_directory'};
    const original=db.prepare('SELECT * FROM directory_rights WHERE rights_id=? AND source_id=?').get(row.rights_id,sourceId);
    if(!original || original.status!=='verified' || original.verified_at>row.observed_at || original.expires_at<=at ||
        !JSON.parse(original.allowed_zips).includes(zipCode) || row.retain_until<=at || row.observed_at+access.retentionDays*DAY<=at) {
      return {...base,status:'no_data',reason:'snapshot_not_readable'};
    }
    base.snapshot=snapshotView(row,at,maxAgeSeconds); coverage.returnedStoreCount=row.returned_store_count;
    if(at-row.observed_at>=maxAgeSeconds*1000) return {...base,status:'stale',reason:'snapshot_stale'};
    const stores=db.prepare('SELECT * FROM directory_stores WHERE snapshot_id=? ORDER BY position').all(row.snapshot_id)
      .map(store=>({locationId:store.location_id,name:store.name,address:JSON.parse(store.address_json)}));
    return {...base,status:'available',stores};
  });
  function purge(sourceId,now) {
    const at=instant(now);
    return db.prepare(`DELETE FROM directory_snapshots AS j WHERE j.source_id=? AND (j.retain_until<=?
      OR NOT EXISTS(SELECT 1 FROM sources s JOIN directory_rights r ON r.source_id=s.source_id AND r.is_current=1
        WHERE s.source_id=j.source_id AND s.status='verified' AND r.status='verified' AND r.verified_at<=?
        AND r.expires_at>? AND j.observed_at+r.retention_days*86400000>?
        AND EXISTS(SELECT 1 FROM json_each(r.allowed_zips) WHERE value=j.zip_code))
      OR EXISTS(SELECT 1 FROM directory_rights r WHERE r.rights_id=j.rights_id AND (r.status='revoked' OR r.expires_at<=?)))`)
      .run(sourceId,at,at,at,at,at).changes;
  }
  return {
    recordDirectoryPolicy(policy,{now=new Date().toISOString()}={}) {return savePolicy.immediate(policy,now);},
    validateDirectoryPolicy(policy,{now=new Date().toISOString()}={}) {validatePolicy(policy,now);},
    getDirectoryPermission:permission,
    getStoredStores(input) {return read.deferred(input);},
    startDirectoryRun({runId,sourceId,startedAt,zipCodes}) {
      text(runId,100,true); const access=permission(sourceId,startedAt,zipCodes);
      if(access.status!=='permitted') fail('source_permission_required');
      db.prepare(`INSERT INTO directory_runs VALUES (?,?,?,NULL,'running',?,NULL)`).run(runId,sourceId,instant(startedAt),JSON.stringify(zipCodes));
    },
    hasCompletedDirectoryJob(sourceId,key) {return Boolean(db.prepare('SELECT 1 FROM directory_snapshots WHERE source_id=? AND job_key=?').get(sourceId,key));},
    completeDirectoryRun(input) {return complete.immediate(input);},
    failDirectoryRun({runId,finishedAt,category='collection_failed'}) {
      if(!['collection_failed','source_permission_required','upstream_failed','unsupported_response','cancelled'].includes(category)) fail();
      db.prepare("UPDATE directory_runs SET status='failed',finished_at=?,failure_category=? WHERE run_id=? AND status='running'").run(instant(finishedAt),category,text(runId,100,true));
    },
    revokeDirectory(sourceId,{purge:remove=false}={}) {
      db.prepare("UPDATE directory_rights SET status='revoked' WHERE source_id=?").run(sourceId);
      return remove?db.prepare('DELETE FROM directory_snapshots WHERE source_id=?').run(sourceId).changes:0;
    },
    purgeDirectory:purge,
    getDirectorySummary() {return {snapshots:db.prepare('SELECT count(*) AS n FROM directory_snapshots').get().n,
      stores:db.prepare('SELECT count(*) AS n FROM directory_stores').get().n};},
  };
}
