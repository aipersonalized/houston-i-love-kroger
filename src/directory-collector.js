import { createHash, randomUUID } from 'node:crypto';
import { HistoryError } from './history-store.js';
import { DIRECTORY_SOURCE, validZip } from './store-directory.js';

export const DEFAULT_DIRECTORY_PLAN = Object.freeze({ version: 1, sourceId: DIRECTORY_SOURCE, enabled: false,
  intervalMinutes: 1440, maxRequestsPerDay: 40, zipCodes: [] });

export function validateDirectoryPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key =>
    !['version', 'sourceId', 'enabled', 'intervalMinutes', 'maxRequestsPerDay', 'zipCodes'].includes(key))) {
    throw new HistoryError('directory_plan_invalid', 'Use the documented finite store-directory plan.');
  }
  const plan = { ...DEFAULT_DIRECTORY_PLAN, ...input };
  if (plan.version !== 1 || typeof plan.sourceId !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/u.test(plan.sourceId) ||
      plan.sourceId === 'kroger-public' || typeof plan.enabled !== 'boolean' || !Number.isInteger(plan.intervalMinutes) ||
      plan.intervalMinutes < 60 || plan.intervalMinutes > 10080 || !Number.isInteger(plan.maxRequestsPerDay) ||
      plan.maxRequestsPerDay < 4 || plan.maxRequestsPerDay > 1000 || !Array.isArray(plan.zipCodes) ||
      plan.zipCodes.length > 10 || !plan.zipCodes.every(validZip) || new Set(plan.zipCodes).size !== plan.zipCodes.length) {
    throw new HistoryError('directory_plan_invalid', 'Use the documented finite store-directory plan.');
  }
  return plan;
}

export async function runDirectoryCollection({ store, client, plan = DEFAULT_DIRECTORY_PLAN, planProvided = true,
  now = () => new Date().toISOString(), runId = randomUUID(), dryRun = false, signal } = {}) {
  const accepted = validateDirectoryPlan(plan);
  const clock = () => {
    const value = now();
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new HistoryError('history_input_invalid', 'Use a valid collection time.');
    return new Date(value).toISOString();
  };
  const startedAt = clock();
  const access = store?.getDirectoryPermission(accepted.sourceId, startedAt, accepted.zipCodes);
  const blockers = [];
  if (access?.status !== 'permitted') blockers.push({ code: 'permission_required', message: 'Reviewed store-directory collection, display, agent and exact-ZIP permission is required.' });
  if (client?.configured !== true || typeof client?.searchStores !== 'function') blockers.push({ code: 'configuration_required', message: 'Configure the production Locations adapter privately.' });
  if (!accepted.zipCodes.length) blockers.push({ code: 'targets_required', message: 'Choose at most ten explicit approved ZIP queries.' });
  if (!accepted.enabled) blockers.push({ code: 'collection_disabled', message: 'Enable the directory plan only after its grant and configuration are ready.' });
  if (!planProvided) blockers.push({ code: 'plan_required', message: 'Create the finite directory plan from the example.' });
  const coverage = { type: 'bounded_zip_directory', targetCount: accepted.zipCodes.length, radiusMiles: 10,
    limitPerQuery: 10, completeNearbyStores: false };
  const base = { requests: 0, reservedHttpAttempts: 0, snapshotsWritten: 0, storesWritten: 0, coverage };
  if (dryRun || blockers.length) return { ...base, status: dryRun ? 'dry_run' : 'blocked', blockers };
  if (signal?.aborted) return { ...base, status: 'cancelled' };
  let leaseHeld = false;
  let runStarted = false;
  let published = null;
  let publicationStarted = false;
  let retryAt;
  try {
    const lease = store.acquireCollection({ sourceId: accepted.sourceId, owner: runId, now: startedAt });
    if (lease.status !== 'acquired') return { ...base, status: 'deferred', category: `collection_${lease.status}`, retryAt: lease.retryAt };
    leaseHeld = true;
    const bucket = Math.floor(Date.parse(startedAt) / (accepted.intervalMinutes * 60_000));
    const pending = accepted.zipCodes.map(zipCode => ({ zipCode,
      jobKey: createHash('sha256').update(JSON.stringify([accepted.sourceId, zipCode, 10, 10, bucket])).digest('hex') }))
      .filter(job => !store.hasCompletedDirectoryJob(accepted.sourceId, job.jobKey));
    if (!pending.length) return { ...base, status: 'already_collected' };
    store.startDirectoryRun({ runId, sourceId: accepted.sourceId, startedAt, zipCodes: pending.map(job => job.zipCode) });
    runStarted = true;
    const jobs = [];
    for (const job of pending) {
      if (signal?.aborted) throw new HistoryError('cancelled');
      const at = clock();
      const rights = store.getDirectoryPermission(accepted.sourceId, at, [job.zipCode]);
      if (rights.status !== 'permitted') throw new HistoryError('source_permission_required');
      const budget = store.reserveCollection({ sourceId: accepted.sourceId, owner: runId, now: at, maxRequests: accepted.maxRequestsPerDay });
      if (budget.status !== 'reserved') { retryAt = budget.retryAt; throw new HistoryError(`collection_${budget.status}`); }
      base.reservedHttpAttempts += 4;
      base.requests++;
      let stores;
      try { stores = await client.searchStores(job.zipCode, { signal }); }
      catch (error) {
        if (['provider_limit', 'upstream_unavailable'].includes(error.code) && !signal?.aborted) {
          const failedAt = clock();
          retryAt = new Date(Date.parse(failedAt) + Math.max(60, Number.isFinite(error.retryAfter) ? error.retryAfter : 0) * 1000).toISOString();
          store.setCollectionBackoff({ sourceId: accepted.sourceId, owner: runId, now: failedAt, retryAt });
        }
        throw error;
      }
      if (!Array.isArray(stores) || stores.length > 10) throw new HistoryError('history_input_invalid');
      jobs.push({ ...job, observedAt: clock(), rightsId: rights.rightsId, stores });
    }
    if (signal?.aborted) throw new HistoryError('cancelled');
    publicationStarted = true;
    published = store.completeDirectoryRun({ runId, sourceId: accepted.sourceId, finishedAt: clock(), jobs, leaseOwner: runId });
    return { ...base, ...published, status: 'completed' };
  } catch (error) {
    const publicationUnknown = publicationStarted && !['history_input_invalid', 'source_permission_required', 'collection_lease_lost'].includes(error.code);
    const counts = publicationUnknown ? { snapshotsWritten: null, storesWritten: null } : {};
    const deferred = ['collection_busy', 'collection_backoff', 'collection_quota'].includes(error.code);
    const category = signal?.aborted || error.code === 'cancelled' ? 'cancelled'
      : error.code === 'source_permission_required' ? 'source_permission_required'
        : error.code === 'history_input_invalid' || error.code === 'upstream_format' ? 'unsupported_response' : 'upstream_failed';
    if (runStarted) {
      try { store.failDirectoryRun({ runId, finishedAt: clock(), category: deferred ? 'collection_failed' : category }); }
      catch { return { ...base, ...counts, status: 'failed', category: 'storage_failed',
        message: 'The last attempt could not be updated. Stop scheduling and inspect storage; null counts mean publication was not verified.' }; }
    }
    return { ...base, ...counts, status: deferred ? 'deferred' : category === 'cancelled' ? 'cancelled' : 'failed',
      category: publicationUnknown ? 'storage_failed' : deferred ? error.code : category, ...(retryAt ? { retryAt } : {}),
      message: publicationUnknown ? 'Snapshot publication was not verified. Stop scheduling and inspect the last attempt and storage before retrying.'
        : 'Directory collection did not complete. No snapshots from this run were published.' };
  } finally {
    if (leaseHeld) {
      try { store.releaseCollection({ sourceId: accepted.sourceId, owner: runId }); }
      catch { return { ...base, ...(published ?? (publicationStarted ? { snapshotsWritten: null, storesWritten: null } : {})), status: 'failed', category: 'storage_failed',
        message: 'The lease could not be released. Counts reflect any committed snapshots; stop scheduling and check storage.' }; }
    }
  }
}
